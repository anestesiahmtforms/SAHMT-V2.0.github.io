import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createManagementPilotAuthDiagnostics} from '../src/management-pilot-auth-diagnostics.js';
import {FIREBASE_PROJECTS} from '../src/firebase-projects.js';
import {createFirebaseProjectAuthCoordinator} from '../src/firebase-project-auth.js';
import {createFirebaseProjectBrokerTransport} from '../src/firebase-project-broker-transport.js';
const time = () => Date.UTC(2026, 9, 12, 12);
const auth = alias => ({app: {name: FIREBASE_PROJECTS[alias].appName, options: {projectId: FIREBASE_PROJECTS[alias].projectId}}});
function fixture(options = {}) {
  const callbacks = {}, errors = {}, stops = [];
  const model = createManagementPilotAuthDiagnostics({enabled: true, now: time, ...options});
  const register = alias => {
    const instance = auth(alias);
    model.register(alias, instance, (_instance, next, error) => {callbacks[alias] = value => {instance.currentUser = value; next(value);}; errors[alias] = error; return () => stops.push(alias);});
    return instance;
  };
  return {model, register, callbacks, errors, stops};
}
const user = (uid = 'private-uid') => ({uid, providerData: [{providerId: 'google.com'}],
  email: 'private@example.invalid', displayName: 'private-display-name', accessToken: 'private-token',
  getIdToken() { throw Error('must not read tokens'); }});

test('diagnostics off observes nothing and remains passive', () => {
  let calls = 0;
  const model = createManagementPilotAuthDiagnostics({now: time});
  assert.equal(model.register('FA', auth('FA'), () => {calls++;}), false);
  model.subscribe(() => {calls++;});
  assert.equal(calls, 0);
  assert.equal(model.snapshot().code, 'PILOT_DIAGNOSTICS_DISABLED');
});

test('sanitized snapshots compare UIDs without exposing any identity or token field', () => {
  const f = fixture(); for (const alias of ['FA', 'FB', 'FC']) f.register(alias);
  for (const alias of ['FA', 'FB', 'FC']) f.callbacks[alias](user());
  const snapshot = f.model.snapshot(), serialized = JSON.stringify(snapshot);
  assert.deepEqual(snapshot.projects, {
    FA: {status:'connected', googleProviderLinked:true},
    FB: {status:'connected', uidMatchesFa:true}, FC: {status:'connected', uidMatchesFa:true}
  });
  assert.equal(snapshot.observedAt, '2026-10-12T12:00:00.000Z');
  for (const secret of ['private-uid', 'private@example.invalid', 'private-display-name', 'private-token'])
    assert.equal(serialized.includes(secret), false);
  assert.deepEqual(Object.keys(snapshot), ['schemaVersion', 'code', 'observedAt', 'projects', 'lastConnect', 'firestoreRead']);
  assert.equal(snapshot.firestoreRead, null);
});

test('pilot Firestore probe reads at most one document from the intended FB and FC projects and exposes only counts', async () => {
  const calls = [], f = fixture({firestoreRead: async (alias, targetAuth, projectId, collection) => {
    calls.push({alias, projectId, collection, uid: targetAuth.currentUser.uid});
    return {projectId, documentCount: alias === 'FB' ? 1 : 0, documents: [{email:'private@example.invalid'}]};
  }});
  for (const alias of ['FA','FB','FC']) { f.register(alias); f.callbacks[alias](user()); }
  const result = await f.model.probeFirestoreReads();
  assert.equal(result.status, 'read_ok');
  assert.deepEqual(calls.map(({alias,projectId,collection}) => ({alias,projectId,collection})), [
    {alias:'FB',projectId:'sahmt-gestao-5ae66',collection:'trainings'},
    {alias:'FC',projectId:'indicadores---sahmt',collection:'indicators'}
  ]);
  assert.deepEqual(result.projects.FB, {projectId:'sahmt-gestao-5ae66',collection:'trainings',status:'read_ok',maxDocuments:1,documentsReturned:1});
  assert.deepEqual(result.projects.FC, {projectId:'indicadores---sahmt',collection:'indicators',status:'read_ok',maxDocuments:1,documentsReturned:0});
  for (const secret of ['private-uid','private@example.invalid']) assert.equal(JSON.stringify(f.model.snapshot()).includes(secret), false);
});

