import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementSession} from '../src/management-session.js';

const TIME = 10000;
const binding = (uid = 'member-a') => ({faUid: uid, fbUid: uid, memberId: 'stable-' + uid, sourceProjectId: 'sahmt-17a16', destinationProjectId: 'sahmt-gestao-5ae66'});
const source = (uid = 'member-a') => ({restored: true, online: true, user: {uid}, profile: {uid, memberId: 'stable-' + uid, active: true, access: true}, managementAllowed: true, fromCache: false, hasPendingWrites: false, binding: binding(uid)});
const mirror = (uid = 'member-a') => ({...binding(uid), active: true, managementAllowed: true, confirmedAtMs: TIME - 1000, validUntilMs: TIME + 1000, fromCache: false, hasPendingWrites: false});
const destination = (uid = 'member-a') => ({restored: true, user: uid ? {uid} : null, mirror: uid ? mirror(uid) : null});
const brokerResponse = (uid = 'member-a') => ({...binding(uid), customToken: 'private-custom-token'});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({fa = source(), fb = destination(), overrides = {}, beforeSignOut, enabled = true, now} = {}) {
  const calls = [], events = [], invalidations = [];
  const adapters = {
    restoreFa: async () => { calls.push('restore-fa'); return fa; },
    restoreFb: async () => { calls.push('restore-fb'); return fb; },
    getFaIdToken: async request => { calls.push(['fa-token', request]); return 'private-fa-token'; },
    exchangeFaToken: async request => { calls.push(['broker', {...request, faIdToken: '[omitted]'}]); return brokerResponse(request.faUid); },
    signInFb: async request => { calls.push(['sign-in-fb', {expectedUid: request.expectedUid}]); assert.equal(request.customToken, 'private-custom-token'); return destination(request.expectedUid); },
    signOutFa: async request => { calls.push(['sign-out-fa', request]); },
    signOutFb: async request => { calls.push(['sign-out-fb', request]); },
    ...overrides
  };
  const session = createManagementSession({enabled, adapters, now: now || (() => TIME), beforeSignOut, onState: state => events.push(state), onInvalidate: reason => invalidations.push(reason)});
  return {session, calls, events, invalidations};
}
const called = (calls, name) => calls.filter(call => Array.isArray(call) && call[0] === name);

// These tests concern identity/authorization boundaries and race conditions,
// rather than Firebase mocks claiming production OAuth or Rules validation.
test('desligado por padrão não restaura, troca token, autentica ou sai', async () => {
  const calls = [];
  const forbidden = () => { calls.push('unexpected'); throw new Error('must not run'); };
  const session = createManagementSession({adapters: {restoreFa: forbidden, restoreFb: forbidden, getFaIdToken: forbidden, exchangeFaToken: forbidden, signInFb: forbidden, signOutFa: forbidden, signOutFb: forbidden}, beforeSignOut: forbidden});
  assert.equal((await session.restore()).status, 'disabled');
  assert.equal(session.updateContext({fa: source(), fb: destination()}).ready, false);
  assert.equal((await session.connect()).status, 'disabled');
  assert.equal((await session.signOut()).completed, false);
  assert.deepEqual(calls, []);
});

test('aguarda a restauração das duas instâncias antes de qualquer ponte', async () => {
  const restoredFa = deferred(), restoredFb = deferred();
  const {session, calls} = harness({overrides: {restoreFa: () => restoredFa.promise, restoreFb: () => restoredFb.promise}});
  const restoring = session.restore();
  restoredFa.resolve(source());
  await tick();
  assert.equal((await session.connect()).ready, false);
  assert.equal(called(calls, 'fa-token').length, 0);
  restoredFb.resolve(destination());
  assert.equal((await restoring).ready, true);
  assert.equal(called(calls, 'broker').length, 0);
});

test('duas sessões restauradas com vínculo explícito e espelho atual são reutilizadas', async () => {
  const {session, calls} = harness();
  assert.equal((await session.restore()).ready, true);
  assert.equal((await session.connect()).ready, true);
  assert.equal(called(calls, 'sign-in-fb').length, 0);
});

