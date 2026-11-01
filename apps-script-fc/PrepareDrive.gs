// Manual, owner-only preparation. Copies staged images; never edits originals,
// Firestore references, sharing, production endpoints or trigger configuration.
function fcValidateImagePreparationPlan_(plan, scriptId) {
  const id = function (value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value); };
  if (!plan || plan.scriptId !== scriptId || ![plan.rootFolderId, plan.privateFolderId, plan.stagingFolderId].every(id) ||
      !plan.folders || ![plan.folders.TECHNIQUES, plan.folders.INDICATORS].every(id) ||
      new Set([plan.rootFolderId, plan.privateFolderId, plan.stagingFolderId, plan.folders.TECHNIQUES, plan.folders.INDICATORS]).size !== 5 ||
      !Array.isArray(plan.images) || plan.images.length !== 20) throw Error('FC_DRIVE_PLAN_INVALID');
  const sources = new Set(), staged = new Set(), names = new Set();
  plan.images.forEach(function (image) {
    if (!image || !id(image.sourceId) || !id(image.stagingId) || image.sourceId === image.stagingId ||
        !['TECHNIQUES', 'INDICATORS'].includes(image.kind) || !/^(?:0[1-9]|10)\.png$/.test(image.name || '') ||
        !Number.isSafeInteger(image.size) || image.size < 1 || image.size > 1048576 || !/^[a-f0-9]{32}$/.test(image.md5Checksum || '') ||
        sources.has(image.sourceId) || staged.has(image.stagingId) || names.has(image.kind + '/' + image.name)) throw Error('FC_DRIVE_PLAN_INVALID');
    sources.add(image.sourceId); staged.add(image.stagingId); names.add(image.kind + '/' + image.name);
  });
  if ([...sources].some(function (sourceId) { return staged.has(sourceId); })) throw Error('FC_DRIVE_PLAN_INVALID');
  return true;
}

function fcDrivePreparationRequest_(path, method, data) {
  if (typeof path !== 'string' || !/^(?:[A-Za-z0-9_-]{10,200}(?:\/copy)?|\?)/.test(path)) throw Error('FC_DRIVE_ENDPOINT_DENIED');
  const options = {method: method || 'get', muteHttpExceptions: true, followRedirects: false,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}};
  if (data !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(data); }
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files' + (path[0] === '?' ? '' : '/') + path, options);
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw Error('FC_DRIVE_PREPARATION_UNAVAILABLE');
  try { return JSON.parse(response.getContentText()); } catch (_) { throw Error('FC_DRIVE_PREPARATION_UNAVAILABLE'); }
}

function organizarRecursosFcV1() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw Error('FC_DRIVE_PREPARATION_BUSY');
  try { return fcOrganizeDriveLocked_(); }
  finally { lock.releaseLock(); }
}

