import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessManagementReadBudget, firestoreQuotaDayStart, describeManagementReadObservation} from '../scripts/lib/management-read-budget.js';
const nowMs = Date.parse('2026-10-08T23:20:00.000Z');
const day = firestoreQuotaDayStart(nowMs);
const observation = {project: 'sahmt-17a16', metric: 'firestore.googleapis.com/document/read_ops_count', quotaDayStart: day, reads: 4109, verifiedAt: '2026-10-08T23:19:00.000Z', latestPoint: '2026-10-08T23:17:00.000Z', complete: true, fresh: true};
const policy = {schemaVersion: 1, projectId: 'sahmt-17a16', dailyReadLimit: 35000, quotaTimeZone: 'America/Los_Angeles', renewalClearsPause: false, pausedRequiresReview: false, authorizedPurpose: 'MANAGEMENT_BACKUP_ONLY', humanDecisionAt: '2026-10-08T23:10:00.000Z', appTrafficReserve: 5000, metricLagReserve: 2000, maximumCaptureReserve: 6000, reservationQuotaDayStart: day, reservedReads: 200};
const input = changes => ({projectId: 'sahmt-17a16', nowMs, observation, policy, maximumReads: 100, legacyReservedReads: 8000, ...changes});
test('reserva a margem de app, atraso e trabalho anterior sem alterar entrada', () => {
  const before = JSON.stringify(input()), result = assessManagementReadBudget(input());
  assert.equal(result.estimatedWithMargin, 19409); assert.equal(result.reservedReads, 300); assert.equal(result.exactGlobalCutoff, false); assert.equal(JSON.stringify(input()), before);
});
test('renovação diária não limpa a pausa nem reutiliza decisão do dia anterior', () => {
  assert.throws(() => assessManagementReadBudget(input({policy: {...policy, pausedRequiresReview: true}})), /PAUSED/);
  assert.throws(() => assessManagementReadBudget(input({nowMs: Date.parse('2026-10-09T07:01:00Z')})), /CURRENT_DAY/);
  assert.throws(() => assessManagementReadBudget(input({policy: {...policy, reservationQuotaDayStart: '2026-10-07T07:00:00Z'}})), /DAY_REVIEW/);
});
test('fresh declarado não valida ponto antigo, captura incompleta ou relógio futuro', () => {
  for (const change of [{fresh: false}, {complete: false}, {latestPoint: '2026-10-08T21:14:00Z'}, {verifiedAt: '2026-10-08T23:21:00Z'}, {reads: -1}, {metric: 'firestore.googleapis.com/document/read_count'}]) {
    assert.throws(() => assessManagementReadBudget(input({observation: {...observation, ...change}})), /STALE_OR_INCOMPLETE/);
  }
});
test('falha fechada no limite, reserva excedida, projeto trocado ou finalidade indevida', () => {
  assert.throws(() => assessManagementReadBudget(input({observation: {...observation, reads: 19700}})), /DAILY_LIMIT/);
  assert.throws(() => assessManagementReadBudget(input({maximumReads: 5801})), /CAPTURE_RESERVE_LIMIT/);
  assert.throws(() => assessManagementReadBudget(input({projectId: 'sahmt-gestao-5ae66'})), /INVALID_MANAGEMENT_READ_POLICY/);
  assert.throws(() => assessManagementReadBudget(input({policy: {...policy, authorizedPurpose: 'TRAINING_RELEASE'}})), /NOT_AUTHORIZED/);
});
test('dia da cota usa Los Angeles inclusive transições de horário de verão', () => {
  assert.equal(firestoreQuotaDayStart(Date.parse('2026-03-08T20:00:00Z')), '2026-03-08T08:00:00.000Z');
  assert.equal(firestoreQuotaDayStart(Date.parse('2026-11-01T20:00:00Z')), '2026-11-01T07:00:00.000Z');
  assert.equal(day, '2026-10-08T07:00:00.000Z');
});
test("45 mil autorizado somente em FA preserva margem, pausa e teto FB", () => {
 const raised={...policy,dailyReadLimit:45000,limitApprovalEvidence:"USER_FA_DAILY_LIMIT_45000_2026_10_08"};
 const result=assessManagementReadBudget(input({policy:raised,observation:{...observation,reads:25000}}));
 assert.equal(result.estimatedWithMargin,40300);assert.equal(result.remainingAfterMargin,4700);
 assert.throws(()=>assessManagementReadBudget(input({policy:{...raised,pausedRequiresReview:true}})),/PAUSED/);
 assert.throws(()=>assessManagementReadBudget(input({policy:{...raised,limitApprovalEvidence:null}})),/INCREASE_NOT_AUTHORIZED/);
 assert.throws(()=>assessManagementReadBudget(input({policy:raised,observation:{...observation,reads:29700}})),/DAILY_LIMIT/);
 assert.throws(()=>assessManagementReadBudget(input({projectId:"sahmt-gestao-5ae66",policy:{...raised,projectId:"sahmt-gestao-5ae66"}})),/INVALID_MANAGEMENT_READ_POLICY/);
});

