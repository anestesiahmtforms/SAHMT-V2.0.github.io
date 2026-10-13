const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uidValid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const emailValid = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const nonceValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(value);
const deny = code => Object.freeze({status: 'DENIED', code});
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const hash = async (value, cryptoImpl) => hex(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(value))));

/**
 * Local-only FA first-login broker. The Gateway resolves the verified email
 * against FA at request time, checks the source profile/cohort, consumes the
 * digest-derived request nonce atomically, and signs only the resolved UID.
 */
export function createManagementFaFirstLoginBroker({enabled = false, audience, googleVerifier,
  gateway, cryptoImpl = globalThis.crypto, clock = Date.now} = {}) {
  if (enabled !== true) return Object.freeze({enabled: false, claim: async () => deny('FIRST_LOGIN_DISABLED')});
  if (typeof audience !== 'string' || audience.length < 10 || audience.length > 512
    || typeof googleVerifier?.verifyIdToken !== 'function'
    || typeof gateway?.authorizeAndSignFaFirstLogin !== 'function'
    || typeof cryptoImpl?.subtle?.digest !== 'function' || typeof clock !== 'function')
    throw new Error('FIRST_LOGIN_SERVER_CONFIG_INVALID');

  async function claim(input, context = {}) {
    if (!exact(input, ['googleIdToken', 'nonce']) || typeof input.googleIdToken !== 'string'
      || input.googleIdToken.length < 1 || input.googleIdToken.length > 16000 || !nonceValid(input.nonce))
      return deny('FIRST_LOGIN_REQUEST_INVALID');
    const nowMs = clock();
    if (!Number.isSafeInteger(nowMs) || nowMs < 1) return deny('FIRST_LOGIN_CLOCK_INVALID');

    let stage = 'GOOGLE_IDENTITY_VERIFICATION';
    try {
      const claims = await googleVerifier.verifyIdToken(input.googleIdToken, {audience, nonce: input.nonce, nowMs});
      if (!exact(claims, ['issuer', 'audience', 'issuedAtSeconds', 'expiresAtSeconds', 'nonce', 'sub', 'email', 'emailVerified'])
        || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.issuer)
        || claims.audience !== audience || !Number.isSafeInteger(claims.issuedAtSeconds)
        || !Number.isSafeInteger(claims.expiresAtSeconds) || claims.nonce !== input.nonce
        || typeof claims.sub !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(claims.sub)
        || !emailValid(claims.email) || claims.emailVerified !== true)
        return deny('GOOGLE_IDENTITY_INVALID');
      const nowSeconds = Math.floor(nowMs / 1000);
      if (claims.issuedAtSeconds > nowSeconds + 60 || nowSeconds - claims.issuedAtSeconds > 120 || claims.expiresAtSeconds <= nowSeconds
        || claims.expiresAtSeconds <= claims.issuedAtSeconds
        || claims.expiresAtSeconds - claims.issuedAtSeconds > 3600)
        return deny('GOOGLE_IDENTITY_EXPIRED_OR_INVALID');

      const nonceDigest = await hash(input.nonce, cryptoImpl);
      stage = 'FA_ACCOUNT_AUTHORIZATION';
      const result = await gateway.authorizeAndSignFaFirstLogin({
        email: claims.email.trim().toLowerCase(), googleSub: claims.sub, nonceDigest,
        issuedAtSeconds: nowSeconds, expiresAtSeconds: nowSeconds + 300
      }, context);
      if (object(result) && result.status === 'ALREADY_LINKED' && exact(result, ['status', 'uid']) && uidValid(result.uid))
        return Object.freeze({status: 'ALREADY_LINKED', uid: result.uid});
      if (object(result) && result.status === 'FIRST_LOGIN' && exact(result, ['status', 'uid', 'signedJwt'])
        && uidValid(result.uid) && typeof result.signedJwt === 'string' && result.signedJwt.length <= 16000
        && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.signedJwt))
        return Object.freeze({status: 'FIRST_LOGIN', uid: result.uid, customToken: result.signedJwt});
      if (object(result) && result.status === 'DENIED' && exact(result, ['status', 'code'])
        && typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(result.code)) return deny(result.code);
      return deny('FIRST_LOGIN_GATEWAY_RESULT_INVALID');
    } catch {
      // Never expose upstream exceptions, credentials, tokens, or personal data.
      return deny(stage === 'GOOGLE_IDENTITY_VERIFICATION' ? 'GOOGLE_IDENTITY_UNAVAILABLE' : 'FA_ACCOUNT_AUTHORIZATION_UNAVAILABLE');
    }
  }

  return Object.freeze({enabled: true, claim});
}
