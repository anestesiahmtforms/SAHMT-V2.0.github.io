import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementBrowserAdapters} from '../src/management-session-browser.js';
import {createManagementSession} from '../src/management-session.js';
import {createManagementBrokerTransport} from '../src/management-broker-transport.js';

const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', TIME = 1800000000000;
const config = {apiKey: 'public-test-key', authDomain: FB + '.firebaseapp.com', projectId: FB,
  storageBucket: FB + '.firebasestorage.app', messagingSenderId: '613953519880', appId: '1:613953519880:web:test'};
const policy = () => ({operationTimeoutMs: 1000, cleanupTimeoutMs: 200, maxMeasurementAgeMs: 5000,
  applicationReserveReads: 100, metricLagReserveReads: 100, sourceReadMaximum: 5, leaseReadMaximum: 7, sourceMaxAgeMs: 5000, sourceMaxLeaseMs: 60000, maxReservationRecords: 1000});
const clone = value => JSON.parse(JSON.stringify(value));
const identity = () => ({sourceProjectId: FA, destinationProjectId: FB, faUid: 'member-a', fbUid: 'member-a', memberId: 'stable-a'});
const sourceData = () => ({schemaVersion: 1, sourceProjectId: FA, destinationProjectId: FB,
  productionAuthorized: true, sourceVersion: 7, sourceHash: 'a'.repeat(64), confirmedAtMs: TIME - 100, validUntilMs: TIME + 59900, profile: {uid: 'member-a', memberId: 'stable-a', active: true, access: true}, managementAllowed: true, binding: identity()});
const leaseData = () => ({...identity(), schemaVersion: 1, sourceVersion: 7, leaseVersion: 1,
  policyVersion: 'test-policy', sourceHash: 'a'.repeat(64), active: true, revoked: false, managementAllowed: true,
  confirmedAtMs: TIME - 100, validUntilMs: TIME + 60000});
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };
const day = time => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(time));
function auth(app, user) {
  const listeners = new Set();
  return {app, currentUser: user, listeners, authStateReady: async () => {}, setUser(user) { this.currentUser = user; for (const next of listeners) next(user); }};
}
async function harness({sdkOverrides = {}, reserveOverride, sourceOverride, leaseOverride, fbUser = null,
  online = true, suppliedPolicy = policy(), transport, sourceReady, targetReady, existingFbApp} = {}) {
  const calls = [], apps = [{name: 'sahmt-v2', options: {projectId: FA}}];
  if (existingFbApp) apps.push(existingFbApp);
  const faAuth = auth(apps[0], {uid: 'member-a', claims: {admin: true}}), faFirestore = {app: apps[0]};
  let fbAuth, fbFirestore, time = TIME, reservationCount = 0;
  const debits = new Map();
  const sdk = {
    getApps: () => apps, initializeApp: (options, name) => { calls.push(['initialize-app', name]); const app = {name, options}; apps.push(app); return app; },
    inMemoryPersistence: {kind: 'memory'}, initializeAuth: (app, options) => { calls.push(['initialize-auth', options]); fbAuth = auth(app, fbUser); if (targetReady) fbAuth.authStateReady = () => targetReady; return fbAuth; },
    getAuth: () => fbAuth, memoryLocalCache: () => ({kind: 'memory'}),
    initializeFirestore: app => { fbFirestore = {app}; return fbFirestore; }, getFirestore: () => fbFirestore,
    onAuthStateChanged: (instance, next) => { instance.listeners.add(next); next(instance.currentUser); return () => instance.listeners.delete(next); },
    doc: (firestore, collection, uid) => ({firestore, path: collection + '/' + uid, id: uid}),
    getDocFromServer: async ref => { calls.push(['read', ref]); const isSource = ref.firestore.app.options.projectId === FA;
      let data = isSource ? sourceData() : leaseData(); if (isSource && sourceOverride) data = sourceOverride(data); if (!isSource && leaseOverride) data = leaseOverride(data);
      return {id: ref.id, ref, metadata: {fromCache: false, hasPendingWrites: false}, exists: () => data !== null, data: () => data}; },
    getIdToken: async (user, refresh) => { calls.push(['fa-token', {uid: user.uid, refresh}]); return 'fake-private-fa-token'; },
    signInWithCustomToken: async (instance, token) => { calls.push(['fb-sign-in', {tokenPassed: token === 'fake-private-custom-token'}]); const user = {uid: 'member-a'}; instance.setUser(user); return {user}; },
    signOut: async instance => { calls.push(['sign-out', instance.app.options.projectId]); instance.setUser(null); }, ...sdkOverrides
  };
  if (sourceReady) faAuth.authStateReady = () => sourceReady;
  const reserve = async request => {
    calls.push(['reserve', request]);
    const prior = debits.get(request.projectId) || 0; debits.set(request.projectId, prior + request.maximumReads);
    const receipt = {schemaVersion: 1, projectId: request.projectId, operation: request.operation,
      reservationId: 'reservation-' + (++reservationCount), dailyLimit: 35000, quotaTimezone: 'America/Los_Angeles',
      quotaDay: day(time), pausedRequiresReview: false, metricsComplete: true, measurementTimeMs: time,
      expiresAtMs: time + 10000, reservedReads: request.maximumReads, totalReadCount: 1000,
      outstandingReservedReads: request.maximumReads, unreportedConsumedReads: prior,
      applicationReserveReads: 100, metricLagReserveReads: 100};
    return reserveOverride ? reserveOverride(receipt, request) : receipt;
  };
  const wrapper = await createManagementBrowserAdapters({enabled: true, faAuth, faFirestore, fbConfig: config,
    sourceReference: ({firestore, uid}) => sdk.doc(firestore, 'managementSourceContexts', uid), sdkLoader: async () => sdk,
    reserveFirestoreReads: reserve, policy: suppliedPolicy, brokerTransport: transport, now: () => time, isOnline: () => online});
  return {wrapper, adapters: wrapper.adapters, sdk, calls, apps, faAuth, faFirestore,
    get fbAuth() { return fbAuth; }, advance: delta => { time += delta; }};
}
const count = (calls, name) => calls.filter(([kind]) => kind === name);
const expectCode = (promise, code) => assert.rejects(promise, error => error.message === code && error.code === code);

