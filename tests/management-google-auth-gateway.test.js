import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {createManagementGoogleAuthAdapter} from '../scripts/lib/management-google-auth-adapter.js';

const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', TIME = 1800000000000, SECONDS = TIME / 1000;
const SIGNER = 'management-broker@' + FB + '.iam.gserviceaccount.com';
const FA_CERTS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const IAM_CERTS = 'https://www.googleapis.com/service_accounts/v1/metadata/x509/' + SIGNER;
const IAM_URL = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + SIGNER + ':signJwt';
const AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const keyA = generateKeyPairSync('rsa', {modulusLength: 2048}), keyB = generateKeyPairSync('rsa', {modulusLength: 2048});
const publicPem = key => key.publicKey.export({type: 'spki', format: 'pem'});
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload, header = {alg: 'RS256', kid: 'key-a', typ: 'JWT'}, key = keyA) => {
  const body = encode(header) + '.' + encode(payload);
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), key.privateKey).toString('base64url');
};
const payload = () => ({sub: 'member-a', user_id: 'member-a', aud: FA, iss: 'https://securetoken.google.com/' + FA,
  auth_time: SECONDS - 50, iat: SECONDS - 10, exp: SECONDS + 3590, email_verified: true,
  firebase: {sign_in_provider: 'google.com', identities: {'google.com': ['google-id-a']}}});
const claims = () => ({managementSourceProjectId: FA, managementMemberId: 'stable-a', managementSourceVersion: 7,
  managementSourceHash: 'a'.repeat(64), managementPolicyVersion: 'test-policy', managementSourceAuthTimeMs: TIME - 50000});
const policy = () => ({operationTimeoutMs: 1000, maxResponseBytes: 65536, maxResponseChunks: 128,
  maxKeyCacheMs: 60000, maxFutureSkewMs: 0, maxIdTokenLifetimeSeconds: 3600, customTokenLifetimeSeconds: 600});
const user = () => ({localId: 'member-a', email: 'private-synthetic@example.invalid', emailVerified: true,
  disabled: false, validSince: String(SECONDS - 100), providerUserInfo: [{providerId: 'google.com', rawId: 'google-id-a'}],
  customAttributes: '{"admin":true}', passwordHash: 'never-return-hash', salt: 'never-return-salt'});
function response(url, data, {headers = {}, status = 200, body, redirected = false} = {}) {
  const bytes = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data)); let delivered = false;
  return {url, status, redirected, headers: new Headers({'content-type': 'application/json', ...headers}), body: body || {
    getReader: () => ({read: async () => delivered ? {done: true} : (delivered = true, {done: false, value: bytes}),
      cancel: async () => {}, releaseLock: () => {}})}};
}
function harness({fetchOverride, credentialOverride, suppliedPolicy = policy(), signer = SIGNER, enabled = true} = {}) {
  let time = TIME;
  const calls = [], credentials = [], state = {keys: {'key-a': publicPem(keyA)}, lookupUser: user(), signedKey: keyA, signedKid: 'key-a'};
  const fetchImpl = async (url, options) => {
    calls.push({url, options}); if (fetchOverride) return fetchOverride(url, options, state);
    if (url === FA_CERTS || url === IAM_CERTS) return response(url, state.keys, {headers: {'cache-control': 'public, max-age=60'}});
    if (url.includes('/accounts:lookup')) return response(url, {users: [state.lookupUser]});
    if (url === IAM_URL) { const signedPayload = JSON.parse(JSON.parse(options.body).payload);
      return response(url, {keyId: state.signedKid, signedJwt: jwt(signedPayload, {alg: 'RS256', kid: state.signedKid, typ: 'JWT'}, state.signedKey)}); }
    throw new Error('Unexpected synthetic endpoint');
  };
  const adapter = createManagementGoogleAuthAdapter({enabled, fetchImpl, signerServiceAccountEmail: signer,
    policy: suppliedPolicy, clock: () => time, getAdminAccessToken: async (request, context) => {
      credentials.push({request, context}); const value = {credentialType: 'google-oauth2', accessToken: 'opaque-server-oauth-access',
        expiresAtMs: time + 600000, scopes: request.scopes}; return credentialOverride ? credentialOverride(value, request, context) : value;
    }});
  return {adapter, calls, credentials, state, advance: milliseconds => { time += milliseconds; }};
}
const errorCode = (promise, code) => assert.rejects(promise, error => error.code === code && error.message === code);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };


