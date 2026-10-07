/** Catalog metadata and Google Forms release only. This module never enables evaluation or writes credits. */
const SAHMT_V2_TRAINING_RELEASE = Object.freeze({
  source: 'SAHMT_V2_TRAINING_RELEASE', areaId: 'area-gestao-de-documentos', total: 76, batchSize: 5,
  originalRopRootId: '1Kx9FZRhlj2grDbGSH8opHU3pQFemReyG',
  budgetMs: 160000, maxRuns: 80, maxAgeMs: 86400000, handler: 'continuarDisponibilizacaoTreinamentosSahmtV2_',
  materialCount: 84, cloneRootId: '1N0lTv1vewXW_bqhBhN2QG8cq75ZzXdR8', outsideCloneParentId: '1AHqrb1elRlNSmw8L3t_z53gTOo6YjLU2',
  manifestProperty: 'SAHMT_V2_TRAINING_RELEASE_MANIFEST_ID', digestProperty: 'SAHMT_V2_TRAINING_RELEASE_MANIFEST_SHA256',
  cursorProperty: 'SAHMT_V2_TRAINING_RELEASE_CURSOR', jobProperty: 'SAHMT_V2_TRAINING_RELEASE_JOB',
  roots: Object.freeze({
    '1ZVHg-9fcnBv1q8PJgFoUGQ50b5EwAggR': {group: 'GENERAL', count: 18, kind: 'DOCUMENT'},
    '1jwZn5MeuvsSoyHROk_dNS-mXL1teVfBc': {group: 'RESTRICTED', count: 14, kind: 'DOCUMENT'},
    '1gg78vHm0O07B_McXFaMMi_ByGwbbWt-7': {group: 'GENERAL', count: 13, kind: 'DOCUMENT'},
    '1N0lTv1vewXW_bqhBhN2QG8cq75ZzXdR8': {group: 'GENERAL', count: 31, kind: 'ROP'}
  })
});

