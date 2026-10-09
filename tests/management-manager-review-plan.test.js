import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {planManagementManagerReview} from '../scripts/lib/management-manager-review-plan.js';

const clone = value => JSON.parse(JSON.stringify(value));
const materialOrigin = {projectId: 'sahmt-17a16', materialId: 'SyntheticMaterial001'};
function fixture() {
  const review = {materialOrigin: clone(materialOrigin), materialVersion: 3, activityId: 'fixture-form', areaId: 'fixture-area',
    managerUid: 'fixture-manager', managerMemberId: 'member-manager', assignmentId: 'fixture-assignment', assignmentVersion: 2,
    decision: 'APPROVE', completedAt: '2026-10-08T11:59:00.000Z', sourceFingerprint: 'a'.repeat(64), reviewFingerprint: 'b'.repeat(64), requestId: 'fixture-request'};
  const policy = {schemaVersion: 1, id: 'fixture-rule', version: 1, confirmed: true, unit: 'MATERIAL_VERSION',
    category: 'GOVERNANCE', modality: 'MANAGER_REVIEW', points: 2, creditedDecisions: ['APPROVE'],
    validationMode: 'BACKEND_ONLY', eligibility: 'CURRENT_DESIGNATED_MANAGER', effectiveFrom: '2026-10-08T00:00:00.000Z', retroactive: false};
  const context = {projectId: 'sahmt-gestao-5ae66', now: '2026-10-08T12:00:00.000Z', checkedAt: '2026-10-08T11:59:45.000Z',
    reviewPermissionVerified: true, profile: {uid: review.managerUid, memberId: review.managerMemberId, active: true, access: true},
    assignment: {id: review.assignmentId, version: review.assignmentVersion, uid: review.managerUid, memberId: review.managerMemberId,
      areaId: review.areaId, materialOrigin: clone(materialOrigin), active: true},
    validation: {trustedBackend: true, status: 'COMPLETE', canonicalOriginVerified: true, contentVerified: true,
      materialOrigin: clone(materialOrigin), materialVersion: review.materialVersion, sourceFingerprint: review.sourceFingerprint,
      reviewFingerprint: review.reviewFingerprint, managerUid: review.managerUid, decision: review.decision,
      completedAt: review.completedAt, validatedAt: '2026-10-08T11:59:30.000Z'}};
  return {review, policy, context};
}
function stored(input = fixture()) {
  const ready = planManagementManagerReview(input);
  assert.equal(ready.status, 'READY');
  return {...clone(input), existingEvent: clone(ready.event), existingAward: {...clone(ready.awardSpec),
    originalPoints: 2, awardVersion: 1, lastLedgerId: ready.awardId + '-v1', adminOverride: false}};
}
function syncReview(input) {
  const {review, context} = input;
  Object.assign(context.profile, {uid: review.managerUid, memberId: review.managerMemberId});
  Object.assign(context.assignment, {id: review.assignmentId, version: review.assignmentVersion, uid: review.managerUid,
    memberId: review.managerMemberId, areaId: review.areaId, materialOrigin: clone(review.materialOrigin)});
  Object.assign(context.validation, {materialOrigin: clone(review.materialOrigin), materialVersion: review.materialVersion,
    sourceFingerprint: review.sourceFingerprint, reviewFingerprint: review.reviewFingerprint, managerUid: review.managerUid,
    decision: review.decision, completedAt: review.completedAt});
  return input;
}
function denied(result, status, code) {
  assert.equal(result.status, status);
  if (code) assert.match(result.reason, code);
  assert.equal(result.event, null);
  assert.equal(result.awardSpec, null);
  assert.equal(result.integration, undefined);
}

