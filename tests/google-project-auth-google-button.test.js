import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleProjectAuthGoogleButton} from '../src/google-project-auth-google-button.js';

const clientId = '123-test.apps.googleusercontent.com';
const expected = () => ({uid:'firebase-person', googleUid:'google-person'});
const jwt = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const deferred = () => { let resolve; return {promise:new Promise(r => {resolve=r;}), resolve:value => resolve(value)}; };
function fixture({loaded=true, timeout=30, consume} = {}) {
  const scripts=[], calls=[], credentials=[], errors=[], loadings=[], window={};
  const document={head:{appendChild:script => scripts.push(script)}, createElement:tag => ({tag, remove() {this.removed=true;}})};
  const container={replacements:0, replaceChildren() {this.replacements++;}};
  let primary=expected(), counter=0, configuration;
  const api={initialize:options => {calls.push('initialize');configuration=options;},
    renderButton:(node,options) => {calls.push('render');node.button=options;}, prompt:() => {throw Error('One Tap forbidden');}};
  const install=() => {window.google={accounts:{id:api}};};
  if (loaded) install();
  const options={clientId,document,window,loadTimeoutMs:timeout,randomId:() => 'random-'+(++counter),now:() => 1000000,
    getExpectedIdentity:() => primary,onCredential:async (...args) => {credentials.push(args);await consume?.(...args);},
    onLoading:value => loadings.push(value),onError:error => errors.push(error.code)};
  const factory=createGoogleProjectAuthGoogleButton(options);
  const respond=async (claims={},response={}) => {
    const token=jwt({iss:'https://accounts.google.com',aud:clientId,sub:'google-person',exp:2000,nonce:configuration.nonce,...claims});
    configuration.callback({state:container.button.state,credential:token,...response});
    await new Promise(resolve => setImmediate(resolve));
    return token;
  };
  return {factory,options,container,window,document,scripts,calls,credentials,errors,loadings,install,respond,
    get configuration(){return configuration;},setPrimary:value => {primary=value;}};
}

test('official button initializes once and only delivers after a real click callback', async () => {
  const f=fixture();const cleanup=await f.factory.render(f.container);
  assert.equal(f.configuration.auto_select,false);assert.equal(f.configuration.button_auto_select,false);
  assert.equal(f.configuration.ux_mode,'popup');assert.equal(f.container.button.text,'continue_with');
  await f.respond();assert.equal(f.credentials.length,0);
  f.container.button.click_listener();const token=await f.respond();
  assert.deepEqual(f.credentials,[[{providerId:'google.com',idToken:token},expected()]]);
  assert.deepEqual(f.loadings,[true,false,true,false]);
  await f.respond();assert.equal(f.credentials.length,1);
  cleanup();await f.respond();assert.equal(f.credentials.length,1);
});

test('concurrent renders share one loader, callback dispatcher and initialization', async () => {
  const f=fixture({loaded:false}),second={replaceChildren(){}};
  const first=f.factory.render(f.container),duplicate=f.factory.render(f.container),other=f.factory.render(second);
  assert.equal(first,duplicate);assert.equal(f.scripts.length,1);
  assert.equal(f.scripts[0].src,'https://accounts.google.com/gsi/client');
  f.install();f.scripts[0].onload();await Promise.all([first,other]);
  assert.deepEqual(f.calls,['initialize','render','render']);
  f.factory.dispose();
});

test('wrong audience, Google subject, issuer, nonce and expiry never reach Firebase caller', async () => {
  const f=fixture();await f.factory.render(f.container);
  for (const claims of [{aud:'another-client'},{sub:'another-google'},{iss:'https://securetoken.google.com/project'},
    {nonce:'another-nonce'},{exp:999},{exp:'2000'}]) {
    f.container.button.click_listener();await f.respond(claims);
  }
  assert.equal(f.credentials.length,0);
  assert.equal(f.errors[0],'AUTH_AUDIENCE_NOT_VERIFIED');
  assert.ok(f.errors.slice(1).every(code=>code==='AUTH_GOOGLE_IDENTITY_MISMATCH'));
  f.factory.dispose();
});

test('Google script preserves the origin with the documented localhost referrer policy', async () => {
  for(const [protocol,hostname,policy] of [['http:','localhost','no-referrer-when-downgrade'],['http:','127.0.0.1','no-referrer-when-downgrade'],['https:','anestesiahmtforms.github.io','strict-origin-when-cross-origin']]){
    const f=fixture({loaded:false});f.window.location={protocol,hostname};
    const rendering=f.factory.render(f.container);
    assert.equal(f.scripts[0].referrerPolicy,policy);
    f.install();f.scripts[0].onload();await rendering;f.factory.dispose();
  }
});

