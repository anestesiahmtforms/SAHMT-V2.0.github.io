import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFbMigrationDestinationBudget, assessFbMigrationDestinationBudget,
  acknowledgeFbMigrationDestinationReservation, fbMigrationDestinationPolicySha256,
  validateFbMigrationDestinationBudgetProof, pauseFbMigrationDestinationBudget,
  finishFbMigrationDestinationBudget
} from '../scripts/lib/management-migration-destination-budget.js';

const FB = 'sahmt-gestao-5ae66', FA = 'sahmt-17a16';
const TIME = '2026-10-09T12:00:00.000Z', NOW = Date.parse(TIME);
const clone = value => structuredClone(value);
const pins = Object.fromEntries(['planSha256', 'sourceSnapshotSha256', 'manifestSha256',
  'destinationSnapshotSha256', 'aclSha256', 'identitySha256'].map((name, i) => [name, String(i + 1).repeat(64)]));

function fixture(number = 134) {
  const scope = {schemaVersion:1, projectId:FB, databaseId:'(default)', runId:'a'.repeat(64),
    pins:clone(pins), unitPaths:Array.from({length:number}, (_, i) => 'managementAreas/unit-' + i)};
  const authorization = {schemaVersion:1, authorized:true, projectId:FB, databaseId:'(default)',
    purpose:'MANAGEMENT_MIGRATION_CREATE_ONLY', authorizationSource:'EXPLICIT_HUMAN_CONTINUE_FB',
    authorizationId:'human-fb-migration', approvedAt:TIME, expiresAt:'2026-10-09T12:10:00.000Z',
    maximumDurationMs:300000, readPairMaximumReads:2, commitPairMaximumReads:2,
    maximumPostcheckReads:number * 2, maximumReservedReads:number * 6};
  let policy = createFbMigrationDestinationBudget({projectId:FB, scope, authorization, nowMs:NOW});
  let sequence = 0;
  const request = (stage = 'READ_PAIR', path = scope.unitPaths[0], maximumReads = 2) => ({
    projectId:FB, databaseId:'(default)', runId:scope.runId, pins:clone(scope.pins),
    path, stage, maximumReads, reservationId:'reservation-' + (++sequence)
  });
  const reserve = (reservation, nowMs = NOW) => {
    const result = assessFbMigrationDestinationBudget({projectId:FB, scope, policy, nowMs, reservation});
    // Synthetic protected store acknowledgement; no production persistence.
    const pending = result.nextPolicy;
    const ack = acknowledgeFbMigrationDestinationReservation({projectId:FB, scope, policy:pending, nowMs,
      acknowledgement:{persisted:true, reservationId:reservation.reservationId, policySha256:result.policySha256}});
    policy = ack.nextPolicy;
    return ack.proof;
  };
  return {scope, authorization, request, reserve, get policy(){return policy;},
    setPolicy(value){policy = value;}, expected:reservation=>({
      runId:scope.runId, pins:scope.pins, path:reservation.path, stage:reservation.stage
    })};
}

test('FB migração possui orçamento finito próprio sem limite diário ou métrica sintética', () => {
  const f = fixture(), status = assessFbMigrationDestinationBudget({
    projectId:FB, scope:f.scope, policy:f.policy, nowMs:NOW});
  assert.equal(status.allowed, true);
  assert.equal(f.policy.maximumReservedReads, 804); // 536 execução + 268 conferência dos 134 pares.
  assert.equal(f.policy.totalUsageKnown, false);
  assert.equal(f.policy.measuredTotalReads, null);
  assert.equal(f.policy.dailyReadLimit, null);
  assert.equal(f.policy.exactGlobalCutoff, false);
  assert.equal(Object.hasOwn(f.policy, 'metric'), false);
  assert.equal(f.policy.renewalClearsPause, false);
  assert.equal(f.policy.deadlineAt, '2026-10-09T12:05:00.000Z');
});

test('estado separado não lê nem modifica a trava de FA ou bootstrap FB consumido', () => {
  const fa = {projectId:FA, pausedRequiresReview:true, dailyReadLimit:45000};
  const bootstrap = {projectId:FB, pausedRequiresReview:true, status:'COMPLETE', authorizationId:'consumed'};
  const original = clone({fa, bootstrap}), f = fixture();
  f.reserve(f.request());
  assert.deepEqual({fa, bootstrap}, original);
  assert.equal(f.policy.reservedReads, 2);
  assert.notEqual(f.policy.authorizationId, bootstrap.authorizationId);
});

