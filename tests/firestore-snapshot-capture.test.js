import test from 'node:test';
import assert from 'node:assert/strict';
import {captureFirestoreSnapshot} from '../scripts/lib/firestore-snapshot-capture.js';
import {snapshotDigest, validateSplitSnapshot} from '../scripts/lib/management-split-plan.js';

const readTime = '2026-10-08T12:00:00.123456Z';
const clockStart = Date.parse('2026-10-08T12:00:01Z');
const name = (path, project = 'sahmt-17a16') => `projects/${project}/databases/(default)/documents/${path}`;
const doc = (path, fields = {}, project) => ({name: name(path, project), fields, createTime: '2026-10-01T00:00:00.123456789Z', updateTime: '2026-10-08T12:00:00.123456000Z'});
function fixture(overrides = {}) {
  const calls = [], reservations = [], checkpoints = [], events = [];
  let current = clockStart;
  const options = {projectId: 'sahmt-17a16', rootCollections: ['managementAreas'], readTime, pageSize: 2, collectionPageSize: 2,
    clock: () => current,
    reserveReads: async reservation => { reservations.push(structuredClone(reservation)); events.push('reserve'); return true; },
    checkpoint: async state => { checkpoints.push(structuredClone(state)); events.push('checkpoint'); },
    transport: async (request, context) => { calls.push(structuredClone(request)); events.push('transport'); assert.ok(context.signal instanceof AbortSignal); return request.operation === 'listDocuments' ? {documents: [doc('managementAreas/a')]} : {}; },
    ...overrides};
  return {options, calls, reservations, checkpoints, events, setClock: value => {current = value;}, getClock: () => current};
}
const assertIncomplete = (result, code) => {assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.snapshot, null); assert.equal(result.errorCode, code); assert.equal(result.receipt.complete, false); assert.equal(result.receipt.consistent, false); assert.equal(result.state.status, 'INCOMPLETE');};

test('captures every page and orphan descendants at the same readTime, preserving REST types', async () => {
  const f = fixture();
  const payload = {counter: {integerValue: '9223372036854775807'}, at: {timestampValue: '2026-10-01T00:00:00.123456789Z'}, binary: {bytesValue: 'AAEC'}, reference: {referenceValue: name('managementAreas/current')}, special: {doubleValue: 'NaN'}, nested: {mapValue: {fields: {list: {arrayValue: {values: [{nullValue: null}, {booleanValue: false}]}}}}}};
  const replies = [
    {documents: [{name: name('managementAreas/deleted')}], nextPageToken: 'root-next'},
    {documents: [{name: name('managementAreas/current'), createTime: '2026-10-01T00:00:00Z', updateTime: readTime}]},
    {collectionIds: [], nextPageToken: 'child-next'},
    {collectionIds: ['history']},
    {},
    {documents: [doc('managementAreas/deleted/history/revision', payload)]},
    {}
  ];
  f.options.transport = async (request, context) => { assert.ok(context.signal instanceof AbortSignal); assert.equal(f.events.at(-1), 'checkpoint'); f.calls.push(structuredClone(request)); f.events.push('transport'); return replies.shift(); };
  const result = await captureFirestoreSnapshot(f.options);
  assert.equal(result.status, 'COMPLETE'); assert.equal(replies.length, 0);
  assert.deepEqual(result.snapshot.documents.map(row => row.path), ['managementAreas/current', 'managementAreas/deleted/history/revision']);
  assert.deepEqual(result.snapshot.documents[0].fields, {});
  assert.deepEqual(result.snapshot.documents[1].fields, payload);
  assert.deepEqual(result.receipt.missingDocumentPaths, ['managementAreas/deleted']);
  assert.ok(result.receipt.completedDiscoveryParents.includes('managementAreas/deleted'));
  assert.deepEqual(result.receipt.completedCollections, ['managementAreas', 'managementAreas/deleted/history']);
  assert.equal(validateSplitSnapshot(result.snapshot), result.snapshot);
  assert.equal(result.receipt.snapshotSha256, snapshotDigest(result.snapshot));
  const {receiptSha256, ...receiptData} = result.receipt;
  assert.equal(receiptSha256, snapshotDigest(receiptData));
  assert.equal(f.calls.length, 7); assert.equal(f.reservations.length, f.calls.length);
  assert.equal(result.receipt.counts.totalReservedReads, 10);
  for (const request of f.calls) {
    assert.equal((request.query || request.body).readTime, readTime);
    if (request.operation === 'listDocuments') {assert.equal(request.query.showMissing, true); assert.equal(request.query.mask, undefined); assert.equal(request.query.orderBy, undefined);}
  }
  assert.equal(f.calls[1].query.pageToken, 'root-next');
  assert.equal(f.calls[3].body.pageToken, 'child-next');
  assert.equal(f.checkpoints.at(-1).status, 'COMPLETE');
});

