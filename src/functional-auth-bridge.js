import {signIntoFunctionalProject, signOutFunctionalProject} from './functional-firebase.js';

const SOURCE_PROJECT_ID = 'sahmt-17a16';
const TARGET_PROJECT_ID = 'sahmt-funcional-fk';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validateEndpoint(endpoint, allowedOrigin) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('FK_AUTH_BRIDGE_CONFIG_INVALID'); }
  if (!allowedOrigin || url.protocol !== 'https:' || url.origin !== allowedOrigin || url.pathname !== '/v1/management/session'
    || url.username || url.password || url.search || url.hash) throw new Error('FK_AUTH_BRIDGE_CONFIG_INVALID');
  return url.href;
}

function parseExchange(value, expectedUid) {
  if (!exact(value, ['schemaVersion', 'sourceProjectId', 'faUid', 'targets']) || value.schemaVersion !== 1
    || value.sourceProjectId !== SOURCE_PROJECT_ID || value.faUid !== expectedUid || !exact(value.targets, ['FK']))
    throw new Error('FK_AUTH_BRIDGE_RESPONSE_INVALID');
  const result = value.targets.FK;
  if (!exact(result, ['projectId', 'status', 'uid', 'customToken']) || result.projectId !== TARGET_PROJECT_ID
    || result.status !== 'READY' || result.uid !== expectedUid || typeof result.customToken !== 'string'
    || result.customToken.length < 100 || result.customToken.length > 12000 || /[\s\x00-\x1f\x7f]/.test(result.customToken))
    throw new Error('FK_AUTH_TARGET_DENIED');
  return result.customToken;
}

export function createFunctionalAuthBridge({enabled = false, endpoint, allowedOrigin, fetchImpl = globalThis.fetch} = {}) {
  if (enabled !== true) return Object.freeze({enabled: false, connect: async () => null, dispose() {}});
  const url = validateEndpoint(endpoint, allowedOrigin);
  if (typeof fetchImpl !== 'function') throw new Error('FK_AUTH_BRIDGE_CONFIG_INVALID');
  let disposed = false, activeController = null;
  return Object.freeze({enabled: true, async connect(faAuth) {
    if (disposed || !faAuth?.currentUser) throw new Error('FK_FA_SESSION_REQUIRED');
    const sourceUser = faAuth.currentUser, uid = sourceUser.uid;
    if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('FK_FA_SESSION_INVALID');
    const faIdToken = await sourceUser.getIdToken(true);
    if (disposed || faAuth.currentUser !== sourceUser) throw new Error('FK_FA_SESSION_CHANGED');
    activeController?.abort();
    const controller = new AbortController(); activeController = controller;
    let response, body;
    try {
      response = await fetchImpl(url, {method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json'},
        body:JSON.stringify({faIdToken, sourceProjectId:SOURCE_PROJECT_ID, targetProjectIds:{FK:TARGET_PROJECT_ID}}),
        mode:'cors', credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer',
        signal:AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])});
      if (response.status !== 200 || response.redirected === true || response.url && response.url !== url)
        throw new Error('FK_AUTH_UPSTREAM_REJECTED');
      const text = await response.text();
      if (text.length > 16000) throw new Error('FK_AUTH_RESPONSE_INVALID');
      try { body = JSON.parse(text); } catch { throw new Error('FK_AUTH_RESPONSE_INVALID'); }
      if (disposed || faAuth.currentUser !== sourceUser) throw new Error('FK_FA_SESSION_CHANGED');
      const customToken = parseExchange(body, uid);
      const user = await signIntoFunctionalProject(customToken, uid);
      if (disposed || faAuth.currentUser !== sourceUser) {
        try { await signOutFunctionalProject(uid); } catch { /* Keep FK closed after the FA session changes. */ }
        throw new Error('FK_FA_SESSION_CHANGED');
      }
      return user;
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new Error('FK_AUTH_REQUEST_ABORTED');
      throw error;
    } finally {
      if (activeController === controller) activeController = null;
    }
  }, dispose() { disposed = true; activeController?.abort(); activeController = null; }});
}
