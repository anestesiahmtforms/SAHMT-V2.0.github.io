import {createHash} from 'node:crypto';

const INTERNAL_ORIGIN = 'https://broker-state.internal';
const MAX_SLOTS = 32;
const MAX_TTL_MS = 90000;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const response = (status, body) => new Response(JSON.stringify(body), {status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
}});

/** SQLite-backed, singleton admission state. No FA token, UID, IP, or payload is stored. */
export class ManagementBrokerAdmissionState {
  constructor(ctx) {
    if (!ctx?.storage?.sql || typeof ctx.storage.sql.exec !== 'function') throw new Error('BROKER_STATE_STORAGE_REQUIRED');
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS active_requests (slot_id TEXT PRIMARY KEY, expires_at_ms INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS gateway_response_nonces (nonce_hash TEXT PRIMARY KEY, retain_until_ms INTEGER NOT NULL)');
  }

  async fetch(request) {
    if (request.method !== 'POST') return response(405, {ok:false, code:'BROKER_STATE_METHOD_DENIED'});
    let url, body;
    try { url = new URL(request.url); body = await request.json(); }
    catch { return response(400, {ok:false, code:'BROKER_STATE_REQUEST_INVALID'}); }
    if (url.origin !== INTERNAL_ORIGIN || url.search || url.hash) return response(400, {ok:false, code:'BROKER_STATE_REQUEST_INVALID'});
    if (url.pathname === '/admit') {
      if (!exact(body, ['slotId','nowMs','expiresAtMs','maxConcurrent'])
        || typeof body.slotId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.slotId)
        || !Number.isSafeInteger(body.nowMs) || !Number.isSafeInteger(body.expiresAtMs)
        || body.expiresAtMs <= body.nowMs || body.expiresAtMs - body.nowMs > MAX_TTL_MS
        || !Number.isSafeInteger(body.maxConcurrent) || body.maxConcurrent < 1 || body.maxConcurrent > MAX_SLOTS)
        return response(400, {ok:false, code:'BROKER_STATE_REQUEST_INVALID'});
      try {
        this.sql.exec('DELETE FROM active_requests WHERE expires_at_ms <= ?', body.nowMs);
        const {count} = this.sql.exec('SELECT COUNT(*) AS count FROM active_requests').one();
        if (count >= body.maxConcurrent) return response(429, {ok:false, code:'BROKER_STATE_FULL'});
        this.sql.exec('INSERT INTO active_requests (slot_id, expires_at_ms) VALUES (?, ?)', body.slotId, body.expiresAtMs);
        return response(200, {ok:true, admitted:true});
      } catch { return response(503, {ok:false, code:'BROKER_STATE_UNAVAILABLE'}); }
    }
    if (url.pathname === '/release') {
      if (!exact(body, ['slotId']) || typeof body.slotId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.slotId))
        return response(400, {ok:false, code:'BROKER_STATE_REQUEST_INVALID'});
      try { this.sql.exec('DELETE FROM active_requests WHERE slot_id = ?', body.slotId); return response(200, {ok:true}); }
      catch { return response(503, {ok:false, code:'BROKER_STATE_UNAVAILABLE'}); }
    }
    if (url.pathname === '/claim-gateway-response-nonce') {
      if (!exact(body, ['nonceHash','nowMs','expiresAtMs','retainUntilMs','maxNonceRecords'])
        || typeof body.nonceHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.nonceHash)
        || !Number.isSafeInteger(body.nowMs) || body.nowMs < 1
        || !Number.isSafeInteger(body.expiresAtMs) || body.expiresAtMs <= body.nowMs
        || body.expiresAtMs - body.nowMs > 120000
        || !Number.isSafeInteger(body.retainUntilMs) || body.retainUntilMs <= body.expiresAtMs
        || body.retainUntilMs - body.expiresAtMs > 86400000
        || !Number.isSafeInteger(body.maxNonceRecords) || body.maxNonceRecords < 1 || body.maxNonceRecords > 1536)
        return response(400, {ok:false, code:'BROKER_STATE_REQUEST_INVALID'});
      try {
        // These synchronous SQL calls are one atomic Durable Object event. Only
        // a digest of the protocol nonce is retained; metadata stays in memory.
        this.sql.exec('DELETE FROM gateway_response_nonces WHERE retain_until_ms <= ?', body.nowMs);
        const existing = this.sql.exec('SELECT nonce_hash FROM gateway_response_nonces WHERE nonce_hash = ?', body.nonceHash).toArray();
        if (existing.length) return response(200, {ok:true, status:'REPLAY'});
        const {count} = this.sql.exec('SELECT COUNT(*) AS count FROM gateway_response_nonces').one();
        if (!Number.isSafeInteger(count) || count >= body.maxNonceRecords)
          return response(429, {ok:false, code:'BROKER_STATE_FULL'});
        const insert = this.sql.exec('INSERT INTO gateway_response_nonces (nonce_hash, retain_until_ms) VALUES (?, ?)',
          body.nonceHash, body.retainUntilMs);
        // rowsWritten includes index writes in SQLite; it is not an inserted-row count.
        // The existence check and unique INSERT run synchronously without interleaving.
        insert.toArray?.();
        return response(200, {ok:true, status:'CLAIMED'});
      } catch { return response(503, {ok:false, code:'BROKER_STATE_UNAVAILABLE'}); }
    }
    return response(404, {ok:false, code:'BROKER_STATE_ROUTE_NOT_FOUND'});
  }
}

