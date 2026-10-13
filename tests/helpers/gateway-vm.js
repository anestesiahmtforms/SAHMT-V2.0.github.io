import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash, createHmac, generateKeyPairSync, sign} from 'node:crypto';
import {createManagementGatewayProtocol, gatewayCanonicalJson} from '../../scripts/lib/management-gateway-protocol.js';
import {createManagementGatewayClient} from '../../scripts/lib/management-gateway-client.js';
import {createManagementGoogleAuthAdapter} from '../../scripts/lib/management-google-auth-adapter.js';
import {createManagementAppsScriptGatewayAdapter} from '../../worker-management-auth/apps-script-gateway-adapter.js';

const SOURCE=fs.readFileSync(new URL('../../apps-script-management-gateway/Gateway.gs',import.meta.url),'utf8');
const MANIFEST=JSON.parse(fs.readFileSync(new URL('../../apps-script-management-gateway/appsscript.json',import.meta.url),'utf8'));
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
const publicJwk=keyPair.publicKey.export({format:'jwk'});
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
const fcSignBody=()=>({uid:'member-a',claims:{},issuedAtSeconds:TIME/1000,expiresAtSeconds:TIME/1000+600});
const firstLoginBody=()=>({email:'synthetic-private-email@example.invalid',googleSub:'google-id-a',issuedAtSeconds:TIME/1000,expiresAtSeconds:TIME/1000+300});
const protectedIdentityPolicy=()=>({schemaVersion:1,identities:[
  {marker:'STRUCTURAL_OWNER',uid:'structural-uid',email:'owner@example.invalid'},
  {marker:'HOMOLOGATION_CANDIDATE_1',uid:'homologation-uid-1',email:'homologation-1@example.invalid'},
  {marker:'HOMOLOGATION_CANDIDATE_2',uid:'homologation-uid-2',email:'homologation-2@example.invalid'}]});
const rawUser=()=>({localId:'member-a',email:'synthetic-private-email@example.invalid',displayName:'never-return-name',
  emailVerified:true,disabled:false,validSince:String(TIME/1000-100),providerUserInfo:[
    {providerId:'google.com',rawId:'google-id-a',email:'private-provider@example.invalid',displayName:'never-return-provider-name'}],
  passwordHash:'never-return-password-hash',salt:'never-return-salt',customAttributes:'never-return-private-claims'});

export function harness({configuration=config(),properties,withoutProperties=false,withoutIdentityPolicy=false,
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

export {jwt,publicPem,publicJwk,rawUser,SECRET,ACTOR,TIME,FA,FB,FC};
