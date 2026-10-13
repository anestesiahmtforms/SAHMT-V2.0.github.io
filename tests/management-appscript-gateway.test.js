import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash, createHmac, generateKeyPairSync, sign} from 'node:crypto';
import {createManagementGatewayProtocol, gatewayCanonicalJson} from '../scripts/lib/management-gateway-protocol.js';
import {createManagementGatewayClient} from '../scripts/lib/management-gateway-client.js';
import {createManagementGoogleAuthAdapter} from '../scripts/lib/management-google-auth-adapter.js';
import {createManagementAppsScriptGatewayAdapter} from '../worker-management-auth/apps-script-gateway-adapter.js';

const SOURCE=fs.readFileSync(new URL('../apps-script-management-gateway/Gateway.gs',import.meta.url),'utf8');
const MANIFEST=JSON.parse(fs.readFileSync(new URL('../apps-script-management-gateway/appsscript.json',import.meta.url),'utf8'));
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',FC='indicadores---sahmt',TIME=1800000000000,VERSION='SAHMT_MANAGEMENT_GATEWAY_V1';
const AUDIENCE='sahmt-management-dedicated-appscript-v1',FA_SIGNER='sahmt-fa-token-signer@'+FA+'.iam.gserviceaccount.com',SIGNER='management-broker@'+FB+'.iam.gserviceaccount.com',FC_SIGNER='indicators-broker@'+FC+'.iam.gserviceaccount.com';
const IAM_PROOF_SCOPES=['https://www.googleapis.com/auth/iam','https://www.googleapis.com/auth/script.external_request'];
const SECRET=Buffer.alloc(32,71),ACTOR='synthetic-gateway-owner@example.invalid';
const CONFIG='MANAGEMENT_GATEWAY_CONFIG_JSON',PIN='MANAGEMENT_GATEWAY_CONFIG_SHA256',KEY='MANAGEMENT_GATEWAY_HMAC_SECRET_BASE64URL';
const IDENTITY_POLICY='SAHMT_FA_PROTECTED_IDENTITIES_JSON';
const CLOCK='MGW_CLOCK_V1',PREFIX='MGW_NONCE_V1_';
const OPS=['AUTH_USER_LOOKUP_FA','AUTH_USER_LOOKUP_FB','AUTH_USER_LOOKUP_FC','SIGN_FB_CUSTOM_TOKEN','SIGN_FC_CUSTOM_TOKEN','FIRST_LOGIN_FA_SIGN'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const keyPair=generateKeyPairSync('rsa',{modulusLength:2048});
const publicPem=keyPair.publicKey.export({type:'spki',format:'pem'});
const signedBytes=bytes=>Array.from(bytes,value=>value>127?value-256:value);
const buffer=bytes=>Buffer.from(bytes.map(value=>(value+256)%256));
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt=(payload,header={alg:'RS256',kid:'synthetic-key',typ:'JWT'})=>{
  const input=encode(header)+'.'+encode(payload);
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),keyPair.privateKey).toString('base64url');
};
const policy=()=>({schemaVersion:1,protocolVersion:VERSION,audience:AUDIENCE,keyId:'synthetic-key-v1',
  maximumTtlMs:30000,maxFutureSkewMs:0,maxEnvelopeBytes:65536,operationTimeoutMs:30000,customTokenMaxTtlSeconds:600,
  enabledOperations:Object.fromEntries(OPS.map(op=>[op,true]))});
const config=()=>({schemaVersion:1,enabled:true,actorEmailSha256:hash(ACTOR),faSignerServiceAccountEmail:FA_SIGNER,signerServiceAccountEmail:SIGNER,fcSignerServiceAccountEmail:FC_SIGNER,
  managementPolicyVersion:'synthetic-management-policy',maxGoogleResponseBytes:65536,policy:policy(),
  noncePolicy:{maxNonceRecords:32,maxPropertyBytes:8192,maxStorageBytes:100000,lockTimeoutMs:1000,retentionMs:300000}});
const claims=()=>({managementSourceProjectId:FA,managementMemberId:'stable-member-a',managementSourceVersion:3,
  managementSourceHash:'a'.repeat(64),managementPolicyVersion:'synthetic-management-policy',managementSourceAuthTimeMs:TIME-50000});
const signBody=()=>({uid:'member-a',claims:claims(),issuedAtSeconds:TIME/1000,expiresAtSeconds:TIME/1000+600});
const fcSignBody=()=>({uid:'member-a',claims:{sahmtFaSourceProjectId:FA,sahmtOccurrencesCatalogRead:false,sahmtOccurrencesRead:false,
  sahmtOccurrencesWrite:false,sahmtOccurrencesAuditRead:false},issuedAtSeconds:TIME/1000,expiresAtSeconds:TIME/1000+600});
const firstLoginBody=()=>({email:'synthetic-private-email@example.invalid',googleSub:'google-id-a',issuedAtSeconds:TIME/1000,expiresAtSeconds:TIME/1000+300});
const protectedIdentityPolicy=()=>({schemaVersion:1,identities:[
  {marker:'STRUCTURAL_OWNER',uid:'structural-uid',email:'owner@example.invalid'},
  {marker:'HOMOLOGATION_CANDIDATE_1',uid:'homologation-uid-1',email:'homologation-1@example.invalid'},
  {marker:'HOMOLOGATION_CANDIDATE_2',uid:'homologation-uid-2',email:'homologation-2@example.invalid'}]});
const rawUser=()=>({localId:'member-a',email:'synthetic-private-email@example.invalid',displayName:'never-return-name',
  emailVerified:true,disabled:false,validSince:String(TIME/1000-100),providerUserInfo:[
    {providerId:'google.com',rawId:'google-id-a',email:'private-provider@example.invalid',displayName:'never-return-provider-name'}],
  passwordHash:'never-return-password-hash',salt:'never-return-salt',customAttributes:'never-return-private-claims'});

