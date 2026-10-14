// Dedicated, local preparation only. No deployment, trigger, Firestore or default activation.
var MGW_VERSION_ = 'SAHMT_MANAGEMENT_GATEWAY_V1';
var MGW_AUDIENCE_ = 'sahmt-management-dedicated-appscript-v1';
var MGW_FA_ = 'sahmt-17a16';
var MGW_FB_ = 'sahmt-gestao-5ae66';
var MGW_FC_ = 'indicadores---sahmt';
var MGW_REQUEST_DIRECTION_ = 'WORKER_TO_APPS_SCRIPT';
var MGW_RESPONSE_DIRECTION_ = 'APPS_SCRIPT_TO_WORKER';
var MGW_PROPERTIES_ = {
  config: 'MANAGEMENT_GATEWAY_CONFIG_JSON',
  pin: 'MANAGEMENT_GATEWAY_CONFIG_SHA256',
  secret: 'MANAGEMENT_GATEWAY_HMAC_SECRET_BASE64URL',
  clock: 'MGW_CLOCK_V1',
  protectedIdentityPolicy: 'SAHMT_FA_PROTECTED_IDENTITIES_JSON',
  noncePrefix: 'MGW_NONCE_V1_'
};
var MGW_PROTECTED_IDENTITY_MARKERS_ = ['STRUCTURAL_OWNER', 'HOMOLOGATION_CANDIDATE_1', 'HOMOLOGATION_CANDIDATE_2'];
var MGW_OPERATIONS_ = ['AUTH_USER_LOOKUP_FA', 'AUTH_USER_LOOKUP_FB', 'AUTH_USER_LOOKUP_FC', 'SIGN_FB_CUSTOM_TOKEN', 'SIGN_FC_CUSTOM_TOKEN', 'FIRST_LOGIN_FA_SIGN'];
var MGW_CLAIMS_ = ['managementSourceProjectId', 'managementMemberId', 'managementSourceVersion',
  'managementSourceHash', 'managementPolicyVersion', 'managementSourceAuthTimeMs'];
var MGW_SCOPES_ = ['https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/iam', 'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/datastore'];
var MGW_IAM_PROOF_SCOPES_ = ['https://www.googleapis.com/auth/iam',
  'https://www.googleapis.com/auth/script.external_request'];
var MGW_DATA_OPERATIONS_ = ['READ_FA_AUTHORIZATION','READ_FB_LEASE','WRITE_FB_LEASE','INVALIDATE_FB_LEASE'];
var MGW_DENIALS_ = ['GATEWAY_DISABLED', 'GATEWAY_ADMISSION_DENIED', 'GATEWAY_LOCK_BUSY', 'GATEWAY_REPLAY_DENIED',
  'GATEWAY_OPERATION_FAILED', 'GATEWAY_OPERATION_TIMEOUT', 'GATEWAY_RESULT_INVALID', 'GATEWAY_ABORTED'];
var MGW_REQUEST_KEYS_ = ['schemaVersion', 'protocolVersion', 'audience', 'keyId', 'direction',
  'sourceProjectId', 'destinationProjectId', 'operation', 'requestId', 'nonce', 'issuedAtMs',
  'expiresAtMs', 'body', 'bodySha256', 'signature'];
var MGW_RECORD_KEYS_ = ['schemaVersion', 'namespace', 'direction', 'requestHash', 'envelopeHash',
  'requestId', 'nonce', 'operation', 'keyId', 'sourceProjectId', 'destinationProjectId',
  'issuedAtMs', 'expiresAtMs', 'retainUntilMs', 'status'];

function mgwDeny_(code) { var error = new Error(code); error.gatewayCode = code; throw error; }
function mgwRequire_(condition, code) { if (!condition) mgwDeny_(code); }
function mgwInteger_(value, minimum) { return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= (minimum || 0); }
function mgwObject_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function mgwId_(value, maximum) { return typeof value === 'string' && value.length > 0 && value.length <= (maximum || 200) && !/[\s\/\x00-\x1f]/.test(value); }
function mgwHash_(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function mgwKeyId_(value) { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value); }
function mgwWireId_(value) { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value); }
function mgwDestination_(operation) { return operation === 'SIGN_FC_CUSTOM_TOKEN' || operation === 'AUTH_USER_LOOKUP_FC' ? MGW_FC_
  : ['FIRST_LOGIN_FA_SIGN','READ_FA_AUTHORIZATION'].indexOf(operation) >= 0 ? MGW_FA_ : MGW_FB_; }
function mgwKeys_(value, keys) {
  if (!mgwObject_(value)) return false;
  var actual = Object.keys(value);
  return actual.length === keys.length && keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
}
function mgwCanonical_(value, depth, state) {
  depth = depth || 0; state = state || {nodes: 0};
  mgwRequire_(depth <= 16 && ++state.nodes <= 4096, 'GATEWAY_ADMISSION_DENIED');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { mgwRequire_(Number.isSafeInteger(value) && !Object.is(value, -0), 'GATEWAY_ADMISSION_DENIED'); return JSON.stringify(value); }
  if (Array.isArray(value)) {
    mgwRequire_(Object.getPrototypeOf(value) === Array.prototype && value.length <= 4096
      && Object.getOwnPropertySymbols(value).length === 0 && Object.getOwnPropertyNames(value).length === value.length + 1
      && Object.keys(value).length === value.length, 'GATEWAY_ADMISSION_DENIED');
    var parts = [];
    for (var index = 0; index < value.length; index++) {
      var item = Object.getOwnPropertyDescriptor(value, String(index));
      mgwRequire_(item && item.enumerable && Object.prototype.hasOwnProperty.call(item, 'value'), 'GATEWAY_ADMISSION_DENIED');
      parts.push(mgwCanonical_(item.value, depth + 1, state));
    }
    return '[' + parts.join(',') + ']';
  }
  mgwRequire_(mgwObject_(value) && Object.getPrototypeOf(value) === Object.prototype
    && Object.getOwnPropertySymbols(value).length === 0, 'GATEWAY_ADMISSION_DENIED');
  var keys = Object.keys(value).sort();
  mgwRequire_(Object.getOwnPropertyNames(value).length === keys.length && keys.length <= 4096, 'GATEWAY_ADMISSION_DENIED');
  return '{' + keys.map(function (key) {
    var descriptor = Object.getOwnPropertyDescriptor(value, key);
    mgwRequire_(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value'), 'GATEWAY_ADMISSION_DENIED');
    return JSON.stringify(key) + ':' + mgwCanonical_(descriptor.value, depth + 1, state);
  }).join(',') + '}';
}
function mgwBytes_(text) { return Utilities.newBlob(text).getBytes(); }
function mgwHex_(bytes) { return bytes.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join(''); }
function mgwSha_(text) { return mgwHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, mgwBytes_(text))); }
function mgwHmac_(text, secret) { return mgwHex_(Utilities.computeHmacSha256Signature(mgwBytes_(text), secret)); }
function mgwEqual_(left, right) {
  if (!mgwHash_(left) || !mgwHash_(right)) return false;
  var different = 0;
  for (var index = 0; index < 64; index++) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}