for (const [label, alter] of [
  ['FA', (f) => {f.scope.projectId = FA;}],
  ['outro banco', (f) => {f.scope.databaseId = 'other';}],
  ['release de treinamento', (f) => {f.authorization.purpose = 'TRAINING_RELEASE';}],
  ['autorização implícita', (f) => {f.authorization.authorizationSource = 'DAY_RENEWED';}],
  ['sem autorização', (f) => {f.authorization.authorized = false;}],
  ['scope vazio', (f) => {f.scope.unitPaths = [];}],
  ['path repetido', (f) => {f.scope.unitPaths.push(f.scope.unitPaths[0]);}],
  ['runtime executável', (f) => {f.scope.unitPaths[0] = 'evaluationRuntime/main';}],
  ['reserva ilimitada', (f) => {f.authorization.maximumReservedReads = Infinity;}],
  ['cap que omite conferência', (f) => {f.authorization.maximumReservedReads -= 2;}],
  ['conferência sem bound', (f) => {f.authorization.maximumPostcheckReads = f.scope.unitPaths.length * 4 + 1;}],
  ['deadline prorrogado', (f) => {f.authorization.maximumDurationMs = 300001;}],
  ['janela autorizada estendida', (f) => {f.authorization.expiresAt = '2026-10-09T12:16:00.000Z';}],
  ['autorização expirada', (f) => {f.authorization.expiresAt = TIME;}]
]) test(label + ' não autoriza um orçamento de migração FB', () => {
  const f = fixture(); alter(f);
  assert.throws(() => createFbMigrationDestinationBudget({
    projectId:FB, scope:f.scope, authorization:f.authorization, nowMs:NOW}), /MIGRATION_BUDGET_/);
});

test('reserva pendente precisa de persistência comprovada antes de produzir prova', () => {
  const f = fixture(), request = f.request(), before = clone(f.policy);
  const pending = assessFbMigrationDestinationBudget({
    projectId:FB, scope:f.scope, policy:f.policy, nowMs:NOW, reservation:request});
  assert.deepEqual(f.policy, before);
  assert.equal(pending.nextPolicy.reservedReads, 2);
  assert.equal(pending.nextPolicy.status, 'RESERVATION_PENDING');
  assert.equal(Object.hasOwn(pending, 'proof'), false);
  assert.equal(pending.policySha256, fbMigrationDestinationPolicySha256(pending.nextPolicy));
  for (const acknowledgement of [
    {persisted:false, reservationId:request.reservationId, policySha256:pending.policySha256},
    {persisted:true, reservationId:'wrong', policySha256:pending.policySha256},
    {persisted:true, reservationId:request.reservationId, policySha256:'f'.repeat(64)}
  ]) assert.throws(() => acknowledgeFbMigrationDestinationReservation({
    projectId:FB, scope:f.scope, policy:pending.nextPolicy, nowMs:NOW, acknowledgement}),
  /MIGRATION_BUDGET_DESTINATION_PERSISTENCE_REQUIRED/);
  assert.throws(() => assessFbMigrationDestinationBudget({
    projectId:FB, scope:f.scope, policy:pending.nextPolicy, nowMs:NOW, reservation:f.request()}),
  /MIGRATION_BUDGET_DESTINATION_RESERVATION_PENDING/);
});

test('prova confirmada vincula projeto, finalidade, run, pins, path, etapa e máximo', () => {
  const f = fixture(), request = f.request(), proof = f.reserve(request);
  const validated = validateFbMigrationDestinationBudgetProof({
    proof, nowMs:NOW, maximumReads:2, expected:f.expected(request)});
  assert.equal(validated.reservationId, request.reservationId);
  assert.equal(validated.boundedRunReservedReads, 2);
  assert.equal(validated.estimatedWithMargin, null);
  assert.equal(proof.reservationPersisted, true);
  assert.equal(f.policy.confirmedReservations, 1);
  assert.equal(f.policy.pendingReservationId, null);
  assert.equal(f.policy.status, 'IN_PROGRESS');
});