function harness({configuration=config(),properties,withoutProperties=false,withoutIdentityPolicy=false,
  declaredScopes=MANIFEST.oauthScopes}={}){
  const values=properties||new Map();
  const state={time:TIME,configuration:copy(configuration),values,actor:ACTOR,scopeApproved:true,declaredScopes:Array.from(declaredScopes),lockAvailable:true,lockHeld:false,
    lockAdvanceMs:0,oauthCalls:0,googleCalls:[],propertyWrites:[],propertyDeletes:[],locks:[],user:rawUser(),
    responseOverride:null,writeFailure:null,badReadback:null,googleAdvanceMs:0,oauthValue:'synthetic-oauth-server-only',executionLogs:[],
    firstLoginProfile:{name:'projects/'+FA+'/databases/(default)/documents/users/member-a',fields:{active:{booleanValue:true},access:{booleanValue:true},firstLoginCohort:{stringValue:'OPERATIONAL'}}}};
  const putConfig=next=>{
    state.configuration=copy(next);values.set(CONFIG,JSON.stringify(next));values.set(PIN,hash(gatewayCanonicalJson(next)));
    values.set(KEY,SECRET.toString('base64url'));
  };
  if(!withoutProperties&&!properties)putConfig(configuration);
  if(!withoutProperties&&!properties&&!withoutIdentityPolicy)values.set(IDENTITY_POLICY,JSON.stringify(protectedIdentityPolicy()));
  const getProperty=name=>{
    const value=values.get(name)??null;
    if(state.badReadback&&state.propertyWrites.includes(name)&&name.startsWith(state.badReadback))return 'corrupt-readback';
    if(state.afterPropertyRead)state.afterPropertyRead(name,value);
    return value;
  };
  const scriptProperties={getProperty,getProperties:()=>Object.fromEntries(values),
    setProperty:(name,value)=>{state.propertyWrites.push(name);
      if(state.writeFailure&&name.startsWith(state.writeFailure))throw Error('synthetic-secret-exception');
      values.set(name,value);return scriptProperties;},
    deleteProperty:name=>{state.propertyDeletes.push(name);values.delete(name);return scriptProperties;}};
  const blob=value=>{const bytes=typeof value==='string'?Buffer.from(value,'utf8'):buffer(Array.from(value));
    return {getBytes:()=>signedBytes(bytes),getDataAsString:()=>bytes.toString('utf8')};};
  const googleResponse=(data,{status=200,headers={'Content-Type':'application/json'},bytes}={})=>({
    getResponseCode:()=>status,getAllHeaders:()=>headers,
    getContentText:()=>bytes===undefined?(typeof data==='string'?data:JSON.stringify(data)):Buffer.from(bytes).toString('utf8'),
    getBlob:()=>blob(bytes===undefined?(typeof data==='string'?data:JSON.stringify(data)):bytes)});
  const globals={
    Date:class extends Date{static now(){return state.time;}},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},newBlob:blob,
      computeDigest:(_algorithm,bytes)=>signedBytes(createHash('sha256').update(buffer(Array.from(bytes))).digest()),
      computeHmacSha256Signature:(bytes,secret)=>signedBytes(createHmac('sha256',buffer(Array.from(secret))).update(buffer(Array.from(bytes))).digest()),
      base64EncodeWebSafe:bytes=>buffer(Array.from(bytes)).toString('base64url'),
      base64DecodeWebSafe:text=>signedBytes(Buffer.from(text,'base64url'))},
    PropertiesService:{getScriptProperties:()=>scriptProperties},
    Session:{getEffectiveUser:()=>({getEmail:()=>state.actor})},
    ScriptApp:{AuthMode:{FULL:'FULL'},AuthorizationStatus:{NOT_REQUIRED:'NOT_REQUIRED',REQUIRED:'REQUIRED'},
      getAuthorizationInfo:(_mode,scopes)=>{state.scopes=Array.from(scopes);
        if(state.scopes.some(scope=>!state.declaredScopes.includes(scope)))throw Error('synthetic scope is invalid or not required');
        return {getAuthorizationStatus:()=>state.scopeApproved?'NOT_REQUIRED':'REQUIRED'};},
      getOAuthToken:()=>{state.oauthCalls++;return state.oauthValue;}},
    LockService:{getScriptLock:()=>({tryLock:wait=>{state.locks.push(wait);state.time+=state.lockAdvanceMs;
      if(!state.lockAvailable||state.lockHeld)return false;state.lockHeld=true;return true;},
      releaseLock:()=>{state.lockHeld=false;}})},
    Logger:{log:value=>{state.executionLogs.push(String(value));}},
    UrlFetchApp:{fetch:(url,options)=>{
      state.googleCalls.push({url,options:copy(options)});state.time+=state.googleAdvanceMs;
      if(state.responseOverride)return state.responseOverride(url,options,googleResponse);
      if(url.endsWith('/accounts:lookup'))return googleResponse({users:state.user===null?[]:[state.user],unexpectedPrivate:'never-return-top-level'});
      if(url.startsWith('https://firestore.googleapis.com/'))return googleResponse(state.firstLoginProfile);
      if(url.endsWith(':signJwt')){const payload=JSON.parse(JSON.parse(options.payload).payload);
        return googleResponse({keyId:'synthetic-key',signedJwt:jwt(payload)});}
      throw Error('Unexpected synthetic endpoint');
    }},
    ContentService:{MimeType:{JSON:'JSON'},createTextOutput:text=>({text,setMimeType(type){this.mimeType=type;return this;}})}
  };
  const context=vm.createContext(globals);new vm.Script(SOURCE).runInContext(context,{timeout:1000});
  let counter=0;
  const rawRequest=(operation='AUTH_USER_LOOKUP_FA',body={uid:'member-a'},changes={})=>{
    const envelope={schemaVersion:1,protocolVersion:VERSION,audience:AUDIENCE,keyId:state.configuration.policy.keyId,
      direction:'WORKER_TO_APPS_SCRIPT',sourceProjectId:FA,destinationProjectId:operation==='SIGN_FC_CUSTOM_TOKEN'||operation==='AUTH_USER_LOOKUP_FC'?FC:operation==='FIRST_LOGIN_FA_SIGN'?FA:FB,operation,
      requestId:(++counter).toString(16).padStart(32,'0'),nonce:(counter+10000).toString(16).padStart(32,'0'),
      issuedAtMs:state.time,expiresAtMs:state.time+10000,body:copy(body),bodySha256:'',...copy(changes)};
    envelope.bodySha256=hash(gatewayCanonicalJson(envelope.body));
    const unsigned=Object.fromEntries(Object.entries(envelope).filter(([name])=>name!=='signature'));
    envelope.signature=createHmac('sha256',SECRET).update(VERSION+'_REQUEST\n'+gatewayCanonicalJson(unsigned)).digest('hex');
    return envelope;
  };
  const call=(request,eventChanges={})=>{
    const text=JSON.stringify(request),length=Buffer.byteLength(text);
    const event={queryString:null,pathInfo:'',contentLength:length,postData:{type:'application/json',length,contents:text},...eventChanges};
    const result=context.doPost(event);assert.equal(result.mimeType,'JSON');return JSON.parse(result.text);
  };
  return {state,context,values,putConfig,rawRequest,call,googleResponse,
    protocol:()=>createManagementGatewayProtocol({policy:state.configuration.policy,secret:SECRET,now:()=>state.time})};
}
const denied=(response,code)=>{assert.equal(response.status==='DENIED'||response.ok===false,true);if(code)assert.equal(response.code,code);};
const noEffects=h=>{assert.equal(h.state.oauthCalls,0);assert.equal(h.state.googleCalls.length,0);};
const nonceValues=h=>[...h.values].filter(([key])=>key.startsWith(PREFIX));

test('Worker adapter envelope is accepted by the actual Apps Script Gateway VM and its HMAC response verifies',async()=>{
  const configuration=config();
  Object.assign(configuration.policy,{keyId:'sahmt-appscript-gateway-hmac-v1',maximumTtlMs:20000,maxFutureSkewMs:5000,
    maxEnvelopeBytes:65536,operationTimeoutMs:20000,customTokenMaxTtlSeconds:600,
    enabledOperations:Object.fromEntries(OPS.map(op=>[op,op==='AUTH_USER_LOOKUP_FA']))});
  Object.assign(configuration.noncePolicy,{maxNonceRecords:512,maxPropertyBytes:8192,maxStorageBytes:400000,
    lockTimeoutMs:1000,retentionMs:300000});
  const h=harness({configuration}),endpoint='https://script.google.com/macros/s/'+'A'.repeat(30)+'/exec';
  const redirect='https://script.googleusercontent.com/macros/echo?user_content_key=synthetic-appscript-key';
  let contentResponse;const calls=[],claimed=new Set();
  const gateway=createManagementAppsScriptGatewayAdapter({enabled:true,endpoint,
    secretBase64Url:SECRET.toString('base64url'),policy:configuration.policy,noncePolicy:configuration.noncePolicy,
    clock:()=>h.state.time,newRequestId:()=> 'a'.repeat(32),newNonce:()=> 'b'.repeat(32),
    claimResponseNonce:async metadata=>{
      const status=claimed.has(metadata.nonce)?'REPLAY':'CLAIMED';claimed.add(metadata.nonce);
      return {...metadata,status,durable:true,atomic:true,budgetAllowed:true,capacityAllowed:true,retained:true};
    },
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      if(options.method==='POST'){
        contentResponse=h.call(JSON.parse(options.body));
        return {url,status:302,redirected:false,headers:new Headers({location:redirect}),body:null};
      }
      return {url,status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),
        body:new Response(JSON.stringify(contentResponse)).body};
    }});
  const result=await gateway.lookupAuthUser({projectId:FA,uid:'member-a'});
  assert.equal(result.users.length,1);assert.equal(result.users[0].localId,'member-a');
  assert.equal(calls.length,2);assert.equal(calls[0].options.method,'POST');assert.equal(calls[1].options.method,'GET');
  assert.equal(h.state.oauthCalls,1);assert.equal(h.state.googleCalls.length,1);assert.equal(h.state.executionLogs.length,0);
  gateway.dispose();
});

test('dedicated manifest scopes support Auth, IAM signing, external requests and read-only FA profile projection',()=>{
  assert.equal(MANIFEST.runtimeVersion,'V8');
  assert.deepEqual(new Set(MANIFEST.oauthScopes),new Set(['https://www.googleapis.com/auth/identitytoolkit',
    'https://www.googleapis.com/auth/iam','https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/datastore']));
  assert.equal(MANIFEST.executionApi,undefined);assert.equal(MANIFEST.webapp,undefined);
});

test('operational scope check remains fail-closed when a required declared scope is absent',()=>{
  const fourScopes=MANIFEST.oauthScopes.filter(scope=>scope!=='https://www.googleapis.com/auth/datastore');
  const h=harness({withoutProperties:true,declaredScopes:fourScopes});
  assert.throws(()=>h.context.mgwScopes_(),error=>error.gatewayCode==='GATEWAY_SCOPES_CHECK_FAILED');
  assert.deepEqual(h.state.scopes,MANIFEST.oauthScopes);
});

test('synthetic FB signJwt proof is isolated and returns only sanitized metadata',()=>{
  const h=harness(),beforeValues=[...h.values],beforeUser=copy(h.state.user);
  const result=h.context.provarAssinaturaIamFbSinteticaV1();
  const expected={code:'FB_IAM_SIGNJWT_SYNTHETIC_PROOF_OK',httpStatus:200,signerAlias:'FB-SA-01',
    algorithm:'RS256',syntheticClaimsMatched:true};
  assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
  assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);
  assert.equal(h.state.oauthCalls,1);assert.equal(h.state.googleCalls.length,1);
  const call=h.state.googleCalls[0];
  assert.equal(call.url,'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sahmt-fb-token-signer@sahmt-gestao-5ae66.iam.gserviceaccount.com:signJwt');
  assert.equal(call.options.followRedirects,false);assert.equal(call.options.validateHttpsCertificates,true);
  assert.deepEqual(h.state.scopes,IAM_PROOF_SCOPES);
  const payload=JSON.parse(JSON.parse(call.options.payload).payload);
  assert.equal(payload.aud,'urn:sahmt:iam-signjwt-proof:v1');assert.equal(payload.purpose,'synthetic-signature-proof');
  assert.equal(payload.exp-payload.iat,120);assert.equal(Object.hasOwn(payload,'uid'),false);
  assert.deepEqual([...h.values],beforeValues);assert.deepEqual(h.state.user,beforeUser);
  assert.equal(h.state.propertyWrites.length,0);assert.equal(h.state.propertyDeletes.length,0);
  assert.equal(JSON.stringify(result).includes('signedJwt'),false);
  assert.equal(JSON.stringify(result).includes('synthetic-oauth'),false);
});