function mgwParse_(text, maximum, code) {
  mgwRequire_(typeof text === 'string' && mgwBytes_(text).length <= maximum, code);
  try { var value = JSON.parse(text); mgwCanonical_(value); return value; } catch (_) { mgwDeny_(code); }
}
function mgwClock_() { var time = Date.now(); mgwRequire_(mgwInteger_(time, 1), 'GATEWAY_ADMISSION_DENIED'); return time; }
function mgwExecutionClock_(execution) {
  var time = mgwClock_();
  mgwRequire_(mgwObject_(execution) && mgwInteger_(execution.startedAtMs, 1)
    && mgwInteger_(execution.maximumObservedAtMs, 1) && time >= execution.maximumObservedAtMs, 'GATEWAY_OPERATION_TIMEOUT');
  execution.maximumObservedAtMs = time; return time;
}
function mgwLive_(request, policy, execution) {
  var time = mgwExecutionClock_(execution);
  mgwRequire_(request.issuedAtMs <= time + policy.maxFutureSkewMs
    && time < request.expiresAtMs && time < execution.startedAtMs + policy.operationTimeoutMs, 'GATEWAY_OPERATION_TIMEOUT');
  return time;
}
function mgwPolicy_(policy) {
  mgwRequire_(mgwKeys_(policy, ['schemaVersion', 'protocolVersion', 'audience', 'keyId',
    'maximumTtlMs', 'maxFutureSkewMs', 'maxEnvelopeBytes', 'operationTimeoutMs',
    'customTokenMaxTtlSeconds', 'enabledOperations'])
    && policy.schemaVersion === 1 && policy.protocolVersion === MGW_VERSION_
    && policy.audience === MGW_AUDIENCE_ && mgwKeyId_(policy.keyId)
    && mgwInteger_(policy.maximumTtlMs, 1) && policy.maximumTtlMs <= 120000
    && mgwInteger_(policy.maxFutureSkewMs) && policy.maxFutureSkewMs <= 60000
    && mgwInteger_(policy.maxEnvelopeBytes, 1024) && policy.maxEnvelopeBytes <= 65536
    && mgwInteger_(policy.operationTimeoutMs, 1) && policy.operationTimeoutMs <= 120000
    && mgwInteger_(policy.customTokenMaxTtlSeconds, 1) && policy.customTokenMaxTtlSeconds <= 3600
    && mgwObject_(policy.enabledOperations)
    && MGW_OPERATIONS_.every(function (op) { return Object.prototype.hasOwnProperty.call(policy.enabledOperations,op); })
    && Object.keys(policy.enabledOperations).every(function (op) { return MGW_OPERATIONS_.concat(MGW_DATA_OPERATIONS_).indexOf(op) >= 0 && typeof policy.enabledOperations[op] === 'boolean'; })
    && MGW_OPERATIONS_.every(function (op) { return typeof policy.enabledOperations[op] === 'boolean'; }),
    'GATEWAY_CONFIG_INVALID');
  return policy;
}
function mgwConfiguration_() {
  var properties = PropertiesService.getScriptProperties();
  var json = properties.getProperty(MGW_PROPERTIES_.config);
  var pin = properties.getProperty(MGW_PROPERTIES_.pin);
  var secretText = properties.getProperty(MGW_PROPERTIES_.secret);
  mgwRequire_(mgwHash_(pin) && typeof secretText === 'string' && /^[A-Za-z0-9_-]{43,171}$/.test(secretText), 'GATEWAY_CONFIG_INVALID');
  var config = mgwParse_(json, 8192, 'GATEWAY_CONFIG_INVALID');
  mgwRequire_(mgwKeys_(config, ['schemaVersion', 'enabled', 'actorEmailSha256', 'faSignerServiceAccountEmail', 'signerServiceAccountEmail', 'fcSignerServiceAccountEmail',
    'managementPolicyVersion', 'maxGoogleResponseBytes', 'policy', 'noncePolicy'])
    && config.schemaVersion === 1 && typeof config.enabled === 'boolean' && mgwHash_(config.actorEmailSha256)
    && typeof config.faSignerServiceAccountEmail === 'string'
    && new RegExp('^[a-z][a-z0-9-]{4,28}[a-z0-9]@' + MGW_FA_ + '\\.iam\\.gserviceaccount\\.com$').test(config.faSignerServiceAccountEmail)
    && typeof config.signerServiceAccountEmail === 'string'
    && new RegExp('^[a-z][a-z0-9-]{4,28}[a-z0-9]@' + MGW_FB_ + '\\.iam\\.gserviceaccount\\.com$').test(config.signerServiceAccountEmail)
    && typeof config.fcSignerServiceAccountEmail === 'string'
    && new RegExp('^[a-z][a-z0-9-]{4,28}[a-z0-9]@' + MGW_FC_ + '\\.iam\\.gserviceaccount\\.com$').test(config.fcSignerServiceAccountEmail)
    && mgwId_(config.managementPolicyVersion, 100)
    && mgwInteger_(config.maxGoogleResponseBytes, 1024) && config.maxGoogleResponseBytes <= 262144
    && mgwEqual_(mgwSha_(mgwCanonical_(config)), pin), 'GATEWAY_CONFIG_INVALID');
  mgwPolicy_(config.policy);
  var noncePolicy = config.noncePolicy;
  mgwRequire_(mgwKeys_(noncePolicy, ['maxNonceRecords', 'maxPropertyBytes', 'maxStorageBytes', 'lockTimeoutMs', 'retentionMs'])
    && mgwInteger_(noncePolicy.maxNonceRecords, 1) && noncePolicy.maxNonceRecords <= 1536
    && mgwInteger_(noncePolicy.maxPropertyBytes, 1024) && noncePolicy.maxPropertyBytes <= 8192
    && mgwInteger_(noncePolicy.maxStorageBytes, 16384) && noncePolicy.maxStorageBytes <= 400000
    && mgwInteger_(noncePolicy.lockTimeoutMs, 1) && noncePolicy.lockTimeoutMs <= 1000
    && mgwInteger_(noncePolicy.retentionMs, 1) && noncePolicy.retentionMs <= 86400000, 'GATEWAY_CONFIG_INVALID');
  var secret;
  try {
    secret = Utilities.base64DecodeWebSafe(secretText);
    mgwRequire_(secret.length >= 32 && secret.length <= 128
      && Utilities.base64EncodeWebSafe(secret).replace(/=+$/, '') === secretText, 'GATEWAY_CONFIG_INVALID');
  } catch (_) { mgwDeny_('GATEWAY_CONFIG_INVALID'); }
  var email = Session.getEffectiveUser().getEmail();
  mgwRequire_(typeof email === 'string' && email.trim().length > 0
    && mgwEqual_(mgwSha_(email.trim().toLowerCase()), config.actorEmailSha256), 'GATEWAY_ACTOR_MISMATCH');
  return {properties: properties, config: config, configPin: pin, secret: secret};
}
function mgwScopes_(requestedScopes) {
  var scopes = requestedScopes === undefined ? MGW_SCOPES_ : requestedScopes;
  mgwRequire_(Array.isArray(scopes) && scopes.length > 0
    && scopes.every(function (scope, index) {
      return MGW_SCOPES_.indexOf(scope) >= 0 && scopes.indexOf(scope) === index;
    }), 'GATEWAY_SCOPES_CHECK_FAILED');
  var status;
  try { status = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, scopes.slice()).getAuthorizationStatus(); }
  catch (_) { mgwDeny_('GATEWAY_SCOPES_CHECK_FAILED'); }
  mgwRequire_(status === ScriptApp.AuthorizationStatus.NOT_REQUIRED, 'GATEWAY_SCOPES_REQUIRED');
}
function mgwBody_(operation, body, request, policy, config, time) {
  if (MGW_DATA_OPERATIONS_.indexOf(operation) >= 0) { mgwDataBody_(operation, body, config, time); return; }
  if (operation === 'FIRST_LOGIN_FA_SIGN') {
    mgwRequire_(mgwKeys_(body, ['email', 'googleSub', 'issuedAtSeconds', 'expiresAtSeconds'])
      && typeof body.email === 'string' && body.email === body.email.trim().toLowerCase()
      && body.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
      && typeof body.googleSub === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(body.googleSub)
      && mgwInteger_(body.issuedAtSeconds, 1) && mgwInteger_(body.expiresAtSeconds, 1)
      && mgwInteger_(body.issuedAtSeconds * 1000, 1) && mgwInteger_(body.expiresAtSeconds * 1000, 1)
      && body.expiresAtSeconds > body.issuedAtSeconds
      && body.expiresAtSeconds - body.issuedAtSeconds <= 300
      && body.issuedAtSeconds * 1000 <= time + policy.maxFutureSkewMs
      && body.issuedAtSeconds * 1000 >= request.issuedAtMs - policy.maxFutureSkewMs - 999
      && body.expiresAtSeconds * 1000 > time
      && request.expiresAtMs - request.issuedAtMs <= 30000, 'GATEWAY_ADMISSION_DENIED');
    return;
  }
  if (operation === 'AUTH_USER_LOOKUP_FA' || operation === 'AUTH_USER_LOOKUP_FB' || operation === 'AUTH_USER_LOOKUP_FC') {
    mgwRequire_(mgwKeys_(body, ['uid']) && mgwId_(body.uid, 128), 'GATEWAY_ADMISSION_DENIED');
    return;
  }
  if (operation === 'SIGN_FC_CUSTOM_TOKEN') {
    var fcClaimKeys = ['sahmtFaSourceProjectId', 'sahmtOccurrencesCatalogRead', 'sahmtOccurrencesRead', 'sahmtOccurrencesWrite', 'sahmtOccurrencesAuditRead'];
    mgwRequire_(mgwKeys_(body, ['uid', 'claims', 'issuedAtSeconds', 'expiresAtSeconds'])
      && mgwId_(body.uid, 128) && mgwKeys_(body.claims, fcClaimKeys)
      && body.claims.sahmtFaSourceProjectId === MGW_FA_
      && ['sahmtOccurrencesCatalogRead', 'sahmtOccurrencesRead', 'sahmtOccurrencesWrite', 'sahmtOccurrencesAuditRead'].every(function (key) { return typeof body.claims[key] === 'boolean'; })
      && (!body.claims.sahmtOccurrencesCatalogRead || body.claims.sahmtOccurrencesWrite)
      && mgwInteger_(body.issuedAtSeconds, 1) && mgwInteger_(body.expiresAtSeconds, 1)
      && mgwInteger_(body.issuedAtSeconds * 1000) && mgwInteger_(body.expiresAtSeconds * 1000)
      && body.expiresAtSeconds > body.issuedAtSeconds
      && body.expiresAtSeconds - body.issuedAtSeconds <= policy.customTokenMaxTtlSeconds
      && body.issuedAtSeconds * 1000 <= time + policy.maxFutureSkewMs
      && body.issuedAtSeconds * 1000 >= request.issuedAtMs - policy.maxFutureSkewMs - 999
      && body.expiresAtSeconds * 1000 > time, 'GATEWAY_ADMISSION_DENIED');
    return;
  }
  mgwRequire_(operation === 'SIGN_FB_CUSTOM_TOKEN' && mgwKeys_(body, ['uid', 'claims', 'issuedAtSeconds', 'expiresAtSeconds'])
    && mgwId_(body.uid, 128) && mgwKeys_(body.claims, MGW_CLAIMS_)
    && body.claims.managementSourceProjectId === MGW_FA_
    && mgwId_(body.claims.managementMemberId) && mgwInteger_(body.claims.managementSourceVersion, 1)
    && mgwHash_(body.claims.managementSourceHash)
    && body.claims.managementPolicyVersion === config.managementPolicyVersion
    && mgwInteger_(body.claims.managementSourceAuthTimeMs, 1)
    && mgwInteger_(body.issuedAtSeconds, 1) && mgwInteger_(body.expiresAtSeconds, 1)
    && mgwInteger_(body.issuedAtSeconds * 1000) && mgwInteger_(body.expiresAtSeconds * 1000)
    && body.expiresAtSeconds > body.issuedAtSeconds
    && body.expiresAtSeconds - body.issuedAtSeconds <= policy.customTokenMaxTtlSeconds
    && body.issuedAtSeconds * 1000 <= time + policy.maxFutureSkewMs
    && body.issuedAtSeconds * 1000 >= request.issuedAtMs - policy.maxFutureSkewMs - 999
    && body.expiresAtSeconds * 1000 > time
    && body.claims.managementSourceAuthTimeMs <= body.issuedAtSeconds * 1000 + policy.maxFutureSkewMs,
    'GATEWAY_ADMISSION_DENIED');
  mgwRequire_(mgwBytes_(mgwCanonical_(body.claims)).length <= 1000, 'GATEWAY_ADMISSION_DENIED');
}
function mgwVerifyRequest_(request, configured, execution) {
  var policy = configured.config.policy;
  mgwRequire_(mgwKeys_(request, MGW_REQUEST_KEYS_) && request.schemaVersion === 1
    && request.protocolVersion === MGW_VERSION_ && request.audience === MGW_AUDIENCE_
    && request.keyId === policy.keyId && request.direction === MGW_REQUEST_DIRECTION_
    && request.sourceProjectId === MGW_FA_ && request.destinationProjectId === mgwDestination_(request.operation)
    && MGW_OPERATIONS_.concat(MGW_DATA_OPERATIONS_).indexOf(request.operation) >= 0
    && mgwWireId_(request.requestId) && mgwWireId_(request.nonce)
    && mgwInteger_(request.issuedAtMs, 1) && mgwInteger_(request.expiresAtMs, 1)
    && request.expiresAtMs > request.issuedAtMs
    && request.expiresAtMs - request.issuedAtMs <= policy.maximumTtlMs
    && mgwHash_(request.bodySha256) && mgwHash_(request.signature), 'GATEWAY_ADMISSION_DENIED');
  var time = mgwLive_(request, policy, execution);
  mgwRequire_(mgwEqual_(request.bodySha256, mgwSha_(mgwCanonical_(request.body))), 'GATEWAY_ADMISSION_DENIED');
  var unsigned = {};
  MGW_REQUEST_KEYS_.forEach(function (key) { if (key !== 'signature') unsigned[key] = request[key]; });
  mgwRequire_(mgwEqual_(request.signature, mgwHmac_(MGW_VERSION_ + '_REQUEST\n' + mgwCanonical_(unsigned), configured.secret)),
    'GATEWAY_ADMISSION_DENIED');
  mgwBody_(request.operation, request.body, request, policy, configured.config, time);
  return mgwSha_(mgwCanonical_(request));
}
function mgwRecord_(value, maximum, key) {
  var record = mgwParse_(value, maximum, 'GATEWAY_ADMISSION_DENIED');
  if (record.schemaVersion === 2) {
    mgwRequire_(mgwKeys_(record, ['schemaVersion','requestId','nonce','expiresAtMs','retainUntilMs'])
      && mgwWireId_(record.requestId) && mgwWireId_(record.nonce) && mgwInteger_(record.expiresAtMs,1)
      && mgwInteger_(record.retainUntilMs,1) && record.retainUntilMs > record.expiresAtMs
      && record.retainUntilMs - record.expiresAtMs <= 86460000, 'GATEWAY_ADMISSION_DENIED');
    record.namespace = MGW_VERSION_ + ':' + MGW_AUDIENCE_ + ':' + MGW_REQUEST_DIRECTION_;
    mgwRequire_(key === MGW_PROPERTIES_.noncePrefix + mgwSha_(record.namespace + '\n' + record.nonce), 'GATEWAY_ADMISSION_DENIED');
    return record;
  }
  mgwRequire_(mgwKeys_(record, MGW_RECORD_KEYS_) && record.schemaVersion === 1
    && record.namespace === MGW_VERSION_ + ':' + MGW_AUDIENCE_ + ':' + MGW_REQUEST_DIRECTION_
    && record.direction === MGW_REQUEST_DIRECTION_ && mgwHash_(record.requestHash) && record.envelopeHash === record.requestHash
    && mgwWireId_(record.requestId) && mgwWireId_(record.nonce) && mgwKeyId_(record.keyId)
    && MGW_OPERATIONS_.concat(MGW_DATA_OPERATIONS_).indexOf(record.operation) >= 0 && record.sourceProjectId === MGW_FA_
    && record.destinationProjectId === mgwDestination_(record.operation) && mgwInteger_(record.issuedAtMs, 1)
    && mgwInteger_(record.expiresAtMs, 1) && record.expiresAtMs > record.issuedAtMs
    && record.expiresAtMs - record.issuedAtMs <= 120000 && mgwInteger_(record.retainUntilMs, 1)
    && record.retainUntilMs > record.expiresAtMs && record.status === 'CLAIMED'
    && key === MGW_PROPERTIES_.noncePrefix + mgwSha_(record.namespace + '\n' + record.nonce), 'GATEWAY_ADMISSION_DENIED');
  return record;
}
function mgwLedger_(configured, request, execution, cleanup) {
  var lock = LockService.getScriptLock(), held = false;
  try {
    var time = cleanup ? mgwExecutionClock_(execution) : mgwLive_(request, configured.config.policy, execution);
    // Wait only for the local nonce critical section. Each wait keeps the
    // configured slice limit; total admission is bounded by five slices, 5 s
    // and the original signed expiry. No HTTP or Google operation is retried.
    var sliceMs = configured.config.noncePolicy.lockTimeoutMs;
    var lockDeadline = time + Math.min(5000, sliceMs * 5);
    if (!cleanup) lockDeadline = Math.min(lockDeadline, request.expiresAtMs - 1);
    for (var attempt = 0; attempt < 5 && !held; attempt++) {
      time = cleanup ? mgwExecutionClock_(execution) : mgwLive_(request, configured.config.policy, execution);
      var wait = Math.min(sliceMs, lockDeadline - time);
      if (wait < 1) break;
      held = lock.tryLock(wait) === true;
    }
    mgwRequire_(held, 'GATEWAY_LOCK_BUSY');
    time = cleanup ? mgwExecutionClock_(execution) : mgwLive_(request, configured.config.policy, execution);
    var all = configured.properties.getProperties(), noncePolicy = configured.config.noncePolicy, size = 0, records = [];
    mgwRequire_(mgwObject_(all) && Object.keys(all).length <= noncePolicy.maxNonceRecords + 5, 'GATEWAY_ADMISSION_DENIED');
    Object.keys(all).forEach(function (key) {
      mgwRequire_(typeof all[key] === 'string' && mgwBytes_(all[key]).length <= noncePolicy.maxPropertyBytes, 'GATEWAY_ADMISSION_DENIED');
      size += mgwBytes_(key).length + mgwBytes_(all[key]).length;
      if (key.indexOf(MGW_PROPERTIES_.noncePrefix) === 0) records.push({key: key, record: mgwRecord_(all[key], noncePolicy.maxPropertyBytes, key)});
      else mgwRequire_([MGW_PROPERTIES_.config, MGW_PROPERTIES_.pin, MGW_PROPERTIES_.secret, MGW_PROPERTIES_.clock,
        MGW_PROPERTIES_.protectedIdentityPolicy].indexOf(key) >= 0,
        'GATEWAY_ADMISSION_DENIED');
    });
    mgwRequire_(size <= noncePolicy.maxStorageBytes && records.length <= noncePolicy.maxNonceRecords, 'GATEWAY_ADMISSION_DENIED');
    var priorClock = all[MGW_PROPERTIES_.clock] === undefined ? null : mgwParse_(all[MGW_PROPERTIES_.clock], noncePolicy.maxPropertyBytes, 'GATEWAY_ADMISSION_DENIED');
    mgwRequire_(records.length === 0 || priorClock !== null, 'GATEWAY_ADMISSION_DENIED');
    if (priorClock !== null) mgwRequire_(mgwKeys_(priorClock, ['schemaVersion', 'configSha256', 'lastObservedAtMs'])
      && priorClock.schemaVersion === 1 && priorClock.configSha256 === configured.configPin
      && mgwInteger_(priorClock.lastObservedAtMs, 1) && time >= priorClock.lastObservedAtMs, 'GATEWAY_ADMISSION_DENIED');
    var clockJson = mgwCanonical_({schemaVersion: 1, configSha256: configured.configPin, lastObservedAtMs: time});
    if (cleanup) {
      // Persist the cleanup high-water mark before removing any tombstone.
      // A crash must not reopen an expired acceptance window after a clock rollback.
      configured.properties.setProperty(MGW_PROPERTIES_.clock, clockJson);
      mgwRequire_(configured.properties.getProperty(MGW_PROPERTIES_.clock) === clockJson, 'GATEWAY_ADMISSION_DENIED');
      mgwExecutionClock_(execution);
      var removed = 0;
      records.forEach(function (item) {
        mgwExecutionClock_(execution);
        if (time > item.record.retainUntilMs) { configured.properties.deleteProperty(item.key);
          mgwRequire_(configured.properties.getProperty(item.key) === null, 'GATEWAY_ADMISSION_DENIED'); removed++; }
      });
      mgwExecutionClock_(execution); return removed;
    }
    var compact = MGW_DATA_OPERATIONS_.some(function(op) { return Object.prototype.hasOwnProperty.call(configured.config.policy.enabledOperations,op); });
    if (compact) {
      // Clock is durable before expired tombstones are removed; never reopen a replay window.
      configured.properties.setProperty(MGW_PROPERTIES_.clock, clockJson);
      mgwRequire_(configured.properties.getProperty(MGW_PROPERTIES_.clock) === clockJson, 'GATEWAY_ADMISSION_DENIED');
      records = records.filter(function(item) {
        if (time <= item.record.retainUntilMs) return true;
        mgwExecutionClock_(execution);
        configured.properties.deleteProperty(item.key);
        mgwRequire_(configured.properties.getProperty(item.key) === null, 'GATEWAY_ADMISSION_DENIED');
        size -= mgwBytes_(item.key).length + mgwBytes_(all[item.key]).length;
        return false;
      });
    }
    var namespace = MGW_VERSION_ + ':' + MGW_AUDIENCE_ + ':' + MGW_REQUEST_DIRECTION_;
    mgwRequire_(!records.some(function (item) { return item.record.namespace === namespace
      && (item.record.requestId === request.requestId || item.record.nonce === request.nonce); }), 'GATEWAY_REPLAY_DENIED');
    mgwRequire_(records.length < noncePolicy.maxNonceRecords, 'GATEWAY_ADMISSION_DENIED');
    var requestHash = mgwSha_(mgwCanonical_(request));
    var record = {schemaVersion: 1, namespace: namespace, direction: MGW_REQUEST_DIRECTION_,
      requestHash: requestHash, envelopeHash: requestHash, requestId: request.requestId, nonce: request.nonce,
      operation: request.operation, keyId: request.keyId, sourceProjectId: MGW_FA_, destinationProjectId: mgwDestination_(request.operation),
      issuedAtMs: request.issuedAtMs, expiresAtMs: request.expiresAtMs,
      retainUntilMs: request.expiresAtMs + configured.config.policy.maxFutureSkewMs
        + (request.operation === 'FIRST_LOGIN_FA_SIGN' ? Math.min(noncePolicy.retentionMs, 300000) : noncePolicy.retentionMs), status: 'CLAIMED'};
    mgwRequire_(mgwInteger_(record.retainUntilMs, 1), 'GATEWAY_ADMISSION_DENIED');
    if (compact) record = {schemaVersion:2,requestId:record.requestId,nonce:record.nonce,
      expiresAtMs:record.expiresAtMs,retainUntilMs:record.retainUntilMs};
    var key = MGW_PROPERTIES_.noncePrefix + mgwSha_(namespace + '\n' + request.nonce), json = mgwCanonical_(record);
    mgwRequire_(mgwBytes_(json).length <= noncePolicy.maxPropertyBytes
      && size + mgwBytes_(key).length + mgwBytes_(json).length + mgwBytes_(clockJson).length <= noncePolicy.maxStorageBytes,
      'GATEWAY_ADMISSION_DENIED');
    mgwLive_(request, configured.config.policy, execution);
    configured.properties.setProperty(key, json);
    mgwRequire_(configured.properties.getProperty(key) === json, 'GATEWAY_ADMISSION_DENIED');
    configured.properties.setProperty(MGW_PROPERTIES_.clock, clockJson);
    mgwRequire_(configured.properties.getProperty(MGW_PROPERTIES_.clock) === clockJson, 'GATEWAY_ADMISSION_DENIED');
    mgwLive_(request, configured.config.policy, execution);
    return true;
  } finally { if (held) lock.releaseLock(); }
}
function mgwGoogleJson_(url, payload, configured, request, execution) {
  var token = null;
  try {
    mgwLive_(request, configured.config.policy, execution); mgwScopes_();
    token = ScriptApp.getOAuthToken();
    mgwRequire_(typeof token === 'string' && token.length > 0 && token.length <= 16000
      && !/[\s\x00-\x1f]/.test(token), 'GATEWAY_OPERATION_FAILED');
    var time = mgwLive_(request, configured.config.policy, execution);
    var remaining = Math.min(request.expiresAtMs, execution.startedAtMs + configured.config.policy.operationTimeoutMs) - time;
    var timeoutSeconds = Math.floor(remaining / 1000);
    mgwRequire_(timeoutSeconds >= 1, 'GATEWAY_OPERATION_TIMEOUT');
    var result = UrlFetchApp.fetch(url, {method: 'post', contentType: 'application/json; charset=utf-8',
      headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'}, payload: JSON.stringify(payload),
      validateHttpsCertificates: true, followRedirects: false, muteHttpExceptions: true, timeoutSeconds: timeoutSeconds});
    mgwLive_(request, configured.config.policy, execution);
    mgwRequire_(result.getResponseCode() === 200, 'GATEWAY_OPERATION_FAILED');
    var headers = result.getAllHeaders(), contentType = null, age = null;
    mgwRequire_(mgwObject_(headers), 'GATEWAY_RESULT_INVALID');
    Object.keys(headers).forEach(function (key) {
      if (key.toLowerCase() === 'content-type') { mgwRequire_(contentType === null, 'GATEWAY_RESULT_INVALID'); contentType = headers[key]; }
      if (key.toLowerCase() === 'age') { mgwRequire_(age === null, 'GATEWAY_RESULT_INVALID'); age = headers[key]; }
    });
    mgwRequire_(typeof contentType === 'string' && /^application\/json(?:\s*;|$)/i.test(contentType)
      && (age === null || typeof age === 'string' && /^0+$/.test(age)), 'GATEWAY_RESULT_INVALID');
    var bytes = result.getBlob().getBytes();
    mgwRequire_(Array.isArray(bytes) && bytes.length > 0 && bytes.length <= configured.config.maxGoogleResponseBytes, 'GATEWAY_RESULT_INVALID');
    var text = Utilities.newBlob(bytes).getDataAsString('UTF-8'), roundTrip = mgwBytes_(text);
    mgwRequire_(roundTrip.length === bytes.length && roundTrip.every(function (byte, index) {
      return (byte + 256) % 256 === (bytes[index] + 256) % 256; }), 'GATEWAY_RESULT_INVALID');
    var data = mgwParse_(text, configured.config.maxGoogleResponseBytes, 'GATEWAY_RESULT_INVALID');
    mgwRequire_(mgwObject_(data), 'GATEWAY_RESULT_INVALID');
    mgwLive_(request, configured.config.policy, execution); return data;
  } catch (error) { if (error && MGW_DENIALS_.indexOf(error.gatewayCode) >= 0) throw error; mgwDeny_('GATEWAY_OPERATION_FAILED'); }
  finally { token = null; }
}
function mgwLookup_(request, configured, execution, trustedIdentity) {
  var project = request.operation === 'AUTH_USER_LOOKUP_FA' ? MGW_FA_ : request.operation === 'AUTH_USER_LOOKUP_FC' ? MGW_FC_ : MGW_FB_;
  var identityPolicy = project === MGW_FA_ ? mgwProtectedIdentityPolicy_() : null;
  var result = mgwGoogleJson_('https://identitytoolkit.googleapis.com/v1/projects/' + project + '/accounts:lookup',
    {localId: [request.body.uid]}, configured, request, execution);
  mgwRequire_(Array.isArray(result.users) && result.users.length <= 1, 'GATEWAY_RESULT_INVALID');
  if (result.users.length === 0) return {users: []};
  var user = result.users[0];
  mgwRequire_(mgwObject_(user) && user.localId === request.body.uid && user.tenantId === undefined
    && (user.disabled === undefined || typeof user.disabled === 'boolean')
    && (user.emailVerified === undefined || typeof user.emailVerified === 'boolean')
    && (user.providerUserInfo === undefined || Array.isArray(user.providerUserInfo) && user.providerUserInfo.length <= 20)
    && (user.validSince === undefined || typeof user.validSince === 'string' && /^(0|[1-9]\d*)$/.test(user.validSince)
      && mgwInteger_(Number(user.validSince) * 1000)), 'GATEWAY_RESULT_INVALID');
  var providers = (user.providerUserInfo || []).map(function (provider) {
    mgwRequire_(mgwObject_(provider) && mgwId_(provider.providerId) && mgwId_(provider.rawId, 128), 'GATEWAY_RESULT_INVALID');
    return {providerId: provider.providerId, rawId: provider.rawId};
  });
  mgwRequire_(new Set(providers.map(function (provider) { return provider.providerId; })).size === providers.length, 'GATEWAY_RESULT_INVALID');
  var filtered = {localId: user.localId, emailVerified: user.emailVerified === true, providerUserInfo: providers};
  if (project === MGW_FA_) {
    var identityMarker = mgwProtectedIdentityMarker_(identityPolicy, user.localId, user.email);
    if (identityMarker !== null) filtered.identityMarker = identityMarker;
  }
  if (user.disabled !== undefined) filtered.disabled = user.disabled;
  if (user.validSince !== undefined) filtered.validSince = user.validSince;
  if (typeof trustedIdentity === 'function' && project === MGW_FA_) trustedIdentity(user.email);
  return {users: [filtered]};
}
function mgwProtectedIdentityPolicy_() {
  var serialized = PropertiesService.getScriptProperties().getProperty(MGW_PROPERTIES_.protectedIdentityPolicy);
  // Optional private deployment file, generated from verified FA identities.
  // It is server configuration, never a request field or frontend asset.
  // An existing Script Property always takes precedence, including invalid values.
  if (serialized === null && typeof mgwDeploymentProtectedIdentityPolicyJson_ === 'function')
    serialized = mgwDeploymentProtectedIdentityPolicyJson_();
  mgwRequire_(typeof serialized === 'string' && serialized.length > 0 && serialized.length <= 8192,
    'GATEWAY_OPERATION_FAILED');
  var value;
  try { value = JSON.parse(serialized); } catch (_) { mgwDeny_('GATEWAY_OPERATION_FAILED'); }
  mgwRequire_(mgwKeys_(value, ['schemaVersion', 'identities']) && value.schemaVersion === 1
    && Array.isArray(value.identities) && value.identities.length === MGW_PROTECTED_IDENTITY_MARKERS_.length,
    'GATEWAY_OPERATION_FAILED');
  var seenMarkers = {}, seenUids = {}, seenEmails = {};
  var identities = value.identities.map(function (entry) {
    mgwRequire_(mgwKeys_(entry, ['marker', 'uid', 'email'])
      && MGW_PROTECTED_IDENTITY_MARKERS_.indexOf(entry.marker) >= 0
      && mgwId_(entry.uid, 128) && typeof entry.email === 'string'
      && entry.email.length <= 254 && entry.email === entry.email.trim().toLowerCase()
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)
      && !seenMarkers[entry.marker] && !seenUids[entry.uid] && !seenEmails[entry.email],
    'GATEWAY_OPERATION_FAILED');
    seenMarkers[entry.marker] = true; seenUids[entry.uid] = true; seenEmails[entry.email] = true;
    return {marker: entry.marker, uid: entry.uid, email: entry.email};
  });
  mgwRequire_(MGW_PROTECTED_IDENTITY_MARKERS_.every(function (marker) { return seenMarkers[marker] === true; }),
    'GATEWAY_OPERATION_FAILED');
  return identities;
}
function mgwProtectedIdentityMarker_(policy, uid, email) {
  mgwRequire_(Array.isArray(policy), 'GATEWAY_OPERATION_FAILED');
  var normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  var byUid = policy.filter(function (entry) { return entry.uid === uid; });
  var byEmail = policy.filter(function (entry) { return entry.email === normalizedEmail; });
  mgwRequire_(byUid.length <= 1 && byEmail.length <= 1
    && (byUid.length === 0) === (byEmail.length === 0)
    && (byUid.length === 0 || byUid[0].marker === byEmail[0].marker), 'GATEWAY_OPERATION_FAILED');
  return byUid.length ? byUid[0].marker : null;
}
function mgwJwtPart_(part, maximum) {
  mgwRequire_(typeof part === 'string' && /^[A-Za-z0-9_-]+$/.test(part), 'GATEWAY_RESULT_INVALID');
  var bytes;
  try { bytes = Utilities.base64DecodeWebSafe(part);
    mgwRequire_(bytes.length <= maximum && Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '') === part, 'GATEWAY_RESULT_INVALID');
  } catch (_) { mgwDeny_('GATEWAY_RESULT_INVALID'); }
  return bytes;
}
function mgwSign_(request, configured, execution) {
  var config = configured.config, body = request.body, time = mgwLive_(request, config.policy, execution);
  mgwBody_(request.operation, body, request, config.policy, config, time);
  var signer = request.operation === 'SIGN_FC_CUSTOM_TOKEN' ? config.fcSignerServiceAccountEmail : config.signerServiceAccountEmail;
  return mgwSignJwt_(request, configured, execution, signer, body.uid, body.claims, body.issuedAtSeconds, body.expiresAtSeconds);
}
function mgwSignJwt_(request, configured, execution, signer, uid, claims, issuedAtSeconds, expiresAtSeconds) {
  var config = configured.config;
  mgwRequire_(mgwId_(uid, 128) && mgwObject_(claims) && mgwId_(signer, 200), 'GATEWAY_ADMISSION_DENIED');
  var payload = {iss: signer, sub: signer,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: issuedAtSeconds, exp: expiresAtSeconds, uid: uid, claims: claims};
  var result = mgwGoogleJson_('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'
    + signer + ':signJwt', {payload: JSON.stringify(payload)}, configured, request, execution);
  mgwRequire_(mgwKeyId_(result.keyId) && typeof result.signedJwt === 'string' && result.signedJwt.length <= 16000, 'GATEWAY_RESULT_INVALID');
  var parts = result.signedJwt.split('.');
  mgwRequire_(parts.length === 3, 'GATEWAY_RESULT_INVALID');
  var headerBytes = mgwJwtPart_(parts[0], 2048), payloadBytes = mgwJwtPart_(parts[1], 8192), signatureBytes = mgwJwtPart_(parts[2], 1024);
  mgwRequire_(signatureBytes.length >= 256, 'GATEWAY_RESULT_INVALID');
  var header = mgwParse_(Utilities.newBlob(headerBytes).getDataAsString('UTF-8'), 2048, 'GATEWAY_RESULT_INVALID');
  var signedPayload = mgwParse_(Utilities.newBlob(payloadBytes).getDataAsString('UTF-8'), 8192, 'GATEWAY_RESULT_INVALID');
  mgwRequire_(mgwObject_(header) && header.alg === 'RS256' && header.kid === result.keyId
    && (header.typ === undefined || header.typ === 'JWT') && Object.keys(header).every(function (key) {
      return ['alg', 'kid', 'typ'].indexOf(key) >= 0; })
    && mgwCanonical_(signedPayload) === mgwCanonical_(payload), 'GATEWAY_RESULT_INVALID');
  mgwRequire_(expiresAtSeconds * 1000 > mgwLive_(request, config.policy, execution), 'GATEWAY_OPERATION_TIMEOUT');
  return {keyId: result.keyId, signedJwt: result.signedJwt};
}
function mgwGoogleGetJson_(url, configured, request, execution) {
  var token = null;
  try {
    mgwLive_(request, configured.config.policy, execution); mgwScopes_();
    token = ScriptApp.getOAuthToken();
    mgwRequire_(typeof token === 'string' && token.length > 0 && token.length <= 16000
      && !/[\s\x00-\x1f]/.test(token), 'GATEWAY_OPERATION_FAILED');
    var time = mgwLive_(request, configured.config.policy, execution);
    var remaining = Math.min(request.expiresAtMs, execution.startedAtMs + configured.config.policy.operationTimeoutMs) - time;
    var timeoutSeconds = Math.floor(remaining / 1000);
    mgwRequire_(timeoutSeconds >= 1, 'GATEWAY_OPERATION_TIMEOUT');
    var result = UrlFetchApp.fetch(url, {method: 'get', headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'},
      validateHttpsCertificates: true, followRedirects: false, muteHttpExceptions: true, timeoutSeconds: timeoutSeconds});
    mgwLive_(request, configured.config.policy, execution);
    mgwRequire_(result && result.getResponseCode() === 200, 'GATEWAY_OPERATION_FAILED');
    var headers = result.getAllHeaders(), contentType = null, age = null;
    mgwRequire_(mgwObject_(headers), 'GATEWAY_RESULT_INVALID');
    Object.keys(headers).forEach(function (key) {
      if (key.toLowerCase() === 'content-type') { mgwRequire_(contentType === null, 'GATEWAY_RESULT_INVALID'); contentType = headers[key]; }
      if (key.toLowerCase() === 'age') { mgwRequire_(age === null, 'GATEWAY_RESULT_INVALID'); age = headers[key]; }
    });
    mgwRequire_(typeof contentType === 'string' && /^application\/json(?:\s*;|$)/i.test(contentType)
      && (age === null || typeof age === 'string' && /^0+$/.test(age)), 'GATEWAY_RESULT_INVALID');
    var bytes = result.getBlob().getBytes();
    mgwRequire_(Array.isArray(bytes) && bytes.length > 0 && bytes.length <= configured.config.maxGoogleResponseBytes, 'GATEWAY_RESULT_INVALID');
    var text = Utilities.newBlob(bytes).getDataAsString('UTF-8'), roundTrip = mgwBytes_(text);
    mgwRequire_(roundTrip.length === bytes.length && roundTrip.every(function (byte, index) {
      return (byte + 256) % 256 === (bytes[index] + 256) % 256; }), 'GATEWAY_RESULT_INVALID');
    var data = mgwParse_(text, configured.config.maxGoogleResponseBytes, 'GATEWAY_RESULT_INVALID');
    mgwRequire_(mgwObject_(data), 'GATEWAY_RESULT_INVALID');
    mgwLive_(request, configured.config.policy, execution); return data;
  } catch (error) { if (error && MGW_DENIALS_.indexOf(error.gatewayCode) >= 0) throw error; mgwDeny_('GATEWAY_OPERATION_FAILED'); }
  finally { token = null; }
}
function mgwFirstLogin_(request, configured, execution) {
  var body = request.body, time = mgwLive_(request, configured.config.policy, execution);
  var identityPolicy = mgwProtectedIdentityPolicy_();
  mgwBody_(request.operation, body, request, configured.config.policy, configured.config, time);
  var lookup = mgwGoogleJson_('https://identitytoolkit.googleapis.com/v1/projects/' + MGW_FA_ + '/accounts:lookup',
    {email: [body.email]}, configured, request, execution);
  mgwRequire_(Array.isArray(lookup.users) && lookup.users.length <= 2, 'GATEWAY_RESULT_INVALID');
  if (lookup.users.length === 0) return {status: 'DENIED', code: 'FA_ACCOUNT_NOT_FOUND'};
  if (lookup.users.length !== 1) return {status: 'DENIED', code: 'FA_ACCOUNT_AMBIGUOUS'};
  var raw = lookup.users[0];
  mgwRequire_(mgwObject_(raw) && mgwId_(raw.localId, 128) && typeof raw.email === 'string'
    && raw.email.trim().toLowerCase() === body.email && raw.tenantId === undefined
    && (raw.disabled === undefined || raw.disabled === false) && (raw.providerUserInfo === undefined || Array.isArray(raw.providerUserInfo))
    && (!Array.isArray(raw.providerUserInfo) || raw.providerUserInfo.length <= 20),
    'GATEWAY_RESULT_INVALID');
  // Project only fields required for identity matching. Hashes, salts, custom claims and
  // other Authentication fields from the upstream response are discarded immediately.
  var providers = (raw.providerUserInfo || []).map(function (provider) {
    mgwRequire_(mgwObject_(provider) && mgwId_(provider.providerId) && mgwId_(provider.rawId, 128), 'GATEWAY_RESULT_INVALID');
    return {providerId: provider.providerId, rawId: provider.rawId};
  });
  mgwRequire_(new Set(providers.map(function (provider) { return provider.providerId; })).size === providers.length, 'GATEWAY_RESULT_INVALID');
  if (mgwProtectedIdentityMarker_(identityPolicy, raw.localId, raw.email) !== null)
    return {status: 'DENIED', code: 'FA_PROTECTED_IDENTITY'};
  var uid = raw.localId; raw = null; lookup = null;

  var profileUrl = 'https://firestore.googleapis.com/v1/projects/' + MGW_FA_
    + '/databases/%28default%29/documents/users/' + encodeURIComponent(uid)
    + '?mask.fieldPaths=active&mask.fieldPaths=access&mask.fieldPaths=firstLoginCohort';
  var document = mgwGoogleGetJson_(profileUrl, configured, request, execution);
  mgwRequire_(document.name === 'projects/' + MGW_FA_ + '/databases/(default)/documents/users/' + uid, 'GATEWAY_RESULT_INVALID');
  var fields = document.fields;
  var active = fields && fields.active && fields.active.booleanValue;
  var access = fields && fields.access && fields.access.booleanValue;
  var cohort = fields && fields.firstLoginCohort && fields.firstLoginCohort.stringValue;
  // The allowlist is derived at request time from the FA auth identity and its own
  // profile. Missing/unknown classification is denied; no email/UID roster is kept.
  if (active !== true || access !== true) return {status: 'DENIED', code: 'FA_PROFILE_NOT_AUTHORIZED'};
  if (cohort !== 'OPERATIONAL') return {status: 'DENIED', code: 'FA_ACCOUNT_NOT_IN_OPERATIONAL_COHORT'};
  if (providers.length > 0) {
    if (providers.length === 1 && providers[0].providerId === 'google.com' && providers[0].rawId === body.googleSub)
      return {status: 'ALREADY_LINKED', uid: uid};
    return {status: 'DENIED', code: 'FA_PROVIDER_CONFLICT'};
  }

  // This path carries no claims, so first-login eligibility cannot grant admin rights.
  var signed = mgwSignJwt_(request, configured, execution, configured.config.faSignerServiceAccountEmail,
    uid, {}, body.issuedAtSeconds, body.expiresAtSeconds);
  return {status: 'FIRST_LOGIN', uid: uid, signedJwt: signed.signedJwt};
}
function mgwResponse_(request, requestHash, configured, body, code, execution) {
  mgwLive_(request, configured.config.policy, execution);
  var response = {};
  MGW_REQUEST_KEYS_.forEach(function (key) {
    if (['body', 'bodySha256', 'signature', 'direction'].indexOf(key) < 0) response[key] = request[key];
  });
  response.direction = MGW_RESPONSE_DIRECTION_; response.requestHash = requestHash;
  response.status = code === 'OK' ? 'SUCCESS' : 'DENIED'; response.code = code;
  response.body = code === 'OK' ? body : null; response.bodySha256 = mgwSha_(mgwCanonical_(response.body));
  response.signature = mgwHmac_(MGW_VERSION_ + '_RESPONSE\n' + mgwCanonical_(response), configured.secret);
  var json = mgwCanonical_(response);
  mgwRequire_(mgwBytes_(json).length <= configured.config.policy.maxEnvelopeBytes, 'GATEWAY_RESULT_INVALID');
  mgwLive_(request, configured.config.policy, execution); return json;
}
function mgwText_(json) { return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON); }

