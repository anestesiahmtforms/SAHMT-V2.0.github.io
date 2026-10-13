const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', FC = 'indicadores---sahmt';
const ROUTE = '/v1/management/session';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const fail = (code, httpStatus = null, detail = null) => {
  const diagnostic=sanitizedManagementPilotDiagnostic(detail);
  return Object.assign(new Error(code), {code, httpStatus:safeProjectBrokerHttpStatus(httpStatus), ...(diagnostic?{diagnostic}:{})});
};

function endpointConfig(endpoint, allowedOrigins, fetchImpl, timeoutMs, maxBytes, maxChunks) {
  let url;
  try { url = new URL(endpoint); } catch { throw fail('PROJECT_BROKER_ENDPOINT_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== ROUTE
    || !Array.isArray(allowedOrigins) || !allowedOrigins.includes(url.origin) || typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 65536
    || !Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > 512)
    throw fail('PROJECT_BROKER_CONFIG_INVALID');
  return url.href;
}

function parseResult(value, targetNames) {
  if (!exact(value, ['schemaVersion', 'sourceProjectId', 'faUid', 'targets']) || value.schemaVersion !== 1
    || value.sourceProjectId !== FA || !identifier(value.faUid) || !exact(value.targets, targetNames))
    throw fail('PROJECT_BROKER_RESPONSE_INVALID');
  const targets = {};
  for (const name of targetNames) {
    const projectId = name === 'FB' ? FB : FC, result = value.targets[name];
    if (!object(result) || result.projectId !== projectId) throw fail('PROJECT_BROKER_TARGET_INVALID');
    if (result.status === 'READY') {
      if (!exact(result, ['projectId', 'status', 'uid', 'customToken']) || result.uid !== value.faUid
        || typeof result.customToken !== 'string' || result.customToken.length < 1 || result.customToken.length > 16000
        || /[\s\x00-\x1f\x7f]/.test(result.customToken))
        throw fail('PROJECT_BROKER_TARGET_INVALID');
      targets[name] = Object.freeze({status: 'READY', projectId, uid: result.uid, customToken: result.customToken});
    } else if (['DENIED','UNAVAILABLE'].includes(result.status)
      && exact(result, ['projectId', 'status', 'code', ...(Object.hasOwn(result,'diagnostic')?['diagnostic']:[])])
      && typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(result.code)) {
      const diagnostic=sanitizedManagementPilotDiagnostic(result.diagnostic);
      targets[name] = Object.freeze({status: 'UNAVAILABLE', projectId, code: result.code,...(diagnostic?{diagnostic}:{})});
    } else throw fail('PROJECT_BROKER_TARGET_INVALID');
  }
  return Object.freeze({schemaVersion: 1, sourceProjectId: FA, faUid: value.faUid, targets: Object.freeze(targets)});
}

/** Browser transport to the dedicated Worker; it never contacts Apps Script directly. */
export function createFirebaseProjectBrokerTransport({enabled = false, endpoint, allowedOrigins = [], fetchImpl,
  timeoutMs = 20000, maxResponseBytes = 65536, maxResponseChunks = 512} = {}) {
  let disposed = false;
  const active = new Map();
  const configured = () => {
    if (enabled !== true || disposed) throw fail('PROJECT_BROKER_DISABLED');
    return endpointConfig(endpoint, allowedOrigins, fetchImpl, timeoutMs, maxResponseBytes, maxResponseChunks);
  };
  const exchangeTargets = async (request, {signal, deadlineMs} = {}) => {
    const url = configured();
    if (!exact(request, ['faIdToken', 'sourceProjectId', 'targetProjectIds'])
      || typeof request.faIdToken !== 'string' || request.faIdToken.length < 1 || request.faIdToken.length > 16000
      || request.sourceProjectId !== FA || !object(request.targetProjectIds)
      || Object.keys(request.targetProjectIds).length < 1 || Object.keys(request.targetProjectIds).length > 2
      || Object.keys(request.targetProjectIds).some(name => !['FB','FC'].includes(name))
      || (Object.hasOwn(request.targetProjectIds,'FB') && request.targetProjectIds.FB !== FB)
      || (Object.hasOwn(request.targetProjectIds,'FC') && request.targetProjectIds.FC !== FC))
      throw fail('PROJECT_BROKER_REQUEST_INVALID');
    if (signal?.aborted || (deadlineMs !== undefined && (!Number.isSafeInteger(deadlineMs) || Date.now() >= deadlineMs)))
      throw fail('PROJECT_BROKER_ABORTED');
    const controller = new AbortController(), deadline = performance.now() + timeoutMs;
    const assertLive = () => {
      if (disposed || controller.signal.aborted || signal?.aborted) throw fail('PROJECT_BROKER_ABORTED');
      if (performance.now() >= deadline || (deadlineMs !== undefined && Date.now() >= deadlineMs)) {
        controller.abort(); throw fail('PROJECT_BROKER_TIMEOUT');
      }
    };
    let timer, body = null, privateToken = request.faIdToken, readController, abortCode = 'PROJECT_BROKER_ABORTED', httpStatus = null;
    const cancel = code => { abortCode = code; controller.abort(); try { void readController?.cancel(code).catch(() => {}); } catch {} };
    const onAbort = () => cancel('PROJECT_BROKER_ABORTED');
    active.set(controller, cancel);
    signal?.addEventListener('abort', onAbort, {once: true});
    try {
      body = JSON.stringify({faIdToken: privateToken, sourceProjectId: FA, targetProjectIds: request.targetProjectIds});
      privateToken = null;
      timer = setTimeout(() => cancel('PROJECT_BROKER_TIMEOUT'), timeoutMs);
      let response;
      try { response = await fetchImpl(url, {method: 'POST', body,
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: controller.signal}); }
      catch { throw fail(controller.signal.aborted ? abortCode : 'PROJECT_BROKER_NETWORK_OR_CORS'); }
      assertLive();
      httpStatus = safeProjectBrokerHttpStatus(response?.status);
      if (response?.type === 'opaque' || response?.type === 'opaqueredirect') throw fail('PROJECT_BROKER_OPAQUE_RESPONSE');
      if (httpStatus === null) throw fail('PROJECT_BROKER_RESPONSE_REJECTED');
      const httpError = httpStatus !== 200;
      if (response.redirected === true) throw fail('PROJECT_BROKER_REDIRECT_REJECTED');
      if (response.url !== url) throw fail(httpError ? 'PROJECT_BROKER_HTTP_ERROR' : 'PROJECT_BROKER_RESPONSE_URL_REJECTED');
      let jsonType = false, noStore = false;
      try {
        jsonType = /^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || '');
        noStore = /(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers?.get?.('cache-control') || '');
      } catch { throw fail(httpError ? 'PROJECT_BROKER_HTTP_ERROR' : 'PROJECT_BROKER_RESPONSE_REJECTED'); }
      if (!jsonType) throw fail(httpError ? 'PROJECT_BROKER_HTTP_ERROR' : 'PROJECT_BROKER_CONTENT_TYPE_INVALID');
      if (!noStore) throw fail(httpError ? 'PROJECT_BROKER_HTTP_ERROR' : 'PROJECT_BROKER_CACHE_POLICY_INVALID');
      const responseByteLimit = httpError ? Math.min(maxResponseBytes, 4096) : maxResponseBytes;
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > responseByteLimit))
        throw fail('PROJECT_BROKER_RESPONSE_TOO_LARGE');
      readController = response.body?.getReader?.();
      if (!readController) throw fail('PROJECT_BROKER_RESPONSE_STREAM_REQUIRED');
      const chunks = []; let bytes = 0;
      try {
        while (true) {
          assertLive();
          let part;
          try { part = await readController.read(); }
          catch { throw fail(controller.signal.aborted ? abortCode : 'PROJECT_BROKER_RESPONSE_READ_FAILED'); }
          assertLive();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array) || part.value.byteLength === 0) throw fail('PROJECT_BROKER_RESPONSE_INVALID');
          if (chunks.length >= maxResponseChunks) throw fail('PROJECT_BROKER_RESPONSE_TOO_MANY_CHUNKS');
          bytes += part.value.byteLength;
          if (bytes > responseByteLimit) throw fail('PROJECT_BROKER_RESPONSE_TOO_LARGE');
          chunks.push(part.value);
        }
      } finally {
        try { await readController.cancel(); } catch {}
        try { readController.releaseLock(); } catch {}
        readController = null;
      }
      const data = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      assertLive();
      let parsed;
      try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(data)); }
      catch { throw fail('PROJECT_BROKER_RESPONSE_INVALID'); }
      if (httpError) {
        const accepted=parsed?.ok === false && isProjectBrokerServerCode(parsed?.code);
        throw fail(accepted ? parsed.code : 'PROJECT_BROKER_HTTP_ERROR', httpStatus, accepted?parsed.diagnostic:null);
      }
      return parseResult(parsed, Object.keys(request.targetProjectIds));
    } catch (error) {
      throw fail(isProjectBrokerDiagnosticCode(error?.code) ? error.code
        : controller.signal.aborted ? abortCode : 'PROJECT_BROKER_EXCHANGE_FAILED', httpStatus, error?.diagnostic);
    } finally {
      signal?.removeEventListener('abort', onAbort); clearTimeout(timer); body = null; privateToken = null;
      active.delete(controller); cancel('PROJECT_BROKER_FINISHED');
    }
  };
  return Object.freeze({exchangeTargets, dispose() { disposed = true; for (const cancel of active.values()) cancel('PROJECT_BROKER_DISPOSED'); active.clear(); }});
}
import {isProjectBrokerDiagnosticCode, isProjectBrokerServerCode, safeProjectBrokerHttpStatus, sanitizedManagementPilotDiagnostic} from './firebase-project-broker-errors.js';