test('synthetic FB signJwt proof stops before network when OAuth scopes need consent',()=>{
  const h=harness();h.state.scopeApproved=false;
  const result=h.context.provarAssinaturaIamFbSinteticaV1();
  const expected={code:'GATEWAY_SCOPES_REQUIRED',httpStatus:null,signerAlias:'FB-SA-01',algorithm:null,syntheticClaimsMatched:false};
  assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);
  noEffects(h);assert.equal(h.state.propertyWrites.length,0);
});

test('synthetic FB signJwt proof logs only an HTTP status on IAM failure',()=>{
  const h=harness();h.state.responseOverride=(_url,_options,reply)=>reply({error:{message:'sensitive service detail'}} ,{status:403});
  const result=h.context.provarAssinaturaIamFbSinteticaV1();
  const expected={code:'IAM_SIGNJWT_HTTP_ERROR',httpStatus:403,signerAlias:'FB-SA-01',algorithm:null,syntheticClaimsMatched:false};
  assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);
  assert.equal(h.state.executionLogs[0].includes('sensitive service detail'),false);
  assert.equal(h.state.googleCalls.length,1);assert.equal(h.state.oauthCalls,1);
});

test('synthetic FC signJwt proof is isolated to FC and returns only sanitized metadata',()=>{
  const h=harness(),beforeValues=[...h.values],beforeUser=copy(h.state.user);
  const result=h.context.provarAssinaturaIamFcSinteticaV1();
  const expected={code:'FC_IAM_SIGNJWT_SYNTHETIC_PROOF_OK',httpStatus:200,signerAlias:'FC-SA-01',
    algorithm:'RS256',syntheticClaimsMatched:true};
  assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
  assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);
  assert.equal(h.state.oauthCalls,1);assert.equal(h.state.googleCalls.length,1);
  const call=h.state.googleCalls[0];
  assert.equal(call.url,'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sahmt-fc-token-signer@indicadores---sahmt.iam.gserviceaccount.com:signJwt');
  assert.equal(call.options.followRedirects,false);assert.equal(call.options.validateHttpsCertificates,true);
  assert.deepEqual(h.state.scopes,IAM_PROOF_SCOPES);
  const payload=JSON.parse(JSON.parse(call.options.payload).payload);
  assert.equal(payload.iss,'sahmt-fc-token-signer@indicadores---sahmt.iam.gserviceaccount.com');
  assert.equal(payload.aud,'urn:sahmt:iam-signjwt-proof:fc:v1');assert.equal(payload.purpose,'synthetic-signature-proof');
  assert.equal(payload.exp-payload.iat,120);assert.equal(Object.hasOwn(payload,'uid'),false);
  assert.deepEqual([...h.values],beforeValues);assert.deepEqual(h.state.user,beforeUser);
  assert.equal(h.state.propertyWrites.length,0);assert.equal(h.state.propertyDeletes.length,0);
  assert.equal(JSON.stringify(result).includes('signedJwt'),false);
  assert.equal(JSON.stringify(result).includes('synthetic-oauth'),false);
});

test('synthetic FC signJwt proof reports OAuth consent and HTTP failures without sensitive data',async t=>{
  await t.test('scope consent',()=>{
    const h=harness();h.state.scopeApproved=false;
    const result=h.context.provarAssinaturaIamFcSinteticaV1();
    const expected={code:'GATEWAY_SCOPES_REQUIRED',httpStatus:null,signerAlias:'FC-SA-01',algorithm:null,syntheticClaimsMatched:false};
    assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);
    noEffects(h);assert.equal(h.state.propertyWrites.length,0);
  });
  await t.test('HTTP 403',()=>{
    const h=harness();h.state.responseOverride=(_url,_options,reply)=>reply({error:{message:'sensitive service detail'}},{status:403});
    const result=h.context.provarAssinaturaIamFcSinteticaV1();
    const expected={code:'IAM_SIGNJWT_HTTP_ERROR',httpStatus:403,signerAlias:'FC-SA-01',algorithm:null,syntheticClaimsMatched:false};
    assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);
    assert.equal(h.state.executionLogs[0].includes('sensitive service detail'),false);
    assert.equal(h.state.googleCalls.length,1);assert.equal(h.state.oauthCalls,1);
  });
});

test('synthetic FA signJwt proof is isolated and works with the four declared manifest scopes',()=>{
  const fourScopes=MANIFEST.oauthScopes.filter(scope=>scope!=='https://www.googleapis.com/auth/datastore');
  const h=harness({withoutProperties:true,declaredScopes:fourScopes});
  const result=h.context.provarAssinaturaIamFaSinteticaV1();
  const expected={code:'FA_IAM_SIGNJWT_SYNTHETIC_PROOF_OK',httpStatus:200,signerAlias:'FA-SA-01',
    algorithm:'RS256',syntheticClaimsMatched:true};
  assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
  assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);
  const call=h.state.googleCalls[0];
  assert.equal(call.url,'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sahmt-fa-token-signer@sahmt-17a16.iam.gserviceaccount.com:signJwt');
  assert.equal(call.options.method,'post');assert.equal(call.options.followRedirects,false);
  assert.equal(call.options.validateHttpsCertificates,true);assert.equal(call.options.timeoutSeconds,30);
  const payload=JSON.parse(JSON.parse(call.options.payload).payload);
  assert.equal(payload.iss,'sahmt-fa-token-signer@sahmt-17a16.iam.gserviceaccount.com');
  assert.equal(payload.aud,'urn:sahmt:iam-signjwt-proof:fa:v1');
  assert.equal(payload.exp-payload.iat,120);assert.equal(payload.purpose,'synthetic-signature-proof');
  assert.deepEqual(h.state.scopes,IAM_PROOF_SCOPES);
  assert.deepEqual(Object.keys(result),['code','httpStatus','signerAlias','algorithm','syntheticClaimsMatched']);
  assert.equal(JSON.stringify(result).includes('signedJwt'),false);
  assert.equal(JSON.stringify(result).includes('synthetic-oauth'),false);
  assert.equal(h.state.propertyWrites.length,0);assert.equal(h.state.propertyDeletes.length,0);
  assert.equal(h.state.googleCalls.length,1);assert.equal(h.state.oauthCalls,1);
});

test('synthetic FA signJwt proof sanitizes scope and IAM failures',async t=>{
  await t.test('scope consent',()=>{
    const h=harness({withoutProperties:true});h.state.scopeApproved=false;
    const result=h.context.provarAssinaturaIamFaSinteticaV1();
    const expected={code:'GATEWAY_SCOPES_REQUIRED',httpStatus:null,signerAlias:'FA-SA-01',algorithm:null,syntheticClaimsMatched:false};
    assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
    assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);noEffects(h);
  });
  await t.test('HTTP error body is not logged',()=>{
    const h=harness({withoutProperties:true});
    h.state.responseOverride=(_url,_options,reply)=>reply({error:{message:'private service detail'}},{status:403});
    const result=h.context.provarAssinaturaIamFaSinteticaV1();
    const expected={code:'IAM_SIGNJWT_HTTP_ERROR',httpStatus:403,signerAlias:'FA-SA-01',algorithm:null,syntheticClaimsMatched:false};
    assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
    assert.deepEqual(h.state.executionLogs.map(JSON.parse),[expected]);
    assert.equal(h.state.executionLogs[0].includes('private service detail'),false);
    assert.equal(h.state.googleCalls.length,1);assert.equal(h.state.oauthCalls,1);
  });
});