test('pilot Firestore probe reports permission errors safely and continues with the other project', async () => {
  const calls = [], f = fixture({firestoreRead: async (alias, _auth, projectId) => {
    calls.push(alias); if (alias === 'FB') throw Object.assign(Error('sensitive response'), {code:'permission-denied'});
    return {projectId, documentCount:0};
  }});
  for (const alias of ['FA','FB','FC']) { f.register(alias); f.callbacks[alias](user()); }
  const report = await f.model.probeFirestoreReads();
  assert.equal(report.status,'partial');
  assert.equal(report.projects.FB.status,'FIRESTORE_PERMISSION_DENIED');
  assert.equal(report.projects.FC.status,'read_ok');
  assert.deepEqual(calls,['FB','FC']);
  assert.equal(JSON.stringify(report).includes('sensitive response'),false);
});

test('pilot Firestore probe never queries if a target UID differs from FA', async () => {
  let reads=0; const f=fixture({firestoreRead:async(_alias,_auth,projectId)=>{reads++; return {projectId,documentCount:0};}});
  for(const alias of ['FA','FB','FC']) f.register(alias);
  f.callbacks.FA(user()); f.callbacks.FB(user('other-private-uid')); f.callbacks.FC(user());
  const report=await f.model.probeFirestoreReads();
  assert.equal(reads,1);
  assert.equal(report.projects.FB.status,'uid_mismatch');
  assert.equal(report.projects.FC.status,'read_ok');
});

test('logout and switched UID are reflected without conflating a stale target with FA', () => {
  const f = fixture(); for (const alias of ['FA','FB','FC']) f.register(alias);
  for (const alias of ['FA','FB','FC']) f.callbacks[alias](user());
  f.callbacks.FA(user('second-private-uid'));
  assert.equal(f.model.snapshot().projects.FB.uidMatchesFa, false);
  f.callbacks.FC(null);
  assert.deepEqual(f.model.snapshot().projects.FC, {status:'disconnected',uidMatchesFa:null});
  f.callbacks.FA(null);
  assert.equal(f.model.snapshot().projects.FB.uidMatchesFa, null);
  assert.deepEqual(f.model.snapshot().projects.FA, {status:'disconnected',googleProviderLinked:false});
});

test('unknown app, wrong project and duplicate registrations cannot create observers', () => {
  const f = fixture(); let calls = 0;
  assert.equal(f.model.register('FA', auth('FC'), () => {calls++;}), false);
  assert.equal(f.model.register('other', auth('FC'), () => {calls++;}), false);
  const instance = f.register('FB');
  assert.equal(f.model.register('FB', instance, () => {calls++;}), true);
  assert.equal(calls, 0);
});

test('observer errors, subscriber errors and disposal are isolated and sanitized', () => {
  const f = fixture(); f.register('FA'); f.register('FB');
  const reports = [];
  f.model.subscribe(() => {throw Error('private-message');});
  f.model.subscribe(report => reports.push(report));
  f.callbacks.FA(user()); f.callbacks.FB(user());
  f.errors.FB(Error('private-token'));
  assert.equal(f.model.snapshot().projects.FA.status, 'connected');
  assert.equal(f.model.snapshot().projects.FB.status, 'unavailable');
  assert.equal(JSON.stringify(reports).includes('private-'), false);
  f.model.dispose(); f.callbacks.FA(user());
  assert.deepEqual(f.stops, ['FA','FB']);
  assert.equal(f.model.snapshot().projects.FA.status, 'not_initialized');
});

test('registration failures do not propagate and reports do not claim Google without provider evidence', () => {
  const f = fixture();
  assert.equal(f.model.register('FA', auth('FA'), () => {throw Error('private-token');}), false);
  assert.equal(f.model.snapshot().projects.FA.status, 'unavailable');
  f.register('FA'); f.callbacks.FA({uid:'private-uid',providerData:[]});
  assert.equal(f.model.snapshot().projects.FA.googleProviderLinked, false);
});

