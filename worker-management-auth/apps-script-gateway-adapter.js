import {createManagementGatewayClient} from '../scripts/lib/management-gateway-client.js';
import {createManagementGatewayProtocol, MANAGEMENT_GATEWAY_OPERATIONS,
  MANAGEMENT_GATEWAY_PROTOCOL_VERSION, MANAGEMENT_GATEWAY_AUDIENCE} from '../scripts/lib/management-gateway-protocol.js';
import {MANAGEMENT_GATEWAY_LIMITS, MANAGEMENT_HMAC_KEY_ID, MANAGEMENT_POLICY_VERSION}
  from '../scripts/lib/management-gateway-config-preparation.js';
import {createManagementGatewayResponseNonceClaimer} from './admission-state.js';

const POLICY_KEYS = ['schemaVersion','protocolVersion','audience','keyId','maximumTtlMs','maxFutureSkewMs',
  'maxEnvelopeBytes','operationTimeoutMs','customTokenMaxTtlSeconds','enabledOperations'];
const DATA_OPERATIONS = ['READ_FA_AUTHORIZATION','READ_FB_LEASE','WRITE_FB_LEASE','INVALIDATE_FB_LEASE'];
const NONCE_KEYS = ['maxNonceRecords','maxPropertyBytes','maxStorageBytes','lockTimeoutMs','retentionMs'];
const own = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
class AppsScriptGatewayAdapterError extends Error {
  constructor(code) { super(code); this.name = 'AppsScriptGatewayAdapterError'; this.code = code; }
}
const fail = code => { throw new AppsScriptGatewayAdapterError(code); };

function disabledAdapter() {
  const disabled = async () => fail('GATEWAY_CLIENT_DISABLED');
  return Object.freeze({enabled:false,managementPolicyVersion:MANAGEMENT_POLICY_VERSION,
    lookupAuthUser:disabled, authorizeAndSignFaFirstLogin:disabled,
    signFbCustomToken:disabled, signFcCustomToken:disabled, dispose() {}});
}

function decodeSecret(value) {
  if (typeof value !== 'string' || value.length < 43 || value.length > 172 || !/^[A-Za-z0-9_-]+$/.test(value))
    fail('GATEWAY_SECRET_INVALID');
  let decoded;
  try { decoded = Buffer.from(value, 'base64url'); } catch { fail('GATEWAY_SECRET_INVALID'); }
  if (decoded.byteLength < 32 || decoded.byteLength > 128 || decoded.toString('base64url') !== value)
    fail('GATEWAY_SECRET_INVALID');
  return new Uint8Array(decoded);
}

function validatePolicy(policy) {
  if (!own(policy, POLICY_KEYS) || policy.schemaVersion !== 1
    || policy.protocolVersion !== MANAGEMENT_GATEWAY_PROTOCOL_VERSION || policy.audience !== MANAGEMENT_GATEWAY_AUDIENCE
    || policy.keyId !== MANAGEMENT_HMAC_KEY_ID
    || policy.maximumTtlMs !== MANAGEMENT_GATEWAY_LIMITS.maximumTtlMs
    || policy.maxFutureSkewMs !== MANAGEMENT_GATEWAY_LIMITS.maxFutureSkewMs
    || policy.maxEnvelopeBytes !== MANAGEMENT_GATEWAY_LIMITS.maxEnvelopeBytes
    || policy.operationTimeoutMs !== MANAGEMENT_GATEWAY_LIMITS.operationTimeoutMs
    || policy.customTokenMaxTtlSeconds !== MANAGEMENT_GATEWAY_LIMITS.customTokenMaxTtlSeconds
    || !policy.enabledOperations || !MANAGEMENT_GATEWAY_OPERATIONS.every(op => Object.hasOwn(policy.enabledOperations,op))
    || Object.keys(policy.enabledOperations).some(op => ![...MANAGEMENT_GATEWAY_OPERATIONS,...DATA_OPERATIONS].includes(op))
    || DATA_OPERATIONS.some(op => policy.enabledOperations[op] !== undefined && typeof policy.enabledOperations[op] !== 'boolean')
    || MANAGEMENT_GATEWAY_OPERATIONS.some(operation => typeof policy.enabledOperations[operation] !== 'boolean'))
    fail('GATEWAY_POLICY_INVALID');
  return policy;
}

