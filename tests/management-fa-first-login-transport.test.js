import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementFaFirstLoginTransport} from '../src/management-fa-first-login-transport.js';

const url='https://auth-broker.example.workers.dev/v1/auth/first-login';
const input={googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)};
function response(status,body,{headers={},redirected=false,responseUrl=url}={}){
  const result=new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
  Object.defineProperties(result,{url:{value:responseUrl},redirected:{value:redirected}});return result;
}
const transport=(fetchImpl,changes={})=>createManagementFaFirstLoginTransport({enabled:true,endpoint:url,
  allowedBrokerOrigins:['https://auth-broker.example.workers.dev'],fetchImpl,...changes});

test('first-login transport is explicit and default-off',async()=>{
  const disabled=createManagementFaFirstLoginTransport();
  await assert.rejects(disabled.claimFirstLogin(input),error=>error.code==='FIRST_LOGIN_TRANSPORT_DISABLED');
});

test('transport posts only Google ID token and nonce over fixed HTTPS endpoint without ambient credentials',async()=>{
  let observed;
  const client=transport(async(target,options)=>{observed={target,options,body:JSON.parse(options.body)};
    return response(200,{ok:true,status:'FIRST_LOGIN',uid:'fa-user-001',customToken:'synthetic-fa-custom-token'});});
  assert.deepEqual(await client.claimFirstLogin(input),{status:'FIRST_LOGIN',uid:'fa-user-001',customToken:'synthetic-fa-custom-token'});
  assert.equal(observed.target,url);assert.equal(observed.options.method,'POST');assert.equal(observed.options.redirect,'error');
  assert.equal(observed.options.credentials,'omit');assert.equal(observed.options.cache,'no-store');
  assert.deepEqual(observed.body,input);assert.equal(observed.options.headers.Authorization,undefined);
});

test('transport returns only safe denial categories and rejects unexpected response fields',async()=>{
  const denial=transport(async()=>response(403,{ok:false,status:'DENIED',code:'FA_ACCOUNT_NOT_IN_OPERATIONAL_COHORT'}));
  assert.deepEqual(await denial.claimFirstLogin(input),{status:'DENIED',code:'FA_ACCOUNT_NOT_IN_OPERATIONAL_COHORT'});
  const extra=transport(async()=>response(200,{ok:true,status:'FIRST_LOGIN',uid:'fa-user-001',customToken:'synthetic-token',email:'private@example.invalid'}));
  await assert.rejects(extra.claimFirstLogin(input),error=>error.code==='FIRST_LOGIN_RESPONSE_INVALID');
});

test('transport rejects redirects, cacheable responses and non-JSON payloads',async t=>{
  for(const [name,factory] of [
    ['redirect',()=>transport(async()=>response(200,{ok:true},{redirected:true}))],
    ['cache',()=>transport(async()=>response(200,{ok:true},{headers:{'cache-control':'public'}}))],
    ['text',()=>transport(async()=>response(200,{ok:true},{headers:{'content-type':'text/plain'}}))]
  ])await t.test(name,async()=>await assert.rejects(factory().claimFirstLogin(input),error=>error.code==='FIRST_LOGIN_RESPONSE_REJECTED'));
});

test('caller abort and network failures never return a token',async t=>{
  await t.test('abort',async()=>{
    const client=transport((_target,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})));
    const controller=new AbortController();const pending=client.claimFirstLogin(input,{signal:controller.signal});controller.abort();
    await assert.rejects(pending,error=>['FIRST_LOGIN_REQUEST_ABORTED','FIRST_LOGIN_REQUEST_TIMEOUT'].includes(error.code));
  });
  await t.test('network',async()=>{
    const client=transport(async()=>{throw Error('private network detail');});
    await assert.rejects(client.claimFirstLogin(input),error=>error.code==='FIRST_LOGIN_TRANSPORT_FAILED'&&!error.message.includes('private'));
  });
});