test('empty selected source and destination roots are proven complete without inventing documents', async () => {
  for (const projectId of ['sahmt-17a16', 'sahmt-gestao-5ae66']) {
    const f = fixture({projectId, rootCollections: ['managementAreas', 'migrationOrigins'], transport: async request => {f.calls.push(request); return {};}});
    const result = await captureFirestoreSnapshot(f.options);
    assert.equal(result.status, 'COMPLETE'); assert.equal(result.snapshot.documents.length, 0);
    assert.deepEqual(result.receipt.completedCollections, ['managementAreas', 'migrationOrigins']);
    assert.equal(f.calls.length, 2); assert.equal(result.receipt.counts.totalReservedReads, 4);
    assert.ok(f.calls.every(request => request.parent === `projects/${projectId}/databases/(default)/documents`));
  }
});

test('configuration rejects unapproved project/database, implicit scopes and readTime nanoseconds before adapters', async () => {
  for (const change of [{projectId: 'unknown-project'}, {databaseId: 'other'}, {rootCollections: []}, {rootCollections: ['managementAreas', 'managementAreas']}, {rootCollections: ['managementAreas/..']}, {readTime: '2026-10-08T12:00:00.123456789Z'}, {readTime: '2026-02-30T12:00:00Z'}, {limits: {maxPages: 0}}, {limits: {maxDurationMs: 3600000}}]) {
    const f = fixture(change);
    await assert.rejects(captureFirestoreSnapshot(f.options));
    assert.deepEqual([f.calls.length, f.reservations.length, f.checkpoints.length], [0, 0, 0]);
  }
  for (const key of ['transport', 'reserveReads', 'clock', 'checkpoint']) {
    const f = fixture(); delete f.options[key];
    await assert.rejects(captureFirestoreSnapshot(f.options), /INJECTED_ADAPTERS_REQUIRED/);
    assert.equal(f.calls.length, 0);
  }
});

test('denied reservations stop before transport and retain a private incomplete checkpoint', async () => {
  const f = fixture({reserveReads: async () => ({allowed: false})});
  const result = await captureFirestoreSnapshot(f.options);
  assertIncomplete(result, 'READ_RESERVATION_DENIED'); assert.equal(f.calls.length, 0);
  assert.equal(result.checkpointSaved, true); assert.equal(result.receipt.counts.totalReservedReads, 0);
  assert.equal(f.checkpoints.at(-1).pages[0].status, 'RESERVATION_DENIED');
});

test('reservation and transport failures cannot leak foreign credential/error text or retry', async () => {
  const secret = 'private-token-example-never-log';
  for (const [key, code] of [['reserveReads', 'READ_RESERVATION_FAILED'], ['transport', 'TRANSPORT_FAILED']]) {
    const f = fixture({[key]: async () => {throw new Error(secret);}});
    const result = await captureFirestoreSnapshot(f.options);
    assertIncomplete(result, code); assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.receipt.counts.attempts, 1);
    if (key === 'transport') {assert.equal(result.receipt.counts.totalReservedReads, 2); assert.equal(result.state.pages[0].status, 'UNCERTAIN');}
  }
});

test('readTime age and future checks stop without production dispatch', async () => {
  for (const current of [Date.parse('2026-10-08T11:59:59Z'), Date.parse('2026-10-08T13:00:01Z')]) {
    const f = fixture(); f.setClock(current);
    const result = await captureFirestoreSnapshot(f.options);
    assertIncomplete(result, current < clockStart ? 'READ_TIME_IN_FUTURE' : 'READ_TIME_EXPIRED');
    assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 0);
  }
});

test('readTime expiration and duration reached during a request remain incomplete', async () => {
  for (const [advance, limits, code] of [[3600000, {}, 'READ_TIME_EXPIRED'], [50, {maxDurationMs: 25}, 'CAPTURE_TIME_LIMIT']]) {
    const f = fixture({limits});
    f.options.transport = async request => {f.calls.push(request); f.setClock(clockStart + advance); return {documents: [doc('managementAreas/a')]};};
    const result = await captureFirestoreSnapshot(f.options);
    assertIncomplete(result, code); assert.equal(f.calls.length, 1);
    assert.equal(result.receipt.counts.totalReservedReads, 2); assert.equal(result.state.pages[0].status, 'UNCERTAIN');
    assert.equal(result.state.documents.length, 0);
  }
});

