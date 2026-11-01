import {relayQmentumWrite} from '../worker-management-auth/qmentum-write-relay.js';
import {relayQmentumPrints} from '../worker-management-auth/qmentum-print-relay.js';
import {relayOccurrenceScore} from '../worker-management-auth/occurrence-score-relay.js';
import {createManagementAuthWorkerRuntime, ManagementBrokerAdmissionState} from '../worker-management-auth/admission-state.js';

export {ManagementBrokerAdmissionState as FcIntegrationAdmissionState};
const routes = new Map([
  ['/v1/qmentum/write', relayQmentumWrite],
  ['/v1/qmentum/prints', relayQmentumPrints],
  ['/v1/evaluation/occurrence', relayOccurrenceScore]
]);
const disabledBroker = Object.freeze({exchange:async () => ({ok:false, code:'SECONDARY_AUTH_RETIRED'})});
const fail = (code, status, request) => Response.json({code}, {status, headers:{
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
  ...(request.headers.get('Origin') === 'https://anestesiahmtforms.github.io'
    ? {'Access-Control-Allow-Origin':'https://anestesiahmtforms.github.io', Vary:'Origin'} : {})
}});

/** Reuses the existing FC proof, authorization, HMAC, replay and idempotency contracts. */
export function createFcIntegrationWorker({fetchImpl = globalThis.fetch} = {}) {
  return Object.freeze({async fetch(request, env = {}) {
    const url = new URL(request.url), relay = routes.get(url.pathname);
    if (!relay || url.search) return fail('FC_INTEGRATION_ROUTE_NOT_FOUND', 404, request);
    if (request.method === 'OPTIONS') return relay(request, env, {fetchImpl});
    if (env.FC_INTEGRATION_ENABLED !== 'true') return fail('FC_INTEGRATION_DISABLED', 503, request);
    // The dedicated service must never fall back to the central Apps Script bindings.
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(env.FC_MODULE_SCRIPT_URL || ''))
      return fail('FC_INTEGRATION_CONFIG_REQUIRED', 503, request);
    try {
      const runtime = createManagementAuthWorkerRuntime({broker:disabledBroker, stateBinding:env.FC_ADMISSION,
        maxConcurrent:8, maxRequestMs:80000, cleanupDrainMs:10000});
      return await relay(request, env, {fetchImpl, admitRequest:runtime.admitRequest});
    } catch { return fail('FC_INTEGRATION_UNAVAILABLE', 503, request); }
  }});
}
export default createFcIntegrationWorker();
