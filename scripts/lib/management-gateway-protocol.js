import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

// Local server protocol only: no transport, credentials, deployment or ledger.
export const MANAGEMENT_GATEWAY_PROTOCOL_VERSION = 'SAHMT_MANAGEMENT_GATEWAY_V1';
export const MANAGEMENT_GATEWAY_AUDIENCE = 'sahmt-management-dedicated-appscript-v1';
export const MANAGEMENT_GATEWAY_OPERATIONS = Object.freeze(['AUTH_USER_LOOKUP_FA', 'AUTH_USER_LOOKUP_FB', 'SIGN_FB_CUSTOM_TOKEN']);
export const MANAGEMENT_GATEWAY_DENIAL_CODES = Object.freeze(['GATEWAY_DISABLED', 'GATEWAY_ADMISSION_DENIED',
  'GATEWAY_REPLAY_DENIED', 'GATEWAY_OPERATION_FAILED', 'GATEWAY_OPERATION_TIMEOUT', 'GATEWAY_RESULT_INVALID', 'GATEWAY_ABORTED']);
const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
const REQUEST = 'WORKER_TO_APPS_SCRIPT', RESPONSE = 'APPS_SCRIPT_TO_WORKER';
const CLAIMS = ['managementSourceProjectId', 'managementMemberId', 'managementSourceVersion',
  'managementSourceHash', 'managementPolicyVersion', 'managementSourceAuthTimeMs'];
const ENVELOPE = ['schemaVersion', 'protocolVersion', 'audience', 'keyId', 'direction', 'sourceProjectId',
  'destinationProjectId', 'operation', 'requestId', 'nonce', 'issuedAtMs', 'expiresAtMs', 'body', 'bodySha256', 'signature'];
const META = ['schemaVersion', 'namespace', 'direction', 'requestHash', 'envelopeHash', 'requestId', 'nonce', 'operation',
  'keyId', 'sourceProjectId', 'destinationProjectId', 'issuedAtMs', 'expiresAtMs'];
const RECEIPT_FLAGS = ['status', 'durable', 'atomic', 'budgetAllowed', 'capacityAllowed', 'retained'];
const POLICY = ['schemaVersion', 'protocolVersion', 'audience', 'keyId', 'maximumTtlMs', 'maxFutureSkewMs',
  'maxEnvelopeBytes', 'operationTimeoutMs', 'customTokenMaxTtlSeconds'];
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max;
const identifier = (v, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\s/\x00-\x1f]/.test(v);
const keyIdentifier = v => typeof v === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(v);
const hex = (v, length) => typeof v === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(v);
const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
class GatewayError extends Error { constructor(code) { super(code); this.name = 'ManagementGatewayError'; this.code = code; } }
const demand = (value, code) => { if (!value) throw new GatewayError(code); };
const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const copy = v => JSON.parse(gatewayCanonicalJson(v));