test('synthetic FA signJwt proof distinguishes pre-status failures without logging exception text',async t=>{
  const expectedFields=['code','httpStatus','signerAlias','algorithm','syntheticClaimsMatched'];
  const cases=[
    ['OAuth token retrieval','IAM_OAUTH_TOKEN_UNAVAILABLE',h=>{h.context.ScriptApp.getOAuthToken=()=>{throw Error('private oauth exception');};}],
    ['OAuth token shape','IAM_OAUTH_TOKEN_INVALID',h=>{h.state.oauthValue='invalid token with whitespace';}],
    ['UrlFetchApp.fetch','IAM_FETCH_FAILED',h=>{h.state.responseOverride=()=>{throw Error('private fetch exception with credential');};}],
    ['HTTPResponse.getResponseCode','IAM_HTTP_STATUS_UNAVAILABLE',h=>{h.state.responseOverride=(_url,_options,reply)=>{
      const response=reply({});response.getResponseCode=()=>{throw Error('private response exception');};return response;
    };}],
    ['request construction','IAM_REQUEST_BUILD_FAILED',h=>{h.context.Date.now=()=>{throw Error('private construction exception');};}]
  ];
  for(const [label,code,configure] of cases)await t.test(label,()=>{
    const h=harness({withoutProperties:true});configure(h);
    const result=h.context.provarAssinaturaIamFaSinteticaV1();
    assert.deepEqual(Object.keys(result),expectedFields);
    assert.equal(result.code,code);assert.equal(result.httpStatus,null);
    assert.equal(result.signerAlias,'FA-SA-01');assert.equal(result.algorithm,null);
    assert.equal(result.syntheticClaimsMatched,false);
    assert.deepEqual(h.state.executionLogs.map(JSON.parse),[JSON.parse(JSON.stringify(result))]);
    assert.equal(h.state.executionLogs[0].includes('private '),false);
    assert.equal(h.state.executionLogs[0].includes('credential'),false);
    assert.equal(h.state.propertyWrites.length,0);assert.equal(h.state.propertyDeletes.length,0);
    assert.equal(h.state.googleCalls.length,code==='IAM_FETCH_FAILED'||code==='IAM_HTTP_STATUS_UNAVAILABLE'?1:0);
  });
});

test('missing properties and explicit disabled gateway never obtain OAuth or mutate journal',()=>{
  for(const h of [harness({withoutProperties:true}),harness({configuration:{...config(),enabled:false}})]){
    denied(h.call(h.rawRequest()));noEffects(h);assert.equal(h.state.propertyWrites.length,0);
  }
});

test('each Auth operation remains separately disabled until explicit pinned configuration',async t=>{
  for(const operation of OPS)await t.test(operation,()=>{
    const configuration=config();configuration.policy.enabledOperations[operation]=false;
    const h=harness({configuration});denied(h.call(h.rawRequest(operation,operation==='SIGN_FB_CUSTOM_TOKEN'?signBody():operation==='SIGN_FC_CUSTOM_TOKEN'?fcSignBody():operation==='FIRST_LOGIN_FA_SIGN'?firstLoginBody():{uid:'member-a'})),'GATEWAY_DISABLED');
    noEffects(h);assert.equal(h.state.propertyWrites.length,0);
  });
});

test('FA first-login Gateway resolves source account, reads only the profile projection, and signs empty claims',()=>{
  const h=harness();h.state.user.providerUserInfo=[];
  const request=h.rawRequest('FIRST_LOGIN_FA_SIGN',firstLoginBody(),{nonce:'a'.repeat(32)});
  const result=h.call(request);
  assert.equal(result.status,'SUCCESS');assert.equal(result.body.status,'FIRST_LOGIN');assert.equal(result.body.uid,'member-a');
  assert.equal(result.body.signedJwt.split('.').length,3);
  assert.deepEqual(h.state.googleCalls.map(call=>call.options.method),['post','get','post']);
  const profileCall=h.state.googleCalls.find(call=>call.options.method==='get');
  assert.match(profileCall.url,/projects\/sahmt-17a16\/databases\/%28default%29\/documents\/users\/member-a/);
  assert.match(profileCall.url,/firstLoginCohort/);assert.equal(profileCall.options.followRedirects,false);
  const signingCall=h.state.googleCalls.at(-1);
  assert.equal(signingCall.url,'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+FA_SIGNER+':signJwt');
  const jwtPayload=JSON.parse(JSON.parse(signingCall.options.payload).payload);
  assert.equal(jwtPayload.uid,'member-a');assert.deepEqual(jwtPayload.claims,{});
  assert.equal(jwtPayload.iss,FA_SIGNER);assert.equal(jwtPayload.exp-jwtPayload.iat,300);
  assert.equal(JSON.stringify(result).includes('never-return-password-hash'),false);
  assert.equal(JSON.stringify(result).includes('never-return-salt'),false);
  assert.equal(h.state.googleCalls.every(call=>call.options.method==='get'||call.options.method==='post'),true);
  assert.equal(h.values.get(PREFIX+hash('SAHMT_MANAGEMENT_GATEWAY_V1:sahmt-management-dedicated-appscript-v1:WORKER_TO_APPS_SCRIPT\n'+'a'.repeat(32)))!==undefined,true);
});

test('FA first-login treats an omitted provider list as providerless and rejects malformed lists',()=>{
  const h=harness();const {providerUserInfo,...providerless}=h.state.user;h.state.user=providerless;
  const result=h.call(h.rawRequest('FIRST_LOGIN_FA_SIGN',firstLoginBody()));
  assert.equal(result.body.status,'FIRST_LOGIN');
  assert.equal(h.state.googleCalls.filter(call=>call.url.endsWith(':signJwt')).length,1);

  const malformed=harness();malformed.state.user.providerUserInfo=null;
  const deniedResult=malformed.call(malformed.rawRequest('FIRST_LOGIN_FA_SIGN',firstLoginBody()));
  assert.equal(deniedResult.status,'DENIED');
  assert.equal(malformed.state.googleCalls.some(call=>call.url.endsWith(':signJwt')),false);
});

test('FA first-login Gateway rejects missing or non-operational cohort and inactive access before signing',async t=>{
  for(const [name,profile] of [
    ['missing cohort',{fields:{active:{booleanValue:true},access:{booleanValue:true}}}],
    ['structural',{fields:{active:{booleanValue:true},access:{booleanValue:true},firstLoginCohort:{stringValue:'STRUCTURAL'}}}],
    ['homologation',{fields:{active:{booleanValue:true},access:{booleanValue:true},firstLoginCohort:{stringValue:'HOMOLOGATION'}}}],
    ['inactive',{fields:{active:{booleanValue:false},access:{booleanValue:true},firstLoginCohort:{stringValue:'OPERATIONAL'}}}],
    ['no access',{fields:{active:{booleanValue:true},access:{booleanValue:false},firstLoginCohort:{stringValue:'OPERATIONAL'}}}]
  ])await t.test(name,()=>{
    const h=harness();h.state.user.providerUserInfo=[];h.state.firstLoginProfile={name:'projects/sahmt-17a16/databases/(default)/documents/users/member-a',...profile};
    const result=h.call(h.rawRequest('FIRST_LOGIN_FA_SIGN',firstLoginBody()));
    assert.equal(result.status,'SUCCESS');assert.equal(result.body.status,'DENIED');
    assert.equal(result.body.code,name==='inactive'||name==='no access'?'FA_PROFILE_NOT_AUTHORIZED':'FA_ACCOUNT_NOT_IN_OPERATIONAL_COHORT');
    assert.equal(h.state.googleCalls.some(call=>call.url.endsWith(':signJwt')),false);
  });
});

test('FA first-login Gateway rejects a caller-selected UID and atomically rejects replayed Google nonce digest',()=>{
  const invalid=harness();
  denied(invalid.call(invalid.rawRequest('FIRST_LOGIN_FA_SIGN',{...firstLoginBody(),uid:'other-user'})),'GATEWAY_ADMISSION_DENIED');
  noEffects(invalid);
  const h=harness();h.state.user.providerUserInfo=[];const nonce='b'.repeat(32);
  const first=h.rawRequest('FIRST_LOGIN_FA_SIGN',firstLoginBody(),{nonce});
  assert.equal(h.call(first).body.status,'FIRST_LOGIN');
  const replay=h.call(h.rawRequest('FIRST_LOGIN_FA_SIGN',firstLoginBody(),{nonce}));
  denied(replay,'GATEWAY_REPLAY_DENIED');
  assert.equal(h.state.googleCalls.filter(call=>call.url.endsWith(':signJwt')).length,1);
});

test('configuration pins, server actor, key strength and shape fail closed before effects',async t=>{
  const variations=[
    h=>h.values.set(PIN,'0'.repeat(64)),h=>h.values.delete(KEY),h=>h.values.set(KEY,Buffer.alloc(31).toString('base64url')),
    h=>h.values.set(KEY,SECRET.toString('base64url')+'='),h=>h.state.actor='other-synthetic@example.invalid',
    h=>h.values.set(CONFIG,'not-json'),h=>h.putConfig({...config(),signerServiceAccountEmail:'management-broker@'+FA+'.iam.gserviceaccount.com'}),
    h=>h.putConfig({...config(),fcSignerServiceAccountEmail:'indicators-broker@'+FB+'.iam.gserviceaccount.com'}),
    h=>h.putConfig({...config(),policy:{...policy(),keyId:'bad+key'}}),h=>h.putConfig({...config(),extra:'unapproved'}),
    h=>h.putConfig({...config(),noncePolicy:{...config().noncePolicy,maxPropertyBytes:9216}}),
    h=>h.putConfig({...config(),noncePolicy:{...config().noncePolicy,maxStorageBytes:500001}})
  ];
  for(const change of variations)await t.test('configuration',()=>{
    const h=harness();change(h);denied(h.call(h.rawRequest()));noEffects(h);assert.equal(h.state.propertyWrites.length,0);
  });
});

test('native authorization check verifies metadata only and never activates or touches OAuth/journal',()=>{
  const h=harness({configuration:{...config(),enabled:false}}),before=[...h.values];
  const result=h.context.autorizarPonteGestaoSemChaveV1();
  assert.equal(result.ok,true);assert.equal(result.gatewayEnabled,false);assert.equal(result.operational,false);
  assert.equal(result.actorAlias,'ATOR_PONTE_GESTAO');assert.equal(result.signerAlias,'FB-SA-01+FC-SA-01');
  assert.equal(JSON.stringify(result).includes(ACTOR),false);assert.equal(JSON.stringify(result).includes(SIGNER),false);
  noEffects(h);assert.deepEqual([...h.values],before);assert.equal(h.state.propertyWrites.length,0);
  h.state.scopeApproved=false;assert.equal(h.context.autorizarPonteGestaoSemChaveV1().code,'GATEWAY_SCOPES_REQUIRED');noEffects(h);
  h.state.actor='other@example.invalid';assert.equal(h.context.autorizarPonteGestaoSemChaveV1().code,'GATEWAY_ACTOR_MISMATCH');
});

test('JSON-only POST bounds and empty query/path are required before OAuth or replay writes',async t=>{
  const variations=[
    {queryString:'token=never-accept'}, {pathInfo:'arbitrary-operation'}, {contentLength:-1},
    {contentLength:65537}, {postData:{type:'text/plain',length:1,contents:'x'}},
    {postData:{type:'application/json',length:1,contents:'{'}}, {postData:{type:'application/json',length:2,contents:'x'}}
  ];
  for(const changes of variations)await t.test('event',()=>{
    const h=harness();denied(h.call(h.rawRequest(),changes));noEffects(h);assert.equal(h.state.propertyWrites.length,0);
  });
});

test('HMAC/direction/audience/projects/IDs/body/times are checked before OAuth or journal',async t=>{
  const changes=[
    {signature:'0'.repeat(64)}, {direction:'APPS_SCRIPT_TO_WORKER'}, {audience:'another-gateway'}, {sourceProjectId:FB},
    {destinationProjectId:FA}, {operation:'CREATE_USER'}, {requestId:'a'}, {nonce:'A'.repeat(32)},
    {issuedAtMs:TIME+1}, {expiresAtMs:TIME}, {expiresAtMs:TIME+30001}, {keyId:'wrong-key'},
    {schemaVersion:2}, {extra:'unapproved'}
  ];
  for(const patch of changes)await t.test('envelope',()=>{
    const h=harness();let request=h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'member-a'},patch);
    if(patch.signature)request.signature=patch.signature;
    denied(h.call(request));noEffects(h);assert.equal(h.state.propertyWrites.length,0);
  });
  const h=harness(),request=h.rawRequest();request.body.uid='different';
  denied(h.call(request));noEffects(h);assert.equal(h.state.propertyWrites.length,0);
});

