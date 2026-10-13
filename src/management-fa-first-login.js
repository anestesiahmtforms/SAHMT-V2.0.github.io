import {expectManagementFaFirstLoginUid, getManagementFaFirstLoginGeneration,
  setManagementFaFirstLoginPending} from './management-fa-first-login-state.js';

const denied = code => Object.freeze({ok: false, code});
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const googleProvider = user => Array.isArray(user?.providerData)
  ? user.providerData.find(item => item?.providerId === 'google.com') : null;

/** The decoded sub is used only as a post-link consistency check, never for authorization. */
export function createGoogleCredentialFactory(GoogleAuthProvider) {
  if (typeof GoogleAuthProvider?.credential !== 'function') throw new Error('GOOGLE_AUTH_PROVIDER_UNAVAILABLE');
  return googleIdToken => {
    if (typeof googleIdToken !== 'string' || googleIdToken.length > 16000) return null;
    try {
      const part = googleIdToken.split('.')[1];
      if (typeof part !== 'string' || !/^[A-Za-z0-9_-]+$/.test(part)) return null;
      const raw = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4));
      const payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(raw, c => c.charCodeAt(0))));
      if (typeof payload.sub !== 'string' || !/^[A-Za-z0-9._-]{1,255}$/.test(payload.sub)) return null;
      return {credential: GoogleAuthProvider.credential(googleIdToken), googleSub: payload.sub};
    } catch { return null; }
  };
}

function createNonce(cryptoImpl) {
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Default-off client coordinator for the pre-enrolled FA account flow.
 * Dependencies are injected so tests cannot call Firebase or Google services.
 * The existing signInWithPopup path is not imported or replaced here.
 */
export function createManagementFaFirstLoginFlow({enabled = false, auth, requestGoogleIdToken,
  claimFirstLogin, googleCredential, signInWithCustomToken, signInWithCredential,
  linkWithCredential, reload, signOut, cryptoImpl = globalThis.crypto,
  onPending = () => {}} = {}) {
  if (enabled !== true) return Object.freeze({enabled: false, signIn: async () => denied('FIRST_LOGIN_DISABLED')});
  if (!auth || typeof requestGoogleIdToken !== 'function' || typeof claimFirstLogin !== 'function'
    || typeof googleCredential !== 'function' || typeof signInWithCustomToken !== 'function'
    || typeof linkWithCredential !== 'function'
    || typeof reload !== 'function' || typeof signOut !== 'function'
    || typeof cryptoImpl?.getRandomValues !== 'function' || typeof onPending !== 'function')
    throw new Error('FIRST_LOGIN_CLIENT_CONFIG_INVALID');

  let inFlight = false;
  let activeController = null;
  async function signIn() {
    if (inFlight) return denied('FIRST_LOGIN_BUSY');
    if (auth.currentUser) return denied('FA_SESSION_ALREADY_PRESENT');
    inFlight = true;
    activeController = new AbortController();
    let createdSessionUser = null;
    try {
      setManagementFaFirstLoginPending(true);
      onPending(true);
      const attemptGeneration = getManagementFaFirstLoginGeneration();
      const assertCurrentAttempt = () => {
        if (getManagementFaFirstLoginGeneration() !== attemptGeneration) throw Object.assign(new Error(), {safeCode:'FA_SESSION_CHANGED'});
      };
      const nonce = createNonce(cryptoImpl);
      const googleIdToken = await requestGoogleIdToken({nonce, signal:activeController.signal});
      assertCurrentAttempt();
      if (typeof googleIdToken !== 'string' || googleIdToken.length < 1 || googleIdToken.length > 16000)
        return denied('GOOGLE_CREDENTIAL_UNAVAILABLE');
      const response = await claimFirstLogin({googleIdToken, nonce}, {signal:activeController.signal});
      assertCurrentAttempt();
      if (!plain(response) || typeof response.status !== 'string') return denied('FIRST_LOGIN_RESPONSE_INVALID');
      if (response.status === 'DENIED')
        return denied(typeof response.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(response.code)
          ? response.code : 'FIRST_LOGIN_DENIED');
      if (typeof response.uid !== 'string' || !response.uid || response.uid.length > 128)
        return denied('FIRST_LOGIN_RESPONSE_INVALID');
      if (auth.currentUser) return denied('FA_SESSION_CHANGED');
      if (response.status === 'ALREADY_LINKED') {
        // Keep existing Google users on auth.js's signInWithPopup flow.
        return denied('USE_EXISTING_SIGN_IN_GOOGLE_POPUP');
      }
      const credentialInfo = googleCredential(googleIdToken);
      if (!plain(credentialInfo) || !credentialInfo.credential || typeof credentialInfo.googleSub !== 'string'
        || !credentialInfo.googleSub) return denied('GOOGLE_CREDENTIAL_INVALID');

      if (response.status !== 'FIRST_LOGIN' || typeof response.customToken !== 'string'
        || response.customToken.length < 1 || response.customToken.length > 16000)
        return denied(response.code && /^[A-Z0-9_]{1,64}$/.test(response.code) ? response.code : 'FIRST_LOGIN_DENIED');
      if (auth.currentUser) return denied('FA_SESSION_CHANGED');
      expectManagementFaFirstLoginUid(response.uid);
      const signedIn = await signInWithCustomToken(auth, response.customToken);
      assertCurrentAttempt();
      createdSessionUser = signedIn?.user || null;
      if (!createdSessionUser || createdSessionUser.uid !== response.uid || auth.currentUser !== createdSessionUser)
        throw Object.assign(new Error(), {safeCode: 'FA_UID_MISMATCH'});

      const linked = await linkWithCredential(createdSessionUser, credentialInfo.credential);
      assertCurrentAttempt();
      if (linked?.user !== createdSessionUser || linked.user.uid !== response.uid || auth.currentUser !== createdSessionUser)
        throw Object.assign(new Error(), {safeCode: 'FA_LINK_RESULT_MISMATCH'});
      await reload(createdSessionUser);
      assertCurrentAttempt();
      if (createdSessionUser.uid !== response.uid || auth.currentUser !== createdSessionUser
        || googleProvider(createdSessionUser)?.uid !== credentialInfo.googleSub)
        throw Object.assign(new Error(), {safeCode: 'FA_LINK_VERIFICATION_FAILED'});
      return Object.freeze({ok: true, status: 'FIRST_LOGIN_LINKED'});
    } catch (error) {
      if (createdSessionUser && auth.currentUser === createdSessionUser) {
        try { await signOut(auth); } catch { /* never expose cleanup details or replace the original failure */ }
      }
      const code = error?.safeCode;
      return denied(typeof code === 'string' && /^FA_[A-Z0-9_]{1,56}$/.test(code)
        ? code : 'FIRST_LOGIN_FAILED');
    } finally {
      setManagementFaFirstLoginPending(false);
      try { onPending(false); } catch {}
      activeController = null;
      inFlight = false;
    }
  }
  function cancel() { activeController?.abort(); }
  return Object.freeze({enabled: true, signIn, cancel});
}