/** Public only after an explicit, reviewed dedicated deployment; never active by default. */
function doPost(event) {
  var configured = null, request = null, requestHash = null, verified = false, execution;
  try {
    var entryTime = mgwClock_(); execution = {startedAtMs: entryTime, maximumObservedAtMs: entryTime}; configured = mgwConfiguration_();
    mgwRequire_(configured.config.enabled === true, 'GATEWAY_DISABLED');
    mgwRequire_(mgwObject_(event) && (event.queryString === null || event.queryString === undefined || event.queryString === '')
      && (event.pathInfo === null || event.pathInfo === undefined || event.pathInfo === '')
      && mgwObject_(event.postData) && typeof event.postData.type === 'string'
      && /^application\/json(?:;\s*charset=utf-8)?$/i.test(event.postData.type)
      && mgwInteger_(event.contentLength, 1) && event.contentLength <= configured.config.policy.maxEnvelopeBytes
      && event.postData.length === event.contentLength && typeof event.postData.contents === 'string'
      && mgwBytes_(event.postData.contents).length === event.contentLength, 'GATEWAY_ADMISSION_DENIED');
    request = mgwParse_(event.postData.contents, configured.config.policy.maxEnvelopeBytes, 'GATEWAY_ADMISSION_DENIED');
    requestHash = mgwVerifyRequest_(request, configured, execution); verified = true;
    mgwRequire_(configured.config.policy.enabledOperations[request.operation] === true, 'GATEWAY_DISABLED');
    mgwScopes_(); mgwLedger_(configured, request, execution, false);
    mgwLive_(request, configured.config.policy, execution);
    var result = MGW_DATA_OPERATIONS_.indexOf(request.operation) >= 0 ? mgwDataOperation_(request, configured, execution)
      : request.operation === 'FIRST_LOGIN_FA_SIGN' ? mgwFirstLogin_(request, configured, execution)
      : request.operation.indexOf('SIGN_') === 0 ? mgwSign_(request, configured, execution)
      : mgwLookup_(request, configured, execution);
    return mgwText_(mgwResponse_(request, requestHash, configured, result, 'OK', execution));
  } catch (error) {
    var code = error && MGW_DENIALS_.indexOf(error.gatewayCode) >= 0 ? error.gatewayCode : 'GATEWAY_ADMISSION_DENIED';
    if (verified && configured) {
      try { return mgwText_(mgwResponse_(request, requestHash, configured, null, code, execution)); } catch (_) { code = 'GATEWAY_OPERATION_TIMEOUT'; }
    }
    return mgwText_(JSON.stringify({ok: false, code: code}));
  } finally { if (configured) configured.secret = null; request = null; }
}

