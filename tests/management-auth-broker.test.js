import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementAuthBroker} from '../scripts/lib/management-auth-broker.js';
import {createManagementBrokerHttp} from '../scripts/lib/management-broker-http.js';

const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', TIME = 2000000;
const clone = value => JSON.parse(JSON.stringify(value));
const policy = () => ({schemaVersion: 1, version: 'approved-test-policy-v1', leaseDurationMs: 60000, maxSnapshotAgeMs: 5000, maxExecutionMs: 5000, cleanupTimeoutMs: 1000, maxFutureSkewMs: 0, readBudget: {dailyLimit: 35000, quotaTimezone: 'America/Los_Angeles', maxMeasurementAgeMs: 5000, applicationReserveReads: 100, metricLagReserveReads: 100, operationReadBounds: {readFaAuthorization: 6, readFbLease: 1, writeFbLease: 3, invalidateFbLease: 3}}});
const claims = () => ({uid: 'member-a', sub: 'member-a', aud: FA, iss: 'https://securetoken.google.com/' + FA, auth_time: 1990, iat: 1995, exp: 2100, email_verified: true, firebase: {sign_in_provider: 'google.com', identities: {'google.com': ['google-member-a']}}});
const binding = () => ({sourceProjectId: FA, destinationProjectId: FB, faUid: 'member-a', fbUid: 'member-a', memberId: 'stable-member-a'});
const source = (time = TIME) => ({
  schemaVersion: 1, projectId: FA, readTimeMs: time, fromCache: false, hasPendingWrites: false,
  consistentRead: true, coverageComplete: true, productionAuthorized: true, authorizationVersion: 7,
  authUser: {uid: 'member-a', disabled: false, emailVerified: true, googleUid: 'google-member-a', tokensValidAfterTimeMs: 0},
  profile: {uid: 'member-a', memberId: 'stable-member-a', active: true, access: true, role: 'profissional', permissions: {managementRead: true}},
  binding: binding(), areas: [], documentAccess: {active: false, groups: []}
});
const destinationUser = (time = TIME) => ({schemaVersion: 1, projectId: FB, readTimeMs: time, fromCache: false, hasPendingWrites: false,
  user: {uid: 'member-a', disabled: false, emailVerified: true, providerData: [{providerId: 'google.com', uid: 'google-member-a'}]}});
const noLease = (time = TIME) => ({schemaVersion: 1, projectId: FB, readTimeMs: time, fromCache: false, hasPendingWrites: false, exists: false, revision: null, lease: null});
const quotaDay = time => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(time));
let nextReservationId = 0;
const mockBudgetDebits = new Map();
const reservation = (request, time = TIME) => {
  const day = quotaDay(time), previous = mockBudgetDebits.get(request.projectId);
  const consumed = previous?.quotaDay === day ? previous.maximumReadsReserved : 0;
  mockBudgetDebits.set(request.projectId, {quotaDay: day, maximumReadsReserved: consumed + request.maximumReads});
  return {schemaVersion: 1, projectId: request.projectId, operation: request.operation,
    reservationId: 'reservation-' + (++nextReservationId), quotaTimezone: 'America/Los_Angeles',
    quotaDay: day, dailyLimit: request.dailyLimit, pausedRequiresReview: false, metricsComplete: true,
    measurementTimeMs: time, expiresAtMs: time + 10000, reservedReads: request.maximumReads,
    totalReadCount: 1000, outstandingReservedReads: request.maximumReads, unreportedConsumedReads: consumed,
    applicationReserveReads: 100, metricLagReserveReads: 100};
};
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };

function harness({overrides = {}, enabled = true, suppliedPolicy = policy(), initialLease = null} = {}) {
  const calls = [], audit = [], writes = [], cleanup = [];
  let time = TIME, stored = initialLease ? clone(initialLease) : null, revision = stored ? 'r-existing' : null, grant = 0;
  const reads = {fa: 0, fbUser: 0, lease: 0, verify: 0};
  const control = {
    now: () => time, advance: milliseconds => { time += milliseconds; },
    stored: () => stored ? clone(stored) : null,
    mutateLease: callback => { callback(stored); revision = 'r-mutated'; }
  };
  const adapters = {
    reserveFirestoreReads: async request => { calls.push(['reserve', request]); return reservation(request, time); },
    verifyFaIdToken: async (token, checkRevoked) => { reads.verify++; calls.push(['verify', {checkRevoked}]); assert.equal(token, 'fake-private-fa-token'); assert.equal(checkRevoked, true); return claims(); },
    readFaAuthorization: async request => { reads.fa++; calls.push(['source', request]); return source(time); },
    getFbUser: async request => { reads.fbUser++; calls.push(['fb-user', request]); return destinationUser(time); },
    readFbLease: async request => { reads.lease++; calls.push(['lease-read', request]); return stored ? {...noLease(time), exists: true, revision, lease: clone(stored)} : noLease(time); },
    createFbCustomToken: async (uid, tokenClaims) => { calls.push(['sign', {uid, claims: clone(tokenClaims)}]); return 'fake-private-custom-token'; },
    writeFbLease: async request => {
      calls.push(['write', {uid: request.uid, expectedRevision: request.expectedRevision}]);
      if (request.expectedRevision !== revision) return {applied: false};
      stored = clone(request.lease); revision = 'r-' + stored.leaseVersion; writes.push(clone(request));
      return {applied: true, projectId: FB, revision};
    },
    invalidateFbLease: async request => {
      cleanup.push(clone(request));
      if (!stored || stored.grantId !== request.expectedGrantId || stored.leaseVersion !== request.expectedLeaseVersion) return {applied: false, matched: false, fenced: true};
      stored.active = false; stored.managementAllowed = false; stored.validUntilMs = Math.min(stored.validUntilMs, time); revision = 'r-invalidated';
      return {applied: true, fenced: true};
    },
    ...overrides
  };
  const broker = createManagementAuthBroker({enabled, policy: suppliedPolicy, adapters, clock: () => time, newGrantId: () => 'grant-' + (++grant), onAudit: event => audit.push(event)});
  return {broker, adapters, calls, reads, audit, writes, cleanup, control};
}
const exchange = broker => broker.exchange({faIdToken: 'fake-private-fa-token'});
const called = (calls, name) => calls.filter(call => call[0] === name);

// All Auth/Firestore adapters below are local doubles; this suite is not proof
// of hosted service, IAM, real token verification or live Security Rules.
test('broker desativado por padrão não verifica, lê, assina ou grava', async () => {
  const calls = [];
  const never = () => { calls.push('unexpected'); throw new Error('must not run'); };
  const broker = createManagementAuthBroker({adapters: {verifyFaIdToken: never, readFaAuthorization: never, getFbUser: never, readFbLease: never, createFbCustomToken: never, writeFbLease: never, invalidateFbLease: never}, clock: never});
  assert.equal((await exchange(broker)).code, 'BROKER_DISABLED');
  assert.deepEqual(calls, []);
});

