import {googleTokenClaims} from './google-project-auth-preflight.js';
import {safeGoogleAuthCode} from './google-project-auth-core.js';

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const documents = new WeakMap();
const fail = code => Object.assign(new Error(code), {code});
const identity = value => value && typeof value.uid === 'string' && value.uid
  && typeof value.googleUid === 'string' && value.googleUid
  ? {uid:value.uid, googleUid:value.googleUid} : null;
const same = (left, right) => Boolean(left && right && left.uid === right.uid && left.googleUid === right.googleUid);
const notify = (callback, ...args) => { try { callback(...args); } catch { /* UI callbacks cannot change Auth. */ } };
const safeError = error => fail(['AUTH_GOOGLE_SCRIPT_TIMEOUT','AUTH_GOOGLE_SCRIPT_UNAVAILABLE',
  'AUTH_GOOGLE_SCRIPT_INVALID','AUTH_GOOGLE_BUTTON_DISPOSED'].includes(error?.code)
  ? error.code : safeGoogleAuthCode(error));

function sharedDocument(document) {
  let shared = documents.get(document);
  if (!shared) {
    shared = {loading:null, cancelLoad:null, api:null, clientId:null, nonce:null, records:new Map(), mounts:new Map()};
    documents.set(document, shared);
  }
  return shared;
}

function loadGoogle(shared, document, window, timeoutMs) {
  const available = window.google?.accounts?.id;
  if (available?.initialize && available?.renderButton) return Promise.resolve(available);
  if (shared.loading) return shared.loading;
  const script = document.createElement('script');
  script.src = SCRIPT_URL;
  script.async = true;
  script.defer = true;
  const localHttp=window.location?.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
  script.referrerPolicy = localHttp?'no-referrer-when-downgrade':'strict-origin-when-cross-origin';
  let timer, settled = false;
  const operation = new Promise((resolve, reject) => {
    const finish = (error, api) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      shared.cancelLoad = null;
      if (error) { script.remove(); reject(error); } else resolve(api);
    };
    shared.cancelLoad = () => finish(fail('AUTH_GOOGLE_BUTTON_DISPOSED'));
    script.onload = () => {
      const api = window.google?.accounts?.id;
      finish(api?.initialize && api?.renderButton ? null : fail('AUTH_GOOGLE_SCRIPT_INVALID'), api);
    };
    script.onerror = () => finish(fail('AUTH_GOOGLE_SCRIPT_UNAVAILABLE'));
    timer = setTimeout(() => finish(fail('AUTH_GOOGLE_SCRIPT_TIMEOUT')), timeoutMs);
    try { document.head.appendChild(script); }
    catch { finish(fail('AUTH_GOOGLE_SCRIPT_UNAVAILABLE')); }
  });
  shared.loading = operation;
  operation.finally(() => { if (shared.loading === operation) shared.loading = null; }).catch(() => {});
  return operation;
}

/**
 * Renders only the official GIS button. The caller reauthenticates the existing
 * Firebase User in onCredential; this module never signs in or creates accounts.
 * render(container) resolves to cleanup. A failed render may be retried explicitly.
 * onLoading covers script loading and credential processing, not popup waiting:
 * GIS ID buttons expose no reliable popup-close callback. No prompt/One Tap runs.
 * https://developers.google.com/identity/gsi/web/reference/js-reference
 */