function requireBinding(binding) {
  if (!binding || typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') throw new Error('BROKER_STATE_BINDING_REQUIRED');
  return binding;
}
function stubFor(binding) {
  requireBinding(binding);
  return binding.get(binding.idFromName('global-admission-v1'));
}
async function callState(stub, path, body) {
  const response = await stub.fetch(new Request(INTERNAL_ORIGIN + path, {method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}));
  if (response.status !== 200) return false;
  const result = await response.json();
  return result?.ok === true && (path !== '/admit' || result.admitted === true);
}

/**
 * Creates an atomic, fail-closed claim function for authenticated Gateway
 * response nonces. Raw protocol nonces and request bodies are never persisted.
 */
export function createManagementGatewayResponseNonceClaimer({stateBinding, now = Date.now,
  maxNonceRecords = 512, retentionMs = 300000} = {}) {
  if (typeof now !== 'function' || !Number.isSafeInteger(maxNonceRecords) || maxNonceRecords < 1 || maxNonceRecords > 1536
    || !Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > 86400000)
    throw new Error('GATEWAY_NONCE_POLICY_INVALID');
  // Durable Object stubs carry the creating request's I/O context in workerd.
  // Keep the namespace binding only; create a stub inside each request.
  requireBinding(stateBinding);
  return async (metadata, context = {}) => {
    if (!metadata || typeof metadata !== 'object' || metadata.direction !== 'APPS_SCRIPT_TO_WORKER'
      || typeof metadata.namespace !== 'string' || metadata.namespace.length < 10 || metadata.namespace.length > 160
      || typeof metadata.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(metadata.nonce)
      || !Number.isSafeInteger(metadata.expiresAtMs)) throw new Error('GATEWAY_ADMISSION_DENIED');
    if (context.signal?.aborted === true) throw new Error('GATEWAY_ADMISSION_DENIED');
    const current = now();
    if (!Number.isSafeInteger(current) || current < 1 || metadata.expiresAtMs <= current
      || metadata.expiresAtMs - current > 120000) throw new Error('GATEWAY_ADMISSION_DENIED');
    const retainUntilMs = metadata.expiresAtMs + retentionMs;
    if (!Number.isSafeInteger(retainUntilMs)) throw new Error('GATEWAY_ADMISSION_DENIED');
    const nonceHash = createHash('sha256').update(metadata.namespace + '\n' + metadata.direction + '\n' + metadata.nonce).digest('hex');
    let stateResponse;
    try {
      stateResponse = await stubFor(stateBinding).fetch(new Request(INTERNAL_ORIGIN + '/claim-gateway-response-nonce', {method:'POST',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({nonceHash, nowMs:current,
          expiresAtMs:metadata.expiresAtMs, retainUntilMs, maxNonceRecords})}));
      if (stateResponse.status !== 200) throw new Error('GATEWAY_ADMISSION_DENIED');
      const result = await stateResponse.json();
      if (result?.ok !== true || !['CLAIMED','REPLAY'].includes(result.status)) throw new Error('GATEWAY_ADMISSION_DENIED');
      return {...metadata, status:result.status, durable:true, atomic:true, budgetAllowed:true, capacityAllowed:true, retained:true};
    } catch { throw new Error('GATEWAY_ADMISSION_DENIED'); }
  };
}

/**
 * Builds the Worker-facing admission/supervision shell around an injected,
 * server-only broker. The caller must still provide the reviewed FA/FB/FC
 * adapters and credentials; this factory discovers none.
 */
export function createManagementAuthWorkerRuntime({broker, stateBinding, now = Date.now,
  newSlotId = () => globalThis.crypto.randomUUID(), maxConcurrent = 8, maxRequestMs = 20000, cleanupDrainMs = 5000} = {}) {
  if (!broker || typeof broker.exchange !== 'function' || typeof now !== 'function'
    || typeof newSlotId !== 'function' || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_SLOTS
    || !Number.isSafeInteger(maxRequestMs) || maxRequestMs < 1 || maxRequestMs > 80000
    || !Number.isSafeInteger(cleanupDrainMs) || cleanupDrainMs < 1 || cleanupDrainMs > 10000
    || maxRequestMs + cleanupDrainMs > MAX_TTL_MS)
    throw new Error('BROKER_RUNTIME_CONFIG_INVALID');
  requireBinding(stateBinding);
  const admitRequest = async () => {
    const current = now(), slotId = newSlotId();
    if (!Number.isSafeInteger(current) || typeof slotId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(slotId)) return false;
    const expiresAtMs = current + maxRequestMs + cleanupDrainMs;
    if (!Number.isSafeInteger(expiresAtMs) || !await callState(stubFor(stateBinding), '/admit', {slotId, nowMs:current, expiresAtMs, maxConcurrent})) return false;
    let released = false;
    return {allowed:true, async release() {
      if (released) return; released = true; await callState(stubFor(stateBinding), '/release', {slotId});
    }};
  };
  const superviseExchange = (completion, {releaseAdmission, executionContext} = {}) => {
    if (!completion || typeof completion.then !== 'function' || typeof executionContext?.waitUntil !== 'function') return false;
    const supervised = Promise.resolve(completion).then(async outcome => {
      if (outcome?.settled !== false && typeof releaseAdmission === 'function') await releaseAdmission();
    }).catch(() => {});
    try { executionContext.waitUntil(supervised); return true; }
    catch { return false; }
  };
  return Object.freeze({enabled:true, broker, admitRequest, superviseExchange, maxRequestMs, cleanupDrainMs});
}
