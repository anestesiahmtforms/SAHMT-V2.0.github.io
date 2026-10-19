import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8');
const extract = name => {const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start) + 2; return source.slice(source.lastIndexOf('\n', start) + 1, end).replace('export ', '');};
function harness() {
  const records = new Map(); let writes = 0;
  const ctx = vm.createContext({db: {}, crypto, doc: (_db, ...parts) => parts.join('/'), serverTimestamp: () => 'server-time',
    runTransaction: async (_db, action) => action({get: async ref => ({exists: () => records.has(ref), data: () => records.get(ref)}),
      set(ref, value) {writes++; records.set(ref, value);}, update(ref, value) {writes++; records.set(ref, {...records.get(ref), ...value});}}),
    buildRecordBatch(tx, {collectionName, data, uid, requestId}) {tx.set(collectionName + '/' + requestId, {...data, id: requestId, clientMutationId: requestId, createdByUid: uid, version: 1});}});
  vm.runInContext([extract('canonicalValue'), extract('commitOperationalMutationOnce'), extract('updateLabelRecord')].join('\n'), ctx);
  return {ctx, records, writes: () => writes};
}
test('confirmação perdida e reenvio conservam um único registro e recusam conteúdo divergente', async () => {
  const h = harness(), input = {date: '2026-10-19', patientName: 'Exemplo sintético'};
  await h.ctx.commitOperationalMutationOnce('labels', input, 'actor', 'stable');
  const replay = await h.ctx.commitOperationalMutationOnce('labels', input, 'actor', 'stable');
  assert.equal(replay.alreadyCommitted, true); assert.equal(h.writes(), 1);
  await assert.rejects(h.ctx.commitOperationalMutationOnce('labels', {...input, patientName: 'Outro conteúdo'}, 'actor', 'stable'), {code: 'stale-version'});
  assert.equal(h.writes(), 1);
});
test('reenvio de edição aceita não duplica histórico e versão posterior exige comparação', async () => {
  const h = harness(), input = {date: '2026-10-19', patientName: 'Correção sintética'};
  h.records.set('labels/label', {id: 'label', active: true, status: 'CONFIRMED', version: 1, ...input, patientName: 'Antes'});
  await h.ctx.updateLabelRecord('label', input, 'actor', 'Pessoa sintética', 1, {queueOffline: false});
  await h.ctx.updateLabelRecord('label', input, 'actor', 'Pessoa sintética', 1, {queueOffline: false});
  assert.equal(h.writes(), 2);
  h.records.set('labels/label', {...h.records.get('labels/label'), version: 3});
  await assert.rejects(h.ctx.updateLabelRecord('label', input, 'actor', 'Pessoa sintética', 1, {queueOffline: false}), {code: 'stale-version'});
  assert.equal(h.writes(), 2);
});
