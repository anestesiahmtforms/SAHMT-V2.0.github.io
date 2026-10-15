import {buildManagementAuthRuntime,MANAGEMENT_RUNTIME_DEFAULTS} from './runtime.js';
import {relayOperationalSheet} from './operational-sheet-relay.js';
import {relayOccurrenceScore} from './occurrence-score-relay.js';
import {createManagementBrokerHttp} from '../scripts/lib/management-broker-http.js';
import {createManagementFaFirstLoginHttp} from '../scripts/lib/management-fa-first-login-http.js';
import {ManagementBrokerAdmissionState, createManagementAuthWorkerRuntime as createAdmissionRuntime} from './admission-state.js';
import {createManagementAppsScriptGatewayFromEnv} from './apps-script-gateway-adapter.js';
export {ManagementBrokerAdmissionState, createAdmissionRuntime as createManagementAuthWorkerRuntime};
export {createManagementAppsScriptGatewayFromEnv} from './apps-script-gateway-adapter.js';

const disabled = createManagementBrokerHttp({enabled: false});

/** Dedicated Worker entrypoint. Runtime adapters are supplied only by trusted host code. */
export function createManagementAuthWorker({buildRuntime,buildOperationalRuntime} = {}) {
  const runtimes = new WeakMap();
  const handlers = new WeakMap();
  const firstLoginHandlers = new WeakMap();
  const operationalRuntimes = new WeakMap();
  const operationalFor = env => {
    if(typeof buildOperationalRuntime!=='function')return runtimeFor(env);
    if(!operationalRuntimes.has(env))operationalRuntimes.set(env,Promise.resolve().then(()=>buildOperationalRuntime(env)).catch(error=>{operationalRuntimes.delete(env);throw error;}));
    return operationalRuntimes.get(env);
  };
  const runtimeFor = env => {
    if (!env || (typeof env !== 'object' && typeof env !== 'function') || typeof buildRuntime !== 'function')
      return Promise.reject(new Error('WORKER_RUNTIME_UNAVAILABLE'));
    if (!runtimes.has(env)) {
      const pending = Promise.resolve().then(() => buildRuntime(env)).then(runtime => {
        if (!runtime || runtime.enabled !== true || !runtime.broker
          || typeof runtime.broker.exchange !== 'function'
          || typeof runtime.admitRequest !== 'function' || typeof runtime.superviseExchange !== 'function'
          || runtime.firstLoginEnabled !== undefined && typeof runtime.firstLoginEnabled !== 'boolean'
          || runtime.firstLoginEnabled === true && typeof runtime.firstLoginBroker?.claim !== 'function'
          || !Number.isSafeInteger(runtime.maxRequestMs) || runtime.maxRequestMs < 1 || runtime.maxRequestMs > 120000
          || !Number.isSafeInteger(runtime.cleanupDrainMs) || runtime.cleanupDrainMs < 1 || runtime.cleanupDrainMs > 30000)
          throw new Error('WORKER_RUNTIME_INVALID');
        const handler = createManagementBrokerHttp(runtime);
        handlers.set(env, handler);
        firstLoginHandlers.set(env, createManagementFaFirstLoginHttp({enabled:runtime.firstLoginEnabled === true,
          broker:runtime.firstLoginBroker, admitRequest:runtime.admitRequest, superviseRequest:runtime.superviseExchange,
          maxRequestMs:Math.min(runtime.maxRequestMs,25000), cleanupDrainMs:Math.min(runtime.cleanupDrainMs,5000),
          wallClock:typeof runtime.wallClock === 'function' ? runtime.wallClock : Date.now}));
        return runtime;
      });
      runtimes.set(env, pending);
      pending.catch(() => { if (runtimes.get(env) === pending) runtimes.delete(env); });
    }
    return runtimes.get(env);
  };

  return Object.freeze({
    async fetch(request, env, context) {
      if (new URL(request.url).pathname === '/v1/evaluation/occurrence') {
        if (env?.OCCURRENCE_SCORING_ENABLED !== 'true' || request.method !== 'POST') return relayOccurrenceScore(request, env || {});
        try {
          const runtime = await operationalFor(env);
          if (runtime.maxRequestMs < 55000) return relayOccurrenceScore(request, env);
          return await relayOccurrenceScore(request, env, {admitRequest: runtime.admitRequest});
        } catch { return relayOccurrenceScore(request, env); }
      }
      if (new URL(request.url).pathname === '/v1/operational-sheets/notify')
        return relayOperationalSheet(request, env);
      if(env?.MANAGEMENT_SECONDARY_AUTH_RETIRED==='true'&&new URL(request.url).pathname!=='/v1/auth/first-login')return disabled(request);
      try {
        await runtimeFor(env);
        const url = new URL(request.url);
        if (url.pathname === '/v1/auth/first-login') return await firstLoginHandlers.get(env)(request, env, context);
        return await handlers.get(env)(request, env, context);
      } catch {
        // No configuration or adapter detail reaches the public endpoint.
        return disabled(request);
      }
    }
  });
}

/**
 * Local composition point: inject a server-only broker factory, then wire it to
 * the SQLite admission binding and the fixed HTTP handler. This never discovers
 * credentials from the browser and is not used by the disabled default export.
 */
export function createManagementAuthWorkerWithBroker({buildBroker, buildFirstLoginBroker, firstLoginEnabled = false, now = Date.now,
  newSlotId, maxConcurrent = 8, maxRequestMs = 20000, cleanupDrainMs = 5000} = {}) {
  if (typeof buildBroker !== 'function' || typeof firstLoginEnabled !== 'boolean'
    || firstLoginEnabled && typeof buildFirstLoginBroker !== 'function') throw new Error('WORKER_BROKER_FACTORY_REQUIRED');
  return createManagementAuthWorker({buildRuntime: async env => {
    const managementGateway = createManagementAppsScriptGatewayFromEnv({env, stateBinding:env?.BROKER_STATE, now});
    // This second argument is server-only. Existing factories may ignore it;
    // reviewed factories can pass it to the privileged auth adapter and FA
    // first-login broker without exposing any binding to the browser.
    const broker = await buildBroker(env, Object.freeze({managementGateway, privilegedGateway:managementGateway,
      managementPolicyVersion:managementGateway.managementPolicyVersion}));
    const runtime = createAdmissionRuntime({broker, stateBinding:env?.BROKER_STATE, now,
      ...(newSlotId === undefined ? {} : {newSlotId}), maxConcurrent, maxRequestMs, cleanupDrainMs});
    return {...runtime, firstLoginEnabled,
      ...(firstLoginEnabled ? {firstLoginBroker:await buildFirstLoginBroker(env,
        Object.freeze({managementGateway, privilegedGateway:managementGateway,
          managementPolicyVersion:managementGateway.managementPolicyVersion}))} : {})};
  }});
}

// The runtime is complete but only explicit, validated server bindings can enable it.
const worker = createManagementAuthWorker({buildRuntime:buildManagementAuthRuntime,
  buildOperationalRuntime:env=>createAdmissionRuntime({broker:{exchange:async()=>({ok:false,code:'SECONDARY_AUTH_RETIRED'})},
    stateBinding:env?.BROKER_STATE,...MANAGEMENT_RUNTIME_DEFAULTS})});
export default worker;
