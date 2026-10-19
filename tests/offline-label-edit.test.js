import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {persistOperationalMutation} from '../src/offline-mutation.js';
import {mergeReportPendingRecords} from '../src/report-pending.js';
import {isOfflineOperationAuthorized} from '../src/offline-outbox-policy.js';
const source = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8');
test('correção autorizada de etiqueta conserva versão base e rascunho sem conexão', async () => {
  const queued = [];
  const ctx = vm.createContext({crypto, persistOperationalMutation, navigator: {onLine: false}, isOfflineRuntimeForced: () => true,
    enqueueOperation: async operation => queued.push(operation), removeQueuedOperation: () => assert.fail('Não descartar'), mayUseOfflineCache: () => true,
    updateQueuedOperation: async () => {}, operationalBackend: {noteFailure() {}}, db: {}, doc: () => ({}), runTransaction: () => assert.fail('Não consultar servidor')});
  vm.runInContext(source.slice(source.indexOf('export async function updateLabelRecord('), source.indexOf('export async function listLabelHistory(')).replace('export ', ''), ctx);
  const result = await ctx.updateLabelRecord('label-fixture', {date: '2026-10-19', patientName: 'Exemplo corrigido'}, 'actor-fixture', 'Pessoa sintética', 2);
  assert.equal(result.pendingFirestore, true); assert.equal(queued[0].payload.expectedVersion, 2); assert.equal(queued[0].type, 'labelEdits');
});
test('edição local de etiqueta exige escrita ou gestão e conflito não substitui o registro aceito', () => {
  const operation = {uid: 'actor', type: 'labelEdits', resourceId: 'label', requestId: 'edit', status: 'awaiting-confirmation', createdAt: 1,
    payload: {collectionName: 'labels', labelId: 'label', expectedVersion: 1, data: {date: '2026-10-19', patientName: 'Correção sintética'}}};
  const profile = {active: true, access: true, permissions: {}};
  assert.equal(isOfflineOperationAuthorized(operation, profile), false);
  profile.permissions.labelsManage = true; assert.equal(isOfflineOperationAuthorized(operation, profile), true);
  const remote = [{id: 'label', version: 3, createdByUid: 'owner', active: true, date: '2026-10-19', patientName: 'Versão atual'}];
  const records = mergeReportPendingRecords('labels', remote, [operation], {uid: 'actor', canManage: true, day: '2026-10-19'});
  assert.equal(records.find(item => item.id === 'label').patientName, 'Versão atual');
  assert.ok(records.some(item => item.pendingEdit && item.syncConflict));
});
