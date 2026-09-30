import test from 'node:test';
import assert from 'node:assert/strict';
import {checklistHistoryStationIds, checklistReadMetrics, createChecklistReadCoordinator} from '../src/checklist-query.js';
import {resolveChecklistDayRecord, summarizeChecklistMonth} from '../src/checklist-date.js';

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

test('consultas de limites diferentes não compartilham resultados incompletos', async () => {
  const coordinator = createChecklistReadCoordinator();
  const waiting = deferred();
  const request = {scope: 'daily', uid: 'u1', period: '2026-09-29', stationIds: ['s1']};
  const small = coordinator.run({...request, recordLimit: 1}, () => waiting.promise);
  const full = coordinator.run({...request, recordLimit: 1000}, async () => ['all-records']);
  assert.notStrictEqual(small, full);
  assert.deepEqual(await full, ['all-records']);
  waiting.resolve(['one-record']);
  assert.deepEqual(await small, ['one-record']);
});

test('dia completo dispensa histórico; estações sem resposta mantêm herança de NÃO', () => {
  const stations = [{id: 'a', active: true}, {id: 'b', active: true}];
  const current = [{stationId: 'a', date: '2026-09-29', condition: 'SIM'}];
  assert.deepEqual(checklistHistoryStationIds(['a', 'b', 'a'], current, '2026-09-29'), ['b']);
  assert.deepEqual(checklistHistoryStationIds(['a', 'b'], [...current, {stationId: 'b', date: '2026-09-29'}], '2026-09-29'), []);
  assert.deepEqual(checklistHistoryStationIds(['a', 'b'], [], '2026-09-29'), ['a', 'b']);
  const previous = {stationId: 'b', date: '2026-09-28', condition: 'NAO'};
  assert.equal(resolveChecklistDayRecord(stations[0], current[0], null, '2026-09-29', '2026-09-29'), current[0]);
  assert.deepEqual(resolveChecklistDayRecord(stations[1], null, previous, '2026-09-29', '2026-09-29'), {...previous, inherited: true});
});

test('mês só dispensa histórico de estação com resposta no primeiro dia e preserva resumo', () => {
  const stations = [{id: 'a', active: true}, {id: 'b', active: true}];
  const records = [
    {stationId: 'a', date: '2026-09-01', condition: 'SIM'},
    {stationId: 'b', date: '2026-09-03', condition: 'SIM'}
  ];
  const prior = [{stationId: 'a', date: '2026-08-31', condition: 'NAO'}, {stationId: 'b', date: '2026-08-31', condition: 'NAO'}];
  const needed = checklistHistoryStationIds(['a', 'b'], records, '2026-09-01');
  assert.deepEqual(needed, ['b']);
  assert.deepEqual(
    summarizeChecklistMonth('2026-09', '2026-09-04', stations, records, prior.filter((record) => needed.includes(record.stationId))),
    summarizeChecklistMonth('2026-09', '2026-09-04', stations, records, prior)
  );
  // Se o limite cortou a resposta do dia 1, a estação continua pedindo histórico.
  assert.deepEqual(checklistHistoryStationIds(['a', 'b'], records.slice(1), '2026-09-01'), ['a', 'b']);
});
