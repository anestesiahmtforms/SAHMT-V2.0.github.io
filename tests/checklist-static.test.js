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