test('source account switch or logout during Google interaction rejects the response', async () => {
  for (const next of [null,{uid:'other',googleUid:'google-person'},{uid:'firebase-person',googleUid:'other-google'}]) {
    const f=fixture();await f.factory.render(f.container);f.container.button.click_listener();f.setPrimary(next);
    await f.respond();assert.equal(f.credentials.length,0);assert.deepEqual(f.errors,['AUTH_ACCOUNT_CHANGED']);f.factory.dispose();
  }
});

test('unknown button state, disposed button and late response cannot reach the caller', async () => {
  const f=fixture();const cleanup=await f.factory.render(f.container);f.container.button.click_listener();
  await f.respond({}, {state:'old-button'});assert.equal(f.credentials.length,0);
  cleanup();await f.respond();assert.equal(f.credentials.length,0);assert.deepEqual(f.errors,[]);
});

test('duplicate response while caller is pending does not duplicate credential use', async () => {
  const gate=deferred(),f=fixture({consume:() => gate.promise});await f.factory.render(f.container);
  f.container.button.click_listener();await f.respond();f.container.button.click_listener();await f.respond();
  assert.equal(f.credentials.length,1);assert.equal(f.loadings.at(-1),true);
  gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.loadings.at(-1),false);f.factory.dispose();
});

test('closing Google without a response leaves the button retryable and no busy timer', async () => {
  const f=fixture();await f.factory.render(f.container);f.container.button.click_listener();
  assert.deepEqual(f.loadings,[true,false]);assert.deepEqual(f.errors,[]);assert.equal(f.credentials.length,0);
  f.container.button.click_listener();await f.respond();assert.equal(f.credentials.length,1);f.factory.dispose();
});

test('script timeout permits only explicit retry and ignores the late old load handler', async () => {
  const f=fixture({loaded:false,timeout:5});const first=f.factory.render(f.container),late=f.scripts[0].onload;
  await assert.rejects(first,{code:'AUTH_GOOGLE_SCRIPT_TIMEOUT'});
  assert.equal(f.scripts.length,1);assert.equal(f.scripts[0].removed,true);assert.equal(f.scripts[0].onload,null);
  const retry=f.factory.render(f.container);assert.equal(f.scripts.length,2);
  late();assert.deepEqual(f.calls,[]);f.install();f.scripts[1].onload();await retry;
  assert.deepEqual(f.calls,['initialize','render']);f.factory.dispose();
});

test('script error and unavailable API are sanitized and do not retry automatically', async () => {
  for(const event of ['onerror','onload']) {
    const f=fixture({loaded:false});const rendering=f.factory.render(f.container);f.scripts[0][event]();
    await assert.rejects(rendering,{code:event==='onerror'?'AUTH_GOOGLE_SCRIPT_UNAVAILABLE':'AUTH_GOOGLE_SCRIPT_INVALID'});
    assert.equal(f.scripts.length,1);assert.equal(f.credentials.length,0);assert.deepEqual(f.loadings,[true,false]);
  }
});

test('dispose during loading cancels its last loader and suppresses callbacks', async () => {
  const f=fixture({loaded:false});const rendering=f.factory.render(f.container);f.factory.dispose();
  await assert.rejects(rendering,{code:'AUTH_GOOGLE_BUTTON_DISPOSED'});
  assert.equal(f.scripts[0].removed,true);assert.deepEqual(f.errors,[]);assert.deepEqual(f.loadings,[true,false]);
  await assert.rejects(f.factory.render(f.container),{code:'AUTH_GOOGLE_BUTTON_DISPOSED'});
});

test('missing source and malformed responses are rejected without exposing payloads', async () => {
  const f=fixture();await f.factory.render(f.container);f.setPrimary(null);f.container.button.click_listener();
  await f.respond();assert.deepEqual(f.errors,['AUTH_SOURCE_REQUIRED']);f.setPrimary(expected());
  f.container.button.click_listener();await f.respond({}, {credential:'private-invalid-token'});
  assert.equal(f.errors.at(-1),'AUTH_GOOGLE_IDENTITY_MISMATCH');assert.equal(f.credentials.length,0);f.factory.dispose();
});

test('consumer failure does not leak raw error and a subsequent click can retry', async () => {
  const f=fixture({consume:() => {throw Error('private-server-data');}});await f.factory.render(f.container);
  f.container.button.click_listener();await f.respond();assert.deepEqual(f.errors,['AUTH_UNAVAILABLE']);
  f.container.button.click_listener();await f.respond();assert.equal(f.credentials.length,2);f.factory.dispose();
});

test('cleanup allows a fresh button while retaining the one GIS initialization', async () => {
  const f=fixture();const cleanup=await f.factory.render(f.container);const oldState=f.container.button.state;
  cleanup();await f.factory.render(f.container);assert.notEqual(f.container.button.state,oldState);
  assert.equal(f.calls.filter(call=>call==='initialize').length,1);f.factory.dispose();
});
