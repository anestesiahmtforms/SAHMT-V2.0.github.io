import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash, createHmac, generateKeyPairSync, sign} from 'node:crypto';
import {createManagementGatewayProtocol, gatewayCanonicalJson} from '../scripts/lib/management-gateway-protocol.js';
import {createManagementGatewayClient} from '../scripts/lib/management-gateway-client.js';
import {createManagementGoogleAuthAdapter} from '../scripts/lib/management-google-auth-adapter.js';

const SOURCE=fs.readFileSync(new URL('../apps-script-management-gateway/Gateway.gs',import.meta.url),'utf8');
const MANIFEST=JSON.parse(fs.readFileSync(new URL('../apps-script-management-gateway/appsscript.json',import.meta.url),'utf8'));
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',TIME=1800000000000,VERSION='SAHMT_MANAGEMENT_GATEWAY_V1';
const AUDIENCE='sahmt-management-dedicated-appscript-v1',SIGNER='management-broker@'+FB+'.iam.gserviceaccount.com';
const SECRET=Buffer.alloc(32,71),ACTOR='synthetic-gateway-owner@example.invalid';
const CONFIG='MANAGEMENT_GATEWAY_CONFIG_JSON',PIN='MANAGEMENT_GATEWAY_CONFIG_SHA256',KEY='MANAGEMENT_GATEWAY_HMAC_SECRET_BASE64URL';
const CLOCK='MGW_CLOCK_V1',PREFIX='MGW_NONCE_V1_';
const OPS=['AUTH_USER_LOOKUP_FA','AUTH_USER_LOOKUP_FB','SIGN_FB_CUSTOM_TOKEN'];
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
const config=()=>({schemaVersion:1,enabled:true,actorEmailSha256:hash(ACTOR),signerServiceAccountEmail:SIGNER,
  managementPolicyVersion:'synthetic-management-policy',maxGoogleResponseBytes:65536,policy:policy(),
  noncePolicy:{maxNonceRecords:32,maxPropertyBytes:8192,maxStorageBytes:100000,lockTimeoutMs:1000,retentionMs:300000}});
const claims=()=>({managementSourceProjectId:FA,managementMemberId:'stable-member-a',managementSourceVersion:3,
  managementSourceHash:'a'.repeat(64),managementPolicyVersion:'synthetic-management-policy',managementSourceAuthTimeMs:TIME-50000});
const signBody=()=>({uid:'member-a',claims:claims(),issuedAtSeconds:TIME/1000,expiresAtSeconds:TIME/1000+600});
const rawUser=()=>({localId:'member-a',email:'synthetic-private-email@example.invalid',displayName:'never-return-name',
  emailVerified:true,disabled:false,validSince:String(TIME/1000-100),providerUserInfo:[
    {providerId:'google.com',rawId:'google-id-a',email:'private-provider@example.invalid',displayName:'never-return-provider-name'}],
  passwordHash:'never-return-password-hash',salt:'never-return-salt',customAttributes:'never-return-private-claims'});

