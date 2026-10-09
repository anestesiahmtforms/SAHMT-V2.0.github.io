const ORIGIN = 'https://anestesiahmtforms.github.io';
const ROUTE = '/v1/management/session';
const MAX_BYTES = 20 * 1024;
const MAX_CHUNKS = 512;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
class HttpDenial extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const deny = (status, code) => { throw new HttpDenial(status, code); };
function response(status, body, origin) {
  const headers = new Headers({'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', Pragma:'no-cache', 'X-Content-Type-Options':'nosniff', Vary:'Origin'});
  if (origin === ORIGIN) {
    headers.set('Access-Control-Allow-Origin', ORIGIN);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  return new Response(status === 204 ? null : JSON.stringify(body), {status, headers});
}
async function boundedBody(request, signal, deadlineEnded) {
  if (!request.body) deny(400, 'BROKER_BODY_REQUIRED');
  const reader = request.body.getReader(), chunks = [];
  let size = 0, reads = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, {once:true});
  try {
    while (true) {
      if (deadlineEnded()) deny(504, 'BROKER_HTTP_DEADLINE_EXCEEDED');
      const part = await reader.read();
      if (deadlineEnded()) deny(504, 'BROKER_HTTP_DEADLINE_EXCEEDED');
      if (part.done) break;
      if (++reads > MAX_CHUNKS || !(part.value instanceof Uint8Array) || part.value.byteLength === 0) deny(400,'BROKER_BODY_INVALID');
      size += part.value.byteLength;
      if (size > MAX_BYTES) deny(413, 'BROKER_BODY_TOO_LARGE');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
    catch { deny(400, 'BROKER_BODY_INVALID'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body,'faIdToken')
      || typeof body.faIdToken !== 'string' || body.faIdToken.length < 1
      || body.faIdToken.length > 16000) deny(400,'BROKER_BODY_INVALID');
    return {faIdToken:body.faIdToken};
  } finally {
    signal.removeEventListener('abort',abort);
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A cancelled pending read cannot authorize work. */ }
  }
}
/** HTTPS transport only: no listener, deployment, credentials or default activation. */
export function createManagementBrokerHttp({enabled=false, broker, admitRequest, superviseExchange, maxRequestMs, cleanupDrainMs}={}) {
  return async function handle(request) {
    const origin = request.headers.get('Origin');
    let controller, timer, requestAbort, finishSupervision, started = false, body = null;
    try {
      if (enabled !== true) return response(503,{ok:false,code:'BROKER_HTTP_DISABLED'},origin);
      if (!broker || typeof broker.exchange !== 'function' || typeof admitRequest !== 'function' || typeof superviseExchange !== 'function'
        || !Number.isSafeInteger(cleanupDrainMs) || cleanupDrainMs < 1 || cleanupDrainMs > 30000
        || !Number.isSafeInteger(maxRequestMs) || maxRequestMs < 1 || maxRequestMs > 120000)
        deny(503,'BROKER_HTTP_NOT_CONFIGURED');
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        deny(400,'BROKER_URL_INVALID');
      if (url.pathname !== ROUTE) deny(404,'BROKER_ROUTE_NOT_FOUND');
      if (origin !== ORIGIN) deny(403,'BROKER_ORIGIN_DENIED');
      if (request.method === 'OPTIONS') {
        if (request.headers.get('Access-Control-Request-Method') !== 'POST') deny(405,'BROKER_METHOD_DENIED');
        const requested = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);
        if (requested.some(value=>value !== 'content-type')) deny(403,'BROKER_HEADERS_DENIED');
        return response(204,null,origin);
      }
      if (request.method !== 'POST') deny(405,'BROKER_METHOD_DENIED');
      if (request.headers.has('Authorization') || request.headers.has('Cookie')) deny(400,'BROKER_HEADERS_DENIED');
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||'')) deny(415,'BROKER_CONTENT_TYPE_INVALID');
      const length = request.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length)>MAX_BYTES)) deny(413,'BROKER_BODY_TOO_LARGE');
      controller = new AbortController();
      requestAbort = () => controller.abort();
      request.signal.addEventListener('abort',requestAbort,{once:true});
      if (request.signal.aborted) requestAbort();
      let abort;
      const cancelled = new Promise((_,reject)=>{
        abort=()=>reject(new HttpDenial(504,'BROKER_HTTP_DEADLINE_EXCEEDED'));
        controller.signal.addEventListener('abort',abort,{once:true});
        if(controller.signal.aborted) abort();
      });
      const responseDeadline = performance.now() + maxRequestMs;
      const deadlineEnded = () => {
        if (performance.now() >= responseDeadline) controller.abort();
        return controller.signal.aborted;
      };
      timer=setTimeout(()=>controller.abort(),maxRequestMs);
      const execute = async () => {
        if (deadlineEnded()) deny(504,'BROKER_HTTP_DEADLINE_EXCEEDED');
        const admitted = await admitRequest({origin,route:ROUTE,method:'POST'},{signal:controller.signal});
        if (deadlineEnded()) deny(504,'BROKER_HTTP_DEADLINE_EXCEEDED');
        if (admitted !== true) deny(429,'BROKER_REQUEST_LIMITED');
        body = await boundedBody(request,controller.signal,deadlineEnded);
        if (deadlineEnded()) deny(504,'BROKER_HTTP_DEADLINE_EXCEEDED');
        let supervisionTimer, settled=false;
        const lifetime = Math.max(1,responseDeadline-performance.now()+cleanupDrainMs);
        const completion = new Promise(resolve=>{
          finishSupervision=value=>{
            if(settled) return;
            settled=true; clearTimeout(supervisionTimer);
            resolve(Object.freeze(value));
          };
          supervisionTimer=setTimeout(()=>finishSupervision({settled:false,started,requiresReconciliation:started,
            code:'BROKER_COMPLETION_UNCONFIRMED'}),lifetime);
        });
        if (superviseExchange(completion,{maximumLifetimeMs:Math.ceil(lifetime),responseDeadlineMs:maxRequestMs,cleanupDrainMs}) !== true) {
          finishSupervision({settled:true,started:false,requiresReconciliation:false,code:'BROKER_SUPERVISOR_REJECTED'});
          deny(503,'BROKER_SUPERVISOR_REJECTED');
        }
        if (deadlineEnded()) {
          finishSupervision({settled:true,started:false,requiresReconciliation:false,code:'BROKER_REQUEST_CANCELLED'});
          deny(504,'BROKER_HTTP_DEADLINE_EXCEEDED');
        }
        started=true;
        let result;
        try {
          result = await broker.exchange(body,{signal:controller.signal});
          // Settlement is recorded only after classifying the transport outcome.
        } catch {
          finishSupervision({settled:true,started:true,requiresReconciliation:true,code:'BROKER_COMPLETION_FAILED'});
          deny(503,'BROKER_HTTP_UNAVAILABLE');
        }
        if (deadlineEnded()) {
          finishSupervision({settled:true,started:true,requiresReconciliation:result?.ok !== false || result?.requiresReconciliation === true,
            code:'BROKER_COMPLETED_AFTER_ABORT'});
          deny(504,'BROKER_HTTP_DEADLINE_EXCEEDED');
        }
        if (result?.ok !== true) {
          finishSupervision({settled:true,started:true,requiresReconciliation:result?.ok !== false || result?.requiresReconciliation === true,
            code:'BROKER_DENIED'});
          return response(result?.code === 'BROKER_DISABLED' ? 503 : 403,
          {ok:false,code:typeof result?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(result.code)
            ? result.code : 'BROKER_EXCHANGE_DENIED',requiresReconciliation:result?.ok !== false || result?.requiresReconciliation === true},origin);
        }
        if (result.sourceProjectId !== 'sahmt-17a16' || result.destinationProjectId !== 'sahmt-gestao-5ae66'
          || !safeId(result.faUid) || result.faUid.length>128 || result.faUid !== result.fbUid
          || !safeId(result.memberId) || !safeId(result.policyVersion)
          || !Number.isSafeInteger(result.leaseVersion) || result.leaseVersion<1
          || typeof result.customToken !== 'string' || result.customToken.length<1 || result.customToken.length>16000)
          { finishSupervision({settled:true,started:true,requiresReconciliation:true,code:'BROKER_RESPONSE_INVALID'});
            deny(502,'BROKER_RESPONSE_INVALID'); }
        const success = response(200,{ok:true,sourceProjectId:result.sourceProjectId,destinationProjectId:result.destinationProjectId,
          faUid:result.faUid,fbUid:result.fbUid,memberId:result.memberId,leaseVersion:result.leaseVersion,
          policyVersion:result.policyVersion,customToken:result.customToken},origin);
        return success;
      };
      try {
        const result = await Promise.race([execute(),cancelled]);
        if (deadlineEnded()) {
          finishSupervision?.({settled:true,started,requiresReconciliation:started,code:'BROKER_COMPLETED_AFTER_ABORT'});
          deny(504,'BROKER_HTTP_DEADLINE_EXCEEDED');
        }
        if (started && result.status === 200)
          finishSupervision?.({settled:true,started:true,requiresReconciliation:false,code:'BROKER_COMPLETED'});
        return result;
      }
      finally { controller.signal.removeEventListener('abort',abort); }
    } catch(error) {
      return response(error instanceof HttpDenial ? error.status : 503,
        {ok:false,code:error instanceof HttpDenial ? error.code : 'BROKER_HTTP_UNAVAILABLE',
          requiresReconciliation:started},origin);
    } finally {
      if(!started) finishSupervision?.({settled:true,started:false,requiresReconciliation:false,code:'BROKER_NOT_STARTED'});
      body=null;
      controller?.abort();
      clearTimeout(timer);
      if(requestAbort) request.signal.removeEventListener('abort',requestAbort);
    }
  };
}