test('nega fonte offline, perfil ausente/revogado, cache, pendências e vínculo diferente', async t => {
  const cases = [
    ['FA_OFFLINE', fa => { fa.online = false; }],
    ['FA_PROFILE_MISSING', fa => { fa.profile = null; }],
    ['FA_PROFILE_REVOKED', fa => { fa.profile.active = false; }],
    ['FA_PROFILE_REVOKED', fa => { fa.profile.access = false; }],
    ['FA_PROFILE_NOT_CONFIRMED', fa => { fa.fromCache = true; }],
    ['FA_PROFILE_NOT_CONFIRMED', fa => { delete fa.hasPendingWrites; }],
    ['FA_PROFILE_NOT_CONFIRMED', fa => { fa.hasPendingWrites = true; }],
    ['FA_MANAGEMENT_DENIED', fa => { fa.managementAllowed = false; }],
    ['FA_IDENTITY_MISMATCH', fa => { fa.profile.uid = 'other'; }],
    ['IDENTITY_BINDING_INVALID', fa => { fa.binding.fbUid = 'other'; }],
    ['IDENTITY_BINDING_INVALID', fa => { fa.binding.memberId = 'other-member'; }],
    ['IDENTITY_BINDING_INVALID', fa => { fa.binding.sourceProjectId = 'foreign-project'; }]
  ];
  for (const [code, modify] of cases) await t.test(code, async () => {
    const fa = source(); modify(fa);
    const {session, calls} = harness({fa});
    assert.equal((await session.restore()).code, code);
    assert.equal((await session.connect()).ready, false);
    assert.equal(called(calls, 'fa-token').length, 0);
    assert.equal(called(calls, 'broker').length, 0);
  });
});

test('nega espelho ausente, revogado, cache, vínculo incorreto e lease inválido/vencido', async t => {
  const cases = [
    ['FB_MIRROR_MISSING', fb => { fb.mirror = null; }],
    ['FB_MIRROR_REVOKED', fb => { fb.mirror.active = false; }],
    ['FB_MIRROR_REVOKED', fb => { fb.mirror.managementAllowed = false; }],
    ['FB_MIRROR_NOT_CONFIRMED', fb => { fb.mirror.fromCache = true; }],
    ['FB_MIRROR_NOT_CONFIRMED', fb => { fb.mirror.hasPendingWrites = true; }],
    ['FB_MIRROR_IDENTITY_MISMATCH', fb => { fb.mirror.memberId = 'other'; }],
    ['FB_LEASE_EXPIRED', fb => { fb.mirror.validUntilMs = TIME; }],
    ['FB_LEASE_INVALID', fb => { fb.mirror.confirmedAtMs = TIME + 1; }],
    ['FB_LEASE_INVALID', fb => { fb.mirror.validUntilMs = fb.mirror.confirmedAtMs; }],
    ['FB_LEASE_INVALID', fb => { fb.mirror.validUntilMs = '11000'; }]
  ];
  for (const [code, modify] of cases) await t.test(code, async () => {
    const fb = destination(); modify(fb);
    const {session, calls} = harness({fb});
    assert.equal((await session.restore()).code, code);
    assert.equal((await session.connect()).code, code);
    assert.equal(called(calls, 'broker').length, 0);
  });
});

test('lease expira sem evento de Auth e snapshot deixa de liberar acesso', async () => {
  let time = TIME;
  const {session, invalidations} = harness({now: () => time});
  assert.equal((await session.restore()).ready, true);
  time = TIME + 1000;
  assert.equal(session.snapshot().code, 'FB_LEASE_EXPIRED');
  assert.equal(session.snapshot().ready, false);
  assert.equal(invalidations.filter(value => value === 'FB_LEASE_EXPIRED').length, 1);
});

test('FB de outro UID é encerrado sem broker ou reatribuição histórica', async () => {
  const {session, calls} = harness({fb: destination('other')});
  assert.equal((await session.restore()).code, 'FB_UID_MISMATCH');
  assert.equal((await session.connect()).ready, false);
  assert.equal(called(calls, 'sign-out-fb')[0][1].expectedUid, 'other');
  assert.equal(called(calls, 'broker').length, 0);
});

