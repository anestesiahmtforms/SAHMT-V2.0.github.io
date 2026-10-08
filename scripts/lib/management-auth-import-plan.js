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

/**
 * Receives complete JSON Auth snapshots (schemaVersion, projectId, readTime,
 * coverage.complete and users), plus explicit memberId/faUid/fbUid mappings.
 * Firebase UIDs must be preserved. importUsers overwrites UID collisions, so this
 * planner proposes absent users only and never repairs an existing destination.
 * A future executor must revalidate fingerprints and exclude concurrent FB
 * account creation; this preview cannot make the remote preflight atomic.
 * ready means structural preview readiness only. No clock or live service is
 * consulted, so operational freshness is not evaluated by this pure planner.
 */
export function prepareAuthImportPlan(sourceSnapshot, destinationSnapshot, identityMappings, {expectedFingerprints = null} = {}) {
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
    const codes = [...profileIssues(user, 'SOURCE'), ...googleIssues(user, 'SOURCE')];
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
      action: codes.length ? 'CONFLICT' : existing ? 'SKIP' : 'CREATE',
      codes: [...new Set(codes)].sort()
    };
    if (entry.action === 'CREATE') entry.importRecord = importRecord(user, mapping.fbUid);
    if (entry.action === 'SKIP') entry.reason = 'EXISTING_EQUIVALENT_NO_OVERWRITE';
    return entry;
  });
  for (const entry of entries) for (const code of entry.codes) conflict(code, {sourcePosition: entry.sourcePosition});

  const ready = conflicts.length === 0;
  const plan = {
    schemaVersion: 1,
    previewOnly: true,
    productionAuthorized: false,
    writeEnabled: false,
    ready,
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
    inputSha256: sha256(canonical(fingerprints)),
    counts: {
      sourceUsers: source.users.length,
      destinationUsers: destination.users.length,
      create: entries.filter(entry => entry.action === 'CREATE').length,
      skip: entries.filter(entry => entry.action === 'SKIP').length,
      conflict: entries.filter(entry => entry.action === 'CONFLICT').length,
      blockingIssues: conflicts.length
    },
    entries,
    conflicts,
    importRecords: ready ? entries.filter(entry => entry.action === 'CREATE').map(entry => entry.importRecord) : [],
    requiredBeforeProduction: [
      'VERIFIED_PRIVATE_BACKUP_AND_ROLLBACK',
      'SOURCE_PERMISSIONS_AND_DESTINATION_CLAIMS_RECONCILED_SEPARATELY',
      'FRESH_DESTINATION_FINGERPRINT_REVALIDATION',
      'EXCLUSIVE_DESTINATION_AUTH_CREATION_WINDOW',
      'FINAL_HUMAN_PRODUCTION_AUTHORIZATION'
    ]
  };
  plan.resultSha256 = authImportPlanDigest(plan);
  return plan;
}
