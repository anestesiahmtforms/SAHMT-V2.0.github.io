import {createHash} from 'node:crypto';
import {snapshotDigest, validateSplitSnapshot} from './management-split-plan.js';

const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
const PURPOSE = 'MANAGEMENT_MIGRATION_CREATE_ONLY';
const BASE = `projects/${FB}/databases/(default)/documents/`;
const ENDPOINT = `https://firestore.googleapis.com/v1/projects/${FB}/databases/(default)/documents`;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ROOTS = new Set(['managementAreas', 'activities', 'activityInteractions', 'activityScoreReviews',
  'indicators', 'indicatorMeasurements', 'actionPlans', 'actionPlanItems', 'documents', 'scopedDocuments',
  'equipment', 'equipmentEvents', 'maintenanceRecords', 'scoringRules', 'scores', 'learningActivities',
  'learningActivityReceipts', 'trainings', 'trainingProgress', 'trainingReceipts', 'trainingCompletions',
  'evaluationActivities', 'evaluationFormConfigs', 'evaluationLinks', 'evaluationParticipations',
  'evaluationAssignments', 'evaluationAssignmentHistory', 'evaluationGovernanceRevisions',
  'evaluationAwards', 'evaluationLedger', 'auditLogs']);
class RestError extends Error {}
const fail = code => { throw new RestError(code); };
const demand = (value, code) => { if (!value) fail(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const hash = value => createHash('sha256').update(value).digest('hex');

function dataCopy(value) {
  let nodes = 0;
  const visit = (item, depth) => {
    demand(++nodes <= 250000 && depth <= 120, 'MIGRATION_REST_DATA_LIMIT');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') { demand(Number.isFinite(item), 'MIGRATION_REST_DATA_INVALID'); return item; }
    demand(Array.isArray(item) || plain(item), 'MIGRATION_REST_DATA_INVALID');
    const keys = Reflect.ownKeys(item);
    if (Array.isArray(item)) {
      demand(keys.length === item.length + 1 && keys.every(key => key === 'length'
        || typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)), 'MIGRATION_REST_DATA_INVALID');
      return Array.from({length:item.length}, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        demand(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), 'MIGRATION_REST_DATA_INVALID');
        return visit(descriptor.value, depth + 1);
      });
    }
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      demand(typeof key === 'string' && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'MIGRATION_REST_DATA_INVALID');
      result[key] = visit(descriptor.value, depth + 1);
    }
    return result;
  };
  try { return visit(value, 0); } catch (error) { if (error instanceof RestError) throw error; fail('MIGRATION_REST_DATA_INVALID'); }
}

function pathValid(path) {
  if (typeof path !== 'string' || Buffer.byteLength(path) > 6144) return false;
  const parts = path.split('/');
  return parts.length >= 2 && parts.length <= 60 && parts.length % 2 === 0
    && parts.every(part => part && Buffer.byteLength(part) <= 1500
      && !['.', '..', '*'].includes(part) && !/^__.*__$/.test(part) && !/[\x00-\x1f\x7f\\]/.test(part));
}

function timestampNanos(value) {
  demand(typeof value === 'string', 'MIGRATION_REST_TIMESTAMP_INVALID');
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  demand(match && Number(value.slice(0, 4)) >= 1, 'MIGRATION_REST_TIMESTAMP_INVALID');
  const millis = Date.parse(match[1] + 'Z');
  demand(Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 19) === match[1], 'MIGRATION_REST_TIMESTAMP_INVALID');
  return BigInt(millis) * 1000000n + BigInt((match[2] || '').padEnd(9, '0'));
}

function timestampCeilMicros(value) {
  const nanos = timestampNanos(value);
  const micros = nanos / 1000n + (nanos % 1000n > 0n ? 1n : 0n);
  let seconds = micros / 1000000n, fraction = micros % 1000000n;
  if (fraction < 0n) { seconds--; fraction += 1000000n; }
  return new Date(Number(seconds * 1000n)).toISOString().slice(0, 19)
    + '.' + String(fraction).padStart(6, '0') + 'Z';
}

