import {createHash, timingSafeEqual} from 'node:crypto';
import {gatewayCanonicalJson, MANAGEMENT_GATEWAY_AUDIENCE, MANAGEMENT_GATEWAY_OPERATIONS, MANAGEMENT_GATEWAY_DATA_OPERATIONS,
  MANAGEMENT_GATEWAY_PROTOCOL_VERSION} from './management-gateway-protocol.js';

export const MANAGEMENT_POLICY_VERSION = 'sahmt-management-authz-v1';
export const MANAGEMENT_HMAC_KEY_ID = 'sahmt-appscript-gateway-hmac-v1';
export const MANAGEMENT_SIGNERS = Object.freeze({
  FA: 'sahmt-fa-token-signer@sahmt-17a16.iam.gserviceaccount.com',
  FB: 'sahmt-fb-token-signer@sahmt-gestao-5ae66.iam.gserviceaccount.com',
  FC: 'sahmt-fc-token-signer@indicadores---sahmt.iam.gserviceaccount.com'
});

export const MANAGEMENT_GATEWAY_LIMITS = Object.freeze({
  maximumTtlMs: 20000,
  maxFutureSkewMs: 5000,
  maxEnvelopeBytes: 65536,
  operationTimeoutMs: 20000,
  customTokenMaxTtlSeconds: 600,
  maxGoogleResponseBytes: 65536,
  maxNonceRecords: 512,
  maxPropertyBytes: 8192,
  maxStorageBytes: 400000,
  lockTimeoutMs: 1000,
  retentionMs: 300000
});

const ownKeys = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const lowerHex = (value, length) => typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 100
  && !/[\s/\x00-\x1f]/.test(value);
const safeInteger = (value, min, max) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const signerPattern = projectId => new RegExp('^[a-z][a-z0-9-]{4,28}[a-z0-9]@'
  + projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.iam\\.gserviceaccount\\.com$');

function demand(condition, code) { if (!condition) throw new Error(code); }

export function createDisabledManagementGatewayConfig({actorEmail,
  includeRuntimeOperations = false, managementPolicyVersion = MANAGEMENT_POLICY_VERSION, keyId = MANAGEMENT_HMAC_KEY_ID} = {}) {
  demand(typeof actorEmail === 'string' && actorEmail.trim().length > 0 && actorEmail.trim().length <= 254,
    'GATEWAY_ACTOR_EMAIL_REQUIRED');
  const normalizedEmail = actorEmail.trim().toLowerCase();
  demand(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail), 'GATEWAY_ACTOR_EMAIL_INVALID');
  demand(identifier(managementPolicyVersion), 'GATEWAY_MANAGEMENT_POLICY_VERSION_INVALID');
  demand(typeof keyId === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(keyId), 'GATEWAY_KEY_ID_INVALID');

  demand(typeof includeRuntimeOperations === 'boolean', 'GATEWAY_CONFIG_INVALID');
  const operations = [...MANAGEMENT_GATEWAY_OPERATIONS,...(includeRuntimeOperations?MANAGEMENT_GATEWAY_DATA_OPERATIONS:[])];
  const enabledOperations = Object.fromEntries(operations.map(operation => [operation, false]));
  const config = {
    schemaVersion: 1,
    enabled: false,
    actorEmailSha256: createHash('sha256').update(normalizedEmail, 'utf8').digest('hex'),
    faSignerServiceAccountEmail: MANAGEMENT_SIGNERS.FA,
    signerServiceAccountEmail: MANAGEMENT_SIGNERS.FB,
    fcSignerServiceAccountEmail: MANAGEMENT_SIGNERS.FC,
    managementPolicyVersion,
    maxGoogleResponseBytes: MANAGEMENT_GATEWAY_LIMITS.maxGoogleResponseBytes,
    policy: {
      schemaVersion: 1,
      protocolVersion: MANAGEMENT_GATEWAY_PROTOCOL_VERSION,
      audience: MANAGEMENT_GATEWAY_AUDIENCE,
      keyId,
      maximumTtlMs: MANAGEMENT_GATEWAY_LIMITS.maximumTtlMs,
      maxFutureSkewMs: MANAGEMENT_GATEWAY_LIMITS.maxFutureSkewMs,
      maxEnvelopeBytes: MANAGEMENT_GATEWAY_LIMITS.maxEnvelopeBytes,
      operationTimeoutMs: MANAGEMENT_GATEWAY_LIMITS.operationTimeoutMs,
      customTokenMaxTtlSeconds: MANAGEMENT_GATEWAY_LIMITS.customTokenMaxTtlSeconds,
      enabledOperations
    },
    noncePolicy: {
      maxNonceRecords: includeRuntimeOperations ? 1536 : MANAGEMENT_GATEWAY_LIMITS.maxNonceRecords,
      maxPropertyBytes: MANAGEMENT_GATEWAY_LIMITS.maxPropertyBytes,
      maxStorageBytes: MANAGEMENT_GATEWAY_LIMITS.maxStorageBytes,
      lockTimeoutMs: MANAGEMENT_GATEWAY_LIMITS.lockTimeoutMs,
      retentionMs: MANAGEMENT_GATEWAY_LIMITS.retentionMs
    }
  };
  validateDisabledManagementGatewayConfig(config);
  const canonicalJson = gatewayCanonicalJson(config, {maxBytes: 8192});
  return Object.freeze({config: Object.freeze(config), canonicalJson,
    sha256: createHash('sha256').update(canonicalJson, 'utf8').digest('hex')});
}