test('adaptador desligado não importa SDK, cria instâncias ou lê', async () => {
  let calls = 0;
  const wrapper = await createManagementBrowserAdapters({sdkLoader: async () => { calls++; throw new Error('must not load'); }});
  assert.equal(wrapper.enabled, false); assert.deepEqual(Object.keys(wrapper.adapters), []);
  assert.equal(await wrapper.refreshContexts(), null); assert.equal(calls, 0);
});

test('sem guarda ou limites comprováveis falha antes de importar SDK', async t => {
  for (const change of [value => { delete value.reserveFirestoreReads; }, value => { delete value.policy; }, value => { value.policy.leaseReadMaximum = 0; }]) await t.test('preflight', async () => {
    const app = {name: 'sahmt-v2', options: {projectId: FA}}; let imported = false;
    const options = {enabled: true, faAuth: {app}, faFirestore: {app}, fbConfig: config, sourceReference: () => {},
      reserveFirestoreReads: () => {}, policy: policy(), sdkLoader: async () => { imported = true; }};
    change(options); await assert.rejects(createManagementBrowserAdapters(options)); assert.equal(imported, false);
  });
});

test('SDK modular cria somente FB nomeado e conserva instâncias FA', async () => {
  const {wrapper, apps, faAuth, calls} = await harness(); const original = faAuth.app;
  assert.deepEqual(apps.map(app => app.name), ['sahmt-v2', 'sahmt-management']);
  assert.equal(faAuth.app, original); assert.equal(count(calls, 'initialize-app').length, 1);
  assert.equal(count(calls, 'initialize-auth')[0][1].persistence.kind, 'memory'); wrapper.dispose();
});

test('app FB pré-existente de projeto divergente é negado', async () => {
  await expectCode(harness({existingFbApp: {name: 'sahmt-management', options: {projectId: FA, appId: config.appId, authDomain: config.authDomain}}}), 'FB_INSTANCE_MISMATCH');
});