test('lookup operation refuses project, URL, e-mail, client token and extra identity authority',async t=>{
  for(const body of [{uid:'member-a',projectId:FB},{uid:'member-a',url:'https://example.invalid'},
    {uid:'member-a',email:'synthetic@example.invalid'},{uid:'member-a',idToken:'synthetic-token'},{uid:''}])
    await t.test('closed body',()=>{const h=harness();denied(h.call(h.rawRequest('AUTH_USER_LOOKUP_FA',body)));noEffects(h);});
});

test('lookup returns only REST projection and never credential/secret/private fields',async t=>{
  for(const operation of ['AUTH_USER_LOOKUP_FA','AUTH_USER_LOOKUP_FB','AUTH_USER_LOOKUP_FC'])await t.test(operation,()=>{
    const h=harness(),request=h.rawRequest(operation),response=h.call(request);
    assert.equal(response.status,'SUCCESS');const verified=h.protocol().verifyResponse(response,request);assert.equal(verified.body.users[0].localId,'member-a');
    assert.deepEqual(Object.keys(response.body.users[0]).sort(),['disabled','emailVerified','localId','providerUserInfo','validSince'].sort());
    assert.deepEqual(response.body.users[0].providerUserInfo,[{providerId:'google.com',rawId:'google-id-a'}]);
    const serialized=JSON.stringify(response);for(const marker of ['never-return','synthetic-oauth','example.invalid'])assert.equal(serialized.includes(marker),false);
    const call=h.state.googleCalls[0];assert.equal(call.url,'https://identitytoolkit.googleapis.com/v1/projects/'
      +(operation==='AUTH_USER_LOOKUP_FA'?FA:operation==='AUTH_USER_LOOKUP_FC'?FC:FB)+'/accounts:lookup');
    assert.deepEqual(JSON.parse(call.options.payload),{localId:['member-a']});
    assert.equal(call.options.followRedirects,false);assert.equal(call.options.validateHttpsCertificates,true);assert.equal(call.options.timeoutSeconds,10);
    assert.equal(call.options.headers.Authorization,'Bearer synthetic-oauth-server-only');
    assert.equal(nonceValues(h).length,1);assert.equal(h.state.lockHeld,false);
    const journal=JSON.stringify([...h.values].filter(([key])=>key!==IDENTITY_POLICY));
    for(const marker of ['member-a','google-id-a','synthetic-oauth','example.invalid','never-return'])assert.equal(journal.includes(marker),false);
  });
});

test('FA lookup returns UID-and-identity matched protected markers without returning identity data',async()=>{
  const cases=[['structural-uid','owner@example.invalid','STRUCTURAL_OWNER'],['homologation-uid-1','homologation-1@example.invalid','HOMOLOGATION_CANDIDATE_1'],
    ['homologation-uid-2','homologation-2@example.invalid','HOMOLOGATION_CANDIDATE_2']];
  for(const [uid,email,identityMarker] of cases){
    const h=harness();h.state.user.localId=uid;h.state.user.email=email;
    const request=h.rawRequest('AUTH_USER_LOOKUP_FA',{uid}),response=h.call(request);
    const user=h.protocol().verifyResponse(response,request).body.users[0];
    assert.equal(user.identityMarker,identityMarker);assert.equal(Object.hasOwn(user,'email'),false);
  }
});

test('protected FA identity blocks on missing, malformed, duplicate, or mismatched server UID configuration',async t=>{
  const cases=[
    ['missing',h=>h.values.delete(IDENTITY_POLICY),0],
    ['malformed',h=>h.values.set(IDENTITY_POLICY,'not-json'),0],
    ['duplicate uid',h=>{const p=protectedIdentityPolicy();p.identities[1].uid=p.identities[0].uid;h.values.set(IDENTITY_POLICY,JSON.stringify(p));},0],
    ['wrong UID for structural identity',h=>{h.state.user.localId='unconfirmed-uid';h.state.user.email='owner@example.invalid';},1],
    ['wrong identity for structural UID',h=>{h.state.user.localId='structural-uid';h.state.user.email='someone-else@example.invalid';},1]
  ];
  for(const [name,change,expectedAuthReads]of cases)await t.test(name,()=>{
    const h=harness();change(h);const result=h.call(h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:h.state.user.localId}));
    assert.equal(result.status,'DENIED');assert.equal(result.code,'GATEWAY_OPERATION_FAILED');
    assert.equal(h.state.googleCalls.length,expectedAuthReads);
    assert.equal(expectedAuthReads===0||h.state.googleCalls[0].url.endsWith('/accounts:lookup'),true);
    assert.equal(h.state.googleCalls.some(call=>call.url.endsWith(':signJwt')||call.url.startsWith('https://firestore.googleapis.com/')),false);
    const output=JSON.stringify(result);
    for(const sensitive of ['structural-uid','owner@example.invalid','someone-else@example.invalid'])assert.equal(output.includes(sensitive),false);
  });
});

test('FA first-login denies only the three UID-and-identity matched protected accounts',()=>{
  for(const [uid,email]of [['structural-uid','owner@example.invalid'],['homologation-uid-1','homologation-1@example.invalid'],
    ['homologation-uid-2','homologation-2@example.invalid']]){
    const h=harness();h.state.user.localId=uid;h.state.user.email=email;h.state.user.providerUserInfo=[];
    const result=h.call(h.rawRequest('FIRST_LOGIN_FA_SIGN',{...firstLoginBody(),email}));
    assert.equal(result.status,'SUCCESS');assert.deepEqual(result.body,{status:'DENIED',code:'FA_PROTECTED_IDENTITY'});
    assert.equal(h.state.googleCalls.some(call=>call.url.endsWith(':signJwt')),false);
  }
});

test('FA first-login fails closed before identity lookup when server UID policy is absent or inconsistent',()=>{
  const absent=harness({withoutIdentityPolicy:true}),absentResult=absent.call(absent.rawRequest('FIRST_LOGIN_FA_SIGN',firstLoginBody()));
  denied(absentResult,'GATEWAY_OPERATION_FAILED');assert.equal(absent.state.googleCalls.length,0);
  const bad=harness();const policy=protectedIdentityPolicy();policy.identities[2].email=policy.identities[1].email;
  bad.values.set(IDENTITY_POLICY,JSON.stringify(policy));
  denied(bad.call(bad.rawRequest('FIRST_LOGIN_FA_SIGN',firstLoginBody())),'GATEWAY_OPERATION_FAILED');
  assert.equal(bad.state.googleCalls.length,0);
});