export function validateDisabledManagementGatewayConfig(config) {
  const top = ['schemaVersion', 'enabled', 'actorEmailSha256', 'faSignerServiceAccountEmail', 'signerServiceAccountEmail',
    'fcSignerServiceAccountEmail', 'managementPolicyVersion', 'maxGoogleResponseBytes', 'policy', 'noncePolicy'];
  const policyKeys = ['schemaVersion', 'protocolVersion', 'audience', 'keyId', 'maximumTtlMs', 'maxFutureSkewMs',
    'maxEnvelopeBytes', 'operationTimeoutMs', 'customTokenMaxTtlSeconds', 'enabledOperations'];
  const nonceKeys = ['maxNonceRecords', 'maxPropertyBytes', 'maxStorageBytes', 'lockTimeoutMs', 'retentionMs'];
  demand(ownKeys(config, top) && config.schemaVersion === 1 && config.enabled === false
    && lowerHex(config.actorEmailSha256, 64) && identifier(config.managementPolicyVersion)
    && config.faSignerServiceAccountEmail === MANAGEMENT_SIGNERS.FA && signerPattern('sahmt-17a16').test(config.faSignerServiceAccountEmail)
    && config.signerServiceAccountEmail === MANAGEMENT_SIGNERS.FB && signerPattern('sahmt-gestao-5ae66').test(config.signerServiceAccountEmail)
    && config.fcSignerServiceAccountEmail === MANAGEMENT_SIGNERS.FC && signerPattern('indicadores---sahmt').test(config.fcSignerServiceAccountEmail)
    && safeInteger(config.maxGoogleResponseBytes, 1024, 262144), 'GATEWAY_CONFIG_INVALID');
  const policy = config.policy;
  demand(ownKeys(policy, policyKeys) && policy.schemaVersion === 1
    && policy.protocolVersion === MANAGEMENT_GATEWAY_PROTOCOL_VERSION && policy.audience === MANAGEMENT_GATEWAY_AUDIENCE
    && typeof policy.keyId === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(policy.keyId)
    && safeInteger(policy.maximumTtlMs, 1, 120000) && safeInteger(policy.maxFutureSkewMs, 0, 60000)
    && safeInteger(policy.maxEnvelopeBytes, 1024, 65536) && safeInteger(policy.operationTimeoutMs, 1, 120000)
    && safeInteger(policy.customTokenMaxTtlSeconds, 1, 3600)
    && (ownKeys(policy.enabledOperations, MANAGEMENT_GATEWAY_OPERATIONS) || ownKeys(policy.enabledOperations,[...MANAGEMENT_GATEWAY_OPERATIONS,...MANAGEMENT_GATEWAY_DATA_OPERATIONS]))
    && Object.keys(policy.enabledOperations).every(operation => policy.enabledOperations[operation] === false), 'GATEWAY_POLICY_INVALID');
  const nonce = config.noncePolicy;
  demand(ownKeys(nonce, nonceKeys) && safeInteger(nonce.maxNonceRecords, 1, Object.hasOwn(policy.enabledOperations,'READ_FA_AUTHORIZATION') ? 1536 : 512)
    && safeInteger(nonce.maxPropertyBytes, 1024, 8192) && safeInteger(nonce.maxStorageBytes, 16384, 400000)
    && safeInteger(nonce.lockTimeoutMs, 1, 1000) && safeInteger(nonce.retentionMs, 1, 86400000), 'GATEWAY_NONCE_POLICY_INVALID');
  const canonicalJson = gatewayCanonicalJson(config, {maxBytes: 8192});
  return Object.freeze({canonicalJson, sha256: createHash('sha256').update(canonicalJson, 'utf8').digest('hex')});
}