for (const [label, alter] of [
  ['outro projeto', proof => {proof.projectId = FA;}],
  ['finalidade catálogo', proof => {proof.authorizedPurpose = 'RELEASE_AND_AGENT_CATALOG_CHECKS';}],
  ['run diferente', proof => {proof.runId = 'f'.repeat(64);}],
  ['ACL diferente', proof => {proof.pins.aclSha256 = 'f'.repeat(64);}],
  ['path diferente', proof => {proof.path = 'managementAreas/other';}],
  ['etapa diferente', proof => {proof.stage = 'COMMIT_PAIR';}],
  ['persistência ausente', proof => {proof.reservationPersisted = false;}],
  ['pausa registrada', proof => {proof.pausedRequiresReview = true;}],
  ['renovação remove pausa', proof => {proof.renewalClearsPause = true;}],
  ['corte global exato', proof => {proof.exactGlobalCutoff = true;}],
  ['uso total declarado', proof => {proof.totalUsageKnown = true;}],
  ['métrica alternativa', proof => {proof.metric = 'firestore.googleapis.com/document/read_count';}],
  ['limite 35k herdado', proof => {proof.dailyReadLimit = 35000;}],
  ['reserva insuficiente', proof => {proof.reservedReads = 1;}],
  ['reserva maior que bound', proof => {proof.reservedReads = proof.maximumReservedReads + 1;}],
  ['máximo por unidade reduzido', proof => {proof.maximumReads = 1;}],
  ['saldo incoerente', proof => {proof.remainingLocalReservations += 1;}],
  ['prova do futuro', proof => {proof.verifiedAt = '2026-10-09T12:00:01.000Z';}],
  ['deadline adulterado', proof => {proof.deadlineAt = '2026-10-09T12:06:00.000Z';}]
]) test(label + ' impede usar a prova de FB', () => {
  const f = fixture(), request = f.request(), proof = clone(f.reserve(request));
  alter(proof);
  assert.throws(() => validateFbMigrationDestinationBudgetProof({
    proof, nowMs:NOW, maximumReads:2, expected:f.expected(request)}), /MIGRATION_BUDGET_/);
});

test('prova não aceita vínculo esperado omitido nem fonte externa alterada', () => {
  const f = fixture(), request = f.request(), proof = f.reserve(request);
  assert.throws(() => validateFbMigrationDestinationBudgetProof({
    proof, nowMs:NOW, maximumReads:2}), /EXPECTED_BINDING_REQUIRED/);
  const expected = f.expected(request); expected.pins = clone(expected.pins); expected.pins.identitySha256 = 'f'.repeat(64);
  assert.throws(() => validateFbMigrationDestinationBudgetProof({
    proof, nowMs:NOW, maximumReads:2, expected}), /PROOF_SCOPE_MISMATCH/);
});

test('reserva é cumulativa e uma unidade não reutiliza etapa, ID ou máximo', () => {
  const f = fixture(), request = f.request();
  f.reserve(request);
  assert.throws(() => f.reserve(request), /RESERVATION_REUSED/);
  assert.throws(() => f.reserve(f.request()), /UNIT_STAGE_REUSED/);
  assert.throws(() => f.reserve(f.request('COMMIT_PAIR', f.scope.unitPaths[0], 1)), /UNIT_BOUND_INVALID/);
  const commit = f.reserve(f.request('COMMIT_PAIR'));
  assert.equal(commit.reservedReads, 4);
  assert.equal(commit.remainingLocalReservations, 800);
  assert.throws(() => f.reserve(f.request('COMMIT_PAIR')), /UNIT_STAGE_REUSED/);
});

test('commit exige reserva READ_PAIR confirmada da mesma unidade', () => {
  const f = fixture();
  assert.throws(() => f.reserve(f.request('COMMIT_PAIR')), /READ_RESERVATION_REQUIRED/);
  f.reserve(f.request());
  assert.throws(() => f.reserve(f.request('COMMIT_PAIR', f.scope.unitPaths[1])), /READ_RESERVATION_REQUIRED/);
});

test('conferência de 134 pares recebe 268 reservas sem mascarar leitura real', () => {
  const f = fixture();
  for (const path of f.scope.unitPaths) {
    f.reserve(f.request('READ_PAIR', path));
    f.reserve(f.request('COMMIT_PAIR', path));
  }
  assert.equal(f.policy.reservedReads, 536);
  for (const path of f.scope.unitPaths) f.reserve(f.request('POSTCHECK', path));
  assert.equal(f.policy.reservedReads, 804);
  assert.throws(() => f.reserve(f.request('POSTCHECK', f.scope.unitPaths[0], 1)), /POSTCHECK_BOUND_EXCEEDED/);
  assert.equal(f.policy.totalUsageKnown, false);
});

test('conferência tem bound por par, independente do saldo total', () => {
  const f = fixture();
  f.reserve(f.request('POSTCHECK', f.scope.unitPaths[0], 4));
  assert.throws(() => f.reserve(f.request('POSTCHECK', f.scope.unitPaths[0], 1)), /POSTCHECK_BOUND_EXCEEDED/);
  assert.throws(() => f.reserve(f.request('POSTCHECK', 'managementAreas/not-in-plan')), /RESERVATION_INVALID/);
});

test('corrupção do acumulado ou do estado de confirmação não é reparada implicitamente', () => {
  const f = fixture();
  f.reserve(f.request());
  for (const alter of [
    policy => {policy.reservedReads = 0;},
    policy => {policy.confirmedReservations = 0;},
    policy => {policy.pendingReservationId = 'stale';},
    policy => {policy.scopeSha256 = 'f'.repeat(64);}
  ]) {
    const policy = clone(f.policy); alter(policy);
    assert.throws(() => assessFbMigrationDestinationBudget({
      projectId:FB, scope:f.scope, policy, nowMs:NOW}), /MIGRATION_BUDGET_/);
  }
});

