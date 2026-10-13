import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementGatewayProtocol, MANAGEMENT_GATEWAY_PROTOCOL_VERSION, MANAGEMENT_GATEWAY_AUDIENCE,
  MANAGEMENT_GATEWAY_OPERATIONS} from '../scripts/lib/management-gateway-protocol.js';
import {createManagementAppsScriptGatewayAdapter, createManagementAppsScriptGatewayFromEnv}
  from '../worker-management-auth/apps-script-gateway-adapter.js';

const TIME=1800000000000,FA='sahmt-17a16',FB='sahmt-gestao-5ae66',FC='indicadores---sahmt';
const ENDPOINT='https://script.google.com/macros/s/'+'A'.repeat(30)+'/exec';
const REDIRECT='https://script.googleusercontent.com/macros/echo?user_content_key=synthetic-content-key';
const secret=new Uint8Array(32).fill(23), secretText=Buffer.from(secret).toString('base64url');
const policy={schemaVersion:1,protocolVersion:MANAGEMENT_GATEWAY_PROTOCOL_VERSION,audience:MANAGEMENT_GATEWAY_AUDIENCE,
  keyId:'sahmt-appscript-gateway-hmac-v1',maximumTtlMs:20000,maxFutureSkewMs:5000,maxEnvelopeBytes:65536,
  operationTimeoutMs:20000,customTokenMaxTtlSeconds:600,
  enabledOperations:Object.fromEntries(MANAGEMENT_GATEWAY_OPERATIONS.map(operation=>[operation,false]))};
const testPolicy={...policy,enabledOperations:{...policy.enabledOperations,AUTH_USER_LOOKUP_FA:true}};
const noncePolicy={maxNonceRecords:512,maxPropertyBytes:8192,maxStorageBytes:400000,lockTimeoutMs:1000,retentionMs:300000};

function response(url,data,{status=200,headers={},stream,redirected=false}={}) {
  return {url,status,redirected,headers:new Headers({'content-type':'application/json',...headers}),
    body:stream||new Response(JSON.stringify(data)).body};
}
function serverHarness({responseSecret=secret,mutateResponse,delayClock,failClaim=false}={}) {
  let time=TIME;const requestNonces=new Set(),clientNonceClaims=new Set(),calls=[];
  const server=createManagementGatewayProtocol({policy:testPolicy,secret:responseSecret,now:()=>time,monotonicNow:()=>time-TIME});
  const claimResponseNonce=async metadata=>{
    if(failClaim)throw new Error('synthetic private nonce storage detail');
    if(clientNonceClaims.has(metadata.nonce))return {...metadata,status:'REPLAY',durable:true,atomic:true,budgetAllowed:true,capacityAllowed:true,retained:true};
    clientNonceClaims.add(metadata.nonce);
    return {...metadata,status:'CLAIMED',durable:true,atomic:true,budgetAllowed:true,capacityAllowed:true,retained:true};
  };
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(options.method==='POST'){
      if(requestNonces.has(JSON.parse(options.body).nonce))return response(url,{ok:false},{status:403});
      const request=JSON.parse(options.body);requestNonces.add(request.nonce);
      server.verifyRequest(request);
      server.createResponse(request,{status:'SUCCESS',code:'OK',body:{users:[]}});
      if(delayClock)time+=delayClock;
      return response(url,null,{status:302,headers:{location:REDIRECT}});
    }
    const request=JSON.parse(calls[0].options.body),signed=server.createResponse(request,{status:'SUCCESS',code:'OK',body:{users:[]}});
    const payload=mutateResponse?mutateResponse(signed):signed;
    return response(url,payload);
  };
  const adapter=createManagementAppsScriptGatewayAdapter({enabled:true,endpoint:ENDPOINT,secretBase64Url:secretText,
    policy:testPolicy,noncePolicy,claimResponseNonce,fetchImpl,clock:()=>time,monotonicClock:()=>time-TIME,
    newRequestId:()=> 'a'.repeat(32),newNonce:()=> 'b'.repeat(32)});
  return {adapter,calls,clientNonceClaims,dispose(){adapter.dispose();server.dispose();}};
}

const rejected=(promise,code)=>assert.rejects(promise,error=>error.code===code&&error.message===code);

test('server-side adapter completes Apps Script POST, allowlisted ContentService redirect GET, and signed response verification',async()=>{
  const h=serverHarness();
  assert.deepEqual(await h.adapter.lookupAuthUser({projectId:FA,uid:'uid-synthetic'}),{users:[]});
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[0].options.method,'POST');assert.equal(h.calls[0].options.redirect,'manual');
  assert.equal(h.calls[0].options.credentials,'omit');assert.equal(h.calls[0].options.referrerPolicy,'no-referrer');
  assert.equal(Object.hasOwn(h.calls[0].options.headers,'Authorization'),false);
  assert.equal(h.calls[1].options.method,'GET');assert.equal(h.calls[1].options.body,undefined);
  assert.equal(h.calls[1].options.redirect,'manual');assert.deepEqual(h.calls[1].options.headers,{Accept:'application/json'});
  h.dispose();
});

