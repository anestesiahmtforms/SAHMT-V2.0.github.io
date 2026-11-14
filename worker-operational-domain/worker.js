import {DOMAIN_PROJECTS, FA_PROJECT, MODULE_LEASE_SECONDS, boundedJson, canEnterModule, fail, serviceIdentity, verifyFaSession} from './identity.js';
import {decodeFields} from '../worker-training/firestore.js';
import {createModuleStore} from './module-store.js';
import {applyEventProjection, verifyProjectionRequest, drainEventProjections} from './projection-runtime.js';

export function createOperationalDomainWorker({verify = verifyFaSession, createService = serviceIdentity, createStore = createModuleStore, fetchImpl = fetch} = {}) {
  const storeFor = env => {
    let credentials; try {credentials = JSON.parse(env.MODULE_SERVICE_ACCOUNT_JSON || 'null');} catch {throw fail('DOMAIN_CONFIG_REQUIRED');}
    const service = createService(credentials, env.MODULE_STATION, {fetchImpl});
    return createStore({station: env.MODULE_STATION, getAccessToken: () => service.accessToken(), fetchImpl});
  };
  return {async scheduled(_controller, env, ctx) {
    if (['FH', 'FG'].includes(env.MODULE_STATION)) return;
    if (env.MODULE_CUTOVER_ACTIVE !== 'true') return;
    if (DOMAIN_PROJECTS[env.MODULE_STATION] !== env.MODULE_PROJECT_ID) throw fail('DOMAIN_CONFIG_REQUIRED');
    ctx.waitUntil(drainEventProjections({station: env.MODULE_STATION, store: storeFor(env),
      secret: env.EVENT_PROJECTION_SHARED_SECRET, scoreFj: env.FJ_PERFORMANCE_ENABLED === 'true', fetchImpl}).then(result => console.log(JSON.stringify({code: 'DOMAIN_PROJECTION_DRAIN', ...result}))));
  }, async fetch(request, env) {
    const station = env.MODULE_STATION, projectId = DOMAIN_PROJECTS[station];
    const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin'};
    const json = (value, status = 200) => Response.json(value, {status, headers});
    const path = new URL(request.url).pathname;
    if (!projectId || projectId !== env.MODULE_PROJECT_ID) return json({code: 'DOMAIN_CONFIG_REQUIRED'}, 503);
    if (request.method === 'GET' && path === '/health') return json({station, projectId, service: 'FA_SESSION_EXCHANGE', cutoverActive: env.MODULE_CUTOVER_ACTIVE === 'true'});
    if (path === '/internal/v1/event-projection') {
      if (station !== 'FJ') return json({code: 'DOMAIN_NOT_FOUND'}, 404);
      if (env.MODULE_CUTOVER_ACTIVE !== 'true') return json({code: 'DOMAIN_PROJECTION_NOT_ACTIVE'}, 503);
      try {
        const event = await verifyProjectionRequest(request, env.EVENT_PROJECTION_SHARED_SECRET);
        return json(await applyEventProjection(event, storeFor(env)));
      } catch (error) {return json({code: /^DOMAIN_[A-Z_]+$/.test(error.code || '') ? error.code : 'DOMAIN_SERVICE_UNAVAILABLE'},
        [400, 401, 403, 409, 413].includes(error.status) ? error.status : 503);}
    }
    const origin = request.headers.get('Origin');
    if (!origin || !String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).includes(origin)) return json({code: 'DOMAIN_ORIGIN_DENIED'}, 403);
    Object.assign(headers, {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Firebase-AppCheck'});
    if (path !== '/v1/session') return json({code: 'DOMAIN_NOT_FOUND'}, 404);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (request.method !== 'POST') return json({code: 'DOMAIN_METHOD_DENIED'}, 405);
    let phase = 'input';
    try {
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw fail('DOMAIN_INPUT_INVALID', 400);
      if (Number(request.headers.get('Content-Length')) > 1024) throw fail('DOMAIN_BODY_LIMIT', 413);
      const body = await boundedJson(request, 1024);
      if (!body || Array.isArray(body) || Object.keys(body).length) throw fail('DOMAIN_INPUT_INVALID', 400);
      phase = 'fa-session';
      const actor = await verify(request.headers.get('Authorization'), {apiKey: env.FA_PUBLIC_API_KEY, fetchImpl});
      if (env.MODULE_CUTOVER_ACTIVE !== 'true') throw fail('DOMAIN_MODULE_NOT_ACTIVE');
      phase = 'fa-access';
      // Check the central access gate under FA Security Rules, using the user's
      // own proof. Destination service accounts have no access to FA.
      const sourceName = `projects/${FA_PROJECT}/databases/(default)/documents/users/${actor.uid}`;
      const sourceHeaders = {Authorization: request.headers.get('Authorization')};
      const appCheck = request.headers.get('X-Firebase-AppCheck');
      if (appCheck) {
        if (appCheck.length > 16000 || /[\r\n]/.test(appCheck)) throw fail('DOMAIN_INPUT_INVALID', 400);
        sourceHeaders['X-Firebase-AppCheck'] = appCheck;
      }
      const sourceResponse = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${FA_PROJECT}/databases/(default)/documents/users/${encodeURIComponent(actor.uid)}`, {
        headers: sourceHeaders, redirect: 'manual', signal: AbortSignal.timeout(15000)
      });
      if ([401, 403, 404].includes(sourceResponse.status)) {
        await sourceResponse.body?.cancel(); throw fail('DOMAIN_SOURCE_ACCESS_DENIED', 403);
      }
      const sourceDocument = await boundedJson(sourceResponse, 65536);
      if (!sourceResponse.ok) throw fail('DOMAIN_SOURCE_UNAVAILABLE');
      const sourceProfile = decodeFields(sourceDocument.fields || {});
      if (sourceDocument.name !== sourceName || sourceProfile.uid !== actor.uid ||
          String(sourceProfile.email || '').toLowerCase() !== actor.email ||
          sourceProfile.active !== true || sourceProfile.access !== true) throw fail('DOMAIN_SOURCE_ACCESS_DENIED', 403);
      phase = 'target-service';
      let credentials; try { credentials = JSON.parse(env.MODULE_SERVICE_ACCOUNT_JSON || 'null'); } catch { throw fail('DOMAIN_CONFIG_REQUIRED'); }
      const service = createService(credentials, station, {fetchImpl});
      phase = 'local-profile';
      const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(actor.uid)}`, {
        headers: {Authorization: 'Bearer ' + await service.accessToken()}, redirect: 'manual', signal: AbortSignal.timeout(15000)
      });
      if (response.status === 404) { await response.body?.cancel(); throw fail('DOMAIN_FORBIDDEN', 403); }
      const document = await boundedJson(response, 65536);
      if (!response.ok) throw fail('DOMAIN_STORE_UNAVAILABLE');
      if (!canEnterModule(decodeFields(document.fields || {}), actor, station)) throw fail('DOMAIN_FORBIDDEN', 403);
      phase = 'custom-token';
      return json({station, projectId, uid: actor.uid, customToken: service.customToken(actor), expiresIn: MODULE_LEASE_SECONDS});
    } catch (error) {
      const code = /^DOMAIN_[A-Z_]+$/.test(error.code || '') ? error.code : 'DOMAIN_SERVICE_UNAVAILABLE';
      const status = [400, 401, 403, 409, 413, 429, 503].includes(error.status) ? error.status : 503;
      console.warn(JSON.stringify({station, route: 'session', phase, code, status,
        errorType: ['Error', 'TypeError', 'ReferenceError', 'RangeError'].includes(error.name) ? error.name : 'Error'}));
      return json({code}, status);
    }
  }};
}
export default createOperationalDomainWorker();
