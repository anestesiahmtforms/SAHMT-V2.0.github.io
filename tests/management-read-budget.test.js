import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessManagementReadBudget, firestoreQuotaDayStart} from '../scripts/lib/management-read-budget.js';
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