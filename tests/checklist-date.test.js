import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checklistDayMode, resolveChecklistDayRecord, summarizeChecklistDay, summarizeChecklistMonth} from '../src/checklist-date.js';

test('Checklist permite leitura histórica, escrita apenas hoje e bloqueia o futuro', () => {
  assert.equal(checklistDayMode('2026-09-23', '2026-09-24'), 'history');
  assert.equal(checklistDayMode('2026-09-24', '2026-09-24'), 'today');
  assert.equal(checklistDayMode('2026-09-25', '2026-09-24'), 'future');
  assert.equal(checklistDayMode('', '2026-09-24'), 'invalid');
  assert.equal(checklistDayMode('2026-09-24', ''), 'invalid');
});

test('resumo mensal conta somente a última resposta de estação vigente no dia', () => {
  const stations = [
    {id: 'sala-a', active: true, start: '2026-01-01'},
    {id: 'sala-b', active: true, end: '2026-09-23'},
    {id: 'sala-c', active: false}
  ];
  const records = [
    {id: 'new', stationId: 'sala-a', date: '2026-09-24', condition: 'NAO'},
    {id: 'old', stationId: 'sala-a', date: '2026-09-24', condition: 'SIM'},
    {id: 'out-of-range', stationId: 'sala-b', date: '2026-09-24', condition: 'SIM'}
  ];
  const result = summarizeChecklistDay('2026-09-24', '2026-09-24', stations, records);
  assert.equal(result.total, 2);
  assert.equal(result.recorded, 1);
  assert.equal(result.nonconforming, 1);
  assert.equal(result.text, '1/2 estação(ões) · 0 conforme(s) · 1 não conforme(s)');
  assert.equal(summarizeChecklistDay('2026-09-25', '2026-09-24', stations, records).text, 'Data futura');
  assert.equal(summarizeChecklistDay('2026-09-24', '2026-09-24', [], []).text, 'Sem estações aplicáveis');
});

test('Checklist herda somente o último NÃO para estação sem resposta no dia', () => {
  const priorFailure = {id: 'old-nao', date: '2026-09-23', condition: 'NAO', occurrence: 'Vazamento'};
  const priorOk = {id: 'old-sim', date: '2026-09-23', condition: 'SIM'};
  const current = {id: 'today', date: '2026-09-24', condition: 'SIM'};
  assert.deepEqual(resolveChecklistDayRecord({id: 'sala', active: true}, null, priorFailure, '2026-09-24', '2026-09-24'), {...priorFailure, inherited: true});
  assert.equal(resolveChecklistDayRecord({id: 'sala', active: true}, null, priorOk, '2026-09-24', '2026-09-24'), null);
  assert.equal(resolveChecklistDayRecord({id: 'sala', active: false}, null, priorFailure, '2026-09-24', '2026-09-24'), null);
  assert.equal(resolveChecklistDayRecord({id: 'sala', active: true}, current, priorFailure, '2026-09-24', '2026-09-24'), current);
});

test('resumo mensal herda o último NÃO até uma nova resposta e respeita vigência e inatividade', () => {
  const stations = [
    {id: 'a', active: true, start: '2026-09-01'},
    {id: 'b', active: true, end: '2026-09-02'},
    {id: 'c', active: false}
  ];
  const priorRecords = [
    {id: 'a-old', stationId: 'a', date: '2026-08-31', condition: 'NAO', occurrence: 'Vazamento'},
    {id: 'b-old', stationId: 'b', date: '2026-08-31', condition: 'SIM'},
    {id: 'c-old', stationId: 'c', date: '2026-08-31', condition: 'NAO'}
  ];
  const records = [
    {id: 'b-new', stationId: 'b', date: '2026-09-01', condition: 'NAO', createdAt: new Date('2026-09-01T11:00:00Z')},
    {id: 'a-recovered', stationId: 'a', date: '2026-09-03', condition: 'SIM', createdAt: new Date('2026-09-03T11:00:00Z')},
    {id: 'c-history', stationId: 'c', date: '2026-09-02', condition: 'SIM', createdAt: new Date('2026-09-02T11:00:00Z')}
  ];
  const days = summarizeChecklistMonth('2026-09', '2026-09-04', stations, records, priorRecords);
  assert.equal(days.length, 30);
  assert.equal(days[0].inherited, 1);
  assert.equal(days[0].nonconforming, 2);
  assert.equal(days[1].inherited, 2);
  assert.equal(days[2].inherited, 0);
  assert.equal(days[2].conforming, 1);
  assert.equal(days[1].total, 3);
  assert.equal(days[1].recorded, 3);
  assert.equal(days[3].inherited, 0);
  assert.equal(days[4].mode, 'future');
});

test('resumo histórico inclui estação inativa na vigência, sem permitir herdar falha', () => {
  const stations = [{id: 'old', active: false, start: '2026-01-01', end: '2026-12-31'}];
  const result = summarizeChecklistDay('2026-09-24', '2026-09-24', stations, [
    {id: 'old-check', stationId: 'old', date: '2026-09-24', condition: 'NAO'}
  ]);
  assert.equal(result.total, 1);
  assert.equal(result.recorded, 1);
  assert.equal(result.nonconforming, 1);
  assert.equal(resolveChecklistDayRecord(stations[0], null, {condition: 'NAO'}, '2026-09-24', '2026-09-24'), null);
});