test('backwards clock blocks continuation without fabricating consistent coverage', async () => {
  const f = fixture(); f.options.transport = async request => {f.calls.push(request); f.setClock(clockStart - 1); return {};};
  const result = await captureFirestoreSnapshot(f.options);
  assertIncomplete(result, 'CLOCK_MOVED_BACKWARDS'); assert.equal(f.calls.length, 1);
  assert.equal(result.state.finishedAt, null);
});

test('stalled transport is aborted and its reserved reads are never refunded', async () => {
  let aborted = false;
  const f = fixture({limits: {requestTimeoutMs: 15}, transport: async (_, {signal}) => {signal.addEventListener('abort', () => {aborted = true;}); await new Promise(() => {});}});
  const result = await captureFirestoreSnapshot(f.options);
  assertIncomplete(result, 'TRANSPORT_TIMEOUT'); assert.equal(aborted, true);
  assert.equal(result.receipt.counts.totalReservedReads, 2); assert.equal(result.state.pages[0].status, 'UNCERTAIN');
});

test('repeated document page tokens are rejected after bounded separately reserved attempts', async () => {
  let iteration = 0;
  const f = fixture({transport: async () => ({documents: [doc(`managementAreas/d${++iteration}`)], nextPageToken: 'repeated'})});
  const result = await captureFirestoreSnapshot(f.options);
  assertIncomplete(result, 'REPEATED_PAGE_TOKEN'); assert.equal(iteration, 2);
  assert.equal(f.reservations.length, 2); assert.equal(result.receipt.counts.totalReservedReads, 4);
  assert.equal(result.state.documents.length, 1);
});

test('page, depth, document and byte bounds each prevent a complete snapshot', async () => {
  const page = fixture({limits: {maxPages: 1}, transport: async () => ({documents: [doc('managementAreas/a')], nextPageToken: 'next'})});
  assertIncomplete(await captureFirestoreSnapshot(page.options), 'CAPTURE_PAGE_LIMIT'); assert.equal(page.reservations.length, 1);
  const depth = fixture({limits: {maxDepth: 1}, transport: async request => request.operation === 'listDocuments' ? {documents: [doc('managementAreas/a')]} : {collectionIds: ['history']}});
  assertIncomplete(await captureFirestoreSnapshot(depth.options), 'CAPTURE_DEPTH_LIMIT'); assert.equal(depth.reservations.length, 2);
  const document = fixture({limits: {maxDocuments: 1}, transport: async () => ({documents: [doc('managementAreas/a'), doc('managementAreas/b')]})});
  assertIncomplete(await captureFirestoreSnapshot(document.options), 'CAPTURE_DOCUMENT_LIMIT');
  const bytes = fixture({limits: {maxBytes: 3000}, transport: async () => ({documents: [doc('managementAreas/a', {big: {stringValue: 'x'.repeat(4000)}})]})});
  assertIncomplete(await captureFirestoreSnapshot(bytes.options), 'CAPTURE_BYTE_LIMIT');
});

test('duplicate documents, wrong resource roots, partial metadata and invalid typed values cannot enter planner', async () => {
  for (const [documents, code] of [
    [[doc('managementAreas/a'), doc('managementAreas/a')], 'DUPLICATE_DOCUMENT_PATH'],
    [[doc('activities/a')], 'DOCUMENT_OUTSIDE_REQUESTED_COLLECTION'],
    [[doc('managementAreas/a', {}, 'sahmt-gestao-5ae66')], 'DOCUMENT_OUTSIDE_REQUESTED_COLLECTION'],
    [[doc('managementAreas/a/nested/b')], 'DOCUMENT_OUTSIDE_REQUESTED_COLLECTION'],
    [[{name: name('managementAreas/a'), fields: {}}], 'INCOMPLETE_DOCUMENT_METADATA'],
    [[doc('managementAreas/a', {integer: {integerValue: 12}})], 'INVALID_TYPED_DOCUMENT_OR_TIMES'],
    [[{...doc('managementAreas/a'), updateTime: '2026-10-08T12:00:00.123456789Z'}], 'INVALID_TYPED_DOCUMENT_OR_TIMES']
  ]) {
    const f = fixture({transport: async () => ({documents})});
    assertIncomplete(await captureFirestoreSnapshot(f.options), code);
    assert.equal(f.reservations.length, 1);
  }
});

