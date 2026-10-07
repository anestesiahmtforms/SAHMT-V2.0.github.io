/** Catalog metadata and Google Forms release only. This module never enables evaluation or writes credits. */
const SAHMT_V2_TRAINING_RELEASE = Object.freeze({
  source: 'SAHMT_V2_TRAINING_RELEASE', areaId: 'area-gestao-de-documentos', total: 76, batchSize: 5,
  originalRopRootId: '1Kx9FZRhlj2grDbGSH8opHU3pQFemReyG',
  budgetMs: 160000, maxRuns: 40, maxAgeMs: 86400000, handler: 'continuarDisponibilizacaoTreinamentosSahmtV2_',
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
  trainingReleaseContext_(loaded, null);
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
  trainingReleaseContext_(loaded, null);
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
  return {formId: formId, manifestDigest: loaded.digest, formDigest: live.digest};
}

/** All Google Form publication goes through the existing closed-stage/ACL/CAS finalizer, outside callbacks. */
function trainingReleaseFinalize_(loaded, item, requestId) {
  trainingReleaseContext_(loaded, null);
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
  return {status: 'READY', published: true, productionFinancialWrites: false};
}
function trainingReleaseReleased_(loaded, item) {
  trainingReleaseContext_(loaded, null);
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
  const dispatched = formsEvaluationProcessRequest_(evaluationGet_('evaluationRequests', requestId));
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
      return {writes: writes, result: {status: 'CONFIGURATION_PENDING'}};
    });
  } catch (_) {}
  return closed;
}

