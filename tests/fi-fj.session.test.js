import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationalModuleSession} from '../src/operational-module-session.js';

function fixture({signInDelay, exchangeError, claimsOverride, station = 'FJ'} = {}) {
  let clock = 1800000000000, listener;
  const timers = new Map(), calls = {exchange: 0, signIn: 0, signOut: 0};
  const source = uid => ({uid, getIdToken: async () => 'synthetic-fa-proof-' + uid});
  const projectId = station === 'FH' ? 'sahmt-etiquetas-fh' : 'sahmt-escala-fj';
  const faAuth = {currentUser: source('alice')}, targetAuth = {currentUser: null, app: {options: {projectId}}};
  const session = createOperationalModuleSession({station, faAuth, targetAuth,
    subscribeSource: callback => {listener = callback; return () => {listener = null;};},
    exchange: async ({faUid, faIdToken}) => {
      calls.exchange++; assert.equal(faIdToken, 'synthetic-fa-proof-' + faUid);
      if (exchangeError) throw Error('synthetic-provider-body-must-not-escape');
      return {uid: faUid, customToken: 'synthetic-custom-token', expiresIn: 300};
    },
    signIn: async () => {
      calls.signIn++; const uid = faAuth.currentUser?.uid;
      if (signInDelay) await signInDelay;
      const user = {uid, getIdTokenResult: async () => ({claims: {
        aud: projectId, sub: uid, sourceProjectId: 'sahmt-17a16', moduleStation: station,
        firebase: {sign_in_provider: 'custom'}, moduleLeaseExpiresAt: Math.floor(clock / 1000) + 300, ...claimsOverride
      }})};
      targetAuth.currentUser = user; return {user};
    },
    signOut: async auth => {calls.signOut++; auth.currentUser = null;},
    now: () => clock, setTimer: (callback, delay) => {const id = Symbol(); timers.set(id, {callback, delay}); return id;},
    clearTimer: id => timers.delete(id)
  });
  return {session, calls, timers, faAuth, targetAuth, source,
    advance: milliseconds => {clock += milliseconds;},
    changeSource: user => {faAuth.currentUser = user; listener?.(user);}};
}

test('module sessions reuse only an unexpired lease for the exact FA user and renew before expiry', async () => {
  const f = fixture();
  assert.equal((await f.session.ensure('alice')).uid, 'alice');
  assert.equal((await f.session.ensure('alice')).uid, 'alice');
  assert.equal(f.calls.exchange, 1);
  assert.equal(f.timers.size, 1);
  const renewal = [...f.timers.values()].find(timer => timer.delay === 240000);
  assert.ok(renewal);
  f.advance(240000); await renewal.callback();
  assert.equal(f.calls.exchange, 2);
  await f.session.dispose();
  assert.equal(f.targetAuth.currentUser, null);
});

test('FH sessions preserve the central UID and refuse other module or expired leases',async()=>{
  const f=fixture({station:'FH'});assert.equal((await f.session.ensure('alice')).uid,'alice');f.changeSource(null);await assert.rejects(f.session.ensure('alice'),/MODULE_SOURCE_SESSION_REQUIRED/);await f.session.dispose();assert.equal(f.targetAuth.currentUser,null);
  for(const claimsOverride of [{aud:'sahmt-17a16'},{moduleStation:'FI'},{moduleLeaseExpiresAt:1}]){
    const denied=fixture({station:'FH',claimsOverride});await assert.rejects(denied.session.ensure('alice'),/MODULE_SESSION_INVALID/);assert.equal(denied.targetAuth.currentUser,null);await denied.session.dispose();
  }
});

test('FA signout clears the module session and rejects reuse', async () => {
  const f = fixture(); await f.session.ensure('alice'); f.changeSource(null);
  await assert.rejects(f.session.ensure('alice'), /MODULE_SOURCE_SESSION_REQUIRED/);
  await f.session.dispose();
  assert.equal(f.targetAuth.currentUser, null);
  assert.equal(f.timers.size, 0);
});

test('a late custom signin cannot survive a source switch or erase the newer module session', async () => {
  let release; const f = fixture({signInDelay: new Promise(resolve => {release = resolve;})});
  const old = f.session.ensure('alice');
  for (let tries = 0; tries < 30 && !f.calls.signIn; tries++) await Promise.resolve();
  assert.equal(f.calls.signIn, 1);
  f.changeSource(f.source('bob'));
  const next = f.session.ensure('bob');
  release();
  await assert.rejects(old, /MODULE_SOURCE_SESSION_CHANGED/);
  assert.equal((await next).uid, 'bob');
  assert.equal(f.targetAuth.currentUser.uid, 'bob');
  await f.session.dispose();
});

test('exchange errors reveal no provider body and never sign into a destination', async () => {
  const f = fixture({exchangeError: true});
  await assert.rejects(f.session.ensure('alice'), error => error.code === 'MODULE_SESSION_UNAVAILABLE' && !error.message.includes('provider'));
  assert.equal(f.calls.signIn, 0);
  await f.session.dispose();
});

test('a timed-out SDK signin completes its cleanup before a new FA account enters the module', async () => {
  let release; const f = fixture({signInDelay: new Promise(resolve => {release = resolve;})});
  const old = f.session.ensure('alice');
  const rejected = assert.rejects(old, /MODULE_SESSION_TIMEOUT/);
  for (let tries = 0; tries < 30 && !f.calls.signIn; tries++) await Promise.resolve();
  assert.equal(f.calls.signIn, 1);
  [...f.timers.values()].find(timer => timer.delay === 20000).callback(); await rejected;
  f.changeSource(f.source('bob')); const next = f.session.ensure('bob'); release();
  assert.equal((await next).uid, 'bob'); assert.equal(f.targetAuth.currentUser.uid, 'bob');
  await f.session.dispose();
});

test('wrong module, UID or lease claims cannot establish a destination session', async () => {
  for (const claimsOverride of [{moduleStation: 'FI'}, {sub: 'other'}, {moduleLeaseExpiresAt: 1},
    {moduleLeaseExpiresAt: 1900000000}, {firebase: {sign_in_provider: 'google.com'}}]) {
    const f = fixture({claimsOverride});
    await assert.rejects(f.session.ensure('alice'), /MODULE_SESSION_INVALID/);
    assert.equal(f.targetAuth.currentUser, null); await f.session.dispose();
  }
});