test('FB ausente sem broker demonstra indisponibilidade e não abre novo popup', async () => {
  const {session, calls} = harness({fb: destination(null), overrides: {exchangeFaToken: undefined}});
  assert.equal((await session.restore()).status, 'needs-broker');
  assert.equal((await session.connect()).code, 'BROKER_UNAVAILABLE');
  assert.equal(called(calls, 'fa-token').length, 0);
  assert.equal(called(calls, 'sign-in-fb').length, 0);
});

test('ponte conserva vínculo e só libera após Auth FB e espelho confirmado', async () => {
  const {session, calls, events} = harness({fb: destination(null)});
  await session.restore();
  const state = await session.connect();
  assert.equal(state.ready, true);
  assert.equal(state.faUid, state.fbUid);
  assert.equal(called(calls, 'fa-token')[0][1].forceRefresh, true);
  assert.equal(called(calls, 'broker').length, 1);
  assert.equal(called(calls, 'sign-in-fb').length, 1);
  assert.equal(JSON.stringify(events).includes('private-fa-token'), false);
  assert.equal(JSON.stringify(events).includes('private-custom-token'), false);
});

test('resposta de broker com identidade diferente falha antes do login', async () => {
  const {session, calls} = harness({fb: destination(null), overrides: {exchangeFaToken: async () => brokerResponse('other')}});
  await session.restore();
  assert.equal((await session.connect()).code, 'BROKER_RESPONSE_INVALID');
  assert.equal(called(calls, 'sign-in-fb').length, 0);
});

test('login FB com UID diferente ou mirror expirado é encerrado', async t => {
  for (const [code, target] of [
    ['FB_UID_MISMATCH', destination('other')],
    ['FB_LEASE_EXPIRED', {...destination(), mirror: {...mirror(), validUntilMs: TIME}}]
  ]) await t.test(code, async () => {
    const {session, calls} = harness({fb: destination(null), overrides: {signInFb: async () => target}});
    await session.restore();
    assert.equal((await session.connect()).code, code);
    assert.equal(called(calls, 'sign-out-fb').length, 1);
    assert.equal(session.snapshot().ready, false);
  });
});

test('erro bruto do broker nunca aparece em estado ou callback', async () => {
  const {session, events} = harness({fb: destination(null), overrides: {exchangeFaToken: async () => { throw new Error('private-fa-token private-custom-token'); }}});
  await session.restore();
  assert.equal((await session.connect()).code, 'BROKER_EXCHANGE_FAILED');
  assert.equal(JSON.stringify(events).includes('private-'), false);
});

test('não conserva campos de token em snapshots externos', async () => {
  const fa = {...source(), token: 'private-fa-token', user: {...source().user, accessToken: 'private-fa-token'}};
  const fb = {...destination(), customToken: 'private-custom-token'};
  const {session, events} = harness({fa, fb});
  await session.restore();
  assert.equal(JSON.stringify(events).includes('private-'), false);
  assert.equal(JSON.stringify(session.snapshot()).includes('token'), false);
});

test('connect simultâneo compartilha a tentativa em andamento', async () => {
  const broker = deferred();
  let brokerCalls = 0;
  const {session} = harness({fb: destination(null), overrides: {exchangeFaToken: () => { brokerCalls++; return broker.promise; }}});
  await session.restore();
  const first = session.connect(), second = session.connect();
  assert.equal(first, second);
  await tick();
  broker.resolve(brokerResponse());
  assert.equal((await first).ready, true);
  assert.equal(brokerCalls, 1);
});

test('logout durante broker invalida resposta tardia e encerra as duas instâncias', async () => {
  const broker = deferred();
  const {session, calls, events} = harness({fb: destination(null), overrides: {exchangeFaToken: () => broker.promise}});
  await session.restore();
  const connecting = session.connect();
  await tick();
  const result = await session.signOut();
  assert.equal(result.completed, true);
  broker.resolve(brokerResponse());
  await connecting;
  assert.equal(session.snapshot().status, 'signed-out');
  assert.equal(called(calls, 'sign-out-fa').length, 1);
  assert.equal(called(calls, 'sign-out-fb').length, 1);
  assert.equal(called(calls, 'sign-in-fb').length, 0);
  assert.equal(events.some(state => state.ready), false);
});

