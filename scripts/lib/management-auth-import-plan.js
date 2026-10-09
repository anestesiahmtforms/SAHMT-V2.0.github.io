import {createHash} from 'node:crypto';

// Local preview only: no Firebase SDK, credentials, network or import executor.
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const memberId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s/\x00-\x1f]/.test(value);
const projectId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
const email = value => typeof value === 'string' && value.length <= 320 && /^[^@\s]+@[^@\s]+$/.test(value);
const emailKey = value => typeof value === 'string' ? value.toLowerCase() : '';

function timestamp(value) {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  // Validate the UTC calendar directly: Date.parse normalizes impossible days
  // and loses submillisecond precision. Preserve the original fraction in output.
  return day >= 1 && day <= daysInMonth;
}

function jsonCopy(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error('AUTH_INPUT_NOT_JSON_SERIALIZABLE');
  }
}

export function authSnapshotDigest(snapshot) {
  return sha256(canonical(jsonCopy(snapshot)));
}

// Canonical pins for an offline reviewer. These functions return digests only;
// they do not certify absence of credentials, current access or live freshness.
export function authSourceRecordDigest(record) {
  return sha256(canonical(jsonCopy(record)));
}

export function authRawSnapshotDigest(rawUsers) {
  if (!Array.isArray(rawUsers)) throw new Error('AUTH_RAW_USERS_ARRAY_REQUIRED');
  return sha256(canonical(jsonCopy(rawUsers)));
}

export function authImportPlanDigest(plan) {
  const copied = jsonCopy(plan);
  delete copied.resultSha256;
  return sha256(canonical(copied));
}

function validateSnapshot(snapshot, side) {
  if (!isObject(snapshot) || snapshot.schemaVersion !== 1 || !projectId(snapshot.projectId) || !timestamp(snapshot.readTime) || snapshot.coverage?.complete !== true || !Array.isArray(snapshot.users)) throw new Error(`AUTH_${side}_SNAPSHOT_INVALID_OR_INCOMPLETE`);
}

function add(index, key, position) {
  if (!key) return;
  if (!index.has(key)) index.set(key, new Set());
  index.get(key).add(position);
}

function userIndex(users) {
  const byUid = new Map(), byGoogleUid = new Map(), byEmail = new Map();
  users.forEach((user, position) => {
    if (!isObject(user)) return;
    if (uid(user.uid)) add(byUid, user.uid, position);
    if (email(user.email)) add(byEmail, emailKey(user.email), position);
    for (const provider of Array.isArray(user.providerData) ? user.providerData : []) {
      if (provider?.providerId === 'google.com' && uid(provider.uid)) add(byGoogleUid, provider.uid, position);
      if (email(provider?.email)) add(byEmail, emailKey(provider.email), position);
    }
  });
  return {byUid, byGoogleUid, byEmail};
}

function emailsOf(user) {
  return new Set([user?.email, ...(Array.isArray(user?.providerData) ? user.providerData.map(provider => provider?.email) : [])].filter(email).map(emailKey));
}

function profileIssues(user, side) {
  const issues = [];
  if (!isObject(user) || !uid(user.uid)) return [`${side}_UID_INVALID`];
  if (typeof user.disabled !== 'boolean' || typeof user.emailVerified !== 'boolean') issues.push(`${side}_AUTH_STATUS_MISSING_OR_INVALID`);
  if (!Array.isArray(user.providerData)) issues.push(`${side}_PROVIDERS_INVALID`);
  for (const field of ['email', 'displayName', 'photoURL']) {
    if (user[field] !== undefined && typeof user[field] !== 'string') issues.push(`${side}_PROFILE_FIELD_INVALID`);
  }
  if (user.email !== undefined && !email(user.email)) issues.push(`${side}_EMAIL_INVALID`);
  for (const provider of Array.isArray(user.providerData) ? user.providerData : []) {
    if (!isObject(provider) || typeof provider.providerId !== 'string' || !uid(provider.uid)) issues.push(`${side}_PROVIDER_IDENTITY_INVALID`);
    for (const field of ['email', 'displayName', 'photoURL']) {
      if (provider?.[field] !== undefined && typeof provider[field] !== 'string') issues.push(`${side}_PROVIDER_PROFILE_INVALID`);
    }
    if (provider?.email !== undefined && !email(provider.email)) issues.push(`${side}_PROVIDER_EMAIL_INVALID`);
  }
  return [...new Set(issues)];
}

