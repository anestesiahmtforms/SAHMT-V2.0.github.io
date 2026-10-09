// Dedicated, local preparation only. No deployment, trigger, Firestore or default activation.
var MGW_VERSION_ = 'SAHMT_MANAGEMENT_GATEWAY_V1';
var MGW_AUDIENCE_ = 'sahmt-management-dedicated-appscript-v1';
var MGW_FA_ = 'sahmt-17a16';
var MGW_FB_ = 'sahmt-gestao-5ae66';
var MGW_REQUEST_DIRECTION_ = 'WORKER_TO_APPS_SCRIPT';
var MGW_RESPONSE_DIRECTION_ = 'APPS_SCRIPT_TO_WORKER';
var MGW_PROPERTIES_ = {
  config: 'MANAGEMENT_GATEWAY_CONFIG_JSON',
  pin: 'MANAGEMENT_GATEWAY_CONFIG_SHA256',
  secret: 'MANAGEMENT_GATEWAY_HMAC_SECRET_BASE64URL',
  clock: 'MGW_CLOCK_V1',
  noncePrefix: 'MGW_NONCE_V1_'
};
var MGW_OPERATIONS_ = ['AUTH_USER_LOOKUP_FA', 'AUTH_USER_LOOKUP_FB', 'SIGN_FB_CUSTOM_TOKEN'];
var MGW_CLAIMS_ = ['managementSourceProjectId', 'managementMemberId', 'managementSourceVersion',
  'managementSourceHash', 'managementPolicyVersion', 'managementSourceAuthTimeMs'];
