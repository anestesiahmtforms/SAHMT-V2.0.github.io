import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirebaseProjectAuthCoordinator} from '../src/firebase-project-auth.js';
import {FIREBASE_PROJECTS} from '../src/firebase-projects.js';

const FA = FIREBASE_PROJECTS.FA.projectId, FB = FIREBASE_PROJECTS.FB.projectId, FC = FIREBASE_PROJECTS.FC.projectId;
const makeTargets = () => Object.fromEntries(['FB', 'FC'].map(name => [name, {auth: {
  app: {options: {projectId: FIREBASE_PROJECTS[name].projectId}}, currentUser: null
}, signOut: async auth => { auth.currentUser = null; }}]));
const tokenResponse = (faUid = 'same-uid') => ({schemaVersion: 1, sourceProjectId: FA, faUid, targets: {
  FB: {status: 'READY', projectId: FB, uid: faUid, customToken: 'fb-private-token'},
  FC: {status: 'READY', projectId: FC, uid: faUid, customToken: 'fc-private-token'}
}});

test('disabled coordinator performs no token request or secondary sign-in', async () => {
  let calls = 0;
  const coordinator = createFirebaseProjectAuthCoordinator({broker: {exchangeTargets: async () => { calls++; }}});
  assert.equal(coordinator.enabled, false);
  assert.deepEqual(await coordinator.connect(), {status: 'disabled'});
  assert.equal(calls, 0);
});

test('one FA proof requests target-specific FB and FC tokens once, then signs in both independently', async () => {
  const targets = makeTargets(), signs = [], requests = [];
  const faUser = {uid: 'same-uid', getIdToken: async force => { assert.equal(force, true); return 'fa-id-token'; }};
  const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth: {currentUser: faUser}, targets,
    broker: {exchangeTargets: async request => { requests.push(request); return tokenResponse(); }},
    signInWithCustomToken: async (auth, token) => {
      signs.push(token); const user = {uid: 'same-uid'}; auth.currentUser = user; return {user};
    }, now: () => 1000, timeoutMs: 1000});
  const result = await coordinator.connect();
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.targets, {FB: {status: 'ready', projectId: FB, uid: 'same-uid'}, FC: {status: 'ready', projectId: FC, uid: 'same-uid'}});
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sourceProjectId, FA);
  assert.deepEqual(requests[0].targetProjectIds, {FB, FC});
  assert.deepEqual(signs.sort(), ['fb-private-token', 'fc-private-token']);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

test('coordinator accepts an explicit allowlisted target subset for staged expansion', async () => {
  const targets = makeTargets(), faUser = {uid: 'same-uid', getIdToken: async () => 'fa-id-token'};
  let request;
  const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth: {currentUser: faUser}, targets,
    targetNames: ['FC'], broker: {exchangeTargets: async value => {
      request = value;
      return {schemaVersion: 1, sourceProjectId: FA, faUid: faUser.uid, targets: {
        FC: {status: 'READY', projectId: FC, uid: faUser.uid, customToken: 'fc-only-token'}
      }};
    }}, signInWithCustomToken: async (auth, token) => {
      assert.equal(token, 'fc-only-token'); const user = {uid: faUser.uid}; auth.currentUser = user; return {user};
    }, now: () => 1000, timeoutMs: 1000});
  assert.equal((await coordinator.connect()).status, 'ready');
  assert.deepEqual(request.targetProjectIds, {FC});
  assert.equal(targets.FB.auth.currentUser, null);
});

test('coordinator can request FC alone while FB is configured but has no login attempt', async () => {
  const targets=makeTargets(),faUser={uid:'same-uid',getIdToken:async()=> 'fa-id-token'};let request;const signed=[];
  const coordinator=createFirebaseProjectAuthCoordinator({enabled:true,faAuth:{currentUser:faUser},targets,
    broker:{exchangeTargets:async value=>{request=value;return {schemaVersion:1,sourceProjectId:FA,faUid:faUser.uid,targets:{
      FC:{status:'READY',projectId:FC,uid:faUser.uid,customToken:'fc-only-token'}}};}},
    signInWithCustomToken:async(auth,token)=>{signed.push(token);const user={uid:faUser.uid};auth.currentUser=user;return {user};},now:()=>1000,timeoutMs:1000});
  const result=await coordinator.connect(['FC']);
  assert.equal(result.status,'ready');assert.deepEqual(request.targetProjectIds,{FC});assert.deepEqual(signed,['fc-only-token']);
  assert.equal(targets.FB.auth.currentUser,null);assert.equal(targets.FC.auth.currentUser.uid,'same-uid');
});

