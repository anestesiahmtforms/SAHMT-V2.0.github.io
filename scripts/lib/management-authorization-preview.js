import {snapshotDigest, documentDigest, validateSplitSnapshot, prepareSplitPlan} from './management-split-plan.js';
import {authSnapshotDigest, authSourceRecordDigest} from './management-auth-import-plan.js';

// Pure offline planner. No credentials, SDK, network, grants, lease or apply path.
const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
export const MANAGEMENT_PREVIEW_PERMISSION_KEYS = Object.freeze(['admin', 'managementRead', 'managementManage', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage', 'equipmentManage', 'qualityManage', 'trainingsManage', 'financeRead', 'financeWrite', 'financeManage']);
const profilePermissions = new Set([...MANAGEMENT_PREVIEW_PERMISSION_KEYS, 'checklistRead', 'checklistWrite', 'checklistSign', 'checklistManage', 'labelsRead', 'labelsWrite', 'labelsManage', 'eventsRead', 'eventsWrite', 'eventsCatalogManage', 'scheduleRead', 'scheduleWrite', 'trainingsRead', 'peopleManage', 'notificationsRead', 'notificationsManage', 'usersManage']);
const requiredRoots = ['users', 'managementAreas', 'documentAccessEmails', 'documents', 'scopedDocuments', 'evaluationFormConfigs', 'evaluationActivities'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const demand = (ok, code) => { if (!ok) throw Error(code); };
const id = (v, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\s/\x00-\x1f]/.test(v);
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const positive = v => Number.isSafeInteger(v) && v > 0;
const email = v => typeof v === 'string' && v.length <= 320 && /^[^@\s]+@[^@\s]+$/.test(v);
const sorted = values => [...values].sort();
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a, b) => snapshotDigest(a) === snapshotDigest(b);
const copy = value => JSON.parse(JSON.stringify(value));
const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
function json(value, depth = 0, seen = new Set()) {
  demand(depth <= 80, 'AUTHORIZATION_JSON_DEPTH_LIMIT');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { demand(Number.isFinite(value), 'AUTHORIZATION_JSON_NUMBER_INVALID'); return; }
  demand(Array.isArray(value) || plain(value), 'AUTHORIZATION_INPUT_NOT_PLAIN_JSON');
  demand(!seen.has(value), 'AUTHORIZATION_INPUT_CYCLE'); seen.add(value);
  const keys = Reflect.ownKeys(value), allowed = Array.isArray(value) ? Object.keys(value).length + 1 : Object.keys(value).length;
  demand(keys.length === allowed && keys.every(k => typeof k === 'string'), 'AUTHORIZATION_JSON_HIDDEN_PROPERTY');
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    demand(desc?.enumerable === true && Object.hasOwn(desc, 'value'), 'AUTHORIZATION_JSON_ACCESSOR');
    if (Array.isArray(value)) demand(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length, 'AUTHORIZATION_JSON_ARRAY_PROPERTY');
    json(desc.value, depth + 1, seen);
  }
  if (Array.isArray(value)) demand(Object.keys(value).length === value.length, 'AUTHORIZATION_JSON_SPARSE_ARRAY');
  seen.delete(value);
}
function decode(value) {
  if (Object.hasOwn(value, 'mapValue')) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
  if (Object.hasOwn(value, 'arrayValue')) return (value.arrayValue.values || []).map(decode);
  if (Object.hasOwn(value, 'integerValue')) { const n = Number(value.integerValue); demand(Number.isSafeInteger(n), 'AUTHORIZATION_INTEGER_OUT_OF_RANGE'); return n; }
  return Object.values(value)[0];
}
function record(doc) { return {fields: doc.fields, path: doc.path, id: doc.path.split('/')[1], sourceDocumentSha256: documentDigest(doc), data: Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, decode(v)]))}; }
function groupList(values, code) { demand(Array.isArray(values) && values.length <= 2 && new Set(values).size === values.length && values.every(v => ['GENERAL', 'RESTRICTED'].includes(v)), code); return sorted(values); }
function uidList(values, mappings, code) { demand(Array.isArray(values) && values.length <= 1000 && new Set(values).size === values.length && values.every(v => id(v) && mappings.has(v)), code); return sorted(values); }
const positiveVersion = row => Object.hasOwn(row.fields.version || {}, 'integerValue') && positive(row.data.version);
const count = (values, key) => { const counters = new Map(); for (const row of values) { const name = key(row); counters.set(name, (counters.get(name) || 0) + 1); } return Object.fromEntries([...counters].sort(([a], [b]) => lexical(a, b))); };
export function managementAuthorizationPreviewDigest(preview) { json(preview); const value = copy(preview); delete value.resultSha256; return snapshotDigest(value); }