function trainingReleaseReject_(code) {
  const error = new Error('Catálogo pendente de conferência: ' + code + '.');
  error.trainingReleaseCode = code;
  throw error;
}
/** Keep HTTP diagnostics useful without copying provider messages or private response bodies. */
function trainingReleaseJobError_(error) {
  const status = error && error.status;
  const result = {pendingCode: error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.trainingReleaseCode || '') ? error.trainingReleaseCode : 'JOB_ACCESS'};
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    result.httpStatus = status;
    if (result.pendingCode === 'JOB_ACCESS') {
      if (status === 429) result.pendingCode = 'JOB_QUOTA_EXCEEDED';
      else if ([408,500,502,503,504].includes(status)) result.pendingCode = 'JOB_TEMPORARY_SERVICE';
      else if ([409,412].includes(status)) result.pendingCode = 'JOB_REVISION_CONFLICT';
      else if ([401,403].includes(status)) result.pendingCode = 'JOB_AUTHORIZATION_REQUIRED';
    }
  }
  return result;
}
function trainingReleaseShape_(value, required, optional) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    required.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); }) &&
    Object.keys(value).every(function (key) { return required.concat(optional || []).includes(key); });
}
function trainingReleaseManifestShape_(manifest) {
  if (!trainingReleaseShape_(manifest, ['schemaVersion','source','managerAreaId','actorUid','items']) ||
      manifest.schemaVersion !== 1 || manifest.source !== SAHMT_V2_TRAINING_RELEASE.source ||
      manifest.managerAreaId !== SAHMT_V2_TRAINING_RELEASE.areaId || !formsEvaluationId_(manifest.actorUid) ||
      !Array.isArray(manifest.items) || manifest.items.length !== SAHMT_V2_TRAINING_RELEASE.total) trainingReleaseReject_('MANIFEST_SCHEMA');
  const required = ['formId','sourceId','rootId','title','eligibleGroup','creditScopeId','version','maxTestScore','acknowledgementItemId',
    'suggestionProblemItemId','suggestionProposalItemId','suggestionBenefitItemId','materialUrls','validFrom','validUntil'];
  const ids = new Set(), sources = new Set(), counts = {};
  manifest.items.forEach(function (item) {
    const root = item && SAHMT_V2_TRAINING_RELEASE.roots[item.rootId];
    if (!trainingReleaseShape_(item, required, ['preparedQuestionFingerprint','expectedItems','knownIds','expectedItemsHash','preparedOriginalDigest']) || !root ||
        !['formId','sourceId','creditScopeId','acknowledgementItemId','suggestionProblemItemId','suggestionProposalItemId','suggestionBenefitItemId'].every(function (key) { return formsEvaluationId_(item[key]); }) ||
        item.formId === item.sourceId || item.version !== 1 || !Number.isInteger(item.maxTestScore) || item.maxTestScore <= 0 ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500 || item.eligibleGroup !== root.group ||
        item.validFrom !== '2026-10-06' || item.validUntil !== '2026-12-31' || !Array.isArray(item.materialUrls) ||
        !item.materialUrls.length || item.materialUrls.length > 10 || new Set(item.materialUrls).size !== item.materialUrls.length ||
        item.materialUrls.some(function (url) { return typeof url !== 'string' || !/^https:\/\/(?:drive\.google\.com|docs\.google\.com)\//.test(url) || /[\s@]/.test(url); }) ||
        ['preparedQuestionFingerprint','expectedItemsHash','preparedOriginalDigest'].some(function (key) { return item[key] !== undefined && !/^[a-f0-9]{64}$/.test(item[key]); }) ||
        root.kind === 'DOCUMENT' && (!Array.isArray(item.expectedItems) || !item.expectedItems.length || !item.knownIds || typeof item.knownIds !== 'object' || !item.expectedItemsHash || item.preparedOriginalDigest !== undefined) ||
        root.kind === 'ROP' && (!item.preparedOriginalDigest || item.expectedItems !== undefined || item.knownIds !== undefined || item.expectedItemsHash !== undefined) ||
        new Set([item.acknowledgementItemId,item.suggestionProblemItemId,item.suggestionProposalItemId,item.suggestionBenefitItemId]).size !== 4 ||
        ids.has(item.formId) || sources.has(item.sourceId)) trainingReleaseReject_('MANIFEST_ITEM');
    ids.add(item.formId); sources.add(item.sourceId);
    counts[item.rootId] = (counts[item.rootId] || 0) + 1;
  });
  if (Object.keys(SAHMT_V2_TRAINING_RELEASE.roots).some(function (rootId) { return counts[rootId] !== SAHMT_V2_TRAINING_RELEASE.roots[rootId].count; })) trainingReleaseReject_('MANIFEST_COUNTS');
  return manifest;
}

/** Only an owner-only Drive file is accepted, including when the ID is passed as an argument. */
function trainingReleaseLoad_(manifestId, expectedDigest) {
  const properties = PropertiesService.getScriptProperties();
  const id = manifestId === undefined ? properties.getProperty(SAHMT_V2_TRAINING_RELEASE.manifestProperty) : manifestId;
  const digest = expectedDigest === undefined ? properties.getProperty(SAHMT_V2_TRAINING_RELEASE.digestProperty) : expectedDigest;
  if (!formsEvaluationId_(id) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) trainingReleaseReject_('MANIFEST_PROPERTIES');
  const operator = evaluationAssertOperator_(false);
  try {
    const file = DriveApp.getFileById(id), owner = file.getOwner();
    if (file.isTrashed() || file.getSharingAccess() !== DriveApp.Access.PRIVATE || !owner ||
        String(owner.getEmail() || '').trim().toLowerCase() !== operator || file.getEditors().length || file.getViewers().length) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
    const ownerMetadata = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?fields=' + encodeURIComponent('id,trashed,shared,parents,owners(emailAddress,permissionId)'));
    if (!ownerMetadata || ownerMetadata.id !== id || ownerMetadata.trashed === true || ownerMetadata.shared !== false ||
        !Array.isArray(ownerMetadata.owners) || ownerMetadata.owners.length !== 1 ||
        String(ownerMetadata.owners[0].emailAddress || '').trim().toLowerCase() !== operator || !formsEvaluationId_(ownerMetadata.owners[0].permissionId)) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
    const ownerPermissionId = ownerMetadata.owners[0].permissionId;
    // DriveApp checks the normal ACL; REST also rejects groups and inherited permissions invisible in User[].
    let pageToken = '', pages = 0, owners = 0, inheritedOwner = false;
    const tokens = new Set();
    do {
      const page = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
        '/permissions?supportsAllDrives=true&pageSize=100&fields=' + encodeURIComponent('nextPageToken,permissions(id,type,role,emailAddress,deleted,permissionDetails(inherited))') +
        (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
      if (!page || !Array.isArray(page.permissions) || ++pages > 10) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
      page.permissions.forEach(function (permission) {
        if (permission.id !== ownerPermissionId || permission.type !== 'user' || permission.role !== 'owner' || permission.deleted === true ||
            String(permission.emailAddress || '').trim().toLowerCase() !== operator) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
        if ((permission.permissionDetails || []).some(function (detail) { return detail.inherited === true; })) inheritedOwner = true;
        owners++;
      });
      pageToken = String(page.nextPageToken || '');
      if (pageToken && tokens.has(pageToken)) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
    if (owners !== 1) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
    // An inherited detail for the same owner is valid only if every parent ACL also proves that exact owner alone.
    if (inheritedOwner) {
      if (!Array.isArray(ownerMetadata.parents) || !ownerMetadata.parents.length || ownerMetadata.parents.length > 10) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
      ownerMetadata.parents.forEach(function (parentId) {
        if (!formsEvaluationId_(parentId)) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
        const parent = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(parentId) +
          '?fields=' + encodeURIComponent('id,trashed,shared,owners(emailAddress,permissionId)'));
        const acl = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(parentId) +
          '/permissions?supportsAllDrives=true&pageSize=100&fields=' + encodeURIComponent('nextPageToken,permissions(id,type,role,emailAddress,deleted)'));
        if (!parent || parent.id !== parentId || parent.trashed === true || parent.shared !== false || !Array.isArray(parent.owners) || parent.owners.length !== 1 ||
            parent.owners[0].permissionId !== ownerPermissionId || String(parent.owners[0].emailAddress || '').trim().toLowerCase() !== operator ||
            !acl || acl.nextPageToken || !Array.isArray(acl.permissions) || acl.permissions.length !== 1 || acl.permissions[0].id !== ownerPermissionId ||
            acl.permissions[0].type !== 'user' || acl.permissions[0].role !== 'owner' || acl.permissions[0].deleted === true ||
            String(acl.permissions[0].emailAddress || '').trim().toLowerCase() !== operator) trainingReleaseReject_('MANIFEST_OWNER_ONLY');
      });
    }
    const text = file.getBlob().getDataAsString('UTF-8');
    const byteLength = encodeURIComponent(text).replace(/%[0-9A-F]{2}|[^%]/g, 'x').length;
    if (byteLength > 1048576 || formsEvaluationHash_(text) !== digest) trainingReleaseReject_('MANIFEST_DIGEST');
    const manifest = trainingReleaseManifestShape_(JSON.parse(text));
    return {id: id, digest: digest, manifest: manifest, operator: operator};
  } catch (error) { trainingReleaseReject_(error.trainingReleaseCode || 'MANIFEST_ACCESS'); }
}

function trainingReleaseContext_(loaded, tx) {
  const manifest = loaded.manifest, actor = evaluationGet_('users', manifest.actorUid, tx);
  const profiles = formsEvaluationAll_('users', [], tx);
  const identity = formsEvaluationResolveIdentity_({settings: {emailCollectionType: 'VERIFIED'}}, {respondentEmail: loaded.operator}, profiles);
  const actorIdentity = actor && formsEvaluationResolveIdentity_({settings: {emailCollectionType: 'VERIFIED'}}, {respondentEmail: actor.email}, profiles);
  const area = evaluationGet_('managementAreas', manifest.managerAreaId, tx);
  const assignment = evaluationGet_('evaluationAssignments', manifest.managerAreaId, tx);
  const manager = assignment && evaluationGet_('users', assignment.uid, tx);
  if (!formsEvaluationAdmin_(actor) || actor.id !== manifest.actorUid || actor.uid !== manifest.actorUid || !actorIdentity || actorIdentity.uid !== manifest.actorUid || identity.status !== 'CONFIRMED' ||
      !area || area.active !== true || !assignment || assignment.id !== manifest.managerAreaId || assignment.areaId !== manifest.managerAreaId ||
      !Number.isInteger(assignment.version) || assignment.version < 1 || !formsEvaluationActive_(manager) || manager.uid !== assignment.uid || manager.id !== assignment.uid ||
      formsEvaluationResolveIdentity_({settings: {emailCollectionType: 'VERIFIED'}}, {respondentEmail: manager.email}, profiles).uid !== assignment.uid) trainingReleaseReject_('ADMIN_AREA_ASSIGNMENT');
  return {assignment: assignment};
}

/** Confirm all ancestor paths. A source in two official roots or an unreadable path is not classified. */
function trainingReleaseSource_(item) {
  const source = DriveApp.getFileById(item.sourceId);
  if (source.isTrashed()) trainingReleaseReject_('SOURCE_UNAVAILABLE');
  const mime = source.getMimeType(), kind = SAHMT_V2_TRAINING_RELEASE.roots[item.rootId].kind;
  if (mime === 'application/vnd.google-apps.shortcut' || mime === 'application/vnd.google-apps.folder' ||
      (kind === 'ROP' && mime !== 'application/vnd.google-apps.form') || (kind === 'DOCUMENT' && mime === 'application/vnd.google-apps.form')) trainingReleaseReject_('SOURCE_TYPE');
  function classify(file, fileId, expectedRoot) {
    const found = new Set(), visited = new Set();
    function walk(current, path) {
      const parents = current.getParents();
      while (parents.hasNext()) {
        const folder = parents.next(), id = folder.getId();
        if (path.includes(id) || visited.size >= 100) trainingReleaseReject_('SOURCE_ANCESTRY');
        if (SAHMT_V2_TRAINING_RELEASE.roots[id] || id === SAHMT_V2_TRAINING_RELEASE.originalRopRootId) found.add(id);
        if (!visited.has(id)) { visited.add(id); walk(folder, path.concat(id)); }
      }
    }
    walk(file, [fileId]);
    if (found.size !== 1 || !found.has(expectedRoot)) trainingReleaseReject_('SOURCE_AMBIGUOUS');
  }
  classify(source, item.sourceId, kind === 'ROP' ? SAHMT_V2_TRAINING_RELEASE.originalRopRootId : item.rootId);
  if (kind === 'ROP') {
    const clone = DriveApp.getFileById(item.formId);
    if (clone.isTrashed() || clone.getMimeType() !== 'application/vnd.google-apps.form') trainingReleaseReject_('SOURCE_TYPE');
    classify(clone, item.formId, item.rootId);
  }
  return true;
}

/** Material access inspection is read-only. No permission, inheritance, or folder mutation is performed. */
function trainingReleaseMaterialCatalog_(loaded) {
  const entries = {}, forms = new Set(loaded.manifest.items.map(function (item) { return item.formId; }));
  loaded.manifest.items.forEach(function (item) {
    item.materialUrls.forEach(function (url) {
      const match = url.match(/^https:\/\/(?:drive|docs)\.google\.com\/(?:file|document)\/d\/([A-Za-z0-9_-]{10,200})(?:\/(?:view|edit))?\/?(?:[?#].*)?$/);
      if (!match || forms.has(match[1]) || match[1] === loaded.id) trainingReleaseReject_('MATERIAL_REFERENCE');
      const id = match[1], previous = entries[id];
      if (previous && previous.group !== item.eligibleGroup) trainingReleaseReject_('MATERIAL_GROUP_CONFLICT');
      entries[id] = {id: id, group: item.eligibleGroup, rop: Boolean(previous && previous.rop || item.rootId === SAHMT_V2_TRAINING_RELEASE.cloneRootId)};
    });
  });
  const result = Object.keys(entries).sort().map(function (id) { return entries[id]; });
  if (result.length !== 84 || result.filter(function (entry) { return entry.group === 'GENERAL'; }).length !== 70 ||
      result.filter(function (entry) { return entry.group === 'RESTRICTED'; }).length !== 14) trainingReleaseReject_('MATERIAL_COUNTS');
  return result;
}
function trainingReleaseMaterialAudience_(loaded) {
  trainingReleaseContext_(loaded,null);
  const writer = evaluationGet_('users',loaded.manifest.actorUid), email = String(writer && writer.email || '').trim().toLowerCase(), groups = {};
  const roster = formsEvaluationAll_('documentAccessEmails',[],null);
  ['GENERAL','RESTRICTED'].forEach(function (group) {
    groups[group] = [...new Set(formsEvaluationFilterGroupRoster_(roster,[group]).map(function (entry) { return entry.email; }))].sort();
    if (!groups[group].length || groups[group].length > 500) trainingReleaseReject_('MATERIAL_EMPTY_AUDIENCE');
  });
  return {owner: loaded.operator,writer: email,groups: groups,digest: formsEvaluationHash_({owner: loaded.operator,writer: email,groups: groups})};
}
function trainingReleaseMaterialPermissions_(fileId) {
  const permissions = [], tokens = new Set();let token = '', pages = 0;
  do {
    const page = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '/permissions?supportsAllDrives=true&pageSize=100&fields=' + encodeURIComponent('nextPageToken,permissions(id,type,role,emailAddress,view,deleted,pendingOwner,expirationTime,inheritedPermissionsDisabled,permissionDetails(inherited,inheritedFrom))') +
      (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    if (!page || !Array.isArray(page.permissions) || ++pages > 10 || permissions.length + page.permissions.length > 1000) trainingReleaseReject_('MATERIAL_ACL_INCOMPLETE');
    permissions.push.apply(permissions,page.permissions);token = String(page.nextPageToken || '');
    if (token && tokens.has(token)) trainingReleaseReject_('MATERIAL_ACL_INCOMPLETE');
    if (token) tokens.add(token);
  } while (token);
  return permissions;
}
function trainingReleaseMaterialMetadata_(entry,audience) {
  const file = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(entry.id) +
    '?supportsAllDrives=true&fields=' + encodeURIComponent('id,name,mimeType,trashed,parents,owners(emailAddress,permissionId),capabilities(canShare)'));
  const allowed = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','audio/mpeg','video/mp4'];
  if (!file || file.id !== entry.id || file.trashed === true || !allowed.includes(file.mimeType) ||
      /gabarito|answer[_ -]?key|checkpoint|manifest|operational-report|support-access/i.test(String(file.name || '')) ||
      !Array.isArray(file.owners) || file.owners.length !== 1 || String(file.owners[0].emailAddress || '').trim().toLowerCase() !== audience.owner ||
      !formsEvaluationId_(file.owners[0].permissionId)) trainingReleaseReject_('MATERIAL_OWNER_TYPE');
  if (entry.rop) {
    const pending = (file.parents || []).slice(), seen = new Set();let inClone = false;
    while (pending.length) {
      const id = pending.shift();
      if (id === SAHMT_V2_TRAINING_RELEASE.originalRopRootId || seen.size >= 100) trainingReleaseReject_('MATERIAL_ORIGINAL_PROTECTED');
      if (id === SAHMT_V2_TRAINING_RELEASE.cloneRootId) { inClone = true;continue; }
      if (seen.has(id)) continue;seen.add(id);
      const parent = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=' + encodeURIComponent('id,parents'));
      if (!parent || parent.id !== id) trainingReleaseReject_('MATERIAL_ANCESTRY');
      pending.push.apply(pending,parent.parents || []);
    }
    if (!inClone) trainingReleaseReject_('MATERIAL_OUTSIDE_CLONE');
  }
  return file;
}
function trainingReleaseMaterialExact_(entry,file,permissions,audience) {
  const expected = {}, seen = new Set();
  expected[audience.owner] = 'owner';
  audience.groups[entry.group].forEach(function (email) { if (email !== audience.owner) expected[email] = 'reader'; });
  if (audience.writer !== audience.owner) expected[audience.writer] = 'writer';
  for (let index = 0; index < permissions.length; index++) {
    const permission = permissions[index], email = String(permission.emailAddress || '').trim().toLowerCase();
    if (permission.type !== 'user' || !formsEvaluationId_(permission.id) || permission.deleted === true || permission.pendingOwner === true ||
        permission.expirationTime || permission.view || permission.role !== expected[email] || seen.has(email)) return false;
    if (permission.role === 'owner') { if (permission.id !== file.owners[0].permissionId) return false; }
    else if ((permission.permissionDetails || []).some(function (detail) { return detail.inherited === true; })) return false;
    seen.add(email);
  }
  return seen.size === Object.keys(expected).length;
}
function trainingReleaseCloneAccess_(loaded) {
  const id = SAHMT_V2_TRAINING_RELEASE.cloneRootId;
  const file = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=' +
    encodeURIComponent('id,mimeType,trashed,parents,owners(emailAddress,permissionId),inheritedPermissionsDisabled'));
  if (!file || file.id !== id || file.mimeType !== 'application/vnd.google-apps.folder' || file.trashed === true || file.inheritedPermissionsDisabled !== true ||
      !Array.isArray(file.parents) || file.parents.length !== 1 || file.parents[0] !== SAHMT_V2_TRAINING_RELEASE.outsideCloneParentId ||
      !Array.isArray(file.owners) || file.owners.length !== 1 || String(file.owners[0].emailAddress || '').trim().toLowerCase() !== loaded.operator ||
      !formsEvaluationId_(file.owners[0].permissionId)) trainingReleaseReject_('CLONE_ACCESS_PENDING');
  let owner = 0;
  trainingReleaseMaterialPermissions_(id).forEach(function (permission) {
    if (permission.type === 'user' && permission.role === 'owner' && permission.id === file.owners[0].permissionId && String(permission.emailAddress || '').trim().toLowerCase() === loaded.operator && permission.deleted !== true && permission.pendingOwner !== true) { owner++;return; }
    if (permission.view !== 'metadata' || permission.role !== 'reader' || permission.inheritedPermissionsDisabled !== true || permission.deleted === true || permission.pendingOwner === true ||
        !(permission.permissionDetails || []).length || !(permission.permissionDetails || []).every(function (detail) { return detail.inherited === true; })) trainingReleaseReject_('CLONE_FOLDER_READERS');
  });
  if (owner !== 1) trainingReleaseReject_('CLONE_ACCESS_PENDING');
  return true;
}
function trainingReleaseMaterialVerify_(loaded,item) {
  const audience = trainingReleaseMaterialAudience_(loaded), catalog = trainingReleaseMaterialCatalog_(loaded);
  const selected = new Set(item.materialUrls.map(function (url) { return url.match(/\/d\/([A-Za-z0-9_-]+)/)[1]; }));
  if (item.rootId === SAHMT_V2_TRAINING_RELEASE.cloneRootId) trainingReleaseCloneAccess_(loaded);
  catalog.filter(function (entry) { return selected.has(entry.id); }).forEach(function (entry) {
    const file = trainingReleaseMaterialMetadata_(entry,audience);
    if (!trainingReleaseMaterialExact_(entry,file,trainingReleaseMaterialPermissions_(entry.id),audience)) trainingReleaseReject_('MATERIAL_ACCESS_PENDING');
  });
  return {audienceDigest: audience.digest,verifiedMaterials: selected.size};
}
function consultarAcessoMateriaisTreinamentosSahmtV2() {
  const started = Date.now();
  try {
    const loaded = trainingReleaseLoad_(), audience = trainingReleaseMaterialAudience_(loaded), catalog = trainingReleaseMaterialCatalog_(loaded);
    let prepared = 0, inspected = 0, cloneReady = false;
    const pendingItems = [];
    try { cloneReady = trainingReleaseCloneAccess_(loaded); } catch (error) { pendingItems.push({pendingCode: error.trainingReleaseCode || 'CLONE_ACCESS_PENDING'}); }
    for (let index = 0; index < catalog.length && Date.now() - started < SAHMT_V2_TRAINING_RELEASE.budgetMs; index++) {
      const entry = catalog[index];inspected++;
      try {
        const file = trainingReleaseMaterialMetadata_(entry,audience);
        if ((!entry.rop || cloneReady) && trainingReleaseMaterialExact_(entry,file,trainingReleaseMaterialPermissions_(entry.id),audience)) prepared++;
        else if (pendingItems.length < 5) pendingItems.push({materialId: entry.id,pendingCode: 'MATERIAL_ACCESS_PENDING'});
      } catch (error) { if (pendingItems.length < 5) pendingItems.push({materialId: entry.id,pendingCode: error.trainingReleaseCode || 'MATERIAL_ACCESS'}); }
    }
    return trainingReleaseLog_({status: prepared === 84 ? 'READ_ONLY' : 'CONFIGURATION_PENDING',materialFiles: 84,materialPrepared: prepared,materialPending: 84 - prepared,
      inspectedMaterials: inspected,liveMaterialsRevalidated: inspected === 84,pendingItems: pendingItems,productionFinancialWrites: false});
  } catch (error) { return trainingReleaseLog_({status: 'CONFIGURATION_PENDING',pendingCode: error.trainingReleaseCode || 'MATERIAL_ACCESS',materialFiles: 84,materialPrepared: 0,materialPending: 84,productionFinancialWrites: false}); }
}

/** Human approval: 70 GENERAL /14 RESTRICTED materials, approved administrator writer, no notifications; original and external parent remain untouched. */
function trainingReleaseMaterialQueue_(entry,file,permissions,audience) {
  const expected = {}, actual = {}, operations = [];
  audience.groups[entry.group].forEach(function (email) { if (email !== audience.owner) expected[email] = email === audience.writer ? 'writer' : 'reader'; });
  if (audience.writer !== audience.owner) expected[audience.writer] = 'writer';
  let owners = 0;
  permissions.forEach(function (permission) {
    const email = String(permission.emailAddress || '').trim().toLowerCase(), inherited = (permission.permissionDetails || []).some(function (detail) { return detail.inherited === true; });
    if (permission.type === 'user' && permission.role === 'owner' && email === audience.owner && permission.id === file.owners[0].permissionId && permission.deleted !== true && permission.pendingOwner !== true) { owners++;return; }
    if (!formsEvaluationId_(permission.id) || permission.deleted === true || permission.pendingOwner === true || permission.view || inherited || !['reader','writer'].includes(permission.role)) trainingReleaseReject_('MATERIAL_ACL_UNSAFE');
    const base = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(entry.id) + '/permissions/';
    if (permission.type !== 'user' || !expected[email] || permission.expirationTime) {
      if (permission.role !== 'reader' || !['user','anyone','domain','group'].includes(permission.type)) trainingReleaseReject_('MATERIAL_EDITOR_UNKNOWN');
      operations.push({fileId: entry.id,url: base + encodeURIComponent(permission.id) + '?supportsAllDrives=true',options: {method: 'delete'}});return;
    }
    if (actual[email]) trainingReleaseReject_('MATERIAL_ACL_DUPLICATE');actual[email] = true;
    if (permission.role !== expected[email]) {
      if (permission.role === 'writer' && expected[email] !== 'writer') trainingReleaseReject_('MATERIAL_EDITOR_UNKNOWN');
      operations.push({fileId: entry.id,url: base + encodeURIComponent(permission.id) + '?supportsAllDrives=true',options: {method: 'patch',contentType: 'application/json',payload: JSON.stringify({role: expected[email]})}});
    }
  });
  if (owners !== 1) trainingReleaseReject_('MATERIAL_OWNER_ACL');
  Object.keys(expected).sort().forEach(function (email) {
    if (!actual[email]) operations.push({fileId: entry.id,url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(entry.id) + '/permissions?supportsAllDrives=true&sendNotificationEmail=false',
      options: {method: 'post',contentType: 'application/json',payload: JSON.stringify({type: 'user',role: expected[email],emailAddress: email})}});
  });
  return operations;
}
/** Parallel requests always address distinct files. A subsequent wave waits for every preceding response. */
function trainingReleaseMaterialWave_(operations) {
  if (!operations.length || operations.length > 84 || new Set(operations.map(function (operation) { return operation.fileId; })).size !== operations.length) trainingReleaseReject_('MATERIAL_WAVE_INVALID');
  const token = ScriptApp.getOAuthToken();
  const requests = operations.map(function (operation) { return Object.assign({url: operation.url,muteHttpExceptions: true,headers: {Authorization: 'Bearer ' + token}},operation.options); });
  let responses;
  try { responses = UrlFetchApp.fetchAll(requests); } catch (_) { trainingReleaseReject_('MATERIAL_BATCH_ACCESS'); }
  if (!Array.isArray(responses) || responses.length !== operations.length) trainingReleaseReject_('MATERIAL_BATCH_ACCESS');
  return responses.map(function (response) { const status = response.getResponseCode();return {success: status >= 200 && status < 300,pendingCode: status >= 200 && status < 300 ? '' : 'MATERIAL_HTTP_' + status}; });
}
function trainingReleaseLimitClone_(loaded) {
  const id = SAHMT_V2_TRAINING_RELEASE.cloneRootId;
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=' +
    encodeURIComponent('id,mimeType,trashed,parents,owners(emailAddress,permissionId),capabilities(canDisableInheritedPermissions),inheritedPermissionsDisabled');
  const file = formsEvaluationGoogleRequest_(url);
  if (!file || file.id !== id || file.mimeType !== 'application/vnd.google-apps.folder' || file.trashed === true ||
      !Array.isArray(file.parents) || file.parents.length !== 1 || file.parents[0] !== SAHMT_V2_TRAINING_RELEASE.outsideCloneParentId ||
      !Array.isArray(file.owners) || file.owners.length !== 1 || String(file.owners[0].emailAddress || '').trim().toLowerCase() !== loaded.operator ||
      !formsEvaluationId_(file.owners[0].permissionId)) trainingReleaseReject_('CLONE_LIMIT_OWNER');
  if (file.inheritedPermissionsDisabled !== true) {
    if (!file.capabilities || file.capabilities.canDisableInheritedPermissions !== true) trainingReleaseReject_('CLONE_LIMIT_UNAVAILABLE');
    formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=id,inheritedPermissionsDisabled',
      {method: 'patch',contentType: 'application/json',payload: JSON.stringify({inheritedPermissionsDisabled: true})});
  }
  // Readback checks the limited folder and rejects any direct content grant. No folder reader is ever added.
  return trainingReleaseCloneAccess_(loaded);
}
function trainingReleaseMaterialBatch_(loaded,job) {
  const properties = PropertiesService.getScriptProperties(), started = Date.now(), audience = trainingReleaseMaterialAudience_(loaded), catalog = trainingReleaseMaterialCatalog_(loaded);
  if (job.materialAudienceDigest && job.materialAudienceDigest !== audience.digest) {
    job.materialMask = '0'.repeat(84);job.materialCursor = 0;job.phase = 'CLOSE_FORMS';job.closeCursor = 0;job.closeMask = '0'.repeat(76);job.verifiedMask = '0'.repeat(76);
  }
  job.materialAudienceDigest = audience.digest;
  if (job.phase === 'CLOSE_FORMS') {
    let attempted = 0;const pendingItems = [];
    while (attempted < 76 && Date.now() - started < SAHMT_V2_TRAINING_RELEASE.budgetMs) {
      const cursor = job.closeCursor,item = loaded.manifest.items[cursor],closed = trainingReleaseFailClosed_(item);
      job.closeMask = job.closeMask.slice(0,cursor) + (closed ? '1' : '0') + job.closeMask.slice(cursor + 1);
      if (!closed) pendingItems.push({formId: item.formId,pendingCode: 'FORM_CLOSURE_UNCONFIRMED'});
      job.closeCursor = (cursor + 1) % 76;attempted++;
      properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty,JSON.stringify(job));
      if (!job.closeCursor) break;
    }
    if (job.closeMask === '1'.repeat(76)) job.phase = 'MATERIALS';
    return {status: 'RUNNING',attemptedForms: attempted,pendingItems: pendingItems,materialFiles: 84,materialPrepared: 0,materialPending: 84};
  }
  trainingReleaseLimitClone_(loaded);
  const states = [],pendingItems = [],start = job.materialCursor;
  // Reserve time for mutations and fresh readback; a slow read phase must not starve the same trailing files forever.
  for (let offset = 0;start + offset < catalog.length && Date.now() - started < SAHMT_V2_TRAINING_RELEASE.budgetMs / 2;offset++) {
    const index = start + offset,entry = catalog[index];
    if (job.materialMask[index] === '1') continue; // Progress only: publication separately revalidates the live ACL for every Form.
    try {
      const file = trainingReleaseMaterialMetadata_(entry,audience),permissions = trainingReleaseMaterialPermissions_(entry.id);
      if (!file.capabilities || file.capabilities.canShare !== true) trainingReleaseReject_('MATERIAL_SHARE_UNAVAILABLE');
      states.push({index: index,entry: entry,operations: trainingReleaseMaterialQueue_(entry,file,permissions,audience),failed: false});
    } catch (error) { states.push({index: index,entry: entry,operations: [],failed: true});pendingItems.push({materialId: entry.id,pendingCode: error.trainingReleaseCode || 'MATERIAL_ACCESS'}); }
  }
  while (Date.now() - started < SAHMT_V2_TRAINING_RELEASE.budgetMs) {
    const active = states.filter(function (state) { return !state.failed && state.operations.length; });
    if (!active.length) break;let results;
    try { results = trainingReleaseMaterialWave_(active.map(function (state) { return state.operations[0]; })); }
    catch (error) { active.forEach(function (state) { state.failed = true;pendingItems.push({materialId: state.entry.id,pendingCode: error.trainingReleaseCode || 'MATERIAL_ACCESS'}); });break; }
    results.forEach(function (result,index) {
      if (result.success) active[index].operations.shift();
      else { active[index].failed = true;pendingItems.push({materialId: active[index].entry.id,pendingCode: result.pendingCode}); }
    });
    // On interruption the next run reads the ACL again; a successful grant is never replayed blindly.
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty,JSON.stringify(job));
  }
  const currentAudience = trainingReleaseMaterialAudience_(loaded);
  states.forEach(function (state) {
    let ready = false;
    if (Date.now() - started < SAHMT_V2_TRAINING_RELEASE.budgetMs && currentAudience.digest === audience.digest && !state.failed && !state.operations.length) {
      try { const file = trainingReleaseMaterialMetadata_(state.entry,audience);ready = trainingReleaseMaterialExact_(state.entry,file,trainingReleaseMaterialPermissions_(state.entry.id),audience); }
      catch (error) { pendingItems.push({materialId: state.entry.id,pendingCode: error.trainingReleaseCode || 'MATERIAL_READBACK'}); }
    }
    job.materialMask = job.materialMask.slice(0,state.index) + (ready ? '1' : '0') + job.materialMask.slice(state.index + 1);
  });
  const pendingState = states.find(function (state) { return job.materialMask[state.index] !== '1'; });
  job.materialCursor = pendingState ? pendingState.index : states.length ? (states[states.length - 1].index + 1) % 84 : (start + 1) % 84;
  const readyCount = job.materialMask.split('').filter(function (value) { return value === '1'; }).length;
  if (readyCount === 84 && currentAudience.digest === audience.digest) job.phase = 'FORMS';
  properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty,JSON.stringify(job));
  return {status: 'RUNNING',pendingItems: pendingItems.slice(0,5),materialFiles: 84,materialPrepared: readyCount,materialPending: 84 - readyCount,attemptedMaterials: states.length};
}