test('missing, providerless, disabled and revoked Auth states are preserved without creating/linking accounts',()=>{
  for(const user of [null,{...rawUser(),providerUserInfo:[]},{...rawUser(),disabled:true,validSince:String(TIME/1000+1)}]){
    const h=harness();h.state.user=user;const result=h.call(h.rawRequest());assert.equal(result.status,'SUCCESS');
    assert.equal(h.state.googleCalls.length,1);assert.equal(h.state.googleCalls[0].url.endsWith('/accounts:lookup'),true);
    if(user===null)assert.deepEqual(result.body,{users:[]});else{
      assert.deepEqual(result.body.users[0].providerUserInfo,user.providerUserInfo.map(({providerId,rawId})=>({providerId,rawId})));
      assert.equal(result.body.users[0].disabled,user.disabled);
    }
  }
});

test('Auth lookup identity/provider/tenant/watermark/fields cannot become an authority by malformed data',async t=>{
  const users=[{...rawUser(),localId:'different'},{...rawUser(),tenantId:'tenant'},{...rawUser(),disabled:'false'},
    {...rawUser(),emailVerified:"invalid"},{...rawUser(),validSince:'1e3'},{...rawUser(),validSince:'9007199254740992'},
    {...rawUser(),providerUserInfo:[{providerId:'google.com',rawId:''}]},
    {...rawUser(),providerUserInfo:[{providerId:'google.com',rawId:'a'},{providerId:'google.com',rawId:'b'}]}];
  for(const user of users)await t.test('invalid user',()=>{const h=harness();h.state.user=user;denied(h.call(h.rawRequest()),'GATEWAY_RESULT_INVALID');});
  const h=harness();h.state.responseOverride=(_u,_o,reply)=>reply({users:[rawUser(),rawUser()]});denied(h.call(h.rawRequest()),'GATEWAY_RESULT_INVALID');
});

test('fresh lookups run again on each unique envelope; no user/result cache or stored custom token',()=>{
  const h=harness();const first=h.call(h.rawRequest());h.state.user={...rawUser(),disabled:true};
  const second=h.call(h.rawRequest());assert.equal(first.body.users[0].disabled,false);assert.equal(second.body.users[0].disabled,true);
  assert.equal(h.state.googleCalls.length,2);assert.equal(nonceValues(h).length,2);
});

test('nonce and request ID have independent durable uniqueness and replay survives new VM instance',()=>{
  const h=harness(),request=h.rawRequest();assert.equal(h.call(request).status,'SUCCESS');
  denied(h.call(request),'GATEWAY_REPLAY_DENIED');
  const sameId=h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'member-a'},{requestId:request.requestId});denied(h.call(sameId),'GATEWAY_REPLAY_DENIED');
  const sameNonce=h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'member-a'},{nonce:request.nonce});denied(h.call(sameNonce),'GATEWAY_REPLAY_DENIED');
  const restarted=harness({properties:h.values});denied(restarted.call(request),'GATEWAY_REPLAY_DENIED');noEffects(restarted);
  assert.equal(h.state.googleCalls.length,1);assert.equal(nonceValues(h).length,1);
});

test('expired nonce is never purged during acceptance and cannot be revived with a new deadline',()=>{
  const h=harness(),request=h.rawRequest();h.call(request);h.state.time=TIME+10001;
  denied(h.call(h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'member-a'},{nonce:request.nonce})),'GATEWAY_REPLAY_DENIED');
  assert.equal(h.state.propertyDeletes.length,0);assert.equal(nonceValues(h).length,1);assert.equal(h.state.googleCalls.length,1);
});

test('extended runtime uses compact nonce records, admits 55 two-target exchanges, and prunes only expired records',()=>{
  const h=harness();
  const cfg=copy(config());
  const runtimeOps=['READ_FA_AUTHORIZATION','READ_FB_LEASE','WRITE_FB_LEASE','INVALIDATE_FB_LEASE'];
  runtimeOps.forEach(operation=>{cfg.policy.enabledOperations[operation]=false;});
  cfg.noncePolicy.maxNonceRecords=1536;cfg.noncePolicy.maxStorageBytes=400000;
  h.putConfig(cfg);
  const configured=vm.runInContext('mgwConfiguration_()',h.context);
  const start=h.state.time;
  for(let i=0;i<1100;i++) {
    const request=h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'member-a'});
    h.context.ledgerInput={configured,requestJson:JSON.stringify(request),execution:{startedAtMs:h.state.time,maximumObservedAtMs:h.state.time}};
    vm.runInContext('mgwLedger_(ledgerInput.configured,JSON.parse(ledgerInput.requestJson),ledgerInput.execution,false)',h.context);
  }
  const journal=nonceValues(h);
  assert.equal(journal.length,1100);
  assert.ok(journal.every(([,value])=>JSON.parse(value).schemaVersion===2));
  const bytes=journal.reduce((sum,[key,value])=>sum+Buffer.byteLength(key)+Buffer.byteLength(value),0);
  assert.ok(bytes<400000);
  h.state.time=start+config().noncePolicy.retentionMs+120000;
  h.context.ledgerInput={configured,execution:{startedAtMs:h.state.time,maximumObservedAtMs:h.state.time}};
  const removed=vm.runInContext('mgwLedger_(ledgerInput.configured,null,ledgerInput.execution,true)',h.context);
  assert.equal(removed,1100);
  assert.equal(nonceValues(h).length,0);
});

test('separate maintenance only removes tombstone strictly after deadline+skew+retention',()=>{
  const configuration=config();configuration.policy.maxFutureSkewMs=1000;
  const h=harness({configuration}),request=h.rawRequest();h.call(request);
  const until=request.expiresAtMs+1000+configuration.noncePolicy.retentionMs;h.state.time=until;
  assert.equal(h.context.managementGatewayCleanupExpiredNonces_().removed,0);assert.equal(nonceValues(h).length,1);
  h.state.time++;assert.equal(h.context.managementGatewayCleanupExpiredNonces_().removed,1);assert.equal(nonceValues(h).length,0);
  assert.equal(h.state.googleCalls.length,1);assert.equal(h.state.oauthCalls,1);
});

test('journal capacity, foreign/corrupt state and absent checkpoint deny before OAuth',async t=>{
  await t.test('capacity',()=>{
    const configuration=config();configuration.noncePolicy.maxNonceRecords=1;const h=harness({configuration});
    h.call(h.rawRequest());denied(h.call(h.rawRequest()),'GATEWAY_ADMISSION_DENIED');assert.equal(h.state.googleCalls.length,1);
  });
  for(const change of [h=>h.values.set(PREFIX+'f'.repeat(64),'{}'),h=>h.values.set('FOREIGN_PROPERTY','unexpected'),
    h=>{h.call(h.rawRequest());h.values.delete(CLOCK);}])await t.test('corrupt state',()=>{
      const h=harness();change(h);const before=h.state.oauthCalls;denied(h.call(h.rawRequest()),'GATEWAY_ADMISSION_DENIED');assert.equal(h.state.oauthCalls,before);
    });
});

test('lock failure and expiry while waiting cannot obtain OAuth or start fetch',async t=>{
  for(const change of [h=>h.state.lockAvailable=false,h=>h.state.lockAdvanceMs=10000])await t.test('lock',()=>{
    const h=harness();change(h);denied(h.call(h.rawRequest()));noEffects(h);assert.equal(h.state.lockHeld,false);
  });
});

test('authenticated lock contention has a closed reason without OAuth or data disclosure',()=>{
  const h=harness();h.state.lockAvailable=false;
  const request=h.rawRequest(),response=h.call(request);
  denied(response,'GATEWAY_LOCK_BUSY');
  const accepted=h.protocol().verifyResponse(response,request);
  assert.equal(accepted.code,'GATEWAY_LOCK_BUSY');assert.equal(accepted.body,null);
  noEffects(h);assert.equal(h.state.executionLogs.length,0);
});

test('transient nonce lock contention waits in bounded slices and executes Google exactly once',()=>{
  const h=harness();let attempts=0;
  h.context.LockService.getScriptLock=()=>({tryLock(wait){h.state.locks.push(wait);
    if(++attempts<3){h.state.time+=wait;return false;}h.state.lockHeld=true;return true;},
    releaseLock(){h.state.lockHeld=false;}});
  const request=h.rawRequest(),response=h.call(request);
  assert.equal(response.code,'OK');assert.equal(h.protocol().verifyResponse(response,request).status,'SUCCESS');
  assert.equal(attempts,3);assert.equal(h.state.oauthCalls,1);assert.equal(h.state.googleCalls.length,1);
  assert.equal(nonceValues(h).length,1);assert.equal(h.state.lockHeld,false);
  denied(h.call(request),'GATEWAY_REPLAY_DENIED');assert.equal(h.state.googleCalls.length,1);
});

