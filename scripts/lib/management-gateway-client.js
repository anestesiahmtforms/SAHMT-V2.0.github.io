import {randomBytes} from 'node:crypto';
import {MANAGEMENT_GATEWAY_DENIAL_CODES} from './management-gateway-protocol.js';

const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', FC = 'indicadores---sahmt';
class GatewayClientError extends Error { constructor(code) { super(code); this.code = code; } }
const need = (condition, code) => { if (!condition) throw new GatewayClientError(code); };
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function deploymentUrl(value) {
  need(typeof value === 'string' && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(value), 'GATEWAY_ENDPOINT_INVALID');
  return value;
}
function redirectUrl(value) {
  need(typeof value === 'string' && value.length <= 8192, 'GATEWAY_REDIRECT_DENIED');
  let url; try { url = new URL(value); } catch { throw new GatewayClientError('GATEWAY_REDIRECT_DENIED'); }
  need(url.protocol === 'https:' && url.hostname === 'script.googleusercontent.com' && !url.port
    && !url.username && !url.password && !url.hash && url.pathname === '/macros/echo'
    && url.searchParams.has('user_content_key') && [...url.searchParams].every(([key, v]) => ['user_content_key','lib'].includes(key)
      && v.length > 0 && v.length <= 4096) && new Set([...url.searchParams.keys()]).size === [...url.searchParams.keys()].length,
    'GATEWAY_REDIRECT_DENIED');
  return url.href;
}