function trainingReleasePayload_(item, expectedVersion) {
  const today = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  const validFrom = today > item.validFrom ? today : item.validFrom;
  if (validFrom > item.validUntil) trainingReleaseReject_('RELEASE_VALIDITY_EXPIRED');
  return {activityId: item.formId, creditScopeId: item.creditScopeId, version: item.version, expectedVersion: expectedVersion,
    eligibleUids: [], eligibleGroups: [item.eligibleGroup], managerAreaId: SAHMT_V2_TRAINING_RELEASE.areaId,
    modalities: {acknowledgement: true, suggestion: true, test: true}, acknowledgementValue: 'SIM',
    acknowledgementItemId: item.acknowledgementItemId, suggestionProblemItemId: item.suggestionProblemItemId,
    suggestionProposalItemId: item.suggestionProposalItemId, suggestionBenefitItemId: item.suggestionBenefitItemId,
    materialUrls: item.materialUrls, validFrom: validFrom, validUntil: item.validUntil};
}
function trainingReleaseLive_(item, requireClosed) {
  trainingReleaseSource_(item);
  const protectedIds = String(PropertiesService.getScriptProperties().getProperty('SAHMT_V2_EVALUATION_PROTECTED_FORM_IDS') || '').split(/[\s,;]+/).filter(Boolean);
  if (protectedIds.includes(item.formId)) trainingReleaseReject_('PROTECTED_FORM');
  const form = FormApp.openById(item.formId), metadata = formsEvaluationMetadata_(item.formId);
  if (form.getId() !== item.formId || metadata.formId !== item.formId || !metadata.info || metadata.info.title !== item.title ||
      !form.hasLimitOneResponsePerUser() || form.canEditResponse() || typeof form.supportsAdvancedResponderPermissions !== 'function' ||
      !form.supportsAdvancedResponderPermissions() || typeof form.isPublished !== 'function') trainingReleaseReject_('FORM_IDENTITY_OPTIONS');
  if (requireClosed && (form.isAcceptingResponses() !== false || form.isPublished() !== false)) trainingReleaseReject_('CLOSED_BASELINE_REQUIRED');
  if (SAHMT_V2_TRAINING_RELEASE.roots[item.rootId].kind === 'DOCUMENT') {
    if (typeof trainingDocumentsHash_ !== 'function' || typeof trainingDocumentsVerifyItems_ !== 'function') trainingReleaseReject_('DOCUMENT_VERIFIER_REQUIRED');
    if (trainingDocumentsHash_(item.expectedItems) !== item.expectedItemsHash) trainingReleaseReject_('DOCUMENT_ITEMS_DIGEST');
    if (trainingDocumentsVerifyItems_(metadata, item.expectedItems, item.knownIds) === false) trainingReleaseReject_('DOCUMENT_ITEMS_CHANGED');
  } else {
    if (typeof ropsSecondSemesterComparable_ !== 'function') trainingReleaseReject_('ROP_VERIFIER_REQUIRED');
    if (formsEvaluationHash_(ropsSecondSemesterComparable_(metadata, false)) !== item.preparedOriginalDigest) trainingReleaseReject_('ROP_ORIGINAL_DIGEST');
  }
  const checked = formsEvaluationConfiguration_(metadata, trainingReleasePayload_(item, 0));
  const specs = formsEvaluationTemplateSpecs_(), matches = formsEvaluationTemplateMatches_(metadata, specs);
  if (specs.some(function (spec) { return !matches[spec.marker]; }) || !checked.mapping.review || checked.maxTestScore !== item.maxTestScore ||
      item.preparedQuestionFingerprint && item.preparedQuestionFingerprint !== checked.questionFingerprint) trainingReleaseReject_('FORM_MAPPING_SCORE');
  const scored = (metadata.items || []).filter(function (entry) { return Number(entry.questionItem && entry.questionItem.question.grading && entry.questionItem.question.grading.pointValue || 0) > 0; });
  if (SAHMT_V2_TRAINING_RELEASE.roots[item.rootId].kind === 'DOCUMENT' && scored.length !== 10) trainingReleaseReject_('FORM_QUESTION_COUNT');
  const materialSnapshot = formsEvaluationMaterialSnapshot_(item.materialUrls);
  if (materialSnapshot.some(function (entry) { return !formsEvaluationMaterialSnapshotVerified_(entry); })) trainingReleaseReject_('MATERIAL_BASELINE_UNVERIFIED');
  const materialFingerprint = formsEvaluationMaterialFingerprint_(materialSnapshot);
  const digest = formsEvaluationHash_({formId: item.formId, questionFingerprint: checked.questionFingerprint, maxTestScore: checked.maxTestScore, mapping: checked.mapping, materialUrls: item.materialUrls, materialFingerprint: materialFingerprint});
  return {form: form, checked: checked, digest: digest, materialFingerprint: materialFingerprint};
}
function trainingReleaseIdentity_(item, activity, cfg, tx) {
  [activity, cfg].filter(Boolean).forEach(function (record) {
    if (record.formId && record.formId !== item.formId || record.creditScopeId && record.creditScopeId !== item.creditScopeId ||
        record.version !== undefined && record.version !== 0 && record.version !== item.version ||
        Array.isArray(record.eligibleUids) && record.eligibleUids.length ||
        Array.isArray(record.eligibleGroups) && record.eligibleGroups.length && formsEvaluationStable_(record.eligibleGroups) !== formsEvaluationStable_([item.eligibleGroup])) trainingReleaseReject_('EXISTING_IDENTITY_CONFLICT');
  });
  const peers = formsEvaluationAll_('evaluationFormConfigs', [firestoreFilter_('creditScopeId', 'EQUAL', {stringValue: item.creditScopeId})], tx);
  if (peers.some(function (record) { return record.version !== item.version; })) trainingReleaseReject_('EXISTING_SCOPE_CONFLICT');
}
function trainingReleasePrepared_(loaded, item) {
  // The transaction below revalidates authorization after these read-only inspections.
  const current = evaluationGet_('evaluationActivities', item.formId), cfg = evaluationGet_('evaluationFormConfigs', item.formId);
  const already = current && current.trainingReleaseManifestDigest === loaded.digest && current.trainingReleaseClosedBaseline === true;
  const live = trainingReleaseLive_(item, !already || !cfg || cfg.status !== 'READY');
  return evaluationRunTransaction_(function (tx) {
    const context = trainingReleaseContext_(loaded, tx), activity = evaluationGet_('evaluationActivities', item.formId, tx), config = evaluationGet_('evaluationFormConfigs', item.formId, tx);
    trainingReleaseIdentity_(item, activity, config, tx);
    if (activity && activity.trainingReleaseManifestDigest && activity.trainingReleaseManifestDigest !== loaded.digest) trainingReleaseReject_('PREPARED_MANIFEST_CONFLICT');
    if (activity && activity.trainingReleaseClosedBaseline === true && activity.trainingReleaseDigest !== live.digest) trainingReleaseReject_('PREPARED_FORM_CHANGED');
    if (already && activity && activity.trainingReleaseDigest === live.digest && activity.active === true &&
        activity.areaIds && activity.areaIds.includes(loaded.manifest.managerAreaId) && activity.managerUid === context.assignment.uid &&
        activity.assignmentVersion === context.assignment.version) return {writes: [], result: {status: activity.status, prepared: true, unchanged: true}};
    const changes = {formId: item.formId, title: item.title, sourceId: item.sourceId, rootId: item.rootId, active: true,
      areaIds: [...new Set((activity && activity.areaIds || []).concat([loaded.manifest.managerAreaId]))],
      status: 'CONFIGURATION_PENDING', reason: 'Metadados conferidos; publicação e respondentes ainda pendentes.',
      creditScopeId: item.creditScopeId, version: item.version, configVersion: config ? config.configVersion : 0,
      eligibleUids: [], eligibleGroups: [item.eligibleGroup], managerAreaId: loaded.manifest.managerAreaId,
      managerUid: context.assignment.uid, assignmentId: context.assignment.id, assignmentVersion: context.assignment.version,
      modalities: {acknowledgement: true, suggestion: true, test: true}, maxTestScore: item.maxTestScore,
      materialUrls: item.materialUrls, validFrom: new Date(item.validFrom + 'T00:00:00-03:00'), validUntil: new Date(item.validUntil + 'T23:59:59.999-03:00'),
      acknowledgementItemId: item.acknowledgementItemId, acknowledgementValue: 'SIM', suggestionProblemItemId: item.suggestionProblemItemId,
      suggestionProposalItemId: item.suggestionProposalItemId, suggestionBenefitItemId: item.suggestionBenefitItemId,
      trainingReleaseManifestDigest: loaded.digest, trainingReleaseDigest: live.digest, trainingReleaseMaterialFingerprint: live.materialFingerprint,
      trainingReleaseClosedBaseline: true, productionFinancialWrites: false};
    return {writes: [evaluationWrite_('evaluationActivities', item.formId, changes, activity, ['updatedAt'])], result: {status: 'CONFIGURATION_PENDING', prepared: true}};
  });
}

