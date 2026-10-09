// Preparation only. Firebase, transport, storage and UI are owned by future adapters.
// No tokens, SDK users, profiles or raw errors are exposed through session state.
const FA_PROJECT = 'sahmt-17a16';
const FB_PROJECT = 'sahmt-gestao-5ae66';
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s/\x00-\x1f]/.test(value);
const milliseconds = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => value ? {faUid: value.faUid, fbUid: value.fbUid, memberId: value.memberId, sourceProjectId: value.sourceProjectId, destinationProjectId: value.destinationProjectId} : null;
const faContext = value => value ? {
  restored: value.restored === true, online: value.online === true,
  user: value.user ? {uid: value.user.uid} : null,
  profile: value.profile ? {uid: value.profile.uid, memberId: value.profile.memberId, active: value.profile.active, access: value.profile.access} : null,
  managementAllowed: value.managementAllowed === true,
  fromCache: value.fromCache, hasPendingWrites: value.hasPendingWrites,
  binding: identity(value.binding)
} : null;
const fbContext = value => value ? {
  restored: value.restored === true, user: value.user ? {uid: value.user.uid} : null,
  mirror: value.mirror ? {
    ...identity(value.mirror), active: value.mirror.active,
    managementAllowed: value.mirror.managementAllowed,
    confirmedAtMs: value.mirror.confirmedAtMs, validUntilMs: value.mirror.validUntilMs,
    fromCache: value.mirror.fromCache, hasPendingWrites: value.mirror.hasPendingWrites
  } : null
} : null;

function validBinding(binding, uid, memberId) {
  return identifier(uid) && uid.length <= 128 && identifier(memberId)
    && binding?.sourceProjectId === FA_PROJECT && binding?.destinationProjectId === FB_PROJECT
    && binding.faUid === uid && binding.fbUid === uid && binding.memberId === memberId;
}

function sourceIssue(fa) {
  if (fa?.restored !== true) return 'FA_RESTORATION_PENDING';
  if (!fa.user) return 'FA_SIGNED_OUT';
  if (fa.online !== true) return 'FA_OFFLINE';
  if (!fa.profile) return 'FA_PROFILE_MISSING';
  if (fa.fromCache !== false || fa.hasPendingWrites !== false) return 'FA_PROFILE_NOT_CONFIRMED';
  if (fa.profile.uid !== fa.user.uid || !identifier(fa.user.uid)) return 'FA_IDENTITY_MISMATCH';
  if (fa.profile.active !== true || fa.profile.access !== true) return 'FA_PROFILE_REVOKED';
  if (fa.managementAllowed !== true) return 'FA_MANAGEMENT_DENIED';
  if (!validBinding(fa.binding, fa.user.uid, fa.profile.memberId)) return 'IDENTITY_BINDING_INVALID';
  return null;
}

function managementIssue(fa, fb, time) {
  if (fb?.restored !== true) return 'FB_RESTORATION_PENDING';
  if (!fb.user) return 'FB_SESSION_MISSING';
  if (fb.user.uid !== fa.user.uid) return 'FB_UID_MISMATCH';
  if (!fb.mirror) return 'FB_MIRROR_MISSING';
  if (!validBinding(fb.mirror, fa.user.uid, fa.profile.memberId)) return 'FB_MIRROR_IDENTITY_MISMATCH';
  if (fb.mirror.fromCache !== false || fb.mirror.hasPendingWrites !== false) return 'FB_MIRROR_NOT_CONFIRMED';
  if (fb.mirror.active !== true || fb.mirror.managementAllowed !== true) return 'FB_MIRROR_REVOKED';
  if (!milliseconds(time) || !milliseconds(fb.mirror.confirmedAtMs) || !milliseconds(fb.mirror.validUntilMs)
    || fb.mirror.confirmedAtMs > time || fb.mirror.validUntilMs <= fb.mirror.confirmedAtMs) return 'FB_LEASE_INVALID';
  if (fb.mirror.validUntilMs <= time) return 'FB_LEASE_EXPIRED';
  return null;
}

/**
 * Local gate only: authoritative authorization belongs in FB Security Rules.
 * Contexts must come from fresh server-backed profile/binding/mirror adapters.
 * Adapters never receive tokens in URLs; exchangeFaToken receives an in-memory
 * request body, and signInFb receives the custom token directly in memory.
 */