function googleIssues(user, side) {
  const providers = Array.isArray(user?.providerData) ? user.providerData : [];
  const issues = [];
  if (providers.some(provider => provider?.providerId === 'password')) issues.push(`${side}_PASSWORD_PROVIDER_REQUIRES_REVIEW`);
  if (providers.some(provider => provider?.providerId !== 'google.com')) issues.push(`${side}_UNSUPPORTED_PROVIDER_REQUIRES_REVIEW`);
  if (providers.filter(provider => provider?.providerId === 'google.com').length !== 1) issues.push(`${side}_GOOGLE_PROVIDER_MISSING_OR_AMBIGUOUS`);
  return issues;
}

function importRecord(user, preservedUid) {
  const record = {uid: preservedUid, emailVerified: user.emailVerified, disabled: user.disabled};
  for (const field of ['email', 'displayName', 'photoURL']) if (user[field] !== undefined) record[field] = user[field];
  const provider = user.providerData.find(item => item.providerId === 'google.com');
  record.providerData = [{providerId: 'google.com', uid: provider.uid}];
  for (const field of ['email', 'displayName', 'photoURL']) if (provider[field] !== undefined) record.providerData[0][field] = provider[field];
  return record;
}

function equivalent(left, right) {
  const normalized = record => ({...record, ...(record.email !== undefined ? {email: emailKey(record.email)} : {}), providerData: record.providerData.map(provider => ({...provider, ...(provider.email !== undefined ? {email: emailKey(provider.email)} : {})}))});
  return canonical(normalized(left)) === canonical(normalized(right));
}

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const onlyKeys = (value, keys) => isObject(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const MAX_DEFER_REVIEW_USERS = 50000;
const passwordFields = ['passwordHash', 'passwordSalt', 'salt', 'password', 'passwordDigest', 'passwordVerifier'];
const normalizedUserFields = ['uid', 'email', 'emailVerified', 'displayName', 'photoURL', 'disabled', 'providerData'];
const unlinkedCandidate = (user, required) => profileIssues(user, 'SOURCE').length === 0 && user.providerData.length === 0 && user.disabled === false && user.emailVerified === false && !required.has(user.uid);

function prepareDeferral(source, destination, fingerprints, options, conflict) {
  const result = {enabled: false, valid: false, required: new Set(), candidates: new Set(), evidenceByUid: new Map(), policy: {mode: 'STRICT_GOOGLE_ONLY'}};
  const hasDetails = ['requiredSourceUids', 'expectedRawSnapshotSha256', 'unlinkedSourceEvidence'].some(key => options[key] !== undefined);
  if (options.deferUnlinkedSource !== undefined && typeof options.deferUnlinkedSource !== 'boolean') conflict('DEFER_UNLINKED_POLICY_INVALID');
  if (options.deferUnlinkedSource !== true) {
    if (hasDetails) conflict('DEFER_UNLINKED_POLICY_NOT_ENABLED');
    return result;
  }
  result.enabled = true;
  const requiredList = options.requiredSourceUids;
  if (!Array.isArray(requiredList) || requiredList.length > MAX_DEFER_REVIEW_USERS || requiredList.some(value => !uid(value)) || new Set(requiredList).size !== requiredList.length) {
    conflict('REQUIRED_SOURCE_UIDS_INVALID_OR_MISSING');
    return result;
  }
  result.required = new Set(requiredList);
  let valid = true;
  const deny = code => { valid = false; conflict(code); };
  if (source.users.length > MAX_DEFER_REVIEW_USERS || destination.users.length > MAX_DEFER_REVIEW_USERS) deny('DEFER_UNLINKED_REVIEW_LIMIT_EXCEEDED');
  const sourceUids = new Set(source.users.map(user => user?.uid));
  for (const requiredUid of result.required) if (!sourceUids.has(requiredUid)) deny('REQUIRED_SOURCE_UID_NOT_IN_AUTH_SNAPSHOT');
  const candidateRows = source.users.filter(user => unlinkedCandidate(user, result.required));
  const candidateByUid = new Map();
  for (const user of candidateRows) { result.candidates.add(user.uid); candidateByUid.set(user.uid, user); }
  if (result.candidates.size !== candidateRows.length) deny('UNLINKED_SOURCE_EVIDENCE_SOURCE_UID_AMBIGUOUS');
  const evidence = options.unlinkedSourceEvidence;
  if (!digest(options.expectedRawSnapshotSha256)) deny('EXPECTED_RAW_AUTH_SNAPSHOT_FINGERPRINT_INVALID_OR_MISSING');
  if (!onlyKeys(evidence, ['schemaVersion', 'sourceSnapshotSha256', 'rawSnapshotSha256', 'entries']) || evidence.schemaVersion !== 1 || !digest(evidence.sourceSnapshotSha256) || !digest(evidence.rawSnapshotSha256) || !Array.isArray(evidence.entries) || evidence.entries.length > MAX_DEFER_REVIEW_USERS) {
    deny('UNLINKED_SOURCE_EVIDENCE_INVALID_OR_MISSING');
  } else {
    if (evidence.sourceSnapshotSha256 !== fingerprints.sourceSha256) deny('UNLINKED_SOURCE_EVIDENCE_NORMALIZED_SNAPSHOT_CHANGED');
    if (evidence.rawSnapshotSha256 !== options.expectedRawSnapshotSha256) deny('UNLINKED_SOURCE_EVIDENCE_RAW_SNAPSHOT_CHANGED');
    const rawRecordPins = new Set();
    for (const entry of evidence.entries) {
      if (!onlyKeys(entry, ['faUid', 'sourceRecordSha256', 'rawRecordSha256', 'providerCount', 'passwordMaterialPresent', 'otherProviderIdentityPresent', 'disabled', 'emailVerified']) || !uid(entry.faUid) || !digest(entry.sourceRecordSha256) || !digest(entry.rawRecordSha256) || entry.providerCount !== 0 || entry.passwordMaterialPresent !== false || entry.otherProviderIdentityPresent !== false || entry.disabled !== false || entry.emailVerified !== false) {
        deny('UNLINKED_SOURCE_RECORD_EVIDENCE_INVALID');
        continue;
      }
      if (result.evidenceByUid.has(entry.faUid)) { deny('UNLINKED_SOURCE_RECORD_EVIDENCE_DUPLICATED'); continue; }
      result.evidenceByUid.set(entry.faUid, entry);
      if (rawRecordPins.has(entry.rawRecordSha256)) deny('UNLINKED_SOURCE_RAW_RECORD_EVIDENCE_DUPLICATED');
      rawRecordPins.add(entry.rawRecordSha256);
      if (!result.candidates.has(entry.faUid)) deny('UNLINKED_SOURCE_RECORD_EVIDENCE_EXTRA');
      const row = candidateByUid.get(entry.faUid);
      if (!row || authSourceRecordDigest(row) !== entry.sourceRecordSha256) deny('UNLINKED_SOURCE_RECORD_EVIDENCE_CHANGED');
    }
    if (candidateRows.some(user => !result.evidenceByUid.has(user.uid))) deny('UNLINKED_SOURCE_RECORD_EVIDENCE_MISSING');
  }
  result.valid = valid;
  result.policy = {
    mode: 'DEFER_UNLINKED_SOURCE_OFFLINE_REVIEW',
    requiredSourceUids: [...result.required].sort(),
    expectedRawSnapshotSha256: digest(options.expectedRawSnapshotSha256) ? options.expectedRawSnapshotSha256 : null,
    evidenceSha256: valid ? sha256(canonical({...evidence, entries: [...evidence.entries].sort((a, b) => a.faUid.localeCompare(b.faUid))})) : null,
    evidenceScope: 'PRIVATE_OFFLINE_REVIEW_ONLY',
    operationalFreshnessEvaluated: false
  };
  return result;
}

/**
 * Receives complete JSON Auth snapshots (schemaVersion, projectId, readTime,
 * coverage.complete and users), plus explicit memberId/faUid/fbUid mappings.
 * Firebase UIDs must be preserved. importUsers overwrites UID collisions, so this
 * planner proposes absent users only and never repairs an existing destination.
 * A future executor must revalidate fingerprints and exclude concurrent FB
 * account creation; this preview cannot make the remote preflight atomic.
 * ready means structural preview readiness only. No clock or live service is
 * consulted, so operational freshness is not evaluated by this pure planner.
 * Optional deferral needs a pinned private review of raw rows: normalized Auth
 * exports intentionally omit credentials and cannot prove their absence.
 * selectedImportReady is only an offline subset proposal, never an executor
 * signal; ready remains false while any source user is deferred.
 */
export function prepareAuthImportPlan(sourceSnapshot, destinationSnapshot, identityMappings, options = {}) {
  const copiedOptions = jsonCopy(options);
  if (!isObject(copiedOptions)) throw new Error('AUTH_PLAN_OPTIONS_INVALID');
  const {expectedFingerprints = null} = copiedOptions;
  const source = jsonCopy(sourceSnapshot), destination = jsonCopy(destinationSnapshot), mappings = jsonCopy(identityMappings);
  validateSnapshot(source, 'SOURCE');
  validateSnapshot(destination, 'DESTINATION');
  if (!Array.isArray(mappings)) throw new Error('AUTH_IDENTITY_MAPPINGS_REQUIRED');
  const fingerprints = {
    sourceSha256: authSnapshotDigest(source),
    destinationSha256: authSnapshotDigest(destination),
    identityMappingsSha256: sha256(canonical(mappings))
  };
  const conflicts = [];
  const conflict = (code, details = {}) => conflicts.push({code, ...details});
  if (source.projectId !== 'sahmt-17a16') conflict('SOURCE_PROJECT_MISMATCH');
  if (destination.projectId === source.projectId) conflict('DESTINATION_PROJECT_MUST_DIFFER');
  if (expectedFingerprints !== null) {
    if (!isObject(expectedFingerprints) || Object.keys(fingerprints).some(key => typeof expectedFingerprints[key] !== 'string' || !/^[a-f0-9]{64}$/.test(expectedFingerprints[key]))) conflict('EXPECTED_FINGERPRINTS_INVALID');
    else for (const key of Object.keys(fingerprints)) if (fingerprints[key] !== expectedFingerprints[key]) conflict(key === 'destinationSha256' ? 'DESTINATION_SNAPSHOT_CHANGED' : key === 'sourceSha256' ? 'SOURCE_SNAPSHOT_CHANGED' : 'IDENTITY_MAPPINGS_CHANGED');
  }

  const deferral = prepareDeferral(source, destination, fingerprints, copiedOptions, conflict);
  const sourceIndex = userIndex(source.users), destinationIndex = userIndex(destination.users);
  for (const [side, index] of [['SOURCE', sourceIndex], ['DESTINATION', destinationIndex]]) {
    for (const [kind, values] of Object.entries(index)) {
      for (const positions of values.values()) if (positions.size > 1) conflict(`${side}_${kind === 'byUid' ? 'UID' : kind === 'byGoogleUid' ? 'GOOGLE_UID' : 'EMAIL'}_COLLISION`, {positions: [...positions]});
    }
  }
  destination.users.forEach((user, position) => profileIssues(user, 'DESTINATION').forEach(code => conflict(code, {position})));

  const mappingByUid = new Map(), memberMappings = new Map(), destinationMappings = new Map(), invalidMappingUids = new Set();
  mappings.forEach((mapping, position) => {
    if (!isObject(mapping) || Object.keys(mapping).some(key => !['memberId', 'faUid', 'fbUid'].includes(key)) || !memberId(mapping.memberId) || !uid(mapping.faUid) || !uid(mapping.fbUid)) {
      conflict('IDENTITY_MAPPING_INVALID', {position});
      if (uid(mapping?.faUid)) invalidMappingUids.add(mapping.faUid);
      return;
    }
    if (mapping.faUid !== mapping.fbUid) {
      conflict('UID_REMAP_REQUIRES_REVIEWED_ADAPTER', {position});
      invalidMappingUids.add(mapping.faUid);
    }
    if (mappingByUid.has(mapping.faUid) || memberMappings.has(mapping.memberId) || destinationMappings.has(mapping.fbUid)) {
      conflict('IDENTITY_MAPPING_COLLISION', {position});
      invalidMappingUids.add(mapping.faUid);
      for (const related of [mappingByUid.get(mapping.faUid), memberMappings.get(mapping.memberId), destinationMappings.get(mapping.fbUid)]) if (related) invalidMappingUids.add(related.faUid);
    }
    mappingByUid.set(mapping.faUid, mapping);
    memberMappings.set(mapping.memberId, mapping);
    destinationMappings.set(mapping.fbUid, mapping);
    if (!sourceIndex.byUid.has(mapping.faUid)) conflict('IDENTITY_MAPPING_SOURCE_USER_MISSING', {position});
  });

  const entries = source.users.map((user, sourcePosition) => {
    const canReviewUnlinked = deferral.enabled && deferral.valid && deferral.candidates.has(user?.uid);
    const codes = [...profileIssues(user, 'SOURCE'), ...(canReviewUnlinked ? [] : googleIssues(user, 'SOURCE'))];
    if (deferral.enabled && Array.isArray(user?.providerData) && user.providerData.length === 0) {
      if (deferral.required.has(user.uid)) codes.push('SOURCE_REQUIRED_USER_HAS_NO_VERIFIED_GOOGLE_LINK');
      if (user.disabled !== false || user.emailVerified !== false) codes.push('SOURCE_UNLINKED_STATUS_REQUIRES_REVIEW');
      if (passwordFields.some(field => Object.hasOwn(user, field))) codes.push('SOURCE_PASSWORD_MATERIAL_REQUIRES_REVIEW');
      if (Object.keys(user).some(field => !normalizedUserFields.includes(field))) codes.push('SOURCE_UNLINKED_METADATA_REQUIRES_REVIEW');
    }
    const mapping = mappingByUid.get(user?.uid);
    if (!mapping) codes.push('IDENTITY_MAPPING_MISSING');
    else if (invalidMappingUids.has(user.uid)) codes.push('IDENTITY_MAPPING_REQUIRES_REVIEW');
    const googleUid = (Array.isArray(user?.providerData) ? user.providerData : []).find(provider => provider?.providerId === 'google.com')?.uid;
    if (sourceIndex.byUid.get(user?.uid)?.size > 1) codes.push('SOURCE_UID_COLLISION');
    if (sourceIndex.byGoogleUid.get(googleUid)?.size > 1) codes.push('SOURCE_GOOGLE_UID_COLLISION');
    for (const key of emailsOf(user)) if (sourceIndex.byEmail.get(key)?.size > 1) codes.push('SOURCE_EMAIL_COLLISION');

    const destinationPositions = destinationIndex.byUid.get(mapping?.fbUid);
    const destinationPosition = destinationPositions?.size === 1 ? [...destinationPositions][0] : null;
    const existing = destinationPosition !== null ? destination.users[destinationPosition] : null;
    if (destinationPositions?.size > 1) codes.push('DESTINATION_UID_COLLISION');
    const googlePositions = destinationIndex.byGoogleUid.get(googleUid);
    if (googlePositions && [...googlePositions].some(position => position !== destinationPosition)) codes.push('DESTINATION_GOOGLE_UID_COLLISION');
    for (const key of emailsOf(user)) {
      const positions = destinationIndex.byEmail.get(key);
      if (positions && [...positions].some(position => position !== destinationPosition)) codes.push('DESTINATION_EMAIL_COLLISION');
    }
    if (existing && canReviewUnlinked) codes.push('DESTINATION_UNLINKED_UID_ALREADY_EXISTS_REQUIRES_REVIEW');
    if (existing) {
      codes.push(...profileIssues(existing, 'DESTINATION'), ...googleIssues(existing, 'DESTINATION'));
      if (!codes.length && !equivalent(importRecord(user, mapping.fbUid), importRecord(existing, existing.uid))) codes.push('DESTINATION_USER_DIFFERS_REQUIRES_REVIEW');
    }

    const entry = {
      sourcePosition,
      memberId: mapping?.memberId ?? null,
      faUid: uid(user?.uid) ? user.uid : null,
      fbUid: mapping?.fbUid ?? null,
      sourceRecordSha256: sha256(canonical(user)),
      destinationRecordSha256: existing ? sha256(canonical(existing)) : null,
      action: codes.length ? 'CONFLICT' : canReviewUnlinked ? 'DEFER_UNLINKED_SOURCE' : existing ? 'SKIP' : 'CREATE',
      codes: [...new Set(codes)].sort()
    };
    if (entry.action === 'CREATE') entry.importRecord = importRecord(user, mapping.fbUid);
    if (entry.action === 'SKIP') entry.reason = 'EXISTING_EQUIVALENT_NO_OVERWRITE';
    if (entry.action === 'DEFER_UNLINKED_SOURCE') {
      entry.reason = 'NO_VERIFIED_PROVIDER_NO_DESTINATION_USER_OR_PERMISSION';
      entry.nextRequirement = 'VERIFIED_GOOGLE_LINK_AND_FRESH_IDENTITY_REVIEW';
      entry.rawRecordSha256 = deferral.evidenceByUid.get(user.uid).rawRecordSha256;
    }
    return entry;
  });
  for (const entry of entries) for (const code of entry.codes) conflict(code, {sourcePosition: entry.sourcePosition});

  const deferred = entries.filter(entry => entry.action === 'DEFER_UNLINKED_SOURCE').length;
  const selectedImportReady = conflicts.length === 0;
  const ready = selectedImportReady && deferred === 0;
  const plan = {
    schemaVersion: 1,
    previewOnly: true,
    productionAuthorized: false,
    writeEnabled: false,
    ready,
    selectedImportReady,
    allSourceUsersReconciled: ready,
    deferredRequiresVerifiedGoogleLink: deferred > 0,
    selectionPolicy: deferral.policy,
    readiness: {
      scope: 'STRUCTURAL_PREVIEW_ONLY',
      structuralReady: ready,
      operationalFreshnessEvaluated: false
    },
    sourceProjectId: source.projectId,
    destinationProjectId: destination.projectId,
    sourceReadTime: source.readTime,
    destinationReadTime: destination.readTime,
    fingerprints,
    inputSha256: sha256(canonical(deferral.enabled ? {fingerprints, selectionPolicy: deferral.policy} : fingerprints)),
    counts: {
      sourceUsers: source.users.length,
      destinationUsers: destination.users.length,
      create: entries.filter(entry => entry.action === 'CREATE').length,
      skip: entries.filter(entry => entry.action === 'SKIP').length,
      deferUnlinked: deferred,
      conflict: entries.filter(entry => entry.action === 'CONFLICT').length,
      blockingIssues: conflicts.length
    },
    // Invalid map extras are conflicts, never copied into the output artifact.
    identityMappings: mappings.filter(mapping => isObject(mapping) && Object.keys(mapping).every(key => ['memberId', 'faUid', 'fbUid'].includes(key)) && memberId(mapping.memberId) && uid(mapping.faUid) && uid(mapping.fbUid)),
    entries,
    conflicts,
    importRecords: selectedImportReady ? entries.filter(entry => entry.action === 'CREATE').map(entry => entry.importRecord) : [],
    requiredBeforeProduction: [
      'VERIFIED_PRIVATE_BACKUP_AND_ROLLBACK',
      'SOURCE_PERMISSIONS_AND_DESTINATION_CLAIMS_RECONCILED_SEPARATELY',
      'FRESH_DESTINATION_FINGERPRINT_REVALIDATION',
      'EXCLUSIVE_DESTINATION_AUTH_CREATION_WINDOW',
      'FINAL_HUMAN_PRODUCTION_AUTHORIZATION',
      ...(deferred > 0 ? ['DEFERRED_USERS_REQUIRE_VERIFIED_GOOGLE_LINK_AND_NEW_REVIEW', 'SELECTED_IMPORT_READY_IS_NOT_AN_AUTOMATIC_EXECUTOR_SIGNAL'] : [])
    ]
  };
  plan.resultSha256 = authImportPlanDigest(plan);
  return plan;
}
