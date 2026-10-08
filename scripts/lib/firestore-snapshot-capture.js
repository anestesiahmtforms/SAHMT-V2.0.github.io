import {createHash} from 'node:crypto';
import {snapshotDigest, validateSplitSnapshot} from './management-split-plan.js';

// This core never obtains credentials, creates files, or calls a network client.
// The caller owns authentication, private persistence, and the daily read policy.
const PROJECTS = new Set(['sahmt-17a16', 'sahmt-gestao-5ae66']);
const ROOT_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const byteLength = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
class CaptureFailure extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new CaptureFailure(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathPart = value => typeof value === 'string' && value.length > 0 && !['.', '..', '*'].includes(value) && !/[\/\\\x00-\x1f]/.test(value);
const iso = milliseconds => new Date(milliseconds).toISOString();
function readTimeMicros(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/.exec(value);
  requireValue(match && Number(value.slice(0, 4)) > 0, 'INVALID_READ_TIME');
  const seconds = Date.parse(match[1] + 'Z');
  requireValue(Number.isFinite(seconds) && iso(seconds).slice(0, 19) === match[1], 'INVALID_READ_TIME');
  return BigInt(seconds) * 1000n + BigInt((match[2] || '').padEnd(6, '0'));
}
function configuration(options) {
  requireValue(object(options), 'INVALID_CAPTURE_OPTIONS');
  requireValue(PROJECTS.has(options.projectId) && (options.databaseId || '(default)') === '(default)', 'PROJECT_OR_DATABASE_NOT_APPROVED');
  requireValue(Array.isArray(options.rootCollections) && options.rootCollections.length > 0 && options.rootCollections.every(id => typeof id === 'string' && ROOT_ID.test(id)) && new Set(options.rootCollections).size === options.rootCollections.length, 'EXPLICIT_ROOT_SCOPE_REQUIRED');
  requireValue(['transport', 'reserveReads', 'clock', 'checkpoint'].every(key => typeof options[key] === 'function'), 'INJECTED_ADAPTERS_REQUIRED');
  const limits = {maxPages: 20000, maxDepth: 30, maxBytes: 64 * 1024 * 1024, maxDocuments: 100000, maxDurationMs: 45 * 60 * 1000, requestTimeoutMs: 30000, ...(options.limits || {})};
  requireValue(Object.keys(limits).every(key => ['maxPages', 'maxDepth', 'maxBytes', 'maxDocuments', 'maxDurationMs', 'requestTimeoutMs'].includes(key)) && Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0), 'INVALID_CAPTURE_LIMITS');
  requireValue(limits.maxDurationMs < 60 * 60 * 1000, 'DURATION_MUST_FIT_READ_TIME_WINDOW');
  const pageSize = options.pageSize ?? 100, collectionPageSize = options.collectionPageSize ?? 100;
  requireValue([pageSize, collectionPageSize].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1000), 'INVALID_PAGE_SIZE');
  return {...options, databaseId: '(default)', rootCollections: [...options.rootCollections].sort(), limits, pageSize, collectionPageSize, readMicros: readTimeMicros(options.readTime)};
}
function makeRequest(config, task, pageToken) {
  const parent = `projects/${config.projectId}/databases/${config.databaseId}/documents${task.parentPath ? '/' + task.parentPath : ''}`;
  if (task.operation === 'listDocuments') return {operation: task.operation, method: 'GET', parent, collectionId: task.collectionId, query: {pageSize: config.pageSize, showMissing: true, readTime: config.readTime, ...(pageToken ? {pageToken} : {})}};
  return {operation: task.operation, method: 'POST', parent, body: {pageSize: config.collectionPageSize, readTime: config.readTime, ...(pageToken ? {pageToken} : {})}};
}
function decodeResponse(value, operation) {
  requireValue(object(value), 'INVALID_REST_RESPONSE');
  const listKey = operation === 'listDocuments' ? 'documents' : 'collectionIds';
  requireValue(Object.keys(value).every(key => [listKey, 'nextPageToken'].includes(key)) && (!own(value, listKey) || Array.isArray(value[listKey])) && (!own(value, 'nextPageToken') || typeof value.nextPageToken === 'string'), 'INVALID_REST_RESPONSE');
  return {items: value[listKey] || [], nextPageToken: value.nextPageToken || ''};
}
function decodeDocument(document, config, task) {
  requireValue(object(document) && Object.keys(document).every(key => ['name', 'fields', 'createTime', 'updateTime'].includes(key)) && typeof document.name === 'string', 'INVALID_REST_DOCUMENT');
  const resourcePrefix = `projects/${config.projectId}/databases/${config.databaseId}/documents/`;
  const collectionPath = task.parentPath ? `${task.parentPath}/${task.collectionId}` : task.collectionId;
  requireValue(document.name.startsWith(resourcePrefix + collectionPath + '/'), 'DOCUMENT_OUTSIDE_REQUESTED_COLLECTION');
  const path = document.name.slice(resourcePrefix.length), childId = path.slice(collectionPath.length + 1);
  requireValue(pathPart(childId), 'DOCUMENT_OUTSIDE_REQUESTED_COLLECTION');
  const missing = !own(document, 'fields') && !own(document, 'createTime') && !own(document, 'updateTime');
  if (missing) return {path, missing: true};
  requireValue(own(document, 'createTime') && own(document, 'updateTime') && (!own(document, 'fields') || object(document.fields)), 'INCOMPLETE_DOCUMENT_METADATA');
  const normalized = {path, fields: document.fields || {}, createTime: document.createTime, updateTime: document.updateTime};
  try { validateSplitSnapshot({schemaVersion: 1, projectId: config.projectId, databaseId: config.databaseId, readTime: config.readTime, coverage: {complete: true, consistent: true, rootCollections: config.rootCollections}, documents: [normalized]}); }
  catch { fail('INVALID_TYPED_DOCUMENT_OR_TIMES'); }
  return {path, missing: false, document: normalized};
}
async function boundedAdapter(invoke, timeoutMs, failureCode, timeoutCode) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CaptureFailure(timeoutCode)); }, timeoutMs); });
  try { return await Promise.race([Promise.resolve().then(() => invoke(controller.signal)), timeout]); }
  catch (error) { if (error instanceof CaptureFailure) throw error; fail(failureCode); }
  finally { clearTimeout(timer); }
}