test('logout aguarda login em voo e sua limpeza, sem restaurar sessão no retorno tardio', async () => {
  const signingIn = deferred();
  let started = false;
  const {session, calls, events} = harness({fb: destination(null), overrides: {signInFb: () => { started = true; return signingIn.promise; }}});
  await session.restore();
  const connecting = session.connect();
  await tick();
  assert.equal(started, true);
  const leaving = session.signOut();
  await tick();
  assert.equal(called(calls, 'sign-out-fa').length, 0);
  signingIn.resolve(destination());
  await connecting;
  assert.equal((await leaving).completed, true);
  assert.equal(session.snapshot().status, 'signed-out');
  assert.equal(events.some(state => state.ready), false);
});

test('troca de conta durante broker ignora token do membro anterior', async () => {
  const brokerA = deferred();
  const signedIn = [];
  const {session} = harness({fb: destination(null), overrides: {
    exchangeFaToken: request => request.faUid === 'member-a' ? brokerA.promise : Promise.resolve(brokerResponse(request.faUid)),
    signInFb: async request => { signedIn.push(request.expectedUid); return destination(request.expectedUid); }
  }});
  await session.restore();
  const previous = session.connect();
  await tick();
  session.updateContext({fa: source('member-b'), fb: destination(null)});
  assert.equal((await session.connect()).ready, true);
  brokerA.resolve(brokerResponse());
  await previous;
  assert.deepEqual(signedIn, ['member-b']);
  assert.equal(session.snapshot().faUid, 'member-b');
  assert.equal(session.snapshot().fbUid, 'member-b');
});

test('troca de conta durante login serializa limpeza antiga antes do novo login', async () => {
  const signinA = deferred(), mutations = [];
  const {session} = harness({fb: destination(null), overrides: {
    signInFb: request => { mutations.push('in-' + request.expectedUid); return request.expectedUid === 'member-a' ? signinA.promise : Promise.resolve(destination(request.expectedUid)); },
    signOutFb: async request => { mutations.push('out-' + request.expectedUid); }
  }});
  await session.restore();
  const connectingA = session.connect();
  await tick();
  session.updateContext({fa: source('member-b'), fb: destination(null)});
  const connectingB = session.connect();
  await tick();
  assert.deepEqual(mutations, ['in-member-a']);
  signinA.resolve(destination());
  await connectingA;
  assert.equal((await connectingB).ready, true);
  assert.deepEqual(mutations, ['in-member-a', 'out-member-a', 'in-member-b']);
  assert.equal(session.snapshot().fbUid, 'member-b');
});

test('limpeza antiga falha fechada e cancela login novo em fila', async () => {
  const signinA = deferred(), signedIn = [];
  const {session} = harness({fb: destination(null), overrides: {
    signInFb: request => { signedIn.push(request.expectedUid); return request.expectedUid === 'member-a' ? signinA.promise : Promise.resolve(destination(request.expectedUid)); },
    signOutFb: async () => { throw new Error('cleanup rejected'); }
  }});
  await session.restore();
  const previous = session.connect();
  await tick();
  session.updateContext({fa: source('member-b'), fb: destination(null)});
  const next = session.connect();
  await tick();
  signinA.resolve(destination());
  await previous; await next;
  assert.deepEqual(signedIn, ['member-a']);
  assert.equal(session.snapshot().code, 'FB_CLEANUP_FAILED');
  assert.equal(session.snapshot().ready, false);
});

test('restauração antiga não substitui a conta atualizada', async () => {
  const old = deferred();
  const {session} = harness({overrides: {restoreFa: () => old.promise}});
  const restoring = session.restore();
  session.updateContext({fa: source('member-b'), fb: destination('member-b')});
  old.resolve(source());
  await restoring;
  assert.equal(session.snapshot().faUid, 'member-b');
  assert.equal(session.snapshot().ready, true);
});