// Dedicated server-to-server client. No browser import, global fetch, OAuth or retry.
export function createManagementGatewayClient({enabled = false, protocol, fetchImpl, endpoint, policy,
  claimResponseNonce, clock = Date.now, newRequestId = () => randomBytes(16).toString('hex'),
  newNonce = () => randomBytes(16).toString('hex')} = {}) {
  let disposed = false;
  const active = new Map();
  const configured = () => {
    need(enabled === true && !disposed, 'GATEWAY_CLIENT_DISABLED');
    need(protocol && typeof protocol.createRequest === 'function' && typeof protocol.acceptResponse === 'function'
      && typeof fetchImpl === 'function' && typeof claimResponseNonce === 'function' && typeof clock === 'function'
      && typeof newRequestId === 'function' && typeof newNonce === 'function', 'GATEWAY_CLIENT_CONFIG_INVALID');
    deploymentUrl(endpoint);
    need(object(policy) && integer(policy.maxRequestMs, 1) && policy.maxRequestMs <= 120000
      && integer(policy.maxResponseBytes, 1024) && policy.maxResponseBytes <= 65536
      && integer(policy.maxResponseChunks, 1) && policy.maxResponseChunks <= 512, 'GATEWAY_CLIENT_POLICY_INVALID');
  };
  const invoke = async (operation, body, context = {}, requestNonce) => {
    let controller, timer, abortListener, reader, authenticatedDenialCode;
    try {
      configured();
      need(object(context), 'GATEWAY_CONTEXT_INVALID');
      const start = clock(); need(integer(start), 'GATEWAY_CLOCK_INVALID');
      let deadlineMs = start + policy.maxRequestMs;
      if (context.deadlineMs !== undefined) { need(integer(context.deadlineMs), 'GATEWAY_DEADLINE_INVALID'); deadlineMs = Math.min(deadlineMs, context.deadlineMs); }
      need(integer(deadlineMs) && deadlineMs > start, 'GATEWAY_DEADLINE_EXCEEDED');
      controller = new AbortController();
      const wallDeadline = performance.now() + deadlineMs - start;
      let rejectCancelled;
      const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
      const cancel = code => { controller.abort(); rejectCancelled(new GatewayClientError(code)); };
      active.set(controller, cancel);
      const assertLive = () => {
        need(!disposed && !controller.signal.aborted && context.signal?.aborted !== true, 'GATEWAY_CANCELLED');
        const time = clock(); need(integer(time) && time >= start, 'GATEWAY_CLOCK_INVALID');
        need(time < deadlineMs && performance.now() < wallDeadline, 'GATEWAY_DEADLINE_EXCEEDED'); return time;
      };
      abortListener = () => cancel('GATEWAY_CANCELLED');
      if (context.signal !== undefined) need(typeof context.signal.addEventListener === 'function'
        && typeof context.signal.removeEventListener === 'function' && typeof context.signal.aborted === 'boolean', 'GATEWAY_CONTEXT_INVALID');
      context.signal?.addEventListener('abort', abortListener, {once:true});
      timer = setTimeout(() => cancel('GATEWAY_DEADLINE_EXCEEDED'), Math.max(1, deadlineMs - start));
      if (context.signal?.aborted) cancel('GATEWAY_CANCELLED');
      const work = async () => {
        assertLive();
        const nonce = requestNonce === undefined ? newNonce() : requestNonce;
        need(typeof nonce === 'string' && /^[a-f0-9]{32}$/.test(nonce), 'GATEWAY_REQUEST_NONCE_INVALID');
        const envelope = protocol.createRequest({operation, requestId:newRequestId(), nonce, issuedAtMs:start, expiresAtMs:deadlineMs, body});
        const options = {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8', Accept:'application/json'},
          body:JSON.stringify(envelope), redirect:'manual', cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal};
        let expectedUrl = endpoint;
        let response = await fetchImpl(expectedUrl, options); assertLive();
        need(response && response.redirected !== true && response.url === expectedUrl, 'GATEWAY_HTTP_RESPONSE_INVALID');
        if (response.status === 302 || response.status === 303) {
          expectedUrl = redirectUrl(response.headers?.get?.('location'));
          try { void Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
          assertLive();
          response = await fetchImpl(expectedUrl, {method:'GET', headers:{Accept:'application/json'}, redirect:'manual',
            cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal}); assertLive();
          need(response && response.redirected !== true && response.url === expectedUrl, 'GATEWAY_HTTP_RESPONSE_INVALID');
        }
        need(response.status === 200 && /^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || ''), 'GATEWAY_HTTP_RESPONSE_INVALID');
        const length = response.headers.get('content-length');
        need(length === null || /^\d+$/.test(length) && Number(length) <= policy.maxResponseBytes, 'GATEWAY_RESPONSE_TOO_LARGE');
        reader = response.body?.getReader?.(); need(reader && typeof reader.read === 'function', 'GATEWAY_RESPONSE_STREAM_REQUIRED');
        const chunks = []; let size = 0;
        while (true) {
          assertLive(); const part = await reader.read(); assertLive();
          if (part.done) break;
          need(part.value instanceof Uint8Array && part.value.byteLength > 0, 'GATEWAY_RESPONSE_INVALID');
          size += part.value.byteLength;
          need(size <= policy.maxResponseBytes && chunks.length < policy.maxResponseChunks, 'GATEWAY_RESPONSE_TOO_LARGE'); chunks.push(part.value);
        }
        const bytes = Buffer.concat(chunks); let data;
        try { data = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw new GatewayClientError('GATEWAY_RESPONSE_INVALID'); }
        assertLive();
        const result = await protocol.acceptResponse(data, envelope, {claimNonce:claimResponseNonce, signal:controller.signal, deadlineMs});
        assertLive();
        // Set only after HMAC, binding, expiry and response nonce validation.
        // Neither raw HTTP content nor a thrown transport error can supply it.
        if (context.pilotDiagnostics === true && result?.status === 'DENIED' && result.body === null
          && MANAGEMENT_GATEWAY_DENIAL_CODES.includes(result.code)) authenticatedDenialCode = result.code;
        need(result && result.status === 'SUCCESS' && result.code === 'OK', 'GATEWAY_OPERATION_DENIED');
        return result.body;
      };
      const result = await Promise.race([Promise.resolve().then(work), cancelled]);
      assertLive(); return result;
    } catch (error) {
      if (error instanceof GatewayClientError) {
        const sanitized = new GatewayClientError(error.code);
        if (error.code === 'GATEWAY_OPERATION_DENIED' && authenticatedDenialCode !== undefined)
          sanitized.gatewayDenialCode = authenticatedDenialCode;
        throw sanitized;
      }
      throw new GatewayClientError('GATEWAY_CLIENT_UNAVAILABLE');
    } finally {
      controller?.abort(); clearTimeout(timer);
      try { context?.signal?.removeEventListener?.('abort', abortListener); } catch {}
      if (controller) active.delete(controller);
      try { void Promise.resolve(reader?.cancel?.()).catch(() => {}); } catch {}
      try { reader?.releaseLock?.(); } catch {}
    }
  };
  return Object.freeze({
    readFaAuthorization: (body, context) => invoke('READ_FA_AUTHORIZATION', body, context),
    readFbLease: (body, context) => invoke('READ_FB_LEASE', body, context),
    writeFbLease: (body, context) => invoke('WRITE_FB_LEASE', body, context),
    invalidateFbLease: (body, context) => invoke('INVALIDATE_FB_LEASE', body, context),
    lookupAuthUser: (request, context) => {
      if (!exactKeys(request, ['projectId','uid']) || ![FA,FB,FC].includes(request.projectId))
        return Promise.reject(new GatewayClientError('GATEWAY_LOOKUP_REQUEST_INVALID'));
      const operation = request.projectId === FA ? 'AUTH_USER_LOOKUP_FA' : request.projectId === FB ? 'AUTH_USER_LOOKUP_FB' : 'AUTH_USER_LOOKUP_FC';
      return invoke(operation, {uid:request.uid}, context);
    },
    authorizeAndSignFaFirstLogin: (request, context) => {
      if (!exactKeys(request, ['email','googleSub','nonceDigest','issuedAtSeconds','expiresAtSeconds'])
        || typeof request.email !== 'string' || request.email.length > 254
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email)
        || typeof request.googleSub !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(request.googleSub)
        || typeof request.nonceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(request.nonceDigest)
        || !integer(request.issuedAtSeconds,1) || !integer(request.expiresAtSeconds,1))
        return Promise.reject(new GatewayClientError('GATEWAY_FIRST_LOGIN_REQUEST_INVALID'));
      const body = {email:request.email,googleSub:request.googleSub,
        issuedAtSeconds:request.issuedAtSeconds,expiresAtSeconds:request.expiresAtSeconds};
      // The gateway's existing atomic nonce ledger consumes this digest-derived
      // envelope nonce under LockService. The raw Google nonce never leaves the Worker.
      return invoke('FIRST_LOGIN_FA_SIGN', body, context, request.nonceDigest.slice(0,32));
    },
    signFbCustomToken: (request, context) => invoke('SIGN_FB_CUSTOM_TOKEN', request, context),
    signFcCustomToken: (request, context) => invoke('SIGN_FC_CUSTOM_TOKEN', request, context),
    dispose: () => { disposed = true; for (const cancel of active.values()) cancel('GATEWAY_CANCELLED'); active.clear(); }
  });
}