test('observations retain only copied identity comparisons and cannot track later User object mutations', () => {
  const f = fixture(); f.register('FA'); f.register('FB');
  const identity = user();
  for (const field of ['email', 'displayName', 'accessToken', 'stsTokenManager'])
    Object.defineProperty(identity, field, {get() { throw Error('private field must not be read'); }});
  f.callbacks.FA(identity); f.callbacks.FB(user());
  identity.uid = 'mutated-private-uid'; identity.providerData.length = 0;
  assert.equal(f.model.snapshot().projects.FA.googleProviderLinked, true);
  assert.equal(f.model.snapshot().projects.FB.uidMatchesFa, true);
});

test('replaced auth observers cannot overwrite current diagnostic state', () => {
  const f = fixture(); f.register('FA');
  const oldCallback = f.callbacks.FA;
  f.register('FA'); f.callbacks.FA(user()); oldCallback(null);
  assert.equal(f.model.snapshot().projects.FA.status, 'connected');
  assert.deepEqual(f.stops, ['FA']);
});

test('connect diagnostics record only statuses and allowlisted codes without credentials or identity', () => {
  const f = fixture();
  const attempt = f.model.beginConnect();
  assert.equal(f.model.snapshot().lastConnect.status, 'connecting');
  assert.equal(f.model.finishConnect(attempt, {status: 'partial', targets: {
    FB: {status: 'unavailable', code: 'FB_LEASE_WRITE_FAILED', uid: 'private-uid', customToken: 'private-token'},
    FC: {status: 'ready', uid: 'private-uid', email: 'private@example.invalid', customToken: 'private-token'}
  }}), true);
  assert.deepEqual(f.model.snapshot().lastConnect, {status: 'partial', code: null, targets: {
    FB: {status:'unavailable',code:'FB_LEASE_WRITE_FAILED'}, FC: {status:'ready',code:null}
  }});
  assert.equal(JSON.stringify(f.model.snapshot()).includes('private-'), false);
  const next = f.model.beginConnect();
  f.model.finishConnect(next, {status:'private-state', code:'PRIVATE_TOKEN', targets:{FB:{status:'unavailable',code:'private@example.invalid'}}});
  assert.equal(f.model.snapshot().lastConnect.code, 'PILOT_CONNECT_ERROR_UNKNOWN');
  assert.equal(f.model.snapshot().lastConnect.targets.FB.code, 'PILOT_CONNECT_ERROR_UNKNOWN');
  assert.equal(JSON.stringify(f.model.snapshot()).includes('PRIVATE_TOKEN'), false);
});

test('last connection report is cleared on FA change and late or superseded attempts are ignored', () => {
  const f = fixture(); f.register('FA'); f.callbacks.FA(user());
  const old = f.model.beginConnect(), latest = f.model.beginConnect();
  assert.equal(f.model.finishConnect(old, {status:'ready'}), false);
  assert.equal(f.model.finishConnect(latest, {status:'unavailable',code:'CONNECT_TIMEOUT'}), true);
  assert.equal(f.model.snapshot().lastConnect.code, 'CONNECT_TIMEOUT');
  const pending = f.model.beginConnect(); f.callbacks.FA(user('changed-private-uid'));
  assert.equal(f.model.snapshot().lastConnect, null);
  assert.equal(f.model.finishConnect(pending, {status:'ready'}), false);
  const off = fixture({enabled:false});
  assert.equal(off.model.beginConnect(), null);
  assert.equal(off.model.finishConnect({}, {status:'ready'}), false);
});

test('pilot report forwards safe transport status without headers, body, tokens or unknown codes', () => {
  const f=fixture();
  f.model.finishConnect(f.model.beginConnect(),{status:'unavailable',code:'PROJECT_BROKER_HTTP_ERROR',httpStatus:403,
    headers:{Authorization:'private-token'},body:'private-uid@example.invalid'});
  assert.equal(f.model.snapshot().lastConnect.code,'PROJECT_BROKER_HTTP_ERROR');
  assert.equal(f.model.snapshot().lastConnect.httpStatus,403);
  assert.equal(JSON.stringify(f.model.snapshot()).includes('private'),false);
  f.model.finishConnect(f.model.beginConnect(),{status:'unavailable',code:'PROJECT_BROKER_PRIVATE_TOKEN',httpStatus:403});
  assert.equal(f.model.snapshot().lastConnect.code,'PILOT_CONNECT_ERROR_UNKNOWN');
  assert.equal(f.model.snapshot().lastConnect.httpStatus,null);
});