test('busy lock has a total admission bound and never extends request expiry',async t=>{
  for(const expiresIn of [10000,1500])await t.test(String(expiresIn),()=>{
    const h=harness();let waited=0;
    h.context.LockService.getScriptLock=()=>({tryLock(wait){h.state.locks.push(wait);waited+=wait;h.state.time+=wait;return false;},releaseLock(){}});
    const request=h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'member-a'},{expiresAtMs:TIME+expiresIn});
    const response=h.call(request);denied(response);noEffects(h);
    assert.ok(waited<=5000&&waited<expiresIn);assert.ok(h.state.locks.length<=5);
    assert.equal(nonceValues(h).length,0);
  });
});

test('write/readback failure consumes no OAuth and partial claim never reopens an ambiguous journal',async t=>{
  for(const type of ['writeFailure','badReadback'])await t.test(type,()=>{
    const h=harness();h.state[type]=PREFIX;denied(h.call(h.rawRequest()));noEffects(h);assert.equal(h.state.lockHeld,false);
    if(type==='badReadback'){assert.equal(nonceValues(h).length,1);h.state.badReadback=null;denied(h.call(h.rawRequest()));noEffects(h);}
  });
  const h=harness();h.state.writeFailure=CLOCK;denied(h.call(h.rawRequest()));noEffects(h);
  assert.equal(nonceValues(h).length,1);h.state.writeFailure=null;denied(h.call(h.rawRequest()));noEffects(h);
});

test('durable checkpoint refuses clock regression and policy/config replacement without journal handoff',()=>{
  const h=harness();h.call(h.rawRequest());h.state.time=TIME-1;
  denied(h.call(h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'member-a'},{issuedAtMs:TIME-1000,expiresAtMs:TIME+10000})),'GATEWAY_ADMISSION_DENIED');
  h.state.time=TIME+1;h.putConfig({...config(),managementPolicyVersion:'changed-policy'});
  denied(h.call(h.rawRequest()),'GATEWAY_ADMISSION_DENIED');assert.equal(h.state.googleCalls.length,1);
});

test('clock regression after nonce readback denies before obtaining OAuth',()=>{
  const h=harness();h.state.lockAdvanceMs=100;
  h.state.afterPropertyRead=(name,value)=>{if(name===CLOCK&&value!==null)h.state.time=TIME+50;};
  const response=h.call(h.rawRequest());denied(response,'GATEWAY_OPERATION_TIMEOUT');noEffects(h);
  assert.equal(nonceValues(h).length,1);assert.equal(JSON.parse(h.values.get(CLOCK)).lastObservedAtMs,TIME+100);
});

test('clock regression after fetch never delivers Auth data or provisional custom token',async t=>{
  for(const operation of ['AUTH_USER_LOOKUP_FA','SIGN_FB_CUSTOM_TOKEN','SIGN_FC_CUSTOM_TOKEN'])await t.test(operation,()=>{
    const h=harness();h.state.googleAdvanceMs=100;
    h.state.responseOverride=(_url,options,reply)=>{
      const data=operation==='SIGN_FB_CUSTOM_TOKEN'||operation==='SIGN_FC_CUSTOM_TOKEN'
        ?{keyId:'synthetic-key',signedJwt:jwt(JSON.parse(JSON.parse(options.payload).payload))}
        :{users:[rawUser()]};
      const result=reply(data);result.getResponseCode=()=>{h.state.time=TIME+50;return 200;};return result;
    };
    const body=operation==='SIGN_FB_CUSTOM_TOKEN'?signBody():operation==='SIGN_FC_CUSTOM_TOKEN'?fcSignBody():{uid:'member-a'};
    const response=h.call(h.rawRequest(operation,body));
    denied(response,'GATEWAY_OPERATION_TIMEOUT');assert.equal(h.state.googleCalls.length,1);assert.equal(h.state.oauthCalls,1);
    assert.equal(response.body,undefined);assert.equal(JSON.stringify(response).includes('signedJwt'),false);
  });
});

test('maintenance persists its high watermark before deletion and rollback never reopens removed nonce',()=>{
  const h=harness(),request=h.rawRequest();h.call(request);
  h.state.time=request.expiresAtMs+config().noncePolicy.retentionMs+1;h.state.writeFailure=CLOCK;
  assert.throws(()=>h.context.managementGatewayCleanupExpiredNonces_());assert.equal(h.state.propertyDeletes.length,0);assert.equal(nonceValues(h).length,1);
  h.state.writeFailure=null;assert.equal(h.context.managementGatewayCleanupExpiredNonces_().removed,1);
  assert.equal(JSON.parse(h.values.get(CLOCK)).lastObservedAtMs,h.state.time);
  h.state.time=TIME+100;denied(h.call(request),'GATEWAY_ADMISSION_DENIED');assert.equal(h.state.googleCalls.length,1);
});

test('closed signer assembles fixed Firebase JWT and returns provisional token only to authenticated server',()=>{
  const h=harness(),request=h.rawRequest('SIGN_FB_CUSTOM_TOKEN',signBody()),response=h.call(request);
  assert.equal(response.status,'SUCCESS');assert.equal(h.protocol().verifyResponse(response,request).body.keyId,'synthetic-key');
  const api=h.state.googleCalls[0];assert.equal(api.url,'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+SIGNER+':signJwt');
  const payload=JSON.parse(JSON.parse(api.options.payload).payload);
  assert.deepEqual(payload,{iss:SIGNER,sub:SIGNER,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat:TIME/1000,exp:TIME/1000+600,uid:'member-a',claims:claims()});
  assert.equal(Object.hasOwn(JSON.parse(api.options.payload),'delegates'),false);
  assert.equal(JSON.stringify([...h.values]).includes(response.body.signedJwt),false);
  assert.equal(JSON.stringify(response).includes('synthetic-oauth'),false);
});

test('FC signer uses its own project principal and emits only fixed FA-derived occurrence claims',()=>{
  const h=harness(),request=h.rawRequest('SIGN_FC_CUSTOM_TOKEN',fcSignBody()),response=h.call(request);
  assert.equal(response.status,'SUCCESS');
  const api=h.state.googleCalls[0];assert.equal(api.url,'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+FC_SIGNER+':signJwt');
  const payload=JSON.parse(JSON.parse(api.options.payload).payload);
  assert.deepEqual(payload,{iss:FC_SIGNER,sub:FC_SIGNER,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat:TIME/1000,exp:TIME/1000+600,uid:'member-a',claims:fcSignBody().claims});
  assert.equal(request.destinationProjectId,FC);assert.equal(JSON.stringify([...h.values]).includes(response.body.signedJwt),false);
  assert.equal(JSON.stringify(response).includes('synthetic-oauth'),false);
});

test('signer refuses arbitrary payload, signer/project/URL, reserved claims and stale/overlong times before OAuth',async t=>{
  const bodies=[
    {...signBody(),payload:'arbitrary-jwt'},{...signBody(),signerServiceAccountEmail:SIGNER},{...signBody(),projectId:FB},
    {...signBody(),url:'https://attacker.invalid'},{...signBody(),claims:{...claims(),admin:true}},
    {...signBody(),claims:{...claims(),managementPolicyVersion:'different'}},
    {...signBody(),claims:{...claims(),managementSourceProjectId:FB}},
    {...signBody(),claims:{...claims(),managementSourceAuthTimeMs:TIME+1}},
    {...signBody(),issuedAtSeconds:TIME/1000-1},{...signBody(),issuedAtSeconds:TIME/1000+1},
    {...signBody(),expiresAtSeconds:TIME/1000},{...signBody(),expiresAtSeconds:TIME/1000+601},
    {...signBody(),issuedAtSeconds:9007199254740991}
  ];
  for(const body of bodies)await t.test('sign body',()=>{const h=harness();denied(h.call(h.rawRequest('SIGN_FB_CUSTOM_TOKEN',body)));noEffects(h);assert.equal(nonceValues(h).length,0);});
});

test('FC signer rejects inherited claims and routes even invalid attempts only to FC signer',()=>{
  const h=harness();
  for(const bad of [{...fcSignBody(),claims:{admin:true}},{...fcSignBody(),claims:{managementManage:true}}]){
    denied(h.call(h.rawRequest('SIGN_FC_CUSTOM_TOKEN',bad)),'GATEWAY_ADMISSION_DENIED');
  }
  assert.equal(h.state.oauthCalls,0);assert.equal(h.state.googleCalls.length,0);
});

test('IAM result must match constructed payload/header/key and cannot add identity privilege',async t=>{
  const changes=[data=>({...data,uid:'different'}),data=>({...data,exp:data.exp+1}),data=>({...data,claims:{...data.claims,admin:true}}),
    data=>({...data,iss:'other@'+FB+'.iam.gserviceaccount.com'})];
  for(const change of changes)await t.test('payload',()=>{
    const h=harness();h.state.responseOverride=(_url,options,reply)=>reply({keyId:'synthetic-key',signedJwt:jwt(change(JSON.parse(JSON.parse(options.payload).payload)))});
    denied(h.call(h.rawRequest('SIGN_FB_CUSTOM_TOKEN',signBody())),'GATEWAY_RESULT_INVALID');
  });
  const h=harness();h.state.responseOverride=(_url,options,reply)=>reply({keyId:'other-key',signedJwt:jwt(JSON.parse(JSON.parse(options.payload).payload))});
  denied(h.call(h.rawRequest('SIGN_FB_CUSTOM_TOKEN',signBody())),'GATEWAY_RESULT_INVALID');
});

test('timeout, redirect, HTTP failure, cached or oversized/raw error responses deny without sensitive output',async t=>{
  const overrides=[
    (_u,_o,reply)=>reply('private-error-content',{status:403}),
    (_u,_o,reply)=>reply({users:[rawUser()]},{status:302}),
    (_u,_o,reply)=>reply({users:[rawUser()]},{headers:{'Content-Type':'text/html'}}),
    (_u,_o,reply)=>reply({users:[rawUser()]},{headers:{'Content-Type':'application/json',Age:'1'}}),
    (_u,_o,reply)=>reply({users:[rawUser()]},{headers:{'Content-Type':'application/json','content-type':'application/json'}}),
    (_u,_o,reply)=>reply('x'.repeat(65537)),()=>{throw Error('never-return-private-error-with-token');}
  ];
  for(const override of overrides)await t.test('API failure',()=>{
    const h=harness();h.state.responseOverride=override;const result=h.call(h.rawRequest());denied(result);
    assert.equal(JSON.stringify(result).includes('never-return'),false);assert.equal(JSON.stringify(result).includes('private-error'),false);
    assert.equal(nonceValues(h).length,1);
  });
  const h=harness();h.state.googleAdvanceMs=10000;denied(h.call(h.rawRequest()),'GATEWAY_OPERATION_TIMEOUT');assert.equal(nonceValues(h).length,1);
});

test('operationTimeout is absolute from entry even when envelope has longer TTL',()=>{
  const configuration=config();configuration.policy.operationTimeoutMs=3000;const h=harness({configuration});
  h.state.googleAdvanceMs=3000;denied(h.call(h.rawRequest()),'GATEWAY_OPERATION_TIMEOUT');
  assert.equal(h.state.googleCalls[0].options.timeoutSeconds,3);assert.equal(nonceValues(h).length,1);
});

test('subsecond remaining time refuses network instead of rounding deadline upward',()=>{
  const h=harness(),request=h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'member-a'},{expiresAtMs:TIME+999});
  denied(h.call(request),'GATEWAY_OPERATION_TIMEOUT');assert.equal(h.state.googleCalls.length,0);assert.equal(nonceValues(h).length,1);
});