test('material e versão completos geram somente especificações GOVERNANCE +2 de transação', () => {
  const input = fixture(), before = JSON.stringify(input), result = planManagementManagerReview(input);
  assert.equal(result.status, 'READY');
  assert.equal(result.event.category, 'GOVERNANCE'); assert.equal(result.awardSpec.category, 'GOVERNANCE');
  assert.equal(result.awardSpec.modality, 'MANAGER_REVIEW'); assert.equal(result.awardSpec.points, 2);
  assert.equal(result.event.uid, input.review.managerUid); assert.equal(result.event.awardId, result.awardSpec.id);
  assert.equal(result.event.creditScopeId, result.event.id);
  assert.deepEqual(result.integration.eventPrecondition, {exists: false});
  assert.equal(result.integration.sameTransactionRequired, true);
  assert.equal(result.integration.ledgerChangesInSingleCall, true);
  assert.equal(result.integration.currentAuthorizationRecheckRequired, true);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(result).includes('performanceTotal'), false);
});

test('identidade de award é compatível com helper existente; ledger ainda precisa integrar modalidade', () => {
  const result = planManagementManagerReview(fixture()), context = {sha256Hex_: text => createHash('sha256').update(text).digest('hex')};
  runInNewContext(readFileSync(new URL('../apps-script-v2/EvaluationLedger.gs', import.meta.url), 'utf8'), context);
  assert.equal(context.evaluationAwardId_(result.awardSpec), result.awardId);
  assert.throws(() => context.evaluationPlanAward_(null, result.awardSpec), /Modalidade/);
});

test('ausência de política e escolhas incompletas falham fechadas sem inferir aprovação ou administrador', () => {
  denied(planManagementManagerReview(), 'BLOCKED', /POLICY_UNDEFINED/);
  const absent = fixture(); delete absent.policy;
  denied(planManagementManagerReview(absent), 'BLOCKED', /POLICY_UNDEFINED/);
  for (const key of ['creditedDecisions', 'validationMode', 'effectiveFrom', 'eligibility', 'confirmed']) {
    const input = fixture(); delete input.policy[key];
    denied(planManagementManagerReview(input), 'BLOCKED', /POLICY_INCOMPLETE/);
  }
});

test('política não pode alterar valor, categoria, unidade nem habilitar retroatividade implicitamente', () => {
  for (const change of [{points: 3}, {category: 'PERFORMANCE'}, {unit: 'SUGGESTION'}, {modality: 'MATERIAL'},
    {retroactive: true}, {validationMode: 'ANY_ADMIN'}, {creditedDecisions: []}, {creditedDecisions: ['APPROVE','APPROVE']},
    {confirmed: false}, {version: 0}, {unexpected: true}, {effectiveFrom: '2026-02-30T00:00:00Z'}]) {
    const input = fixture(); Object.assign(input.policy, change);
    denied(planManagementManagerReview(input), 'BLOCKED', /POLICY_INCOMPLETE/);
  }
});

test('decisão elegível deve constar da política explícita; REJECT não recebe regra automática', () => {
  const input = fixture(); input.review.decision = 'REJECT'; syncReview(input);
  denied(planManagementManagerReview(input), 'BLOCKED', /DECISION_NOT_IN_EXPLICIT_POLICY/);
  input.policy.creditedDecisions = ['REJECT'];
  assert.equal(planManagementManagerReview(input).status, 'READY');
});

test('execução FA ou FB preserva identidade canônica e não paga cópia migrada novamente', () => {
  const fa = fixture(); fa.context.projectId = 'sahmt-17a16';
  const fb = fixture();
  assert.deepEqual(planManagementManagerReview(fa), planManagementManagerReview(fb));
  const input = stored(fa); input.context.projectId = 'sahmt-gestao-5ae66';
  denied(planManagementManagerReview(input), 'DUPLICATE', /ALREADY_CREDITED/);
});

test('request diferente repete somente unidade equivalente sem emitir novo evento ou award', () => {
  const input = stored(); input.review.requestId = 'retry-other-request';
  denied(planManagementManagerReview(input), 'DUPLICATE', /ALREADY_CREDITED/);
  assert.equal(input.existingEvent.firstRequestId, 'fixture-request');
});

