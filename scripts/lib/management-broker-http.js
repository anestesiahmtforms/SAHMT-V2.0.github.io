import {sanitizedManagementPilotDiagnostic} from '../../src/firebase-project-broker-errors.js';
const ORIGIN = 'https://anestesiahmtforms.github.io';
const ROUTE = '/v1/management/session';
const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', FC = 'indicadores---sahmt';
const MAX_BYTES = 20 * 1024;
const MAX_CHUNKS = 512;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
class HttpDenial extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const deny = (status, code) => { throw new HttpDenial(status, code); };
function httpResponse(status, body, origin, allowedOrigin) {
  const headers = new Headers({'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', Pragma:'no-cache', 'X-Content-Type-Options':'nosniff', Vary:'Origin'});
  if (origin === allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
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
      || Object.keys(body).length !== 3 || !Object.hasOwn(body,'faIdToken')
      || typeof body.faIdToken !== 'string' || body.faIdToken.length < 1
      || body.faIdToken.length > 16000 || body.sourceProjectId !== FA
      || !body.targetProjectIds || typeof body.targetProjectIds !== 'object' || Array.isArray(body.targetProjectIds)) deny(400,'BROKER_BODY_INVALID');
    const targets = body.targetProjectIds, names = Object.keys(targets);
    if (names.length < 1 || names.length > 2
      || names.some(name => !['FB','FC'].includes(name)) || (Object.hasOwn(targets,'FB') && targets.FB !== FB)
      || (Object.hasOwn(targets,'FC') && targets.FC !== FC)) deny(400,'BROKER_BODY_INVALID');
    return {faIdToken:body.faIdToken, sourceProjectId:FA, targetProjectIds:Object.freeze(Object.fromEntries(names.map(name=>[name,targets[name]])))};
  } finally {
    signal.removeEventListener('abort',abort);
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A cancelled pending read cannot authorize work. */ }
  }
}
/** HTTPS transport only: no listener, deployment, credentials or default activation. */
export function createManagementBrokerHttp({enabled=false, broker, admitRequest, superviseExchange, maxRequestMs, cleanupDrainMs,
  allowedOrigin=ORIGIN,pilotOnly=false}={}) {
  let parsedOrigin;
  try { parsedOrigin = new URL(allowedOrigin); } catch { throw new Error('BROKER_ORIGIN_CONFIGURATION_INVALID'); }
  if (typeof allowedOrigin !== 'string' || parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== allowedOrigin
    || parsedOrigin.username || parsedOrigin.password || parsedOrigin.hostname.includes('*'))
    throw new Error('BROKER_ORIGIN_CONFIGURATION_INVALID');
  const response = (status, body, origin) => httpResponse(status, body, origin, allowedOrigin);
  return async function handle(request, env, executionContext) {
    const origin = request.headers.get('Origin');
    let controller, timer, requestAbort, finishSupervision, started = false, body = null, admissionRelease = null, exchangeRequiresReconciliation = false;
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
      if (origin !== allowedOrigin) deny(403,'BROKER_ORIGIN_DENIED');
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
        if (admitted === true) admissionRelease = null;
        else if (admitted && typeof admitted === 'object' && admitted.allowed === true && typeof admitted.release === 'function')
          admissionRelease = admitted.release;
        else deny(429,'BROKER_REQUEST_LIMITED');
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
        if (superviseExchange(completion,{maximumLifetimeMs:Math.ceil(lifetime),responseDeadlineMs:maxRequestMs,cleanupDrainMs,
          releaseAdmission:admissionRelease,executionContext}) !== true) {
          finishSupervision({settled:true,started:false,requiresReconciliation:false,code:'BROKER_SUPERVISOR_REJECTED'});
          deny(503,'BROKER_SUPERVISOR_REJECTED');
        }
        admissionRelease = null;
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
          const diagnostic=pilotOnly===true?sanitizedManagementPilotDiagnostic(result?.diagnostic):null;
          finishSupervision({settled:true,started:true,requiresReconciliation:result?.ok !== false || result?.requiresReconciliation === true,
            code:'BROKER_DENIED'});
          return response(result?.code === 'BROKER_DISABLED' ? 503 : 403,
          {ok:false,code:typeof result?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(result.code)
            ? result.code : 'BROKER_EXCHANGE_DENIED',requiresReconciliation:result?.ok !== false || result?.requiresReconciliation === true,
            ...(diagnostic?{diagnostic}:{})},origin);
        }
        exchangeRequiresReconciliation = result.requiresReconciliation === true;
        const expectedNames = Object.keys(body.targetProjectIds), targets = result?.targets;
        const validUnavailable = value => ['DENIED','UNAVAILABLE'].includes(value.status)
          && typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value.code)
          && Object.keys(value).length === (Object.hasOwn(value,'diagnostic') ? 4 : 3)
          && Object.keys(value).every(key=>['projectId','status','code','diagnostic'].includes(key));
        const validTarget = (name, value) => name === 'FB'
          ? value && value.projectId === FB && (value.status === 'READY'
            ? Object.keys(value).length === 4 && value.uid === result.faUid && typeof value.customToken === 'string'
              && value.customToken.length > 0 && value.customToken.length <= 16000
            : validUnavailable(value))
          : value && (value.status === 'READY'
            ? Object.keys(value).length === 4 && value.projectId === FC && value.uid === result.faUid
              && typeof value.customToken === 'string' && value.customToken.length > 0 && value.customToken.length <= 16000
            : value.projectId === FC && validUnavailable(value));
        const fbReady = targets?.FB?.status === 'READY';
        if (result.sourceProjectId !== FA || !safeId(result.faUid) || result.faUid.length>128
          || (fbReady && (result.destinationProjectId !== FB || result.faUid !== result.fbUid
            || !safeId(result.memberId) || !safeId(result.policyVersion)
            || !Number.isSafeInteger(result.leaseVersion) || result.leaseVersion<1))
          || (targets?.FB?.status !== 'READY' && ['destinationProjectId','fbUid','memberId','policyVersion','leaseVersion','customToken'].some(key => Object.hasOwn(result,key)))
          || !targets || Object.keys(targets).length !== expectedNames.length
          || expectedNames.some(name=>!Object.hasOwn(targets,name)||!validTarget(name,targets[name])))
          { finishSupervision({settled:true,started:true,requiresReconciliation:true,code:'BROKER_RESPONSE_INVALID'});
            deny(502,'BROKER_RESPONSE_INVALID'); }
        const responseTargets=Object.fromEntries(expectedNames.map(name=>{
          const target=targets[name];
          if(target.status==='READY')return [name,target];
          const diagnostic=pilotOnly===true?sanitizedManagementPilotDiagnostic(target.diagnostic):null;
          return [name,{projectId:target.projectId,status:target.status,code:target.code,...(diagnostic?{diagnostic}:{})}];
        }));
        const success = response(200,{schemaVersion:1,sourceProjectId:FA,faUid:result.faUid,targets:responseTargets},origin);
        return success;
      };
      try {
        const result = await Promise.race([execute(),cancelled]);
        if (deadlineEnded()) {
          finishSupervision?.({settled:true,started,requiresReconciliation:started,code:'BROKER_COMPLETED_AFTER_ABORT'});
          deny(504,'BROKER_HTTP_DEADLINE_EXCEEDED');
        }
        if (started && result.status === 200)
          finishSupervision?.({settled:true,started:true,requiresReconciliation:exchangeRequiresReconciliation,code:'BROKER_COMPLETED'});
        return result;
      }
      finally { controller.signal.removeEventListener('abort',abort); }
    } catch(error) {
      return response(error instanceof HttpDenial ? error.status : 503,
        {ok:false,code:error instanceof HttpDenial ? error.code : 'BROKER_HTTP_UNAVAILABLE',
          requiresReconciliation:started},origin);
    } finally {
      if(!started) finishSupervision?.({settled:true,started:false,requiresReconciliation:false,code:'BROKER_NOT_STARTED'});
      if(admissionRelease) { try { await admissionRelease(); } catch { /* expired slot is reclaimed by the durable TTL */ } }
      body=null;
      controller?.abort();
      clearTimeout(timer);
      if(requestAbort) request.signal.removeEventListener('abort',requestAbort);
    }
  };
}