test('collection ID pagination rejects duplicates and unsafe paths before visiting them', async () => {
  for (const invalidId of ['..', '*', 'nested/path', 'nested\\path']) {
    const f = fixture({transport: async request => request.operation === 'listDocuments' ? {documents: [doc('managementAreas/a')]} : {collectionIds: [invalidId]}});
    assertIncomplete(await captureFirestoreSnapshot(f.options), 'INVALID_OR_DUPLICATE_COLLECTION_ID');
    assert.equal(f.reservations.length, 2);
  }
  let discovery = 0;
  const f = fixture({transport: async request => request.operation === 'listDocuments' ? {documents: [doc('managementAreas/a')]} : {collectionIds: ['history'], ...(discovery++ === 0 ? {nextPageToken: 'next'} : {})}});
  assertIncomplete(await captureFirestoreSnapshot(f.options), 'INVALID_OR_DUPLICATE_COLLECTION_ID');
  assert.equal(discovery, 2); assert.equal(f.reservations.length, 3);
});

test('checkpoint failure blocks transport and never returns success', async () => {
  const f = fixture({checkpoint: async () => {throw new Error('private-output-location');}});
  const result = await captureFirestoreSnapshot(f.options);
  assertIncomplete(result, 'CHECKPOINT_FAILED'); assert.equal(result.checkpointSaved, false);
  assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 0);
  assert.equal(JSON.stringify(result).includes('private-output-location'), false);
});

test('mutating checkpoint and transport adapters cannot alter the approved scope or active request proof', async () => {
  const roots = ['managementAreas'];
  const f = fixture({rootCollections: roots, checkpoint: async state => {state.rootCollections[0] = 'activities'; state.queue.length = 0; state.documents.push({path: 'fake/record'});}, transport: async request => {request.query && (request.query.readTime = 'bad'); return request.operation === 'listDocuments' ? {documents: [doc('managementAreas/a')]} : {};}});
  const result = await captureFirestoreSnapshot(f.options);
  assert.equal(result.status, 'COMPLETE'); assert.deepEqual(roots, ['managementAreas']);
  assert.equal(result.snapshot.readTime, readTime); assert.deepEqual(result.snapshot.coverage.rootCollections, ['managementAreas']);
  assert.deepEqual(result.snapshot.documents.map(row => row.path), ['managementAreas/a']);
  assert.ok(result.receipt.pages.every(page => page.readTime === readTime));
});

test('core has no credential or default network path; only explicitly injected requests run', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = () => {networkCalls++; throw new Error('ambient network is forbidden');};
  try {
    const f = fixture();
    const first = await captureFirestoreSnapshot(f.options);
    const second = await captureFirestoreSnapshot(f.options);
    assert.equal(first.status, 'COMPLETE'); assert.equal(networkCalls, 0);
    assert.equal(first.receipt.receiptSha256, second.receipt.receiptSha256);
    assert.equal(first.receipt.snapshotSha256, second.receipt.snapshotSha256);
    assert.equal(JSON.stringify(first).includes('Authorization'), false);
    assert.ok(first.receipt.pages.every(page => page.operation === 'listDocuments' || page.operation === 'listCollectionIds'));
  } finally {globalThis.fetch = originalFetch;}
});

test('a package exceeding byte limit never persists a COMPLETE checkpoint', async () => {
  const f = fixture({pageSize: 1, limits: {maxBytes: 1500}, transport: async () => ({})});
  const result = await captureFirestoreSnapshot(f.options);
  assertIncomplete(result, 'FINAL_PACKAGE_BYTE_LIMIT');
  assert.equal(f.checkpoints.some(state => state.status === 'COMPLETE'), false);
  assert.equal(f.checkpoints.at(-1).status, 'INCOMPLETE');
});

test('stalled reservation and persistence adapters are bounded and cannot dispatch production reads', async () => {
  for (const [key, code] of [['reserveReads', 'READ_RESERVATION_TIMEOUT'], ['checkpoint', 'CHECKPOINT_TIMEOUT']]) {
    let aborted = false;
    const f = fixture({limits: {requestTimeoutMs: 10}, [key]: async (_, {signal}) => {signal.addEventListener('abort', () => {aborted = true;}); await new Promise(() => {});}});
    const result = await captureFirestoreSnapshot(f.options);
    assertIncomplete(result, code); assert.equal(aborted, true);
    assert.equal(f.calls.length, 0);
  }
});