test('nova versão legítima é outra unidade; reutilizar evento de outra versão é conflito', () => {
  const first = planManagementManagerReview(fixture()), input = fixture();
  input.review.materialVersion = 4; syncReview(input);
  const next = planManagementManagerReview(input);
  assert.equal(next.status, 'READY'); assert.notEqual(next.eventId, first.eventId); assert.notEqual(next.awardId, first.awardId);
  input.existingEvent = first.event; input.existingAward = stored().existingAward;
  denied(planManagementManagerReview(input), 'CONFLICT', /EXISTING_UNIT_CONFLICT/);
});

test('gestor ou membro diferente nunca move o beneficiário da unidade já paga', () => {
  for (const field of ['managerUid', 'managerMemberId']) {
    const input = stored(); input.review[field] = 'other-manager'; syncReview(input);
    denied(planManagementManagerReview(input), 'CONFLICT', /BENEFICIARY_FROZEN/);
  }
});

test('troca da designação não cria outra unidade e histórico anterior fica intacto', () => {
  const old = fixture(), first = planManagementManagerReview(old), input = fixture();
  input.review.managerUid = 'replacement-manager'; input.review.managerMemberId = 'replacement-member';
  input.review.assignmentVersion = 3; syncReview(input);
  const planned = planManagementManagerReview(input);
  assert.equal(planned.eventId, first.eventId); assert.notEqual(planned.awardId, first.awardId);
  input.existingEvent = first.event; input.existingAward = stored(old).existingAward;
  denied(planManagementManagerReview(input), 'CONFLICT', /BENEFICIARY_FROZEN/);
});

test('fonte, revisão, decisão, regra ou designação alteradas não são puladas como equivalentes', () => {
  for (const mutate of [
    input => input.review.sourceFingerprint = 'c'.repeat(64),
    input => input.review.reviewFingerprint = 'd'.repeat(64),
    input => { input.review.decision = 'REJECT'; input.policy.creditedDecisions = ['APPROVE','REJECT']; },
    input => input.policy.version = 2,
    input => input.review.assignmentVersion = 3,
    input => input.review.activityId = 'other-activity',
    input => input.review.materialOrigin.materialId = 'OtherMaterial',
    input => input.review.materialOrigin.projectId = 'sahmt-gestao-5ae66'
  ]) {
    const input = stored(); mutate(input); syncReview(input);
    denied(planManagementManagerReview(input), 'CONFLICT');
  }
});

test('evento ou award órfão requer reconciliação; planner não repara nem repaga', () => {
  for (const field of ['existingEvent', 'existingAward']) {
    const input = stored(); input[field] = null;
    denied(planManagementManagerReview(input), 'CONFLICT', /PAIR_INCOMPLETE/);
  }
});

test('evento e award existentes devem manter contrato e identidade verificáveis', () => {
  for (const mutate of [
    input => input.existingEvent.points = 20,
    input => input.existingEvent.status = 'PENDING',
    input => input.existingEvent.modality = 'MATERIAL',
    input => input.existingEvent.awardId = 'wrong-award',
    input => input.existingEvent.unit.materialVersion = 8,
    input => input.existingEvent.validatedAt = '2026-10-09T12:00:00Z',
    input => input.existingEvent.validatedAt = '2026-10-08T11:58:00Z',
    input => input.existingEvent.firstRequestId = '../invalid',
    input => input.existingAward.sourceFingerprint = 'e'.repeat(64),
    input => input.existingAward.evidence.materialVersion = 8,
    input => input.existingAward.awardVersion = 50001,
    input => input.existingEvent.business.reviewFingerprint = 'e'.repeat(64),
    input => input.existingAward.points = 99,
    input => input.existingAward.uid = 'other-manager',
    input => input.existingAward.creditScopeId = 'wrong-scope',
    input => input.existingAward.lastLedgerId = 'wrong-ledger',
    input => input.existingAward.version = 8,
    input => delete input.existingAward.adminOverride
  ]) {
    const input = stored(); mutate(input);
    denied(planManagementManagerReview(input), 'CONFLICT');
  }
});

