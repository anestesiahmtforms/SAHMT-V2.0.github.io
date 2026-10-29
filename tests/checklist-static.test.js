import {readChecklistStationDay} from '../src/checklist-history.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChecklistQrLookup, buildChecklistStationDayLookup, resolveChecklistQrStation} from '../src/checklist-static.js';

const station = {id: 'sala-1', name: 'Sala 1', qrCode: 'SAHMT:CHK:0001', active: true};

test('QR lookup uses one exact, bounded catalog query', () => {
  const calls = [];
  const sdk = Object.fromEntries(['collection', 'where', 'query', 'limit', 'or', 'documentId'].map(name => [name, (...args) => {
    calls.push([name, ...args]); return {name, args};
  }]));
  const result = buildChecklistQrLookup('SAHMT:CHK:0001', sdk, 'db');
  assert.equal(result.name, 'query');
  assert.deepEqual(calls.map(([name]) => name), ['collection', 'where', 'documentId', 'where', 'or', 'limit', 'query']);
  assert.deepEqual(calls[1], ['where', 'qrCode', '==', 'SAHMT:CHK:0001']);
  assert.deepEqual(calls[3], ['where', {name: 'documentId', args: []}, '==', 'SAHMT:CHK:0001']);
  assert.deepEqual(calls[5], ['limit', 2]);
});

test('QR station state lookup reads only the selected arsenal through the requested day', () => {
  const calls = [];
  const sdk = Object.fromEntries(['collection', 'where', 'query', 'limit', 'orderBy'].map(name => [name, (...args) => {
    calls.push([name, ...args]); return {name, args};
  }]));
  const result = buildChecklistStationDayLookup('sala-1', '2026-10-21', sdk, 'db');
  assert.equal(result.name, 'query');
  assert.deepEqual(calls.map(([name]) => name), ['collection', 'where', 'where', 'orderBy', 'orderBy', 'limit', 'query']);
  assert.deepEqual(calls[1], ['where', 'stationId', '==', 'sala-1']);
  assert.deepEqual(calls[2], ['where', 'date', '<=', '2026-10-21']);
  assert.deepEqual(calls[5], ['limit', 1]);
});

test('valid cached QR resolves without a server lookup', async () => {
  let lookups = 0;
  const result = await resolveChecklistQrStation({stations: [station], qrValue: station.qrCode, day: '2026-10-21', readByQr: async () => {lookups++; return [];} });
  assert.deepEqual(result, station);
  assert.equal(lookups, 0);
});

test('uncached QR performs one lookup and only accepts a unique station valid on the day', async () => {
  let lookups = 0;
  const result = await resolveChecklistQrStation({stations: [], qrValue: station.qrCode, day: '2026-10-21', readByQr: async value => {lookups++; assert.equal(value, station.qrCode); return [station];} });
  assert.deepEqual(result, station);
  assert.equal(lookups, 1);
});

test('duplicate, inactive, and out-of-range QR matches fail closed', async () => {
  const lookup = async records => resolveChecklistQrStation({stations: [], qrValue: station.qrCode, day: '2026-10-21', readByQr: async () => records});
  assert.equal(await lookup([station, {...station, id: 'sala-2'}]), null);
  assert.equal(await lookup([{...station, active: false}]), null);
  assert.equal(await lookup([{...station, start: '2026-10-22'}]), null);
  assert.equal(await lookup([{...station, end: '2026-10-20'}]), null);
});

test('empty QR is rejected without querying', async () => {
  let lookups = 0;
  assert.equal(await resolveChecklistQrStation({stations: [], qrValue: '  ', day: '2026-10-21', readByQr: async () => {lookups++; return [];} }), null);
  assert.equal(lookups, 0);
});

test('QR containing a URL never becomes an invalid Firestore document ID', () => {
  const calls = [];
  const sdk = Object.fromEntries(['collection', 'where', 'query', 'limit', 'or', 'documentId'].map(name => [name, (...args) => {
    if (name === 'where' && args[0]?.name === 'documentId' && args[2].includes('/')) {
      throw new Error('Invalid document ID: collection queries require a plain document ID');
    }
    calls.push([name, ...args]); return {name, args};
  }]));
  const value = 'https://example.invalid/arsenal/qr-ficticio';
  const result = buildChecklistQrLookup(value, sdk, 'db');
  assert.equal(result.name, 'query');
  assert.deepEqual(calls.filter(([name]) => name === 'where'), [['where', 'qrCode', '==', value]]);
  assert.equal(calls.some(([name]) => name === 'documentId'), false);
  assert.deepEqual(calls.find(([name]) => name === 'limit'), ['limit', 2]);
});

