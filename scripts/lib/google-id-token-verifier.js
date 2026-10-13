const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const b64url = value => typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
const encodeBase64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const decodePart = (part, maximum) => {
  if (!b64url(part)) throw new Error('GOOGLE_ID_TOKEN_FORMAT_INVALID');
  let binary;
  try { binary = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4)); }
  catch { throw new Error('GOOGLE_ID_TOKEN_FORMAT_INVALID'); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (!bytes.length || bytes.length > maximum || encodeBase64Url(bytes) !== part)
    throw new Error('GOOGLE_ID_TOKEN_FORMAT_INVALID');
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { throw new Error('GOOGLE_ID_TOKEN_FORMAT_INVALID'); }
};
const fail = code => Object.assign(new Error(code), {code});

async function readBoundedJson(response, maximumBytes) {
  if (!response?.body?.getReader) throw fail('GOOGLE_ID_TOKEN_KEYS_INVALID');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || !value.byteLength || (size += value.byteLength) > maximumBytes)
        throw fail('GOOGLE_ID_TOKEN_KEYS_INVALID');
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw fail('GOOGLE_ID_TOKEN_KEYS_INVALID'); }
}

/** Verifies a Google OpenID Connect ID token using Google's fixed JWKS endpoint. */
export function createGoogleIdTokenVerifier({fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto,
  clock = Date.now, maxTokenBytes = 16000, maxKeysBytes = 65536, maxCacheMs = 3600000,
  maxFutureSkewSeconds = 60, fetchTimeoutMs = 5000} = {}) {
  if (typeof fetchImpl !== 'function' || typeof cryptoImpl?.subtle?.importKey !== 'function'
    || typeof cryptoImpl.subtle.verify !== 'function' || typeof clock !== 'function'
    || !Number.isSafeInteger(maxTokenBytes) || maxTokenBytes < 1024 || maxTokenBytes > 65536
    || !Number.isSafeInteger(maxKeysBytes) || maxKeysBytes < 1024 || maxKeysBytes > 262144
    || !Number.isSafeInteger(maxCacheMs) || maxCacheMs < 1000 || maxCacheMs > 3600000
    || !Number.isSafeInteger(maxFutureSkewSeconds) || maxFutureSkewSeconds < 0 || maxFutureSkewSeconds > 120
    || !Number.isSafeInteger(fetchTimeoutMs) || fetchTimeoutMs < 1000 || fetchTimeoutMs > 15000)
    throw new Error('GOOGLE_ID_TOKEN_VERIFIER_CONFIG_INVALID');
  let keys = new Map(), cacheExpiresAt = 0, disposed = false;

  async function refreshKeys(nowMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    let response;
    try {
      response = await fetchImpl(GOOGLE_CERTS_URL, {method: 'GET', cache: 'no-store', credentials: 'omit',
        redirect: 'manual', referrerPolicy: 'no-referrer', signal: controller.signal, headers: {Accept: 'application/json'}});
    } finally { clearTimeout(timeout); }
    if (response?.status !== 200 || response.redirected === true || response.url !== GOOGLE_CERTS_URL
      || !/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || ''))
      throw fail('GOOGLE_ID_TOKEN_KEYS_UNAVAILABLE');
    const advertised = response.headers.get('content-length');
    if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > maxKeysBytes))
      throw fail('GOOGLE_ID_TOKEN_KEYS_INVALID');
    const document = await readBoundedJson(response, maxKeysBytes);
    if (!plain(document) || !Array.isArray(document.keys) || document.keys.length < 1 || document.keys.length > 20)
      throw fail('GOOGLE_ID_TOKEN_KEYS_INVALID');
    const next = new Map();
    for (const key of document.keys) {
      if (!plain(key) || typeof key.kid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key.kid)
        || key.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig'
        || typeof key.n !== 'string' || !b64url(key.n) || typeof key.e !== 'string' || !b64url(key.e)
        || next.has(key.kid)) throw fail('GOOGLE_ID_TOKEN_KEYS_INVALID');
      next.set(key.kid, await cryptoImpl.subtle.importKey('jwk', key,
        {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']));
    }
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i);
    const maxAgeMs = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]) * 1000, maxCacheMs) : Math.min(300000, maxCacheMs);
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000) throw fail('GOOGLE_ID_TOKEN_KEYS_INVALID');
    keys = next; cacheExpiresAt = nowMs + maxAgeMs;
  }

  async function verifyIdToken(token, {audience, nonce, nowMs = clock()} = {}) {
    if (disposed) throw fail('GOOGLE_ID_TOKEN_VERIFIER_DISPOSED');
    if (typeof audience !== 'string' || audience.length < 10 || audience.length > 512
      || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(nonce)
      || typeof token !== 'string' || token.length < 1 || new TextEncoder().encode(token).byteLength > maxTokenBytes
      || !Number.isSafeInteger(nowMs) || nowMs < 1) throw fail('GOOGLE_ID_TOKEN_REQUEST_INVALID');
    const parts = token.split('.');
    if (parts.length !== 3) throw fail('GOOGLE_ID_TOKEN_FORMAT_INVALID');
    let header, claims;
    try {
      header = JSON.parse(decodePart(parts[0], 2048));
      claims = JSON.parse(decodePart(parts[1], 8192));
    } catch { throw fail('GOOGLE_ID_TOKEN_FORMAT_INVALID'); }
    if (!plain(header) || header.alg !== 'RS256' || typeof header.kid !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)
      || Object.keys(header).some(key => !['alg', 'kid', 'typ'].includes(key))
      || (header.typ !== undefined && header.typ !== 'JWT') || !plain(claims))
      throw fail('GOOGLE_ID_TOKEN_HEADER_INVALID');
    if (cacheExpiresAt <= nowMs || !keys.has(header.kid)) await refreshKeys(nowMs);
    let key = keys.get(header.kid);
    if (!key) { await refreshKeys(nowMs); key = keys.get(header.kid); }
    if (!key) throw fail('GOOGLE_ID_TOKEN_KEY_UNKNOWN');
    const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    let signature;
    try {
      const raw = parts[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - parts[2].length % 4) % 4);
      const binary = atob(raw);
      signature = Uint8Array.from(binary, character => character.charCodeAt(0));
      if (!signature.length || signature.length > 1024 || encodeBase64Url(signature) !== parts[2]) throw new Error();
    } catch { throw fail('GOOGLE_ID_TOKEN_FORMAT_INVALID'); }
    let signatureValid = false;
    try { signatureValid = await cryptoImpl.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed); }
    catch { throw fail('GOOGLE_ID_TOKEN_SIGNATURE_INVALID'); }
    if (signatureValid !== true) throw fail('GOOGLE_ID_TOKEN_SIGNATURE_INVALID');

    const issuer = claims.iss;
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(issuer)
      || claims.aud !== audience || (claims.azp !== undefined && claims.azp !== audience))
      throw fail('GOOGLE_ID_TOKEN_AUDIENCE_INVALID');
    const nowSeconds = Math.floor(nowMs / 1000);
    if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
      || claims.iat > nowSeconds + maxFutureSkewSeconds || claims.exp <= nowSeconds
      || claims.exp <= claims.iat || claims.exp - claims.iat > 3600)
      throw fail('GOOGLE_ID_TOKEN_EXPIRED_OR_INVALID');
    if (claims.nonce !== nonce) throw fail('GOOGLE_ID_TOKEN_NONCE_INVALID');
    if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9._-]{1,255}$/.test(claims.sub)
      || typeof claims.email !== 'string' || claims.email.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) || claims.email_verified !== true)
      throw fail('GOOGLE_ID_TOKEN_IDENTITY_INVALID');
    return Object.freeze({issuer, audience: claims.aud, issuedAtSeconds: claims.iat, expiresAtSeconds: claims.exp,
      nonce: claims.nonce, sub: claims.sub, email: claims.email, emailVerified: claims.email_verified});
  }

  return Object.freeze({verifyIdToken, dispose() { disposed = true; keys.clear(); cacheExpiresAt = 0; }});
}