test('callback de pendências pode preservar ações e cancelar logout antes das duas saídas', async () => {
  const localPending = [{requestId: 'stable-request', value: 'draft'}];
  const {session, calls} = harness({beforeSignOut: async request => { assert.equal(request.faUid, 'member-a'); assert.equal(localPending.length, 1); return false; }});
  await session.restore();
  const result = await session.signOut();
  assert.equal(result.cancelled, true);
  assert.equal(result.completed, false);
  assert.equal(session.snapshot().ready, true);
  assert.equal(called(calls, 'sign-out-fa').length, 0);
  assert.equal(called(calls, 'sign-out-fb').length, 0);
  assert.deepEqual(localPending, [{requestId: 'stable-request', value: 'draft'}]);
});

test('falha do callback de pendências nega saída sem tocar sessões nem outbox', async () => {
  const {session, calls} = harness({beforeSignOut: async () => { throw new Error('pending read unavailable'); }});
  await session.restore();
  assert.equal((await session.signOut()).completed, false);
  assert.equal(session.snapshot().code, 'PENDING_ACTIONS_CHECK_FAILED');
  assert.equal(called(calls, 'sign-out-fa').length, 0);
  assert.equal(called(calls, 'sign-out-fb').length, 0);
});

test('falha em uma saída ainda tenta a outra e não declara logout completo', async () => {
  const faOut = [], fbOut = [];
  const {session} = harness({overrides: {
    signOutFa: async request => { faOut.push(request.expectedUid); throw new Error('fa sign out failed'); },
    signOutFb: async request => { fbOut.push(request.expectedUid); }
  }});
  await session.restore();
  const result = await session.signOut();
  assert.equal(result.completed, false);
  assert.equal(result.state.code, 'SIGN_OUT_PARTIAL_FAILURE');
  assert.equal(result.state.ready, false);
  assert.deepEqual(faOut, ['member-a']);
  assert.deepEqual(fbOut, ['member-a']);
});

test('connect e refresh não reabrem acesso durante decisão pendente de logout', async () => {
  const pendingGuard = deferred();
  const {session, calls} = harness({beforeSignOut: () => pendingGuard.promise});
  await session.restore();
  const leaving = session.signOut();
  assert.equal(session.refresh().ready, false);
  assert.equal((await session.connect()).ready, false);
  assert.equal(called(calls, 'broker').length, 0);
  pendingGuard.resolve(true);
  assert.equal((await leaving).completed, true);
});

test('falha tardia de login também invalida snapshot FB observado durante a mutação', async () => {
  const signinA = deferred();
  const {session} = harness({fb: destination(null), overrides: {signInFb: () => signinA.promise}});
  await session.restore();
  const previous = session.connect();
  await tick();
  session.updateContext({fa: source('member-b'), fb: destination('member-b')});
  signinA.reject(new Error('partial sign in unavailable'));
  await previous;
  assert.equal(session.snapshot().ready, false);
  assert.equal(session.snapshot().code, 'FB_RECONCILIATION_REQUIRED');
});

test('invalidação nega acesso antes de callback síncrono de cancelamento', async () => {
  const observed = [];
  let session;
  session = createManagementSession({enabled: true, now: () => TIME, adapters: {restoreFa: async () => source(), restoreFb: async () => destination()}, onInvalidate: () => { observed.push(session.snapshot().ready); }});
  await session.restore();
  assert.equal(session.snapshot().ready, true);
  session.updateContext({fa: {...source(), online: false}});
  assert.equal(observed.at(-1), false);
});

test('callback síncrono de estado não cria uma segunda troca em andamento', async () => {
  const broker = deferred();
  let session, callbackPromise = null, brokerCalls = 0;
  session = createManagementSession({enabled: true, now: () => TIME, adapters: {
    restoreFa: async () => source(), restoreFb: async () => destination(null),
    getFaIdToken: async () => 'private-fa-token',
    exchangeFaToken: () => { brokerCalls++; return broker.promise; },
    signInFb: async () => destination(), signOutFb: async () => {}
  }, onState: state => { if (state.status === 'connecting' && !callbackPromise) callbackPromise = session.connect(); }});
  await session.restore();
  const result = session.connect();
  assert.equal(callbackPromise, result);
  await tick();
  broker.resolve(brokerResponse());
  assert.equal((await result).ready, true);
  assert.equal(brokerCalls, 1);
});