test('uncached QR URL resolves by exact registered value without navigating', async () => {
  const value = 'https://example.invalid/arsenal/qr-ficticio';
  const linkedStation = {...station, qrCode: value};
  assert.equal(await resolveChecklistQrStation({
    qrValue: value, day: '2026-10-29', readByQr: async qr => qr === value ? [linkedStation] : []
  }), linkedStation);
});

function historySdk({records = [], indexed = [], failure} = {}) {
  const queries = [];
  const sdk = Object.fromEntries(['collection', 'query', 'where', 'orderBy', 'limit'].map(name =>
    [name, (...args) => ({name, args})]));
  const docs = records => records.map(record => ({id: record.id, data: () => record}));
  sdk.getDocs = async query => {
    queries.push(query);
    if (queries.length === 1) {
      if (failure) throw failure;
      return {docs: docs(indexed)};
    }
    return {docs: docs(records)};
  };
  return {sdk, queries};
}
const missingIndex = () => Object.assign(new Error('The query requires an index.'), {code: 'failed-precondition'});
const historyRecord = (id, date, millis, extra = {}) => ({id, stationId: 'sala-1', date,
  condition: 'NAO', createdAt: {toMillis: () => millis}, ...extra});

test('indexed history returns its one latest record without fallback reads', async () => {
  const record = historyRecord('latest', '2026-10-29', 10);
  const h = historySdk({indexed: [record]});
  assert.deepEqual(await readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db'), record);
  assert.equal(h.queries.length, 1);
});

test('missing history index recovers exact latest state from selected arsenal only', async () => {
  const latest = historyRecord('latest-failure', '2026-10-29', 20);
  const h = historySdk({failure: missingIndex(), records: [
    historyRecord('future', '2026-10-30', 50),
    historyRecord('prior', '2026-10-28', 100),
    historyRecord('earlier-today', '2026-10-29', 10, {condition: 'SIM'}),
    latest,
    historyRecord('other-arsenal', '2026-10-29', 200, {stationId: 'sala-2'}),
    historyRecord('no-timestamp', '2026-10-29', 300, {createdAt: null})
  ]});
  assert.deepEqual(await readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db'), latest);
  assert.equal(h.queries.length, 2);
  assert.deepEqual(h.queries[1], {name: 'query', args: [
    {name: 'collection', args: ['db', 'checklists']},
    {name: 'where', args: ['stationId', '==', 'sala-1']}, {name: 'limit', args: [501]}
  ]});
});

test('history fallback preserves nanoseconds and descending document-ID tiebreak', async () => {
  const a = historyRecord('a', '2026-10-29', 10, {createdAt: {toMillis: () => 10, nanoseconds: 10}});
  const b = historyRecord('b', '2026-10-29', 10, {createdAt: {toMillis: () => 10, nanoseconds: 20}});
  const c = {...b, id: 'c'};
  const h = historySdk({failure: missingIndex(), records: [a, c, b]});
  assert.equal((await readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db')).id, 'c');
});

test('empty indexed or fallback history returns no record, without inventing completion', async () => {
  for (const failure of [undefined, missingIndex()]) {
    const h = historySdk({failure});
    assert.equal(await readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db'), null);
  }
});

test('history fallback refuses to choose from a truncated collection', async () => {
  const h = historySdk({failure: missingIndex(), records: Array.from({length: 501}, (_, i) =>
    historyRecord(String(i), '2026-10-29', i))});
  await assert.rejects(readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db'), {code: 'checklist-history-incomplete'});
});

test('permission and network failures never trigger history fallback', async () => {
  for (const failure of [
    Object.assign(new Error('Denied'), {code: 'permission-denied'}),
    Object.assign(new Error('Offline'), {code: 'unavailable'}),
    Object.assign(new Error('Other precondition'), {code: 'failed-precondition'})
  ]) {
    const h = historySdk({failure});
    await assert.rejects(readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db'), error => error === failure);
    assert.equal(h.queries.length, 1);
  }
});