function harness({configuration=config(),properties,withoutProperties=false}={}){
  const values=properties||new Map();
  const state={time:TIME,configuration:copy(configuration),values,actor:ACTOR,scopeApproved:true,lockAvailable:true,lockHeld:false,
    lockAdvanceMs:0,oauthCalls:0,googleCalls:[],propertyWrites:[],propertyDeletes:[],locks:[],user:rawUser(),
    responseOverride:null,writeFailure:null,badReadback:null,googleAdvanceMs:0,oauthValue:'synthetic-oauth-server-only'};
  const putConfig=next=>{
    state.configuration=copy(next);values.set(CONFIG,JSON.stringify(next));values.set(PIN,hash(gatewayCanonicalJson(next)));
    values.set(KEY,SECRET.toString('base64url'));
  };
  if(!withoutProperties&&!properties)putConfig(configuration);
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
      getAuthorizationInfo:(_mode,scopes)=>{state.scopes=Array.from(scopes);return {getAuthorizationStatus:()=>state.scopeApproved?'NOT_REQUIRED':'REQUIRED'};},
      getOAuthToken:()=>{state.oauthCalls++;return state.oauthValue;}},
    LockService:{getScriptLock:()=>({tryLock:wait=>{state.locks.push(wait);state.time+=state.lockAdvanceMs;
      if(!state.lockAvailable||state.lockHeld)return false;state.lockHeld=true;return true;},
      releaseLock:()=>{state.lockHeld=false;}})},
    UrlFetchApp:{fetch:(url,options)=>{
      state.googleCalls.push({url,options:copy(options)});state.time+=state.googleAdvanceMs;
      if(state.responseOverride)return state.responseOverride(url,options,googleResponse);
      if(url.endsWith('/accounts:lookup'))return googleResponse({users:state.user===null?[]:[state.user],unexpectedPrivate:'never-return-top-level'});
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
      direction:'WORKER_TO_APPS_SCRIPT',sourceProjectId:FA,destinationProjectId:FB,operation,
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

test('dedicated manifest is Auth-only; no datastore, existing script or execution deployment',()=>{
  assert.equal(MANIFEST.runtimeVersion,'V8');
  assert.deepEqual(new Set(MANIFEST.oauthScopes),new Set(['https://www.googleapis.com/auth/identitytoolkit',
    'https://www.googleapis.com/auth/iam','https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/userinfo.email']));
  assert.equal(MANIFEST.executionApi,undefined);assert.equal(MANIFEST.webapp,undefined);
});

test('missing properties and explicit disabled gateway never obtain OAuth or mutate journal',()=>{
  for(const h of [harness({withoutProperties:true}),harness({configuration:{...config(),enabled:false}})]){
    denied(h.call(h.rawRequest()));noEffects(h);assert.equal(h.state.propertyWrites.length,0);
  }
});

test('each Auth operation remains separately disabled until explicit pinned configuration',async t=>{
  for(const operation of OPS)await t.test(operation,()=>{
    const configuration=config();configuration.policy.enabledOperations[operation]=false;
    const h=harness({configuration});denied(h.call(h.rawRequest(operation,operation==='SIGN_FB_CUSTOM_TOKEN'?signBody():{uid:'member-a'})),'GATEWAY_DISABLED');
    noEffects(h);assert.equal(h.state.propertyWrites.length,0);
  });
});

test('configuration pins, server actor, key strength and shape fail closed before effects',async t=>{
  const variations=[
    h=>h.values.set(PIN,'0'.repeat(64)),h=>h.values.delete(KEY),h=>h.values.set(KEY,Buffer.alloc(31).toString('base64url')),
    h=>h.values.set(KEY,SECRET.toString('base64url')+'='),h=>h.state.actor='other-synthetic@example.invalid',
    h=>h.values.set(CONFIG,'not-json'),h=>h.putConfig({...config(),signerServiceAccountEmail:'management-broker@'+FA+'.iam.gserviceaccount.com'}),
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
  assert.equal(result.actorAlias,'ATOR_PONTE_GESTAO');assert.equal(result.signerAlias,'FB-SA-01');
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
  for(const operation of ['AUTH_USER_LOOKUP_FA','AUTH_USER_LOOKUP_FB'])await t.test(operation,()=>{
    const h=harness(),request=h.rawRequest(operation),response=h.call(request);
    assert.equal(response.status,'SUCCESS');const verified=h.protocol().verifyResponse(response,request);assert.equal(verified.body.users[0].localId,'member-a');
    assert.deepEqual(Object.keys(response.body.users[0]).sort(),['disabled','emailVerified','localId','providerUserInfo','validSince'].sort());
    assert.deepEqual(response.body.users[0].providerUserInfo,[{providerId:'google.com',rawId:'google-id-a'}]);
    const serialized=JSON.stringify(response);for(const marker of ['never-return','synthetic-oauth','example.invalid'])assert.equal(serialized.includes(marker),false);
    const call=h.state.googleCalls[0];assert.equal(call.url,'https://identitytoolkit.googleapis.com/v1/projects/'
      +(operation==='AUTH_USER_LOOKUP_FA'?FA:FB)+'/accounts:lookup');
    assert.deepEqual(JSON.parse(call.options.payload),{localId:['member-a']});
    assert.equal(call.options.followRedirects,false);assert.equal(call.options.validateHttpsCertificates,true);assert.equal(call.options.timeoutSeconds,10);
    assert.equal(call.options.headers.Authorization,'Bearer synthetic-oauth-server-only');
    assert.equal(nonceValues(h).length,1);assert.equal(h.state.lockHeld,false);
    const journal=JSON.stringify([...h.values]);for(const marker of ['member-a','google-id-a','synthetic-oauth','example.invalid','never-return'])assert.equal(journal.includes(marker),false);
  });
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
    {...rawUser(),emailVerified:undefined},{...rawUser(),validSince:'1e3'},{...rawUser(),validSince:'9007199254740992'},
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
  for(const operation of ['AUTH_USER_LOOKUP_FA','SIGN_FB_CUSTOM_TOKEN'])await t.test(operation,()=>{
    const h=harness();h.state.googleAdvanceMs=100;
    h.state.responseOverride=(_url,options,reply)=>{
      const data=operation==='SIGN_FB_CUSTOM_TOKEN'
        ?{keyId:'synthetic-key',signedJwt:jwt(JSON.parse(JSON.parse(options.payload).payload))}
        :{users:[rawUser()]};
      const result=reply(data);result.getResponseCode=()=>{h.state.time=TIME+50;return 200;};return result;
    };
    const response=h.call(h.rawRequest(operation,operation==='SIGN_FB_CUSTOM_TOKEN'?signBody():{uid:'member-a'}));
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
  for(const token of ['', 'three.part.jwt', 'invalid token'])await t.test('credential',()=>{
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
  const adapter=createManagementGoogleAuthAdapter({enabled:true,privilegedGateway:client,signerServiceAccountEmail:SIGNER,clock:()=>h.state.time,
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
  const token=await adapter.createFbCustomToken('member-a',claims());
  assert.equal(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).uid,'member-a');
  assert.equal(h.state.googleCalls.length,4);assert.equal(responseClaims.size,4);assert.equal(nonceValues(h).length,4);
  assert.equal(certCalls.length,2);assert.equal(wireCalls.length,8);
  assert.equal(JSON.stringify(wireCalls).includes('synthetic-oauth-server-only'),false);
  assert.equal(JSON.stringify([...h.values]).includes(token),false);
  h.state.user={...rawUser(),disabled:true};
  await assert.rejects(adapter.verifyFaIdToken(faToken,true),error=>error.code==='FA_AUTH_USER_DISABLED_OR_UNVERIFIED');
  h.state.user=null;
  await assert.rejects(adapter.getFbUser({uid:'member-a',projectId:FB}),error=>error.code==='AUTH_USER_MISSING_OR_AMBIGUOUS');
  for(const call of h.state.googleCalls)assert.equal(/\/accounts:lookup$|:signJwt$/.test(call.url),true);
  adapter.dispose();client.dispose();protocol.dispose();
});
