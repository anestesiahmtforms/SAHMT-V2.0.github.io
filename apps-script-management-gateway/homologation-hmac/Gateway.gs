/**
 * Isolated HMAC-only probe for the disposable HOMOLOGACAO Apps Script copy.
 * It has no authentication, user lookup, token signing, or data operation code.
 */
var HOMOLOGATION_PROTOCOL_ = 'SAHMT_MANAGEMENT_GATEWAY_V1';
var HOMOLOGATION_AUDIENCE_ = 'sahmt-management-dedicated-appscript-v1';
var HOMOLOGATION_KEY_ID_ = 'sahmt-appscript-gateway-hmac-v1';
var HOMOLOGATION_FA_ = 'sahmt-17a16';
var HOMOLOGATION_OPERATIONS_ = [
  'AUTH_USER_LOOKUP_FA', 'AUTH_USER_LOOKUP_FB', 'AUTH_USER_LOOKUP_FC',
  'SIGN_FB_CUSTOM_TOKEN', 'SIGN_FC_CUSTOM_TOKEN', 'FIRST_LOGIN_FA_SIGN'
];
var HOMOLOGATION_ENABLED_OPERATIONS_ = {
  AUTH_USER_LOOKUP_FA: false,
  AUTH_USER_LOOKUP_FB: false,
  AUTH_USER_LOOKUP_FC: false,
  SIGN_FB_CUSTOM_TOKEN: false,
  SIGN_FC_CUSTOM_TOKEN: false,
  FIRST_LOGIN_FA_SIGN: false
};
var HOMOLOGATION_LIMITS_ = {ttlMs: 20000, futureSkewMs: 5000, bodyBytes: 8192, nonceRecords: 32, nonceRetentionMs: 120000};
var HOMOLOGATION_SECRET_PROPERTY_ = 'SAHMT_HOMOLOGATION_HMAC_SECRET_BASE64URL';
var HOMOLOGATION_NONCE_PREFIX_ = 'SAHMT_HOMOLOGATION_NONCE_V1_';

function homDeny_(code) { var error = new Error(code); error.safeCode = code; throw error; }
function homRequire_(condition, code) { if (!condition) homDeny_(code); }
function homObject_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function homExactKeys_(value, keys) {
  if (!homObject_(value)) return false;
  var actual = Object.keys(value);
  return actual.length === keys.length && keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
}
function homCanonical_(value, depth, state) {
  depth = depth || 0; state = state || {nodes: 0};
  homRequire_(depth <= 16 && ++state.nodes <= 4096, 'GATEWAY_ADMISSION_DENIED');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    homRequire_(Number.isSafeInteger(value) && !Object.is(value, -0), 'GATEWAY_ADMISSION_DENIED');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    homRequire_(Object.getPrototypeOf(value) === Array.prototype && Object.getOwnPropertySymbols(value).length === 0
      && Object.getOwnPropertyNames(value).length === value.length + 1 && Object.keys(value).length === value.length,
    'GATEWAY_ADMISSION_DENIED');
    var items = [];
    for (var index = 0; index < value.length; index++) {
      var item = Object.getOwnPropertyDescriptor(value, String(index));
      homRequire_(item && item.enumerable && Object.prototype.hasOwnProperty.call(item, 'value'), 'GATEWAY_ADMISSION_DENIED');
      items.push(homCanonical_(item.value, depth + 1, state));
    }
    return '[' + items.join(',') + ']';
  }
  homRequire_(homObject_(value) && Object.getPrototypeOf(value) === Object.prototype
    && Object.getOwnPropertySymbols(value).length === 0, 'GATEWAY_ADMISSION_DENIED');
  var keys = Object.keys(value).sort();
  homRequire_(Object.getOwnPropertyNames(value).length === keys.length, 'GATEWAY_ADMISSION_DENIED');
  return '{' + keys.map(function (key) {
    var descriptor = Object.getOwnPropertyDescriptor(value, key);
    homRequire_(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value'), 'GATEWAY_ADMISSION_DENIED');
    return JSON.stringify(key) + ':' + homCanonical_(descriptor.value, depth + 1, state);
  }).join(',') + '}';
}
function homBytes_(text) { return Utilities.newBlob(text).getBytes(); }
function homHex_(bytes) { return bytes.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join(''); }
function homSha_(text) { return homHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, homBytes_(text))); }
function homHmac_(text, secret) { return homHex_(Utilities.computeHmacSha256Signature(homBytes_(text), secret)); }
function homEqual_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== 64 || right.length !== 64
    || !/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  var different = 0;
  for (var index = 0; index < 64; index++) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}