/** Read-only metadata/scopes check. It does not activate, fetch OAuth, sign, grant or create anything. */
function autorizarPonteGestaoSemChaveV1() {
  var configured = null;
  try {
    configured = mgwConfiguration_(); mgwScopes_();
    return {ok: true, code: 'GATEWAY_AUTHORIZATION_CHECKED', actorAlias: 'ATOR_PONTE_GESTAO',
      signerAlias: 'FB-SA-01+FC-SA-01', scopesAuthorized: true, gatewayEnabled: configured.config.enabled,
      configSha256: configured.configPin, operational: false};
  } catch (error) {
    return {ok: false, code: error && ['GATEWAY_CONFIG_INVALID', 'GATEWAY_ACTOR_MISMATCH', 'GATEWAY_SCOPES_REQUIRED'].indexOf(error.gatewayCode) >= 0
      ? error.gatewayCode : 'GATEWAY_ADMISSION_DENIED', actorAlias: 'ATOR_PONTE_GESTAO', operational: false};
  } finally { if (configured) configured.secret = null; }
}

/** One-off manual proof only. Signs a non-Firebase synthetic JWT and never returns or persists it. */
function provarAssinaturaIamFbSinteticaV1() {
  var signer = 'sahmt-fb-token-signer@sahmt-gestao-5ae66.iam.gserviceaccount.com';
  var accessToken = null, signedJwt = null, response = null, result = null;
  var outcome = {code: 'FB_IAM_SIGNJWT_SYNTHETIC_PROOF_FAILED', httpStatus: null,
    signerAlias: 'FB-SA-01', algorithm: null, syntheticClaimsMatched: false};
  try {
    mgwScopes_(MGW_IAM_PROOF_SCOPES_);
    accessToken = ScriptApp.getOAuthToken();
    mgwRequire_(typeof accessToken === 'string' && accessToken.length > 0 && accessToken.length <= 16000
      && !/[\s\x00-\x1f]/.test(accessToken), 'GATEWAY_OPERATION_FAILED');
    var now = Math.floor(Date.now() / 1000);
    var syntheticPayload = {iss: signer, sub: signer, aud: 'urn:sahmt:iam-signjwt-proof:v1',
      iat: now, exp: now + 120, purpose: 'synthetic-signature-proof'};
    response = UrlFetchApp.fetch('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'
      + signer + ':signJwt', {method: 'post', contentType: 'application/json; charset=utf-8',
      headers: {Authorization: 'Bearer ' + accessToken, Accept: 'application/json'},
      payload: JSON.stringify({payload: JSON.stringify(syntheticPayload)}),
      validateHttpsCertificates: true, followRedirects: false, muteHttpExceptions: true, timeoutSeconds: 30});
    outcome.httpStatus = response.getResponseCode();
    if (outcome.httpStatus !== 200) outcome.code = 'IAM_SIGNJWT_HTTP_ERROR';
    else {
      result = JSON.parse(response.getContentText());
      mgwRequire_(mgwObject_(result) && mgwKeyId_(result.keyId) && typeof result.signedJwt === 'string'
        && result.signedJwt.length <= 16000, 'GATEWAY_RESULT_INVALID');
      signedJwt = result.signedJwt;
      var parts = signedJwt.split('.');
      mgwRequire_(parts.length === 3, 'GATEWAY_RESULT_INVALID');
      var header = mgwParse_(Utilities.newBlob(mgwJwtPart_(parts[0], 2048)).getDataAsString('UTF-8'),
        2048, 'GATEWAY_RESULT_INVALID');
      var claims = mgwParse_(Utilities.newBlob(mgwJwtPart_(parts[1], 8192)).getDataAsString('UTF-8'),
        8192, 'GATEWAY_RESULT_INVALID');
      mgwRequire_(mgwObject_(header) && header.alg === 'RS256' && header.kid === result.keyId
        && mgwCanonical_(claims) === mgwCanonical_(syntheticPayload), 'GATEWAY_RESULT_INVALID');
      outcome.code = 'FB_IAM_SIGNJWT_SYNTHETIC_PROOF_OK';
      outcome.algorithm = header.alg;
      outcome.syntheticClaimsMatched = true;
    }
  } catch (error) {
    outcome.code = error && error.gatewayCode === 'GATEWAY_SCOPES_REQUIRED'
      ? 'GATEWAY_SCOPES_REQUIRED' : 'FB_IAM_SIGNJWT_SYNTHETIC_PROOF_FAILED';
  } finally { accessToken = null; signedJwt = null; response = null; result = null; }
  Logger.log(JSON.stringify(outcome));
  return outcome;
}

