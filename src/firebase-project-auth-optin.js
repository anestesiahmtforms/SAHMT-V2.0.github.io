/** Lazy, user-initiated bridge. A disabled coordinator never loads Firebase SDKs. */
export function createFirebaseProjectAuthOptIn({enabled = false, loadRuntime} = {}) {
  if (enabled !== true) return Object.freeze({enabled: false,
    connect: async () => Object.freeze({status: 'disabled'}), dispose: () => {}});
  if (typeof loadRuntime !== 'function') throw new Error('FIREBASE_PROJECT_AUTH_RUNTIME_INVALID');
  const runtimePromises = new Map(); let disposed = false;
  const connect = async (targetNames) => {
    if (disposed) return Object.freeze({status: 'unavailable', code: 'OPTIN_DISPOSED'});
    try {
      const key = Array.isArray(targetNames) ? [...targetNames].sort().join(',') : 'default';
      if (!runtimePromises.has(key)) runtimePromises.set(key, Promise.resolve().then(() => loadRuntime(targetNames))
        .catch(error => { runtimePromises.delete(key); throw error; }));
      const runtime = await runtimePromises.get(key);
      if (disposed) return Object.freeze({status: 'unavailable', code: 'OPTIN_DISPOSED'});
      if (typeof runtime?.connect !== 'function') throw new Error('FIREBASE_PROJECT_AUTH_RUNTIME_INVALID');
      return await runtime.connect(targetNames);
    } catch { return Object.freeze({status: 'unavailable', code: 'OPTIN_UNAVAILABLE'}); }
  };
  return Object.freeze({enabled: true, connect, dispose() {
    disposed = true;
    for (const pending of runtimePromises.values()) void pending.then(runtime => runtime?.dispose?.()).catch(() => {});
  }});
}