function homText_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function homSecret_() {
  var encoded = PropertiesService.getScriptProperties().getProperty(HOMOLOGATION_SECRET_PROPERTY_);
  homRequire_(typeof encoded === 'string' && /^[A-Za-z0-9_-]{43}$/.test(encoded), 'GATEWAY_ADMISSION_DENIED');
  var bytes = Utilities.base64DecodeWebSafe(encoded);
  homRequire_(bytes.length === 32 && Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '') === encoded,
    'GATEWAY_ADMISSION_DENIED');
  return bytes;
}
function homDestination_(operation) {
  if (operation === 'FIRST_LOGIN_FA_SIGN') return HOMOLOGATION_FA_;
  if (operation === 'AUTH_USER_LOOKUP_FB' || operation === 'SIGN_FB_CUSTOM_TOKEN') return 'sahmt-gestao-5ae66';
  if (operation === 'AUTH_USER_LOOKUP_FC' || operation === 'SIGN_FC_CUSTOM_TOKEN') return 'indicadores---sahmt';
  return null;
}
function homSignature_(envelope, direction, secret) {
  var unsigned = {};
  Object.keys(envelope).forEach(function (key) { if (key !== 'signature') unsigned[key] = envelope[key]; });
  return homHmac_(HOMOLOGATION_PROTOCOL_ + '_' + direction + '\n' + homCanonical_(unsigned), secret);
}
function homValidateRequest_(request, secret, now) {
  var keys = ['schemaVersion', 'protocolVersion', 'audience', 'keyId', 'direction', 'sourceProjectId',
    'destinationProjectId', 'operation', 'requestId', 'nonce', 'issuedAtMs', 'expiresAtMs', 'body', 'bodySha256', 'signature'];
  homRequire_(homExactKeys_(request, keys) && request.schemaVersion === 1
    && request.protocolVersion === HOMOLOGATION_PROTOCOL_ && request.audience === HOMOLOGATION_AUDIENCE_
    && request.keyId === HOMOLOGATION_KEY_ID_ && request.direction === 'WORKER_TO_APPS_SCRIPT'
    && request.sourceProjectId === HOMOLOGATION_FA_ && request.destinationProjectId === homDestination_(request.operation)
    && HOMOLOGATION_OPERATIONS_.indexOf(request.operation) >= 0
    && request.operation === 'AUTH_USER_LOOKUP_FB'
    && /^[a-f0-9]{32}$/.test(request.requestId) && /^[a-f0-9]{32}$/.test(request.nonce)
    && Number.isSafeInteger(request.issuedAtMs) && Number.isSafeInteger(request.expiresAtMs)
    && request.expiresAtMs > request.issuedAtMs && request.expiresAtMs - request.issuedAtMs <= HOMOLOGATION_LIMITS_.ttlMs
    && request.issuedAtMs <= now + HOMOLOGATION_LIMITS_.futureSkewMs && now < request.expiresAtMs
    && homObject_(request.body) && homExactKeys_(request.body, ['uid'])
    && request.body.uid === 'synthetic-homologation-uid'
    && /^[a-f0-9]{64}$/.test(request.bodySha256) && /^[a-f0-9]{64}$/.test(request.signature),
  'GATEWAY_ENVELOPE_INVALID');
  homRequire_(homBytes_(homCanonical_(request.body)).length <= HOMOLOGATION_LIMITS_.bodyBytes
    && homEqual_(request.bodySha256, homSha_(homCanonical_(request.body)))
    && homEqual_(request.signature, homSignature_(request, 'REQUEST', secret)), 'GATEWAY_SIGNATURE_INVALID');
}
function homClaimNonce_(request, secret, now) {
  var lock = LockService.getScriptLock(), held = false;
  try {
    homRequire_(lock.tryLock(500) === true, 'GATEWAY_ADMISSION_DENIED'); held = true;
    var properties = PropertiesService.getScriptProperties();
    var prefix = HOMOLOGATION_NONCE_PREFIX_, all = properties.getProperties(), keys = Object.keys(all);
    var live = [];
    keys.forEach(function (key) {
      if (key.indexOf(prefix) !== 0) return;
      var record;
      try { record = JSON.parse(all[key]); } catch (_) { homDeny_('GATEWAY_ADMISSION_DENIED'); }
      homRequire_(homExactKeys_(record, ['requestId', 'nonce', 'retainUntilMs'])
        && /^[a-f0-9]{32}$/.test(record.requestId) && /^[a-f0-9]{32}$/.test(record.nonce)
        && Number.isSafeInteger(record.retainUntilMs) && record.retainUntilMs > 0, 'GATEWAY_ADMISSION_DENIED');
      if (record.retainUntilMs <= now) properties.deleteProperty(key); else live.push({key:key, record:record});
    });
    var ledgerKey = prefix + homSha_(HOMOLOGATION_AUDIENCE_ + '\n' + request.nonce);
    if (live.some(function (entry) { return entry.key === ledgerKey || entry.record.requestId === request.requestId
      || entry.record.nonce === request.nonce; })) return false;
    homRequire_(live.length < HOMOLOGATION_LIMITS_.nonceRecords, 'GATEWAY_ADMISSION_DENIED');
    var retainUntil = Math.min(request.expiresAtMs + HOMOLOGATION_LIMITS_.futureSkewMs, now + HOMOLOGATION_LIMITS_.nonceRetentionMs);
    var encoded = homCanonical_({requestId:request.requestId, nonce:request.nonce, retainUntilMs:retainUntil});
    properties.setProperty(ledgerKey, encoded);
    homRequire_(properties.getProperty(ledgerKey) === encoded, 'GATEWAY_ADMISSION_DENIED');
    return true;
  } finally { if (held) lock.releaseLock(); }
}
function homSignedDenial_(request, code, secret) {
  var response = {};
  ['schemaVersion', 'protocolVersion', 'audience', 'keyId', 'sourceProjectId', 'destinationProjectId',
    'operation', 'requestId', 'nonce', 'issuedAtMs', 'expiresAtMs'].forEach(function (key) { response[key] = request[key]; });
  response.direction = 'APPS_SCRIPT_TO_WORKER';
  response.requestHash = homSha_(homCanonical_(request));
  response.status = 'DENIED'; response.code = code; response.body = null;
  response.bodySha256 = homSha_(homCanonical_(null));
  response.signature = homSignature_(response, 'RESPONSE', secret);
  return response;
}