function trainingReleaseCounts_(loaded) {
  const counts = {totalForms: 76, preparedForms: 0, publishedForms: 0, pendingForms: 0, generalForms: 62, restrictedForms: 14, liveFormsRevalidated: false, productionFinancialWrites: false};
  const activities = {}, configs = {};
  formsEvaluationAll_('evaluationActivities').forEach(function (record) { activities[record.id] = record; });
  formsEvaluationAll_('evaluationFormConfigs').forEach(function (record) { configs[record.id] = record; });
  loaded.manifest.items.forEach(function (item) {
    const activity = activities[item.formId], cfg = configs[item.formId];
    if (activity && activity.trainingReleaseManifestDigest === loaded.digest && activity.trainingReleaseClosedBaseline === true) counts.preparedForms++;
    if (activity && cfg && activity.active === true && activity.status === 'READY' && cfg.status === 'READY' &&
        activity.trainingReleaseManifestDigest === loaded.digest && activity.configVersion === cfg.configVersion &&
        cfg.version === item.version && cfg.creditScopeId === item.creditScopeId && Array.isArray(cfg.eligibleUids) && !cfg.eligibleUids.length &&
        formsEvaluationStable_(cfg.eligibleGroups) === formsEvaluationStable_([item.eligibleGroup])) counts.publishedForms++;
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
  ['totalForms','preparedForms','publishedForms','pendingForms','generalForms','restrictedForms','attemptedForms','successfulForms','pendingInBatch','runs','validatedForms'].forEach(function (key) {
    if (Number.isInteger(result[key]) && result[key] >= 0 && result[key] <= 5000) safe[key] = result[key];
  });
  if (typeof result.liveFormsRevalidated === 'boolean') safe.liveFormsRevalidated = result.liveFormsRevalidated;
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
    if (job && job.status === 'RUNNING') {
      if (job.digest !== loaded.digest) trainingReleaseReject_('JOB_MANIFEST_CONFLICT');
      return trainingReleaseLog_(Object.assign({status: 'RUNNING', runs: job.runs}, trainingReleaseCounts_(loaded)));
    }
    if (job) trainingReleaseStopTrigger_(job);
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.manifestProperty, loaded.id);
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.digestProperty, loaded.digest);
    const trigger = ScriptApp.newTrigger(SAHMT_V2_TRAINING_RELEASE.handler).timeBased().everyMinutes(5).create();
    job = {schemaVersion: 1, status: 'RUNNING', digest: loaded.digest, startedAt: Date.now(), runs: 0, verifiedMask: '0'.repeat(76), triggerId: trigger.getUniqueId(), productionFinancialWrites: false};
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
  } catch (error) {
    if (job) {
      job.status = 'CONFIGURATION_PENDING'; job.pendingCode = error.trainingReleaseCode || 'JOB_ACCESS';
      try { trainingReleaseStopTrigger_(job); } catch (_) {}
      PropertiesService.getScriptProperties().setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    }
    return trainingReleaseLog_({status: 'CONFIGURATION_PENDING', pendingCode: error.trainingReleaseCode || 'JOB_ACCESS', productionFinancialWrites: false});
  } finally { lock.releaseLock(); }
  return continuarDisponibilizacaoTreinamentosSahmtV2_();
}
function continuarDisponibilizacaoTreinamentosSahmtV2_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING', productionFinancialWrites: false};
  const properties = PropertiesService.getScriptProperties();
  let job = null;
  try {
    job = trainingReleaseSaved_(SAHMT_V2_TRAINING_RELEASE.jobProperty);
    if (!job || job.status !== 'RUNNING') return {status: job && job.status || 'NOT_STARTED', productionFinancialWrites: false};
    if (!Number.isInteger(job.runs) || job.runs >= SAHMT_V2_TRAINING_RELEASE.maxRuns || !Number.isFinite(job.startedAt) || Date.now() - job.startedAt >= SAHMT_V2_TRAINING_RELEASE.maxAgeMs) trainingReleaseReject_('JOB_LIMIT');
    if (typeof job.verifiedMask !== 'string' || !/^[01]{76}$/.test(job.verifiedMask)) trainingReleaseReject_('CHECKPOINT_INVALID');
    const loaded = trainingReleaseLoad_();
    if (loaded.digest !== job.digest) trainingReleaseReject_('JOB_MANIFEST_CONFLICT');
    trainingReleaseContext_(loaded, null);
    job.runs++;
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    const result = trainingReleaseBatch_(loaded, 'combined', job);
    const validatedForms = job.verifiedMask.split('').filter(function (value) { return value === '1'; }).length;
    if (result.publishedForms === 76 && validatedForms === 76) { job.status = 'COMPLETED'; trainingReleaseStopTrigger_(job); }
    else if (job.runs >= SAHMT_V2_TRAINING_RELEASE.maxRuns) { job.status = 'CONFIGURATION_PENDING'; job.pendingCode = 'JOB_LIMIT'; trainingReleaseStopTrigger_(job); }
    Object.assign(job, {preparedForms: result.preparedForms, publishedForms: result.publishedForms, pendingForms: result.pendingForms, validatedForms: validatedForms, pendingItems: result.pendingItems, updatedAt: Date.now()});
    properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    return trainingReleaseLog_(Object.assign({}, result, {status: job.status, runs: job.runs, validatedForms: validatedForms, liveFormsRevalidated: job.status === 'COMPLETED'}));
  } catch (error) {
    if (job) {
      job.status = 'CONFIGURATION_PENDING'; job.pendingCode = error.trainingReleaseCode || 'JOB_ACCESS';
      try { trainingReleaseStopTrigger_(job); } catch (_) {}
      properties.setProperty(SAHMT_V2_TRAINING_RELEASE.jobProperty, JSON.stringify(job));
    }
    return trainingReleaseLog_({status: 'CONFIGURATION_PENDING', pendingCode: error.trainingReleaseCode || 'JOB_ACCESS', productionFinancialWrites: false});
  } finally { lock.releaseLock(); }
}
function consultarDisponibilizacaoTreinamentosSahmtV2() {
  const result = consultarCatalogoTreinamentosSahmtV2();
  if (result.status !== 'READ_ONLY') return result;
  try {
    const job = trainingReleaseSaved_(SAHMT_V2_TRAINING_RELEASE.jobProperty);
    return trainingReleaseLog_(Object.assign({}, result, {status: job && job.status || 'NOT_STARTED', runs: job && job.runs || 0, validatedForms: job && job.validatedForms || 0, pendingCode: job && job.pendingCode || '', pendingItems: job && job.pendingItems || []}));
  } catch (_) { return {status: 'CONFIGURATION_PENDING', pendingCode: 'CHECKPOINT_INVALID', productionFinancialWrites: false}; }
}