function fcOrganizeDriveLocked_() {
  const email = function (user) { return String(user && user.getEmail() || '').trim().toLowerCase(); };
  const scriptId = ScriptApp.getScriptId(), self = DriveApp.getFileById(scriptId);
  if (email(Session.getEffectiveUser()) !== SAHMT_FC_EXECUTOR_EMAIL || email(Session.getActiveUser()) !== SAHMT_FC_EXECUTOR_EMAIL ||
      email(self.getOwner()) !== SAHMT_FC_EXECUTOR_EMAIL) throw Error('FC_INSTALL_OWNER_REQUIRED');
  if (ScriptApp.getProjectTriggers().length) throw Error('FC_INSTALL_UNEXPECTED_TRIGGERS');
  if (sahmtV2Properties_().getProperty('FC_INTEGRATION_ENABLED') === 'true') throw Error('FC_INSTALL_ALREADY_ACTIVE');
  const plan = fcPreparationBootstrap_(); fcValidateImagePreparationPlan_(plan, scriptId);
  const fields = 'id,name,mimeType,size,md5Checksum,parents,owners(emailAddress),ownedByMe';
  const get = function (id) { return fcDrivePreparationRequest_(encodeURIComponent(id) + '?fields=' + encodeURIComponent(fields)); };
  const ownedFolder = function (id, parent) {
    const file = get(id);
    if (file.mimeType !== 'application/vnd.google-apps.folder' || file.ownedByMe !== true ||
        !file.owners || !file.owners.some(function (owner) { return owner.emailAddress === SAHMT_FC_EXECUTOR_EMAIL; }) ||
        parent && !(file.parents || []).includes(parent)) throw Error('FC_DRIVE_DESTINATION_MISMATCH');
    return file;
  };
  ownedFolder(plan.privateFolderId, plan.rootFolderId); fcAssertPrivateOcrFolder_(plan.privateFolderId);
  ['TECHNIQUES', 'INDICATORS'].forEach(function (kind) {
    ownedFolder(plan.folders[kind], plan.privateFolderId); fcAssertPrivateOcrFolder_(plan.folders[kind]);
  });
  ownedFolder(plan.stagingFolderId, plan.privateFolderId);
  // Verify every staging fingerprint before creating a single final copy.
  plan.images.forEach(function (image) {
    const file = get(image.stagingId);
    if (file.mimeType !== 'image/png' || Number(file.size) !== image.size || file.md5Checksum !== image.md5Checksum ||
        !(file.parents || []).includes(plan.stagingFolderId)) throw Error('FC_DRIVE_STAGING_CHANGED');
  });
  // Only the newly created dedicated project is moved. Existing central files
  // and their parents are never passed to a mutation.
  const scriptFile = get(scriptId);
  if (!(scriptFile.parents || []).includes(plan.privateFolderId)) {
    fcAssertPrivateOcrFolder_(scriptId);
    self.moveTo(DriveApp.getFolderById(plan.privateFolderId));
  }
  if (!(get(scriptId).parents || []).includes(plan.privateFolderId)) throw Error('FC_DRIVE_SCRIPT_MOVE_NOT_VERIFIED');
  const copied = [];
  plan.images.forEach(function (image) {
    const parent = plan.folders[image.kind];
    const query = "'" + parent + "' in parents and trashed=false and appProperties has { key='sahmtSourceId' and value='" + image.sourceId + "' }";
    const existing = fcDrivePreparationRequest_('?q=' + encodeURIComponent(query) + '&pageSize=100&fields=' + encodeURIComponent('nextPageToken,files(' + fields + ')'));
    if (existing.nextPageToken || !Array.isArray(existing.files) || existing.files.length > 1) throw Error('FC_DRIVE_COPY_AMBIGUOUS');
    let file = existing.files[0];
    if (!file) file = fcDrivePreparationRequest_(image.stagingId + '/copy?fields=' + encodeURIComponent(fields), 'post',
      {name: image.name, parents: [parent], appProperties: {sahmtSourceId: image.sourceId, sahmtIsolation: 'fc-v1', sahmtKind: image.kind}});
    file = get(file.id);
    if (file.ownedByMe !== true || file.name !== image.name || file.mimeType !== 'image/png' || Number(file.size) !== image.size ||
        file.md5Checksum !== image.md5Checksum || !(file.parents || []).includes(parent) ||
        !file.owners || !file.owners.some(function (owner) { return owner.emailAddress === SAHMT_FC_EXECUTOR_EMAIL; })) throw Error('FC_DRIVE_COPY_NOT_VERIFIED');
    fcAssertPrivateOcrFolder_(file.id);
    copied.push({sourceId: image.sourceId, stagingId: image.stagingId, destinationId: file.id,
      kind: image.kind, name: image.name, size: image.size, md5Checksum: image.md5Checksum, owner: SAHMT_FC_EXECUTOR_EMAIL});
  });
  const report = {schemaVersion: 1, code: 'FC_DRIVE_PREPARED', scriptId: scriptId, executor: SAHMT_FC_EXECUTOR_EMAIL,
    privateFolderId: plan.privateFolderId, copied: copied, verifiedCopies: copied.length,
    originalFilesChanged: false, firestoreWrites: 0, triggersInstalled: 0, productionCutover: false};
  // Non-secret migration receipt is saved inside the authorized FC staging
  // folder, so the existing connected Drive can retrieve it for readback.
  const receipt = DriveApp.getFolderById(plan.stagingFolderId).createFile('fc-preparation-report-' + Date.now() + '.json', JSON.stringify(report), 'application/json');
  console.log(JSON.stringify({code: report.code, scriptId: scriptId, verifiedCopies: copied.length, reportFileId: receipt.getId(), firestoreWrites: 0}));
  return report;
}
