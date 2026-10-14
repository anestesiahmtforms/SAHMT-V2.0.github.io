import {createFirebaseProjectAuthOptIn} from './firebase-project-auth-optin.js';
import {registerManagementPilotAuth, beginManagementPilotConnect, finishManagementPilotConnect} from './management-pilot-auth-diagnostics.js';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const enabled = env.VITE_FIREBASE_PROJECT_AUTH_ENABLED === 'true';
const configuredTargets = Object.freeze({
  FB: env.VITE_MANAGEMENT_FIREBASE_ENABLED === 'true',
  FC: env.VITE_INDICATORS_FIREBASE_ENABLED === 'true'
});
const defaultTargets = Object.freeze(Object.keys(configuredTargets).filter(name => configuredTargets[name]));
// Apps Script performs separate authenticated round trips for lookup, lease and signing.
// Keep their wait in the background without changing the reusable libraries' defaults.
const SECONDARY_AUTH_TIMEOUT_MS = 90000;

let instance;
export function getFirebaseProjectAuthOptIn() {
  if (instance) return instance;
  if (!defaultTargets.length) return instance = createFirebaseProjectAuthOptIn({enabled: false});
  const endpoint = env.VITE_FIREBASE_PROJECT_AUTH_ENDPOINT?.trim() || '';
  const allowedOrigin = env.VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN?.trim() || '';
  let endpointOrigin = '';
  try { endpointOrigin = new URL(endpoint).origin; } catch {}
  instance = createFirebaseProjectAuthOptIn({enabled: enabled && Boolean(allowedOrigin) && endpointOrigin === allowedOrigin,
    runtimeKey: () => 'secondary-projects', loadRuntime: async () => {
    const names = [...defaultTargets];
    const [fa, authSdk, fb, fc, {createFirebaseProjectAuthCoordinator}, {createFirebaseProjectBrokerTransport}] = await Promise.all([
      import('./firebase-auth.js'), import('firebase/auth'),
      names.includes('FB') ? import('./management-firebase-app.js').catch(() => null) : null,
      names.includes('FC') ? import('./indicators-firebase-app.js').catch(() => null) : null,
      import('./firebase-project-auth.js'), import('./firebase-project-broker-transport.js')
    ]);
    if (!fa.auth) throw new Error('FA_AUTH_NOT_READY');
    const targets = {}, unavailable = {};
    const markUnavailable = name => { unavailable[name] = Object.freeze({status: 'unavailable', code: 'TARGET_AUTH_UNAVAILABLE'}); };
    if (names.includes('FB')) {
      try {
        const fbApp = fb?.getManagementApp();
        if (!fbApp) throw new Error('FB_AUTH_NOT_READY');
        let fbAuth;
        try { fbAuth = authSdk.initializeAuth(fbApp, {persistence: authSdk.inMemoryPersistence}); }
        catch (error) {
          if (error?.code !== 'auth/already-initialized') throw error;
          fbAuth = authSdk.getAuth(fbApp);
        }
        if (!fbAuth) throw new Error('FB_AUTH_NOT_READY');
        targets.FB = {auth: fbAuth, signOut: authSdk.signOut};
        if (env.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true') registerManagementPilotAuth('FB', fbAuth, authSdk.onAuthStateChanged);
      } catch { markUnavailable('FB'); }
    }
    if (names.includes('FC')) {
      try {
        const fcAuth = fc?.getIndicatorsAuth();
        if (!fcAuth) throw new Error('FC_AUTH_NOT_READY');
        targets.FC = {auth: fcAuth, signOut: authSdk.signOut};
        if (env.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true') registerManagementPilotAuth('FC', fcAuth, authSdk.onAuthStateChanged);
      } catch { markUnavailable('FC'); }
    }
    // Never request a token or a lease for a destination with no prepared Auth.
    const preparedNames = names.filter(name => targets[name]);
    const select = requestedNames => {
      const selected = Array.isArray(requestedNames) ? [...requestedNames] : [...names];
      if (!selected.length || new Set(selected).size !== selected.length || selected.some(name => !configuredTargets[name]))
        throw new Error('FIREBASE_PROJECT_TARGET_DISABLED');
      return selected;
    };
    if (!preparedNames.length) return Object.freeze({
      connect: async requestedNames => Object.freeze({status: 'blocked',
        targets: Object.freeze(Object.fromEntries(select(requestedNames).map(name => [name, unavailable[name]])))}), dispose() {}
    });
    const broker = createFirebaseProjectBrokerTransport({enabled: true, endpoint,
      timeoutMs: SECONDARY_AUTH_TIMEOUT_MS,
      allowedOrigins: [allowedOrigin], fetchImpl: globalThis.fetch?.bind(globalThis)});
    const coordinator = createFirebaseProjectAuthCoordinator({enabled: true, faAuth: fa.auth,
      timeoutMs: SECONDARY_AUTH_TIMEOUT_MS,
      targets, targetNames: preparedNames, broker, signInWithCustomToken: authSdk.signInWithCustomToken});
    return Object.freeze({async connect(requestedNames) {
      const selected = select(requestedNames), available = selected.filter(name => targets[name]);
      if (!available.length) return Object.freeze({status: 'blocked',
        targets: Object.freeze(Object.fromEntries(selected.map(name => [name, unavailable[name]])))});
      const result = await coordinator.connect(available);
      if (available.length === selected.length) return result;
      return Object.freeze({...result, status: result.status === 'ready' ? 'partial' : result.status,
        targets: Object.freeze({...Object.fromEntries(selected.filter(name => unavailable[name]).map(name => [name, unavailable[name]])), ...result.targets})});
    }, dispose() { coordinator.dispose(); broker.dispose(); }});
  }});
  const connect = instance.connect;
  instance = Object.freeze({...instance, connect: async targetNames => {
    const attempt = env.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true' ? beginManagementPilotConnect() : null;
    const result = await connect(Array.isArray(targetNames) ? targetNames : defaultTargets);
    if (env.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true') finishManagementPilotConnect(attempt, result);
    return result;
  }});
  return instance;
}