var MGW_SCOPES_ = ['https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/iam', 'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/userinfo.email'];
var MGW_DENIALS_ = ['GATEWAY_DISABLED', 'GATEWAY_ADMISSION_DENIED', 'GATEWAY_REPLAY_DENIED',
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
    && mgwKeys_(policy.enabledOperations, MGW_OPERATIONS_)
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
  mgwRequire_(mgwKeys_(config, ['schemaVersion', 'enabled', 'actorEmailSha256', 'signerServiceAccountEmail',
    'managementPolicyVersion', 'maxGoogleResponseBytes', 'policy', 'noncePolicy'])
    && config.schemaVersion === 1 && typeof config.enabled === 'boolean' && mgwHash_(config.actorEmailSha256)
    && typeof config.signerServiceAccountEmail === 'string'
    && new RegExp('^[a-z][a-z0-9-]{4,28}[a-z0-9]@' + MGW_FB_ + '\\.iam\\.gserviceaccount\\.com$').test(config.signerServiceAccountEmail)
    && mgwId_(config.managementPolicyVersion, 100)
    && mgwInteger_(config.maxGoogleResponseBytes, 1024) && config.maxGoogleResponseBytes <= 262144
    && mgwEqual_(mgwSha_(mgwCanonical_(config)), pin), 'GATEWAY_CONFIG_INVALID');
  mgwPolicy_(config.policy);
  var noncePolicy = config.noncePolicy;
  mgwRequire_(mgwKeys_(noncePolicy, ['maxNonceRecords', 'maxPropertyBytes', 'maxStorageBytes', 'lockTimeoutMs', 'retentionMs'])
    && mgwInteger_(noncePolicy.maxNonceRecords, 1) && noncePolicy.maxNonceRecords <= 512
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
function mgwScopes_() {
  var status = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, MGW_SCOPES_.slice()).getAuthorizationStatus();
  mgwRequire_(status === ScriptApp.AuthorizationStatus.NOT_REQUIRED, 'GATEWAY_SCOPES_REQUIRED');
}
function mgwBody_(operation, body, request, policy, config, time) {
  if (operation === 'AUTH_USER_LOOKUP_FA' || operation === 'AUTH_USER_LOOKUP_FB') {
    mgwRequire_(mgwKeys_(body, ['uid']) && mgwId_(body.uid, 128), 'GATEWAY_ADMISSION_DENIED');
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
    && request.sourceProjectId === MGW_FA_ && request.destinationProjectId === MGW_FB_
    && MGW_OPERATIONS_.indexOf(request.operation) >= 0
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
  mgwRequire_(mgwKeys_(record, MGW_RECORD_KEYS_) && record.schemaVersion === 1
    && record.namespace === MGW_VERSION_ + ':' + MGW_AUDIENCE_ + ':' + MGW_REQUEST_DIRECTION_
    && record.direction === MGW_REQUEST_DIRECTION_ && mgwHash_(record.requestHash) && record.envelopeHash === record.requestHash
    && mgwWireId_(record.requestId) && mgwWireId_(record.nonce) && mgwKeyId_(record.keyId)
    && MGW_OPERATIONS_.indexOf(record.operation) >= 0 && record.sourceProjectId === MGW_FA_
    && record.destinationProjectId === MGW_FB_ && mgwInteger_(record.issuedAtMs, 1)
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
    var wait = cleanup ? configured.config.noncePolicy.lockTimeoutMs
      : Math.min(configured.config.noncePolicy.lockTimeoutMs, request.expiresAtMs - time - 1);
    mgwRequire_(wait >= 1 && lock.tryLock(wait) === true, 'GATEWAY_ADMISSION_DENIED'); held = true;
    time = cleanup ? mgwExecutionClock_(execution) : mgwLive_(request, configured.config.policy, execution);
    var all = configured.properties.getProperties(), noncePolicy = configured.config.noncePolicy, size = 0, records = [];
    mgwRequire_(mgwObject_(all) && Object.keys(all).length <= noncePolicy.maxNonceRecords + 4, 'GATEWAY_ADMISSION_DENIED');
    Object.keys(all).forEach(function (key) {
      mgwRequire_(typeof all[key] === 'string' && mgwBytes_(all[key]).length <= noncePolicy.maxPropertyBytes, 'GATEWAY_ADMISSION_DENIED');
      size += mgwBytes_(key).length + mgwBytes_(all[key]).length;
      if (key.indexOf(MGW_PROPERTIES_.noncePrefix) === 0) records.push({key: key, record: mgwRecord_(all[key], noncePolicy.maxPropertyBytes, key)});
      else mgwRequire_([MGW_PROPERTIES_.config, MGW_PROPERTIES_.pin, MGW_PROPERTIES_.secret, MGW_PROPERTIES_.clock].indexOf(key) >= 0,
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
    var namespace = MGW_VERSION_ + ':' + MGW_AUDIENCE_ + ':' + MGW_REQUEST_DIRECTION_;
    mgwRequire_(!records.some(function (item) { return item.record.namespace === namespace
      && (item.record.requestId === request.requestId || item.record.nonce === request.nonce); }), 'GATEWAY_REPLAY_DENIED');
    mgwRequire_(records.length < noncePolicy.maxNonceRecords, 'GATEWAY_ADMISSION_DENIED');
    var requestHash = mgwSha_(mgwCanonical_(request));
    var record = {schemaVersion: 1, namespace: namespace, direction: MGW_REQUEST_DIRECTION_,
      requestHash: requestHash, envelopeHash: requestHash, requestId: request.requestId, nonce: request.nonce,
      operation: request.operation, keyId: request.keyId, sourceProjectId: MGW_FA_, destinationProjectId: MGW_FB_,
      issuedAtMs: request.issuedAtMs, expiresAtMs: request.expiresAtMs,
      retainUntilMs: request.expiresAtMs + configured.config.policy.maxFutureSkewMs + noncePolicy.retentionMs, status: 'CLAIMED'};
    mgwRequire_(mgwInteger_(record.retainUntilMs, 1), 'GATEWAY_ADMISSION_DENIED');
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
      && !/[\s\x00-\x1f]/.test(token) && token.split('.').length !== 3, 'GATEWAY_OPERATION_FAILED');
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
function mgwLookup_(request, configured, execution) {
  var project = request.operation === 'AUTH_USER_LOOKUP_FA' ? MGW_FA_ : MGW_FB_;
  var result = mgwGoogleJson_('https://identitytoolkit.googleapis.com/v1/projects/' + project + '/accounts:lookup',
    {localId: [request.body.uid]}, configured, request, execution);
  mgwRequire_(Array.isArray(result.users) && result.users.length <= 1, 'GATEWAY_RESULT_INVALID');
  if (result.users.length === 0) return {users: []};
  var user = result.users[0];
  mgwRequire_(mgwObject_(user) && user.localId === request.body.uid && user.tenantId === undefined
    && (user.disabled === undefined || typeof user.disabled === 'boolean') && typeof user.emailVerified === 'boolean'
    && Array.isArray(user.providerUserInfo) && user.providerUserInfo.length <= 20
    && (user.validSince === undefined || typeof user.validSince === 'string' && /^(0|[1-9]\d*)$/.test(user.validSince)
      && mgwInteger_(Number(user.validSince) * 1000)), 'GATEWAY_RESULT_INVALID');
  var providers = user.providerUserInfo.map(function (provider) {
    mgwRequire_(mgwObject_(provider) && mgwId_(provider.providerId) && mgwId_(provider.rawId, 128), 'GATEWAY_RESULT_INVALID');
    return {providerId: provider.providerId, rawId: provider.rawId};
  });
  mgwRequire_(new Set(providers.map(function (provider) { return provider.providerId; })).size === providers.length, 'GATEWAY_RESULT_INVALID');
  var filtered = {localId: user.localId, emailVerified: user.emailVerified, providerUserInfo: providers};
  if (user.disabled !== undefined) filtered.disabled = user.disabled;
  if (user.validSince !== undefined) filtered.validSince = user.validSince;
  return {users: [filtered]};
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
  var payload = {iss: config.signerServiceAccountEmail, sub: config.signerServiceAccountEmail,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: body.issuedAtSeconds, exp: body.expiresAtSeconds, uid: body.uid, claims: body.claims};
  var result = mgwGoogleJson_('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'
    + config.signerServiceAccountEmail + ':signJwt', {payload: JSON.stringify(payload)}, configured, request, execution);
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
  mgwRequire_(body.expiresAtSeconds * 1000 > mgwLive_(request, config.policy, execution), 'GATEWAY_OPERATION_TIMEOUT');
  return {keyId: result.keyId, signedJwt: result.signedJwt};
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
    var result = request.operation === 'SIGN_FB_CUSTOM_TOKEN' ? mgwSign_(request, configured, execution)
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
      signerAlias: 'FB-SA-01', scopesAuthorized: true, gatewayEnabled: configured.config.enabled,
      configSha256: configured.configPin, operational: false};
  } catch (error) {
    return {ok: false, code: error && ['GATEWAY_CONFIG_INVALID', 'GATEWAY_ACTOR_MISMATCH', 'GATEWAY_SCOPES_REQUIRED'].indexOf(error.gatewayCode) >= 0
      ? error.gatewayCode : 'GATEWAY_ADMISSION_DENIED', actorAlias: 'ATOR_PONTE_GESTAO', operational: false};
  } finally { if (configured) configured.secret = null; }
}

/** No trigger/caller installed. Separate maintenance only after every nonce's acceptance+skew+retention ended. */
function managementGatewayCleanupExpiredNonces_() {
  var configured = null;
  try { configured = mgwConfiguration_(); var time = mgwClock_();
    var count = mgwLedger_(configured, null, {startedAtMs: time, maximumObservedAtMs: time}, true);
    return {ok: true, removed: count, operational: false}; }
  finally { if (configured) configured.secret = null; }
}