function validateNoncePolicy(policy) {
  if (!own(policy, NONCE_KEYS) || ![MANAGEMENT_GATEWAY_LIMITS.maxNonceRecords,1536].includes(policy.maxNonceRecords)
    || policy.maxPropertyBytes !== MANAGEMENT_GATEWAY_LIMITS.maxPropertyBytes
    || policy.maxStorageBytes !== MANAGEMENT_GATEWAY_LIMITS.maxStorageBytes
    || policy.lockTimeoutMs !== MANAGEMENT_GATEWAY_LIMITS.lockTimeoutMs
    || policy.retentionMs !== MANAGEMENT_GATEWAY_LIMITS.retentionMs)
    fail('GATEWAY_NONCE_POLICY_INVALID');
  return policy;
}

/**
 * Server-only adapter implementing the privilegedGateway contract consumed by
 * management-google-auth-adapter.js and management-fa-first-login.js. It uses
 * the existing signed POST + bounded ContentService redirect GET client.
 */
export function createManagementAppsScriptGatewayAdapter({enabled = false, endpoint, secretBase64Url, policy,
  noncePolicy = {maxNonceRecords:512,maxPropertyBytes:8192,maxStorageBytes:400000,lockTimeoutMs:1000,retentionMs:300000}, claimResponseNonce, fetchImpl = globalThis.fetch,
  clock = Date.now, monotonicClock = () => performance.now(), newRequestId, newNonce} = {}) {
  if (enabled !== true) return disabledAdapter();
  validatePolicy(policy); validateNoncePolicy(noncePolicy);
  if (typeof endpoint !== 'string' || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(endpoint))
    fail('GATEWAY_ENDPOINT_INVALID');
  if (typeof fetchImpl !== 'function' || typeof clock !== 'function' || typeof monotonicClock !== 'function')
    fail('GATEWAY_CLIENT_CONFIG_INVALID');
  if (typeof claimResponseNonce !== 'function') fail('GATEWAY_NONCE_STATE_REQUIRED');
  const secret = decodeSecret(secretBase64Url);
  let protocol;
  try { protocol = createManagementGatewayProtocol({policy,secret,now:clock,monotonicNow:monotonicClock}); }
  catch { secret.fill(0); fail('GATEWAY_PROTOCOL_CONFIG_INVALID'); }
  const client = createManagementGatewayClient({enabled:true, protocol, endpoint, fetchImpl,
    policy:{maxRequestMs:Math.min(policy.operationTimeoutMs,policy.maximumTtlMs),
      maxResponseBytes:policy.maxEnvelopeBytes,maxResponseChunks:512},
    claimResponseNonce,clock,
    ...(newRequestId === undefined ? {} : {newRequestId}), ...(newNonce === undefined ? {} : {newNonce})});
  const guarded = (operation, work) => (...args) => {
    if (policy.enabledOperations[operation] !== true) return Promise.reject(new AppsScriptGatewayAdapterError('GATEWAY_CLIENT_DISABLED'));
    try { return work(...args); } catch { return Promise.reject(new AppsScriptGatewayAdapterError('GATEWAY_CLIENT_UNAVAILABLE')); }
  };
  const lookupAuthUser = async (request, context) => {
    if (!request || typeof request !== 'object' || !['sahmt-17a16','sahmt-gestao-5ae66','indicadores---sahmt'].includes(request.projectId))
      fail('GATEWAY_LOOKUP_REQUEST_INVALID');
    const operation = request.projectId === 'sahmt-17a16' ? 'AUTH_USER_LOOKUP_FA'
      : request.projectId === 'sahmt-gestao-5ae66' ? 'AUTH_USER_LOOKUP_FB' : 'AUTH_USER_LOOKUP_FC';
    if (policy.enabledOperations[operation] !== true) fail('GATEWAY_CLIENT_DISABLED');
    return client.lookupAuthUser(request,context);
  };
  const bindings = Object.freeze({
    lookupAuthUser,
    readFaAuthorization: guarded('READ_FA_AUTHORIZATION',client.readFaAuthorization),
    readFbLease: guarded('READ_FB_LEASE',client.readFbLease),
    writeFbLease: guarded('WRITE_FB_LEASE',client.writeFbLease),
    invalidateFbLease: guarded('INVALIDATE_FB_LEASE',client.invalidateFbLease),
    authorizeAndSignFaFirstLogin: guarded('FIRST_LOGIN_FA_SIGN',client.authorizeAndSignFaFirstLogin),
    signFbCustomToken: guarded('SIGN_FB_CUSTOM_TOKEN',client.signFbCustomToken),
    signFcCustomToken: guarded('SIGN_FC_CUSTOM_TOKEN',client.signFcCustomToken)
  });
  return Object.freeze({enabled:true,managementPolicyVersion:MANAGEMENT_POLICY_VERSION,...bindings,
    dispose(){client.dispose();protocol.dispose();secret.fill(0);}});
}