test('política explícita e conjunto inteiro de adaptadores são obrigatórios', async t => {
  for (const suppliedPolicy of [null, {}, {...policy(), leaseDurationMs: 0}, {...policy(), maxSnapshotAgeMs: '5000'}, {...policy(), maxExecutionMs: -1}]) await t.test('policy', async () => {
    const {broker, calls} = harness({suppliedPolicy});
    const result = await exchange(broker);
    assert.equal(result.ok, false);
    assert.equal(called(calls, 'verify').length, 0);
  });
  const {broker, calls} = harness({overrides: {invalidateFbLease: undefined}});
  assert.equal((await exchange(broker)).code, 'BROKER_ADAPTER_UNAVAILABLE');
  assert.equal(called(calls, 'verify').length, 0);
});

test('ignora UIDs/permissões/expiração falsos do corpo e deriva tudo da fonte servidor', async () => {
  const {broker, writes, calls, audit} = harness();
  const result = await broker.exchange({faIdToken: 'fake-private-fa-token', faUid: 'attacker', fbUid: 'attacker', memberId: 'attacker', permissions: {admin: true}, role: 'administrador_app', validUntilMs: Number.MAX_SAFE_INTEGER, sourceProjectId: 'foreign'});
  assert.equal(result.ok, true);
  assert.equal(result.faUid, 'member-a');
  assert.equal(result.fbUid, 'member-a');
  assert.equal(result.memberId, 'stable-member-a');
  assert.equal(result.customToken, 'fake-private-custom-token');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].lease.permissions.admin, false);
  assert.equal(writes[0].lease.permissions.managementRead, true);
  assert.equal(writes[0].lease.validUntilMs, TIME + policy().leaseDurationMs);
  assert.equal(called(calls, 'sign')[0][1].uid, 'member-a');
  assert.equal(Object.hasOwn(called(calls, 'sign')[0][1].claims, 'permissions'), false);
  assert.equal(called(calls, 'verify').length, 3);
  assert.equal(JSON.stringify(audit).includes('fake-private'), false);
});

test('token rejeitado/revogado nunca chega ao leitor de autorização', async () => {
  const {broker, calls} = harness({overrides: {verifyFaIdToken: async (token, checkRevoked) => { assert.equal(checkRevoked, true); throw new Error('fake-private-fa-token revoked'); }}});
  assert.equal((await exchange(broker)).code, 'FA_TOKEN_REJECTED');
  assert.equal(called(calls, 'source').length, 0);
  assert.equal(called(calls, 'sign').length, 0);
});

test('nega audiência/emissor/provedor/tempo/UID inválidos no resultado verificado', async t => {
  const cases = [
    ['FA_TOKEN_PROJECT_INVALID', value => { value.aud = FB; }],
    ['FA_TOKEN_PROJECT_INVALID', value => { value.iss = 'https://attacker.example'; }],
    ['FA_TOKEN_IDENTITY_INVALID', value => { value.sub = 'other'; }],
    ['FA_TOKEN_PROVIDER_INVALID', value => { value.firebase.sign_in_provider = 'custom'; }],
    ['FA_TOKEN_PROVIDER_INVALID', value => { value.email_verified = false; }],
    ['FA_TOKEN_TIME_INVALID', value => { value.exp = TIME / 1000; }],
    ['FA_TOKEN_TIME_INVALID', value => { value.iat = TIME / 1000 + 1; }],
    ['FA_TOKEN_TIME_INVALID', value => { value.auth_time = value.iat + 1; }],
    ['FA_GOOGLE_IDENTITY_INVALID', value => { value.firebase.identities['google.com'] = ['a', 'b']; }]
  ];
  for (const [code, modify] of cases) await t.test(code, async () => {
    const value = claims(); modify(value);
    const {broker, calls} = harness({overrides: {verifyFaIdToken: async () => value}});
    assert.equal((await exchange(broker)).code, code);
    assert.equal(called(calls, 'source').length, 0);
    assert.equal(called(calls, 'sign').length, 0);
  });
});

test('nega fonte parcial/cache/desatualizada/perfil revogado/vínculo divergente', async t => {
  const cases = [
    ['FA_AUTHORIZATION_NOT_FRESH', value => { value.fromCache = true; }],
    ['FA_AUTHORIZATION_NOT_FRESH', value => { value.hasPendingWrites = true; }],
    ['FA_AUTHORIZATION_NOT_FRESH', value => { value.readTimeMs -= 5001; }],
    ['FA_AUTHORIZATION_NOT_FRESH', value => { value.projectId = FB; }],
    ['FA_AUTHORIZATION_INCOMPLETE', value => { value.coverageComplete = false; }],
    ['FA_AUTHORIZATION_INCOMPLETE', value => { value.consistentRead = false; }],
    ['FA_PRODUCTION_AUTHORIZATION_REQUIRED', value => { value.productionAuthorized = false; }],
    ['FA_PRODUCTION_AUTHORIZATION_REQUIRED', value => { delete value.authorizationVersion; }],
    ['FA_PROFILE_REVOKED_OR_MISSING', value => { value.profile.active = false; }],
    ['FA_PROFILE_REVOKED_OR_MISSING', value => { value.profile.access = false; }],
    ['FA_MEMBER_BINDING_INVALID', value => { value.binding.memberId = 'other'; }],
    ['FA_MEMBER_BINDING_INVALID', value => { value.binding.fbUid = 'other'; }],
    ['FA_AUTH_USER_INVALID', value => { value.authUser.disabled = true; }],
    ['FA_AUTH_USER_INVALID', value => { value.authUser.googleUid = 'other'; }],
    ['FA_SESSION_REVOKED', value => { value.authUser.tokensValidAfterTimeMs = TIME; }]
  ];
  for (const [code, modify] of cases) await t.test(code, async () => {
    const value = source(); modify(value);
    const {broker, calls, writes} = harness({overrides: {readFaAuthorization: async () => value}});
    assert.equal((await exchange(broker)).code, code);
    assert.equal(called(calls, 'sign').length, 0);
    assert.equal(writes.length, 0);
  });
});

test('Google Auth sozinho não concede nenhuma permissão de Gestão', async () => {
  const value = source(); value.profile.permissions = {};
  const {broker, calls} = harness({overrides: {readFaAuthorization: async () => value}});
  assert.equal((await exchange(broker)).code, 'FA_MANAGEMENT_DENIED');
  assert.equal(called(calls, 'sign').length, 0);
});

