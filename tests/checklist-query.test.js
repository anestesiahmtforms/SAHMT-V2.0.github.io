import test from 'node:test';
import assert from 'node:assert/strict';
import {checklistReadMetrics, createChecklistReadCoordinator} from '../src/checklist-query.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
}

test('coalesce queries idênticas em rede lenta e conta leituras do servidor', async () => {
  const coordinator = createChecklistReadCoordinator();
  const stations = Array.from({length: 30}, (_, index) => `station-${index + 1}`);
  const wait = deferred();
  let calls = 0;
  const request = {scope: 'daily', uid: 'fictional-user', period: '2026-09-29', stationIds: stations};
  const first = coordinator.run(request, async () => { calls++; return wait.promise; });
  const duplicate = coordinator.run({...request, stationIds: [...stations].reverse().concat('station-1')}, async () => { calls++; return []; });
  assert.strictEqual(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);

  const snapshots = [{size: 1000}, ...stations.map(() => ({size: 1}))];
  wait.resolve(snapshots);
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.strictEqual(firstResult, duplicateResult);
  assert.deepEqual(checklistReadMetrics(snapshots), {serverQueries: 31, documentsRead: 1030});
  assert.deepEqual(checklistReadMetrics([{size: 2001}, ...stations.map(() => ({size: 1}))]), {serverQueries: 31, documentsRead: 2031});
});

test('separa relatórios por usuário, período e escopo e não altera limites de registros', async () => {
  const coordinator = createChecklistReadCoordinator();
  const calls = [];
  const run = (request) => coordinator.run(request, async () => { calls.push(request); return []; });
  await Promise.all([
    run({scope: 'daily', uid: 'u1', period: '2026-09-29', stationIds: ['s1']}),
    run({scope: 'daily', uid: 'u2', period: '2026-09-29', stationIds: ['s1']}),
    run({scope: 'monthly', uid: 'u1', period: '2026-09', stationIds: ['s1']})
  ]);
  assert.equal(calls.length, 3);
});