export function createGoogleProjectAuthGoogleButton({clientId, getExpectedIdentity, onCredential,
  onLoading = () => {}, onError = () => {}, document = globalThis.document,
  window = globalThis.window, loadTimeoutMs = 15000, now = Date.now,
  randomId = () => globalThis.crypto.randomUUID()} = {}) {
  if (typeof clientId !== 'string' || !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)
    || typeof getExpectedIdentity !== 'function' || typeof onCredential !== 'function'
    || typeof onLoading !== 'function' || typeof onError !== 'function'
    || !document?.head?.appendChild || !document?.createElement || !window
    || !Number.isSafeInteger(loadTimeoutMs) || loadTimeoutMs < 1 || loadTimeoutMs > 60000
    || typeof now !== 'function' || typeof randomId !== 'function') throw fail('AUTH_CONFIGURATION_REQUIRED');
  const shared = sharedDocument(document), owned = new Set();
  let disposed = false, loadingCount = 0;
  const readIdentity = () => identity(getExpectedIdentity());
  function loading(record, value) {
    if (record.loading === value) return;
    record.loading = value;
    loadingCount += value ? 1 : -1;
    if (loadingCount === 0 || (value && loadingCount === 1)) notify(onLoading, loadingCount > 0);
  }
  function cleanup(record) {
    if (!record.active) return;
    record.active = false;
    record.expected = null;
    shared.records.delete(record.state);
    owned.delete(record);
    if (shared.mounts.get(record.container) === record) {
      shared.mounts.delete(record.container);
      record.container.replaceChildren();
    }
    loading(record, false);
    if (!shared.mounts.size) shared.cancelLoad?.();
  }
  async function receive(record, response) {
    if (!record.active || record.processing || !record.expected) return;
    const expected = record.expected;
    record.expected = null; // Each real button click authorizes at most one delivery.
    record.processing = true;
    loading(record, true);
    try {
      if (!same(readIdentity(), expected)) throw fail('AUTH_ACCOUNT_CHANGED');
      const idToken = response?.credential;
      if (typeof idToken !== 'string' || !idToken || idToken.length > 16000) throw fail('AUTH_CREDENTIAL_REQUIRED');
      const credential = Object.freeze({providerId:'google.com', idToken});
      const claims = googleTokenClaims(credential);
      if (claims.aud !== clientId) throw fail('AUTH_AUDIENCE_NOT_VERIFIED');
      if (claims.sub !== expected.googleUid || claims.nonce !== shared.nonce
        || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now()) throw fail('AUTH_GOOGLE_IDENTITY_MISMATCH');
      // Decoding is only an early check. Firebase reauthenticateWithCredential
      // must verify the signature and credential before any destination sign-in.
      if (!record.active || !same(readIdentity(), expected)) throw fail('AUTH_ACCOUNT_CHANGED');
      await onCredential(credential, Object.freeze({...expected}));
    } catch (error) {
      if (record.active) notify(onError, safeError(error));
    } finally {
      record.processing = false;
      loading(record, false);
    }
  }
  function render(container) {
    if (disposed) return Promise.reject(fail('AUTH_GOOGLE_BUTTON_DISPOSED'));
    if (!container?.replaceChildren) return Promise.reject(fail('AUTH_CONFIGURATION_REQUIRED'));
    const previous = shared.mounts.get(container);
    if (previous) return owned.has(previous) ? previous.promise : Promise.reject(fail('AUTH_CONFIGURATION_REQUIRED'));
    const record = {container, state:randomId(), active:true, loading:false, processing:false, expected:null};
    if (typeof record.state !== 'string' || !record.state || shared.records.has(record.state))
      return Promise.reject(fail('AUTH_CONFIGURATION_REQUIRED'));
    owned.add(record);
    shared.mounts.set(container, record);
    shared.records.set(record.state, record);
    loading(record, true);
    record.promise = (async () => {
      try {
        const api = await loadGoogle(shared, document, window, loadTimeoutMs);
        if (!record.active || disposed) throw fail('AUTH_GOOGLE_BUTTON_DISPOSED');
        if (shared.clientId && (shared.clientId !== clientId || shared.api !== api)) throw fail('AUTH_CONFIGURATION_REQUIRED');
        if (!shared.clientId) {
          const nonce = randomId();
          if (typeof nonce !== 'string' || !nonce) throw fail('AUTH_CONFIGURATION_REQUIRED');
          api.initialize({client_id:clientId, nonce, auto_select:false, button_auto_select:false,
            ux_mode:'popup', context:'signin', callback:response => {
              const active = shared.records.get(response?.state);
              if (active) void active.receive(response);
            }});
          shared.api = api;
          shared.clientId = clientId;
          shared.nonce = nonce;
        }
        record.receive = response => receive(record, response);
        container.replaceChildren();
        api.renderButton(container, {type:'standard', theme:'outline', size:'large', text:'continue_with',
          shape:'rectangular', locale:'pt-BR', state:record.state, click_listener:() => {
            if (!record.active || record.processing) return;
            try {
              record.expected = readIdentity();
              if (!record.expected) notify(onError, fail('AUTH_SOURCE_REQUIRED'));
            } catch { record.expected = null; notify(onError, fail('AUTH_SOURCE_REQUIRED')); }
          }});
        return () => cleanup(record);
      } catch (error) {
        if (record.active) notify(onError, safeError(error));
        cleanup(record);
        throw safeError(error);
      } finally { loading(record, false); }
    })();
    return record.promise;
  }
  return Object.freeze({render, dispose() { disposed = true; for (const record of [...owned]) cleanup(record); }});
}