/** Pure publication gate also used by generic Forms reconciliation; no writes or Form mutations. */
function trainingReleaseVerifyPublication_(formId) {
  const loaded = trainingReleaseLoad_();
  // The mandatory material gate validates current authorization before returning a publication proof.
  const job = trainingReleaseSaved_(SAHMT_V2_TRAINING_RELEASE.jobProperty);
  if (job && job.status === 'RUNNING' && (job.schemaVersion !== 2 || job.phase !== 'FORMS' || job.materialMask !== '1'.repeat(84))) trainingReleaseReject_('MATERIAL_PHASE_PENDING');
  const item = loaded.manifest.items.find(function (entry) { return entry.formId === formId; });
  if (!item) trainingReleaseReject_('FORM_NOT_IN_MANIFEST');
  const live = trainingReleaseLive_(item, false), activity = evaluationGet_('evaluationActivities', formId), cfg = evaluationGet_('evaluationFormConfigs', formId);
  if (!activity || activity.trainingReleaseManifestDigest !== loaded.digest || activity.trainingReleaseClosedBaseline !== true ||
      activity.trainingReleaseDigest !== live.digest || activity.trainingReleaseMaterialFingerprint !== live.materialFingerprint ||
      !cfg || cfg.creditScopeId !== item.creditScopeId || cfg.version !== item.version || cfg.maxTestScore !== item.maxTestScore ||
      cfg.materialFingerprint !== live.materialFingerprint || cfg.configuredByUid !== loaded.manifest.actorUid ||
      formsEvaluationSavedQuestionFingerprint_(cfg) !== live.checked.questionFingerprint || formsEvaluationStable_(cfg.mapping) !== formsEvaluationStable_(live.checked.mapping) ||
      formsEvaluationStable_(cfg.materialUrls) !== formsEvaluationStable_(item.materialUrls) || !Array.isArray(cfg.eligibleUids) || cfg.eligibleUids.length ||
      formsEvaluationStable_(cfg.eligibleGroups) !== formsEvaluationStable_([item.eligibleGroup])) trainingReleaseReject_('PREPARED_PUBLICATION_CHANGED');
  const access = trainingReleaseMaterialVerify_(loaded,item);
  return {formId: formId, manifestDigest: loaded.digest, formDigest: live.digest,materialAudienceDigest: access.audienceDigest,verifiedMaterials: access.verifiedMaterials};
}