/**
 * Expected server-side Worker contract. The HMAC bytes are deliberately not
 * represented here; they belong in a Worker secret and Apps Script properties.
 */
export function createExpectedWorkerGatewayContract(config) {
  validateDisabledManagementGatewayConfig(config);
  return Object.freeze({brokerPolicy: Object.freeze({version: config.managementPolicyVersion}),
    gatewayPolicy: Object.freeze({schemaVersion: config.policy.schemaVersion,
      protocolVersion: config.policy.protocolVersion, audience: config.policy.audience, keyId: config.policy.keyId,
      maximumTtlMs: config.policy.maximumTtlMs, maxFutureSkewMs: config.policy.maxFutureSkewMs,
      maxEnvelopeBytes: config.policy.maxEnvelopeBytes, operationTimeoutMs: config.policy.operationTimeoutMs,
      customTokenMaxTtlSeconds: config.policy.customTokenMaxTtlSeconds,
      enabledOperations: Object.freeze({...config.policy.enabledOperations})})});
}

export function compareWorkerGatewayContract(config, candidate) {
  validateDisabledManagementGatewayConfig(config);
  const expected = createExpectedWorkerGatewayContract(config);
  const brokerMatches = ownKeys(candidate?.brokerPolicy, ['version'])
    && candidate.brokerPolicy.version === expected.brokerPolicy.version;
  const policyKeys = Object.keys(expected.gatewayPolicy);
  const gatewayPolicy = candidate?.gatewayPolicy;
  const gatewayMatches = ownKeys(gatewayPolicy, policyKeys) && policyKeys.every(key => key === 'enabledOperations'
    ? ownKeys(gatewayPolicy[key], Object.keys(expected.gatewayPolicy[key]))
      && Object.keys(expected.gatewayPolicy[key]).every(operation => gatewayPolicy[key][operation] === false)
      && Object.keys(expected.gatewayPolicy[key]).every(operation => gatewayPolicy[key][operation] === expected.gatewayPolicy[key][operation])
    : gatewayPolicy[key] === expected.gatewayPolicy[key]);
  return Object.freeze({compatible: brokerMatches && gatewayMatches, brokerPolicyMatches: brokerMatches,
    gatewayPolicyMatches: gatewayMatches});
}

/** Compare secret bytes in memory only. Caller must not log, serialize or persist the inputs. */
export function compareHmacSecretBytes(gatewaySecret, workerSecret) {
  demand(gatewaySecret instanceof Uint8Array && workerSecret instanceof Uint8Array
    && gatewaySecret.byteLength >= 32 && gatewaySecret.byteLength <= 128
    && workerSecret.byteLength >= 32 && workerSecret.byteLength <= 128, 'GATEWAY_SECRET_INVALID');
  if (gatewaySecret.byteLength !== workerSecret.byteLength) return false;
  return timingSafeEqual(Buffer.from(gatewaySecret), Buffer.from(workerSecret));
}
