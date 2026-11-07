import {deployment} from './deployment-context.js';
import {FIREBASE_PROJECTS, normalizeFirebaseWebConfig, resolveFirebaseProjectApp} from './firebase-projects.js';
import {OPERATIONAL_MODULE_TARGETS, createOperationalModuleExchange} from './operational-module-broker.js';
import {createOperationalModuleSession} from './operational-module-session.js';

const env = import.meta.env || {};
const instances = new Map();
// Only the deployment configuration can choose these destinations.
export const operationalModuleEnabled = station => deployment.target === 'FA' &&
  (station === 'FI' ? env.VITE_FI_EVENTS_ENABLED === 'true' : station === 'FJ' ? env.VITE_FJ_SCHEDULE_ENABLED === 'true' : station === 'FH' && env.VITE_FH_LABELS_ENABLED === 'true');

async function getInstance(station) {
  if (!operationalModuleEnabled(station)) throw Object.assign(new Error('MODULE_DISABLED'), {code: 'MODULE_DISABLED'});
  if (!instances.has(station)) {
    const pending = (async () => {
      const [apps, authSdk, {auth: faAuth}, {appCheckReady}] = await Promise.all([
        import('firebase/app'), import('firebase/auth'), import('./firebase-auth.js'), import('./firebase-app.js')
      ]);
      if (!faAuth || faAuth.app.options.projectId !== FIREBASE_PROJECTS.FA.projectId) throw new Error('MODULE_SOURCE_CONFIG_INVALID');
      const target = OPERATIONAL_MODULE_TARGETS[station];
      const config = normalizeFirebaseWebConfig(target.config, station);
      const app = resolveFirebaseProjectApp({target: station, enabled: true, config,
        getApps: apps.getApps, initializeApp: apps.initializeApp});
      let auth;
      try {auth = authSdk.initializeAuth(app, {persistence: authSdk.inMemoryPersistence});}
      catch (error) {
        if (error.code !== 'auth/already-initialized') throw error;
        auth = authSdk.getAuth(app); await authSdk.setPersistence(auth, authSdk.inMemoryPersistence);
      }
      const exchange = createOperationalModuleExchange({station, getAppCheckToken: async () => {
        const appCheck = await appCheckReady; if (!appCheck) return null;
        const {getToken} = await import('firebase/app-check');
        return (await getToken(appCheck)).token;
      }});
      const session = createOperationalModuleSession({station, faAuth, targetAuth: auth,
        subscribeSource: listener => authSdk.onAuthStateChanged(faAuth, listener),
        exchange, signIn: authSdk.signInWithCustomToken, signOut: authSdk.signOut});
      return {app, auth, faAuth, session};
    })();
    instances.set(station, pending);
    pending.catch(() => {if (instances.get(station) === pending) instances.delete(station);});
  }
  return instances.get(station);
}

/** Failure to enter a migrated module never falls back to the FA database. */
export async function getOperationalModuleDatabase(station, uid, {realtime = false} = {}) {
  const instance = await getInstance(station);
  const expectedUid = uid || instance.faAuth.currentUser?.uid;
  await instance.session.ensure(expectedUid);
  const sdk = realtime ? await import('firebase/firestore') : await import('firebase/firestore/lite');
  if (instance.faAuth.currentUser?.uid !== expectedUid || instance.auth.currentUser?.uid !== expectedUid)
    throw Object.assign(new Error('MODULE_SOURCE_SESSION_CHANGED'), {code: 'MODULE_SOURCE_SESSION_CHANGED'});
  return sdk.getFirestore(instance.app);
}

export async function getOperationalModuleIdToken(station, uid) {
  const instance = await getInstance(station);
  const expectedUid = uid || instance.faAuth.currentUser?.uid;
  const user = await instance.session.ensure(expectedUid);
  const token = await user.getIdToken();
  if (instance.faAuth.currentUser?.uid !== expectedUid || instance.auth.currentUser !== user)
    throw Object.assign(new Error('MODULE_SOURCE_SESSION_CHANGED'), {code: 'MODULE_SOURCE_SESSION_CHANGED'});
  return token;
}

export async function disposeOperationalModuleSessions() {
  const current = [...instances.values()]; instances.clear();
  await Promise.allSettled(current.map(async pending => (await pending).session.dispose()));
}