test('preserva direitos de área/grupo sem elevar participante comum a administrador', async () => {
  const value = source(); value.profile.permissions = {};
  value.areas = [{id: 'area-quality', active: true, version: 3, memberUids: ['member-a'], managerUids: []}];
  value.documentAccess = {active: true, googleUid: 'google-member-a', groups: ['GENERAL']};
  const {broker, writes} = harness({overrides: {readFaAuthorization: async () => value}});
  assert.equal((await exchange(broker)).ok, true);
  assert.equal(writes[0].lease.permissions.admin, false);
  assert.equal(writes[0].lease.permissions.managementManage, false);
  assert.deepEqual(writes[0].lease.memberAreaIds, ['area-quality']);
  assert.deepEqual(writes[0].lease.managerAreaIds, []);
  assert.deepEqual(writes[0].lease.documentGroups, ['GENERAL']);
});

test('nega grupos indevidos/relação incompleta e ignora áreas/grupos revogados', async t => {
  await t.test('grupo inválido', async () => {
    const value = source(); value.documentAccess = {active: true, googleUid: 'google-member-a', groups: ['ADMIN']};
    const {broker} = harness({overrides: {readFaAuthorization: async () => value}});
    assert.equal((await exchange(broker)).code, 'FA_DOCUMENT_ACCESS_INVALID');
  });
  await t.test('grupo de outra identidade', async () => {
    const value = source(); value.documentAccess = {active: true, googleUid: 'other', groups: ['GENERAL']};
    const {broker} = harness({overrides: {readFaAuthorization: async () => value}});
    assert.equal((await exchange(broker)).code, 'FA_DOCUMENT_ACCESS_IDENTITY_INVALID');
  });
  await t.test('área inválida', async () => {
    const value = source(); value.areas = [{id: 'area', active: true, version: 3, memberUids: ['member-a'], managerUids: ['member-a', 'member-a']}];
    const {broker} = harness({overrides: {readFaAuthorization: async () => value}});
    assert.equal((await exchange(broker)).code, 'FA_AREA_RELATIONS_INVALID');
  });
  await t.test('fontes revogadas não dão direitos', async () => {
    const value = source(); value.profile.permissions = {};
    value.areas = [{id: 'area', active: false, version: 3, memberUids: ['member-a'], managerUids: ['member-a']}];
    value.documentAccess = {active: false, groups: ['GENERAL']};
    const {broker} = harness({overrides: {readFaAuthorization: async () => value}});
    assert.equal((await exchange(broker)).code, 'FA_MANAGEMENT_DENIED');
  });
});

test('nega Auth FB ausente/desativado/outra identidade sem criar ou importar usuário', async t => {
  const cases = [
    ['FB_AUTH_USER_MISSING', value => { value.user = null; }],
    ['FB_AUTH_USER_INVALID', value => { value.user.disabled = true; }],
    ['FB_AUTH_USER_INVALID', value => { value.user.uid = 'other'; }],
    ['FB_GOOGLE_IDENTITY_MISMATCH', value => { value.user.providerData[0].uid = 'other'; }],
    ['FB_GOOGLE_IDENTITY_MISMATCH', value => { value.user.providerData.push({providerId: 'password', uid: 'extra'}); }],
    ['FB_AUTH_USER_NOT_FRESH', value => { value.readTimeMs -= 5001; }]
  ];
  for (const [code, modify] of cases) await t.test(code, async () => {
    const value = destinationUser(); modify(value);
    const {broker, calls} = harness({overrides: {getFbUser: async () => value}});
    assert.equal((await exchange(broker)).code, code);
    assert.equal(called(calls, 'sign').length, 0);
    assert.equal(called(calls, 'write').length, 0);
  });
});