// Access data through descriptors, so validation never executes a getter.
export function gatewayCanonicalJson(value, {maxBytes = 65536, maxNodes = 4096, maxDepth = 16} = {}) {
  demand(integer(maxBytes, 1, 262144) && integer(maxNodes, 1, 16384) && integer(maxDepth, 1, 32), 'GATEWAY_JSON_LIMIT_INVALID');
  let nodes = 0, bytes = 0; const visiting = new Set(), pieces = [];
  const append = part => { bytes += Buffer.byteLength(part); demand(bytes <= maxBytes, 'GATEWAY_JSON_TOO_LARGE'); pieces.push(part); };
  const primitive = v => { demand(typeof v !== 'string' || v.length <= maxBytes, 'GATEWAY_JSON_TOO_LARGE'); append(JSON.stringify(v)); };
  const walk = (v, depth) => {
    demand(++nodes <= maxNodes && depth <= maxDepth, 'GATEWAY_JSON_LIMIT_EXCEEDED');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') { primitive(v); return; }
    if (typeof v === 'number') { demand(integer(v, -Number.MAX_SAFE_INTEGER), 'GATEWAY_JSON_NUMBER_INVALID'); primitive(v); return; }
    demand(plain(v) || Array.isArray(v), 'GATEWAY_JSON_INVALID');
    demand(!visiting.has(v), 'GATEWAY_JSON_INVALID'); visiting.add(v);
    if (Array.isArray(v)) demand(Object.getPrototypeOf(v) === Array.prototype && v.length <= maxNodes, 'GATEWAY_JSON_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
    demand(keys.length <= maxNodes + 1 && keys.every(k => typeof k === 'string'), 'GATEWAY_JSON_INVALID');
    const dataKeys = keys.filter(k => !(Array.isArray(v) && k === 'length'));
    for (const k of dataKeys) {
      const d = descriptors[k]; demand(Object.hasOwn(d, 'value') && d.enumerable === true, 'GATEWAY_JSON_INVALID');
      demand(k.length <= maxBytes, 'GATEWAY_JSON_TOO_LARGE');
    }
    if (Array.isArray(v)) {
      demand(dataKeys.length === v.length && dataKeys.every(k => /^(0|[1-9]\d*)$/.test(k) && Number(k) < v.length), 'GATEWAY_JSON_INVALID');
      append('['); for (let n = 0; n < v.length; n++) { if (n) append(','); walk(descriptors[String(n)].value, depth + 1); } append(']');
    } else {
      append('{'); dataKeys.sort().forEach((k, n) => { if (n) append(','); primitive(k); append(':'); walk(descriptors[k].value, depth + 1); }); append('}');
    }
    visiting.delete(v);
  };
  walk(value, 0); return pieces.join('');
}
export const gatewayEnvelopeHash = envelope => createHash('sha256').update(gatewayCanonicalJson(envelope)).digest('hex');
const hash = (v, maxBytes) => createHash('sha256').update(gatewayCanonicalJson(v, {maxBytes})).digest('hex');
const withoutSignature = v => Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'signature'));