/** All Google Form publication goes through the existing closed-stage/ACL/CAS finalizer, outside callbacks. */
function trainingReleaseFinalize_(loaded, item, requestId) {
  // The mandatory publication gate and transaction revalidate authorization before any write or ACL change.
  const before = trainingReleaseLive_(item, false), activity = evaluationGet_('evaluationActivities', item.formId);
  if (!activity || activity.trainingReleaseManifestDigest !== loaded.digest || !activity.trainingReleaseClosedBaseline || activity.trainingReleaseDigest !== before.digest) trainingReleaseReject_('PREPARED_BASELINE_REQUIRED');
  const proof = trainingReleaseVerifyPublication_(item.formId);
  evaluationRunTransaction_(function (tx) {
    trainingReleaseContext_(loaded, tx);
    const current = evaluationGet_('evaluationActivities', item.formId, tx), cfg = evaluationGet_('evaluationFormConfigs', item.formId, tx);
    if (!current || !cfg || current.active !== true || current.trainingReleaseManifestDigest !== proof.manifestDigest || current.trainingReleaseDigest !== proof.formDigest ||
        cfg.creditScopeId !== item.creditScopeId || cfg.version !== item.version || cfg.materialFingerprint !== before.materialFingerprint ||
        formsEvaluationSavedQuestionFingerprint_(cfg) !== before.checked.questionFingerprint || formsEvaluationStable_(cfg.mapping) !== formsEvaluationStable_(before.checked.mapping) ||
        formsEvaluationStable_(cfg.eligibleGroups) !== formsEvaluationStable_([item.eligibleGroup]) || !Array.isArray(cfg.eligibleUids) || cfg.eligibleUids.length) trainingReleaseReject_('PUBLICATION_CAS_CONFLICT');
    if (cfg.trainingReleaseBlocked !== true && current.trainingReleaseBlocked !== true) return {writes: [], result: {status: cfg.status}};
    const changes = {trainingReleaseBlocked: false, status: 'CONFIGURATION_PENDING', publicationPending: true, reason: 'Catálogo integralmente revalidado antes da publicação.'};
    return {writes: [evaluationWrite_('evaluationFormConfigs', item.formId, changes, cfg, ['updatedAt']),evaluationWrite_('evaluationActivities', item.formId, changes, current, ['updatedAt'])], result: {status: 'CONFIGURATION_PENDING'}};
  });
  const result = formsEvaluationFinalizePublication_(item.formId, requestId);
  if (result.status !== 'READY') return result;
  // Re-read content after ACL publication; concurrent content edits must close and remain pending.
  const after = trainingReleaseLive_(item, false), cfg = evaluationGet_('evaluationFormConfigs', item.formId);
  if (after.digest !== before.digest || !cfg || cfg.status !== 'READY' || cfg.creditScopeId !== item.creditScopeId || cfg.version !== item.version ||
      cfg.maxTestScore !== item.maxTestScore || formsEvaluationSavedQuestionFingerprint_(cfg) !== after.checked.questionFingerprint ||
      formsEvaluationStable_(cfg.eligibleGroups) !== formsEvaluationStable_([item.eligibleGroup]) || !Array.isArray(cfg.eligibleUids) || cfg.eligibleUids.length ||
      !formsEvaluationPublishedPermissionsExact_(formsEvaluationPublishedPermissions_(item.formId), formsEvaluationPublicationContext_(cfg, null))) trainingReleaseReject_('PUBLISHED_CONFIGURATION_CHANGED');
  trainingReleaseManagement_(loaded,item,cfg);
  return {status: 'READY', published: true, productionFinancialWrites: false};
}