function gatewayHarness({overrides = {}, adapterOptions = {}, policyOverride} = {}) {
  let time = TIME;
  const calls = [], state = {user: {localId:'member-a',emailVerified:true,disabled:false,validSince:String(SECONDS-100),
    providerUserInfo:[{providerId:'google.com',rawId:'google-id-a'}]}};
  const privilegedGateway = {
    lookupAuthUser: async (request, context) => {calls.push(['lookup',request,context]);return {users:[state.user]};},
    signFbCustomToken: async (request, context) => {calls.push(['sign',request,context]);return {keyId:'key-a',signedJwt:jwt({
      iss:SIGNER,sub:SIGNER,aud:AUD,uid:request.uid,claims:request.claims,iat:request.issuedAtSeconds,exp:request.expiresAtSeconds})};},
    ...overrides
  };
  const adapter=createManagementGoogleAuthAdapter({enabled:true,privilegedGateway,signerServiceAccountEmail:SIGNER,
    policy:policyOverride||policy(),clock:()=>time,fetchImpl:async(url,options)=>{
      calls.push(['public',url,options]);assert.ok(url===FA_CERTS||url===IAM_CERTS);
      assert.equal(options.headers.Authorization,undefined);
      return response(url,{'key-a':publicPem(keyA)},{headers:{'cache-control':'public, max-age=60'}});
    },...adapterOptions});
  return {adapter,calls,state,advance:ms=>{time+=ms;}};
}

test('dedicated gateway keeps administrative OAuth away from Worker; current lookup every verification',async()=>{
  const h=gatewayHarness();for(let i=0;i<2;i++)assert.equal((await h.adapter.verifyFaIdToken(jwt(payload()),true)).uid,'member-a');
  assert.equal(h.calls.filter(c=>c[0]==='lookup').length,2);assert.equal(h.calls.filter(c=>c[0]==='public').length,1);
  for(const [,request,context]of h.calls.filter(c=>c[0]==='lookup')){
    assert.deepEqual(request,{projectId:FA,uid:'member-a'});assert.ok(context.signal instanceof AbortSignal);assert.ok(context.deadlineMs>TIME);
  }
});

test('gateway normalizes both projects and strips Auth attributes',async()=>{
  const h=gatewayHarness();const fa=await h.adapter.getFaUser({projectId:FA,uid:'member-a'});
  const fb=await h.adapter.getFbUser({projectId:FB,uid:'member-a'});
  assert.equal(fa.user.googleUid,'google-id-a');assert.equal(fb.projectId,FB);assert.equal(fb.fromCache,false);
  assert.equal(Object.hasOwn(fb.user,'providerUserInfo'),false);assert.equal(Object.hasOwn(fb.user,'email'),false);
  assert.deepEqual(h.calls.filter(c=>c[0]==='lookup').map(c=>c[1].projectId),[FA,FB]);
});

test('gateway signing retains exact expected JWT and RSA verification',async()=>{
  const h=gatewayHarness();const token=await h.adapter.createFbCustomToken('member-a',claims());
  const data=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  assert.deepEqual(data,{iss:SIGNER,sub:SIGNER,aud:AUD,iat:SECONDS,exp:SECONDS+600,uid:'member-a',claims:claims()});
  const request=h.calls.find(c=>c[0]==='sign')[1];assert.deepEqual(Object.keys(request).sort(),['claims','expiresAtSeconds','issuedAtSeconds','uid']);
  assert.equal(h.calls.some(c=>c[0]==='lookup'),false);
});

test('gateway and administrative credential modes are mutually exclusive before effects',async t=>{
  for(const adapterOptions of [{getAdminAccessToken:async()=>{throw Error('Never called');}},
    {privilegedGateway:null},{privilegedGateway:{}},{privilegedGateway:{lookupAuthUser:async()=>({users:[]})}}])await t.test('closed configuration',async()=>{
    const h=gatewayHarness({adapterOptions});await errorCode(h.adapter.getFbUser({projectId:FB,uid:'member-a'}),'GOOGLE_AUTH_ADAPTER_CONFIG_INVALID');
    assert.equal(h.calls.length,0);
  });
});

test('default disable blocks gateway and public fetch',async()=>{
  const h=gatewayHarness({adapterOptions:{enabled:false}});await errorCode(h.adapter.createFbCustomToken('member-a',claims()),'GOOGLE_AUTH_ADAPTER_DISABLED');assert.equal(h.calls.length,0);
});

test('gateway lookup rejects private or administrative extra fields',async t=>{
  for(const field of ['email','passwordHash','salt','customAttributes','accessToken'])await t.test(field,async()=>{
    const h=gatewayHarness();h.state.user={...h.state.user,[field]:'synthetic-sensitive'};
    await errorCode(h.adapter.getFbUser({projectId:FB,uid:'member-a'}),'GATEWAY_LOOKUP_RESPONSE_INVALID');
  });
});

test('gateway lookup malformed response, ambiguous or missing user and provider extras never authorize',async t=>{
  for(const data of [{users:[]},{users:[user(),user()]},{users:[{localId:'other',emailVerified:true,providerUserInfo:[]}]},
    {users:[],accessToken:'opaque'},{users:[{localId:'member-a',emailVerified:true,providerUserInfo:[{providerId:'google.com',rawId:'google-id-a',email:'synthetic'}]}]}])
    await t.test('rejected',async()=>{const h=gatewayHarness({overrides:{lookupAuthUser:async()=>data}});await assert.rejects(h.adapter.getFbUser({projectId:FB,uid:'member-a'}));});
});

