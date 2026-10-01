// Fixture local: mede o plano de consultas, sem acessar Firebase ou dados reais.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {checklistReadMetrics, readChecklistWithHistory} from '../src/checklist-query.js';

const stations = Array.from({length: 30}, (_, i) => `fictional-station-${i + 1}`);
const wait = () => new Promise((resolve) => setTimeout(resolve, 90));
const snapshot = (records) => ({size: records.length, docs: records.map((record) => ({data: () => record}))});
const rows = (count, answered, firstDay) => Array.from({length: count}, (_, i) => ({stationId: stations[i % answered], date: firstDay, condition: i % 2 ? 'SIM' : 'NAO'}));
const cases = [
  {name: 'diário completo', firstDay: '2026-09-29', records: rows(1000, 30, '2026-09-29'), expectedQueries: 1},
  {name: 'diário com cinco estações sem resposta', firstDay: '2026-09-29', records: rows(1000, 25, '2026-09-29'), expectedQueries: 6},
  {name: 'diário vazio', firstDay: '2026-09-29', records: [], expectedQueries: 31},
  {name: 'mensal completo no dia 1, com sentinela de truncamento', firstDay: '2026-09-01', records: rows(2001, 30, '2026-09-01'), recordLimit: 2000, expectedQueries: 1}
];
const measurements = [];
const median = (values) => Math.round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]);
for (const fixture of cases) {
  const current = snapshot(fixture.records);
  const readCurrent = async () => { await wait(); return current; };
  const readPrevious = async (stationId) => { await wait(); return snapshot([{stationId, date: '2026-08-31', condition: 'NAO'}]); };
  const beforeTimes = []; const afterTimes = [];
  let beforeSnapshots; let after;
  for (let sample = 0; sample < 5; sample++) {
    const beforeStart = performance.now();
    beforeSnapshots = await Promise.all([readCurrent(), ...stations.map(readPrevious)]);
    beforeTimes.push(performance.now() - beforeStart);
    const afterStart = performance.now();
    after = await readChecklistWithHistory({...fixture, stationIds: stations, readCurrent, readPrevious});
    afterTimes.push(performance.now() - afterStart);
    assert.equal(after.readMetrics.serverQueries, fixture.expectedQueries);
  }
  measurements.push({scenario: fixture.name, before: {...checklistReadMetrics(beforeSnapshots), medianDurationMs: median(beforeTimes)}, after: {...after.readMetrics, medianDurationMs: median(afterTimes)}});
}
console.log(JSON.stringify({fixture: '30 estações fictícias; 5 amostras; atraso controlado de 90 ms por chamada; duração do controlador, não de aparelho/Firestore', measurements}, null, 2));