test('mudança de autorização após assinatura nega antes da escrita', async () => {
  let reads = 0;
  const {broker, writes, cleanup} = harness({overrides: {readFaAuthorization: async () => { const value = source(); if (++reads > 1) { value.authorizationVersion++; value.profile.permissions.qualityManage = true; } return value; }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FA_AUTHORIZATION_CHANGED');
  assert.equal(Object.hasOwn(result, 'customToken'), false);
  assert.equal(writes.length, 0);
  assert.equal(cleanup.length, 0);
});

test('revogação FA após commit invalida somente o próprio grant e nunca retorna token', async () => {
  let verification = 0;
  const {broker, cleanup, control, audit} = harness({overrides: {verifyFaIdToken: async (token, checkRevoked) => { assert.equal(checkRevoked, true); if (++verification === 3) throw new Error('fake-private-fa-token revoked'); return claims(); }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FA_TOKEN_REJECTED');
  assert.equal(result.ok, false);
  assert.equal(Object.hasOwn(result, 'customToken'), false);
  assert.equal(cleanup.length, 1);
  assert.equal(cleanup[0].expectedGrantId, 'grant-1');
  assert.equal(control.stored().active, false);
  assert.equal(JSON.stringify(audit).includes('fake-private'), false);
});

test('mudança de direitos depois da escrita cancela lease sem estender prazo', async () => {
  let reads = 0;
  const {broker, writes, cleanup, control} = harness({overrides: {readFaAuthorization: async () => { const value = source(); if (++reads > 2) value.profile.access = false; return value; }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FA_PROFILE_REVOKED_OR_MISSING');
  assert.equal(cleanup.length, 1);
  assert.equal(control.stored().active, false);
  assert.equal(writes[0].lease.validUntilMs, TIME + 60000);
});

test('timeout da escrita é tratado como possível commit e exige limpeza condicional', async () => {
  const cleanup = [];
  const {broker} = harness({overrides: {
    writeFbLease: async () => { throw new Error('transport timeout after commit'); },
    invalidateFbLease: async request => { cleanup.push(request); return {applied: true, fenced: true}; }
  }});
  const result = await exchange(broker);
  assert.equal(result.code, 'FB_LEASE_WRITE_FAILED');
  assert.equal(result.ok, false);
  assert.equal(cleanup.length, 1);
  assert.equal(cleanup[0].expectedGrantId, 'grant-1');
});

test('conflito CAS confirmado não revoga grant concorrente', async () => {
  const {broker, cleanup} = harness({overrides: {writeFbLease: async () => ({applied: false})}});
  assert.equal((await exchange(broker)).code, 'FB_LEASE_CAS_CONFLICT');
  assert.equal(cleanup.length, 0);
});

test('readback divergente não devolve token e a limpeza respeita grant mais novo', async () => {
  let reads = 0;
  const {broker, cleanup} = harness({overrides: {
    readFbLease: async () => {
      if (++reads === 1) return noLease();
      return {...noLease(), exists: true, revision: 'r-concurrent', lease: {grantId: 'newer-grant', leaseVersion: 2}};
    },
    invalidateFbLease: async request => { cleanup.push(request); return {applied: false, matched: false, fenced: true}; }
  }});
  const result = await exchange(broker);
  assert.equal(result.code, 'FB_LEASE_COMMIT_CHANGED');
  assert.equal(Object.hasOwn(result, 'customToken'), false);
  assert.equal(cleanup[0].expectedGrantId, 'grant-1');
  assert.equal(cleanup[0].expectedLeaseVersion, 1);
});

test('falha de limpeza marca reconciliação pendente e continua sem entregar token', async () => {
  let reads = 0;
  const {broker} = harness({overrides: {
    readFaAuthorization: async () => { const value = source(); if (++reads > 2) value.profile.active = false; return value; },
    invalidateFbLease: async () => { throw new Error('privileged write unavailable'); }
  }});
  const result = await exchange(broker);
  assert.equal(result.code, 'FB_LEASE_CLEANUP_FAILED');
  assert.equal(result.requiresReconciliation, true);
  assert.equal(result.ok, false);
  assert.equal(Object.hasOwn(result, 'customToken'), false);
});

test('renovação explícita usa CAS e incrementa versão sem mudar UID ou importar', async () => {
  const {broker, writes, control} = harness();
  assert.equal((await exchange(broker)).ok, true);
  const first = control.stored();
  assert.equal((await exchange(broker)).ok, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedRevision, 'r-1');
  assert.equal(writes[1].lease.leaseVersion, 2);
  assert.equal(writes[1].lease.sourceHash, first.sourceHash);
  assert.equal(writes[1].lease.sourceVersion, first.sourceVersion);
});

test('fonte não pode regredir ou mudar direito sem atualizar versão', async t => {
  for (const mode of ['regress', 'unversioned-right']) await t.test(mode, async () => {
    let changed = false;
    const {broker, writes} = harness({overrides: {readFaAuthorization: async () => {
      const value = source();
      if (changed && mode === 'regress') value.authorizationVersion--;
      if (changed && mode === 'unversioned-right') value.profile.permissions.qualityManage = true;
      return value;
    }}});
    assert.equal((await exchange(broker)).ok, true);
    changed = true;
    assert.equal((await exchange(broker)).code, mode === 'regress' ? 'FA_AUTHORIZATION_VERSION_STALE' : 'FA_AUTHORIZATION_VERSION_INCONSISTENT');
    assert.equal(writes.length, 1);
  });
});

test('tombstone de revogação impede rearmar a mesma versão', async () => {
  const {broker, control, writes} = harness();
  assert.equal((await exchange(broker)).ok, true);
  control.mutateLease(value => { value.active = false; value.revoked = true; });
  assert.equal((await exchange(broker)).code, 'FB_AUTHORIZATION_REVOKED');
  assert.equal(writes.length, 1);
});

test('deadline é fixo e trabalho lento não ganha extensão ou retry automático', async () => {
  let advance;
  const {broker, writes, control, calls} = harness({overrides: {createFbCustomToken: async () => { advance(); return 'fake-private-custom-token'; }}});
  advance = () => control.advance(5001);
  assert.equal((await exchange(broker)).code, 'BROKER_DEADLINE_EXCEEDED');
  assert.equal(writes.length, 0);
  assert.equal(called(calls, 'verify').length, 1);
});

test('broker não serializa token ou erro bruto em auditoria/negação', async () => {
  const {broker, audit} = harness({overrides: {readFaAuthorization: async () => { throw new Error('fake-private-fa-token fake-private-custom-token'); }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FA_AUTHORIZATION_READ_FAILED');
  assert.equal(JSON.stringify(result).includes('fake-private'), false);
  assert.equal(JSON.stringify(audit).includes('fake-private'), false);
});

test('requisições concorrentes compartilham leitura, mas só uma ganha o CAS', async () => {
  const gate = deferred();
  let waiting = 0, winningRevision = null, winningLease = null;
  const {broker, cleanup} = harness({overrides: {
    createFbCustomToken: async () => { if (++waiting === 2) gate.resolve(); await gate.promise; return 'fake-private-custom-token'; },
    readFbLease: async () => winningLease ? {...noLease(), exists: true, revision: winningRevision, lease: clone(winningLease)} : noLease(),
    writeFbLease: async request => {
      if (request.expectedRevision !== winningRevision) return {applied: false};
      winningLease = clone(request.lease); winningRevision = 'winner-revision';
      return {applied: true, projectId: FB, revision: winningRevision};
    }
  }});
  const results = await Promise.all([exchange(broker), exchange(broker)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, 'FB_LEASE_CAS_CONFLICT');
  assert.equal(cleanup.length, 0);
  assert.equal(winningLease.fbUid, 'member-a');
});


test('instância habilitada sem política explícita nega antes de serviços', async () => {
  let invoked = false;
  const broker = createManagementAuthBroker({enabled: true, adapters: {verifyFaIdToken: async () => { invoked = true; return claims(); }}});
  assert.equal((await exchange(broker)).code, 'BROKER_POLICY_REQUIRED');
  assert.equal(invoked, false);
});

test('token em URL ou outro campo não serve de corpo de autenticação', async () => {
  const {broker, calls} = harness();
  assert.equal((await broker.exchange({url: 'https://example.invalid/?token=fake-private-fa-token', token: 'fake-private-fa-token'})).code, 'FA_TOKEN_REQUIRED');
  assert.equal(called(calls, 'verify').length, 0);
});


test('orçamento explícito por projeto e limites de operação são obrigatórios antes do Auth', async t => {
  const cases = [
    value => { delete value.readBudget; },
    value => { value.readBudget.dailyLimit = 50000; },
    value => { value.readBudget.quotaTimezone = 'America/Sao_Paulo'; },
    value => { value.readBudget.applicationReserveReads = 0; },
    value => { value.readBudget.metricLagReserveReads = 0; },
    value => { delete value.readBudget.operationReadBounds.readFaAuthorization; },
    value => { value.readBudget.operationReadBounds.writeFbLease = 34999; }
  ];
  for (const change of cases) await t.test('budget-policy', async () => {
    const value = policy(); change(value);
    const {broker, calls} = harness({suppliedPolicy: value});
    assert.equal((await exchange(broker)).ok, false);
    assert.equal(called(calls, 'verify').length, 0);
    assert.equal(called(calls, 'source').length, 0);
  });
});

test('cada unidade Firestore recebe reserva fresca antes de executar; Auth não consome reserva Firestore', async () => {
  const requests = [];
  const {broker, calls} = harness({overrides: {readFaAuthorization: async (request, context) => {
    requests.push(context); return source();
  }}});
  assert.equal((await exchange(broker)).ok, true);
  const reserved = called(calls, 'reserve').map(([, request]) => request);
  assert.deepEqual(reserved.map(request => request.operation), ['readFaAuthorization', 'readFbLease', 'readFaAuthorization', 'writeFbLease', 'readFaAuthorization', 'readFbLease']);
  assert.deepEqual(reserved.map(request => request.projectId), [FA, FB, FA, FB, FA, FB]);
  assert.equal(called(calls, 'fb-user').length, 3);
  assert.equal(called(calls, 'verify').length, 3);
  for (const context of requests) {
    assert.equal(context.firestoreReservation.maximumReads, 6);
    assert.equal(context.firestoreReservation.projectId, FA);
    assert.equal(context.signal.aborted, false);
  }
});

test('pausa, medida incompleta/antiga, dia/projeto errado ou margem insuficiente negam antes da próxima leitura', async t => {
  const cases = [
    value => { value.pausedRequiresReview = true; },
    value => { value.metricsComplete = false; },
    value => { value.measurementTimeMs -= 5001; },
    value => { value.quotaDay = '2099-01-01'; },
    value => { value.projectId = FB; },
    value => { value.expiresAtMs = TIME; },
    value => { value.reservedReads--; },
    value => { value.outstandingReservedReads = 0; },
    value => { value.applicationReserveReads = 99; },
    value => { value.metricLagReserveReads = 99; },
    value => { value.totalReadCount = 34800; }
  ];
  for (const change of cases) await t.test('receipt', async () => {
    const {broker, calls} = harness({overrides: {reserveFirestoreReads: async request => {
      const value = reservation(request); change(value); return value;
    }}});
    const result = await exchange(broker);
    assert.equal(result.code, 'FIRESTORE_READ_BUDGET_DENIED');
    assert.equal(called(calls, 'source').length, 0);
    assert.equal(called(calls, 'write').length, 0);
  });
});

test('falha da guarda não tenta leitura e negação pré-escrita não exige limpeza', async () => {
  const {broker, calls, cleanup} = harness({overrides: {reserveFirestoreReads: async () => { throw new Error('quota paused'); }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FIRESTORE_READ_BUDGET_UNAVAILABLE');
  assert.equal(called(calls, 'source').length, 0);
  assert.equal(cleanup.length, 0);
});

test('guarda da escrita nega sem executar nem tratar como commit desconhecido', async () => {
  const {broker, calls, cleanup} = harness({overrides: {reserveFirestoreReads: async request => {
    const value = reservation(request);
    if (request.operation === 'writeFbLease') value.pausedRequiresReview = true;
    return value;
  }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FIRESTORE_READ_BUDGET_DENIED');
  assert.equal(result.requiresReconciliation, false);
  assert.equal(called(calls, 'write').length, 0);
  assert.equal(cleanup.length, 0);
});

test('limpeza também respeita a pausa diária; falha exige reconciliação sem token', async () => {
  let reads = 0;
  const {broker, cleanup} = harness({overrides: {
    readFaAuthorization: async () => { const value = source(); if (++reads > 2) value.profile.active = false; return value; },
    reserveFirestoreReads: async request => {
      const value = reservation(request); if (request.operation === 'invalidateFbLease') value.pausedRequiresReview = true; return value;
    }
  }});
  const result = await exchange(broker);
  assert.equal(result.code, 'FB_LEASE_CLEANUP_FAILED');
  assert.equal(result.requiresReconciliation, true);
  assert.equal(Object.hasOwn(result, 'customToken'), false);
  assert.equal(cleanup.length, 0);
});

test('adaptador que nunca resolve é encerrado por prazo real mesmo com clock lógico imóvel', {timeout: 2000}, async () => {
  let signal;
  const value = policy(); value.maxExecutionMs = 60;
  const {broker, calls} = harness({suppliedPolicy: value, overrides: {verifyFaIdToken: (token, checkRevoked, context) => {
    signal = context.signal; return new Promise(() => {});
  }}});
  const before = performance.now();
  const result = await exchange(broker);
  assert.equal(result.code, 'BROKER_DEADLINE_EXCEEDED');
  assert.equal(signal.aborted, true);
  assert.equal(called(calls, 'source').length, 0);
  assert.ok(performance.now() - before < 1000);
});

test('escrita pendurada usa limpeza com fence que impede commit tardio do mesmo grant', {timeout: 2000}, async () => {
  const gate = deferred(); let fenced = false, committed = false, signal;
  const value = policy(); value.maxExecutionMs = 80; value.cleanupTimeoutMs = 80;
  const {broker} = harness({suppliedPolicy: value, overrides: {
    writeFbLease: async (request, context) => {
      signal = context.signal; await gate.promise;
      if (!fenced) committed = true;
      return {applied: !fenced, projectId: FB, revision: 'late'};
    },
    invalidateFbLease: async () => { fenced = true; return {applied: false, matched: false, fenced: true}; }
  }});
  const result = await exchange(broker);
  assert.equal(result.code, 'BROKER_DEADLINE_EXCEEDED');
  assert.equal(result.requiresReconciliation, false);
  assert.equal(signal.aborted, true);
  gate.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(committed, false);
  assert.equal(Object.hasOwn(result, 'customToken'), false);
});

test('limpeza sem fence comprovado exige reconciliação mesmo quando afirma applied', async () => {
  const {broker} = harness({overrides: {writeFbLease: async () => { throw new Error('unknown commit'); }, invalidateFbLease: async () => ({applied: true})}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FB_LEASE_CLEANUP_FAILED');
  assert.equal(result.requiresReconciliation, true);
});

test('limpeza pendurada tem prazo próprio limitado e nunca bloqueia a resposta', {timeout: 2000}, async () => {
  let reads = 0, signal;
  const value = policy(); value.cleanupTimeoutMs = 60;
  const {broker} = harness({suppliedPolicy: value, overrides: {
    readFaAuthorization: async () => { const snapshot = source(); if (++reads > 2) snapshot.profile.active = false; return snapshot; },
    invalidateFbLease: (request, context) => { signal = context.signal; return new Promise(() => {}); }
  }});
  const result = await exchange(broker);
  assert.equal(result.code, 'FB_LEASE_CLEANUP_FAILED');
  assert.equal(result.requiresReconciliation, true);
  assert.equal(signal.aborted, true);
});


test('reserva não pode ser gasta duas vezes na mesma troca', async () => {
  let reused;
  const {broker, writes, cleanup} = harness({overrides: {reserveFirestoreReads: async request => {
    const value = reservation(request);
    if (request.operation === 'readFaAuthorization') { reused ??= value.reservationId; value.reservationId = reused; }
    return value;
  }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FIRESTORE_RESERVATION_REUSED');
  assert.equal(writes.length, 0);
  assert.equal(cleanup.length, 0);
});

test('novos IDs com contagem agregada constante não criam margem artificial', async () => {
  const {broker, writes} = harness({overrides: {reserveFirestoreReads: async request => {
    const value = reservation(request); value.unreportedConsumedReads = 0; return value;
  }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FIRESTORE_RESERVATION_ACCOUNTING_INCOMPLETE');
  assert.equal(writes.length, 0);
});

test('reservas também não são reutilizáveis entre trocas na mesma instância', async () => {
  let firstId, sourceReservations = 0;
  const {broker, writes} = harness({overrides: {reserveFirestoreReads: async request => {
    const value = reservation(request);
    if (request.operation === 'readFaAuthorization') {
      firstId ??= value.reservationId;
      if (++sourceReservations === 4) value.reservationId = firstId;
    }
    return value;
  }}});
  assert.equal((await exchange(broker)).ok, true);
  assert.equal((await exchange(broker)).code, 'FIRESTORE_RESERVATION_REUSED');
  assert.equal(writes.length, 1);
});

test('trocas concorrentes na instância não consomem o mesmo ID de reserva', async () => {
  let firstId, reservations = 0;
  const {broker, writes} = harness({overrides: {reserveFirestoreReads: async request => {
    const value = reservation(request);
    if (request.operation === 'readFaAuthorization' && ++reservations <= 2) {
      firstId ??= value.reservationId; value.reservationId = firstId;
    }
    return value;
  }}});
  const results = await Promise.all([exchange(broker), exchange(broker)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, 'FIRESTORE_RESERVATION_REUSED');
  assert.equal(writes.length, 1);
});

test('consumo não refletido ainda precisa caber junto com margens do app/métrica', async () => {
  const {broker, calls} = harness({overrides: {reserveFirestoreReads: async request => {
    const value = reservation(request); value.unreportedConsumedReads = 35000; return value;
  }}});
  assert.equal((await exchange(broker)).code, 'FIRESTORE_READ_BUDGET_DENIED');
  assert.equal(called(calls, 'source').length, 0);
});

test('conclusão após expiração lógica da reserva nega mesmo antes do prazo de parede', async () => {
  let control;
  const value = policy();
  const context = harness({suppliedPolicy: value, overrides: {
    reserveFirestoreReads: async request => { const receipt = reservation(request); receipt.expiresAtMs = TIME + 10; return receipt; },
    readFaAuthorization: async () => { control.advance(11); return source(control.now()); }
  }});
  control = context.control;
  assert.equal((await exchange(context.broker)).code, 'BROKER_DEADLINE_EXCEEDED');
  assert.equal(context.writes.length, 0);
});

test('conclusão da limpeza após seu limite lógico exige reconciliação', async () => {
  let reads = 0, control;
  const value = policy(); value.cleanupTimeoutMs = 100;
  const context = harness({suppliedPolicy: value, overrides: {
    readFaAuthorization: async () => { const snapshot = source(); if (++reads > 2) snapshot.profile.active = false; return snapshot; },
    invalidateFbLease: async () => { control.advance(101); return {applied: true, fenced: true}; }
  }});
  control = context.control;
  const result = await exchange(context.broker);
  assert.equal(result.code, 'FB_LEASE_CLEANUP_FAILED');
  assert.equal(result.requiresReconciliation, true);
});


test('piso incorpora medição maior e nega regressão no mesmo dia de cota', async () => {
  let faReservations = 0;
  const {broker, writes, cleanup} = harness({overrides: {reserveFirestoreReads: async request => {
    const value = reservation(request);
    if (request.projectId === FA) {
      const call = ++faReservations;
      value.totalReadCount = call === 2 ? 30000 : 1000;
      value.unreportedConsumedReads = call === 3 ? 30000 : 20;
    }
    return value;
  }}});
  const result = await exchange(broker);
  assert.equal(result.code, 'FIRESTORE_READ_MEASUREMENT_REGRESSED');
  assert.equal(writes.length, 1);
  assert.equal(cleanup.length, 1);
  assert.equal(Object.hasOwn(result, 'customToken'), false);
});

test('requisição cancelada antes da troca não chama adaptadores',async()=>{
  const controller=new AbortController();controller.abort();const {broker,calls}=harness();
  const result=await broker.exchange({faIdToken:'fake-private-fa-token'},{signal:controller.signal});
  assert.equal(result.code,'BROKER_REQUEST_CANCELLED');assert.deepEqual(calls,[]);
});
test('cancelamento de verificador travado aborta e encerra sem prazo adicional',async()=>{
  const controller=new AbortController();let adapterSignal;
  const {broker,reads}=harness({overrides:{verifyFaIdToken:(_token,_check,context)=>{adapterSignal=context.signal;controller.abort();return new Promise(()=>{});}}});
  const result=await broker.exchange({faIdToken:'fake-private-fa-token'},{signal:controller.signal});
  assert.equal(result.code,'BROKER_REQUEST_CANCELLED');assert.equal(adapterSignal.aborted,true);assert.equal(reads.fa,0);
});
test('cancelamento durante reserva não chama leitor de dados',async()=>{
  const controller=new AbortController();
  const {broker,calls}=harness({overrides:{reserveFirestoreReads:async request=>{controller.abort();return reservation(request);}}});
  const result=await broker.exchange({faIdToken:'fake-private-fa-token'},{signal:controller.signal});
  assert.equal(result.code,'BROKER_REQUEST_CANCELLED');assert.equal(called(calls,'source').length,0);
});
test('cancelamento após iniciar commit exige cleanup/fence com sinal independente',async()=>{
  const controller=new AbortController();let cleanupContext;
  const {broker}=harness({overrides:{
    writeFbLease:async()=>{controller.abort();return {applied:true,projectId:FB,revision:'r-cancelled'};},
    invalidateFbLease:async(_request,context)=>{cleanupContext=context;return {applied:false,matched:false,fenced:true};}
  }});
  const result=await broker.exchange({faIdToken:'fake-private-fa-token'},{signal:controller.signal});
  assert.equal(result.code,'BROKER_REQUEST_CANCELLED');assert.equal(result.requiresReconciliation,false);
  assert.equal(cleanupContext.signal.aborted,false);assert.equal(Object.hasOwn(result,'customToken'),false);
});
test('cancelamento com limpeza sem fence mantém reconciliação',async()=>{
  const controller=new AbortController();
  const {broker}=harness({overrides:{writeFbLease:async()=>{controller.abort();return {applied:true,projectId:FB,revision:'r-cancelled'};},
    invalidateFbLease:async()=>({applied:false,matched:false,fenced:false})}});
  const result=await broker.exchange({faIdToken:'fake-private-fa-token'},{signal:controller.signal});
  assert.equal(result.code,'FB_LEASE_CLEANUP_FAILED');assert.equal(result.requiresReconciliation,true);assert.equal(Object.hasOwn(result,'customToken'),false);
});

test('ID de reserva consumido não pode ser reciclado após vencer',async()=>{
  let firstId, firstExchange=true, control;
  const context=harness({overrides:{reserveFirestoreReads:async request=>{
    const value=reservation(request,control.now());
    if(request.projectId===FA && request.operation==='readFaAuthorization') {
      firstId??=value.reservationId;
      if(!firstExchange) value.reservationId=firstId;
    }
    return value;
  }}});
  control=context.control;
  assert.equal((await exchange(context.broker)).ok,true);
  firstExchange=false;control.advance(10001);
  assert.equal((await exchange(context.broker)).code,'FIRESTORE_RESERVATION_REUSED');
  assert.equal(context.writes.length,1);
});

test('HTTP sustenta cleanup/fence do broker real depois de retornar cancelamento',async()=>{
  const controller=new AbortController(), writeStarted=deferred(), cleanup=deferred();
  let completion, cleanupSignal;
  const {broker}=harness({overrides:{
    writeFbLease:async()=>{writeStarted.resolve();return new Promise(()=>{});},
    invalidateFbLease:async(_request,context)=>{cleanupSignal=context.signal;return cleanup.promise;}
  }});
  const handle=createManagementBrokerHttp({enabled:true,broker,admitRequest:async()=>true,
    maxRequestMs:1000,cleanupDrainMs:1000,superviseExchange:value=>{completion=value;return true;}});
  const request=new Request('https://example.invalid/v1/management/session',{method:'POST',signal:controller.signal,
    headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({faIdToken:'fake-private-fa-token'})});
  const pending=handle(request);await writeStarted.promise;controller.abort();
  const response=await pending, body=await response.json();
  assert.equal(response.status,504);assert.equal(body.requiresReconciliation,true);
  assert.equal(Object.hasOwn(body,'customToken'),false);
  await new Promise(yes=>setImmediate(yes));assert.equal(cleanupSignal.aborted,false);
  let settled=false;void completion.then(()=>{settled=true;});
  await new Promise(yes=>setImmediate(yes));assert.equal(settled,false);
  cleanup.resolve({applied:false,matched:false,fenced:true});
  assert.deepEqual(await completion,{settled:true,started:true,requiresReconciliation:false,code:'BROKER_COMPLETED_AFTER_ABORT'});
});


// Separate limits are trusted host policy; requests/claims/receipts cannot raise them.
const separatedPolicy = (faLimit = 45000) => {
  const value = policy(); delete value.readBudget.dailyLimit;
  value.readBudget.dailyLimits = {[FA]: faLimit, [FB]: 35000};
  if (faLimit === 45000) value.readBudget.limitApprovalEvidence = 'USER_FA_DAILY_LIMIT_45000_2026_10_08';
  return value;
};
const separatedReservationAdapter = ({faReads=40000, fbReads=1000, change=value=>value}={}) => {
  const debits=new Map();let sequence=0;
  return async request => {
    const previous=debits.get(request.projectId)||0, debit=previous+request.maximumReads;
    debits.set(request.projectId,debit);
    const receipt={schemaVersion:1,projectId:request.projectId,operation:request.operation,
      reservationId:'separated_reservation_'+(++sequence),quotaTimezone:'America/Los_Angeles',quotaDay:quotaDay(TIME),
      dailyLimit:request.dailyLimit,pausedRequiresReview:false,metricsComplete:true,measurementTimeMs:TIME,
      expiresAtMs:TIME+10000,reservedReads:request.maximumReads,totalReadCount:request.projectId===FA?faReads:fbReads,
      outstandingReservedReads:debit,unreportedConsumedReads:0,applicationReserveReads:100,metricLagReserveReads:100};
    return change(receipt,request);
  };
};

test('legacy35k and explicit separate35k issue independent project limits',async t=>{
  for(const suppliedPolicy of [policy(),separatedPolicy(35000)])await t.test('compatible35k',async()=>{
    const f=harness({suppliedPolicy});assert.equal((await exchange(f.broker)).ok,true);
    for(const [,request] of called(f.calls,'reserve'))assert.equal(request.dailyLimit,35000);
  });
});
test('trusted FA45k accepts source above35k while every FB unit remains35k',async()=>{
  const requests=[],reserve=separatedReservationAdapter();
  const f=harness({suppliedPolicy:separatedPolicy(),overrides:{reserveFirestoreReads:async request=>{requests.push(request);return reserve(request);}}});
  assert.equal((await exchange(f.broker)).ok,true);
  assert.deepEqual(requests.map(request=>request.dailyLimit),[45000,35000,45000,35000,45000,35000]);
  assert.equal(f.writes.length,1);
});
test('conditional cleanup still asks FB35k under FA45k',async()=>{
  let faReads=0;const requests=[],reserve=separatedReservationAdapter();
  const f=harness({suppliedPolicy:separatedPolicy(),overrides:{
    reserveFirestoreReads:async request=>{requests.push(request);return reserve(request);},
    readFaAuthorization:async()=>{const value=source();if(++faReads===3)value.profile.active=false;return value;}
  }});
  assert.equal((await exchange(f.broker)).code,'FA_PROFILE_REVOKED_OR_MISSING');
  assert.equal(requests.at(-1).operation,'invalidateFbLease');assert.equal(requests.at(-1).projectId,FB);
  assert.equal(requests.at(-1).dailyLimit,35000);assert.equal(f.cleanup.length,1);
});
test('FA45k policy pin missing or wrong denies before Auth even with approval in body',async t=>{
  for(const pin of [undefined,'USER_FB_LIMIT_45000',true])await t.test('missing-pin',async()=>{
    const value=separatedPolicy();if(pin===undefined)delete value.readBudget.limitApprovalEvidence;else value.readBudget.limitApprovalEvidence=pin;
    const f=harness({suppliedPolicy:value});
    const result=await f.broker.exchange({faIdToken:'fake-private-fa-token',limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',dailyLimits:{[FA]:45000,[FB]:45000}});
    assert.equal(result.code,'BROKER_FA_LIMIT_INCREASE_NOT_AUTHORIZED');assert.equal(f.calls.length,0);
  });
});
test('malformed project maps or global45k are denied before services',async t=>{
  const changes=[value=>{delete value.readBudget.dailyLimits[FB];},value=>{value.readBudget.dailyLimits.foreign=35000;},
    value=>{value.readBudget.dailyLimits[FB]=45000;},value=>{value.readBudget.dailyLimits[FA]=40000;},
    value=>{value.readBudget.dailyLimit=35000;},value=>{delete value.readBudget.dailyLimits;value.readBudget.dailyLimit=45000;}];
  for(const change of changes)await t.test('project-map',async()=>{
    const value=separatedPolicy();change(value);const f=harness({suppliedPolicy:value});
    assert.equal((await exchange(f.broker)).code,'BROKER_READ_LIMITS_INVALID');assert.equal(f.calls.length,0);
  });
});
test('receipt cannot choose its project ceiling or widen FB via evidence flag',async t=>{
  for(const change of [value=>({...value,dailyLimit:value.projectId===FA?35000:35000}),
    value=>value.projectId===FB?({...value,dailyLimit:45000,limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08'}):value]) {
    await t.test('receipt-limit',async()=>{
      const f=harness({suppliedPolicy:separatedPolicy(),overrides:{reserveFirestoreReads:separatedReservationAdapter({change})}});
      assert.equal((await exchange(f.broker)).code,'FIRESTORE_READ_BUDGET_DENIED');assert.equal(f.writes.length,0);
    });
  }
});
test('legacy35k does not accept45k receipt or body-derived cap',async()=>{
  const f=harness({overrides:{reserveFirestoreReads:separatedReservationAdapter({faReads:1000,change:value=>({...value,dailyLimit:45000})})}});
  const result=await f.broker.exchange({faIdToken:'fake-private-fa-token',readBudget:separatedPolicy().readBudget});
  assert.equal(result.code,'FIRESTORE_READ_BUDGET_DENIED');assert.equal(f.reads.fa,0);
});
test('FA45k never lets observed FB usage above35k reach FB reader',async()=>{
  const f=harness({suppliedPolicy:separatedPolicy(),overrides:{reserveFirestoreReads:separatedReservationAdapter({fbReads:34800})}});
  assert.equal((await exchange(f.broker)).code,'FIRESTORE_READ_BUDGET_DENIED');assert.equal(f.reads.lease,0);
});
test('operation costs are checked against their own project policy',async()=>{
  const value=separatedPolicy();value.readBudget.operationReadBounds.writeFbLease=35000;
  const f=harness({suppliedPolicy:value});assert.equal((await exchange(f.broker)).code,'BROKER_READ_BUDGET_POLICY_INVALID');assert.equal(f.calls.length,0);
});
test('policy map is pinned for a running exchange across asynchronous callbacks',async()=>{
  const value=separatedPolicy(),gate=deferred(),requests=[],reserve=separatedReservationAdapter();
  const f=harness({suppliedPolicy:value,overrides:{verifyFaIdToken:async()=>{await gate.promise;return claims();},
    reserveFirestoreReads:async request=>{requests.push(request);return reserve(request);}}});
  const pending=exchange(f.broker);await Promise.resolve();await Promise.resolve();
  value.readBudget.dailyLimits[FA]=50000;value.readBudget.dailyLimits[FB]=45000;value.readBudget.limitApprovalEvidence=null;
  gate.resolve();assert.equal((await pending).ok,true);
  for(const request of requests)assert.equal(request.dailyLimit,request.projectId===FA?45000:35000);
});
test('broker composes with real local ledger and SQLite using distinct FA45k/FB35k receipts',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const {createManagementBudgetLedger}=await import('../scripts/lib/management-budget-ledger.js');
  const {createManagementSqliteStore}=await import('../scripts/lib/management-budget-sqlite-store.js');
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec:(sql,...params)=>db.prepare(sql).all(...params)},transactionSync(work){db.exec('BEGIN');try{const output=work();db.exec('COMMIT');return output;}catch(error){db.exec('ROLLBACK');throw error;}}};
  try{
    const consumerPolicy=separatedPolicy(),budget=consumerPolicy.readBudget;
    const store=createManagementSqliteStore({storage,maxStateBytes:1024*1024,now:()=>TIME});
    const ledger=createManagementBudgetLedger({enabled:true,store,clock:()=>TIME,
      policy:{schemaVersion:1,version:'synthetic_composition',dailyLimits:budget.dailyLimits,quotaTimezone:'America/Los_Angeles',
        maxMeasurementAgeMs:5000,applicationReserveReads:100,metricLagReserveReads:100,reservationTtlMs:10000,
        transactionTimeoutMs:1000,maxApprovalAgeMs:5000,maxReservationRecords:100,maxDayRecords:10,
        maxApprovalRecords:100,maxSettlementRecords:100,maxObservationRecords:100,operationReadBounds:budget.operationReadBounds},
      authorizeMeasurement:()=>true,authorizeHumanReview:()=>true}); // synthetic private authorities only
    for(const projectId of [FA,FB]){
      const quotaDayValue=quotaDay(TIME);
      await ledger.recordMeasurement({projectId,quotaDay:quotaDayValue,metric:'read_count',totalReadCount:projectId===FA?40000:1000,
        measurementTimeMs:TIME,pointTimeMs:TIME,metricsComplete:true,observationId:'observation_'+projectId,observationHash:'a'.repeat(64)});
      const status=await ledger.status({projectId});
      assert.equal((await ledger.reviewPause({projectId,quotaDay:quotaDayValue,dailyLimit:budget.dailyLimits[projectId],
        expectedPolicyHash:status.policyHash,expectedPauseEpoch:status.pauseEpoch,expectedRevision:status.revision,
        approvalId:'approval_'+projectId,approvedAtMs:TIME,decision:'continue'})).ok,true);
    }
    const f=harness({suppliedPolicy:consumerPolicy,overrides:{reserveFirestoreReads:(request,ctx)=>ledger.reserveFirestoreReads(request,ctx)}});
    assert.equal((await exchange(f.broker)).ok,true);
    const fa=await ledger.status({projectId:FA}),fb=await ledger.status({projectId:FB});
    assert.equal(fa.dailyLimit,45000);assert.equal(fb.dailyLimit,35000);
    assert.equal(fa.outstandingReservedReads,18);assert.equal(fb.outstandingReservedReads,5);
    assert.equal(f.writes.length,1);
  }finally{db.close();}
});


test('broker denies receipt sum exactly at each project ceiling35k or45k',async t=>{
  for(const [name,target,suppliedPolicy] of [['FA35k',FA,policy()],['FA45k',FA,separatedPolicy()],['FB35k-under-FA45k',FB,separatedPolicy()]])await t.test(name,async()=>{
    const f=harness({suppliedPolicy,overrides:{reserveFirestoreReads:separatedReservationAdapter({faReads:1000,change:(receipt,request)=>
      request.projectId===target?({...receipt,totalReadCount:request.dailyLimit-receipt.outstandingReservedReads
        -receipt.unreportedConsumedReads-receipt.applicationReserveReads-receipt.metricLagReserveReads}):receipt})}});
    assert.equal((await exchange(f.broker)).code,'FIRESTORE_READ_BUDGET_DENIED');
    assert.equal(f.reads.fa,target===FA?0:1);assert.equal(f.reads.lease,0);assert.equal(f.writes.length,0);
  });
});


test('broker rejects measurement age policy above300000 before Auth or budget',async()=>{
  const value=policy();value.readBudget.maxMeasurementAgeMs=300001;
  const f=harness({suppliedPolicy:value});assert.equal((await exchange(f.broker)).code,'BROKER_READ_BUDGET_POLICY_REQUIRED');assert.equal(f.calls.length,0);
});
test('broker accepts explicit measurement age policy at300000 with unchanged fresh receipts',async()=>{
  const value=separatedPolicy();value.readBudget.maxMeasurementAgeMs=300000;
  const f=harness({suppliedPolicy:value,overrides:{reserveFirestoreReads:separatedReservationAdapter()}});
  assert.equal((await exchange(f.broker)).ok,true);
});
