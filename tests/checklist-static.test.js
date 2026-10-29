import {readChecklistStationDay} from '../src/checklist-history.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChecklistQrLookup, buildChecklistStationDayLookup, resolveChecklistQrStation, readChecklistQrStation} from '../src/checklist-static.js';

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

function historySdk({records = [], indexed = [], failure, fieldFailure} = {}) {
  const queries = [];
  const sdk = Object.fromEntries(['collection', 'query', 'where', 'orderBy', 'limit', 'startAfter', 'or', 'documentId'].map(name =>
    [name, (...args) => ({name, args})]));
  const docs = records => records.map(record => ({id: record.id, data: () => record}));
  sdk.getDocs = async query => {
    queries.push(query);
    if (queries.length === 1) {
      if (failure) throw failure;
      return {docs: docs(indexed)};
    }
    if (fieldFailure && query.args.some(arg => arg.name === 'where')) throw fieldFailure;
    const sorted = [...records].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const after = query.args.find(arg => arg.name === 'startAfter')?.args[0].id;
    const offset = after == null ? 0 : sorted.findIndex(record => record.id === after) + 1;
    const count = query.args.find(arg => arg.name === 'limit').args[0];
    return {docs: docs(sorted.slice(offset, offset + count))};
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
    {name: 'where', args: ['stationId', '==', 'sala-1']}, {name: 'limit', args: [100]}
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

test('history fallback reads more than 500 records to exhaustion before choosing latest', async () => {
  const h = historySdk({failure: missingIndex(), records: Array.from({length: 1205}, (_, i) =>
    historyRecord(String(i), '2026-10-29', i))});
  assert.equal((await readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db')).id, '1204');
  assert.equal(h.queries.length, 14);
  assert.ok(h.queries.slice(2).every(query => query.args.some(arg => arg.name === 'startAfter')));
});

test('permission and network failures never trigger history fallback', async () => {
  for (const failure of [
    Object.assign(new Error('Denied'), {code: 'permission-denied'}),
    Object.assign(new Error('Offline'), {code: 'unavailable'})
  ]) {
    const h = historySdk({failure});
    await assert.rejects(readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db'), error => error === failure);
    assert.equal(h.queries.length, 1);
  }
});

test('history recovers even when stationId field indexes are unavailable', async () => {
  const latest = historyRecord('latest', '2026-10-29', 20);
  const h = historySdk({failure: missingIndex(), fieldFailure: missingIndex(), records: [
    latest, historyRecord('other', '2026-10-29', 100, {stationId: 'sala-2'}),
    historyRecord('future', '2026-10-30', 200)
  ]});
  assert.deepEqual(await readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db'), latest);
  assert.equal(h.queries.length, 3);
  assert.equal(h.queries[2].args.some(arg => arg.name === 'where' || arg.name === 'orderBy'), false);
});

test('catalog recovers exact QR and stable-ID matches without field indexes', async () => {
  for (const qrValue of [station.qrCode, station.id]) {
    const h = historySdk({failure: missingIndex(), records: [station]});
    assert.deepEqual(await readChecklistQrStation(qrValue, h.sdk, 'db'), station);
    assert.deepEqual(h.queries[1].args, [{name: 'collection', args: ['db', 'stations']}, {name: 'limit', args: [100]}]);
  }
});

test('catalog does not pick a QR before checking later pages for duplicate matches', async () => {
  const records = Array.from({length: 210}, (_, i) => ({id: String(i).padStart(3, '0'), active: true, qrCode: String(i)}));
  records[0].qrCode = station.qrCode; records[209].qrCode = station.qrCode;
  const h = historySdk({failure: missingIndex(), records});
  assert.equal(await readChecklistQrStation(station.qrCode, h.sdk, 'db'), null);
  assert.equal(h.queries.length, 4);
});

test('exactly full history page requires an empty final page to establish completion', async () => {
  const h = historySdk({failure: missingIndex(), records: Array.from({length: 200}, (_, i) => historyRecord(String(i), '2026-10-29', i))});
  assert.equal((await readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db')).id, '199');
  assert.equal(h.queries.length, 4);
});

test('network failure on a later page rejects instead of returning partial latest history', async () => {
  const h = historySdk({failure: missingIndex(), records: Array.from({length: 201}, (_, i) => historyRecord(String(i), '2026-10-29', i))});
  const getDocs = h.sdk.getDocs; let calls = 0;
  h.sdk.getDocs = query => ++calls === 3
    ? Promise.reject(Object.assign(new Error('Disconnected'), {code: 'unavailable'})) : getDocs(query);
  await assert.rejects(readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db'), {code: 'unavailable'});
  assert.equal(calls, 3);
});

test('canceling while a history page is pending stops all further requests', async () => {
  const h = historySdk({failure: missingIndex(), records: Array.from({length: 201}, (_, i) => historyRecord(String(i), '2026-10-29', i))});
  const getDocs = h.sdk.getDocs; let current = true, calls = 0;
  h.sdk.getDocs = async query => {
    const result = await getDocs(query);
    if (++calls === 1) current = false;
    return result;
  };
  await assert.rejects(readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db', {isCurrent: () => current}),
    {code: 'checklist-read-cancelled'});
  assert.equal(h.queries.length, 2);
});

test('precondition recovery is independent of localized or missing error messages', async () => {
  const h = historySdk({failure: Object.assign(new Error(''), {code: 'failed-precondition'}), records: [historyRecord('one', '2026-10-29', 1)]});
  assert.equal((await readChecklistStationDay('sala-1', '2026-10-29', h.sdk, 'db')).id, 'one');
});

test('catalog permission denial is never retried as a broad collection read', async () => {
  const h = historySdk({failure: Object.assign(new Error('Denied'), {code: 'permission-denied'})});
  await assert.rejects(readChecklistQrStation(station.qrCode, h.sdk, 'db'), {code: 'permission-denied'});
  assert.equal(h.queries.length, 1);
});