test('real local transport and coordinator preserve an HTTP denial into the sanitized pilot report', async () => {
  const f=fixture(), endpoint='https://broker.example.invalid/v1/management/session';
  const broker=createFirebaseProjectBrokerTransport({enabled:true,endpoint,allowedOrigins:[new URL(endpoint).origin],fetchImpl:async()=>{
    const response=new Response(JSON.stringify({ok:false,code:'FA_TOKEN_REJECTED',uid:'private-uid',email:'private@example.invalid',token:'private-token',
      diagnostic:{stage:'AUTH_LOOKUP',code:'GATEWAY_OPERATION_DENIED',uid:'private-uid',token:'private-token'}}),
      {status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});
    Object.defineProperty(response,'url',{value:endpoint});return response;
  }});
  const coordinator=createFirebaseProjectAuthCoordinator({enabled:true,faAuth:{currentUser:{uid:'private-uid',getIdToken:async()=> 'private-fa-token'}},
    broker,signInWithCustomToken:async()=>{throw Error('must not sign in');}});
  const attempt=f.model.beginConnect(); f.model.finishConnect(attempt,await coordinator.connect());
  assert.deepEqual(f.model.snapshot().lastConnect,{status:'unavailable',code:'FA_TOKEN_REJECTED',httpStatus:403,
    diagnostic:{stage:'AUTH_LOOKUP',code:'GATEWAY_OPERATION_DENIED'},targets:{}});
  assert.equal(JSON.stringify(f.model.snapshot()).includes('private'),false);coordinator.dispose();broker.dispose();
});

test('browser composition uses ninety second background budget without changing reusable defaults', () => {
  const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const source = load('../src/firebase-project-auth-browser.js');
  assert.ok(source.includes('const SECONDARY_AUTH_TIMEOUT_MS = 90000;'));
  assert.equal((source.match(/timeoutMs: SECONDARY_AUTH_TIMEOUT_MS/g) || []).length, 2);
  assert.match(source, /if \(env\.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true'\) finishManagementPilotConnect\(attempt, result\)/);
  assert.ok(load('../src/firebase-project-auth.js').includes('timeoutMs = 20000'));
  assert.ok(load('../src/firebase-project-broker-transport.js').includes('timeoutMs = 20000'));
});

test('ordinary PWA diagnostics registration and mounting remain guarded by explicit opt-in', () => {
  const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(load('../.env.example'), /^VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS=false$/m);
  assert.match(load('../src/firebase-auth.js'), /if \(import\.meta\.env\.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true'\) registerManagementPilotAuth\('FA'/);
  for (const alias of ['FB', 'FC']) assert.ok(load('../src/firebase-project-auth-browser.js').includes(
    "if (env.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true') registerManagementPilotAuth('" + alias + "'"));
  assert.match(load('../src/main.js'), /if \(import\.meta\.env\.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true'\) \{\s*void import\('\.\/management-pilot-auth-diagnostics\.js'\)/);
});

test('diagnostic source only observes registered Auth and copy emits sanitized snapshot', () => {
  const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/management-pilot-auth-diagnostics.js',import.meta.url),'utf8');
  assert.equal(/\b(getAuth|getApps|initializeAuth|initializeApp|getIdToken|fetch)\s*\(/.test(source), false);
  assert.equal(source.includes('clipboard.writeText(JSON.stringify(runtime.snapshot(), null, 2))'), true);
  assert.equal(source.includes('innerHTML'), false);
  assert.ok(source.includes("import.meta.env?.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true'"));
  assert.ok(source.includes("logout.textContent = 'Sair do piloto (FA, FB e FC)'"));
  assert.ok(source.includes('const complete = await signOut()'));
  assert.match(load('../src/main.js'), /mountManagementPilotAuthDiagnostics\(\{signOut: signOutGlobal\}\)/);
});