const manualNow=Date.parse("2026-10-09T01:04:10Z"), manualDay=firestoreQuotaDayStart(manualNow);
const manualObservation={observationSource:"USER_CURRENT_USAGE_DASHBOARD_REVIEW",project:"sahmt-17a16",quotaDayStart:manualDay,capturedAt:"2026-10-09T01:01:02.000Z",reviewedAt:"2026-10-09T01:04:05.000Z",periodStart:"2026-10-08T01:01:02.000Z",periodKind:"LAST_24_HOURS",reads:5000,displayedEstimate:"4.1k",evidenceSha256:"a".repeat(64),exactGlobalCutoff:false};
const manualPolicy={...policy,dailyReadLimit:45000,limitApprovalEvidence:"USER_FA_DAILY_LIMIT_45000_2026_10_08",manualReviewEvidence:"USER_PROVIDED_FA_USAGE_CAPTURE_2026_10_08_220102",manualReviewSha256:"a".repeat(64),humanDecisionAt:"2026-10-09T01:04:05Z"};
const manualInput=changes=>input({nowMs:manualNow,policy:manualPolicy,observation:manualObservation,...changes});
test("conferência humana atual só admite estimativa conservadora FA45k e guarda margens",()=>{const before=JSON.stringify(manualInput());const result=assessManagementReadBudget(manualInput());assert.equal(result.estimatedWithMargin,20300);assert.equal(result.remainingAfterMargin,24700);assert.equal(result.observationSource,"USER_CURRENT_USAGE_DASHBOARD_REVIEW");assert.equal(JSON.stringify(manualInput()),before);assert.throws(()=>assessManagementReadBudget(manualInput({policy:{...manualPolicy,pausedRequiresReview:true}})),/PAUSED/);assert.throws(()=>assessManagementReadBudget(manualInput({maximumReads:5801})),/CAPTURE_RESERVE/);});
test("conferência humana não inventa medição exata na prova",()=>{const result=describeManagementReadObservation(manualObservation);assert.equal(result.totalUsageKnown,false);assert.equal(result.measuredTotalReads,null);assert.equal(result.estimatedUpperReads,5000);assert.equal(result.evidenceSha256,manualObservation.evidenceSha256);assert.equal(result.capturedAt,manualObservation.capturedAt);});
test("conferência humana nega FB, teto35k, hashes, limites e fonte trocada",()=>{for(const change of [{projectId:"sahmt-gestao-5ae66",policy:{...manualPolicy,projectId:"sahmt-gestao-5ae66",dailyReadLimit:35000}},{policy:{...manualPolicy,dailyReadLimit:35000}},{policy:{...manualPolicy,manualReviewSha256:"b".repeat(64)}},{policy:{...manualPolicy,manualReviewEvidence:null}},{legacyReservedReads:32700}])assert.throws(()=>assessManagementReadBudget(manualInput(change)));});
test("conferência humana nega captura velha, futura, janela incompleta ou arredondamento diferente",()=>{for(const change of [{capturedAt:"2026-10-09T00:59:09Z",periodStart:"2026-10-08T00:59:09Z"},{capturedAt:"2026-10-09T01:05:00Z"},{capturedAt:"invalid"},{reviewedAt:"2026-10-09T01:05:00Z"},{periodStart:"2026-10-08T08:00:00Z"},{periodKind:"CURRENT_LOCAL_DAY"},{reads:4109},{displayedEstimate:"4.2k"},{evidenceSha256:"missing"},{exactGlobalCutoff:true}])assert.throws(()=>assessManagementReadBudget(manualInput({observation:{...manualObservation,...change}})),/MANUAL_SOURCE/);assert.throws(()=>assessManagementReadBudget(manualInput({nowMs:Date.parse("2026-10-09T01:06:02.001Z")})),/MANUAL_SOURCE/);});