/**
 * Reads only server-side Worker bindings. Missing or false activation remains
 * fully disabled and does not inspect the endpoint or secret binding.
 */
export function createManagementAppsScriptGatewayFromEnv({env, stateBinding = env?.BROKER_STATE, fetchImpl = globalThis.fetch,
  clock = Date.now, monotonicClock = () => performance.now()} = {}) {
  if (!env || typeof env !== 'object' || env.MANAGEMENT_GATEWAY_ENABLED !== 'true') return disabledAdapter();
  let policy, noncePolicy;
  try {
    if (typeof env.MANAGEMENT_GATEWAY_POLICY_JSON !== 'string' || env.MANAGEMENT_GATEWAY_POLICY_JSON.length > 4096
      || typeof env.MANAGEMENT_GATEWAY_NONCE_POLICY_JSON !== 'string' || env.MANAGEMENT_GATEWAY_NONCE_POLICY_JSON.length > 1024)
      fail('GATEWAY_CONFIG_INVALID');
    policy = JSON.parse(env.MANAGEMENT_GATEWAY_POLICY_JSON);
    noncePolicy = JSON.parse(env.MANAGEMENT_GATEWAY_NONCE_POLICY_JSON);
    validatePolicy(policy); validateNoncePolicy(noncePolicy);
    if (env.MANAGEMENT_GATEWAY_MANAGEMENT_POLICY_VERSION !== MANAGEMENT_POLICY_VERSION)
      fail('GATEWAY_CONFIG_INVALID');
  } catch { fail('GATEWAY_CONFIG_INVALID'); }
  const claimResponseNonce = createManagementGatewayResponseNonceClaimer({stateBinding,now:clock,
    maxNonceRecords:noncePolicy.maxNonceRecords,retentionMs:noncePolicy.retentionMs});
  return createManagementAppsScriptGatewayAdapter({enabled:true,endpoint:env.MANAGEMENT_GATEWAY_SCRIPT_URL,
    secretBase64Url:env.MANAGEMENT_GATEWAY_HMAC_SECRET_BASE64URL,policy,noncePolicy,claimResponseNonce,
    fetchImpl,clock,monotonicClock});
}

export const MANAGEMENT_GATEWAY_ADAPTER_METHODS = Object.freeze(['lookupAuthUser','authorizeAndSignFaFirstLogin',
  'signFbCustomToken','signFcCustomToken']);