test('FC failure does not sign out or block a successful FB session', async () => {
  const targets = makeTargets();
  targets.FC.auth.app.options.projectId = 'wrong-project';
  const faUser = {uid: 'same-uid', getIdToken: async () => 'fa-id-token'};
  const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth: {currentUser: faUser}, targets,
    broker: {exchangeTargets: async () => tokenResponse()},
    signInWithCustomToken: async (auth, token) => { const user = {uid: 'same-uid', token}; auth.currentUser = user; return {user}; },
    now: () => 1000, timeoutMs: 1000});
  const result = await coordinator.connect();
  assert.equal(result.status, 'partial');
  assert.equal(result.targets.FB.status, 'ready');
  assert.deepEqual(result.targets.FC, {status: 'unavailable', code: 'TARGET_AUTH_UNAVAILABLE'});
  assert.equal(targets.FB.auth.currentUser.uid, 'same-uid');
  assert.equal(faUser.uid, 'same-uid');
});

test('FC sign-in timeout is isolated and preserves FA and the successful FB session', async () => {
  const targets = makeTargets(), faUser = {uid: 'same-uid', getIdToken: async () => 'fa-id-token'};
  let finishFc;
  const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth: {currentUser: faUser}, targets,
    broker: {exchangeTargets: async () => tokenResponse()},
    signInWithCustomToken: async (auth, token) => {
      if (token === 'fc-private-token') return new Promise(resolve => { finishFc = () => {
        const user = {uid: 'same-uid'}; auth.currentUser = user; resolve({user});
      }; });
      const user = {uid: 'same-uid'}; auth.currentUser = user; return {user};
    }, now: () => 1000, timeoutMs: 1000});
  const result = await coordinator.connect();
  const fbUser = targets.FB.auth.currentUser;
  assert.equal(result.status, 'partial');
  assert.equal(result.targets.FB.status, 'ready');
  assert.deepEqual(result.targets.FC, {status: 'unavailable', code: 'TARGET_SIGN_IN_TIMEOUT'});
  assert.equal(faUser.uid, 'same-uid');
  assert.equal(fbUser?.uid, 'same-uid');
  finishFc();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(targets.FC.auth.currentUser, null);
  assert.equal(targets.FB.auth.currentUser, fbUser);
});

test('FA account switch while broker is pending prevents sign-in into either target', async () => {
  let finishBroker;
  const targets = makeTargets(), faAuth = {currentUser: {uid: 'old-uid', getIdToken: async () => 'old-fa-token'}};
  const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth, targets,
    broker: {exchangeTargets: async () => new Promise(resolve => { finishBroker = resolve; })},
    signInWithCustomToken: async () => { throw new Error('must not sign in'); }, now: () => 1000, timeoutMs: 1000});
  const connecting = coordinator.connect();
  await new Promise(resolve => setImmediate(resolve));
  faAuth.currentUser = {uid: 'new-uid', getIdToken: async () => 'new-fa-token'};
  finishBroker(tokenResponse('old-uid'));
  const result = await connecting;
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'FA_CONTEXT_CHANGED');
  assert.equal(targets.FB.auth.currentUser, null);
  assert.equal(targets.FC.auth.currentUser, null);
});

test('FA account switch during target sign-in cleans only the sessions created by the stale attempt', async () => {
  const targets = makeTargets(), faAuth = {currentUser: {uid: 'old-uid', getIdToken: async () => 'old-fa-token'}};
  const pendingSigns = [];
  const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth, targets,
    broker: {exchangeTargets: async () => tokenResponse('old-uid')},
    signInWithCustomToken: auth => new Promise(resolve => pendingSigns.push(() => {
      const user = {uid: 'old-uid'}; auth.currentUser = user; resolve({user});
    })), now: () => 1000, timeoutMs: 1000});
  const connecting = coordinator.connect();
  await new Promise(resolve => setImmediate(resolve));
  faAuth.currentUser = {uid: 'new-uid', getIdToken: async () => 'new-fa-token'};
  for (const finish of pendingSigns) finish();
  const result = await connecting;
  assert.equal(result.status, 'blocked');
  assert.equal(result.targets.FB.code, 'TARGET_SESSION_INVALID');
  assert.equal(result.targets.FC.code, 'TARGET_SESSION_INVALID');
  assert.equal(targets.FB.auth.currentUser, null);
  assert.equal(targets.FC.auth.currentUser, null);
});