function policyCopy(input) {
  gatewayCanonicalJson(input);
  demand(plain(input) && POLICY.every(k => Object.hasOwn(input, k))
    && Object.keys(input).every(k => POLICY.includes(k) || k === 'enabledOperations'), 'GATEWAY_POLICY_INVALID');
  const p = copy(input);
  demand(p.schemaVersion === 1 && p.protocolVersion === MANAGEMENT_GATEWAY_PROTOCOL_VERSION && p.audience === MANAGEMENT_GATEWAY_AUDIENCE
    && keyIdentifier(p.keyId) && integer(p.maximumTtlMs, 1, 120000) && integer(p.maxFutureSkewMs, 0, 60000)
    && integer(p.maxEnvelopeBytes, 1024, 65536) && integer(p.operationTimeoutMs, 1, 120000)
    && integer(p.customTokenMaxTtlSeconds, 1, 3600), 'GATEWAY_POLICY_INVALID');
  if (p.enabledOperations === undefined) p.enabledOperations = Object.fromEntries(MANAGEMENT_GATEWAY_OPERATIONS.map(op => [op, false]));
  demand(exact(p.enabledOperations, MANAGEMENT_GATEWAY_OPERATIONS)
    && MANAGEMENT_GATEWAY_OPERATIONS.every(op => typeof p.enabledOperations[op] === 'boolean'), 'GATEWAY_POLICY_INVALID');
  return p;
}
function validateClaims(claims, policy) {
  demand(exact(claims, CLAIMS) && claims.managementSourceProjectId === FA && identifier(claims.managementMemberId, 200)
    && integer(claims.managementSourceVersion, 1) && hex(claims.managementSourceHash, 64)
    && identifier(claims.managementPolicyVersion, 100) && integer(claims.managementSourceAuthTimeMs, 1)
    && Buffer.byteLength(gatewayCanonicalJson(claims)) <= 1000, 'GATEWAY_SIGN_BODY_INVALID');
}
function validateRequestBody(body, op, request, policy, time) {
  if (op !== 'SIGN_FB_CUSTOM_TOKEN') { demand(exact(body, ['uid']) && identifier(body.uid), 'GATEWAY_LOOKUP_BODY_INVALID'); return; }
  demand(exact(body, ['uid', 'claims', 'issuedAtSeconds', 'expiresAtSeconds']) && identifier(body.uid), 'GATEWAY_SIGN_BODY_INVALID');
  validateClaims(body.claims, policy);
  const iat = body.issuedAtSeconds, exp = body.expiresAtSeconds;
  demand(integer(iat, 1) && integer(exp, 1) && integer(iat * 1000, 1) && integer(exp * 1000, 1)
    && exp > iat && exp - iat <= policy.customTokenMaxTtlSeconds && iat * 1000 <= time + policy.maxFutureSkewMs
    && exp * 1000 > time && iat * 1000 >= request.issuedAtMs - policy.maxFutureSkewMs - 999
    && body.claims.managementSourceAuthTimeMs <= iat * 1000 + policy.maxFutureSkewMs, 'GATEWAY_SIGN_TIME_INVALID');
}
function validateResult(body, op, request) {
  if (op === 'SIGN_FB_CUSTOM_TOKEN') {
    demand(exact(body, ['keyId', 'signedJwt']) && keyIdentifier(body.keyId) && typeof body.signedJwt === 'string'
      && body.signedJwt.length <= 16000 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.signedJwt), 'GATEWAY_RESULT_INVALID'); return;
  }
  demand(exact(body, ['users']) && Array.isArray(body.users) && body.users.length <= 1, 'GATEWAY_RESULT_INVALID');
  for (const user of body.users) {
    demand(plain(user) && ['localId', 'emailVerified', 'providerUserInfo'].every(k => Object.hasOwn(user, k))
      && Object.keys(user).every(k => ['localId', 'emailVerified', 'providerUserInfo', 'disabled', 'validSince'].includes(k))
      && user.localId === request.body.uid && typeof user.emailVerified === 'boolean'
      && (user.disabled === undefined || typeof user.disabled === 'boolean') && Array.isArray(user.providerUserInfo)
      && user.providerUserInfo.length <= 20, 'GATEWAY_RESULT_INVALID');
    if (user.validSince !== undefined) demand(typeof user.validSince === 'string' && /^(0|[1-9]\d*)$/.test(user.validSince)
      && integer(Number(user.validSince) * 1000), 'GATEWAY_RESULT_INVALID');
    const providers = new Set();
    for (const provider of user.providerUserInfo) {
      demand(exact(provider, ['providerId', 'rawId']) && identifier(provider.providerId) && identifier(provider.rawId)
        && !providers.has(provider.providerId), 'GATEWAY_RESULT_INVALID'); providers.add(provider.providerId);
    }
  }
}