/** The existing Management view reads this public metadata only. Questions and private release evidence remain elsewhere. */
function trainingReleaseManagementFields_(item,cfg) {
  const categories = {
    '1ZVHg-9fcnBv1q8PJgFoUGQ50b5EwAggR': 'DIRETRIZES',
    '1jwZn5MeuvsSoyHROk_dNS-mXL1teVfBc': 'DOCUMENTOS ADMINISTRATIVOS',
    '1gg78vHm0O07B_McXFaMMi_ByGwbbWt-7': 'PROTOCOLOS',
    '1N0lTv1vewXW_bqhBhN2QG8cq75ZzXdR8': 'TREINAMENTO DAS ROPs 2026 - SEGUNDO SEMESTRE'
  };
  if (!cfg || !/^https:\/\/docs\.google\.com\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]{10,200}\/viewform$/.test(cfg.responderUrl || '') ||
      item.title.length > 160 || !categories[item.rootId]) trainingReleaseReject_('MANAGEMENT_METADATA');
  return {id: 'evaluation_' + item.formId,managementAreaId: SAHMT_V2_TRAINING_RELEASE.areaId,title: item.title,
    description: 'Material de apoio, ciência do conteúdo, teste pontuado, sugestões e revisão pelo gestor.',
    driveFileId: item.formId,driveUrl: cfg.responderUrl,category: categories[item.rootId],requiredReading: true,audienceGroup: item.eligibleGroup};
}
function trainingReleaseManagementOwned_(record,fields,actorUid) {
  return record && record.createdByUid === actorUid && record.updatedByUid === actorUid &&
    Number.isInteger(record.version) && record.version >= 1 && record.createdAt && record.publishedAt &&
    Object.keys(fields).every(function (key) { return formsEvaluationStable_(record[key]) === formsEvaluationStable_(fields[key]); });
}
function trainingReleaseManagement_(loaded,item,proofCfg) {
  const fields = trainingReleaseManagementFields_(item,proofCfg);
  return evaluationRunTransaction_(function (tx) {
    trainingReleaseContext_(loaded,tx);
    const cfg = evaluationGet_('evaluationFormConfigs',item.formId,tx),activity = evaluationGet_('evaluationActivities',item.formId,tx),
      previous = evaluationGet_('scopedDocuments',fields.id,tx);
    if (!cfg || !activity || cfg.status !== 'READY' || activity.status !== 'READY' || cfg.configVersion !== proofCfg.configVersion ||
        cfg.responderUrl !== fields.driveUrl || cfg.version !== item.version || cfg.creditScopeId !== item.creditScopeId ||
        cfg.configuredByUid !== loaded.manifest.actorUid || activity.trainingReleaseManifestDigest !== loaded.digest ||
        formsEvaluationStable_(cfg.eligibleGroups) !== formsEvaluationStable_([item.eligibleGroup])) trainingReleaseReject_('MANAGEMENT_PUBLICATION_CHANGED');
    if (previous && !trainingReleaseManagementOwned_(previous,fields,loaded.manifest.actorUid)) trainingReleaseReject_('MANAGEMENT_DOCUMENT_CONFLICT');
    if (previous && previous.active === true) return {writes: [],result: {unchanged: true}};
    const changes = Object.assign({},fields,{active: true,version: previous ? previous.version + 1 : 1,updatedByUid: loaded.manifest.actorUid});
    if (!previous) changes.createdByUid = loaded.manifest.actorUid;
    return {writes: [evaluationWrite_('scopedDocuments',fields.id,changes,previous,previous ? ['updatedAt'] : ['publishedAt','createdAt','updatedAt'])],result: {created: !previous}};
  });
}
/** Used inside the same pending transaction as the Forms projection, including periodic reconciliation. */
function trainingReleaseManagementCloseWrite_(formId,activity,cfg,tx) {
  if (!activity || !cfg || !/^[a-f0-9]{64}$/.test(activity.trainingReleaseManifestDigest || '') || activity.trainingReleaseClosedBaseline !== true ||
      !SAHMT_V2_TRAINING_RELEASE.roots[activity.rootId] || !/^https:\/\/docs\.google\.com\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]{10,200}\/viewform$/.test(cfg.responderUrl || '')) return null;
  const item = {formId: formId,rootId: activity.rootId,title: activity.title,eligibleGroup: SAHMT_V2_TRAINING_RELEASE.roots[activity.rootId].group};
  const fields = trainingReleaseManagementFields_(item,cfg),record = evaluationGet_('scopedDocuments',fields.id,tx);
  if (!record || record.active !== true || !trainingReleaseManagementOwned_(record,fields,cfg.configuredByUid)) return null;
  return evaluationWrite_('scopedDocuments',fields.id,{active: false,version: record.version + 1,updatedByUid: cfg.configuredByUid},record,['updatedAt']);
}
function trainingReleaseReleased_(loaded, item) {
  // Current authorization is checked in the request transaction or mandatory finalizer gate before writes.
  const activity = evaluationGet_('evaluationActivities', item.formId), cfg = evaluationGet_('evaluationFormConfigs', item.formId);
  if (!activity || activity.trainingReleaseManifestDigest !== loaded.digest || activity.trainingReleaseClosedBaseline !== true) trainingReleaseReject_('PREPARED_BASELINE_REQUIRED');
  const live = trainingReleaseLive_(item, !cfg || cfg.status !== 'READY');
  if (activity.trainingReleaseDigest !== live.digest) trainingReleaseReject_('PREPARED_FORM_CHANGED');
  if (cfg) {
    trainingReleaseIdentity_(item, activity, cfg, null);
    const actual = formsEvaluationCheckedMapping_(formsEvaluationMetadata_(item.formId), cfg);
    if (actual.questionFingerprint !== live.checked.questionFingerprint || actual.maxTestScore !== item.maxTestScore || formsEvaluationStable_(actual.mapping) !== formsEvaluationStable_(live.checked.mapping) ||
        formsEvaluationStable_(cfg.materialUrls) !== formsEvaluationStable_(item.materialUrls) || cfg.configuredByUid !== loaded.manifest.actorUid) trainingReleaseReject_('CONFIGURATION_CONFLICT');
    return trainingReleaseFinalize_(loaded, item, null);
  }
  const payload = trainingReleasePayload_(item, 0);
  const requestId = 'training-release-' + formsEvaluationHash_([loaded.digest, item.formId, item.creditScopeId, item.version]);
  evaluationRunTransaction_(function (tx) {
    trainingReleaseContext_(loaded, tx);
    const current = evaluationGet_('evaluationActivities', item.formId, tx), config = evaluationGet_('evaluationFormConfigs', item.formId, tx);
    trainingReleaseIdentity_(item, current, config, tx);
    if (!current || current.trainingReleaseDigest !== live.digest || current.trainingReleaseManifestDigest !== loaded.digest || config) trainingReleaseReject_('CONFIGURATION_CAS_CONFLICT');
    const request = evaluationGet_('evaluationRequests', requestId, tx);
    if (request) {
      if (request.actorUid !== loaded.manifest.actorUid || request.type !== 'CONFIGURE_ACTIVITY' || formsEvaluationStable_(request.payload) !== formsEvaluationStable_(payload)) trainingReleaseReject_('REQUEST_IDENTITY_CONFLICT');
      return {writes: [], result: {status: request.status}};
    }
    return {writes: [evaluationWrite_('evaluationRequests', requestId, {type: 'CONFIGURE_ACTIVITY', actorUid: loaded.manifest.actorUid, payload: payload,
      status: 'PENDING', source: SAHMT_V2_TRAINING_RELEASE.source, productionFinancialWrites: false}, null, ['createdAt'])], result: {status: 'PENDING'}};
  });
  // The dispatcher validates the admin, configuration, live mapping, version and material snapshot itself.
  const dispatched = formsEvaluationProcessRequest_(evaluationGet_('evaluationRequests', requestId), {deferPublication:true});
  if (dispatched.status !== 'READY' && dispatched.status !== 'CONFIGURATION_PENDING') return {status: 'CONFIGURATION_PENDING'};
  return trainingReleaseFinalize_(loaded, item, requestId);
}
function trainingReleaseFailClosed_(item) {
  let closed = false;
  try { closed = formsEvaluationCloseForm_(FormApp.openById(item.formId)); } catch (_) {}
  try {
    const cfg = evaluationGet_('evaluationFormConfigs', item.formId);
    evaluationRunTransaction_(function (tx) {
      const activity = evaluationGet_('evaluationActivities', item.formId, tx);
      const config = cfg && evaluationGet_('evaluationFormConfigs', item.formId, tx);
      const changes = {status: 'CONFIGURATION_PENDING', publicationPending: false, trainingReleaseBlocked: true, reason: closed ? 'Catálogo ou acesso externo pendente de conferência integral.' : 'Fechamento externo não confirmado; reconciliação bloqueada.'};
      const writes = [];
      if (activity) writes.push(evaluationWrite_('evaluationActivities', item.formId, changes, activity, ['updatedAt']));
      if (config) writes.push(evaluationWrite_('evaluationFormConfigs', item.formId, changes, config, ['updatedAt']));
      // Never overwrite manually created or edited Management records when closing a release item.
      const managementWrite = trainingReleaseManagementCloseWrite_(item.formId,activity,config,tx);
      if (managementWrite) writes.push(managementWrite);
      return {writes: writes, result: {status: 'CONFIGURATION_PENDING'}};
    });
  } catch (_) {}
  return closed;
}

function trainingReleaseCounts_(loaded) {
  const counts = {totalForms: 76, preparedForms: 0, publishedForms: 0, pendingForms: 0, managementDocuments: 0, generalForms: 62, restrictedForms: 14, liveFormsRevalidated: false, productionFinancialWrites: false};
  const activities = {}, configs = {}, documents = {};
  formsEvaluationAll_('evaluationActivities').forEach(function (record) { activities[record.id] = record; });
  formsEvaluationAll_('evaluationFormConfigs').forEach(function (record) { configs[record.id] = record; });
  formsEvaluationAll_('scopedDocuments').forEach(function (record) { documents[record.id] = record; });
  loaded.manifest.items.forEach(function (item) {
    const activity = activities[item.formId], cfg = configs[item.formId];
    if (activity && activity.trainingReleaseManifestDigest === loaded.digest && activity.trainingReleaseClosedBaseline === true) counts.preparedForms++;
    if (activity && cfg && activity.active === true && activity.status === 'READY' && cfg.status === 'READY' &&
        activity.trainingReleaseManifestDigest === loaded.digest && activity.configVersion === cfg.configVersion &&
        cfg.version === item.version && cfg.creditScopeId === item.creditScopeId && Array.isArray(cfg.eligibleUids) && !cfg.eligibleUids.length &&
        formsEvaluationStable_(cfg.eligibleGroups) === formsEvaluationStable_([item.eligibleGroup])) {
      counts.publishedForms++;
      const fields = trainingReleaseManagementFields_(item,cfg),record = documents[fields.id];
      if (record && record.active === true && trainingReleaseManagementOwned_(record,fields,loaded.manifest.actorUid)) counts.managementDocuments++;
    }
  });
  counts.pendingForms = counts.totalForms - counts.publishedForms;
  return counts;
}
function trainingReleaseSaved_(property) {
  const value = PropertiesService.getScriptProperties().getProperty(property);
  if (!value) return null;
  try { return JSON.parse(value); } catch (_) { trainingReleaseReject_('CHECKPOINT_INVALID'); }
}
function trainingReleaseLog_(result) {
  const statuses = ['PENDING','READ_ONLY','CONFIGURATION_PENDING','BATCH_COMPLETED','RUNNING','COMPLETED','NOT_STARTED'];
  const safe = {status: statuses.includes(result.status) ? result.status : 'CONFIGURATION_PENDING', productionFinancialWrites: false};
  ['totalForms','preparedForms','publishedForms','pendingForms','managementDocuments','generalForms','restrictedForms','attemptedForms','successfulForms','pendingInBatch','runs','validatedForms','materialFiles','materialPrepared','materialPending','inspectedMaterials'].forEach(function (key) {
    if (Number.isInteger(result[key]) && result[key] >= 0 && result[key] <= 5000) safe[key] = result[key];
  });
  if (typeof result.liveFormsRevalidated === 'boolean') safe.liveFormsRevalidated = result.liveFormsRevalidated;
  if (typeof result.liveMaterialsRevalidated === 'boolean') safe.liveMaterialsRevalidated = result.liveMaterialsRevalidated;
  if (typeof result.resumedOriginalJob === 'boolean') safe.resumedOriginalJob = result.resumedOriginalJob;
  ['checkpointReadOnly','catalogReadAvailable','triggerLookupAvailable','triggerPresent','jobLimitReached'].forEach(function (key) {
    if (typeof result[key] === 'boolean') safe[key] = result[key];
  });
  if (typeof result.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.expiresAt) && Number.isFinite(Date.parse(result.expiresAt))) safe.expiresAt = result.expiresAt;
  if (Number.isInteger(result.catalogHttpStatus) && result.catalogHttpStatus >= 400 && result.catalogHttpStatus <= 599) safe.catalogHttpStatus = result.catalogHttpStatus;
  if (/^[A-Z][A-Z0-9_]{0,79}$/.test(result.catalogReadCode || '')) safe.catalogReadCode = result.catalogReadCode;
  if (Number.isInteger(result.httpStatus) && result.httpStatus >= 400 && result.httpStatus <= 599) safe.httpStatus = result.httpStatus;
  if (/^[A-Z][A-Z0-9_]{0,79}$/.test(result.pendingCode || '')) safe.pendingCode = result.pendingCode;
  const pendingCodes = [...new Set((result.pendingItems || []).map(function (item) { return item.pendingCode; }).filter(function (code) { return /^[A-Z][A-Z0-9_]{0,79}$/.test(code || ''); }))].slice(0,5);
  if (pendingCodes.length) safe.pendingCodes = pendingCodes;
  if (['CLOSE_FORMS','MATERIALS','FORMS'].includes(result.phase)) safe.phase = result.phase;
  Logger.log(JSON.stringify(safe));
  return result;
}
function trainingReleaseBatch_(loaded, phase, job) {
  const properties = PropertiesService.getScriptProperties(), startedAt = Date.now();
  const saved = trainingReleaseSaved_(SAHMT_V2_TRAINING_RELEASE.cursorProperty);
  if (saved && saved.digest !== loaded.digest) trainingReleaseReject_('CHECKPOINT_MANIFEST_CONFLICT');
  const checkpoint = saved || {schemaVersion: 1, digest: loaded.digest, prepare: 0, release: 0, combined: 0};
  let cursor = checkpoint[phase], attempted = 0, succeeded = 0, pending = 0;
  const pendingItems = [];
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= 76) trainingReleaseReject_('CHECKPOINT_INVALID');
  while (attempted < SAHMT_V2_TRAINING_RELEASE.batchSize && Date.now() - startedAt < SAHMT_V2_TRAINING_RELEASE.budgetMs) {
    const item = loaded.manifest.items[cursor];
    let verified = false;
    try {
      if (phase !== 'release') trainingReleasePrepared_(loaded, item);
      const result = phase === 'prepare' ? {prepared: true} : trainingReleaseReleased_(loaded, item);
      if (result.prepared || result.status === 'READY') { succeeded++; verified = result.status === 'READY'; }
      else { pending++; pendingItems.push({formId: item.formId, pendingCode: 'PUBLICATION_PENDING'}); }
    } catch (error) { trainingReleaseFailClosed_(item); pending++; pendingItems.push({formId: item.formId, pendingCode: error.trainingReleaseCode || 'FORM_VERIFY_ACCESS'}); }
    if (job) {
      job.verifiedMask = job.verifiedMask.slice(0, cursor) + (verified ? '1' : '0') + job.verifiedMask.slice(cursor + 1);
      properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    }
    attempted++; cursor = (cursor + 1) % 76; checkpoint[phase] = cursor;
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.cursorProperty, JSON.stringify(checkpoint));
    if (cursor === 0) break;
  }
  const result = Object.assign({status: pending ? 'CONFIGURATION_PENDING' : 'BATCH_COMPLETED', attemptedForms: attempted, successfulForms: succeeded, pendingInBatch: pending}, trainingReleaseCounts_(loaded));
  trainingReleaseLog_(result);
  return Object.assign({}, result, {pendingItems: pendingItems});
}
function trainingReleaseWithLock_(manifestId, phase) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING', productionFinancialWrites: false};
  try {
    const loaded = trainingReleaseLoad_(manifestId); trainingReleaseContext_(loaded, null);
    if (manifestId !== undefined) PropertiesService.getScriptProperties().setProperty(SAHMT_V2_TRAINING_RELEASE.manifestProperty, loaded.id);
    return trainingReleaseBatch_(loaded, phase);
  }
  catch (error) { return trainingReleaseLog_({status: 'CONFIGURATION_PENDING', pendingCode: error.trainingReleaseCode || 'CATALOG_ACCESS', productionFinancialWrites: false}); }
  finally { lock.releaseLock(); }
}
function consultarCatalogoTreinamentosSahmtV2(manifestId) {
  try { const loaded = trainingReleaseLoad_(manifestId); trainingReleaseContext_(loaded, null); return trainingReleaseLog_(Object.assign({status: 'READ_ONLY'}, trainingReleaseCounts_(loaded))); }
  catch (error) { return trainingReleaseLog_({status: 'CONFIGURATION_PENDING', pendingCode: error.trainingReleaseCode || 'CATALOG_ACCESS', productionFinancialWrites: false}); }
}
function prepararCatalogoTreinamentosSahmtV2(manifestId) { return trainingReleaseWithLock_(manifestId, 'prepare'); }
function liberarCatalogoTreinamentosSahmtV2(manifestId) { return trainingReleaseWithLock_(manifestId, 'release'); }

