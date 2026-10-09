import {createPublicKey, verify as verifySignature, X509Certificate} from 'node:crypto';

// Server preparation only. No global fetch, ADC discovery, private key or host.
const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
const FA_CERTS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const FIREBASE_AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const AUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit', IAM_SCOPE = 'https://www.googleapis.com/auth/iam';
const claimNames = ['managementSourceProjectId', 'managementMemberId', 'managementSourceVersion',
  'managementSourceHash', 'managementPolicyVersion', 'managementSourceAuthTimeMs'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const identifier = (value, maximum = 200) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\s/\x00-\x1f]/.test(value);
class AuthAdapterError extends Error { constructor(code) { super(code); this.code = code; } }
const demand = (condition, code) => { if (!condition) throw new AuthAdapterError(code); };
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : object(value)
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const same = (left, right) => canonical(left) === canonical(right);
function decodeJwt(token) {
  demand(typeof token === 'string' && token.length > 0 && token.length <= 16000, 'JWT_FORMAT_INVALID');
  const segments = token.split('.');
  demand(segments.length === 3 && segments.every(value => /^[A-Za-z0-9_-]+$/.test(value)), 'JWT_FORMAT_INVALID');
  const bytes = segments.map(value => { const result = Buffer.from(value, 'base64url');
    demand(result.toString('base64url') === value, 'JWT_FORMAT_INVALID'); return result; });
  demand(bytes[0].length <= 2048 && bytes[1].length <= 8192 && bytes[2].length >= 256 && bytes[2].length <= 1024, 'JWT_FORMAT_INVALID');
  let header, payload;
  try { const decoder = new TextDecoder('utf-8', {fatal: true}); header = JSON.parse(decoder.decode(bytes[0])); payload = JSON.parse(decoder.decode(bytes[1])); }
  catch { throw new AuthAdapterError('JWT_FORMAT_INVALID'); }
  demand(object(header) && object(payload) && header.alg === 'RS256' && identifier(header.kid)
    && (header.typ === undefined || header.typ === 'JWT') && Object.keys(header).every(key => ['alg', 'kid', 'typ'].includes(key)), 'JWT_HEADER_INVALID');
  return {header, payload, signature: bytes[2], signingInput: Buffer.from(segments[0] + '.' + segments[1])};
}
function validateFaClaims(claims, time, policy) {
  demand(claims.aud === FA && claims.iss === 'https://securetoken.google.com/' + FA, 'FA_TOKEN_PROJECT_INVALID');
  demand(identifier(claims.sub, 128) && (claims.uid === undefined || claims.uid === claims.sub)
    && (claims.user_id === undefined || claims.user_id === claims.sub), 'FA_TOKEN_IDENTITY_INVALID');
  demand(integer(claims.auth_time, 1) && integer(claims.iat, 1) && integer(claims.exp, 1)
    && claims.auth_time <= claims.iat && claims.iat < claims.exp
    && claims.exp - claims.iat <= policy.maxIdTokenLifetimeSeconds
    && claims.auth_time * 1000 <= time + policy.maxFutureSkewMs && claims.iat * 1000 <= time + policy.maxFutureSkewMs
    && integer(claims.exp * 1000) && claims.exp * 1000 > time, 'FA_TOKEN_TIME_INVALID');
  demand(claims.email_verified === true && object(claims.firebase) && claims.firebase.sign_in_provider === 'google.com'
    && claims.firebase.tenant === undefined && claims.tenant_id === undefined, 'FA_TOKEN_PROVIDER_INVALID');
  const googleIds = claims.firebase.identities?.['google.com'];
  demand(Array.isArray(googleIds) && googleIds.length === 1 && identifier(googleIds[0], 128), 'FA_GOOGLE_IDENTITY_INVALID');
  return googleIds[0];
}
function normalizedUser(result, uid) {
  demand(object(result) && Array.isArray(result.users) && result.users.length === 1 && object(result.users[0]), 'AUTH_USER_MISSING_OR_AMBIGUOUS');
  const user = result.users[0];
  demand(user.localId === uid && user.tenantId === undefined && (user.disabled === undefined || typeof user.disabled === 'boolean')
    && typeof user.emailVerified === 'boolean' && Array.isArray(user.providerUserInfo)
    && user.providerUserInfo.length <= 20, 'AUTH_USER_INVALID');
  const validSince = user.validSince === undefined ? 0 : typeof user.validSince === 'string' && /^(0|[1-9]\d*)$/.test(user.validSince) ? Number(user.validSince) : NaN;
  demand(integer(validSince) && integer(validSince * 1000), 'AUTH_REVOCATION_TIME_INVALID');
  const providers = user.providerUserInfo.map(provider => {
    demand(object(provider) && identifier(provider.providerId) && identifier(provider.rawId, 128), 'AUTH_PROVIDER_INVALID');
    return Object.freeze({providerId: provider.providerId, uid: provider.rawId});
  });
  demand(new Set(providers.map(provider => provider.providerId)).size === providers.length, 'AUTH_PROVIDER_INVALID');
  return Object.freeze({uid, disabled: user.disabled === true, emailVerified: user.emailVerified,
    providerData: Object.freeze(providers), tokensValidAfterTimeMs: validSince * 1000});
}
function approvedClaims(claims) {
  demand(object(claims) && Object.keys(claims).length === claimNames.length
    && Object.keys(claims).every(name => claimNames.includes(name)) && claims.managementSourceProjectId === FA
    && identifier(claims.managementMemberId) && integer(claims.managementSourceVersion, 1)
    && typeof claims.managementSourceHash === 'string' && /^[a-f0-9]{64}$/.test(claims.managementSourceHash)
    && identifier(claims.managementPolicyVersion, 100) && integer(claims.managementSourceAuthTimeMs, 1), 'CUSTOM_CLAIMS_INVALID');
  const result = Object.fromEntries(claimNames.map(name => [name, claims[name]]));
  demand(Buffer.byteLength(JSON.stringify(result)) <= 1000, 'CUSTOM_CLAIMS_TOO_LARGE'); return Object.freeze(result);
}


