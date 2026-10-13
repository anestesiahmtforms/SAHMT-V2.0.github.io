let pending = false;
let generation = 0;
let expectedUid = null;
const listeners = new Set();

export function isManagementFaFirstLoginPending() { return pending; }
export function getManagementFaFirstLoginGeneration() { return generation; }

export function expectManagementFaFirstLoginUid(uid) {
  if (typeof uid !== 'string' || !uid || uid.length > 128) throw new Error('FIRST_LOGIN_EXPECTED_UID_INVALID');
  expectedUid = uid;
}

/** Called by the FA auth observer; unrelated session transitions invalidate late responses. */
export function observeManagementFaFirstLoginAuthUid(uid) {
  if (pending && (uid || null) !== expectedUid) generation++;
}

export function setManagementFaFirstLoginPending(value) {
  if (typeof value !== 'boolean' || pending === value) return;
  pending = value;
  if (!value) expectedUid = null;
  for (const listener of [...listeners]) {
    try { listener(pending); } catch { /* session observers own their safe error handling */ }
  }
}

export function subscribeManagementFaFirstLoginPending(listener) {
  if (typeof listener !== 'function') throw new Error('FIRST_LOGIN_LISTENER_INVALID');
  listeners.add(listener);
  return () => listeners.delete(listener);
}