/** One-off manual proof only. Uses the FC signer and a non-Firebase synthetic JWT. */
function provarAssinaturaIamFcSinteticaV1() {
  var signer = 'sahmt-fc-token-signer@indicadores---sahmt.iam.gserviceaccount.com';
  var accessToken = null, signedJwt = null, response = null, result = null;
  var outcome = {code: 'FC_IAM_SIGNJWT_SYNTHETIC_PROOF_FAILED', httpStatus: null,
    signerAlias: 'FC-SA-01', algorithm: null, syntheticClaimsMatched: false};
  try {
    mgwScopes_(MGW_IAM_PROOF_SCOPES_);
    accessToken = ScriptApp.getOAuthToken();
    mgwRequire_(typeof accessToken === 'string' && accessToken.length > 0 && accessToken.length <= 16000
      && !/[\s\x00-\x1f]/.test(accessToken), 'GATEWAY_OPERATION_FAILED');
    var now = Math.floor(Date.now() / 1000);
    var syntheticPayload = {iss: signer, sub: signer, aud: 'urn:sahmt:iam-signjwt-proof:fc:v1',
      iat: now, exp: now + 120, purpose: 'synthetic-signature-proof'};
    response = UrlFetchApp.fetch('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'
      + signer + ':signJwt', {method: 'post', contentType: 'application/json; charset=utf-8',
      headers: {Authorization: 'Bearer ' + accessToken, Accept: 'application/json'},
      payload: JSON.stringify({payload: JSON.stringify(syntheticPayload)}),
      validateHttpsCertificates: true, followRedirects: false, muteHttpExceptions: true, timeoutSeconds: 30});
    outcome.httpStatus = response.getResponseCode();
    if (outcome.httpStatus !== 200) outcome.code = 'IAM_SIGNJWT_HTTP_ERROR';
    else {
      result = JSON.parse(response.getContentText());
      mgwRequire_(mgwObject_(result) && mgwKeyId_(result.keyId) && typeof result.signedJwt === 'string'
        && result.signedJwt.length <= 16000, 'GATEWAY_RESULT_INVALID');
      signedJwt = result.signedJwt;
      var parts = signedJwt.split('.');
      mgwRequire_(parts.length === 3, 'GATEWAY_RESULT_INVALID');
      var header = mgwParse_(Utilities.newBlob(mgwJwtPart_(parts[0], 2048)).getDataAsString('UTF-8'),
        2048, 'GATEWAY_RESULT_INVALID');
      var claims = mgwParse_(Utilities.newBlob(mgwJwtPart_(parts[1], 8192)).getDataAsString('UTF-8'),
        8192, 'GATEWAY_RESULT_INVALID');
      mgwRequire_(mgwObject_(header) && header.alg === 'RS256' && header.kid === result.keyId
        && mgwCanonical_(claims) === mgwCanonical_(syntheticPayload), 'GATEWAY_RESULT_INVALID');
      outcome.code = 'FC_IAM_SIGNJWT_SYNTHETIC_PROOF_OK';
      outcome.algorithm = header.alg;
      outcome.syntheticClaimsMatched = true;
    }
  } catch (error) {
    outcome.code = error && error.gatewayCode === 'GATEWAY_SCOPES_REQUIRED'
      ? 'GATEWAY_SCOPES_REQUIRED' : 'FC_IAM_SIGNJWT_SYNTHETIC_PROOF_FAILED';
  } finally { accessToken = null; signedJwt = null; response = null; result = null; }
  Logger.log(JSON.stringify(outcome));
  return outcome;
}