test('broker cannot swap target project or user identities', async t => {
  for (const mutate of [response => { response.targets.FC.projectId = FB; }, response => { response.faUid = 'other-uid'; }]) {
    await t.test(mutate.toString(), async () => {
      const faUser = {uid: 'same-uid', getIdToken: async () => 'fa-id-token'};
      const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth: {currentUser: faUser}, targets: makeTargets(),
        broker: {exchangeTargets: async () => { const response = tokenResponse(); mutate(response); return response; }},
        signInWithCustomToken: async auth => { const user = {uid: 'same-uid'}; auth.currentUser = user; return {user}; }, now: () => 1000, timeoutMs: 1000});
      const result = await coordinator.connect();
      assert.notEqual(result.status, 'ready');
      if (mutate.toString().includes('targets.FC'))
        { assert.deepEqual(result.targets.FC, {status: 'unavailable', code: 'BROKER_TARGET_INVALID'}); assert.equal(result.targets.FB.status, 'ready'); }
      else assert.equal(result.code, 'BROKER_RESPONSE_INVALID');
    });
  }
});

test('target Firebase Auth already bound to another UID stays untouched', async () => {
  const targets = makeTargets(); targets.FC.auth.currentUser = {uid: 'someone-else'};
  const faUser = {uid: 'same-uid', getIdToken: async () => 'fa-id-token'};
  const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth: {currentUser: faUser}, targets,
    broker: {exchangeTargets: async () => tokenResponse()},
    signInWithCustomToken: async (auth, token) => { const user = {uid: 'same-uid'}; auth.currentUser = user; return {user}; },
    now: () => 1000, timeoutMs: 1000});
  const result = await coordinator.connect();
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.targets.FC, {status: 'unavailable', code: 'TARGET_UID_MISMATCH'});
  assert.equal(targets.FC.auth.currentUser.uid, 'someone-else');
});

test('timeout during a target sign-in removes only the late session and does not stall the caller', async () => {
  const targets = makeTargets(), faUser = {uid: 'same-uid', getIdToken: async () => 'fa-id-token'};
  const finishSignIns = [];
  const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth: {currentUser: faUser}, targets,
    broker: {exchangeTargets: async () => tokenResponse()},
    signInWithCustomToken: auth => new Promise(resolve => { finishSignIns.push(() => {
      const user = {uid: 'same-uid'}; auth.currentUser = user; resolve({user});
    }); }), now: () => 1000, timeoutMs: 1000});
  const caller = coordinator.connect();
  const result = await caller;
  assert.equal(result.status, 'blocked');
  assert.equal(result.targets.FB.code, 'TARGET_SIGN_IN_TIMEOUT');
  assert.equal(result.targets.FC.code, 'TARGET_SIGN_IN_TIMEOUT');
  for (const finish of finishSignIns) finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(targets.FB.auth.currentUser, null);
  assert.equal(targets.FC.auth.currentUser, null);
});

test('coordinator preserves only closed transport codes and numeric HTTP status', async () => {
  for(const [error,expected] of [
    [Object.assign(Error('private-token'),{code:'PROJECT_BROKER_HTTP_ERROR',httpStatus:503}),{code:'PROJECT_BROKER_HTTP_ERROR',httpStatus:503}],
    [Object.assign(Error('private-token'),{code:'PROJECT_BROKER_NETWORK_OR_CORS',httpStatus:null}),{code:'PROJECT_BROKER_NETWORK_OR_CORS',httpStatus:null}],
    [Object.assign(Error('private-token'),{code:'PROJECT_BROKER_PRIVATE_TOKEN',httpStatus:403}),{code:'BROKER_UNAVAILABLE',httpStatus:null}],
    [Object.assign(Error('private-token'),{code:'PROJECT_BROKER_HTTP_ERROR',httpStatus:'private-token'}),{code:'PROJECT_BROKER_HTTP_ERROR',httpStatus:null}]
  ]) {
    const coordinator=createFirebaseProjectAuthCoordinator({enabled:true,faAuth:{currentUser:{uid:'same-uid',getIdToken:async()=> 'private-fa-token'}},
      targets:makeTargets(),broker:{exchangeTargets:async()=>{throw error;}},signInWithCustomToken:async()=>{throw Error('must not sign in');}});
    const result=await coordinator.connect();assert.equal(result.status,'unavailable');assert.equal(result.code,expected.code);
    assert.equal(result.httpStatus,expected.httpStatus);assert.equal(JSON.stringify(result).includes('private'),false);
  }
});