test('restauração espera ambos Auth antes de consultar documentos', async () => {
  const gate = deferred(); const {adapters, calls, wrapper} = await harness({targetReady: gate.promise});
  const restoration = adapters.restoreFa(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(count(calls, 'read').length, 0); gate.resolve();
  assert.equal((await restoration).profile.memberId, 'stable-a'); wrapper.dispose();
});

test('Auth local sem usuário FB não pede documento ou reserva FB', async () => {
  const {adapters, calls, wrapper} = await harness(); assert.equal((await adapters.restoreFb()).user, null);
  assert.equal(count(calls, 'read').length, 0); assert.equal(count(calls, 'reserve').length, 0); wrapper.dispose();
});

test('restauração usa documento confirmado e vínculo explícito, sem permissões das claims', async () => {
  const {adapters, wrapper} = await harness({sourceOverride: data => ({...data, managementAllowed: false})});
  const fa = await adapters.restoreFa(); assert.equal(fa.managementAllowed, false); assert.equal(fa.fromCache, false);
  assert.equal(fa.binding.memberId, 'stable-a'); assert.equal(Object.hasOwn(fa, 'claims'), false); wrapper.dispose();
});

test('FA offline não usa cache ou tenta ler documento', async () => {
  const {adapters, calls, wrapper} = await harness({online: false}); assert.equal((await adapters.restoreFa()).online, false);
  assert.equal(count(calls, 'read').length, 0); wrapper.dispose();
});

test('metadata cache ou escrita pendente nunca vira contexto confirmado', async t => {
  for (const metadata of [{fromCache: true, hasPendingWrites: false}, {fromCache: false, hasPendingWrites: true}]) await t.test('metadata', async () => {
    const {adapters, wrapper} = await harness({sdkOverrides: {getDocFromServer: async ref => ({id: ref.id, ref, metadata, exists: () => true, data: sourceData})}});
    await expectCode(adapters.restoreFa(), 'SERVER_DOCUMENT_NOT_CONFIRMED'); wrapper.dispose();
  });
});

test('perfil/vínculo ausente ou UID trocado é negado', async t => {
  for (const change of [() => null, data => ({...data, binding: null}), data => ({...data, profile: {...data.profile, uid: 'other'}})]) await t.test('projection', async () => {
    const {adapters, wrapper} = await harness({sourceOverride: change}); await assert.rejects(adapters.restoreFa()); wrapper.dispose();
  });
});

test('pausa, stale, métricas incompletas e margem insuficiente impedem leitura', async t => {
  for (const change of [value => ({...value, pausedRequiresReview: true}), value => ({...value, measurementTimeMs: TIME - 5001}),
    value => ({...value, metricsComplete: false}), value => ({...value, totalReadCount: 34900})]) await t.test('budget', async () => {
    const {adapters, calls, wrapper} = await harness({reserveOverride: change}); await expectCode(adapters.restoreFa(), 'FIRESTORE_BUDGET_DENIED');
    assert.equal(count(calls, 'read').length, 0); wrapper.dispose();
  });
});

test('lease FB usa path aprovado e reserva própria antes da leitura', async () => {
  const {adapters, calls, wrapper} = await harness({fbUser: {uid: 'member-a'}}); const fb = await adapters.restoreFb();
  assert.equal(fb.mirror.memberId, 'stable-a'); const targetReservation = count(calls, 'reserve').find(([, request]) => request.projectId === FB);
  assert.equal(targetReservation[1].maximumReads, 7);
  assert.equal(count(calls, 'read').find(([, ref]) => ref.firestore.app.options.projectId === FB)[1].path, 'managementAuthorizationLeases/member-a'); wrapper.dispose();
});

test('sessão SDK FB de UID diferente bloqueia antes de ler lease', async () => {
  const {adapters, calls, wrapper} = await harness({fbUser: {uid: 'other'}}); await expectCode(adapters.restoreFb(), 'FB_UID_CHANGED');
  assert.equal(count(calls, 'read').length, 0); wrapper.dispose();
});

test('lease revogado ou vencido não libera coordenador', async t => {
  for (const change of [data => ({...data, revoked: true}), data => ({...data, validUntilMs: TIME - 1})]) await t.test('lease', async () => {
    const {adapters, wrapper} = await harness({fbUser: {uid: 'member-a'}, leaseOverride: change});
    const session = createManagementSession({enabled: true, adapters, now: () => TIME});
    assert.equal((await session.restore()).ready, false); wrapper.dispose();
  });
});

test('permission-denied de lease não usa claims/cache como alternativa', async () => {
  const {adapters, wrapper} = await harness({fbUser: {uid: 'member-a'}, sdkOverrides: {getDocFromServer: async () => { throw new Error('permission denied fake-private-fa-token'); }}});
  await expectCode(adapters.restoreFb(), 'SERVER_DOCUMENT_UNAVAILABLE'); wrapper.dispose();
});

test('token FA forçado só sai para UID atual esperado', async () => {
  const {adapters, calls, wrapper} = await harness(); await expectCode(adapters.getFaIdToken({expectedUid: 'other', forceRefresh: true}), 'FA_UID_CHANGED');
  assert.equal(await adapters.getFaIdToken({expectedUid: 'member-a', forceRefresh: true}), 'fake-private-fa-token');
  assert.equal(count(calls, 'fa-token')[0][1].refresh, true); wrapper.dispose();
});

test('sem broker fica indisponível sem outra janela Google', async () => {
  const {adapters, wrapper} = await harness(); await expectCode(adapters.exchangeFaToken({faIdToken: 'fake', ...identity()}), 'BROKER_UNAVAILABLE'); wrapper.dispose();
});

test('troca Auth FB só retorna após observar lease confirmado', async () => {
  const {adapters, calls, wrapper} = await harness(); const result = await adapters.signInFb({expectedUid: 'member-a', customToken: 'fake-private-custom-token'});
  assert.equal(result.user.uid, 'member-a'); assert.equal(result.mirror.fromCache, false);
  assert.equal(count(calls, 'fb-sign-in').length, 1); assert.equal(count(calls, 'read').find(([, ref]) => ref.firestore.app.options.projectId === FB)[1].path, 'managementAuthorizationLeases/member-a'); wrapper.dispose();
});

test('logout de ambos preserva outbox e não cancela saída por evento Auth próprio', async () => {
  const pending = [{requestId: 'preserved-request'}]; const {adapters, calls, wrapper} = await harness({fbUser: {uid: 'member-a'}});
  const session = createManagementSession({enabled: true, adapters, now: () => TIME, beforeSignOut: async () => pending.length === 1});
  assert.equal((await session.restore()).ready, true); assert.equal((await session.signOut()).completed, true);
  assert.deepEqual(pending, [{requestId: 'preserved-request'}]); assert.equal(count(calls, 'sign-out').length, 2); wrapper.dispose();
});

test('logout com UID inesperado não encerra conta diferente', async () => {
  const {adapters, calls, wrapper} = await harness({fbUser: {uid: 'other'}}); await expectCode(adapters.signOutFb({expectedUid: 'member-a'}), 'FB_UID_CHANGED');
  assert.equal(count(calls, 'sign-out').length, 0); wrapper.dispose();
});

test('resposta de broker depois de troca de conta é descartada', async () => {
  const gate = deferred(); const transport = {exchange: async () => gate.promise}; const {adapters, faAuth, calls, wrapper} = await harness({transport});
  const request = adapters.exchangeFaToken({faIdToken: 'fake-private-fa-token', ...identity()}); await new Promise(resolve => setImmediate(resolve));
  faAuth.setUser({uid: 'other'}); await expectCode(request, 'BROWSER_CONTEXT_CHANGED');
  gate.resolve({...identity(), customToken: 'fake-private-custom-token'}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(count(calls, 'fb-sign-in').length, 0); wrapper.dispose();
});

test('sign-in SDK tardio depois de timeout é limpo e impede novo sign-in enquanto pendente', {timeout: 3000}, async () => {
  const gate = deferred(); let instance;
  const value = policy(); value.operationTimeoutMs = 80;
  const context = await harness({suppliedPolicy: value, sdkOverrides: {signInWithCustomToken: async auth => { instance = auth; await gate.promise; const user = {uid: 'member-a'}; auth.setUser(user); return {user}; }}});
  await assert.rejects(context.adapters.signInFb({expectedUid: 'member-a', customToken: 'fake-private-custom-token'}));
  await expectCode(context.adapters.signInFb({expectedUid: 'member-a', customToken: 'fake-private-custom-token'}), 'FB_RECONCILIATION_REQUIRED');
  gate.resolve(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.currentUser, null); context.wrapper.dispose();
});

test('dispose cancela leitores pendentes e ouvintes sem apagar armazenamento', async () => {
  const gate = deferred(); const {adapters, faAuth, wrapper} = await harness({sdkOverrides: {getDocFromServer: async () => gate.promise}});
  const request = adapters.restoreFa(); await new Promise(resolve => setImmediate(resolve)); wrapper.dispose();
  await expectCode(request, 'BROWSER_CONTEXT_CHANGED'); assert.equal(faAuth.listeners.size, 0);
  gate.resolve(null); await new Promise(resolve => setImmediate(resolve));
});

const ENDPOINT = 'https://broker.example.invalid/v1/management/session';
const brokerResult = () => ({ok: true, ...identity(), leaseVersion: 1, policyVersion: 'test-policy', customToken: 'fake-private-custom-token'});
const response = (result = brokerResult(), options = {}) => {
  const bytes = new TextEncoder().encode(typeof result === 'string' ? result : JSON.stringify(result)); let delivered = false;
  return {status: 200, redirected: false, url: ENDPOINT, headers: new Headers({'content-type': 'application/json', 'cache-control': 'no-store'}),
    body: {getReader: () => ({read: async () => delivered ? {done: true} : (delivered = true, {done: false, value: bytes}), cancel: async () => {}, releaseLock: () => {}})}, ...options};
};
const transport = (fetchImpl, options = {}) => createManagementBrokerTransport({enabled: true, endpoint: ENDPOINT,
  allowedBrokerOrigins: ['https://broker.example.invalid'], fetchImpl, timeoutMs: 1000, maxResponseBytes: 2048, ...options});
const brokerRequest = () => ({faIdToken: 'fake-private-fa-token', ...identity()});

test('transporte envia apenas faIdToken no corpo HTTPS fixo sem cookies/header Auth', async () => {
  let sent; const bridge = transport(async (url, options) => { sent = {url, options}; return response(); });
  assert.equal((await bridge.exchange(brokerRequest())).customToken, 'fake-private-custom-token');
  assert.equal(sent.url, ENDPOINT); assert.equal(sent.url.includes('fake-private'), false);
  assert.deepEqual(JSON.parse(sent.options.body), {faIdToken: 'fake-private-fa-token'});
  assert.equal(sent.options.cache, 'no-store'); assert.equal(sent.options.credentials, 'omit'); assert.equal(sent.options.redirect, 'error');
  assert.equal(Object.hasOwn(sent.options.headers, 'Authorization'), false);
});

test('transporte desligado, HTTP/query/origem não aprovada negam sem fetch', async t => {
  for (const options of [{enabled: false}, {endpoint: ENDPOINT.replace('https:', 'http:')}, {endpoint: ENDPOINT + '?token=fake'}, {allowedBrokerOrigins: []}]) await t.test('configuration', async () => {
    let fetched = false; const bridge = transport(async () => { fetched = true; return response(); }, options);
    await assert.rejects(bridge.exchange(brokerRequest())); assert.equal(fetched, false);
  });
});

test('transporte rejeita identidade, redirecionamento, cache e corpo inválidos', async t => {
  for (const value of [response({...brokerResult(), fbUid: 'other'}), response(brokerResult(), {redirected: true}),
    response(brokerResult(), {headers: new Headers({'content-type': 'application/json'})}), response('invalid-json'), response(brokerResult(), {status: 403})]) await t.test('response', async () => {
    await assert.rejects(transport(async () => value).exchange(brokerRequest()));
  });
});

test('transporte limita corpo de resposta antes de aceitar token', async () => {
  await expectCode(transport(async () => response(brokerResult()), {maxResponseBytes: 20}).exchange(brokerRequest()), 'BROKER_RESPONSE_TOO_LARGE');
});

test('fetch pendurado é negado por timeout real e AbortSignal', {timeout: 3000}, async () => {
  let signal; const bridge = transport(async (url, options) => { signal = options.signal; return new Promise(() => {}); }, {timeoutMs: 50});
  await expectCode(bridge.exchange(brokerRequest()), 'BROKER_REQUEST_TIMEOUT'); assert.equal(signal.aborted, true);
});

test('dispose/abort não permite resposta tardia virar token', async () => {
  const gate = deferred(); const bridge = transport(async () => gate.promise); const request = bridge.exchange(brokerRequest());
  bridge.dispose(); await expectCode(request, 'BROKER_REQUEST_ABORTED'); gate.resolve(response());
  await new Promise(resolve => setImmediate(resolve));
});

test('erro bruto ou código arbitrário do fetch não expõe tokens', async () => {
  const bridge = transport(async () => { throw Object.assign(new Error('fake-private-fa-token'), {code: 'BROKER_RAW_FAKE_PRIVATE_TOKEN'}); });
  await expectCode(bridge.exchange(brokerRequest()), 'BROKER_TRANSPORT_FAILED');
});


test('FA exige hash, versão, TTL e confirmação recentes da projeção', async t => {
  const cases = [data => { delete data.sourceHash; return data; }, data => { delete data.validUntilMs; return data; },
    data => ({...data, confirmedAtMs: TIME + 1}), data => ({...data, confirmedAtMs: TIME - 5001}),
    data => ({...data, validUntilMs: TIME}), data => ({...data, validUntilMs: TIME + 60001})];
  for (const change of cases) await t.test('source-evidence', async () => {
    const {adapters, wrapper} = await harness({sourceOverride: change}); await assert.rejects(adapters.restoreFa()); wrapper.dispose();
  });
});

test('lease FB deve corresponder à versão/hash atuais e ao membro da projeção FA', async t => {
  for (const change of [data => ({...data, sourceVersion: 6}), data => ({...data, sourceHash: 'b'.repeat(64)}), data => ({...data, memberId: 'different-stable-member'})]) await t.test('coherent-lease', async () => {
    const {adapters, wrapper} = await harness({fbUser: {uid: 'member-a'}, leaseOverride: change});
    await expectCode(adapters.restoreFb(), 'FB_LEASE_INVALID'); wrapper.dispose();
  });
});

test('fonte não regride versão nem muda hash sem nova versão', async t => {
  for (const mode of ['version', 'hash']) await t.test(mode, async () => {
    let changed = false; const {adapters, wrapper} = await harness({sourceOverride: data => changed ? {...data,
      sourceVersion: mode === 'version' ? 6 : 7, sourceHash: mode === 'hash' ? 'b'.repeat(64) : data.sourceHash} : data});
    await adapters.restoreFa(); changed = true;
    await expectCode(adapters.restoreFa(), mode === 'version' ? 'FA_PROJECTION_VERSION_REGRESSED' : 'FA_PROJECTION_VERSION_INCONSISTENT'); wrapper.dispose();
  });
});

test('ID consumido vencido não pode ser reciclado com validade nova', async () => {
  let id; const context = await harness({reserveOverride: receipt => { id ??= receipt.reservationId; return {...receipt, reservationId: id}; }});
  await context.adapters.restoreFa(); context.advance(10001);
  await expectCode(context.adapters.restoreFa(), 'FIRESTORE_RESERVATION_REUSED');
  assert.equal(count(context.calls, 'read').length, 1); context.wrapper.dispose();
});

test('capacidade de tombstones esgotada nega em vez de apagar IDs consumidos', async () => {
  const value = policy(); value.maxReservationRecords = 1; const context = await harness({suppliedPolicy: value});
  await context.adapters.restoreFa(); await expectCode(context.adapters.restoreFa(), 'FIRESTORE_RESERVATION_CAPACITY_EXCEEDED');
  assert.equal(count(context.calls, 'read').length, 1); context.wrapper.dispose();
});

test('piso de orçamento incorpora total maior e nega regressão', async () => {
  let reservations = 0; const context = await harness({reserveOverride: receipt => ({...receipt,
    totalReadCount: ++reservations === 2 ? 30000 : 1000, unreportedConsumedReads: reservations === 3 ? 30000 : 20})});
  await context.adapters.restoreFa(); await context.adapters.restoreFa();
  await expectCode(context.adapters.restoreFa(), 'FIRESTORE_MEASUREMENT_REGRESSED'); context.wrapper.dispose();
});

test('evento de expiração bloqueia reentrada e não consulta Firestore automaticamente', {timeout: 2000}, async () => {
  const context = await harness({sourceOverride: data => ({...data, confirmedAtMs: TIME, validUntilMs: TIME + 40})});
  const events = []; context.wrapper.observeAuth(event => events.push(event)); await context.adapters.restoreFa();
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(events.at(-1).code, 'AUTHORIZATION_LEASE_EXPIRED'); assert.equal(count(context.calls, 'read').length, 1); context.wrapper.dispose();
});

test('sign-in SDK com UID errado é descartado e a sessão produzida é limpa', async () => {
  const context = await harness({sdkOverrides: {signInWithCustomToken: async auth => { const user = {uid: 'other'}; auth.setUser(user); return {user}; }}});
  await assert.rejects(context.adapters.signInFb({expectedUid: 'member-a', customToken: 'fake-private-custom-token'}));
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.fbAuth.currentUser, null); context.wrapper.dispose();
});

test('leitor SDK pendurado é negado sem fallback de cache', {timeout: 2000}, async () => {
  const value = policy(); value.operationTimeoutMs = 50; const context = await harness({suppliedPolicy: value,
    sdkOverrides: {getDocFromServer: async () => new Promise(() => {})}});
  await expectCode(context.adapters.restoreFa(), 'BROWSER_OPERATION_TIMEOUT'); context.wrapper.dispose();
});


test('SDK init failures do not expose arbitrary error messages or tokens', async t => {
  for (const [method, code] of [['getApps', 'FB_APP_INIT_FAILED'], ['initializeApp', 'FB_APP_INIT_FAILED'],
    ['onAuthStateChanged', 'AUTH_OBSERVER_INIT_FAILED']]) await t.test(method, async () => {
    await expectCode(harness({sdkOverrides: {[method]: () => { throw new Error('fake-private-token'); }}}), code);
  });
});

test('transport rejects local or literal-IP endpoints even if explicitly allowlisted', async t => {
  for (const host of ['localhost', 'host.localhost', 'server.local', 'server.internal', '127.0.0.1', '10.0.0.1', '[::1]']) await t.test(host, async () => {
    let fetched = false; const endpoint = 'https://' + host + '/v1/management/session';
    const bridge = transport(async () => { fetched = true; return response(); }, {endpoint, allowedBrokerOrigins: [new URL(endpoint).origin]});
    await expectCode(bridge.exchange(brokerRequest()), 'BROKER_TRANSPORT_CONFIG_INVALID'); assert.equal(fetched, false);
  });
});


test('direct Auth mutations also wait for restoration of both projects', async t => {
  for (const operation of ['signInFb', 'signOutFa', 'signOutFb']) await t.test(operation, async () => {
    const gate = deferred(); const context = await harness({targetReady: gate.promise,
      fbUser: operation === 'signInFb' ? null : {uid: 'member-a'}});
    const pending = context.adapters[operation]({expectedUid: 'member-a', customToken: 'fake-private-custom-token'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(count(context.calls, 'fb-sign-in').length + count(context.calls, 'sign-out').length, 0);
    gate.resolve(); await pending; context.wrapper.dispose();
  });
});


test('empty microtask body cannot starve the transport deadline', {timeout: 2000}, async () => {
  let reads = 0; const body = {getReader: () => ({read: async () => { reads++; return {done: false, value: new Uint8Array(0)}; }, cancel: async () => {}, releaseLock: () => {}})};
  await expectCode(transport(async () => response(brokerResult(), {body})).exchange(brokerRequest()), 'BROKER_RESPONSE_INVALID'); assert.equal(reads, 1);
});

test('nonempty microtask body has a finite chunk count as well as byte cap', {timeout: 2000}, async () => {
  let reads = 0; const body = {getReader: () => ({read: async () => { reads++; return {done: false, value: new Uint8Array([32])}; }, cancel: async () => {}, releaseLock: () => {}})};
  await expectCode(transport(async () => response(brokerResult(), {body}), {maxResponseChunks: 3}).exchange(brokerRequest()), 'BROKER_RESPONSE_TOO_MANY_CHUNKS'); assert.equal(reads, 4);
});

test('monotonic deadline rejects synchronous fetch work before the timer can fire', {timeout: 2000}, async () => {
  const bridge = transport(async () => { const end = performance.now() + 30; while (performance.now() < end) {} return response(); }, {timeoutMs: 10});
  await expectCode(bridge.exchange(brokerRequest()), 'BROKER_REQUEST_TIMEOUT');
});


test('queued SDK or broker thunks cannot start after an account change', async t => {
  for (const operation of ['getFaIdToken', 'exchangeFaToken', 'signInFb', 'signOutFa']) await t.test(operation, async () => {
    let exchanges = 0; const context = await harness({transport: {exchange: async () => { exchanges++; return brokerResult(); }}});
    let current = context.faAuth.currentUser, queued = false;
    Object.defineProperty(context.faAuth, 'currentUser', {configurable: true, get() {
      if (!queued) { queued = true; queueMicrotask(() => context.faAuth.setUser({uid: 'different-account'})); }
      return current;
    }, set(value) { current = value; }});
    const request = operation === 'exchangeFaToken' ? brokerRequest() : {expectedUid: 'member-a', forceRefresh: true, customToken: 'fake-private-custom-token'};
    await assert.rejects(context.adapters[operation](request));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(count(context.calls, 'fa-token').length, 0); assert.equal(count(context.calls, 'fb-sign-in').length, 0);
    assert.equal(count(context.calls, 'sign-out').length, 0); assert.equal(exchanges, 0);
    assert.equal(context.faAuth.currentUser.uid, 'different-account'); context.wrapper.dispose();
  });
});

test('denied body chunks abort the underlying fetch and release the reader', async () => {
  let signal, released = false;
  const body = {getReader: () => ({read: async () => ({done: false, value: new Uint8Array(0)}), cancel: async () => {}, releaseLock: () => { released = true; }})};
  const bridge = transport(async (url, options) => { signal = options.signal; return response(brokerResult(), {body}); });
  await expectCode(bridge.exchange(brokerRequest()), 'BROKER_RESPONSE_INVALID'); assert.equal(signal.aborted, true); assert.equal(released, true);
});


test('reservation expiration bounds an already started SDK wait', {timeout: 1000}, async () => {
  const value = policy(); value.operationTimeoutMs = 500;
  const context = await harness({suppliedPolicy: value, reserveOverride: receipt => ({...receipt, expiresAtMs: TIME + 30}),
    sdkOverrides: {getDocFromServer: async () => new Promise(() => {})}});
  const started = performance.now(); await expectCode(context.adapters.restoreFa(), 'BROWSER_OPERATION_TIMEOUT');
  assert.ok(performance.now() - started < 300); assert.equal(count(context.calls, 'reserve').length, 1); context.wrapper.dispose();
});

test('reservation that expires before the queued SDK call never starts a document read', async () => {
  let context; context = await harness({reserveOverride: receipt => {
    let gets = 0; Object.defineProperty(receipt, 'expiresAtMs', {get() { if (++gets === 4) queueMicrotask(() => context.advance(2)); return TIME + 1; }});
    return receipt;
  }});
  await assert.rejects(context.adapters.restoreFa()); assert.equal(count(context.calls, 'read').length, 0); context.wrapper.dispose();
});

test('reader cleanup failure cannot replace safe transport denial with raw details', async () => {
  const body = {getReader: () => ({read: async () => ({done: false, value: new Uint8Array(0)}),
    cancel: () => { throw new Error('fake-private-token'); }, releaseLock: () => { throw new Error('fake-private-token'); }})};
  await expectCode(transport(async () => response(brokerResult(), {body})).exchange(brokerRequest()), 'BROKER_RESPONSE_INVALID');
});


test('failed cleanup of a late sign-in latches denial until explicit confirmed repair', {timeout: 2000}, async () => {
  const gate = deferred(); let broken = true;
  const value = policy(); value.operationTimeoutMs = 40;
  const context = await harness({suppliedPolicy: value, sdkOverrides: {
    signInWithCustomToken: async instance => { await gate.promise; const user = {uid: 'member-a'}; instance.setUser(user); return {user}; },
    signOut: async instance => { if (broken) throw new Error('synthetic cleanup unavailable'); instance.setUser(null); }
  }});
  await expectCode(context.adapters.signInFb({expectedUid: 'member-a', customToken: 'fake-private-custom-token'}), 'BROWSER_OPERATION_TIMEOUT');
  gate.resolve(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.fbAuth.currentUser.uid, 'member-a');
  await expectCode(context.adapters.restoreFb(), 'FB_RECONCILIATION_REQUIRED');
  await expectCode(context.adapters.signInFb({expectedUid: 'member-a', customToken: 'fake-private-custom-token'}), 'FB_RECONCILIATION_REQUIRED');
  broken = false; await context.adapters.signOutFb({expectedUid: 'member-a'});
  assert.equal((await context.adapters.restoreFb()).user, null); context.wrapper.dispose();
});

test('composition restores, obtains broker session, invalidates changes/revocation and preserves pending logout', async () => {
  const pending = [{requestId: 'preserved-material-version-request'}], detached = [], states = [];
  let revoked = false, exchanges = 0;
  const bridge = transport(async (url, options) => { exchanges++; assert.deepEqual(JSON.parse(options.body), {faIdToken: 'fake-private-fa-token'}); return response(); });
  const context = await harness({transport: bridge, sourceOverride: data => revoked ? {...data, sourceVersion: 8, sourceHash: 'b'.repeat(64),
    profile: {...data.profile, active: false}, managementAllowed: false} : data});
  const session = createManagementSession({enabled: true, adapters: context.adapters, now: () => TIME,
    onState: state => states.push(state.status), onInvalidate: reason => detached.push(reason),
    beforeSignOut: async () => pending.length === 1 && pending[0].requestId === 'preserved-material-version-request'});
  const unobserve = context.wrapper.observeAuth(event => {
    // Negative-only context update: Auth UID/events never become permissions.
    session.updateContext({fa: {restored: true, online: false, user: event.faUid ? {uid: event.faUid} : null},
      fb: {restored: true, user: event.fbUid ? {uid: event.fbUid} : null, mirror: null}});
  });
  assert.equal((await session.restore()).status, 'needs-broker');
  assert.equal((await session.connect()).ready, true); assert.equal(exchanges, 1);
  context.faAuth.setUser({uid: 'different-account'});
  assert.equal(session.snapshot().status, 'blocked'); assert.equal(session.snapshot().ready, false);
  assert.equal(exchanges, 1); assert.equal(pending.length, 1);
  context.faAuth.setUser({uid: 'member-a'});
  assert.equal(session.snapshot().ready, false); assert.equal((await session.restore()).ready, true);
  revoked = true;
  // A fresh, budgeted source observation is explicit; no polling or positive Auth fallback.
  const confirmedRevoked = await context.adapters.restoreFa(); session.updateContext({fa: confirmedRevoked});
  assert.equal(session.snapshot().code, 'FA_PROFILE_REVOKED'); assert.equal((await session.connect()).ready, false);
  assert.equal(exchanges, 1); assert.equal((await session.signOut()).completed, true);
  assert.equal(context.faAuth.currentUser, null); assert.equal(context.fbAuth.currentUser, null);
  assert.deepEqual(pending, [{requestId: 'preserved-material-version-request'}]);
  assert.ok(states.includes('needs-broker') && states.includes('connecting') && states.includes('ready') && states.includes('blocked') && states.includes('signed-out'));
  assert.ok(detached.includes('context-changed') && detached.includes('logout'));
  unobserve(); context.wrapper.dispose();
});