/** One-off manual proof only. Uses the FA signer and a non-Firebase synthetic JWT. */
function provarAssinaturaIamFaSinteticaV1() {
  var signer = 'sahmt-fa-token-signer@sahmt-17a16.iam.gserviceaccount.com';
  var accessToken = null, signedJwt = null, response = null, result = null;
  var stage = 'SCOPES';
  var outcome = {code: 'FA_IAM_SIGNJWT_SYNTHETIC_PROOF_FAILED', httpStatus: null,
    signerAlias: 'FA-SA-01', algorithm: null, syntheticClaimsMatched: false};
  try {
    try { mgwScopes_(MGW_IAM_PROOF_SCOPES_); }
    catch (scopeError) {
      if (scopeError && scopeError.gatewayCode === 'GATEWAY_SCOPES_REQUIRED') throw scopeError;
      mgwDeny_('GATEWAY_SCOPES_CHECK_FAILED');
    }
    stage = 'OAUTH_TOKEN';
    try { accessToken = ScriptApp.getOAuthToken(); }
    catch (_) { mgwDeny_('IAM_OAUTH_TOKEN_UNAVAILABLE'); }
    if (!(typeof accessToken === 'string' && accessToken.length > 0 && accessToken.length <= 16000
      && !/[\s\x00-\x1f]/.test(accessToken)))
      mgwDeny_('IAM_OAUTH_TOKEN_INVALID');
    stage = 'REQUEST_BUILD';
    var now = Math.floor(Date.now() / 1000);
    var syntheticPayload = {iss: signer, sub: signer, aud: 'urn:sahmt:iam-signjwt-proof:fa:v1',
      iat: now, exp: now + 120, purpose: 'synthetic-signature-proof'};
    var requestUrl = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'
      + signer + ':signJwt';
    var requestOptions = {method: 'post', contentType: 'application/json; charset=utf-8',
      headers: {Authorization: 'Bearer ' + accessToken, Accept: 'application/json'},
      payload: JSON.stringify({payload: JSON.stringify(syntheticPayload)}),
      validateHttpsCertificates: true, followRedirects: false, muteHttpExceptions: true, timeoutSeconds: 30};
    stage = 'IAM_FETCH';
    try { response = UrlFetchApp.fetch(requestUrl, requestOptions); }
    catch (_) { mgwDeny_('IAM_FETCH_FAILED'); }
    stage = 'HTTP_STATUS';
    try { outcome.httpStatus = response.getResponseCode(); }
    catch (_) { mgwDeny_('IAM_HTTP_STATUS_UNAVAILABLE'); }
    mgwRequire_(Number.isInteger(outcome.httpStatus) && outcome.httpStatus >= 100 && outcome.httpStatus <= 599,
      'IAM_HTTP_STATUS_UNAVAILABLE');
    if (outcome.httpStatus !== 200) outcome.code = 'IAM_SIGNJWT_HTTP_ERROR';
    else {
      stage = 'RESPONSE_VALIDATE';
      result = JSON.parse(response.getContentText());
      mgwRequire_(mgwObject_(result) && mgwKeyId_(result.keyId) && typeof result.signedJwt === 'string'
        && result.signedJwt.length <= 16000, 'GATEWAY_RESULT_INVALID');
      signedJwt = result.signedJwt;
      var parts = signedJwt.split('.');
      mgwRequire_(parts.length === 3, 'GATEWAY_RESULT_INVALID');
      var header = mgwParse_(Utilities.newBlob(mgwJwtPart_(parts[0], 2048)).getDataAsString('UTF-8'),
        2048, 'GATEWAY_RESULT_INVALID');
      var claims = mgwParse_(Utilities.newBlob(mgwJwtPart_(parts[1], 8192)).getDataAsString('UTF-8'),
        8192, 'GATEWAY_RESULT_INVALID');
      mgwRequire_(mgwObject_(header) && header.alg === 'RS256' && header.kid === result.keyId
        && mgwCanonical_(claims) === mgwCanonical_(syntheticPayload), 'GATEWAY_RESULT_INVALID');
      outcome.code = 'FA_IAM_SIGNJWT_SYNTHETIC_PROOF_OK';
      outcome.algorithm = header.alg;
      outcome.syntheticClaimsMatched = true;
    }
  } catch (error) {
    var safeCodes = ['GATEWAY_SCOPES_REQUIRED', 'GATEWAY_SCOPES_CHECK_FAILED', 'IAM_OAUTH_TOKEN_UNAVAILABLE',
      'IAM_OAUTH_TOKEN_INVALID', 'IAM_REQUEST_BUILD_FAILED', 'IAM_FETCH_FAILED', 'IAM_HTTP_STATUS_UNAVAILABLE',
      'GATEWAY_RESULT_INVALID'];
    outcome.code = error && safeCodes.indexOf(error.gatewayCode) >= 0 ? error.gatewayCode
      : stage === 'REQUEST_BUILD' ? 'IAM_REQUEST_BUILD_FAILED' : 'FA_IAM_SIGNJWT_SYNTHETIC_PROOF_FAILED';
  } finally { accessToken = null; signedJwt = null; response = null; result = null; }
  Logger.log(JSON.stringify(outcome));
  return outcome;
}

/** No trigger/caller installed. Separate maintenance only after every nonce's acceptance+skew+retention ended. */
function managementGatewayCleanupExpiredNonces_() {
  var configured = null;
  try { configured = mgwConfiguration_(); var time = mgwClock_();
    var count = mgwLedger_(configured, null, {startedAtMs: time, maximumObservedAtMs: time}, true);
    return {ok: true, removed: count, operational: false}; }
  finally { if (configured) configured.secret = null; }
}


// Fixed server-only data bridge. No caller-supplied URL, collection or method.
var MGW_PROFILE_PERMISSIONS_ = ['admin','managementRead','managementManage','managementActivityWrite',
  'managementIndicatorsRead','managementIndicatorsWrite','managementPlansManage','documentsManage','equipmentManage',
  'qualityManage','trainingsRead','trainingsManage','financeRead','financeWrite','financeManage'];