test('default-off environment adapter makes no outbound request even without URL, policy or HMAC secret',async()=>{
  let calls=0;const gateway=createManagementAppsScriptGatewayFromEnv({env:{},fetchImpl:async()=>{calls++;}});
  assert.equal(gateway.enabled,false);
  await rejected(gateway.lookupAuthUser({projectId:FA,uid:'uid-synthetic'}),'GATEWAY_CLIENT_DISABLED');
  await rejected(gateway.lookupAuthUser({projectId:FB,uid:'uid-synthetic'}),'GATEWAY_CLIENT_DISABLED');
  await rejected(gateway.lookupAuthUser({projectId:FC,uid:'uid-synthetic'}),'GATEWAY_CLIENT_DISABLED');
  assert.equal(calls,0);
});

test('all six production operation flags disabled reject locally before transport',async()=>{
  let calls=0;const gateway=createManagementAppsScriptGatewayAdapter({enabled:true,endpoint:ENDPOINT,secretBase64Url:secretText,
    policy,noncePolicy,claimResponseNonce:async()=>({}),fetchImpl:async()=>{calls++;}});
  await rejected(gateway.lookupAuthUser({projectId:FA,uid:'uid-synthetic'}),'GATEWAY_CLIENT_DISABLED');
  await rejected(gateway.signFbCustomToken({uid:'uid-synthetic'}),'GATEWAY_CLIENT_DISABLED');
  await rejected(gateway.signFcCustomToken({uid:'uid-synthetic'}),'GATEWAY_CLIENT_DISABLED');
  await rejected(gateway.authorizeAndSignFaFirstLogin({email:'synthetic@example.test'}),'GATEWAY_CLIENT_DISABLED');
  assert.equal(calls,0);gateway.dispose();
});

test('invalid destination and configuration fail closed without network calls',async()=>{
  let calls=0;const h=serverHarness();
  await rejected(h.adapter.lookupAuthUser({projectId:'untrusted-project',uid:'uid-synthetic'}),'GATEWAY_LOOKUP_REQUEST_INVALID');
  await rejected(Promise.resolve().then(()=>createManagementAppsScriptGatewayAdapter({enabled:true,endpoint:ENDPOINT,
    secretBase64Url:'too-short',policy:testPolicy,claimResponseNonce:async()=>{},fetchImpl:async()=>{calls++;}})),'GATEWAY_SECRET_INVALID');
  await rejected(Promise.resolve().then(()=>createManagementAppsScriptGatewayAdapter({enabled:true,endpoint:ENDPOINT,
    secretBase64Url:secretText,policy:{...testPolicy,maxFutureSkewMs:4000},claimResponseNonce:async()=>{},fetchImpl:async()=>{calls++;}})),'GATEWAY_POLICY_INVALID');
  await rejected(Promise.resolve().then(()=>createManagementAppsScriptGatewayFromEnv({env:{MANAGEMENT_GATEWAY_ENABLED:'true'},fetchImpl:async()=>{calls++;}})),'GATEWAY_CONFIG_INVALID');
  assert.equal(calls,0);h.dispose();
});

test('tampered HMAC response is rejected without returning its body or details',async()=>{
  const h=serverHarness({mutateResponse:value=>({...value,signature:'f'.repeat(64)})});
  await rejected(h.adapter.lookupAuthUser({projectId:FA,uid:'uid-synthetic'}),'GATEWAY_CLIENT_UNAVAILABLE');
  assert.equal(h.calls.length,2);assert.equal(JSON.stringify(h.calls).includes(secretText),false);h.dispose();
});

test('expired operation deadline aborts before a delayed Apps Script response can be accepted',async()=>{
  const h=serverHarness({delayClock:20000});
  await rejected(h.adapter.lookupAuthUser({projectId:FA,uid:'uid-synthetic'}),'GATEWAY_DEADLINE_EXCEEDED');
  assert.equal(h.calls.length,1);assert.equal(h.clientNonceClaims.size,0);h.dispose();
});

test('reused request nonce is refused by the synthetic Gateway on the second POST',async()=>{
  const h=serverHarness();
  await h.adapter.lookupAuthUser({projectId:FA,uid:'uid-synthetic'});
  await rejected(h.adapter.lookupAuthUser({projectId:FA,uid:'uid-synthetic'}),'GATEWAY_HTTP_RESPONSE_INVALID');
  assert.equal(h.calls.filter(call=>call.options.method==='POST').length,2);h.dispose();
});

test('response nonce storage failure denies the signed result and hides private storage detail',async()=>{
  const h=serverHarness({failClaim:true});
  await rejected(h.adapter.lookupAuthUser({projectId:FA,uid:'uid-synthetic'}),'GATEWAY_CLIENT_UNAVAILABLE');
  assert.equal(h.calls.length,2);h.dispose();
});

test('network failure is converted to a fixed safe error code',async()=>{
  const h=serverHarness();h.adapter.dispose();
  const gateway=createManagementAppsScriptGatewayAdapter({enabled:true,endpoint:ENDPOINT,secretBase64Url:secretText,
    policy:testPolicy,noncePolicy,claimResponseNonce:async()=>{},fetchImpl:async()=>{throw new Error('secret-bearing transport detail');},
    clock:()=>TIME,monotonicClock:()=>0,newRequestId:()=> 'c'.repeat(32),newNonce:()=> 'd'.repeat(32)});
  await rejected(gateway.lookupAuthUser({projectId:FA,uid:'uid-synthetic'}),'GATEWAY_CLIENT_UNAVAILABLE');gateway.dispose();
});
