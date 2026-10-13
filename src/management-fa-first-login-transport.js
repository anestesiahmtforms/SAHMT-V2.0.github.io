const ROUTE = '/v1/auth/first-login';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
class FirstLoginTransportError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new FirstLoginTransportError(code); };

/** Explicitly invoked browser transport; it never reads Firebase tokens or activates itself. */
export function createManagementFaFirstLoginTransport({enabled = false, endpoint,
  allowedBrokerOrigins = [], fetchImpl, timeoutMs = 15000, maxResponseBytes = 20000} = {}) {
  let disposed = false;
  const active = new Set();
  function endpointUrl() {
    if (enabled !== true || disposed) fail('FIRST_LOGIN_TRANSPORT_DISABLED');
    let url; try { url = new URL(endpoint); } catch { fail('FIRST_LOGIN_ENDPOINT_INVALID'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== ROUTE
      || !allowedBrokerOrigins.includes(url.origin) || typeof fetchImpl !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 25000
      || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 65536)
      fail('FIRST_LOGIN_TRANSPORT_CONFIG_INVALID');
    return url.href;
  }
  async function claimFirstLogin(input, {signal} = {}) {
    const url = endpointUrl();
    if (!input || Object.keys(input).length !== 2 || typeof input.googleIdToken !== 'string'
      || input.googleIdToken.length < 1 || input.googleIdToken.length > 16000
      || typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(input.nonce)) fail('FIRST_LOGIN_REQUEST_INVALID');
    const controller = new AbortController(), deadline = performance.now() + timeoutMs;
    const assertLive = () => {
      if (disposed || controller.signal.aborted || signal?.aborted) fail('FIRST_LOGIN_REQUEST_ABORTED');
      if (performance.now() >= deadline) { controller.abort(); fail('FIRST_LOGIN_REQUEST_TIMEOUT'); }
    };
    const cancel = () => controller.abort();
    active.add(cancel); signal?.addEventListener('abort', cancel, {once:true});
    const timer = setTimeout(cancel, timeoutMs);
    let reader;
    try {
      const work = async () => {
        assertLive();
        const response = await fetchImpl(url, {method:'POST',headers:{'Content-Type':'application/json; charset=utf-8',Accept:'application/json'},
          body:JSON.stringify({googleIdToken:input.googleIdToken,nonce:input.nonce}),mode:'cors',credentials:'omit',cache:'no-store',
          redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
        assertLive();
        if (!response || response.redirected === true || response.url !== url
          || !/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || '')
          || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers?.get?.('cache-control') || '')) fail('FIRST_LOGIN_RESPONSE_REJECTED');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) fail('FIRST_LOGIN_RESPONSE_TOO_LARGE');
        reader = response.body?.getReader?.(); if (!reader) fail('FIRST_LOGIN_RESPONSE_INVALID');
        const chunks=[]; let size=0;
        try { while (true) { assertLive(); const part=await reader.read(); assertLive(); if(part.done)break;
          if(!(part.value instanceof Uint8Array)||!part.value.byteLength)fail('FIRST_LOGIN_RESPONSE_INVALID');
          size+=part.value.byteLength;if(size>maxResponseBytes||chunks.length>=128)fail('FIRST_LOGIN_RESPONSE_TOO_LARGE');chunks.push(part.value); } }
        finally { try { await reader.cancel(); } catch {} try { reader.releaseLock(); } catch {} }
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('FIRST_LOGIN_RESPONSE_INVALID');}
        assertLive();
        if (response.status === 403 && result?.ok === false && result.status === 'DENIED' && safeCode(result.code))
          return Object.freeze({status:'DENIED',code:result.code});
        if (response.status === 200 && result?.ok === true && result.status === 'ALREADY_LINKED' && id(result.uid)
          && Object.keys(result).length === 3) return Object.freeze({status:'ALREADY_LINKED',uid:result.uid});
        if (response.status === 200 && result?.ok === true && result.status === 'FIRST_LOGIN' && id(result.uid)
          && typeof result.customToken === 'string' && result.customToken.length > 0 && result.customToken.length <= 16000
          && Object.keys(result).length === 4) return Object.freeze({status:'FIRST_LOGIN',uid:result.uid,customToken:result.customToken});
        fail('FIRST_LOGIN_RESPONSE_INVALID');
      };
      const result = await Promise.race([work(), new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new FirstLoginTransportError('FIRST_LOGIN_REQUEST_TIMEOUT')),{once:true}))]);
      assertLive(); return result;
    } catch (error) {
      if (error instanceof FirstLoginTransportError) throw new FirstLoginTransportError(error.code);
      fail('FIRST_LOGIN_TRANSPORT_FAILED');
    } finally {
      controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort',cancel); active.delete(cancel);
      try { await reader?.cancel?.(); } catch {} try { reader?.releaseLock?.(); } catch {}
    }
  }
  function dispose() { disposed=true; for(const cancel of active)cancel(); active.clear(); }
  return Object.freeze({claimFirstLogin,dispose});
}
