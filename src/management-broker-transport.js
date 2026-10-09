const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
const ROUTE = '/v1/management/session';
const publicHostname = hostname => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname)
  && hostname.includes('.') && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  && !/(?:^|\.)(?:localhost|local|internal|home|lan)$/i.test(hostname);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s/\x00-\x1f]/.test(value);
class TransportError extends Error { constructor(code) { super(code); this.code = code; } }
const safeError = code => new TransportError(code);

/** No global fetch, SDK, storage or automatic request. Configuration is host-owned. */
export function createManagementBrokerTransport({enabled = false, endpoint, allowedBrokerOrigins = [], fetchImpl,
  timeoutMs, maxResponseBytes, maxResponseChunks = 1024} = {}) {
  let disposed = false;
  const requests = new Map();
  const configured = () => {
    if (enabled !== true || disposed) throw safeError('BROKER_TRANSPORT_DISABLED');
    let target;
    try { target = new URL(endpoint); } catch { throw safeError('BROKER_ENDPOINT_INVALID'); }
    if (target.protocol !== 'https:' || !publicHostname(target.hostname) || target.username || target.password || target.search || target.hash
      || target.pathname !== ROUTE || !Array.isArray(allowedBrokerOrigins)
      || !allowedBrokerOrigins.includes(target.origin) || typeof fetchImpl !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000
      || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0 || maxResponseBytes > 65536
      || !Number.isSafeInteger(maxResponseChunks) || maxResponseChunks <= 0 || maxResponseChunks > 1024)
      throw safeError('BROKER_TRANSPORT_CONFIG_INVALID');
    return target.href;
  };
  async function exchange(request, {signal} = {}) {
    const url = configured();
    if (!request || typeof request.faIdToken !== 'string' || !request.faIdToken.length
      || request.faIdToken.length > 16000 || !id(request.faUid) || request.faUid.length > 128
      || request.fbUid !== request.faUid || !id(request.memberId)
      || request.sourceProjectId !== FA || request.destinationProjectId !== FB)
      throw safeError('BROKER_REQUEST_INVALID');
    const controller = new AbortController(), deadline = performance.now() + timeoutMs;
    const assertLive = () => {
      if (performance.now() >= deadline) { controller.abort(); throw safeError('BROKER_REQUEST_TIMEOUT'); }
      if (controller.signal.aborted || disposed) throw safeError('BROKER_REQUEST_ABORTED');
    };
    let timer, rejectAbort, body = null, privateToken = request.faIdToken;
    const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
    const cancel = code => { controller.abort(); rejectAbort(safeError(code)); };
    requests.set(controller, cancel);
    const onAbort = () => cancel('BROKER_REQUEST_ABORTED');
    signal?.addEventListener('abort', onAbort, {once: true});
    try {
      if (signal?.aborted) throw safeError('BROKER_REQUEST_ABORTED');
      body = JSON.stringify({faIdToken: privateToken}); privateToken = null;
      timer = setTimeout(() => cancel('BROKER_REQUEST_TIMEOUT'), timeoutMs);
      const work = async () => {
        assertLive();
        const response = await fetchImpl(url, {method: 'POST', body,
          headers: {'Content-Type': 'application/json', Accept: 'application/json'},
          mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error',
          referrerPolicy: 'no-referrer', signal: controller.signal});
        assertLive();
        if (response?.status !== 200 || response.redirected === true || response.url !== url
          || !/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || '')
          || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers?.get?.('cache-control') || ''))
          throw safeError('BROKER_RESPONSE_REJECTED');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes))
          throw safeError('BROKER_RESPONSE_TOO_LARGE');
        const reader = response.body?.getReader?.();
        if (!reader) throw safeError('BROKER_RESPONSE_STREAM_REQUIRED');
        const chunks = []; let bytes = 0;
        try {
          while (true) {
            assertLive();
            const chunk = await reader.read();
            assertLive();
            if (chunk.done) break;
            if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0) throw safeError('BROKER_RESPONSE_INVALID');
            if (chunks.length >= maxResponseChunks) throw safeError('BROKER_RESPONSE_TOO_MANY_CHUNKS');
            bytes += chunk.value.byteLength;
            if (bytes > maxResponseBytes) throw safeError('BROKER_RESPONSE_TOO_LARGE');
            chunks.push(chunk.value);
          }
        } finally {
          try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
          try { reader.releaseLock?.(); } catch {}
        }
        const data = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
        assertLive();
        let result;
        try { result = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(data)); }
        catch { throw safeError('BROKER_RESPONSE_INVALID'); }
        if (result?.ok !== true || result.sourceProjectId !== FA || result.destinationProjectId !== FB
          || result.faUid !== request.faUid || result.fbUid !== request.fbUid || result.memberId !== request.memberId
          || !Number.isSafeInteger(result.leaseVersion) || result.leaseVersion <= 0 || !id(result.policyVersion)
          || typeof result.customToken !== 'string' || !result.customToken.length || result.customToken.length > 16000)
          throw safeError('BROKER_RESPONSE_IDENTITY_INVALID');
        assertLive();
        return Object.freeze({ok: true, sourceProjectId: FA, destinationProjectId: FB,
          faUid: result.faUid, fbUid: result.fbUid, memberId: result.memberId,
          leaseVersion: result.leaseVersion, policyVersion: result.policyVersion, customToken: result.customToken});
      };
      const result = await Promise.race([work(), cancelled]);
      assertLive();
      return result;
    } catch (error) {
      if (error instanceof TransportError) throw safeError(error.code);
      throw safeError('BROKER_TRANSPORT_FAILED');
    } finally { controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', onAbort); requests.delete(controller); body = null; privateToken = null; }
  }
  const dispose = () => { disposed = true; for (const cancel of requests.values()) cancel('BROKER_REQUEST_ABORTED'); requests.clear(); };
  return Object.freeze({exchange, dispose});
}