function trainingReleaseStopTrigger_(job) {
  if (!job || !job.triggerId) return;
  ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getUniqueId() === job.triggerId && trigger.getHandlerFunction() === SAHMT_V2_TRAINING_RELEASE.handler; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
}
/** Defaults belong in the private Apps Script project, never in the repository. */
function iniciarDisponibilizacaoTreinamentosSahmtV2() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING', productionFinancialWrites: false};
  let job = null;
  try {
    const properties = PropertiesService.getScriptProperties();
    job = trainingReleaseSaved_(SAHMT_V2_TRAINING_RELEASE.jobProperty);
    const defaults = typeof SAHMT_V2_TRAINING_RELEASE_DEFAULTS === 'undefined' ? null : SAHMT_V2_TRAINING_RELEASE_DEFAULTS;
    const loaded = defaults ? trainingReleaseLoad_(defaults.manifestId, defaults.digest) : trainingReleaseLoad_();
    trainingReleaseContext_(loaded, null);
    if (job && job.status === 'RUNNING' && job.schemaVersion === 2) {
      if (job.digest !== loaded.digest) trainingReleaseReject_('JOB_MANIFEST_CONFLICT');
      return trainingReleaseLog_(Object.assign({status: 'RUNNING', runs: job.runs}, trainingReleaseCounts_(loaded)));
    }
    if (job) trainingReleaseStopTrigger_(job);
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.manifestProperty, loaded.id);
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.digestProperty, loaded.digest);
    const trigger = ScriptApp.newTrigger(SAHMT_V2_TRAINING_RELEASE.handler).timeBased().everyMinutes(5).create();
    job = {schemaVersion: 2, status: 'RUNNING', digest: loaded.digest, startedAt: Date.now(), runs: 0, phase: 'CLOSE_FORMS',closeCursor: 0,closeMask: '0'.repeat(76),materialCursor: 0,materialMask: '0'.repeat(84),
      verifiedMask: '0'.repeat(76), triggerId: trigger.getUniqueId(), productionFinancialWrites: false};
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
  } catch (error) {
    const diagnostic = trainingReleaseJobError_(error);
    if (job) {
      job.status = 'CONFIGURATION_PENDING'; delete job.httpStatus; Object.assign(job, diagnostic);
      try { trainingReleaseStopTrigger_(job); } catch (_) {}
      PropertiesService.getScriptProperties().setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    }
    return trainingReleaseLog_(Object.assign({status: 'CONFIGURATION_PENDING', productionFinancialWrites: false}, diagnostic));
  } finally { lock.releaseLock(); }
  return continuarDisponibilizacaoTreinamentosSahmtV2_();
}
/** Re-arm this same bounded job after a temporary interruption; no catalog, Form or ACL writes. */
function retomarDisponibilizacaoTreinamentosSahmtV2() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING', productionFinancialWrites: false};
  const cfg = SAHMT_V2_TRAINING_RELEASE, properties = PropertiesService.getScriptProperties();
  let createdTrigger = null, ownedRaw = '', originalRaw = '', pins = null;
  function unchanged(expectedJob) {
    return properties.getProperty(cfg.jobProperty) === expectedJob &&
      properties.getProperty(cfg.cursorProperty) === pins.cursor && properties.getProperty(cfg.manifestProperty) === pins.manifest &&
      properties.getProperty(cfg.digestProperty) === pins.digest;
  }
  function summary(job) {
    return trainingReleaseLog_(Object.assign({},job,{status: 'RUNNING', totalForms: cfg.total, resumedOriginalJob: true,
      materialFiles: cfg.materialCount, materialPrepared: job.materialMask.split('').filter(function (value) { return value === '1'; }).length,
      validatedForms: job.verifiedMask.split('').filter(function (value) { return value === '1'; }).length, liveFormsRevalidated: false, productionFinancialWrites: false}));
  }
  try {
    evaluationAssertOperator_(false);
    originalRaw = properties.getProperty(cfg.jobProperty);
    const job = trainingReleaseSaved_(cfg.jobProperty);
    pins = {cursor: properties.getProperty(cfg.cursorProperty),manifest: properties.getProperty(cfg.manifestProperty),digest: properties.getProperty(cfg.digestProperty)};
    if (!job || !['RUNNING','CONFIGURATION_PENDING'].includes(job.status)) trainingReleaseReject_('JOB_RESUME_REQUIRES_REVIEW');
    const temporaryCodes = ['JOB_ACCESS','JOB_QUOTA_EXCEEDED','JOB_TEMPORARY_SERVICE','JOB_REVISION_CONFLICT'];
    if (job.status === 'CONFIGURATION_PENDING' && (!temporaryCodes.includes(job.pendingCode) || [401,403].includes(job.httpStatus))) trainingReleaseReject_('JOB_RESUME_REQUIRES_REVIEW');
    if (job.schemaVersion !== 2 || !['CLOSE_FORMS','MATERIALS','FORMS'].includes(job.phase) ||
        !Number.isInteger(job.closeCursor) || job.closeCursor < 0 || job.closeCursor >= cfg.total ||
        !Number.isInteger(job.materialCursor) || job.materialCursor < 0 || job.materialCursor >= cfg.materialCount ||
        !/^[01]{76}$/.test(job.closeMask || '') || !/^[01]{84}$/.test(job.materialMask || '') || !/^[01]{76}$/.test(job.verifiedMask || '') ||
        !/^[a-f0-9]{64}$/.test(job.digest || '') || !/^[a-f0-9]{64}$/.test(job.materialAudienceDigest || '') ||
        typeof job.triggerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(job.triggerId) || job.productionFinancialWrites !== false) trainingReleaseReject_('CHECKPOINT_INVALID');
    function withinLimits() {
      if (!Number.isInteger(job.runs) || job.runs < 0 || job.runs >= cfg.maxRuns || !Number.isFinite(job.startedAt) ||
          job.startedAt > Date.now() || Date.now() - job.startedAt >= cfg.maxAgeMs) trainingReleaseReject_('JOB_LIMIT');
    }
    withinLimits();
    if (job.phase !== 'CLOSE_FORMS' && job.closeMask !== '1'.repeat(cfg.total) ||
        job.phase === 'FORMS' && job.materialMask !== '1'.repeat(cfg.materialCount)) trainingReleaseReject_('CHECKPOINT_INVALID');
    const cursor = trainingReleaseSaved_(cfg.cursorProperty);
    if (pins.cursor && (!cursor || cursor.schemaVersion !== 1 || cursor.digest !== job.digest ||
        ['prepare','release','combined'].some(function (key) { return !Number.isInteger(cursor[key]) || cursor[key] < 0 || cursor[key] >= cfg.total; }))) trainingReleaseReject_('CHECKPOINT_INVALID');
    if (!pins.cursor && job.verifiedMask !== '0'.repeat(cfg.total)) trainingReleaseReject_('CHECKPOINT_INVALID');
    const loaded = trainingReleaseLoad_();
    if (loaded.digest !== job.digest) trainingReleaseReject_('JOB_MANIFEST_CONFLICT');
    trainingReleaseContext_(loaded,null);
    if (trainingReleaseMaterialAudience_(loaded).digest !== job.materialAudienceDigest) trainingReleaseReject_('JOB_AUDIENCE_CHANGED');
    function knownTrigger() {
      const triggers = ScriptApp.getProjectTriggers(), known = triggers.filter(function (trigger) { return trigger.getUniqueId() === job.triggerId; });
      if (known.length > 1 || triggers.some(function (trigger) { return trigger.getHandlerFunction() === cfg.handler && trigger.getUniqueId() !== job.triggerId; })) trainingReleaseReject_('JOB_TRIGGER_CONFLICT');
      if (known.some(function (trigger) { return trigger.getHandlerFunction() !== cfg.handler ||
          trigger.getTriggerSource() !== ScriptApp.TriggerSource.CLOCK || trigger.getEventType() !== ScriptApp.EventType.CLOCK; })) trainingReleaseReject_('JOB_TRIGGER_CONFLICT');
      return known[0] || null;
    }
    const existing = knownTrigger();
    if (!unchanged(originalRaw)) trainingReleaseReject_('JOB_CHANGED_DURING_RESUME');
    withinLimits();
    if (existing && job.status === 'RUNNING') return summary(job);
    if (!existing) {
      // Persist an intent before arming. An unknown creation outcome requires review, never a blind second trigger.
      job.status = 'CONFIGURATION_PENDING'; job.pendingCode = 'JOB_TRIGGER_UNCONFIRMED'; delete job.httpStatus;
      ownedRaw = JSON.stringify(job); properties.setProperty(cfg.jobProperty,ownedRaw);
      if (!unchanged(ownedRaw)) trainingReleaseReject_('JOB_CHANGED_DURING_RESUME');
      if (knownTrigger()) trainingReleaseReject_('JOB_TRIGGER_CONFLICT');
      createdTrigger = ScriptApp.newTrigger(cfg.handler).timeBased().everyMinutes(5).create();
      if (!unchanged(ownedRaw)) trainingReleaseReject_('JOB_CHANGED_DURING_RESUME');
      job.triggerId = createdTrigger.getUniqueId();
      if (typeof job.triggerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(job.triggerId)) trainingReleaseReject_('JOB_TRIGGER_UNCONFIRMED');
      if (!knownTrigger()) trainingReleaseReject_('JOB_TRIGGER_UNCONFIRMED');
    }
    if (!unchanged(ownedRaw || originalRaw)) trainingReleaseReject_('JOB_CHANGED_DURING_RESUME');
    withinLimits();
    job.status = 'RUNNING'; delete job.pendingCode; delete job.httpStatus;
    ownedRaw = JSON.stringify(job); properties.setProperty(cfg.jobProperty,ownedRaw);
    if (!unchanged(ownedRaw)) trainingReleaseReject_('JOB_CHANGED_DURING_RESUME');
    return summary(job);
  } catch (error) {
    if (createdTrigger) {
      try { ScriptApp.deleteTrigger(createdTrigger); } catch (_) {}
      // Restore only our own persisted intent; concurrent user/property changes remain intact.
      try { if (ownedRaw && pins && unchanged(ownedRaw)) properties.setProperty(cfg.jobProperty,originalRaw); } catch (_) {}
    }
    return trainingReleaseLog_(Object.assign({status: 'CONFIGURATION_PENDING', productionFinancialWrites: false},trainingReleaseJobError_(error)));
  } finally { lock.releaseLock(); }
}
function continuarDisponibilizacaoTreinamentosSahmtV2_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING', productionFinancialWrites: false};
  const properties = PropertiesService.getScriptProperties();
  let job = null;
  try {
    job = trainingReleaseSaved_(SAHMT_V2_TRAINING_RELEASE.jobProperty);
    if (!job || job.status !== 'RUNNING') return {status: job && job.status || 'NOT_STARTED', productionFinancialWrites: false};
    if (job.schemaVersion !== 2 || !['CLOSE_FORMS','MATERIALS','FORMS'].includes(job.phase) || !Number.isInteger(job.closeCursor) || job.closeCursor < 0 || job.closeCursor >= 76 ||
        !Number.isInteger(job.materialCursor) || job.materialCursor < 0 || job.materialCursor >= 84 || !/^[01]{76}$/.test(job.closeMask) || !/^[01]{84}$/.test(job.materialMask)) trainingReleaseReject_('CHECKPOINT_INVALID');
    if (!Number.isInteger(job.runs) || job.runs >= SAHMT_V2_TRAINING_RELEASE.maxRuns || !Number.isFinite(job.startedAt) || Date.now() - job.startedAt >= SAHMT_V2_TRAINING_RELEASE.maxAgeMs) trainingReleaseReject_('JOB_LIMIT');
    if (typeof job.verifiedMask !== 'string' || !/^[01]{76}$/.test(job.verifiedMask)) trainingReleaseReject_('CHECKPOINT_INVALID');
    const loaded = trainingReleaseLoad_();
    if (loaded.digest !== job.digest) trainingReleaseReject_('JOB_MANIFEST_CONFLICT');
    trainingReleaseContext_(loaded, null);
    job.runs++;
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    const currentAudience = trainingReleaseMaterialAudience_(loaded);
    if (job.materialAudienceDigest && currentAudience.digest !== job.materialAudienceDigest) {
      job.phase = 'CLOSE_FORMS';job.closeCursor = 0;job.closeMask = '0'.repeat(76);job.materialCursor = 0;job.materialMask = '0'.repeat(84);job.verifiedMask = '0'.repeat(76);
    }
    let result;
    if (job.phase === 'FORMS') result = Object.assign(trainingReleaseBatch_(loaded,'combined',job),{materialFiles: 84,materialPrepared: 84,materialPending: 0});
    else {
      const materials = trainingReleaseMaterialBatch_(loaded,job);
      result = Object.assign({},trainingReleaseCounts_(loaded),materials);
    }
    const validatedForms = job.verifiedMask.split('').filter(function (value) { return value === '1'; }).length;
    if (job.phase === 'FORMS' && job.materialMask === '1'.repeat(84) && result.publishedForms === 76 && result.managementDocuments === 76 && validatedForms === 76) { job.status = 'COMPLETED'; trainingReleaseStopTrigger_(job); }
    else if (job.runs >= SAHMT_V2_TRAINING_RELEASE.maxRuns) { job.status = 'CONFIGURATION_PENDING'; job.pendingCode = 'JOB_LIMIT'; trainingReleaseStopTrigger_(job); }
    Object.assign(job, {preparedForms: result.preparedForms, publishedForms: result.publishedForms, pendingForms: result.pendingForms, validatedForms: validatedForms,
      materialPrepared: result.materialPrepared,materialPending: result.materialPending,pendingItems: result.pendingItems, updatedAt: Date.now()});
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    return trainingReleaseLog_(Object.assign({}, result, {status: job.status,phase: job.phase,runs: job.runs, validatedForms: validatedForms, liveFormsRevalidated: job.status === 'COMPLETED'}));
  } catch (error) {
    const diagnostic = trainingReleaseJobError_(error);
    if (job) {
      job.status = 'CONFIGURATION_PENDING'; delete job.httpStatus; Object.assign(job, diagnostic);
      try { trainingReleaseStopTrigger_(job); } catch (_) {}
      properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    }
    return trainingReleaseLog_(Object.assign({status: 'CONFIGURATION_PENDING', productionFinancialWrites: false}, diagnostic));
  } finally { lock.releaseLock(); }
}
function consultarDisponibilizacaoTreinamentosSahmtV2() {
  try { evaluationAssertOperator_(false); }
  catch (_) { return trainingReleaseLog_({status: 'CONFIGURATION_PENDING', pendingCode: 'JOB_AUTHORIZATION_REQUIRED', checkpointReadOnly: true, catalogReadAvailable: false, liveFormsRevalidated: false, productionFinancialWrites: false}); }
  let job, result;
  try {
    const cfg = SAHMT_V2_TRAINING_RELEASE, now = Date.now();
    job = trainingReleaseSaved_(cfg.jobProperty);
    if (job === null && PropertiesService.getScriptProperties().getProperty(cfg.jobProperty) !== null) trainingReleaseReject_('CHECKPOINT_INVALID');
    result = {status: 'NOT_STARTED', runs: 0, checkpointReadOnly: true, catalogReadAvailable: false, liveFormsRevalidated: false, productionFinancialWrites: false};
    if (job !== null) {
      if (typeof job !== 'object' || Array.isArray(job) || job.schemaVersion !== 2 || !['RUNNING','CONFIGURATION_PENDING','COMPLETED'].includes(job.status) ||
          !['CLOSE_FORMS','MATERIALS','FORMS'].includes(job.phase) || !Number.isInteger(job.runs) || job.runs < 0 || job.runs > cfg.maxRuns ||
          !Number.isSafeInteger(job.startedAt) || job.startedAt < 0 || job.startedAt > now || job.productionFinancialWrites !== false ||
          !/^[a-f0-9]{64}$/.test(job.digest || '') || !/^[01]{76}$/.test(job.closeMask || '') || !/^[01]{84}$/.test(job.materialMask || '') || !/^[01]{76}$/.test(job.verifiedMask || '') ||
          !Number.isInteger(job.closeCursor) || job.closeCursor < 0 || job.closeCursor >= cfg.total || !Number.isInteger(job.materialCursor) || job.materialCursor < 0 || job.materialCursor >= cfg.materialCount ||
          typeof job.triggerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(job.triggerId) ||
          job.pendingCode !== undefined && !/^[A-Z][A-Z0-9_]{0,79}$/.test(job.pendingCode) ||
          job.httpStatus !== undefined && (!Number.isInteger(job.httpStatus) || job.httpStatus < 400 || job.httpStatus > 599)) trainingReleaseReject_('CHECKPOINT_INVALID');
      const expiresAt = job.startedAt + cfg.maxAgeMs;
      if (!Number.isSafeInteger(expiresAt) || !Number.isFinite(new Date(expiresAt).getTime())) trainingReleaseReject_('CHECKPOINT_INVALID');
      Object.assign(result, {status: job.status, phase: job.phase, runs: job.runs, expiresAt: new Date(expiresAt).toISOString(), jobLimitReached: job.runs >= cfg.maxRuns || now >= expiresAt,
        validatedForms: job.verifiedMask.split('').filter(function (value) { return value === '1'; }).length,
        materialFiles: cfg.materialCount, materialPrepared: job.materialMask.split('').filter(function (value) { return value === '1'; }).length});
      result.materialPending = cfg.materialCount - result.materialPrepared;
      if (job.pendingCode !== undefined) result.pendingCode = job.pendingCode;
      if (job.httpStatus !== undefined) result.httpStatus = job.httpStatus;
    }
  } catch (_) { return trainingReleaseLog_({status: 'CONFIGURATION_PENDING', pendingCode: 'CHECKPOINT_INVALID', checkpointReadOnly: true, catalogReadAvailable: false, liveFormsRevalidated: false, productionFinancialWrites: false}); }
  if (job) {
    try {
      const triggers = ScriptApp.getProjectTriggers();
      if (!Array.isArray(triggers)) trainingReleaseReject_('TRIGGER_LOOKUP_UNAVAILABLE');
      const matching = triggers.filter(function (trigger) { return trigger.getUniqueId() === job.triggerId; });
      result.triggerPresent = matching.length === 1 && matching[0].getHandlerFunction() === SAHMT_V2_TRAINING_RELEASE.handler &&
        matching[0].getTriggerSource() === ScriptApp.TriggerSource.CLOCK && matching[0].getEventType() === ScriptApp.EventType.CLOCK;
      result.triggerLookupAvailable = true;
    } catch (_) { result.triggerLookupAvailable = false; delete result.triggerPresent; }
  }
  try {
    const loaded = trainingReleaseLoad_();
    if (job && loaded.digest !== job.digest) trainingReleaseReject_('JOB_MANIFEST_CONFLICT');
    trainingReleaseContext_(loaded, null);
    Object.assign(result, trainingReleaseCounts_(loaded), {catalogReadAvailable: true});
  } catch (error) {
    const diagnostic = trainingReleaseJobError_(error);
    result.catalogReadCode = diagnostic.pendingCode;
    if (diagnostic.httpStatus !== undefined) result.catalogHttpStatus = diagnostic.httpStatus;
  }
  return trainingReleaseLog_(result);
}