test('invalid server OAuth credential is never forwarded or returned',async t=>{
  for(const token of ['', 'invalid token with whitespace', 'invalid token'])await t.test('credential',()=>{
    const h=harness();h.state.oauthValue=token;const response=h.call(h.rawRequest());denied(response);
    assert.equal(h.state.googleCalls.length,0);assert.equal(JSON.stringify(response).includes(token||'__empty_marker__'),false);
  });
});

test('UTF-8 HMAC interoperability uses signed GAS byte arrays and byte bounds',()=>{
  const h=harness();h.state.user={...rawUser(),localId:'membro-é',providerUserInfo:[{providerId:'google.com',rawId:'google-é'}]};
  const request=h.rawRequest('AUTH_USER_LOOKUP_FA',{uid:'membro-é'}),response=h.call(request);
  assert.equal(response.status,'SUCCESS');assert.equal(h.protocol().verifyResponse(response,request).body.users[0].localId,'membro-é');
});

test('canonical serializer does not invoke object/array getters and limits depth/nodes',()=>{
  const h=harness();vm.runInContext("var hits=0;var unsafe={};Object.defineProperty(unsafe,'x',{enumerable:true,get:function(){hits++;return 1;}});",h.context);
  assert.throws(()=>h.context.mgwCanonical_(h.context.unsafe));assert.equal(h.context.hits,0);
  vm.runInContext("var unsafeArray=[];Object.defineProperty(unsafeArray,'0',{enumerable:true,get:function(){hits++;return 1;}});",h.context);
  assert.throws(()=>h.context.mgwCanonical_(h.context.unsafeArray));assert.equal(h.context.hits,0);
  vm.runInContext("var deep={};var cursor=deep;for(var i=0;i<18;i++){cursor.next={};cursor=cursor.next;}",h.context);
  assert.throws(()=>h.context.mgwCanonical_(h.context.deep));
});

test('full local Auth composition: real protocol/client/adapter, GAS VM, fake redirect and synthetic Google RSA',async()=>{
  const h=harness(),protocol=h.protocol(),responseClaims=new Set(),wireCalls=[];
  const endpoint='https://script.google.com/macros/s/SYNTHETIC_DEDICATED_DEPLOYMENT_ID/exec';
  let id=50000,pendingJson=null;
  const response=(url,data,status=200,headers={})=>{
    const bytes=Buffer.from(data);let read=false;
    const reader={read:async()=>read?{done:true}:(read=true,{done:false,value:new Uint8Array(bytes)}),
      cancel:async()=>{},releaseLock:()=>{}};
    return {url,status,redirected:false,headers:new Headers({'content-type':'application/json',...headers}),
      body:{cancel:async()=>{},getReader:()=>reader}};
  };
  const client=createManagementGatewayClient({enabled:true,protocol,endpoint,clock:()=>h.state.time,
    policy:{maxRequestMs:5000,maxResponseBytes:65536,maxResponseChunks:64},
    newRequestId:()=> (++id).toString(16).padStart(32,'0'),newNonce:()=> (++id).toString(16).padStart(32,'0'),
    claimResponseNonce:async metadata=>{
      const token=metadata.namespace+':'+metadata.nonce;
      assert.equal(responseClaims.has(token),false);responseClaims.add(token);
      return {...metadata,status:'CLAIMED',durable:true,atomic:true,budgetAllowed:true,capacityAllowed:true,retained:true};
    },
    fetchImpl:async(url,options)=>{
      wireCalls.push({url,options});
      if(url===endpoint){pendingJson=JSON.stringify(h.call(JSON.parse(options.body)));
        return response(url,'',302,{location:'https://script.googleusercontent.com/macros/echo?user_content_key=synthetic_key&lib=synthetic_library'});}
      assert.equal(url.startsWith('https://script.googleusercontent.com/macros/echo?'),true);
      assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,undefined);
      return response(url,pendingJson);
    }});
  const certCalls=[];
  const adapter=createManagementGoogleAuthAdapter({enabled:true,privilegedGateway:client,signerServiceAccountEmail:SIGNER,fcSignerServiceAccountEmail:FC_SIGNER,clock:()=>h.state.time,
    policy:{operationTimeoutMs:5000,maxResponseBytes:65536,maxResponseChunks:64,maxKeyCacheMs:60000,maxFutureSkewMs:0,
      maxIdTokenLifetimeSeconds:3600,customTokenLifetimeSeconds:600},
    fetchImpl:async(url,options)=>{
      certCalls.push({url,options});assert.equal(options.headers.Authorization,undefined);
      return response(url,JSON.stringify({'synthetic-key':publicPem}),200,{'cache-control':'public, max-age=60'});
    }});
  const faToken=jwt({sub:'member-a',aud:FA,iss:'https://securetoken.google.com/'+FA,iat:TIME/1000-10,exp:TIME/1000+3590,
    auth_time:TIME/1000-50,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['google-id-a']}}});
  assert.equal((await adapter.verifyFaIdToken(faToken,true)).uid,'member-a');
  assert.equal((await adapter.getFaUser({uid:'member-a',projectId:FA})).user.googleUid,'google-id-a');
  assert.equal((await adapter.getFbUser({uid:'member-a',projectId:FB})).user.uid,'member-a');
  assert.equal((await adapter.getFcUser({uid:'member-a',projectId:FC})).user.uid,'member-a');
  const token=await adapter.createFbCustomToken('member-a',claims());
  assert.equal(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).uid,'member-a');
  const fcToken=await adapter.createFcCustomToken('member-a');
  assert.deepEqual(JSON.parse(Buffer.from(fcToken.split('.')[1],'base64url')),
    {iss:FC_SIGNER,sub:FC_SIGNER,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat:TIME/1000,exp:TIME/1000+600,uid:'member-a',claims:fcSignBody().claims});
  assert.equal(h.state.googleCalls.length,6);assert.equal(responseClaims.size,6);assert.equal(nonceValues(h).length,6);
  assert.equal(certCalls.length,3);assert.equal(wireCalls.length,12);
  assert.equal(JSON.stringify(wireCalls).includes('synthetic-oauth-server-only'),false);
  assert.equal(JSON.stringify([...h.values]).includes(token),false);assert.equal(JSON.stringify([...h.values]).includes(fcToken),false);
  h.state.user={...rawUser(),disabled:true};
  await assert.rejects(adapter.verifyFaIdToken(faToken,true),error=>error.code==='FA_AUTH_USER_DISABLED_OR_UNVERIFIED');
  h.state.user=null;
  await assert.rejects(adapter.getFbUser({uid:'member-a',projectId:FB}),error=>error.code==='AUTH_USER_MISSING_OR_AMBIGUOUS');
  for(const call of h.state.googleCalls)assert.equal(/\/accounts:lookup$|:signJwt$/.test(call.url),true);
  adapter.dispose();client.dispose();protocol.dispose();
});