var MGW_LEASE_FIELDS_ = ['schemaVersion','sourceProjectId','destinationProjectId','faUid','fbUid','memberId',
  'leaseVersion','grantId','sourceVersion','policyVersion','sourceHash','active','revoked','managementAllowed','role',
  'permissions','memberAreaIds','managerAreaIds','documentGroups','sourceAuthValidAfterTimeMs','confirmedAtMs','validUntilMs'];
function mgwDataBody_(op, body, config, time) {
  var keys = op === 'WRITE_FB_LEASE' ? ['uid','projectId','expectedRevision','lease']
    : op === 'INVALIDATE_FB_LEASE' ? ['uid','projectId','expectedGrantId','expectedLeaseVersion','reasonCode'] : ['uid','projectId'];
  if (op === 'READ_FA_AUTHORIZATION' && Object.prototype.hasOwnProperty.call(body,'includeManagementDomain')) {
    keys.push('includeManagementDomain'); mgwRequire_(body.includeManagementDomain === true,'GATEWAY_ADMISSION_DENIED');
  }
  mgwRequire_(mgwKeys_(body,keys) && mgwId_(body.uid,128) && ['.','..'].indexOf(body.uid) < 0
    && body.projectId === mgwDestination_(op),'GATEWAY_ADMISSION_DENIED');
  if (op === 'WRITE_FB_LEASE') {
    mgwRequire_(body.expectedRevision === null || mgwTimestampMicros_(body.expectedRevision) > 0,'GATEWAY_ADMISSION_DENIED');
    mgwLease_(body.lease,body.uid,config,time,true);
  }
  if (op === 'INVALIDATE_FB_LEASE') mgwRequire_(mgwId_(body.expectedGrantId,100)
    && mgwInteger_(body.expectedLeaseVersion,1) && typeof body.reasonCode === 'string'
    && /^[A-Z][A-Z0-9_]{1,79}$/.test(body.reasonCode),'GATEWAY_ADMISSION_DENIED');
}
function mgwTimestampMicros_(value) {
  mgwRequire_(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3}(?:\d{3})?(?:\d{3})?)?Z$/.test(value),'GATEWAY_RESULT_INVALID');
  var ms=Date.parse(value), fraction=(value.split('.')[1] || '').replace('Z','').padEnd(9,'0');
  var result=ms*1000+Number(fraction.slice(3,6));
  mgwRequire_(Number.isSafeInteger(result) && result > 0 && new Date(ms).toISOString().slice(0,19) === value.slice(0,19),'GATEWAY_RESULT_INVALID');
  return result;
}
function mgwFieldsDecode_(fields) {
  mgwRequire_(mgwObject_(fields),'GATEWAY_RESULT_INVALID');
  function decode(value,depth) {
    mgwRequire_(depth <= 12 && mgwObject_(value) && Object.keys(value).length === 1,'GATEWAY_RESULT_INVALID');
    if (Object.prototype.hasOwnProperty.call(value,'booleanValue')) { mgwRequire_(typeof value.booleanValue === 'boolean','GATEWAY_RESULT_INVALID');return value.booleanValue; }
    if (Object.prototype.hasOwnProperty.call(value,'stringValue')) { mgwRequire_(typeof value.stringValue === 'string','GATEWAY_RESULT_INVALID');return value.stringValue; }
    if (Object.prototype.hasOwnProperty.call(value,'integerValue')) { var n=Number(value.integerValue);mgwRequire_(typeof value.integerValue === 'string' && /^(0|[1-9]\d*)$/.test(value.integerValue) && mgwInteger_(n),'GATEWAY_RESULT_INVALID');return n; }
    if (Object.prototype.hasOwnProperty.call(value,'arrayValue')) { var a=value.arrayValue.values || [];mgwRequire_(Array.isArray(a)&&a.length<=1000,'GATEWAY_RESULT_INVALID');return a.map(function(v){return decode(v,depth+1);}); }
    if (Object.prototype.hasOwnProperty.call(value,'mapValue')) return map(value.mapValue.fields || {},depth+1);
    mgwDeny_('GATEWAY_RESULT_INVALID');
  }
  function map(values,depth) { mgwRequire_(mgwObject_(values),'GATEWAY_RESULT_INVALID');var result={};Object.keys(values).forEach(function(k){mgwRequire_(['__proto__','prototype','constructor'].indexOf(k)<0,'GATEWAY_RESULT_INVALID');result[k]=decode(values[k],depth);});return result; }
  return map(fields,0);
}
function mgwFieldsEncode_(value) {
  function encode(v) { if(typeof v==='boolean')return {booleanValue:v};if(typeof v==='string')return {stringValue:v};
    if(typeof v==='number'){mgwRequire_(mgwInteger_(v),'GATEWAY_ADMISSION_DENIED');return {integerValue:String(v)};}
    if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};return {mapValue:{fields:mgwFieldsEncode_(v)}}; }
  mgwRequire_(mgwObject_(value),'GATEWAY_ADMISSION_DENIED');var result={};Object.keys(value).forEach(function(k){result[k]=encode(value[k]);});return result;
}
function mgwLease_(lease,uid,config,time,live) {
  mgwRequire_(mgwKeys_(lease,MGW_LEASE_FIELDS_) && lease.schemaVersion===1 && lease.sourceProjectId===MGW_FA_
    && lease.destinationProjectId===MGW_FB_ && lease.faUid===uid && lease.fbUid===uid && mgwId_(lease.memberId,200)
    && mgwInteger_(lease.leaseVersion,1) && mgwId_(lease.grantId,100) && mgwInteger_(lease.sourceVersion,1)
    && lease.policyVersion===config.managementPolicyVersion && mgwHash_(lease.sourceHash)
    && typeof lease.active==='boolean' && typeof lease.revoked==='boolean' && typeof lease.managementAllowed==='boolean'
    && typeof lease.role==='string' && lease.role.length<=100 && mgwKeys_(lease.permissions,MGW_PROFILE_PERMISSIONS_)
    && MGW_PROFILE_PERMISSIONS_.every(function(k){return typeof lease.permissions[k]==='boolean';})
    && mgwInteger_(lease.sourceAuthValidAfterTimeMs) && mgwInteger_(lease.confirmedAtMs,1)
    && mgwInteger_(lease.validUntilMs,1),'GATEWAY_ADMISSION_DENIED');
  ['memberAreaIds','managerAreaIds','documentGroups'].forEach(function(k){mgwRequire_(Array.isArray(lease[k])&&lease[k].length<=1000
    && lease[k].every(function(v){return mgwId_(v,128);})&&new Set(lease[k]).size===lease[k].length,'GATEWAY_ADMISSION_DENIED');});
  mgwRequire_(lease.documentGroups.length<=2 && lease.documentGroups.every(function(v){return ['GENERAL','RESTRICTED'].indexOf(v)>=0;}),'GATEWAY_ADMISSION_DENIED');
  if(live)mgwRequire_(lease.active && !lease.revoked && lease.managementAllowed && lease.confirmedAtMs<=time
    && lease.validUntilMs>time && lease.validUntilMs-lease.confirmedAtMs<=300000,'GATEWAY_ADMISSION_DENIED');
  return lease;
}
function mgwFirestoreHttp_(method,path,payload,configured,request,execution) {
  var token=null;
  try {
    mgwLive_(request,configured.config.policy,execution);mgwScopes_();token=ScriptApp.getOAuthToken();
    mgwRequire_(typeof token==='string'&&token.length>0&&token.length<=16000&&!/\s/.test(token),'GATEWAY_OPERATION_FAILED');
    var remaining=Math.min(request.expiresAtMs,execution.startedAtMs+configured.config.policy.operationTimeoutMs)-mgwLive_(request,configured.config.policy,execution);
    mgwRequire_(remaining>=1000,'GATEWAY_OPERATION_TIMEOUT');
    var options={timeoutSeconds:Math.floor(remaining/1000),method:method,headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      validateHttpsCertificates:true,followRedirects:false,muteHttpExceptions:true};
    if(method==='post'){options.contentType='application/json; charset=utf-8';options.payload=JSON.stringify(payload);}
    var response=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/'+path,options);
    mgwLive_(request,configured.config.policy,execution);
    var status=response.getResponseCode(),headers=response.getAllHeaders(),contentType=null,age=null;
    Object.keys(headers).forEach(function(k){if(k.toLowerCase()==='content-type'){mgwRequire_(contentType===null,'GATEWAY_RESULT_INVALID');contentType=headers[k];}
      if(k.toLowerCase()==='age'){mgwRequire_(age===null,'GATEWAY_RESULT_INVALID');age=headers[k];}});
    mgwRequire_(typeof contentType==='string'&&/^application\/json(?:\s*;|$)/i.test(contentType)
      && (age===null || typeof age==='string'&&/^0+$/.test(age)),'GATEWAY_RESULT_INVALID');
    var bytes=response.getBlob().getBytes();mgwRequire_(Array.isArray(bytes)&&bytes.length>0&&bytes.length<=configured.config.maxGoogleResponseBytes,'GATEWAY_RESULT_INVALID');
    var text=Utilities.newBlob(bytes).getDataAsString('UTF-8');
    var roundTrip=mgwBytes_(text);mgwRequire_(roundTrip.length===bytes.length&&roundTrip.every(function(v,i){return (v+256)%256===(bytes[i]+256)%256;}),'GATEWAY_RESULT_INVALID');
    var data=mgwParse_(text,configured.config.maxGoogleResponseBytes,'GATEWAY_RESULT_INVALID');
    if(status===404 && method==='get' && data.error && data.error.status==='NOT_FOUND')return {missing:true};
    if((status===409||status===412) && data.error && ['ABORTED','FAILED_PRECONDITION'].indexOf(data.error.status)>=0)return {conflict:true};
    // Only fixed error categories survive. No raw body/message is returned or logged.
    mgwRequire_(status===200,'GATEWAY_OPERATION_FAILED');return {data:data};
  } finally {token=null;}
}
function mgwDataOperation_(request,configured,execution) {
  var body=request.body,op=request.operation,config=configured.config;
  mgwDataBody_(op,body,config,mgwLive_(request,config.policy,execution));
  var database='projects/'+MGW_FB_+'/databases/(default)',base=database+'/documents/';
  var leaseName=base+'managementAuthorizationLeases/'+body.uid;
  function call(method,path,payload){return mgwFirestoreHttp_(method,path,payload,configured,request,execution);}
  function record(item,name) {
    if(item.missing===name)return {exists:false,revision:null,data:null};
    mgwRequire_(item.found&&item.found.name===name&&mgwTimestampMicros_(item.found.updateTime)>0,'GATEWAY_RESULT_INVALID');
    return {exists:true,revision:item.found.updateTime,data:mgwFieldsDecode_(item.found.fields)};
  }
  if(op==='READ_FA_AUTHORIZATION') {
    var path='projects/'+MGW_FA_+'/databases/(default)/documents/users/'+encodeURIComponent(body.uid)
      +'?mask.fieldPaths=active&mask.fieldPaths=access&mask.fieldPaths=role&mask.fieldPaths=permissions&mask.fieldPaths=memberId&mask.fieldPaths=firstLoginCohort';
    var response=call('get',path,null);mgwRequire_(!response.missing&&response.data,'GATEWAY_RESULT_INVALID');var doc=response.data;
    mgwRequire_(doc.name==='projects/'+MGW_FA_+'/databases/(default)/documents/users/'+body.uid,'GATEWAY_RESULT_INVALID');
    var source=mgwFieldsDecode_(doc.fields),version=mgwTimestampMicros_(doc.updateTime);
    mgwRequire_(source.active===true&&source.access===true&&typeof source.role==='string'&&source.role.length<=100
      && mgwObject_(source.permissions)&&['STRUCTURAL','HOMOLOGATION'].indexOf(source.firstLoginCohort)<0,'GATEWAY_ADMISSION_DENIED');
    var perms={};MGW_PROFILE_PERMISSIONS_.forEach(function(k){mgwRequire_(source.permissions[k]===undefined||typeof source.permissions[k]==='boolean','GATEWAY_RESULT_INVALID');perms[k]=source.permissions[k]===true;});
    ['occurrencesRead','occurrencesAuditRead'].forEach(function(k){
      mgwRequire_(source.permissions[k]===undefined||typeof source.permissions[k]==='boolean','GATEWAY_RESULT_INVALID');
      if(source.permissions[k]!==undefined)perms[k]=source.permissions[k];
    });
    var trustedEmail=null;
    var auth=mgwLookup_({operation:'AUTH_USER_LOOKUP_FA',body:{uid:body.uid},expiresAtMs:request.expiresAtMs,issuedAtMs:request.issuedAtMs},configured,execution,function(email){trustedEmail=email;});
    mgwRequire_(auth.users.length===1,'GATEWAY_ADMISSION_DENIED');var user=auth.users[0],providers=user.providerUserInfo.filter(function(p){return p.providerId==='google.com';});
    mgwRequire_(user.disabled!==true&&user.emailVerified===true&&providers.length===1&&user.identityMarker===undefined,'GATEWAY_ADMISSION_DENIED');
    var domain=body.includeManagementDomain===true ? mgwManagementDomainContext_(body.uid,providers[0].rawId,trustedEmail,call) : {areas:[],documentAccess:{active:false,groups:[]}};
    trustedEmail=null;
    var memberId=source.memberId===undefined?body.uid:source.memberId;mgwRequire_(mgwId_(memberId,200),'GATEWAY_RESULT_INVALID');
    return {schemaVersion:1,projectId:MGW_FA_,fromCache:false,hasPendingWrites:false,readTimeMs:mgwLive_(request,config.policy,execution),
      consistentRead:true,coverageComplete:true,productionAuthorized:true,authorizationVersion:version,
      authUser:{uid:body.uid,disabled:false,emailVerified:true,googleUid:providers[0].rawId,identityMarker:null,tokensValidAfterTimeMs:Number(user.validSince||'0')*1000},
      profile:{uid:body.uid,memberId:memberId,active:true,access:true,role:source.role,permissions:perms},binding:null,
      areas:domain.areas,documentAccess:domain.documentAccess};
  }
  if(op==='READ_FB_LEASE') {
    var response=call('get',database+'/documents/managementAuthorizationLeases/'+encodeURIComponent(body.uid),null),doc=response.data;
    if(!response.missing)mgwRequire_(doc&&doc.name===leaseName&&mgwTimestampMicros_(doc.updateTime)>0,'GATEWAY_RESULT_INVALID');
    var lease=response.missing?null:mgwLease_(mgwFieldsDecode_(doc.fields),body.uid,config,0,false);
    return {schemaVersion:1,projectId:MGW_FB_,fromCache:false,hasPendingWrites:false,readTimeMs:mgwLive_(request,config.policy,execution),
      exists:!response.missing,revision:response.missing?null:doc.updateTime,lease:lease};
  }
  var grantId=op==='WRITE_FB_LEASE'?body.lease.grantId:body.expectedGrantId;
  var fenceName=base+'managementAuthorizationFences/'+mgwSha_(mgwCanonical_([body.uid,grantId]));
  var started=call('post',database+'/documents:beginTransaction',{options:{readWrite:{}}}).data;
  mgwRequire_(started&&typeof started.transaction==='string'&&/^[A-Za-z0-9+/]{4,2048}={0,2}$/.test(started.transaction),'GATEWAY_RESULT_INVALID');
  var transaction=started.transaction,commitSent=false;
  try {
    var rows=call('post',database+'/documents:batchGet',{documents:[leaseName,fenceName],transaction:transaction}).data;
    mgwRequire_(Array.isArray(rows)&&rows.length===2,'GATEWAY_RESULT_INVALID');var records={};
    rows.forEach(function(row){var name=row.found?row.found.name:row.missing;mgwRequire_([leaseName,fenceName].indexOf(name)>=0&&!records[name],'GATEWAY_RESULT_INVALID');records[name]=record(row,name);});
    var prior=records[leaseName],fence=records[fenceName],writes=[];mgwRequire_(prior&&fence,'GATEWAY_RESULT_INVALID');
    if(prior.exists)mgwLease_(prior.data,body.uid,config,0,false);
    if(fence.exists)mgwRequire_(fence.data.uid===body.uid&&fence.data.grantId===grantId,'GATEWAY_RESULT_INVALID');
    if(op==='WRITE_FB_LEASE') {
      if(fence.exists||prior.revision!==body.expectedRevision)return {applied:false,projectId:MGW_FB_};
      var next=mgwLease_(body.lease,body.uid,config,mgwLive_(request,config.policy,execution),true);
      mgwRequire_(!prior.exists?next.leaseVersion===1:prior.data.memberId===next.memberId&&next.leaseVersion===prior.data.leaseVersion+1
        &&next.sourceVersion>=prior.data.sourceVersion&&(next.sourceVersion>prior.data.sourceVersion||next.sourceHash===prior.data.sourceHash&&!prior.data.revoked),'GATEWAY_ADMISSION_DENIED');
      writes.push({update:{name:leaseName,fields:mgwFieldsEncode_(next)},currentDocument:prior.exists?{updateTime:prior.revision}:{exists:false}});
    } else {
      if(!fence.exists)writes.push({update:{name:fenceName,fields:mgwFieldsEncode_({schemaVersion:1,sourceProjectId:MGW_FA_,destinationProjectId:MGW_FB_,
        uid:body.uid,grantId:grantId,leaseVersion:body.expectedLeaseVersion,fencedAtMs:mgwLive_(request,config.policy,execution),reasonCode:body.reasonCode})},currentDocument:{exists:false}});
      var matched=prior.exists&&prior.data.grantId===grantId&&prior.data.leaseVersion===body.expectedLeaseVersion;
      if(matched){var revoked=prior.data;revoked.active=false;revoked.revoked=true;revoked.managementAllowed=false;revoked.validUntilMs=Math.min(revoked.validUntilMs,mgwLive_(request,config.policy,execution));
        writes.push({update:{name:leaseName,fields:mgwFieldsEncode_(revoked)},currentDocument:{updateTime:prior.revision}});}
      if(!writes.length)return {applied:false,matched:false,fenced:true,projectId:MGW_FB_};
    }
    mgwLive_(request,config.policy,execution);commitSent=true;var result=call('post',database+'/documents:commit',{transaction:transaction,writes:writes});
    if(result.conflict)return {applied:false,matched:false,fenced:false,projectId:MGW_FB_};
    mgwRequire_(result.data&&Array.isArray(result.data.writeResults)&&result.data.writeResults.length===writes.length,'GATEWAY_RESULT_INVALID');
    result.data.writeResults.forEach(function(w){mgwTimestampMicros_(w.updateTime);});
    return op==='WRITE_FB_LEASE'?{applied:true,projectId:MGW_FB_,revision:result.data.writeResults[0].updateTime}
      :{applied:matched,matched:matched,fenced:true,projectId:MGW_FB_};
  } finally {if(!commitSent){try{call('post',database+'/documents:rollback',{transaction:transaction});}catch(_){}}}
}