/** Server transport only. It does not obtain approval, context, budget or credentials on its own. */
export function createManagementMigrationFirestoreRest({enabled = false, authorizedPurpose,
  planSha256, allowedPairs, getAccessToken, fetchImpl, now = Date.now,
  monotonicNow = () => performance.now(), timeoutMs = 20000,
  maximumResponseBytes = 8 * 1024 * 1024, maximumRequestBytes = 4 * 1024 * 1024} = {}) {
  if (enabled === false) return Object.freeze({
    readDestinationPair: async () => fail('MIGRATION_REST_DISABLED'),
    commitCreatePair: async () => fail('MIGRATION_REST_DISABLED')
  });
  demand(enabled === true && authorizedPurpose === PURPOSE && SHA.test(planSha256 || ''), 'MIGRATION_REST_SCOPE_INVALID');
  demand(typeof getAccessToken === 'function' && typeof fetchImpl === 'function'
    && typeof now === 'function' && typeof monotonicNow === 'function', 'MIGRATION_REST_ADAPTER_REQUIRED');
  demand(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30000
    && Number.isInteger(maximumResponseBytes) && maximumResponseBytes >= 1024 && maximumResponseBytes <= 16 * 1024 * 1024
    && Number.isInteger(maximumRequestBytes) && maximumRequestBytes >= 1024 && maximumRequestBytes <= 16 * 1024 * 1024,
  'MIGRATION_REST_LIMITS_INVALID');
  const pairs = dataCopy(allowedPairs);
  demand(Array.isArray(pairs) && pairs.length >= 1 && pairs.length <= 1000, 'MIGRATION_REST_ALLOWLIST_INVALID');
  const byPath = new Map(), byNames = new Map();
  for (const pair of pairs) {
    demand(exact(pair, ['path', 'provenancePath', 'documentFieldsSha256', 'provenanceFieldsSha256'])
      && pathValid(pair.path) && ROOTS.has(pair.path.split('/')[0])
      && /^migrationOrigins\/[a-f0-9]{64}$/.test(pair.provenancePath || '')
      && SHA.test(pair.documentFieldsSha256 || '') && SHA.test(pair.provenanceFieldsSha256 || '')
      && !byPath.has(pair.path) && !byNames.has(BASE + pair.provenancePath), 'MIGRATION_REST_ALLOWLIST_INVALID');
    byPath.set(pair.path, pair); byNames.set(BASE + pair.path, pair); byNames.set(BASE + pair.provenancePath, pair);
  }
  const reservations = new Set(), attemptedCommits = new Set(), confirmedCommitTimes = new Map();
  const wallClock = () => { const value = now(); demand(Number.isSafeInteger(value) && value >= 1000, 'MIGRATION_REST_CLOCK_INVALID'); return value; };
  function validatePayload(value) {
    const payload = dataCopy(value);
    demand(plain(payload) && payload.projectId === FB && payload.sourceProjectId === FA
      && payload.destinationProjectId === FB && payload.databaseId === '(default)'
      && SHA.test(payload.runId || '') && ID.test(payload.approvalRequestId || '')
      && ID.test(payload.reservationId || '') && payload.pins?.planSha256 === planSha256,
    'MIGRATION_REST_PAYLOAD_SCOPE_INVALID');
    return payload;
  }
  function claimReservation(id) {
    demand(!reservations.has(id) && reservations.size < pairs.length * 3, 'MIGRATION_REST_RESERVATION_REUSED_OR_EXHAUSTED');
    reservations.add(id); // Never returned after timeout, refusal or unknown response.
  }

  async function request(operation, body, interpret, parentSignal) {
    demand(!parentSignal?.aborted, 'MIGRATION_REST_ABORTED');
    const startedAt = wallClock(), startedMono = monotonicNow();
    demand(Number.isFinite(startedMono) && startedMono >= 0, 'MIGRATION_REST_CLOCK_INVALID');
    const encoded = JSON.stringify(body);
    demand(Buffer.byteLength(encoded) <= maximumRequestBytes, 'MIGRATION_REST_REQUEST_TOO_LARGE');
    const controller = new AbortController();
    let timer, rejectAbort, sent = false, finished = false;
    const timeoutCode = () => operation === 'commit' && sent ? 'MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN' : 'MIGRATION_REST_TIMEOUT';
    const abortCode = () => operation === 'commit' && sent ? 'MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN' : 'MIGRATION_REST_ABORTED';
    const guard = () => {
      demand(!finished && !controller.signal.aborted && !parentSignal?.aborted, abortCode());
      const wall = wallClock(), mono = monotonicNow();
      demand(wall >= startedAt && Number.isFinite(mono) && mono >= startedMono, 'MIGRATION_REST_CLOCK_INVALID');
      demand(wall - startedAt < timeoutMs && mono - startedMono < timeoutMs, timeoutCode());
    };
    const abort = () => { rejectAbort?.(new RestError(abortCode())); controller.abort(); };
    parentSignal?.addEventListener('abort', abort, {once:true});
    const deadline = new Promise((_, reject) => {
      rejectAbort = reject;
      timer = setTimeout(() => { reject(new RestError(timeoutCode())); controller.abort(); }, timeoutMs);
    });
    const work = async () => {
      guard();
      const token = await getAccessToken({projectId:FB, databaseId:'(default)', authorizedPurpose:PURPOSE, operation}, {signal:controller.signal});
      guard();
      demand(typeof token === 'string' && token.length >= 1 && token.length <= 16384
        && /^[A-Za-z0-9._~+\/-]+=*$/.test(token), 'MIGRATION_REST_SERVER_TOKEN_INVALID');
      sent = true;
      const response = await fetchImpl(ENDPOINT + (operation === 'commit' ? ':commit' : ':batchGet'), {
        method:'POST', headers:{Authorization:'Bearer ' + token, 'Content-Type':'application/json', Accept:'application/json'},
        body:encoded, signal:controller.signal, redirect:'error', credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer'
      });
      guard();
      demand(response && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599,
        'MIGRATION_REST_RESPONSE_INVALID');
      demand(response.redirected !== true && (!response.url || response.url === ENDPOINT + (operation === 'commit' ? ':commit' : ':batchGet')),
        'MIGRATION_REST_REDIRECT_DENIED');
      if (response.status !== 200) fail('MIGRATION_REST_HTTP_' + response.status);
      demand(response.body && typeof response.body.getReader === 'function', 'MIGRATION_REST_RESPONSE_INVALID');
      const length = response.headers?.get('content-length');
      if (length !== null && length !== undefined) demand(/^\d+$/.test(length)
        && Number(length) <= maximumResponseBytes, 'MIGRATION_REST_RESPONSE_TOO_LARGE');
      const reader = response.body.getReader(), chunks = [];
      let bytes = 0, chunkCount = 0;
      try {
        for (;;) {
          guard(); const chunk = await reader.read(); guard();
          if (chunk.done) break;
          demand(chunk.value instanceof Uint8Array && ++chunkCount <= 4096, 'MIGRATION_REST_RESPONSE_INVALID');
          bytes += chunk.value.byteLength;
          demand(bytes <= maximumResponseBytes, 'MIGRATION_REST_RESPONSE_TOO_LARGE');
          chunks.push(Buffer.from(chunk.value));
        }
      } finally { try { await reader.cancel(); } catch { /* No raw transport error escapes. */ } }
      guard();
      let result;
      try { result = dataCopy(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)))); }
      catch { fail('MIGRATION_REST_RESPONSE_JSON_INVALID'); }
      guard(); const normalized = interpret(result); guard(); return normalized;
    };
    try { return await Promise.race([work(), deadline]); }
    catch (error) {
      if (operation === 'commit' && sent) fail('MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN');
      if (error instanceof RestError) throw new Error(error.message);
      fail('MIGRATION_REST_TRANSPORT_FAILED');
    } finally { finished = true; clearTimeout(timer); parentSignal?.removeEventListener('abort', abort); controller.abort(); }
  }

  async function readDestinationPair(value, {signal} = {}) {
    const payload = validatePayload(value), pair = byPath.get(payload.path);
    demand(pair && payload.provenancePath === pair.provenancePath && Number.isInteger(payload.maximumReads)
      && payload.maximumReads >= 2, 'MIGRATION_REST_PAIR_NOT_ALLOWED');
    const baselineReadTime = new Date(wallClock() - 1000).toISOString();
    const confirmedCommitTime = confirmedCommitTimes.get(pair.path);
    const readTime = confirmedCommitTime && timestampNanos(confirmedCommitTime) > timestampNanos(baselineReadTime)
      ? timestampCeilMicros(confirmedCommitTime) : baselineReadTime;
    const documents = [BASE + pair.path, BASE + pair.provenancePath];
    claimReservation(payload.reservationId);
    return request('batchGet', {documents, readTime}, rows => {
      demand(Array.isArray(rows) && rows.length === 2, 'MIGRATION_REST_PAIR_RESPONSE_INVALID');
      const found = new Map();
      for (const row of rows) {
        demand(plain(row) && timestampNanos(row.readTime) === timestampNanos(readTime), 'MIGRATION_REST_PAIR_READ_TIME_INVALID');
        const isFound = Object.hasOwn(row, 'found');
        demand(exact(row, [isFound ? 'found' : 'missing', 'readTime']), 'MIGRATION_REST_PAIR_RESPONSE_INVALID');
        const name = isFound ? row.found?.name : row.missing;
        demand(documents.includes(name) && !found.has(name), 'MIGRATION_REST_PAIR_RESPONSE_INVALID');
        if (isFound) {
          demand(plain(row.found) && (!Object.hasOwn(row.found, 'fields') || plain(row.found.fields)) && Object.keys(row.found).every(key => ['name', 'fields', 'createTime', 'updateTime'].includes(key)), 'MIGRATION_REST_DOCUMENT_INVALID');
          found.set(name, {path:name.slice(BASE.length), fields:row.found.fields ?? {},
            createTime:row.found.createTime, updateTime:row.found.updateTime});
        } else found.set(name, null);
      }
      const values = documents.map(name => found.get(name));
      try { validateSplitSnapshot({schemaVersion:1, projectId:FB, databaseId:'(default)', readTime,
        coverage:{complete:true, consistent:true, rootCollections:[pair.path.split('/')[0], 'migrationOrigins']},
        documents:values.filter(Boolean)}); } catch { fail('MIGRATION_REST_DOCUMENT_INVALID'); }
      return {readTime, consistent:true, document:values[0], provenance:values[1]};
    }, signal);
  }

  async function commitCreatePair(value, {signal} = {}) {
    const payload = validatePayload(value);
    demand(Array.isArray(payload.writes) && payload.writes.length === 2, 'MIGRATION_REST_CREATE_PAIR_REQUIRED');
    const first = payload.writes[0], second = payload.writes[1];
    demand(exact(first, ['update', 'currentDocument']) && exact(second, ['update', 'currentDocument'])
      && exact(first.update, ['name', 'fields']) && exact(second.update, ['name', 'fields'])
      && exact(first.currentDocument, ['exists']) && first.currentDocument.exists === false
      && exact(second.currentDocument, ['exists']) && second.currentDocument.exists === false,
    'MIGRATION_REST_CREATE_ONLY_REQUIRED');
    const pair = byNames.get(first.update.name);
    demand(pair && first.update.name === BASE + pair.path && second.update.name === BASE + pair.provenancePath
      && snapshotDigest(first.update.fields) === pair.documentFieldsSha256
      && snapshotDigest(second.update.fields) === pair.provenanceFieldsSha256,
    'MIGRATION_REST_CREATE_PAIR_NOT_ALLOWED');
    demand(SHA.test(payload.operationId || '') && payload.operationId === hash(planSha256 + '\u0000' + pair.path)
      && !attemptedCommits.has(payload.operationId), 'MIGRATION_REST_COMMIT_REUSED_OR_INVALID');
    claimReservation(payload.reservationId); attemptedCommits.add(payload.operationId);
    const result = await request('commit', {writes:payload.writes}, result => {
      demand(exact(result, ['writeResults', 'commitTime']) && Array.isArray(result.writeResults)
        && result.writeResults.length === 2, 'MIGRATION_REST_COMMIT_RESPONSE_INVALID');
      const commitNanos = timestampNanos(result.commitTime), current = BigInt(wallClock()) * 1000000n;
      demand(commitNanos <= current && current - commitNanos <= 300000000000n, 'MIGRATION_REST_COMMIT_TIME_INVALID');
      const writeResults = result.writeResults.map((row, index) => {
        demand(exact(row, ['updateTime']) && timestampNanos(row.updateTime) <= commitNanos,
          'MIGRATION_REST_COMMIT_RESPONSE_INVALID');
        return {path:payload.writes[index].update.name.slice(BASE.length), updateTime:row.updateTime};
      });
      return {atomic:true, committed:true, commitTime:result.commitTime, writeResults};
    }, signal);
    // Only confirmed, fully validated responses anchor subsequent reads in this instance.
    confirmedCommitTimes.set(pair.path, result.commitTime);
    return result;
  }
  return Object.freeze({readDestinationPair, commitCreatePair});
}