test('gateway data rejects getters and non-data prototypes without evaluating getter',async t=>{
  let evaluated=false;const getter={};Object.defineProperty(getter,'users',{enumerable:true,get(){evaluated=true;throw Error('Never');}});
  for(const data of [getter,Object.assign(Object.create({unsafe:true}),{users:[]}),{users:new Array(1)}])await t.test('unsafe',async()=>{
    const h=gatewayHarness({overrides:{lookupAuthUser:async()=>data}});await errorCode(h.adapter.getFbUser({projectId:FB,uid:'member-a'}),'GATEWAY_DATA_INVALID');
  });assert.equal(evaluated,false);
});

test('gateway lookup preserves disabled and revocation denials',async t=>{
  for(const change of [{disabled:true},{emailVerified:false},{validSince:String(SECONDS)},{providerUserInfo:[{providerId:'google.com',rawId:'changed'}]}])
    await t.test('denied',async()=>{const h=gatewayHarness();Object.assign(h.state.user,change);await assert.rejects(h.adapter.verifyFaIdToken(jwt(payload()),true));});
});

test('gateway signer refuses extra credentials, altered claims/UID/times/signer and false RSA signature',async t=>{
  const expected={iss:SIGNER,sub:SIGNER,aud:AUD,iat:SECONDS,exp:SECONDS+600,uid:'member-a',claims:claims()};
  for(const data of [{keyId:'key-a',signedJwt:jwt(expected),accessToken:'opaque'},
    {keyId:'key-a',signedJwt:jwt({...expected,uid:'other'})},{keyId:'key-a',signedJwt:jwt({...expected,iat:SECONDS-1})},
    {keyId:'key-a',signedJwt:jwt({...expected,claims:{...claims(),admin:true}})},
    {keyId:'key-a',signedJwt:jwt({...expected,iss:'other'})},
    {keyId:'key-a',signedJwt:jwt(expected,{alg:'RS256',kid:'key-a'},keyB)}])await t.test('signature denied',async()=>{
      const h=gatewayHarness({overrides:{signFbCustomToken:async()=>data}});await assert.rejects(h.adapter.createFbCustomToken('member-a',claims()));
    });
});

test('gateway hangs, raw errors and caller cancellation return only static errors',async t=>{
  await t.test('timeout',async()=>{const h=gatewayHarness({policyOverride:{...policy(),operationTimeoutMs:20},overrides:{lookupAuthUser:()=>new Promise(()=>{})}});
    await errorCode(h.adapter.getFbUser({projectId:FB,uid:'member-a'}),'GOOGLE_AUTH_TIMEOUT');});
  await t.test('sanitized',async()=>{const h=gatewayHarness({overrides:{lookupAuthUser:async()=>{throw Error('synthetic secret must not return');}}});
    await errorCode(h.adapter.getFbUser({projectId:FB,uid:'member-a'}),'GOOGLE_AUTH_ADAPTER_FAILED');});
  await t.test('abort',async()=>{const controller=new AbortController();controller.abort();const h=gatewayHarness();
    await errorCode(h.adapter.getFbUser({projectId:FB,uid:'member-a'},{signal:controller.signal}),'GOOGLE_AUTH_ABORTED');assert.equal(h.calls.length,0);});
});

test('gateway response arriving after disposal cannot return a user or token',async()=>{
  const waiting=deferred();const h=gatewayHarness({overrides:{lookupAuthUser:()=>waiting.promise}});
  const task=h.adapter.getFbUser({projectId:FB,uid:'member-a'});await new Promise(resolve=>setImmediate(resolve));h.adapter.dispose();
  await errorCode(task,'GOOGLE_AUTH_ABORTED');waiting.resolve({users:[h.state.user]});
});


test('malformed context signals deny with static errors before any gateway effect',async()=>{
  const h=gatewayHarness();await errorCode(h.adapter.getFbUser({projectId:FB,uid:'member-a'},{signal:{aborted:false}}),'GOOGLE_AUTH_CONTEXT_INVALID');assert.equal(h.calls.length,0);
});
test('throwing cleanup cannot replace a sanitized gateway error',async()=>{
  const signal={aborted:false,addEventListener(){},removeEventListener(){throw Error('synthetic-sensitive cleanup');}};
  const h=gatewayHarness({overrides:{lookupAuthUser:async()=>{throw Error('synthetic-sensitive lookup');}}});
  await errorCode(h.adapter.getFbUser({projectId:FB,uid:'member-a'},{signal}),'GOOGLE_AUTH_ADAPTER_FAILED');
});