// Called only for the signed FB-domain request; FC never depends on an FB read.
function mgwManagementDomainContext_(uid,googleUid,email,call) {
  mgwRequire_(mgwId_(uid,128)&&mgwId_(googleUid,128)&&typeof email==='string','GATEWAY_ADMISSION_DENIED');
  email=email.trim().toLowerCase();
  mgwRequire_(email.length<=254&&/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(email),'GATEWAY_ADMISSION_DENIED');
  var base='projects/'+MGW_FB_+'/databases/(default)/documents/';
  var rows=call('post',base.slice(0,-1)+':runQuery',{structuredQuery:{
    from:[{collectionId:'managementAreas'}],select:{fields:['active','memberUids','managerUids'].map(function(k){return {fieldPath:k};})},
    where:{compositeFilter:{op:'OR',filters:['memberUids','managerUids'].map(function(k){return {fieldFilter:{field:{fieldPath:k},op:'ARRAY_CONTAINS',value:{stringValue:uid}}};})}},limit:26
  }}).data;
  mgwRequire_(Array.isArray(rows)&&rows.length<=26,'GATEWAY_RESULT_INVALID');
  var areas=[],seen={};
  rows.forEach(function(row){
    if(!row.document){mgwRequire_(row.readTime&&rows.length===1,'GATEWAY_RESULT_INVALID');return;}
    var doc=row.document;mgwRequire_(typeof doc.name==='string'&&doc.name.indexOf(base+'managementAreas/')===0,'GATEWAY_RESULT_INVALID');
    var id=doc.name.slice((base+'managementAreas/').length),data=mgwFieldsDecode_(doc.fields);
    mgwRequire_(mgwId_(id,128)&&!seen[id]&&typeof data.active==='boolean','GATEWAY_RESULT_INVALID');seen[id]=true;
    ['memberUids','managerUids'].forEach(function(k){mgwRequire_(Array.isArray(data[k])&&data[k].length<=100&&data[k].every(function(v){return mgwId_(v,128);})&&new Set(data[k]).size===data[k].length,'GATEWAY_RESULT_INVALID');});
    mgwRequire_(data.memberUids.indexOf(uid)>=0||data.managerUids.indexOf(uid)>=0,'GATEWAY_RESULT_INVALID');
    areas.push({id:id,active:data.active,version:mgwTimestampMicros_(doc.updateTime),memberUids:data.memberUids,managerUids:data.managerUids});
  });
  // Overflow is never reported as complete authorization coverage.
  mgwRequire_(areas.length<=25,'GATEWAY_RESULT_INVALID');areas.sort(function(a,b){return a.id<b.id?-1:a.id>b.id?1:0;});
  var name='projects/'+MGW_FA_+'/databases/(default)/documents/documentAccessEmails/'+email;
  var result=call('get','projects/'+MGW_FA_+'/databases/(default)/documents/documentAccessEmails/'+encodeURIComponent(email)+'?mask.fieldPaths=id&mask.fieldPaths=email&mask.fieldPaths=active&mask.fieldPaths=groups',null);
  var access={active:false,groups:[]};
  if(!result.missing){
    mgwRequire_(result.data&&result.data.name===name,'GATEWAY_RESULT_INVALID');
    var acl=mgwFieldsDecode_(result.data.fields);
    mgwRequire_(acl.id===email&&acl.email===email&&typeof acl.active==='boolean'&&Array.isArray(acl.groups)&&acl.groups.length<=2&&new Set(acl.groups).size===acl.groups.length&&acl.groups.every(function(g){return ['GENERAL','RESTRICTED'].indexOf(g)>=0;}),'GATEWAY_RESULT_INVALID');
    if(acl.active)access={active:true,groups:acl.groups.slice().sort(),googleUid:googleUid};
  }
  return {areas:areas,documentAccess:access};
}