// A dedicated bridge returns a closed projection, never OAuth or raw Auth users.
function jsonData(value, depth = 0) {
  demand(depth <= 16, 'GATEWAY_DATA_INVALID');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { demand(Number.isFinite(value), 'GATEWAY_DATA_INVALID'); return; }
  demand(value && typeof value === 'object' && (Array.isArray(value)
    || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'GATEWAY_DATA_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  demand(Reflect.ownKeys(descriptors).every(key => typeof key === 'string'), 'GATEWAY_DATA_INVALID');
  if (Array.isArray(value)) demand(Object.keys(value).length === value.length
    && Object.keys(value).every(key => /^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length), 'GATEWAY_DATA_INVALID');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    demand(Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true, 'GATEWAY_DATA_INVALID');
    jsonData(descriptor.value, depth + 1);
  }
}
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
function validateGatewayLookup(data) {
  jsonData(data);
  demand(exactKeys(data, ['users']) && Array.isArray(data.users) && data.users.length <= 1, 'GATEWAY_LOOKUP_RESPONSE_INVALID');
  for (const user of data.users) {
    const fields = ['localId', 'disabled', 'emailVerified', 'validSince', 'providerUserInfo'];
    demand(object(user) && Object.keys(user).every(key => fields.includes(key))
      && ['localId', 'emailVerified', 'providerUserInfo'].every(key => Object.hasOwn(user, key))
      && Array.isArray(user.providerUserInfo) && user.providerUserInfo.length <= 20, 'GATEWAY_LOOKUP_RESPONSE_INVALID');
    for (const provider of user.providerUserInfo)
      demand(exactKeys(provider, ['providerId', 'rawId']), 'GATEWAY_LOOKUP_RESPONSE_INVALID');
  }
}

export function createManagementGoogleAuthAdapter({enabled = false, fetchImpl, getAdminAccessToken, privilegedGateway,
  signerServiceAccountEmail, policy, clock = Date.now} = {}) {
  let disposed = false;
  const active = new Map(), keyCache = new Map();
  const gatewayMode = privilegedGateway !== undefined;
  const configured = () => {
    demand(enabled === true && !disposed, 'GOOGLE_AUTH_ADAPTER_DISABLED');
    demand(typeof fetchImpl === 'function' && typeof clock === 'function'
      && (gatewayMode ? object(privilegedGateway) && getAdminAccessToken === undefined
        && typeof privilegedGateway.lookupAuthUser === 'function' && typeof privilegedGateway.signFbCustomToken === 'function'
        : typeof getAdminAccessToken === 'function')
      && typeof signerServiceAccountEmail === 'string'
      && new RegExp('^[a-z][a-z0-9-]{4,28}[a-z0-9]@' + FB + '\\.iam\\.gserviceaccount\\.com$').test(signerServiceAccountEmail), 'GOOGLE_AUTH_ADAPTER_CONFIG_INVALID');
    demand(object(policy) && integer(policy.operationTimeoutMs, 1) && policy.operationTimeoutMs <= 120000
      && integer(policy.maxResponseBytes, 1) && policy.maxResponseBytes <= 262144
      && integer(policy.maxResponseChunks, 1) && policy.maxResponseChunks <= 1024
      && integer(policy.maxKeyCacheMs, 1) && policy.maxKeyCacheMs <= 86400000
      && integer(policy.maxFutureSkewMs) && policy.maxFutureSkewMs <= 60000
      && integer(policy.maxIdTokenLifetimeSeconds, 1) && policy.maxIdTokenLifetimeSeconds <= 3600
      && integer(policy.customTokenLifetimeSeconds, 1) && policy.customTokenLifetimeSeconds <= 3600, 'GOOGLE_AUTH_POLICY_INVALID');
  };
  const execute = work => async (...args) => {
    let controller, timer, abortListener, external, externalSignal;
    try {
      configured(); external = args.at(-1); if (!object(external)) external = {};
      externalSignal = external.signal;
      demand(externalSignal === undefined || externalSignal && typeof externalSignal.aborted === 'boolean'
        && typeof externalSignal.addEventListener === 'function' && typeof externalSignal.removeEventListener === 'function', 'GOOGLE_AUTH_CONTEXT_INVALID');
      const started = clock(); demand(integer(started), 'GOOGLE_AUTH_CLOCK_INVALID');
      let deadline = started + policy.operationTimeoutMs;
      if (external.deadlineMs !== undefined) { demand(integer(external.deadlineMs), 'GOOGLE_AUTH_DEADLINE_INVALID'); deadline = Math.min(deadline, external.deadlineMs); }
      let wallDeadline = performance.now() + Math.max(0, deadline - started);
      controller = new AbortController();
      let rejectCancelled;
      const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
      const cancel = code => { controller.abort(); rejectCancelled(new AuthAdapterError(code)); };
      active.set(controller, cancel);
      const assertLive = () => {
        demand(externalSignal?.aborted !== true && !controller.signal.aborted && !disposed, 'GOOGLE_AUTH_ABORTED');
        const time = clock(); demand(integer(time) && time >= started, 'GOOGLE_AUTH_CLOCK_INVALID');
        if (time >= deadline || performance.now() >= wallDeadline) { controller.abort(); throw new AuthAdapterError('GOOGLE_AUTH_TIMEOUT'); }
        return time;
      };
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => cancel('GOOGLE_AUTH_TIMEOUT'), Math.max(1, Math.ceil(Math.min(deadline - clock(), wallDeadline - performance.now())))); };
      const ctx = {controller, assertLive, requestContext: () => Object.freeze({signal: controller.signal, deadlineMs: deadline}), limit: expiresAt => {
        const time = assertLive(); demand(integer(expiresAt) && expiresAt > time, 'GOOGLE_ADMIN_CREDENTIAL_EXPIRED');
        deadline = Math.min(deadline, expiresAt); wallDeadline = Math.min(wallDeadline, performance.now() + expiresAt - time); arm();
      }};
      abortListener = () => cancel('GOOGLE_AUTH_ABORTED'); externalSignal?.addEventListener('abort', abortListener, {once: true});
      if (externalSignal?.aborted) cancel('GOOGLE_AUTH_ABORTED'); else arm();
      const task = Promise.resolve().then(() => { assertLive(); return work(ctx, ...args); });
      const result = await Promise.race([task, cancelled]); assertLive(); return result;
    } catch (error) { if (error instanceof AuthAdapterError) throw new AuthAdapterError(error.code); throw new AuthAdapterError('GOOGLE_AUTH_ADAPTER_FAILED'); }
    finally { controller?.abort(); clearTimeout(timer);
      try { externalSignal?.removeEventListener?.('abort', abortListener); } catch {}
      if (controller) active.delete(controller); }
  };
  const responseJson = async (url, options, ctx) => {
    ctx.assertLive();
    const response = await fetchImpl(url, {...options, headers: {...options.headers, Accept: 'application/json'},
      cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: ctx.controller.signal});
    const receivedAtMs = ctx.assertLive(), receivedAtWall = performance.now();
    demand(response?.status === 200 && response.redirected !== true && response.url === url
      && /^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || ''), 'GOOGLE_RESPONSE_REJECTED');
    const advertised = response.headers.get('content-length');
    demand(advertised === null || /^\d+$/.test(advertised) && Number(advertised) <= policy.maxResponseBytes, 'GOOGLE_RESPONSE_TOO_LARGE');
    const reader = response.body?.getReader?.(); demand(reader && typeof reader.read === 'function', 'GOOGLE_RESPONSE_STREAM_REQUIRED');
    const chunks = []; let size = 0;
    try {
      while (true) {
        ctx.assertLive(); const part = await reader.read(); ctx.assertLive();
        if (part.done) break;
        demand(part.value instanceof Uint8Array && part.value.length > 0, 'GOOGLE_RESPONSE_INVALID');
        demand(chunks.length < policy.maxResponseChunks, 'GOOGLE_RESPONSE_TOO_MANY_CHUNKS');
        size += part.value.length; demand(size <= policy.maxResponseBytes, 'GOOGLE_RESPONSE_TOO_LARGE'); chunks.push(part.value);
      }
    } finally { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} try { reader.releaseLock?.(); } catch {} }
    const bytes = Buffer.concat(chunks); ctx.assertLive();
    let data; try { data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); } catch { throw new AuthAdapterError('GOOGLE_RESPONSE_INVALID'); }
    demand(object(data), 'GOOGLE_RESPONSE_INVALID'); ctx.assertLive();
    return {data, headers: response.headers, receivedAtMs, receivedAtWall};
  };
  const keyFor = async (url, kid, ctx) => {
    const time = ctx.assertLive(), cached = keyCache.get(url);
    if (cached && cached.expiresAtMs > time && cached.wallExpiresAt > performance.now() && cached.keys.has(kid)) return cached.keys.get(kid);
    const result = await responseJson(url, {method: 'GET'}, ctx);
    const cacheControl = result.headers.get('cache-control') || '', ages = [...cacheControl.matchAll(/(?:^|,)\s*max-age=(\d+)\s*(?=,|$)/gi)];
    const ageHeader = result.headers.get('age'), age = ageHeader === null ? 0 : /^\d+$/.test(ageHeader) ? Number(ageHeader) : NaN;
    demand(ages.length === 1 && !/(?:^|,)\s*(?:no-store|no-cache)(?:\s|,|$)/i.test(cacheControl)
      && integer(age) && integer(Number(ages[0][1]), 1) && Number(ages[0][1]) > age, 'GOOGLE_KEY_CACHE_POLICY_INVALID');
    const lifetime = Math.min(policy.maxKeyCacheMs, (Number(ages[0][1]) - age) * 1000);
    let expiresAtMs = result.receivedAtMs + lifetime, wallExpiresAt = result.receivedAtWall + lifetime;
    demand(integer(expiresAtMs) && expiresAtMs > ctx.assertLive() && wallExpiresAt > performance.now(), 'GOOGLE_KEYS_EXPIRED');
    const entries = Object.entries(result.data); demand(entries.length > 0 && entries.length <= 32, 'GOOGLE_KEYS_INVALID');
    const keys = new Map();
    for (const [keyId, pem] of entries) {
      demand(identifier(keyId) && typeof pem === 'string' && pem.length <= 16384
        && /-----BEGIN (?:CERTIFICATE|PUBLIC KEY)-----/.test(pem) && !/PRIVATE KEY/.test(pem), 'GOOGLE_KEYS_INVALID');
      let key;
      try {
        key = createPublicKey(pem);
        if (pem.includes('BEGIN CERTIFICATE')) { const cert = new X509Certificate(pem), time = ctx.assertLive(), notAfter = Date.parse(cert.validTo);
          demand(Date.parse(cert.validFrom) <= time && notAfter > time, 'GOOGLE_KEYS_EXPIRED');
          expiresAtMs = Math.min(expiresAtMs, notAfter); wallExpiresAt = Math.min(wallExpiresAt, performance.now() + notAfter - time); }
      } catch (error) { if (error instanceof AuthAdapterError) throw error; throw new AuthAdapterError('GOOGLE_KEYS_INVALID'); }
      demand(key.type === 'public' && key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength >= 2048
        && key.asymmetricKeyDetails.modulusLength <= 8192, 'GOOGLE_KEYS_INVALID'); keys.set(keyId, key);
    }
    ctx.assertLive(); keyCache.set(url, {keys, expiresAtMs, wallExpiresAt});
    demand(keys.has(kid), 'JWT_KEY_NOT_FOUND'); return keys.get(kid);
  };
  const signature = async (jwt, url, ctx) => {
    const key = await keyFor(url, jwt.header.kid, ctx); ctx.assertLive();
    demand(verifySignature('RSA-SHA256', jwt.signingInput, key, jwt.signature), 'JWT_SIGNATURE_INVALID'); ctx.assertLive();
  };
  const adminCredential = async (projectId, purpose, scope, ctx) => {
    ctx.assertLive();
    const credential = await getAdminAccessToken(Object.freeze({projectId, purpose, scopes: Object.freeze([scope])}),
      Object.freeze({signal: ctx.controller.signal}));
    const time = ctx.assertLive();
    demand(object(credential) && credential.credentialType === 'google-oauth2' && integer(credential.expiresAtMs)
      && credential.expiresAtMs > time && Array.isArray(credential.scopes)
      && (credential.scopes.includes(scope) || credential.scopes.includes('https://www.googleapis.com/auth/cloud-platform'))
      && typeof credential.accessToken === 'string' && credential.accessToken.length > 0 && credential.accessToken.length <= 16000
      && !/[\s\x00-\x1f]/.test(credential.accessToken) && credential.accessToken.split('.').length !== 3, 'GOOGLE_ADMIN_CREDENTIAL_INVALID');
    ctx.limit(credential.expiresAtMs); return credential.accessToken;
  };
  const lookup = async (projectId, uid, ctx) => {
    demand([FA, FB].includes(projectId) && identifier(uid, 128), 'AUTH_LOOKUP_REQUEST_INVALID');
    if (gatewayMode) {
      const data = await privilegedGateway.lookupAuthUser(Object.freeze({projectId, uid}), ctx.requestContext());
      ctx.assertLive(); validateGatewayLookup(data);
      const user = normalizedUser(data, uid); ctx.assertLive(); return user;
    }
    let token = await adminCredential(projectId, 'auth-users-get', AUTH_SCOPE, ctx);
    try {
      ctx.assertLive();
      const result = await responseJson('https://identitytoolkit.googleapis.com/v1/projects/' + projectId + '/accounts:lookup',
        {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body: JSON.stringify({localId: [uid]})}, ctx);
      const age = result.headers.get('age');
      demand(age === null || /^0+$/.test(age), 'AUTH_LOOKUP_CACHED_RESPONSE');
      const user = normalizedUser(result.data, uid); ctx.assertLive(); return user;
    } finally { token = null; }
  };
  const verifyFaIdToken = execute(async (ctx, token, checkRevoked) => {
    demand(checkRevoked === true, 'FA_REVOCATION_CHECK_REQUIRED');
    const jwt = decodeJwt(token), googleUid = validateFaClaims(jwt.payload, ctx.assertLive(), policy);
    await signature(jwt, FA_CERTS, ctx);
    const user = await lookup(FA, jwt.payload.sub, ctx);
    demand(user.disabled === false && user.emailVerified === true, 'FA_AUTH_USER_DISABLED_OR_UNVERIFIED');
    const googleProviders = user.providerData.filter(provider => provider.providerId === 'google.com');
    demand(googleProviders.length === 1 && googleProviders[0].uid === googleUid, 'FA_AUTH_PROVIDER_CHANGED');
    demand(jwt.payload.auth_time * 1000 >= user.tokensValidAfterTimeMs, 'FA_TOKEN_REVOKED');
    validateFaClaims(jwt.payload, ctx.assertLive(), policy);
    return Object.freeze({uid: jwt.payload.sub, sub: jwt.payload.sub, aud: FA, iss: 'https://securetoken.google.com/' + FA,
      iat: jwt.payload.iat, exp: jwt.payload.exp, auth_time: jwt.payload.auth_time, email_verified: true,
      firebase: Object.freeze({sign_in_provider: 'google.com', identities: Object.freeze({'google.com': Object.freeze([googleUid])})})});
  });
  const getFaUser = execute(async (ctx, request) => {
    demand(object(request) && request.projectId === FA && identifier(request.uid, 128), 'FA_USER_REQUEST_INVALID');
    const user = await lookup(FA, request.uid, ctx);
    const providers = user.providerData.filter(provider => provider.providerId === 'google.com');
    demand(providers.length === 1, 'FA_AUTH_PROVIDER_CHANGED');
    return Object.freeze({schemaVersion: 1, projectId: FA, fromCache: false, hasPendingWrites: false,
      readTimeMs: ctx.assertLive(), user: Object.freeze({...user, googleUid: providers[0].uid})});
  });
  const getFbUser = execute(async (ctx, request) => {
    demand(object(request) && request.projectId === FB && identifier(request.uid, 128), 'FB_USER_REQUEST_INVALID');
    const user = await lookup(FB, request.uid, ctx);
    return Object.freeze({schemaVersion: 1, projectId: FB, fromCache: false, hasPendingWrites: false,
      readTimeMs: ctx.assertLive(), user});
  });
  const createFbCustomToken = execute(async (ctx, uid, suppliedClaims) => {
    demand(identifier(uid, 128), 'CUSTOM_TOKEN_UID_INVALID'); const claims = approvedClaims(suppliedClaims);
    const time = ctx.assertLive(); demand(claims.managementSourceAuthTimeMs <= time + policy.maxFutureSkewMs, 'CUSTOM_CLAIMS_TIME_INVALID');
    const iat = Math.floor(time / 1000), payload = {iss: signerServiceAccountEmail, sub: signerServiceAccountEmail,
      aud: FIREBASE_AUDIENCE, iat, exp: iat + policy.customTokenLifetimeSeconds, uid, claims};
    if (gatewayMode) {
      const data = await privilegedGateway.signFbCustomToken(Object.freeze({uid, claims, issuedAtSeconds: iat,
        expiresAtSeconds: payload.exp}), ctx.requestContext());
      ctx.assertLive(); jsonData(data);
      demand(exactKeys(data, ['keyId', 'signedJwt']) && identifier(data.keyId) && typeof data.signedJwt === 'string', 'GATEWAY_SIGN_RESPONSE_INVALID');
      const jwt = decodeJwt(data.signedJwt);
      demand(jwt.header.kid === data.keyId && same(jwt.payload, payload), 'IAM_SIGN_PAYLOAD_CHANGED');
      await signature(jwt, 'https://www.googleapis.com/service_accounts/v1/metadata/x509/' + signerServiceAccountEmail, ctx);
      demand(jwt.payload.exp * 1000 > ctx.assertLive(), 'CUSTOM_TOKEN_EXPIRED'); return data.signedJwt;
    }
    let token = await adminCredential(FB, 'iam-sign-jwt', IAM_SCOPE, ctx);
    try {
      const url = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + signerServiceAccountEmail + ':signJwt';
      ctx.assertLive();
      const response = await responseJson(url, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
        body: JSON.stringify({payload: JSON.stringify(payload)})}, ctx);
      demand(identifier(response.data.keyId) && typeof response.data.signedJwt === 'string', 'IAM_SIGN_RESPONSE_INVALID');
      const jwt = decodeJwt(response.data.signedJwt);
      demand(jwt.header.kid === response.data.keyId && same(jwt.payload, payload), 'IAM_SIGN_PAYLOAD_CHANGED');
      await signature(jwt, 'https://www.googleapis.com/service_accounts/v1/metadata/x509/' + signerServiceAccountEmail, ctx);
      demand(jwt.payload.exp * 1000 > ctx.assertLive(), 'CUSTOM_TOKEN_EXPIRED'); return response.data.signedJwt;
    } finally { token = null; }
  });
  return Object.freeze({verifyFaIdToken, getFaUser, getFbUser, createFbCustomToken,
    readFaAuthUser: getFaUser, readFbUser: getFbUser, signFbCustomToken: createFbCustomToken,
    dispose: () => { disposed = true; for (const cancel of active.values()) cancel('GOOGLE_AUTH_ABORTED'); active.clear(); keyCache.clear(); }});
}
