const PROJECTS = Object.freeze({FI: 'sahmt-operacional-fi', FJ: 'sahmt-escala-fj', FH: 'sahmt-etiquetas-fh', FG: 'sahmt-checklist-fg'});
const fail = code => Object.assign(new Error(code), {code});

/** Sessions stay in memory and are serialized so a late SDK signin cannot
 * replace or sign out the destination session for a newer FA account. */
export function createOperationalModuleSession({station, faAuth, targetAuth, subscribeSource,
  exchange, signIn, signOut, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  timeoutMs = 20000} = {}) {
  const projectId = PROJECTS[station];
  if (!projectId || targetAuth?.app?.options?.projectId !== projectId || !faAuth ||
      [subscribeSource, exchange, signIn, signOut, now, setTimer, clearTimer].some(value => typeof value !== 'function') ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw fail('MODULE_SESSION_CONFIG_INVALID');
  let disposed = false, active = true, generation = 0, observedSource = faAuth.currentUser;
  let boundSource = null, boundUser = null, leaseUntil = 0, renewal, pending, tail = Promise.resolve();
  const controllers = new Set();
  const enqueue = operation => {const work = tail.then(operation); tail = work.catch(() => {}); return work;};
  const clearLease = () => {leaseUntil = 0; boundUser = null; boundSource = null; clearTimer(renewal); renewal = null;};
  const clearTarget = async () => {if (targetAuth.currentUser) await signOut(targetAuth);};
  const reconcileSource = () => {
    if (observedSource === faAuth.currentUser) return;
    observedSource = faAuth.currentUser; generation++; clearLease();
    for (const controller of controllers) controller.abort();
    // Cleanup is queued before any connection requested by the new account.
    void enqueue(clearTarget).catch(() => {});
  };
  const unsubscribe = subscribeSource(reconcileSource);

  const ensure = (uid, {force = false} = {}) => {
    reconcileSource();
    const source = faAuth.currentUser, owner = generation;
    if (disposed) return Promise.reject(fail('MODULE_SESSION_DISPOSED'));
    if (!active) return Promise.reject(fail('MODULE_SESSION_INACTIVE'));
    if (!source || typeof uid !== 'string' || !uid || uid !== source.uid) return Promise.reject(fail('MODULE_SOURCE_SESSION_REQUIRED'));
    if (!force && boundSource === source && boundUser === targetAuth.currentUser && boundUser?.uid === uid && leaseUntil > now() + 30000)
      return Promise.resolve(boundUser);
    if (pending?.source === source && pending.generation === owner) return pending.promise;
    const controller = new AbortController(); controllers.add(controller);
    let timer, timedOut = false;
    const live = () => active && !disposed && !timedOut && owner === generation && faAuth.currentUser === source;
    const assertLive = () => {if (!live()) throw fail('MODULE_SOURCE_SESSION_CHANGED');};
    const work = enqueue(async () => {
      let signedUser;
      try {
        assertLive();
        if (targetAuth.currentUser && targetAuth.currentUser.uid !== uid) await clearTarget();
        assertLive();
        const faIdToken = await source.getIdToken(); assertLive();
        const credential = await exchange({faIdToken, faUid: uid, signal: controller.signal}); assertLive();
        if (credential?.uid !== uid || typeof credential.customToken !== 'string' || !credential.customToken ||
            credential.expiresIn !== 300) throw fail('MODULE_SESSION_INVALID');
        const signed = await signIn(targetAuth, credential.customToken); signedUser = signed?.user; assertLive();
        if (!signedUser || signedUser.uid !== uid || targetAuth.currentUser !== signedUser) throw fail('MODULE_SESSION_INVALID');
        const result = await signedUser.getIdTokenResult(false); assertLive();
        const claims = result?.claims, expiry = claims?.moduleLeaseExpiresAt;
        if (claims?.aud !== projectId || claims?.sub !== uid || claims?.sourceProjectId !== 'sahmt-17a16' ||
            claims?.moduleStation !== station || claims?.firebase?.sign_in_provider !== 'custom' ||
            !Number.isSafeInteger(expiry) || expiry * 1000 <= now() + 30000 || expiry * 1000 > now() + 330000)
          throw fail('MODULE_SESSION_INVALID');
        clearLease(); boundSource = source; boundUser = signedUser; leaseUntil = expiry * 1000;
        renewal = setTimer(() => {
          if (!live() || boundUser !== signedUser) return;
          return ensure(uid, {force: true}).catch(() => {});
        }, Math.max(1000, leaseUntil - now() - 60000));
        return signedUser;
      } catch (error) {
        clearLease();
        // The serial queue prevents this cleanup from reaching a newer signin.
        if (targetAuth.currentUser) {try {await clearTarget();} catch {}}
        throw fail(/^MODULE_[A-Z_]+$/.test(error?.code || '') ? error.code : 'MODULE_SESSION_UNAVAILABLE');
      }
    });
    const timeout = new Promise((_, reject) => {timer = setTimer(() => {
      timedOut = true; clearLease(); controller.abort(); reject(fail('MODULE_SESSION_TIMEOUT'));
    }, timeoutMs);});
    const record = {source, generation: owner};
    record.promise = Promise.race([work, timeout]).finally(() => {
      clearTimer(timer); controllers.delete(controller); if (pending === record) pending = null;
    });
    pending = record;
    return record.promise;
  };
  return Object.freeze({ensure, isActive: () => active && !disposed, setActive(value) {
    if (typeof value !== 'boolean') throw fail('MODULE_SESSION_ACTIVITY_INVALID');
    if (disposed || value === active) return Promise.resolve();
    active = value;
    if (active) return Promise.resolve();
    generation++; clearLease();
    for (const controller of controllers) controller.abort();
    // Use the same queue as signin: cleanup must finish before reentry.
    return enqueue(clearTarget);
  }, async dispose() {
    if (!disposed) {
      disposed = true; generation++; clearLease(); unsubscribe?.();
      for (const controller of controllers) controller.abort();
    }
    await enqueue(clearTarget);
  }});
}
