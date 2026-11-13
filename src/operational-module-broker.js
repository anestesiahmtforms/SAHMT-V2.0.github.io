import {config as fi, sessionEndpoint as fiEndpoint} from './firebase-config-fi.js';
import {config as fj, sessionEndpoint as fjEndpoint} from './firebase-config-fj.js';
import {config as fh, sessionEndpoint as fhEndpoint} from './firebase-config-fh.js';
import {config as fg, sessionEndpoint as fgEndpoint} from './firebase-config-fg.js';

export const OPERATIONAL_MODULE_TARGETS = Object.freeze({
  FI: Object.freeze({config: fi, endpoint: fiEndpoint}),
  FJ: Object.freeze({config: fj, endpoint: fjEndpoint}),
  FH: Object.freeze({config: fh, endpoint: fhEndpoint}),
  FG: Object.freeze({config: fg, endpoint: fgEndpoint})
});
const fail = code => Object.assign(new Error(code), {code});

/** FA credentials go only to the fixed, provisioned Worker for this module. */
export function createOperationalModuleExchange({station, fetchImpl = globalThis.fetch, getAppCheckToken = async () => null} = {}) {
  const target = OPERATIONAL_MODULE_TARGETS[station];
  if (!target || typeof fetchImpl !== 'function' || typeof getAppCheckToken !== 'function') throw fail('MODULE_BROKER_CONFIG_INVALID');
  return async ({faIdToken, faUid, signal}) => {
    if (typeof faIdToken !== 'string' || !faIdToken || faIdToken.length > 16000 || /[\s\x00-\x1f]/.test(faIdToken) ||
        typeof faUid !== 'string' || !faUid || faUid.length > 128 || /[\s/\x00-\x1f]/.test(faUid)) throw fail('MODULE_BROKER_REQUEST_INVALID');
    let reader, response;
    try {
      const headers = {'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + faIdToken};
      const appCheck=await getAppCheckToken();
      if (signal?.aborted) throw fail('MODULE_SOURCE_SESSION_CHANGED');
      if (appCheck !== null && appCheck !== undefined && (typeof appCheck !== 'string' || !appCheck ||
          appCheck.length > 16000 || /[\s\x00-\x1f]/.test(appCheck))) throw fail('MODULE_BROKER_REQUEST_INVALID');
      if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;
      response = await fetchImpl(target.endpoint, {method: 'POST', headers, body: '{}', signal,
        mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'});
      if (signal?.aborted) throw fail('MODULE_SOURCE_SESSION_CHANGED');
      if (!response.ok) throw fail([401, 403].includes(response.status) ? 'MODULE_ACCESS_DENIED' : 'MODULE_SESSION_UNAVAILABLE');
      if (response.status !== 200 || response.redirected || response.url !== target.endpoint ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '') ||
          !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('Cache-Control') || '')) throw fail('MODULE_BROKER_RESPONSE_INVALID');
      reader = response.body?.getReader(); if (!reader) throw fail('MODULE_BROKER_RESPONSE_INVALID');
      const chunks = []; let size = 0;
      for (;;) {
        if (signal?.aborted) throw fail('MODULE_SOURCE_SESSION_CHANGED');
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 32768 || chunks.length > 256) throw fail('MODULE_BROKER_RESPONSE_INVALID');
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
      const body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      if (body?.station !== station || body.projectId !== target.config.projectId || body.uid !== faUid || body.expiresIn !== 300 ||
          typeof body.customToken !== 'string' || !body.customToken || body.customToken.length > 16000 || /[\s\x00-\x1f]/.test(body.customToken))
        throw fail('MODULE_BROKER_RESPONSE_INVALID');
      return {uid: body.uid, customToken: body.customToken, expiresIn: 300};
    } catch (error) {
      throw fail(/^MODULE_[A-Z_]+$/.test(error?.code || '') ? error.code : 'MODULE_SESSION_UNAVAILABLE');
    } finally {
      if (reader) {try {await reader.cancel();} catch {} reader.releaseLock();}
      else {try {await response?.body?.cancel();} catch {}}
    }
  };
}
