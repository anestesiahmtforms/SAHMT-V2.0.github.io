// Run once from the FC owner's editor. No endpoint invokes this function.
// The deployment builder injects fcInstallBootstrap_ in a private server file.
// No business writes, trigger installation, billing or central configuration.
function fcAssertPrivateOcrFolder_(folderId) {
  // DriveApp.Access.PRIVATE does not exclude explicitly shared users/groups.
  // Inspect all ACL pages before placing temporary documents in this folder.
  const base = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(folderId) + '/permissions';
  let pageToken = '', pages = 0, ownerFound = false;
  try {
    do {
      if (++pages > 10) throw Error('ACL_LIMIT');
      const url = base + '?pageSize=100&fields=nextPageToken,permissions(type,role,emailAddress,view)' +
        (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      const response = UrlFetchApp.fetch(url, {method: 'get', muteHttpExceptions: true, followRedirects: false,
        headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}});
      if (response.getResponseCode() !== 200) throw Error('ACL_UNAVAILABLE');
      const result = JSON.parse(response.getContentText());
      if (!Array.isArray(result.permissions)) throw Error('ACL_INVALID');
      result.permissions.forEach(function (permission) {
        if (permission.view === 'metadata' && permission.role === 'reader') return;
        if (permission.type === 'user' && permission.role === 'owner' &&
            String(permission.emailAddress || '').toLowerCase() === SAHMT_FC_EXECUTOR_EMAIL) ownerFound = true;
        else throw Error('ACL_SHARED');
      });
      pageToken = result.nextPageToken || '';
    } while (pageToken);
    if (!ownerFound) throw Error('ACL_OWNER_MISSING');
  } catch (_) { throw Error('FC_INSTALL_PRIVATE_FOLDER_REQUIRED'); }
}

function prepararIntegracaoFcV1() {
  const email = function (user) { return String(user && user.getEmail() || '').trim().toLowerCase(); };
  const scriptId = ScriptApp.getScriptId();
  if (email(Session.getEffectiveUser()) !== SAHMT_FC_EXECUTOR_EMAIL ||
      email(Session.getActiveUser()) !== SAHMT_FC_EXECUTOR_EMAIL ||
      email(DriveApp.getFileById(scriptId).getOwner()) !== SAHMT_FC_EXECUTOR_EMAIL) throw Error('FC_INSTALL_OWNER_REQUIRED');
  const props = sahmtV2Properties_();
  if (props.getProperty('FC_INTEGRATION_ENABLED') === 'true') throw Error('FC_INSTALL_ALREADY_ACTIVE');
  const config = fcInstallBootstrap_();
  if (config.scriptId !== scriptId || !/^[A-Za-z0-9_-]{10,200}$/.test(config.ocrFolderId || '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(config.operationalSecret || '') || !/^[A-Za-z0-9_-]{43}$/.test(config.occurrenceSecret || '') ||
      config.operationalSecret === config.occurrenceSecret) throw Error('FC_INSTALL_CONFIG_INVALID');
  const folder = DriveApp.getFolderById(config.ocrFolderId);
  if (email(folder.getOwner()) !== SAHMT_FC_EXECUTOR_EMAIL || folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw Error('FC_INSTALL_PRIVATE_FOLDER_REQUIRED');
  fcAssertPrivateOcrFolder_(config.ocrFolderId);
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.length) throw Error('FC_INSTALL_UNEXPECTED_TRIGGERS');
  const values = {
    FC_INTEGRATION_ENABLED: 'false', FC_EXPECTED_SCRIPT_ID: scriptId, FC_OCR_TEMP_FOLDER_ID: config.ocrFolderId,
    QMENTUM_WRITE_ENABLED: 'false', SAHMT_V2_OCCURRENCE_SCORING_ENABLED: 'false', FC_PERFORMANCE_ENABLED: 'false', QMENTUM_QUARTERLY_ENABLED: 'false',
    SAHMT_V2_EVALUATION_ALLOWED_EMAILS: SAHMT_FC_EXECUTOR_EMAIL,
    SAHMT_OPERATIONAL_PUSH_HMAC_SECRET: config.operationalSecret,
    SAHMT_V2_OCCURRENCE_SCORING_HMAC_SECRET: config.occurrenceSecret,
    SAHMT_CONTINUITY_SYNC_ENABLED: 'NO'
  };
  Object.keys(values).forEach(function (key) {
    const existing = props.getProperty(key);
    if (existing !== null && existing !== values[key]) throw Error('FC_INSTALL_CONFLICT');
  });
  props.setProperties(values, false);
  Object.keys(values).forEach(function (key) {
    if (props.getProperty(key) !== values[key]) throw Error('FC_INSTALL_READBACK_FAILED');
  });
  const result = {code: 'FC_INTEGRATION_PREPARED', station: 'FC', executor: SAHMT_FC_EXECUTOR_EMAIL,
    scriptId: scriptId, triggers: triggers.length, enabled: false, businessWrites: 0, configurationVerified: true,
    secretFingerprints: {operational: sha256Hex_(config.operationalSecret), occurrence: sha256Hex_(config.occurrenceSecret)}};
  console.log(JSON.stringify(result)); return result;
}