test('deadline fica fixo e nova métrica ou dia não o prolonga', () => {
  const f = fixture(), request = f.request(), proof = f.reserve(request);
  for (const nowMs of [NOW + 300000, NOW + 86400000]) {
    assert.throws(() => assessFbMigrationDestinationBudget({
      projectId:FB, scope:f.scope, policy:f.policy, nowMs}), /DEADLINE_OR_DAY_EXPIRED/);
    assert.throws(() => validateFbMigrationDestinationBudgetProof({
      proof, nowMs, maximumReads:2, expected:f.expected(request)}), /PROOF_EXPIRED/);
  }
});

test('mudança do dia de Los Angeles bloqueia uma janela ainda não expirada', () => {
  const f = fixture();
  f.authorization.approvedAt = '2026-10-09T06:59:59.000Z';
  f.authorization.expiresAt = '2026-10-09T07:10:00.000Z';
  const start = Date.parse(f.authorization.approvedAt);
  const policy = createFbMigrationDestinationBudget({projectId:FB, scope:f.scope, authorization:f.authorization, nowMs:start});
  assert.throws(() => assessFbMigrationDestinationBudget({
    projectId:FB, scope:f.scope, policy, nowMs:start + 2000}), /DEADLINE_OR_DAY_EXPIRED/);
});

test('pausa e conclusão preservam débitos e bloqueiam retomada automática', () => {
  const f = fixture(); f.reserve(f.request());
  const paused = pauseFbMigrationDestinationBudget({
    projectId:FB, policy:f.policy, nowMs:NOW, reason:'DESTINATION_QUOTA_EXCEEDED'});
  const finished = finishFbMigrationDestinationBudget({
    projectId:FB, policy:paused, nowMs:NOW + 86400000, status:'INCOMPLETE'});
  assert.equal(finished.reservedReads, 2);
  assert.equal(finished.pauseReason, 'DESTINATION_QUOTA_EXCEEDED');
  assert.equal(finished.pausedRequiresReview, true);
  assert.equal(finished.renewalClearsPause, false);
  assert.throws(() => assessFbMigrationDestinationBudget({
    projectId:FB, scope:f.scope, policy:finished, nowMs:NOW + 86400000}), /PAUSED_REQUIRES_REVIEW/);
});

test('timeout antes do ack conserva reserva pendente ao pausar e finalizar', () => {
  const f = fixture(), request = f.request();
  const {nextPolicy} = assessFbMigrationDestinationBudget({
    projectId:FB, scope:f.scope, policy:f.policy, nowMs:NOW, reservation:request});
  const paused = pauseFbMigrationDestinationBudget({
    projectId:FB, policy:nextPolicy, nowMs:NOW, reason:'PROTECTED_STORE_UNAVAILABLE'});
  const terminal = finishFbMigrationDestinationBudget({
    projectId:FB, policy:paused, nowMs:NOW, status:'INCOMPLETE'});
  assert.equal(terminal.status, 'RESERVATION_PENDING');
  assert.equal(terminal.pendingReservationId, request.reservationId);
  assert.equal(terminal.reservedReads, 2);
  assert.equal(terminal.reservations[0].persisted, false);
  assert.equal(terminal.pausedRequiresReview, true);
  assert.throws(() => acknowledgeFbMigrationDestinationReservation({
    projectId:FB, scope:f.scope, policy:terminal, nowMs:NOW,
    acknowledgement:{persisted:true, reservationId:request.reservationId,
      policySha256:fbMigrationDestinationPolicySha256(terminal)}}), /PAUSED_REQUIRES_REVIEW/);
});

test('término completo consome autorização de FB sem conceder ações futuras', () => {
  const f = fixture(); f.reserve(f.request());
  const finished = finishFbMigrationDestinationBudget({projectId:FB, policy:f.policy, nowMs:NOW, status:'COMPLETE'});
  assert.equal(finished.status, 'COMPLETE');
  assert.equal(finished.pauseReason, 'FB_MIGRATION_AUTHORIZATION_CONSUMED');
  assert.equal(finished.reservedReads, 2);
  assert.throws(() => assessFbMigrationDestinationBudget({
    projectId:FB, scope:f.scope, policy:finished, nowMs:NOW}), /PAUSED_REQUIRES_REVIEW/);
  assert.throws(() => pauseFbMigrationDestinationBudget({
    projectId:FA, policy:f.policy, nowMs:NOW, reason:'STOP'}), /PAUSE_INVALID/);
});