test('correção administrativa válida é preservada e nunca restaurada automaticamente para2', () => {
  const input = stored();
  Object.assign(input.existingAward, {points: 0, adminOverride: true, awardVersion: 2,
    lastLedgerId: input.existingAward.id + '-v2', sourceType: 'ADMIN_CORRECTION', sourceId: 'correction-request',
    approvedByUid: 'fixture-admin'});
  const result = planManagementManagerReview(input);
  denied(result, 'DUPLICATE', /ALREADY_CREDITED/);
  assert.equal(result.administrativeCorrectionPreserved, true); assert.equal(input.existingAward.points, 0);
});

test('flag adminOverride isolada não prova correção e fingerprints modificados continuam conflitos', () => {
  const input=stored();input.existingAward.adminOverride=true;input.existingAward.points=0;
  denied(planManagementManagerReview(input),'CONFLICT',/AWARD_STATE_CONFLICT/);
  input.existingAward.sourceType='ADMIN_CORRECTION';input.existingAward.sourceId='admin-correction';input.existingAward.approvedByUid='fixture-admin';
  input.existingAward.sourceFingerprint='f'.repeat(64);
  denied(planManagementManagerReview(input),'CONFLICT',/AWARD_IDENTITY_CONFLICT/);
});

test('revogação, perfil inativo ou direito não verificado bloqueiam plano e retry', () => {
  for (const mutate of [
    input => input.context.profile.active = false,
    input => input.context.profile.access = false,
    input => input.context.reviewPermissionVerified = false,
    input => input.context.profile.uid = 'other-person',
    input => input.context.profile.memberId = 'other-member'
  ]) {
    for (const input of [fixture(), stored()]) {
      mutate(input); denied(planManagementManagerReview(input), 'BLOCKED', /ACCESS_REVOKED_OR_UNVERIFIED/);
    }
  }
});

test('administrador não designado não vira beneficiário; designação deve ligar material e área atuais', () => {
  for (const mutate of [
    input => input.context.assignment.uid = 'administrator',
    input => input.context.assignment.active = false,
    input => input.context.assignment.version = 1,
    input => input.context.assignment.areaId = 'other-area',
    input => input.context.assignment.materialOrigin.materialId = 'OtherMaterial'
  ]) {
    const input = fixture(); mutate(input);
    denied(planManagementManagerReview(input), 'BLOCKED', /CURRENT_DESIGNATION_REQUIRED/);
  }
});

test('PENDING, marcação do cliente ou evidência incompleta não comprovam revisão completa', () => {
  for (const mutate of [
    input => input.context.validation.trustedBackend = false,
    input => input.context.validation.status = 'PENDING',
    input => input.context.validation.canonicalOriginVerified = false,
    input => input.context.validation.contentVerified = false,
    input => input.context.validation.materialVersion = 4,
    input => input.context.validation.sourceFingerprint = 'c'.repeat(64),
    input => input.context.validation.reviewFingerprint = 'd'.repeat(64),
    input => input.context.validation.managerUid = 'administrator',
    input => input.context.validation.decision = 'REJECT',
    input => input.context.validation.completedAt = '2026-10-08T11:58:00.000Z',
    input => delete input.context.validation
  ]) {
    const input = fixture(); mutate(input);
    denied(planManagementManagerReview(input), 'BLOCKED', /COMPLETE_BACKEND_VALIDATION_REQUIRED/);
  }
});

test('direitos e validação backend devem estar frescos, sem tempos futuros ou impossíveis', () => {
  for (const change of [{checkedAt:'2026-10-08T11:58:59Z'}, {checkedAt:'2026-10-08T12:00:01Z'},
    {now:'2026-02-30T12:00:00Z'}, {projectId:'unrelated-project'}]) {
    const input = fixture(); Object.assign(input.context,change);
    denied(planManagementManagerReview(input), 'BLOCKED', /CURRENT_CONTEXT_REQUIRED/);
  }
  for (const value of ['2026-10-08T12:00:01Z', '2026-10-08T11:58:59Z', '2026-02-30T12:00:00Z']) {
    const input = fixture(); input.context.validation.validatedAt = value;
    denied(planManagementManagerReview(input), 'BLOCKED', /COMPLETE_BACKEND_VALIDATION_REQUIRED/);
  }
});

