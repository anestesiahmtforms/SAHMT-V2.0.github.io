import {FIREBASE_PROJECTS} from './firebase-projects.js';

const TARGETS = Object.freeze(['FB', 'FC']);

/**
 * Best-effort lifecycle for already initialized secondary Firebase Auth
 * instances. It never creates apps or Auth instances and never touches FA.
 */
export function createFirebaseSecondarySessionLifecycle({listApps, getExistingAuth, signOut} = {}) {
  if (typeof listApps !== 'function' || typeof getExistingAuth !== 'function' || typeof signOut !== 'function')
    throw new Error('SECONDARY_SESSION_LIFECYCLE_CONFIG_INVALID');

  let generation = 0;
  let disposed = false;
  const pendingByAuth = new WeakMap();

  const collect = () => {
    const apps = listApps();
    return TARGETS.flatMap(name => {
      const project = FIREBASE_PROJECTS[name];
      const app = apps.find(item => item?.name === project.appName
        && item?.options?.projectId === project.projectId);
      if (!app) return [];
      const auth = getExistingAuth(app);
      const user = auth?.currentUser;
      return auth && user ? [{name, auth, user}] : [];
    });
  };

  const cleanup = async ({keepUid, expectedGeneration, all = false} = {}) => {
    if (disposed) return Object.freeze({status: 'disposed', cleared: Object.freeze([]), failed: Object.freeze([])});
    const owner = expectedGeneration ?? ++generation;
    const cleared = [], failed = [];
    await Promise.all(collect().map(async ({name, auth, user}) => {
      if (!all && user.uid === keepUid) return;
      // Account changes during an earlier cleanup invalidate its remaining
      // work. A target session that changed after the snapshot is never signed out.
      if (disposed || owner !== generation || auth.currentUser !== user) return;
      try {
        const pending = pendingByAuth.get(auth);
        if (pending?.user === user) await pending.promise;
        else {
          const operation = Promise.resolve().then(() => {
            if (disposed || auth.currentUser !== user) return;
            return signOut(auth);
          });
          const record = {user, promise: operation};
          pendingByAuth.set(auth, record);
          try { await operation; }
          finally { if (pendingByAuth.get(auth) === record) pendingByAuth.delete(auth); }
        }
        if (auth.currentUser === null) cleared.push(name);
        else failed.push(name);
      } catch {
        failed.push(name);
      }
    }));
    return Object.freeze({status: failed.length ? 'partial' : 'complete',
      cleared: Object.freeze(cleared), failed: Object.freeze(failed)});
  };

  return Object.freeze({
    reconcileForFaUid(uid) {
      if (uid !== null && (typeof uid !== 'string' || !uid || uid.length > 128))
        return Promise.resolve(Object.freeze({status: 'invalid-context', cleared: Object.freeze([]), failed: Object.freeze([])}));
      const owner = ++generation;
      return cleanup({keepUid: uid, expectedGeneration: owner});
    },
    signOutAll() {
      const owner = ++generation;
      return cleanup({all: true, expectedGeneration: owner});
    },
    dispose() { disposed = true; generation++; }
  });
}

let runtimeLifecyclePromise;
function getRuntimeLifecycle() {
  if (!runtimeLifecyclePromise) {
    runtimeLifecyclePromise = Promise.all([import('firebase/app'), import('firebase/auth')]).then(([appSdk, authSdk]) =>
      createFirebaseSecondarySessionLifecycle({
        listApps: appSdk.getApps,
        // getImmediate(optional) only returns an Auth provider that has already
        // been initialized by the owning feature; it does not initialize Auth.
        getExistingAuth: app => app.container?.getProvider('auth-internal')?.getImmediate({optional: true}) ?? null,
        signOut: authSdk.signOut
      })).catch(error => { runtimeLifecyclePromise = null; throw error; });
  }
  return runtimeLifecyclePromise;
}

export async function reconcileFirebaseSecondarySessions(faUid) {
  try { return await (await getRuntimeLifecycle()).reconcileForFaUid(faUid); }
  catch { return Object.freeze({status: 'unavailable', cleared: Object.freeze([]), failed: Object.freeze(['FB', 'FC'])}); }
}

export async function signOutFirebaseSecondarySessions() {
  try { return await (await getRuntimeLifecycle()).signOutAll(); }
  catch { return Object.freeze({status: 'unavailable', cleared: Object.freeze([]), failed: Object.freeze(['FB', 'FC'])}); }
}

/** Run primary and secondary logout independently; never let FB/FC block FA. */
export async function signOutAllFirebaseProjects({signOutPrimary, signOutSecondary = signOutFirebaseSecondarySessions} = {}) {
  if (typeof signOutPrimary !== 'function' || typeof signOutSecondary !== 'function') return false;
  const results = await Promise.allSettled([Promise.resolve().then(signOutPrimary), Promise.resolve().then(signOutSecondary)]);
  return results.every(result => result.status === 'fulfilled') && results[1].value?.status === 'complete';
}