export function buildManagementAuthorizationPreview(input) {
  json(input);
  demand(exact(input, ['sourceSnapshot', 'destinationSnapshot', 'sourceAuth', 'manifest', 'policy', 'aclBindings', 'pins']), 'AUTHORIZATION_INPUT_SCHEMA_INVALID');
  const {sourceSnapshot, destinationSnapshot, sourceAuth, manifest, policy, aclBindings, pins} = input;
  validateSplitSnapshot(sourceSnapshot); validateSplitSnapshot(destinationSnapshot);
  demand(sourceSnapshot.projectId === FA && destinationSnapshot.projectId === FB && manifest.sourceProjectId === FA && manifest.destinationProjectId === FB, 'AUTHORIZATION_PROJECT_MISMATCH');
  demand(requiredRoots.every(root => sourceSnapshot.coverage.rootCollections.includes(root)), 'AUTHORIZATION_SOURCE_COVERAGE_MISSING');
  demand(plain(sourceAuth) && sourceAuth.schemaVersion === 1 && sourceAuth.projectId === FA && sourceAuth.coverage?.complete === true && Array.isArray(sourceAuth.users), 'AUTHORIZATION_AUTH_SNAPSHOT_INCOMPLETE');
  validateSplitSnapshot({schemaVersion: 1, projectId: FA, databaseId: '(default)', readTime: sourceAuth.readTime, coverage: {complete: true, consistent: true, rootCollections: ['users']}, documents: []});
  demand(exact(policy, ['schemaVersion', 'version', 'sourceProjectId', 'destinationProjectId', 'mode', 'managementSurfaceEnabled', 'performanceSurfaceEnabled', 'futureManagementGate', 'baseline', 'cancelledTrainingRemainsStopped'])
    && policy.schemaVersion === 1 && id(policy.version, 100) && policy.sourceProjectId === FA && policy.destinationProjectId === FB
    && policy.mode === 'OFFLINE_PROPOSAL_ONLY' && policy.managementSurfaceEnabled === false && policy.performanceSurfaceEnabled === false
    && ['DENIED', 'ADMINISTRATOR_ONLY'].includes(policy.futureManagementGate) && policy.baseline === 'FA_APP_MANAGEMENT_ADMIN_ONLY'
    && policy.cancelledTrainingRemainsStopped === true, 'AUTHORIZATION_SURFACE_POLICY_INVALID');
  demand(Array.isArray(aclBindings), 'AUTHORIZATION_ACL_BINDINGS_INVALID');
  const computedPins = {sourceSnapshotSha256: snapshotDigest(sourceSnapshot), destinationSnapshotSha256: snapshotDigest(destinationSnapshot),
    sourceAuthSha256: authSnapshotDigest(sourceAuth), manifestSha256: snapshotDigest(manifest), identityMappingsSha256: snapshotDigest(manifest.identityMappings),
    policySha256: snapshotDigest(policy), aclBindingsSha256: snapshotDigest(aclBindings)};
  demand(exact(pins, Object.keys(computedPins)) && Object.keys(computedPins).every(key => digest(pins[key]) && pins[key] === computedPins[key]), 'AUTHORIZATION_INPUT_PIN_MISMATCH');
  const splitPlan = prepareSplitPlan(sourceSnapshot, manifest, destinationSnapshot);
  const classification = new Map(manifest.entries.map(entry => [entry.path, entry.action]));
  demand(splitPlan.readyForReview === true, 'AUTHORIZATION_SPLIT_PLAN_BLOCKED');
  const collections = new Map(requiredRoots.map(root => [root, sourceSnapshot.documents.filter(d => d.path.split('/')[0] === root).map(record).sort((a, b) => lexical(a.path, b.path))]));
  for (const records of collections.values()) demand(records.every(r => r.path.split('/').length === 2), 'AUTHORIZATION_NESTED_INPUT_REQUIRES_ADAPTER');
  const profiles = new Map(), mappings = new Map(), authUsers = new Map(), googleOwners = new Map(), emailOwners = new Map();
  for (const row of collections.get('users')) {
    const p = row.data;
    demand(p.uid === row.id && id(p.uid) && typeof p.role === 'string' && p.role.length <= 100 && typeof p.active === 'boolean' && typeof p.access === 'boolean' && plain(p.permissions), 'AUTHORIZATION_PROFILE_INVALID');
    demand(Object.entries(p.permissions).every(([k, v]) => profilePermissions.has(k) && typeof v === 'boolean'), 'AUTHORIZATION_PROFILE_PERMISSION_INVALID');
    if (Object.hasOwn(p, 'version')) demand(positiveVersion(row), 'AUTHORIZATION_PROFILE_VERSION_INVALID');
    if (Object.hasOwn(p, 'memberId')) demand(id(p.memberId, 200), 'AUTHORIZATION_PROFILE_MEMBER_INVALID');
    profiles.set(p.uid, row);
  }
  for (const mapping of manifest.identityMappings) {
    demand(exact(mapping, ['memberId', 'faUid', 'fbUid']) && id(mapping.memberId, 200) && id(mapping.faUid) && mapping.fbUid === mapping.faUid
      && profiles.has(mapping.faUid) && !mappings.has(mapping.faUid), 'AUTHORIZATION_MAPPING_INVALID');
    const profileMemberId = profiles.get(mapping.faUid).data.memberId;
    demand(profileMemberId === undefined || profileMemberId === mapping.memberId, 'AUTHORIZATION_PROFILE_MEMBER_CONFLICT');
    mappings.set(mapping.faUid, mapping);
  }
  demand(mappings.size === profiles.size, 'AUTHORIZATION_PROFILE_MAPPING_INCOMPLETE');
  for (const user of sourceAuth.users) {
    demand(plain(user) && id(user.uid) && !authUsers.has(user.uid) && mappings.has(user.uid) && typeof user.disabled === 'boolean' && typeof user.emailVerified === 'boolean'
      && Array.isArray(user.providerData) && user.providerData.length <= 10, 'AUTHORIZATION_AUTH_USER_INVALID');
    const allowed = ['uid', 'email', 'emailVerified', 'displayName', 'photoURL', 'disabled', 'providerData'];
    demand(Object.keys(user).every(k => allowed.includes(k)), 'AUTHORIZATION_AUTH_USER_UNEXPECTED_FIELD');
    for (const key of ['email', 'displayName', 'photoURL']) if (Object.hasOwn(user, key)) demand(typeof user[key] === 'string' && (key !== 'email' || email(user[key])), 'AUTHORIZATION_AUTH_PROFILE_INVALID');
    const providerIds = new Set();
    for (const provider of user.providerData) {
      demand(plain(provider) && typeof provider.providerId === 'string' && provider.providerId.length > 0 && id(provider.uid) && !providerIds.has(provider.providerId), 'AUTHORIZATION_AUTH_PROVIDER_AMBIGUOUS');
      providerIds.add(provider.providerId);
      demand(Object.keys(provider).every(k => ['providerId', 'uid', 'email', 'displayName', 'photoURL'].includes(k)), 'AUTHORIZATION_AUTH_PROVIDER_UNEXPECTED_FIELD');
      for (const key of ['email', 'displayName', 'photoURL']) if (Object.hasOwn(provider, key)) demand(typeof provider[key] === 'string' && (key !== 'email' || email(provider[key])), 'AUTHORIZATION_AUTH_PROVIDER_PROFILE_INVALID');
      if (provider.providerId === 'google.com') { demand(!googleOwners.has(provider.uid), 'AUTHORIZATION_GOOGLE_UID_COLLISION'); googleOwners.set(provider.uid, user.uid); }
    }
    for (const address of new Set([user.email, ...user.providerData.map(p => p.email)].filter(email).map(v => v.toLowerCase()))) {
      const owners = emailOwners.get(address) || new Set(); owners.add(user.uid); emailOwners.set(address, owners);
    }
    authUsers.set(user.uid, user);
  }
  demand(authUsers.size === mappings.size, 'AUTHORIZATION_AUTH_MAPPING_INCOMPLETE');
  const authClass = user => user.providerData.length === 0 && user.disabled === false && user.emailVerified === false ? 'DEFER_UNLINKED_SOURCE_CAPTURE_ONLY'
    : user.providerData.length === 1 && user.providerData[0].providerId === 'google.com' && user.emailVerified === true && user.disabled === false ? 'VERIFIED_GOOGLE_CAPTURE_ONLY' : 'SOURCE_AUTH_REQUIRES_REVIEW';
  const profileEvidence = [...profiles.values()].map(row => ({sourceDocumentSha256: row.sourceDocumentSha256, faUid: row.id, role: row.data.role,
    active: row.data.active, access: row.data.access, permissions: copy(row.data.permissions), profileVersion: row.data.version ?? null,
    profileMemberIdPresent: Object.hasOwn(row.data, 'memberId'), adminPredicateInCapture: row.data.active && row.data.access && (row.data.role === 'administrador_app' || row.data.permissions.admin === true),
    authRecordSha256: authSourceRecordDigest(authUsers.get(row.id)), sourceAuthClassification: authClass(authUsers.get(row.id))}));
  const identityCandidates = sorted(mappings.keys()).map(uid => ({candidateKind: 'IDENTITY_MAPPING_REVIEW', faUid: uid, proposedFbUid: mappings.get(uid).fbUid,
    proposedMemberId: mappings.get(uid).memberId, sourceAuthClassification: authClass(authUsers.get(uid)), accountCreationProposed: false, loginAuthorized: false, active: false, access: false}));
  const areaMap = new Map(), areaEvidence = [], membershipCandidates = [];
  for (const row of collections.get('managementAreas')) {
    const a = row.data;
    demand(a.id === row.id && id(a.id, 200) && typeof a.active === 'boolean' && positiveVersion(row), 'AUTHORIZATION_AREA_INVALID');
    const managers = uidList(a.managerUids, mappings, 'AUTHORIZATION_AREA_MANAGER_INVALID'), members = uidList(a.memberUids, mappings, 'AUTHORIZATION_AREA_MEMBER_INVALID');
    demand(plain(a.permissions) && Object.values(a.permissions).every(v => typeof v === 'boolean'), 'AUTHORIZATION_AREA_PERMISSIONS_INVALID');
    areaMap.set(a.id, row);
    areaEvidence.push({sourceClassificationAction: classification.get(row.path), areaId: a.id, active: a.active, version: a.version, managerUids: managers, memberUids: members, permissions: copy(a.permissions), sourceDocumentSha256: row.sourceDocumentSha256});
    for (const [kind, uids] of [['MANAGER', managers], ['MEMBER', members]]) for (const uid of uids) {
      const p = profiles.get(uid).data;
      const sourceDenials = [];
      if (!a.active) sourceDenials.push('SOURCE_AREA_INACTIVE');
      if (!p.active || !p.access) sourceDenials.push('SOURCE_PROFILE_INACTIVE_OR_NO_ACCESS');
      if (authClass(authUsers.get(uid)) !== 'VERIFIED_GOOGLE_CAPTURE_ONLY') sourceDenials.push('SOURCE_GOOGLE_IDENTITY_NOT_CONFIRMED');
      membershipCandidates.push({candidateKind: 'EXPLICIT_AREA_RELATION_REVIEW', sourceClassificationAction: classification.get(row.path), destinationCandidateRequestedByManifest: classification.get(row.path) === 'COPY', areaId: a.id, relation: kind, faUid: uid, proposedMemberId: mappings.get(uid).memberId,
        areaVersion: a.version, sourceDenials, membershipEffective: false, createsPermission: false, sourceDocumentSha256: row.sourceDocumentSha256});
    }
  }
  const aclMap = new Map(), aclEvidence = [], bindings = new Map();
  for (const row of collections.get('documentAccessEmails')) {
    const a = row.data;
    demand(exact(a, ['id', 'email', 'groups', 'active', 'version', 'createdByUid', 'updatedByUid', 'createdAt', 'updatedAt']) && email(a.email)
      && a.email === a.email.toLowerCase() && a.email === row.id && a.id === row.id && typeof a.active === 'boolean' && positiveVersion(row), 'AUTHORIZATION_ACL_SCHEMA_INVALID');
    const groups = groupList(a.groups, 'AUTHORIZATION_ACL_GROUP_INVALID');
    demand(!a.active || groups.length > 0, 'AUTHORIZATION_ACL_ACTIVE_EMPTY');
    demand(id(a.createdByUid) && id(a.updatedByUid) && mappings.has(a.createdByUid) && mappings.has(a.updatedByUid), 'AUTHORIZATION_ACL_ACTOR_UNMAPPED');
    demand((emailOwners.get(a.email)?.size || 0) <= 1, 'AUTHORIZATION_ACL_EMAIL_AMBIGUOUS');
    aclMap.set(row.path, row);
    aclEvidence.push({sourceDocumentSha256: row.sourceDocumentSha256, active: a.active, groups, version: a.version, classification: 'CAPTURED_INTENT_ONLY'});
  }
  for (const proof of aclBindings) {
    demand(exact(proof, ['schemaVersion', 'path', 'sourceDocumentSha256', 'faUid', 'googleUid', 'authRecordSha256', 'classification']) && proof.schemaVersion === 1
      && proof.classification === 'CAPTURED_INTENT_ONLY' && aclMap.has(proof.path) && mappings.has(proof.faUid) && !bindings.has(proof.path), 'AUTHORIZATION_ACL_BINDING_INVALID');
    const row = aclMap.get(proof.path), user = authUsers.get(proof.faUid), provider = user.providerData[0];
    demand(authClass(user) === 'VERIFIED_GOOGLE_CAPTURE_ONLY' && proof.googleUid === provider.uid && proof.authRecordSha256 === authSourceRecordDigest(user)
      && proof.sourceDocumentSha256 === row.sourceDocumentSha256 && email(user.email) && email(provider.email)
      && user.email.toLowerCase() === row.data.email && provider.email.toLowerCase() === row.data.email && emailOwners.get(row.data.email)?.size === 1
      && emailOwners.get(row.data.email)?.has(proof.faUid), 'AUTHORIZATION_ACL_BINDING_PROOF_MISMATCH');
    bindings.set(proof.path, proof);
  }
  const aclIntents = [...aclMap.values()].map(row => {
    const proof = bindings.get(row.path), p = proof && profiles.get(proof.faUid).data;
    return {candidateKind: 'DOCUMENT_ACL_INTENT_REVIEW', sourceDocumentSha256: row.sourceDocumentSha256, sourceVersion: row.data.version,
      intendedGroups: groupList(row.data.groups, 'AUTHORIZATION_ACL_GROUP_INVALID'), sourceActive: row.data.active,
      binding: proof ? {faUid: proof.faUid, googleUid: proof.googleUid, proposedMemberId: mappings.get(proof.faUid).memberId, proofSha256: snapshotDigest(proof)} : null,
      sourceProfileDenied: proof ? !p.active || !p.access : null, unresolved: !proof, grantEffective: false, active: false, access: false};
  });
  const audienceEvidence = [], contentCandidates = [];
  for (const collection of ['documents', 'scopedDocuments']) for (const row of collections.get(collection)) {
    const d = row.data;
    demand(areaMap.has(d.managementAreaId) && typeof d.active === 'boolean' && positiveVersion(row), 'AUTHORIZATION_CONTENT_INVALID');
    const groups = collection === 'scopedDocuments' ? groupList([d.audienceGroup], 'AUTHORIZATION_CONTENT_AUDIENCE_INVALID') : [];
    demand(collection !== 'documents' || !Object.hasOwn(d, 'audienceGroup'), 'AUTHORIZATION_LEGACY_AUDIENCE_REQUIRES_ADAPTER');
    audienceEvidence.push({sourceClassificationAction: classification.get(row.path), sourceDocumentSha256: row.sourceDocumentSha256, collection, areaId: d.managementAreaId, active: d.active, version: d.version, sourceGroups: groups});
    contentCandidates.push({candidateKind: 'CONTENT_AUDIENCE_REVIEW', sourceClassificationAction: classification.get(row.path), destinationCandidateRequestedByManifest: classification.get(row.path) === 'COPY', sourceDocumentSha256: row.sourceDocumentSha256, collection, areaId: d.managementAreaId,
      intendedGroups: groups, classification: collection === 'documents' ? 'LEGACY_AUDIENCE_UNSPECIFIED' : 'EXPLICIT_SOURCE_GROUP', accessEffective: false});
  }
  const activityMap = new Map(collections.get('evaluationActivities').map(row => [row.id, row])), evaluationEvidence = [], evaluationCandidates = [];
  const paired = new Set();
  for (const c of collections.get('evaluationFormConfigs')) {
    const a = activityMap.get(c.data.activityId || c.data.evaluationActivityId || c.id);
    demand(a && !paired.has(a.id), 'AUTHORIZATION_EVALUATION_PAIR_MISSING_OR_DUPLICATE'); paired.add(a.id);
    const cg = groupList(c.data.eligibleGroups, 'AUTHORIZATION_EVALUATION_GROUP_INVALID'), ag = groupList(a.data.eligibleGroups, 'AUTHORIZATION_EVALUATION_GROUP_INVALID');
    const cu = uidList(c.data.eligibleUids, mappings, 'AUTHORIZATION_EVALUATION_UID_INVALID'), au = uidList(a.data.eligibleUids, mappings, 'AUTHORIZATION_EVALUATION_UID_INVALID');
    demand(same(cg, ag) && same(cu, au) && (cg.length > 0 || cu.length > 0) && c.data.managerAreaId === a.data.managerAreaId && areaMap.has(c.data.managerAreaId), 'AUTHORIZATION_EVALUATION_ELIGIBILITY_CONFLICT');
    demand(positiveVersion(c) && positiveVersion(a) && typeof c.data.status === 'string' && c.data.status === a.data.status, 'AUTHORIZATION_EVALUATION_VERSION_OR_STATUS_INVALID');
    const ch = c.data.publishedAudienceHash ?? null, ah = a.data.publishedAudienceHash ?? null;
    demand(ch === ah && (ch === null || digest(ch)), 'AUTHORIZATION_EVALUATION_AUDIENCE_HASH_INVALID');
    const publicationMarkerPresent = ch !== null && typeof c.data.accessVerifiedAt === 'string';
    evaluationEvidence.push({configClassificationAction: classification.get(c.path), activityClassificationAction: classification.get(a.path), configDocumentSha256: c.sourceDocumentSha256, activityDocumentSha256: a.sourceDocumentSha256, areaId: c.data.managerAreaId,
      eligibleGroups: cg, eligibleUids: cu, status: c.data.status, configVersion: c.data.version, activityVersion: a.data.version,
      publishedAudienceHash: ch, historicalPublicationMarkerPresent: publicationMarkerPresent, markerCertifiesCurrentAcl: false});
    evaluationCandidates.push({candidateKind: 'EVALUATION_AUDIENCE_REVIEW', configClassificationAction: classification.get(c.path), activityClassificationAction: classification.get(a.path), destinationCandidateRequestedByManifest: classification.get(c.path) === 'COPY' && classification.get(a.path) === 'COPY', configDocumentSha256: c.sourceDocumentSha256, activityDocumentSha256: a.sourceDocumentSha256,
      intendedGroups: cg, intendedMemberIds: cu.map(uid => mappings.get(uid).memberId), accessEffective: false, runtimeActivation: false, triggerActivation: false});
  }
  demand(paired.size === activityMap.size, 'AUTHORIZATION_EVALUATION_UNPAIRED_ACTIVITY');
  const blockers = [{code: 'SURFACES_DENIED_BY_PREVIEW_POLICY'}, {code: 'CURRENT_AUTH_AND_REVOCATION_REQUIRED'}, {code: 'VERSIONED_AUTHORIZATION_AUTHORITY_NOT_INSTALLED'},
    {code: 'SOURCE_AUTH_AND_FIRESTORE_CAPTURE_NOT_ATOMIC'}, {code: 'REAL_ACL_AND_BROKER_INTEGRATION_REQUIRED'}, {code: 'PER_PROJECT_FRESH_BUDGET_REQUIRED'}];
  if (!sourceSnapshot.coverage.rootCollections.includes('notificationGroups')) blockers.push({code: 'NOTIFICATION_GROUP_SCOPE_NOT_CAPTURED'});
  if (profiles.size && profileEvidence.some(p => p.profileVersion === null)) blockers.push({code: 'PROFILE_AUTHORIZATION_VERSION_UNAVAILABLE'});
  if (aclIntents.some(a => a.unresolved)) blockers.push({code: 'ACL_INTENT_HAS_NO_VERIFIED_GOOGLE_BINDING', count: aclIntents.filter(a => a.unresolved).length});
  if (evaluationEvidence.some(a => a.status !== 'READY')) blockers.push({code: 'EVALUATION_CONFIGURATION_NOT_READY', count: evaluationEvidence.filter(a => a.status !== 'READY').length});
  const featureEvidence = sourceSnapshot.documents.filter(d => d.path.split('/')[0] === 'appConfig').map(d => {
    const r = record(d), data = r.data, candidates = [];
    for (const [field, value] of Object.entries(data)) if (['management', 'trainings'].includes(field)) candidates.push({field, state: typeof value === 'boolean' ? value : 'INVALID_NOT_BOOLEAN'});
    for (const container of ['features', 'featureFlags', 'modules']) if (plain(data[container])) for (const field of ['management', 'trainings']) if (Object.hasOwn(data[container], field)) candidates.push({field: container + '.' + field, state: typeof data[container][field] === 'boolean' ? data[container][field] : 'INVALID_NOT_BOOLEAN'});
    return {sourcePath: r.path, sourceDocumentSha256: r.sourceDocumentSha256, knownSurfaceFlags: candidates.sort((a, b) => lexical(a.field, b.field)), absentFlagNames: ['management', 'trainings'].filter(name => !candidates.some(c => c.field === name || c.field.endsWith('.' + name)))};
  });
  const output = {schemaVersion: 1, mode: 'PRIVATE_OFFLINE_AUTHORIZATION_PREVIEW', previewOnly: true, productionAuthorized: false, authorizationReady: false,
    writeEnabled: false, inputPins: copy(computedPins), sourceProjectId: FA, destinationProjectId: FB, policy: copy(policy),
    surfaces: {management: false, performance: false}, grants: [], leases: [], runtimeContexts: [], authImportRecords: [],
    readiness: {structuralPreviewOnly: true, operationalFreshnessEvaluated: false, identityMappingsAreApprovedBindings: false, aclIntentIsAccessGrant: false},
    sourceEvidence: {sourceReadTime: sourceSnapshot.readTime, authReadTime: sourceAuth.readTime, capturesAreAtomicTogether: false,
      profiles: profileEvidence, areas: areaEvidence, acl: aclEvidence, contentAudience: audienceEvidence, evaluationAudience: evaluationEvidence, appFeatureFlags: featureEvidence},
    proposals: {identityCandidates, membershipCandidates, aclIntents, contentCandidates, evaluationCandidates}, blockers,
    counts: {profiles: profiles.size, mappings: mappings.size, authClassifications: count(identityCandidates, row => row.sourceAuthClassification),
      observedAdminFlagsOrRole: profileEvidence.filter(p => p.role === 'administrador_app' || p.permissions.admin === true).length, capturedAdminPredicates: profileEvidence.filter(p => p.adminPredicateInCapture).length, areas: areaMap.size, memberships: membershipCandidates.length,
      deniedMembershipEvidence: membershipCandidates.filter(m => m.sourceDenials.length > 0).length, aclRecords: aclEvidence.length, aclProofBindings: bindings.size,
      unresolvedAclIntents: aclIntents.filter(a => a.unresolved).length, boundAclDeniedByProfile: aclIntents.filter(a => a.sourceProfileDenied === true).length,
      legacyContent: contentCandidates.filter(c => c.collection === 'documents').length, scopedContent: contentCandidates.filter(c => c.collection === 'scopedDocuments').length,
      evaluationPairs: evaluationCandidates.length, evaluationStatuses: count(evaluationEvidence, row => row.status),
      effectivePermissions: 0, effectiveMemberships: 0, effectiveAclGrants: 0, authorizedFbContexts: 0, authImports: 0},
    effects: {firestoreReadsIssued: 0, firestoreWritesIssued: 0, authChangesIssued: 0, triggersActivated: 0}};
  output.resultSha256 = managementAuthorizationPreviewDigest(output);
  return output;
}