/** HMAC-only endpoint. Every operation remains disabled and no operation dispatch exists. */
function doPost(event) {
  var secret = null, request = null;
  try {
    homRequire_(homObject_(event) && (event.queryString === null || event.queryString === undefined || event.queryString === '')
      && (event.pathInfo === null || event.pathInfo === undefined || event.pathInfo === '')
      && homObject_(event.postData) && event.postData.type === 'application/json'
      && typeof event.postData.contents === 'string', 'GATEWAY_ADMISSION_DENIED');
    var raw = event.postData.contents;
    homRequire_(homBytes_(raw).length <= 65536 && Number.isSafeInteger(event.postData.length)
      && event.postData.length === homBytes_(raw).length, 'GATEWAY_ADMISSION_DENIED');
    request = JSON.parse(raw);
    homCanonical_(request);
    secret = homSecret_();
    var now = Date.now();
    homValidateRequest_(request, secret, now);
    var firstUse = homClaimNonce_(request, secret, now);
    var code = firstUse && HOMOLOGATION_ENABLED_OPERATIONS_[request.operation] === false
      ? 'GATEWAY_DISABLED' : 'GATEWAY_REPLAY_DENIED';
    var signed = homSignedDenial_(request, code, secret);
    homRequire_(homBytes_(homCanonical_(signed)).length <= 65536, 'GATEWAY_ADMISSION_DENIED');
    return homText_(signed);
  } catch (_) {
    return homText_({ok: false, code: 'GATEWAY_ADMISSION_DENIED'});
  } finally {
    if (secret && typeof secret.length === 'number') for (var index = 0; index < secret.length; index++) secret[index] = 0;
    secret = null; request = null;
  }
}