export function createManagementSession({enabled = false, adapters = {}, now = Date.now, onState = () => {}, onInvalidate = () => {}, beforeSignOut = async () => true} = {}) {
  let fa = null, fb = null, epoch = 0, pending = null, leavingEpoch = null, mutationTail = Promise.resolve();
  let state = {status: enabled === true ? 'awaiting-restoration' : 'disabled', code: enabled === true ? 'RESTORATION_PENDING' : 'MANAGEMENT_DISABLED'};
  const current = expected => enabled === true && expected === epoch;
  const notifyInvalidation = reason => { try { onInvalidate(reason); } catch { /* A listener cannot undo invalidation. */ } };
  const invalidate = reason => { epoch++; pending = null; state = {status: 'blocked', code: 'SESSION_INVALIDATED'}; notifyInvalidation(reason); return epoch; };
  const emit = (status, code = null) => {
    state = {status, code};
    try { onState(snapshot()); } catch { /* State remains denied if a presenter fails. */ }
    return snapshot();
  };
  const contextIssue = () => sourceIssue(fa) || managementIssue(fa, fb, now());
  function snapshot() {
    const issue = enabled === true && state.status === 'ready' ? contextIssue() : null;
    if (issue) { state = {status: 'blocked', code: issue}; notifyInvalidation(issue); }
    return Object.freeze({
      ...state, ready: state.status === 'ready', epoch,
      faUid: identifier(fa?.user?.uid) ? fa.user.uid : null,
      fbUid: identifier(fb?.user?.uid) ? fb.user.uid : null,
      memberId: identifier(fa?.binding?.memberId) ? fa.binding.memberId : null,
      validUntilMs: state.status === 'ready' ? fb.mirror.validUntilMs : null
    });
  }
  const refresh = () => {
    if (enabled !== true) return emit('disabled', 'MANAGEMENT_DISABLED');
    if (leavingEpoch === epoch) return snapshot();
    const issue = contextIssue();
    if (!issue) return emit('ready');
    if (issue.endsWith('RESTORATION_PENDING')) return emit('awaiting-restoration', issue);
    if (issue === 'FA_SIGNED_OUT') return emit('signed-out', issue);
    if (issue === 'FB_SESSION_MISSING') return emit('needs-broker', 'BROKER_REQUIRED');
    return emit('blocked', issue);
  };
  const serialize = operation => {
    const result = mutationTail.then(operation);
    mutationTail = result.catch(() => {});
    return result;
  };
  const clearFb = async expectedUid => {
    if (typeof adapters.signOutFb !== 'function') throw new Error('SIGN_OUT_FB_UNAVAILABLE');
    await adapters.signOutFb({expectedUid});
  };

  async function restore() {
    if (enabled !== true) return snapshot();
    const requestEpoch = invalidate('restore');
    emit('restoring', 'RESTORATION_PENDING');
    if (typeof adapters.restoreFa !== 'function' || typeof adapters.restoreFb !== 'function') return emit('blocked', 'RESTORATION_ADAPTER_UNAVAILABLE');
    try {
      const [source, management] = await Promise.all([adapters.restoreFa(), adapters.restoreFb()]);
      if (!current(requestEpoch)) return snapshot();
      fa = faContext(source); fb = fbContext(management);
      return refresh();
    } catch {
      return current(requestEpoch) ? emit('blocked', 'RESTORATION_FAILED') : snapshot();
    }
  }

  function updateContext(value = {}) {
    if (enabled !== true) return snapshot();
    invalidate('context-changed');
    if (Object.hasOwn(value, 'fa')) fa = faContext(value.fa);
    if (Object.hasOwn(value, 'fb')) fb = fbContext(value.fb);
    return refresh();
  }

  async function establish(requestEpoch) {
    if (!current(requestEpoch)) return snapshot();
    let faIdToken = null, response = null;
    const expectedUid = fa.user.uid;
    const expectedBinding = {...fa.binding};
    try {
      faIdToken = await adapters.getFaIdToken({expectedUid, forceRefresh: true});
      if (!current(requestEpoch)) return snapshot();
      if (typeof faIdToken !== 'string' || !faIdToken.length) return emit('blocked', 'FA_TOKEN_UNAVAILABLE');
      response = await adapters.exchangeFaToken({faIdToken, ...expectedBinding});
      faIdToken = null;
      if (!current(requestEpoch)) return snapshot();
      if (!validBinding(response, expectedUid, expectedBinding.memberId)
        || typeof response.customToken !== 'string' || !response.customToken.length) return emit('blocked', 'BROKER_RESPONSE_INVALID');
      return await serialize(async () => {
        if (!current(requestEpoch)) return snapshot();
        let signedIn;
        try { signedIn = await adapters.signInFb({customToken: response.customToken, expectedUid}); }
        catch {
          try { await clearFb(expectedUid); }
          catch {
            invalidate('fb-cleanup-failed');
            fb = null;
            return emit('blocked', 'FB_CLEANUP_FAILED');
          }
          if (!current(requestEpoch)) {
            fb = {restored: false, user: null, mirror: null};
            return emit('blocked', 'FB_RECONCILIATION_REQUIRED');
          }
          fb = {restored: true, user: null, mirror: null};
          return emit('blocked', 'FB_SIGN_IN_FAILED');
        }
        // Serialized Auth mutations prevent old cleanup signing out a newer login.
        if (!current(requestEpoch)) {
          try {
            await clearFb(expectedUid);
            // This old mutation may have replaced the Auth session represented
            // by a newer snapshot. Require a fresh FB observation before reuse.
            fb = {restored: false, user: null, mirror: null};
            emit('blocked', 'FB_RECONCILIATION_REQUIRED');
          } catch {
            invalidate('fb-cleanup-failed');
            fb = null;
            emit('blocked', 'FB_CLEANUP_FAILED');
          }
          return snapshot();
        }
        const target = fbContext(signedIn);
        const issue = sourceIssue(fa) || managementIssue(fa, target, now());
        if (issue) {
          try { await clearFb(target?.user?.uid || expectedUid); } catch { return emit('blocked', 'FB_CLEANUP_FAILED'); }
          if (!current(requestEpoch)) return snapshot();
          fb = {restored: true, user: null, mirror: null};
          return emit('blocked', issue);
        }
        fb = target;
        return emit('ready');
      });
    } catch {
      return current(requestEpoch) ? emit('blocked', 'BROKER_EXCHANGE_FAILED') : snapshot();
    } finally { faIdToken = null; response = null; }
  }

  function connect() {
    if (enabled !== true) return Promise.resolve(snapshot());
    if (leavingEpoch === epoch) return Promise.resolve(snapshot());
    if (pending?.epoch === epoch) return pending.promise;
    const sourceFailure = sourceIssue(fa);
    if (sourceFailure || fb?.restored !== true) return Promise.resolve(refresh());
    const targetFailure = managementIssue(fa, fb, now());
    if (!targetFailure) return Promise.resolve(refresh());
    if (targetFailure === 'FB_UID_MISMATCH') {
      const requestEpoch = epoch, wrongUid = fb.user.uid;
      emit('blocked', targetFailure);
      return serialize(async () => {
        if (!current(requestEpoch)) return snapshot();
        try { await clearFb(wrongUid); }
        catch { return current(requestEpoch) ? emit('blocked', 'FB_CLEANUP_FAILED') : snapshot(); }
        if (current(requestEpoch)) fb = {restored: true, user: null, mirror: null};
        return snapshot();
      });
    }
    // A known expired/revoked mirror does not become permission through a retry.
    if (targetFailure !== 'FB_SESSION_MISSING') return Promise.resolve(refresh());
    if (typeof adapters.exchangeFaToken !== 'function') return Promise.resolve(emit('blocked', 'BROKER_UNAVAILABLE'));
    if (typeof adapters.getFaIdToken !== 'function' || typeof adapters.signInFb !== 'function' || typeof adapters.signOutFb !== 'function') return Promise.resolve(emit('blocked', 'AUTH_ADAPTER_UNAVAILABLE'));
    const requestEpoch = epoch;
    const promise = Promise.resolve().then(() => establish(requestEpoch)).finally(() => { if (pending?.epoch === requestEpoch) pending = null; });
    pending = {epoch: requestEpoch, promise};
    emit('connecting', 'BROKER_PENDING');
    return promise;
  }

  async function signOut() {
    if (enabled !== true) return {completed: false, cancelled: false, state: snapshot()};
    const requestEpoch = invalidate('logout');
    leavingEpoch = requestEpoch;
    const expectedFaUid = fa?.user?.uid || null, expectedFbUid = fb?.user?.uid || expectedFaUid;
    emit('signing-out', 'PENDING_ACTIONS_CHECK');
    let permitted;
    try { permitted = await beforeSignOut({faUid: expectedFaUid, fbUid: expectedFbUid}); }
    catch { if (leavingEpoch === requestEpoch) leavingEpoch = null; if (current(requestEpoch)) emit('blocked', 'PENDING_ACTIONS_CHECK_FAILED'); return {completed: false, cancelled: true, state: snapshot()}; }
    if (!current(requestEpoch)) return {completed: false, cancelled: true, state: snapshot()};
    if (permitted !== true) { if (leavingEpoch === requestEpoch) leavingEpoch = null; refresh(); return {completed: false, cancelled: true, state: snapshot()}; }
    return serialize(async () => {
      if (!current(requestEpoch)) return {completed: false, cancelled: true, state: snapshot()};
      const results = await Promise.allSettled([
        Promise.resolve().then(() => { if (typeof adapters.signOutFa !== 'function') throw new Error('SIGN_OUT_FA_UNAVAILABLE'); return adapters.signOutFa({expectedUid: expectedFaUid}); }),
        Promise.resolve().then(() => clearFb(expectedFbUid))
      ]);
      if (!current(requestEpoch)) return {completed: false, cancelled: true, state: snapshot()};
      if (results[0].status === 'fulfilled') fa = {restored: true, user: null};
      if (results[1].status === 'fulfilled') fb = {restored: true, user: null, mirror: null};
      const completed = results.every(result => result.status === 'fulfilled');
      if (leavingEpoch === requestEpoch) leavingEpoch = null;
      emit(completed ? 'signed-out' : 'blocked', completed ? 'SIGNED_OUT_BOTH' : 'SIGN_OUT_PARTIAL_FAILURE');
      return {completed, cancelled: false, state: snapshot()};
    });
  }

  return Object.freeze({restore, updateContext, connect, signOut, snapshot, refresh});
}