/** Captures complete selected collection trees at one historical readTime.
 * transport(request, {signal}) returns decoded REST JSON. reserveReads receives
 * a maximum per attempt and must return true or {allowed:true}; reservations are
 * never refunded here. clock returns epoch milliseconds. checkpoint receives a
 * private cloned state; it must durably save it without printing its contents.
 * Invalid configuration rejects before any adapter is called. Operational errors
 * return INCOMPLETE with snapshot:null; partial state must not enter the planner.
 * No retries or resume are implicit: each failed capture keeps its own readTime.
 */
export async function captureFirestoreSnapshot(options) {
  const config = configuration(options);
  let lastClock = null;
  const now = () => {
    let value;
    try { value = config.clock(); } catch { fail('CLOCK_FAILED'); }
    requireValue(Number.isSafeInteger(value) && value >= 0, 'INVALID_CLOCK');
    requireValue(lastClock === null || value >= lastClock, 'CLOCK_MOVED_BACKWARDS');
    lastClock = value;
    return value;
  };
  const started = now();
  const state = {schemaVersion: 1, mode: 'READ_ONLY_FIRESTORE_CAPTURE', projectId: config.projectId, databaseId: config.databaseId, readTime: config.readTime, rootCollections: config.rootCollections, scopeSha256: snapshotDigest({projectId: config.projectId, databaseId: config.databaseId, rootCollections: config.rootCollections}), startedAt: iso(started), status: 'IN_PROGRESS', queue: config.rootCollections.map(collectionId => ({operation: 'listDocuments', parentPath: '', collectionId, depth: 1})), active: null, documents: [], missingDocumentPaths: [], completedCollections: [], completedDiscoveryParents: [], pages: [], totalReservedReads: 0, totalResponseBytes: 0};
  const seenPaths = new Set();
  function checkTime() {
    const current = now(), currentMicros = BigInt(current) * 1000n;
    requireValue(config.readMicros <= currentMicros, 'READ_TIME_IN_FUTURE');
    requireValue(currentMicros - config.readMicros < 60n * 60n * 1000000n, 'READ_TIME_EXPIRED');
    requireValue(current - started < config.limits.maxDurationMs, 'CAPTURE_TIME_LIMIT');
    return current;
  }
  function adapterTimeout() {
    const current = checkTime();
    const ageMs = Number((BigInt(current) * 1000n - config.readMicros) / 1000n);
    return Math.max(1, Math.min(config.limits.requestTimeoutMs, config.limits.maxDurationMs - (current - started), 60 * 60 * 1000 - ageMs));
  }
  async function persist() {
    requireValue(byteLength(state) <= config.limits.maxBytes, 'CHECKPOINT_BYTE_LIMIT');
    const saved = clone(state);
    await boundedAdapter(signal => config.checkpoint(saved, {signal}), adapterTimeout(), 'CHECKPOINT_FAILED', 'CHECKPOINT_TIMEOUT');
  }
  function receipt(complete) {
    const result = {schemaVersion: 1, mode: state.mode, projectId: state.projectId, databaseId: state.databaseId, readTime: state.readTime, scopeSha256: state.scopeSha256, rootCollections: state.rootCollections, complete, consistent: complete, startedAt: state.startedAt, finishedAt: state.finishedAt || null, limits: config.limits, requestParameters: {documentPageSize: config.pageSize, collectionPageSize: config.collectionPageSize, showMissing: true, mask: null, orderBy: null}, counts: {documents: state.documents.length, missingParents: state.missingDocumentPaths.length, collectionsCompleted: state.completedCollections.length, discoveryParentsCompleted: state.completedDiscoveryParents.length, attempts: state.pages.length, totalReservedReads: state.totalReservedReads, totalResponseBytes: state.totalResponseBytes}, completedCollections: state.completedCollections, completedDiscoveryParents: state.completedDiscoveryParents, missingDocumentPaths: state.missingDocumentPaths, pages: state.pages, errorCode: state.errorCode || null};
    return {...clone(result), receiptSha256: snapshotDigest(result)};
  }
  try {
    checkTime();
    await persist();
    while (state.queue.length) {
      const task = state.queue.shift();
      requireValue(task.depth <= config.limits.maxDepth, 'CAPTURE_DEPTH_LIMIT');
      let pageToken = '';
      const tokens = new Set();
      state.active = {...task, pageToken, consumedTokenHashes: []};
      while (true) {
        checkTime();
        requireValue(state.pages.length < config.limits.maxPages, 'CAPTURE_PAGE_LIMIT');
        const request = makeRequest(config, task, pageToken), maximumReads = task.operation === 'listDocuments' ? config.pageSize : 1;
        const proof = {attempt: state.pages.length + 1, operation: task.operation, parentPath: task.parentPath, ...(task.collectionId ? {collectionId: task.collectionId} : {}), readTime: config.readTime, requestSha256: snapshotDigest(request), pageTokenSha256: pageToken ? digest(pageToken) : null, maximumReads, status: 'RESERVATION_PENDING'};
        state.pages.push(proof);
        let reservation;
        try { reservation = await boundedAdapter(signal => config.reserveReads({projectId: config.projectId, databaseId: config.databaseId, readTime: config.readTime, operation: task.operation, attempt: proof.attempt, requestSha256: proof.requestSha256, maximumReads}, {signal}), adapterTimeout(), 'READ_RESERVATION_FAILED', 'READ_RESERVATION_TIMEOUT'); }
        catch (error) { proof.status = 'RESERVATION_FAILED'; throw error; }
        if (!(reservation === true || object(reservation) && reservation.allowed === true)) { proof.status = 'RESERVATION_DENIED'; fail('READ_RESERVATION_DENIED'); }
        state.totalReservedReads += maximumReads;
        proof.status = 'RESERVED';
        await persist();
        // Credential acquisition, network dispatch and budget checks remain in
        // injected adapters. A reservation must precede every transport attempt.
        const timeoutMs = adapterTimeout();
        proof.status = 'SENT';
        const response = await boundedAdapter(signal => config.transport(clone(request), {signal}), timeoutMs, 'TRANSPORT_FAILED', 'TRANSPORT_TIMEOUT');
        checkTime();
        let serialized;
        try { serialized = JSON.stringify(response); } catch { fail('INVALID_REST_RESPONSE'); }
        requireValue(typeof serialized === 'string', 'INVALID_REST_RESPONSE');
        state.totalResponseBytes += Buffer.byteLength(serialized, 'utf8');
        requireValue(state.totalResponseBytes <= config.limits.maxBytes, 'CAPTURE_BYTE_LIMIT');
        const stableResponse = JSON.parse(serialized), decoded = decodeResponse(stableResponse, task.operation);
        proof.responseSha256 = digest(serialized);
        proof.returnedCount = decoded.items.length;
        proof.nextPageTokenSha256 = decoded.nextPageToken ? digest(decoded.nextPageToken) : null;
        requireValue(decoded.items.length <= (task.operation === 'listDocuments' ? config.pageSize : config.collectionPageSize), 'PAGE_EXCEEDS_REQUEST_SIZE');
        if (decoded.nextPageToken) requireValue(decoded.nextPageToken !== pageToken && !tokens.has(decoded.nextPageToken), 'REPEATED_PAGE_TOKEN');
        if (task.operation === 'listDocuments') {
          const decodedDocuments = decoded.items.map(document => decodeDocument(document, config, task));
          const localPaths = new Set();
          for (const item of decodedDocuments) { requireValue(!seenPaths.has(item.path) && !localPaths.has(item.path), 'DUPLICATE_DOCUMENT_PATH'); localPaths.add(item.path); }
          const existingCount = decodedDocuments.filter(item => !item.missing).length;
          requireValue(state.documents.length + existingCount <= config.limits.maxDocuments, 'CAPTURE_DOCUMENT_LIMIT');
          proof.existingCount = existingCount;
          proof.missingCount = decodedDocuments.length - existingCount;
          for (const item of decodedDocuments) {
            seenPaths.add(item.path);
            if (item.missing) state.missingDocumentPaths.push(item.path); else state.documents.push(item.document);
            state.queue.push({operation: 'listCollectionIds', parentPath: item.path, depth: task.depth});
          }
        } else {
          const existingCollections = new Set(state.active.discoveredCollectionIds || []);
          for (const collectionId of decoded.items) {
            requireValue(pathPart(collectionId) && !existingCollections.has(collectionId), 'INVALID_OR_DUPLICATE_COLLECTION_ID');
            existingCollections.add(collectionId);
          }
          requireValue(decoded.items.length === 0 || task.depth < config.limits.maxDepth, 'CAPTURE_DEPTH_LIMIT');
          state.active.discoveredCollectionIds = [...existingCollections].sort();
          for (const collectionId of decoded.items) state.queue.push({operation: 'listDocuments', parentPath: task.parentPath, collectionId, depth: task.depth + 1});
        }
        proof.status = 'COMPLETE';
        if (!decoded.nextPageToken) {
          if (task.operation === 'listDocuments') state.completedCollections.push(task.parentPath ? `${task.parentPath}/${task.collectionId}` : task.collectionId);
          else state.completedDiscoveryParents.push(task.parentPath);
          state.active = null;
          await persist();
          break;
        }
        tokens.add(decoded.nextPageToken);
        pageToken = decoded.nextPageToken;
        state.active.pageToken = pageToken;
        state.active.consumedTokenHashes = [...tokens].map(digest);
        await persist();
      }
    }
    checkTime();
    state.documents.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    state.missingDocumentPaths.sort();
    state.completedCollections.sort();
    state.completedDiscoveryParents.sort();
    const snapshot = {schemaVersion: 1, projectId: config.projectId, databaseId: config.databaseId, readTime: config.readTime, coverage: {complete: true, consistent: true, rootCollections: config.rootCollections, scope: 'SELECTED_ROOT_COLLECTION_TREES', scopeSha256: state.scopeSha256}, documents: clone(state.documents)};
    try { validateSplitSnapshot(snapshot); } catch { fail('FINAL_SNAPSHOT_VALIDATION_FAILED'); }
    state.snapshotSha256 = snapshotDigest(snapshot);
    state.finishedAt = iso(checkTime());
    const captureReceipt = {...receipt(true), snapshotSha256: state.snapshotSha256};
    delete captureReceipt.receiptSha256;
    captureReceipt.receiptSha256 = snapshotDigest(captureReceipt);
    requireValue(byteLength({snapshot, receipt: captureReceipt}) <= config.limits.maxBytes, 'FINAL_PACKAGE_BYTE_LIMIT');
    // No checkpoint is labelled COMPLETE until the whole output package passes.
    state.status = 'COMPLETE';
    await persist();
    return {status: 'COMPLETE', snapshot, receipt: captureReceipt, state: clone(state)};
  } catch (error) {
    state.status = 'INCOMPLETE';
    state.errorCode = error instanceof CaptureFailure ? error.code : 'CAPTURE_FAILED';
    delete state.snapshotSha256;
    const activePage = state.pages.at(-1);
    if (activePage && ['RESERVED', 'SENT'].includes(activePage.status)) activePage.status = 'UNCERTAIN';
    try { state.finishedAt = iso(now()); } catch { state.finishedAt = null; }
    let checkpointSaved = false;
    try { await boundedAdapter(signal => config.checkpoint(clone(state), {signal}), config.limits.requestTimeoutMs, 'CHECKPOINT_FAILED', 'CHECKPOINT_TIMEOUT'); checkpointSaved = true; } catch { /* No further network call is permitted after persistence failure. */ }
    return {status: 'INCOMPLETE', snapshot: null, errorCode: state.errorCode, checkpointSaved, receipt: receipt(false), state: clone(state)};
  }
}