export function createManagementGatewayProtocol({policy, secret, now = Date.now, monotonicNow = () => performance.now()} = {}) {
  const p = policyCopy(policy);
  demand(secret instanceof Uint8Array && secret.byteLength >= 32 && secret.byteLength <= 1024, 'GATEWAY_SECRET_INVALID');
  demand(typeof now === 'function' && typeof monotonicNow === 'function', 'GATEWAY_CLOCK_INVALID');
  const key = Buffer.from(secret); let disposed = false, lastWall = 0, lastMono = 0; const active = new Set();
  const time = () => {
    demand(!disposed, 'GATEWAY_DISABLED'); let wall, mono;
    try { wall = now(); mono = monotonicNow(); } catch { throw new GatewayError('GATEWAY_CLOCK_INVALID'); }
    demand(integer(wall, 1) && typeof mono === 'number' && Number.isFinite(mono) && mono >= 0
      && wall >= lastWall && mono >= lastMono, 'GATEWAY_CLOCK_INVALID'); lastWall = wall; lastMono = mono; return {wall, mono};
  };
  const signature = (v, direction) => createHmac('sha256', key).update('SAHMT_MANAGEMENT_GATEWAY_V1_'
    + (direction === REQUEST ? 'REQUEST' : 'RESPONSE') + '\n' + gatewayCanonicalJson(withoutSignature(v), {maxBytes: p.maxEnvelopeBytes})).digest('hex');
  const validateEnvelope = (input, direction, request) => {
    gatewayCanonicalJson(input, {maxBytes: p.maxEnvelopeBytes});
    const t = time(), fields = direction === REQUEST ? ENVELOPE : [...ENVELOPE, 'requestHash', 'status', 'code'];
    demand(exact(input, fields) && input.schemaVersion === 1 && input.protocolVersion === p.protocolVersion && input.audience === p.audience
      && input.keyId === p.keyId && input.direction === direction && input.sourceProjectId === FA && input.destinationProjectId === FB
      && MANAGEMENT_GATEWAY_OPERATIONS.includes(input.operation) && hex(input.requestId, 32) && hex(input.nonce, 32), 'GATEWAY_ENVELOPE_INVALID');
    demand(integer(input.issuedAtMs, 1) && integer(input.expiresAtMs, 1) && input.expiresAtMs > input.issuedAtMs
      && input.expiresAtMs - input.issuedAtMs <= p.maximumTtlMs && input.issuedAtMs <= t.wall + p.maxFutureSkewMs
      && t.wall < input.expiresAtMs, 'GATEWAY_ENVELOPE_TIME_INVALID');
    demand(hex(input.bodySha256, 64) && input.bodySha256 === hash(input.body, p.maxEnvelopeBytes) && hex(input.signature, 64)
      && timingSafeEqual(Buffer.from(input.signature, 'hex'), Buffer.from(signature(input, direction), 'hex')), 'GATEWAY_SIGNATURE_INVALID');
    if (direction === REQUEST) validateRequestBody(input.body, input.operation, input, p, t.wall);
    else {
      const linked = ['schemaVersion', 'protocolVersion', 'audience', 'keyId', 'sourceProjectId', 'destinationProjectId',
        'operation', 'requestId', 'nonce', 'issuedAtMs', 'expiresAtMs'];
      demand(linked.every(k => input[k] === request[k]) && input.requestHash === gatewayEnvelopeHash(request), 'GATEWAY_RESPONSE_BINDING_INVALID');
      demand(input.status === 'SUCCESS' || input.status === 'DENIED', 'GATEWAY_RESULT_INVALID');
      if (input.status === 'SUCCESS') { demand(input.code === 'OK', 'GATEWAY_RESULT_INVALID'); validateResult(input.body, input.operation, request); }
      else demand(MANAGEMENT_GATEWAY_DENIAL_CODES.includes(input.code) && input.body === null, 'GATEWAY_RESULT_INVALID');
    }
    return copy(input);
  };
  const verifyRequest = request => validateEnvelope(request, REQUEST);
  const createRequest = input => {
    gatewayCanonicalJson(input, {maxBytes: p.maxEnvelopeBytes});
    demand(exact(input, ['operation', 'requestId', 'nonce', 'issuedAtMs', 'expiresAtMs', 'body']), 'GATEWAY_REQUEST_INPUT_INVALID');
    const request = {schemaVersion: 1, protocolVersion: p.protocolVersion, audience: p.audience, keyId: p.keyId,
      direction: REQUEST, sourceProjectId: FA, destinationProjectId: FB, ...copy(input), bodySha256: hash(input.body, p.maxEnvelopeBytes), signature: ''};
    request.signature = signature(request, REQUEST); return verifyRequest(request);
  };
  const createResponse = (input, result) => {
    const request = verifyRequest(input); gatewayCanonicalJson(result, {maxBytes: p.maxEnvelopeBytes});
    demand(exact(result, ['status', 'code', 'body']), 'GATEWAY_RESULT_INVALID');
    const response = {...request, direction: RESPONSE, ...copy(result), bodySha256: hash(result.body, p.maxEnvelopeBytes),
      requestHash: gatewayEnvelopeHash(request), signature: ''}; response.signature = signature(response, RESPONSE);
    return validateEnvelope(response, RESPONSE, request);
  };
  const verifyResponse = (response, request) => {
    const verified = verifyRequest(request), result = validateEnvelope(response, RESPONSE, verified);
    return copy({status: result.status, code: result.code, body: result.body});
  };
  function bounded(envelope, context) {
    const started = time();
        demand(plain(context), 'GATEWAY_CONTEXT_INVALID');
    let signal, addListener, removeListener;
    try {
      signal = context.signal;
      demand(signal === undefined || signal !== null && typeof signal === 'object' && typeof signal.aborted === 'boolean'
        && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function', 'GATEWAY_CONTEXT_INVALID');
      if (signal) { addListener = signal.addEventListener.bind(signal); removeListener = signal.removeEventListener.bind(signal); }
    } catch { throw new GatewayError('GATEWAY_CONTEXT_INVALID'); }
    const signalAborted = () => { try { demand(signal === undefined || typeof signal.aborted === 'boolean', 'GATEWAY_CONTEXT_INVALID'); return signal?.aborted === true; }
      catch { throw new GatewayError('GATEWAY_CONTEXT_INVALID'); } };
    if (context.deadlineMs !== undefined) demand(integer(context.deadlineMs, 1), 'GATEWAY_CONTEXT_INVALID');
    const deadlineMs = Math.min(envelope.expiresAtMs, context.deadlineMs ?? envelope.expiresAtMs, started.wall + p.operationTimeoutMs);
    const monoDeadline = started.mono + Math.max(0, deadlineMs - started.wall), controller = new AbortController();
    let timer, settled = false, rejectCancel;
    const cancelled = new Promise((_, reject) => { rejectCancel = reject; });
    // The promise always has a handler, including synchronous cancellation before the first invoke.
    cancelled.catch(() => {});
    const cancel = code => { if (!settled) { controller.abort(); rejectCancel(new GatewayError(code)); } };
    active.add(cancel);
    const assertLive = () => {
      demand(!disposed && !signalAborted() && !controller.signal.aborted, 'GATEWAY_ABORTED');
      const t = time(); demand(t.wall < deadlineMs && t.mono < monoDeadline, 'GATEWAY_OPERATION_TIMEOUT'); return t.wall;
    };
    const onAbort = () => cancel('GATEWAY_ABORTED');
    const removeAbort = () => { try { removeListener?.('abort', onAbort); } catch { /* Cleanup cannot expose host errors or prevent abort. */ } };
    try { try { addListener?.('abort', onAbort, {once: true}); } catch { throw new GatewayError('GATEWAY_CONTEXT_INVALID'); }
      timer = setTimeout(() => cancel('GATEWAY_OPERATION_TIMEOUT'), Math.max(1, Math.ceil(deadlineMs - started.wall)));
      assertLive();
    } catch (error) { clearTimeout(timer); removeAbort(); active.delete(cancel); controller.abort(); throw error; }
    return {
      assertLive, context: () => ({signal: controller.signal, deadlineMs}),
      invoke: async (work, failureCode) => {
        assertLive(); const task = Promise.resolve().then(() => { assertLive(); return work(); });
        try { const result = await Promise.race([task, cancelled]); assertLive(); return result; }
        catch (error) { if (error instanceof GatewayError) throw new GatewayError(error.code); throw new GatewayError(failureCode); }
      },
      close: () => { settled = true; clearTimeout(timer); removeAbort(); active.delete(cancel); controller.abort(); }
    };
  }
  function claimMetadata(envelope, request) {
    return {schemaVersion: 1, namespace: p.protocolVersion + ':' + p.audience + ':' + envelope.direction,
      direction: envelope.direction, requestHash: gatewayEnvelopeHash(request), envelopeHash: gatewayEnvelopeHash(envelope),
      requestId: envelope.requestId, nonce: envelope.nonce, operation: envelope.operation, keyId: envelope.keyId,
      sourceProjectId: envelope.sourceProjectId, destinationProjectId: envelope.destinationProjectId,
      issuedAtMs: envelope.issuedAtMs, expiresAtMs: envelope.expiresAtMs};
  }
  const admit = async (envelope, request, claimNonce, ctx) => {
    demand(typeof claimNonce === 'function', 'GATEWAY_ADMISSION_DENIED'); const metadata = claimMetadata(envelope, request);
    const receipt = await ctx.invoke(() => claimNonce(copy(metadata), ctx.context()), 'GATEWAY_ADMISSION_DENIED');
    try { gatewayCanonicalJson(receipt); } catch { throw new GatewayError('GATEWAY_ADMISSION_DENIED'); }
    if (plain(receipt) && receipt.status === 'REPLAY') throw new GatewayError('GATEWAY_REPLAY_DENIED');
    demand(exact(receipt, [...META, ...RECEIPT_FLAGS]) && META.every(k => receipt[k] === metadata[k])
      && receipt.status === 'CLAIMED' && ['durable', 'atomic', 'budgetAllowed', 'capacityAllowed', 'retained'].every(k => receipt[k] === true), 'GATEWAY_ADMISSION_DENIED');
    ctx.assertLive();
  };
  const handlerCopy = (handlers, op) => {
    if (handlers === undefined) return null;
    demand(plain(handlers), 'GATEWAY_DISABLED');
    const descriptors = Object.getOwnPropertyDescriptors(handlers);
    demand(Reflect.ownKeys(descriptors).every(k => typeof k === 'string' && MANAGEMENT_GATEWAY_OPERATIONS.includes(k)
      && Object.hasOwn(descriptors[k], 'value') && descriptors[k].enumerable), 'GATEWAY_DISABLED');
    const handler = descriptors[op]?.value; if (handler === undefined) return null;
    demand(plain(handler), 'GATEWAY_DISABLED'); const fields = Object.getOwnPropertyDescriptors(handler);
    demand(Reflect.ownKeys(fields).length === 2 && ['enabled', 'dispatch'].every(k => fields[k]?.enumerable === true && Object.hasOwn(fields[k], 'value')), 'GATEWAY_DISABLED');
    demand(typeof fields.enabled.value === 'boolean' && typeof fields.dispatch.value === 'function', 'GATEWAY_DISABLED');
    return {enabled: fields.enabled.value, dispatch: fields.dispatch.value};
  };
  const receiveRequest = async (input, context = {}) => {
    const request = verifyRequest(input); let ctx;
    try {
      const handler = handlerCopy(context.handlers, request.operation);
      demand(p.enabledOperations[request.operation] === true && handler?.enabled === true, 'GATEWAY_DISABLED');
      ctx = bounded(request, context); await admit(request, request, context.claimNonce, ctx);
      const result = await ctx.invoke(() => handler.dispatch(copy(request.body), {...ctx.context(), operation: request.operation,
        projectId: request.operation === 'AUTH_USER_LOOKUP_FA' ? FA : FB}), 'GATEWAY_OPERATION_FAILED');
      ctx.assertLive();
      try { return createResponse(request, {status: 'SUCCESS', code: 'OK', body: result}); }
      catch (error) { if (error instanceof GatewayError && ['GATEWAY_RESULT_INVALID', 'GATEWAY_JSON_INVALID', 'GATEWAY_JSON_TOO_LARGE',
        'GATEWAY_JSON_LIMIT_EXCEEDED', 'GATEWAY_JSON_NUMBER_INVALID'].includes(error.code)) throw new GatewayError('GATEWAY_RESULT_INVALID'); throw error; }
    } catch (error) {
      const code = error instanceof GatewayError && MANAGEMENT_GATEWAY_DENIAL_CODES.includes(error.code) ? error.code : 'GATEWAY_OPERATION_FAILED';
      return createResponse(request, {status: 'DENIED', code, body: null});
    } finally { ctx?.close(); }
  };
  const acceptResponse = async (input, requestInput, context = {}) => {
    const request = verifyRequest(requestInput), result = verifyResponse(input, request);
    demand(p.enabledOperations[request.operation] === true, 'GATEWAY_DISABLED'); const ctx = bounded(request, context);
    try { await admit(copy(input), request, context.claimNonce, ctx); ctx.assertLive(); return copy(result); } finally { ctx.close(); }
  };
  return Object.freeze({createRequest, verifyRequest, createResponse, verifyResponse, receiveRequest, acceptResponse,
    dispose: () => { if (!disposed) { disposed = true; key.fill(0); for (const cancel of active) cancel('GATEWAY_ABORTED'); } }});
}