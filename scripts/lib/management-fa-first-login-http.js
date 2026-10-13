const ORIGIN = 'https://anestesiahmtforms.github.io';
const ROUTE = '/v1/auth/first-login';
const MAX_BYTES = 20 * 1024;
const response = (status, body, origin) => {
  const headers = new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    Pragma:'no-cache','X-Content-Type-Options':'nosniff','Vary':'Origin'});
  if (origin === ORIGIN) {
    headers.set('Access-Control-Allow-Origin', ORIGIN);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  return new Response(status === 204 ? null : JSON.stringify(body), {status, headers});
};
const deny = (status, code) => Object.freeze({status, code});
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
const nonceValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(value);

async function readBody(request, signal, isExpired) {
  if (!request.body) throw deny(400, 'FIRST_LOGIN_BODY_REQUIRED');
  const reader = request.body.getReader(), chunks = [];
  let size = 0, count = 0;
  try {
    while (true) {
      if (signal.aborted || isExpired()) throw deny(504, 'FIRST_LOGIN_DEADLINE');
      const part = await reader.read();
      if (signal.aborted || isExpired()) throw deny(504, 'FIRST_LOGIN_DEADLINE');
      if (part.done) break;
      if (++count > 128 || !(part.value instanceof Uint8Array) || !part.value.byteLength) throw deny(400, 'FIRST_LOGIN_BODY_INVALID');
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw deny(413, 'FIRST_LOGIN_BODY_TOO_LARGE');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
    catch { throw deny(400, 'FIRST_LOGIN_BODY_INVALID'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
      || typeof body.googleIdToken !== 'string' || body.googleIdToken.length < 1 || body.googleIdToken.length > 16000
      || !nonceValid(body.nonce)) throw deny(400, 'FIRST_LOGIN_BODY_INVALID');
    return {googleIdToken:body.googleIdToken, nonce:body.nonce};
  } finally {
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}

/** Disabled-by-default, fixed-origin HTTP adapter for the FA first-login broker. */
export function createManagementFaFirstLoginHttp({enabled = false, broker, admitRequest,
  superviseRequest, maxRequestMs = 15000, cleanupDrainMs = 3000, wallClock = Date.now} = {}) {
  return async function handle(request, _env, executionContext) {
    const origin = request.headers.get('Origin');
    try {
      if (enabled !== true) return response(503, {ok:false, status:'DENIED', code:'FIRST_LOGIN_DISABLED'}, origin);
      if (!broker || typeof broker.claim !== 'function' || typeof admitRequest !== 'function'
        || typeof superviseRequest !== 'function' || !Number.isSafeInteger(maxRequestMs)
        || maxRequestMs < 1000 || maxRequestMs > 25000 || !Number.isSafeInteger(cleanupDrainMs)
        || cleanupDrainMs < 1 || cleanupDrainMs > 5000 || typeof wallClock !== 'function')
        return response(503, {ok:false,status:'DENIED',code:'FIRST_LOGIN_NOT_CONFIGURED'}, origin);
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== ROUTE)
        return response(400, {ok:false,status:'DENIED',code:'FIRST_LOGIN_URL_INVALID'}, origin);
      if (origin !== ORIGIN) return response(403, {ok:false,status:'DENIED',code:'FIRST_LOGIN_ORIGIN_DENIED'}, origin);
      if (request.method === 'OPTIONS') {
        if (request.headers.get('Access-Control-Request-Method') !== 'POST') return response(405,{ok:false,status:'DENIED',code:'FIRST_LOGIN_METHOD_DENIED'},origin);
        const headers = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
        if (headers.some(value=>value !== 'content-type')) return response(403,{ok:false,status:'DENIED',code:'FIRST_LOGIN_HEADERS_DENIED'},origin);
        return response(204, null, origin);
      }
      if (request.method !== 'POST') return response(405,{ok:false,status:'DENIED',code:'FIRST_LOGIN_METHOD_DENIED'},origin);
      if (request.headers.has('Authorization') || request.headers.has('Cookie')) return response(400,{ok:false,status:'DENIED',code:'FIRST_LOGIN_HEADERS_DENIED'},origin);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || ''))
        return response(415,{ok:false,status:'DENIED',code:'FIRST_LOGIN_CONTENT_TYPE_INVALID'},origin);
      const length = request.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
        return response(413,{ok:false,status:'DENIED',code:'FIRST_LOGIN_BODY_TOO_LARGE'},origin);

      const controller = new AbortController(), deadline = performance.now() + maxRequestMs;
      const isExpired = () => performance.now() >= deadline;
      let timer, admission, finished = false;
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, {once:true});
      timer = setTimeout(abort, maxRequestMs);
      try {
        admission = await admitRequest({origin,route:ROUTE,method:'POST'}, {signal:controller.signal});
        if (!admission || admission.allowed !== true || typeof admission.release !== 'function')
          return response(429,{ok:false,status:'DENIED',code:'FIRST_LOGIN_CAPACITY'},origin);
        const input = await readBody(request, controller.signal, isExpired);
        if (isExpired()) return response(504,{ok:false,status:'DENIED',code:'FIRST_LOGIN_DEADLINE'},origin);
        const startedAt = wallClock();
        if (!Number.isSafeInteger(startedAt) || startedAt < 1)
          return response(503,{ok:false,status:'DENIED',code:'FIRST_LOGIN_CLOCK_INVALID'},origin);
        const completion = Promise.resolve().then(()=>broker.claim(input,{signal:controller.signal,deadlineMs:startedAt+maxRequestMs}));
        if (superviseRequest(completion,{releaseAdmission:admission.release,executionContext,maximumLifetimeMs:maxRequestMs+cleanupDrainMs}) !== true)
          return response(503,{ok:false,status:'DENIED',code:'FIRST_LOGIN_SUPERVISOR_UNAVAILABLE'},origin);
        admission = null; finished = true;
        let result;
        try { result = await Promise.race([completion, new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('deadline')),{once:true}))]); }
        catch { return response(504,{ok:false,status:'DENIED',code:'FIRST_LOGIN_DEADLINE'},origin); }
        if (isExpired() || controller.signal.aborted) return response(504,{ok:false,status:'DENIED',code:'FIRST_LOGIN_DEADLINE'},origin);
        if (!result || result.status === 'DENIED') return response(403,{ok:false,status:'DENIED',
          code:safeCode(result?.code) ? result.code : 'FIRST_LOGIN_DENIED'},origin);
        if (result.status === 'ALREADY_LINKED' && typeof result.uid === 'string' && result.uid.length <= 128)
          return response(200,{ok:true,status:'ALREADY_LINKED',uid:result.uid},origin);
        if (result.status === 'FIRST_LOGIN' && typeof result.uid === 'string' && result.uid.length <= 128
          && typeof result.customToken === 'string' && result.customToken.length <= 16000)
          return response(200,{ok:true,status:'FIRST_LOGIN',uid:result.uid,customToken:result.customToken},origin);
        return response(502,{ok:false,status:'DENIED',code:'FIRST_LOGIN_RESULT_INVALID'},origin);
      } finally {
        if (admission) { try { await admission.release(); } catch {} }
        if (finished) controller.abort();
        clearTimeout(timer); request.signal.removeEventListener('abort',abort);
      }
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      return response(status,{ok:false,status:'DENIED',code:safeCode(error?.code)?error.code:'FIRST_LOGIN_UNAVAILABLE'},origin);
    }
  };
}
