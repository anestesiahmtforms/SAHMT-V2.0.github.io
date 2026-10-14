const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

/** Targets are only a client-side request hint; the broker reauthorizes each one. */
export function managementProjectAuthTargets(profile) {
  if (!plain(profile) || profile.active !== true || profile.access !== true) return Object.freeze([]);
  const permissions = plain(profile.permissions) ? profile.permissions : {};
  const targets = [];
  // FB remains permission-scoped. FC is also needed by the Occurrences
  // workflow, whose write permission is granted by server policy to every
  // active and accessible FA profile. The broker independently revalidates.
  if (['managementRead', 'managementManage', 'trainingsRead', 'trainingsManage'].some(key => permissions[key] === true)) targets.push('FB');
  if (profile.active === true && profile.access === true
    || permissions.managementIndicatorsRead === true || permissions.managementIndicatorsWrite === true) targets.push('FC');
  return Object.freeze(targets);
}

/** Non-blocking, per-user coordinator for opt-in background secondary sessions. */
export function createManagementProjectAuthAutoConnector({enabled = false, loadConnect, isCurrent} = {}) {
  if (typeof enabled !== 'boolean' || typeof loadConnect !== 'function' || typeof isCurrent !== 'function')
    throw new Error('MANAGEMENT_PROJECT_AUTH_AUTO_CONNECT_CONFIG_INVALID');
  let generation = 0, currentKey = null, currentPromise = null, lastRequest = null;

  const update = ({uid, profile} = {}) => {
    lastRequest = uid ? {uid, profile} : null;
    const targets = managementProjectAuthTargets(profile);
    if (!enabled || typeof uid !== 'string' || !uid || targets.length === 0) {
      generation++; currentKey = null; currentPromise = null;
      return Promise.resolve(Object.freeze({status: enabled ? 'skipped' : 'disabled'}));
    }
    const key = uid + ':' + targets.join(',');
    if (key === currentKey && currentPromise) return currentPromise;
    const attempt = ++generation;
    currentKey = key;
    currentPromise = Promise.resolve().then(async () => {
      if (!isCurrent(uid)) return Object.freeze({status: 'stale'});
      const connect = await loadConnect();
      if (typeof connect !== 'function') throw new Error('MANAGEMENT_PROJECT_AUTH_CONNECT_UNAVAILABLE');
      if (attempt !== generation || !isCurrent(uid)) return Object.freeze({status: 'stale'});
      const result = await connect(targets);
      if (attempt !== generation || !isCurrent(uid)) return Object.freeze({status: 'stale'});
      return result && typeof result === 'object' ? result : Object.freeze({status: 'unavailable'});
    }).catch(() => Object.freeze({status: 'unavailable'}));
    return currentPromise;
  };

  return Object.freeze({
    update,
    retry() {
      const request = lastRequest;
      generation++; currentKey = null; currentPromise = null;
      return request ? update(request) : Promise.resolve(Object.freeze({status: enabled ? 'skipped' : 'disabled'}));
    },
    invalidate() { generation++; currentKey = null; currentPromise = null; lastRequest = null; }
  });
}