test('não concede crédito retroativo nem antecipa vigência da política', () => {
  const old = fixture(); old.review.completedAt = '2026-10-07T23:59:59.000Z'; syncReview(old);
  denied(planManagementManagerReview(old), 'BLOCKED', /RETROACTIVE_CREDIT_FORBIDDEN/);
  const future = fixture(); future.policy.effectiveFrom = '2026-10-09T00:00:00Z';
  denied(planManagementManagerReview(future), 'BLOCKED', /RETROACTIVE_CREDIT_FORBIDDEN/);
});

test('INDEPENDENT_ADMIN é uma escolha explícita e exige pessoa distinta com direitos atuais', () => {
  const input = fixture(); input.policy.validationMode = 'INDEPENDENT_ADMIN';
  denied(planManagementManagerReview(input), 'BLOCKED', /INDEPENDENT_ADMIN_REQUIRED/);
  input.context.validator = {uid:'fixture-admin',active:true,access:true,adminVerified:true};
  input.context.validation.validatorUid = 'fixture-admin';
  const result = planManagementManagerReview(input);
  assert.equal(result.status,'READY'); assert.equal(result.event.validatedByUid,'fixture-admin');
  assert.equal(result.awardSpec.uid,'fixture-manager'); assert.equal(result.awardSpec.approvedByUid,'fixture-admin');
  for (const mutate of [
    current => current.context.validator.uid = current.review.managerUid,
    current => current.context.validator.access = false,
    current => current.context.validator.active = false,
    current => current.context.validator.adminVerified = false,
    current => current.context.validation.validatorUid = 'other-admin'
  ]) {
    const current=clone(input);mutate(current);
    denied(planManagementManagerReview(current),'BLOCKED',/INDEPENDENT_ADMIN_REQUIRED/);
  }
});

test('campo points no pedido, origem arbitrária, hash ou versão inválida não chegam ao plano', () => {
  for (const change of [{points:999}, {materialVersion:0}, {materialVersion:1.5}, {sourceFingerprint:'private text'},
    {requestId:'../private'}, {completedAt:'2026-02-30T12:00:00Z'}, {materialOrigin:{projectId:'other-project',materialId:'material'}},
    {materialOrigin:{projectId:'sahmt-17a16',materialId:'../material'}},
    {materialOrigin:{projectId:'sahmt-17a16',materialId:'material',extra:'secret'}}]) {
    const input=fixture();Object.assign(input.review,change);
    denied(planManagementManagerReview(input),'BLOCKED',/INPUT_INVALID/);
  }
});

test('resultado só expõe campos selecionados; conteúdo privado do contexto não é copiado', () => {
  const input=fixture();
  input.context.profile.email='fictional-private@example.invalid';
  input.context.validation.rawAnswers=['fictional-answer'];
  const result=planManagementManagerReview(input), text=JSON.stringify(result);
  assert.equal(result.status,'READY');
  assert.equal(text.includes('fictional-private'),false);assert.equal(text.includes('fictional-answer'),false);
  result.event.business.unit.materialOrigin.materialId='changed-result';
  assert.equal(input.review.materialOrigin.materialId,'SyntheticMaterial001');
});

test('planner não depende de relógio global, rede, credenciais ou arquivos', () => {
  const originalFetch=globalThis.fetch,originalNow=Date.now;
  globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};Date.now=()=>{throw Error('CLOCK_FORBIDDEN')};
  try {assert.equal(planManagementManagerReview(fixture()).status,'READY');} finally {globalThis.fetch=originalFetch;Date.now=originalNow;}
  const source=readFileSync(new URL('../scripts/lib/management-manager-review-plan.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/firebase-tools|refresh_token|access_token|fetch\(|node:fs|node:child_process|Date\.now/);
});
