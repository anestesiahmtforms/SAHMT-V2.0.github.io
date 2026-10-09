import {snapshotDigest, documentDigest} from './management-split-plan.js';
import {authSourceRecordDigest} from './management-auth-import-plan.js';
import {buildManagementAuthorizationPreview, managementAuthorizationPreviewDigest} from './management-authorization-preview.js';

// Pure, private offline review. No clock, SDK, credential, apply or runtime adapter.
const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
const SCOPE = 'APPLICATION_AUTHORIZATION_ONLY_NOT_PROJECT_IAM';
const ALIASES = ['ADMINISTRATOR_DESIGNATED', 'PERMISSIONS_EXCEPTION'];
const FLAGS = ['productionAuthorized', 'authorizationReady'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const demand = (ok, code) => { if (!ok) throw Error(code); };
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => snapshotDigest(a) === snapshotDigest(b);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function json(value, depth = 0, state = {seen: new Set(), nodes: 0, chars: 0}) {
  demand(depth <= 80 && ++state.nodes <= 1000000, 'ROLE_POLICY_JSON_LIMIT');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { state.chars += value.length; demand(state.chars <= 16777216, 'ROLE_POLICY_JSON_LIMIT'); return; }
  if (typeof value === 'number') { demand(Number.isFinite(value), 'ROLE_POLICY_JSON_NUMBER_INVALID'); return; }
  demand(Array.isArray(value) || plain(value), 'ROLE_POLICY_INPUT_NOT_PLAIN_JSON');
  demand(!state.seen.has(value), 'ROLE_POLICY_JSON_CYCLE'); state.seen.add(value);
  const keys = Reflect.ownKeys(value);
  demand(keys.length === Object.keys(value).length + (Array.isArray(value) ? 1 : 0) && keys.every(key => typeof key === 'string'), 'ROLE_POLICY_JSON_HIDDEN_PROPERTY');
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    demand(desc?.enumerable === true && Object.hasOwn(desc, 'value'), 'ROLE_POLICY_JSON_ACCESSOR');
    if (Array.isArray(value)) demand(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length, 'ROLE_POLICY_JSON_ARRAY_PROPERTY');
    state.chars += key.length; demand(state.chars <= 16777216, 'ROLE_POLICY_JSON_LIMIT');
    json(desc.value, depth + 1, state);
  }
  if (Array.isArray(value)) demand(Object.keys(value).length === value.length, 'ROLE_POLICY_JSON_SPARSE_ARRAY');
  state.seen.delete(value);
}
function decode(value) {
  if (Object.hasOwn(value, 'mapValue')) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  if (Object.hasOwn(value, 'arrayValue')) return (value.arrayValue.values || []).map(decode);
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue);
  return Object.values(value)[0];
}
const data = row => Object.fromEntries(Object.entries(row.fields).map(([key, value]) => [key, decode(value)]));
const adminPredicate = profile => profile.active === true && profile.access === true && (profile.role === 'administrador_app' || profile.permissions.admin === true);
const noEffects = value => exact(value, ['firestoreReadsIssued', 'firestoreWritesIssued', 'authChangesIssued', 'triggersActivated']) && Object.values(value).every(v => v === 0);
const noSurfaces = value => exact(value, ['management', 'performance']) && value.management === false && value.performance === false;
const zeroArray = value => Array.isArray(value) && value.length === 0;
function validatePolicy(intent) {
  const keys = ['schemaVersion', 'mode', 'productionAuthorized', 'authorizationReady', 'instructionSource', 'sourceProjectId', 'destinationProjectId', 'sourcePins', 'sourceReadTime', 'authReadTime', 'operationalFreshnessEvaluated', 'capturesAtomicTogether', 'designations', 'generalUserPolicyIntent', 'preservedArtifacts', 'policyOverlayImplemented', 'surfaces', 'grants', 'leases', 'runtimeContexts', 'authImportRecords', 'gates', 'effects', 'previousIntentSha256', 'authorizationScope', 'policyRefinement'];
  demand(exact(intent, keys), 'ROLE_POLICY_HUMAN_INTENT_SCHEMA_INVALID');
  demand(intent.schemaVersion === 1 && intent.mode === 'PRIVATE_HUMAN_IDENTITY_AND_PERMISSION_INTENT_V2_ONLY' && intent.instructionSource === 'HUMAN_USER_MESSAGE_RELAYED_BY_PARENT_CURRENT_SESSION', 'ROLE_POLICY_HUMAN_INTENT_ENUM_INVALID');
  demand(intent.sourceProjectId === FA && intent.destinationProjectId === FB && intent.authorizationScope === SCOPE, 'ROLE_POLICY_PROJECT_OR_SCOPE_INVALID');
  demand(FLAGS.every(key => intent[key] === false) && intent.policyOverlayImplemented === false && intent.operationalFreshnessEvaluated === false && intent.capturesAtomicTogether === false, 'ROLE_POLICY_HUMAN_AUTHORITY_MUST_REMAIN_FALSE');
  demand(noSurfaces(intent.surfaces) && noEffects(intent.effects) && ['grants', 'leases', 'runtimeContexts', 'authImportRecords'].every(key => zeroArray(intent[key])), 'ROLE_POLICY_EFFECTS_NOT_EMPTY');
  demand(digest(intent.previousIntentSha256), 'ROLE_POLICY_PREVIOUS_INTENT_HASH_INVALID');
  demand(exact(intent.preservedArtifacts, ['source', 'auth', 'manifest', 'review', 'previewInputs', 'preview']) && Object.values(intent.preservedArtifacts).every(value => typeof value === 'string' && /^[A-Za-z0-9._-]+\.dpapi\.json$/.test(value)), 'ROLE_POLICY_ARTIFACT_REFERENCE_INVALID');
  const expectedGates = ['EXCLUSIVE_APPLICATION_ROLE_POLICY_OVERLAY_AND_TESTS_REQUIRED', 'PRESERVED_EXCEPTION_ROLE_PERMISSIONS_ACL_PARITY_REQUIRED', 'COMMON_USERS_OPERATIONAL_AND_PROFESSIONAL_RIGHTS_PRESERVATION_REQUIRED', 'HISTORICAL_ROLE_MANAGER_DIFF_RECONCILIATION_REQUIRED', 'CURRENT_AUTH_REVOCATION_PROFILE_AND_ACL_REQUIRED', 'CANONICAL_BINDING_PERSISTENCE_REQUIRED', 'NO_ACTIVATION_BY_THIS_INTENT'];
  demand(Array.isArray(intent.gates) && intent.gates.length === expectedGates.length && new Set(intent.gates).size === intent.gates.length && intent.gates.every(code => expectedGates.includes(code)), 'ROLE_POLICY_HUMAN_GATES_INVALID');
  const general = intent.generalUserPolicyIntent;
  demand(exact(general, ['classification', 'applicationAuthorizationClassificationOnly', 'preserveProfessionalFunctions', 'preserveOperationalPermissions', 'preserveContentEligibility', 'permissionsNotEnumeratedByThisProof', 'noAutomaticRoleReset', 'deltaComputed', 'overlayComputed', 'authorityCalculated', 'effectiveGrants'])
    && general.classification === 'COMMON_USERS_EXCEPT_PRESERVED_EXCEPTION'
    && ['applicationAuthorizationClassificationOnly', 'preserveProfessionalFunctions', 'preserveOperationalPermissions', 'preserveContentEligibility', 'permissionsNotEnumeratedByThisProof', 'noAutomaticRoleReset'].every(key => general[key] === true)
    && ['deltaComputed', 'overlayComputed', 'authorityCalculated', 'effectiveGrants'].every(key => general[key] === false), 'ROLE_POLICY_GENERAL_INTENT_INVALID');
  const refine = intent.policyRefinement;
  demand(exact(refine, ['administratorExclusive', 'commonUserClassificationDoesNotResetProfessionalRole', 'preserveProfessionalFunctions', 'preserveOperationalPermissions', 'preserveContentEligibility', 'applicationAdministratorIsProjectIamOwner', 'adminNeedsEveryAreaManagerAssignment', 'deltaComputed', 'overlayComputed', 'runtimeAuthorityCalculated', 'historicalRoleOrManagerDifferencesMustBeReconciledBeforeActivation'])
    && ['administratorExclusive', 'commonUserClassificationDoesNotResetProfessionalRole', 'preserveProfessionalFunctions', 'preserveOperationalPermissions', 'preserveContentEligibility', 'historicalRoleOrManagerDifferencesMustBeReconciledBeforeActivation'].every(key => refine[key] === true)
    && ['applicationAdministratorIsProjectIamOwner', 'adminNeedsEveryAreaManagerAssignment', 'deltaComputed', 'overlayComputed', 'runtimeAuthorityCalculated'].every(key => refine[key] === false), 'ROLE_POLICY_REFINEMENT_INVALID');
}
function validateDesignation(designation, context) {
  const {docs, auth, mappings, areas, preview} = context;
  demand(exact(designation, ['alias', 'requestedEmail', 'faUid', 'googleUid', 'proposedMemberId', 'sourceAuthRecordSha256', 'sourceProfileSha256', 'mappingSha256', 'sourceAclSha256', 'uniqueness', 'observed', 'requestedPolicy', 'productionAuthorized', 'authorizationReady', 'loginAuthorized', 'effectiveGrant'])
    && ALIASES.includes(designation.alias), 'ROLE_POLICY_DESIGNATION_SCHEMA_INVALID');
  demand(['productionAuthorized', 'authorizationReady', 'loginAuthorized', 'effectiveGrant'].every(key => designation[key] === false), 'ROLE_POLICY_DESIGNATION_EFFECT_NOT_FALSE');
  const user = auth.get(designation.faUid), profileRow = docs.get('users/' + designation.faUid), mapping = mappings.get(designation.faUid);
  demand(user && profileRow && mapping && mapping.fbUid === designation.faUid && mapping.memberId === designation.proposedMemberId, 'ROLE_POLICY_DESIGNATION_IDENTITY_MISMATCH');
  demand(typeof designation.requestedEmail === 'string' && designation.requestedEmail === designation.requestedEmail.toLowerCase(), 'ROLE_POLICY_DESIGNATION_EMAIL_INVALID');
  const aclRow = docs.get('documentAccessEmails/' + designation.requestedEmail);
  const owners = [...auth.values()].filter(row => row.email?.toLowerCase() === designation.requestedEmail);
  const googleOwners = [...auth.values()].flatMap(row => row.providerData).filter(provider => provider.providerId === 'google.com' && provider.uid === designation.googleUid);
  const provider = user.providerData[0];
  demand(owners.length === 1 && owners[0].uid === designation.faUid && googleOwners.length === 1 && user.emailVerified === true && user.disabled === false && user.providerData.length === 1 && provider.providerId === 'google.com' && provider.uid === designation.googleUid && provider.email?.toLowerCase() === designation.requestedEmail && aclRow, 'ROLE_POLICY_CAPTURED_GOOGLE_BINDING_INVALID');
  demand(designation.sourceAuthRecordSha256 === authSourceRecordDigest(user) && designation.sourceProfileSha256 === documentDigest(profileRow) && designation.mappingSha256 === snapshotDigest(mapping) && designation.sourceAclSha256 === documentDigest(aclRow), 'ROLE_POLICY_DESIGNATION_RECORD_PIN_MISMATCH');
  const profile = data(profileRow), acl = data(aclRow), observed = designation.observed;
  demand(exact(observed, ['role', 'permissions', 'active', 'access', 'roleIsAdministrator', 'explicitAdminPermission', 'adminPredicateWithFlags', 'acl', 'managedAreaEvidence'])
    && observed.role === profile.role && same(observed.permissions, profile.permissions) && observed.active === profile.active && observed.access === profile.access
    && observed.roleIsAdministrator === (profile.role === 'administrador_app') && observed.explicitAdminPermission === (profile.permissions.admin === true) && observed.adminPredicateWithFlags === adminPredicate(profile)
    && exact(observed.acl, ['active', 'groups', 'version']) && observed.acl.active === acl.active && same(observed.acl.groups, acl.groups) && observed.acl.version === aclRow.fields.version.integerValue, 'ROLE_POLICY_CAPTURED_RIGHTS_MISMATCH');
  const managerEvidence = areas.filter(row => row.data.managerUids.includes(designation.faUid)).map(row => ({areaId: row.data.id, version: row.data.version, sourceDocumentSha256: documentDigest(row.doc)})).sort((a,b) => lexical(a.areaId,b.areaId));
  // Firestore REST serializes INT64 as a decimal string. Preserve the typed
  // captured version while accepting the equivalent safe offline numeric form.
  const canonicalAreaVersion = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
    ? value : Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  demand(Array.isArray(observed.managedAreaEvidence) && observed.managedAreaEvidence.every(row =>
    exact(row, ['areaId', 'version', 'sourceDocumentSha256']) && canonicalAreaVersion(row.version) !== null)
    && same(observed.managedAreaEvidence.map(row => ({...row, version: canonicalAreaVersion(row.version)})),
      managerEvidence.map(row => ({...row, version: canonicalAreaVersion(row.version)}))), 'ROLE_POLICY_AREA_EVIDENCE_MISMATCH');
  demand(exact(designation.uniqueness, ['authEmailMatches', 'googleUidMatches', 'uidRosterMatches', 'mappingMatches', 'aclMatches', 'linkedRosterCounts'])
    && ['authEmailMatches', 'googleUidMatches', 'uidRosterMatches', 'mappingMatches', 'aclMatches'].every(key => designation.uniqueness[key] === 1), 'ROLE_POLICY_UNIQUENESS_INVALID');
  const rosterCounts = {users: [...docs.values()].filter(row => row.path === 'users/' + designation.faUid && row.fields.uid?.stringValue === designation.faUid).length, contacts: [...docs.values()].filter(row => row.path.startsWith('contacts/') && row.fields.uid?.stringValue === designation.faUid).length, eventMembers: [...docs.values()].filter(row => row.path.startsWith('eventMembers/') && row.fields.uid?.stringValue === designation.faUid).length};
  demand(exact(designation.uniqueness.linkedRosterCounts, ['users', 'contacts', 'eventMembers']) && same(designation.uniqueness.linkedRosterCounts, rosterCounts), 'ROLE_POLICY_LINKED_ROSTER_EVIDENCE_MISMATCH');
  const binding = preview.proposals.aclIntents.find(row => row.sourceDocumentSha256 === documentDigest(aclRow))?.binding;
  demand(binding?.faUid === designation.faUid && binding.googleUid === designation.googleUid && binding.proposedMemberId === mapping.memberId, 'ROLE_POLICY_PREVIEW_ACL_BINDING_MISMATCH');
  if (designation.alias === 'ADMINISTRATOR_DESIGNATED') {
    demand(exact(designation.requestedPolicy, ['intent', 'administratorExclusive', 'scope', 'permissionGrantsComputed', 'roleIsNotProfessionalFunctionReset', 'projectIamOwnershipProposed', 'requireTwelveAreaAssignments', 'requiresFuturePolicyOverlay'])
      && designation.requestedPolicy.intent === 'EXCLUSIVE_DESIGNATED_ADMINISTRATOR_AND_MANAGER_ALL_APP_PROCESSES'
      && designation.requestedPolicy.administratorExclusive === true && designation.requestedPolicy.scope === SCOPE && designation.requestedPolicy.roleIsNotProfessionalFunctionReset === true
      && designation.requestedPolicy.projectIamOwnershipProposed === false && designation.requestedPolicy.requireTwelveAreaAssignments === false && designation.requestedPolicy.permissionGrantsComputed === false && designation.requestedPolicy.requiresFuturePolicyOverlay === true, 'ROLE_POLICY_EXCLUSIVE_ADMIN_INTENT_INVALID');
  } else {
    const policy = designation.requestedPolicy;
    demand(exact(policy, ['intent', 'preservedRole', 'preservedPermissions', 'preservedAclDocument', 'preservedSourceProfileSha256', 'preservedSourceAclSha256', 'preserveCurrentDeniedFlags', 'permissionGrantsComputed'])
      && policy.intent === 'PRESERVE_CAPTURED_ROLE_PERMISSIONS_AND_ACL_EXACTLY' && policy.preservedRole === profile.role && same(policy.preservedPermissions, profile.permissions)
      && same(policy.preservedAclDocument, aclRow) && policy.preservedSourceProfileSha256 === documentDigest(profileRow) && policy.preservedSourceAclSha256 === documentDigest(aclRow)
      && policy.preserveCurrentDeniedFlags === true && policy.permissionGrantsComputed === false, 'ROLE_POLICY_EXCEPTION_PRESERVATION_INVALID');
    // Even a currently denied administrator role conflicts with exclusive intent.
    demand(profile.role !== 'administrador_app' && profile.permissions.admin !== true, 'ROLE_POLICY_EXCEPTION_ADMIN_EXCLUSIVITY_CONFLICT');
  }
  return {profile, profileRow, mapping, aclRow};
}
export function managementRolePolicyPlanDigest(plan) { json(plan); const value = copy(plan); delete value.resultSha256; return snapshotDigest(value); }
export function buildManagementRolePolicyPlan(input) {
  json(input);
  demand(exact(input, ['previewInput', 'preview', 'humanIntent', 'pins']), 'ROLE_POLICY_INPUT_SCHEMA_INVALID');
  const {previewInput, preview, humanIntent, pins} = input;
  demand(exact(pins, ['previewInputSha256', 'previewSha256', 'humanIntentSha256']) && Object.values(pins).every(digest), 'ROLE_POLICY_INPUT_PINS_INVALID');
  demand(snapshotDigest(previewInput) === pins.previewInputSha256 && managementAuthorizationPreviewDigest(preview) === pins.previewSha256 && preview.resultSha256 === pins.previewSha256 && snapshotDigest(humanIntent) === pins.humanIntentSha256, 'ROLE_POLICY_INPUT_PIN_MISMATCH');
  const regenerated = buildManagementAuthorizationPreview(previewInput);
  demand(same(regenerated, preview), 'ROLE_POLICY_PREVIEW_REGENERATION_MISMATCH');
  validatePolicy(humanIntent);
  const sourcePins = {sourceSnapshotSha256: previewInput.pins.sourceSnapshotSha256, sourceAuthSha256: previewInput.pins.sourceAuthSha256, manifestSha256: previewInput.pins.manifestSha256, identityMappingsSha256: previewInput.pins.identityMappingsSha256, priorPreviewSha256: preview.resultSha256};
  demand(exact(humanIntent.sourcePins, Object.keys(sourcePins)) && same(humanIntent.sourcePins, sourcePins) && humanIntent.sourceReadTime === previewInput.sourceSnapshot.readTime && humanIntent.authReadTime === previewInput.sourceAuth.readTime, 'ROLE_POLICY_HUMAN_SOURCE_PIN_MISMATCH');
  demand(Array.isArray(humanIntent.designations) && humanIntent.designations.length === 2 && new Set(humanIntent.designations.map(row => row.alias)).size === 2 && new Set(humanIntent.designations.map(row => row.faUid)).size === 2, 'ROLE_POLICY_DESIGNATIONS_NOT_DISTINCT');
  const docs = new Map(previewInput.sourceSnapshot.documents.map(row => [row.path, row]));
  const auth = new Map(previewInput.sourceAuth.users.map(row => [row.uid, row]));
  const mappings = new Map(previewInput.manifest.identityMappings.map(row => [row.faUid, row]));
  const areas = previewInput.sourceSnapshot.documents.filter(row => row.path.startsWith('managementAreas/')).map(doc => ({doc, data: data(doc)}));
  const designated = new Map();
  for (const designation of humanIntent.designations) designated.set(designation.alias, {...validateDesignation(designation, {docs, auth, mappings, areas, preview}), designation});
  const adminUid = designated.get('ADMINISTRATOR_DESIGNATED').designation.faUid;
  const exceptionUid = designated.get('PERMISSIONS_EXCEPTION').designation.faUid;
  const gates = [];
  const add = (code, count) => gates.push(count === undefined ? {code} : {code, count});
  for (const code of ['SURFACES_REMAIN_DISABLED', 'CURRENT_IDENTITY_AND_REVOCATION_REQUIRED', 'SOURCE_CAPTURES_NOT_ATOMIC_OR_CURRENT_AUTHORITY', 'CANONICAL_MEMBER_BINDING_AND_VERSIONED_AUTHORITY_REQUIRED', 'ADMIN_ONLY_GATE_REQUIRES_BROKER_UI_RULES_PARITY', 'BROKER_MEMBERSHIP_OR_GROUP_ENTRY_POLICY_REQUIRES_RECONCILIATION', 'PROFESSIONAL_ROLE_MUST_NOT_BE_USED_AS_APPLICATION_POLICY', 'APPLICATION_WIDE_POLICY_OVERLAY_NOT_IMPLEMENTED', 'PER_PROJECT_FRESH_BUDGET_REQUIRED', 'HISTORICAL_RIGHTS_REQUIRE_REVALIDATION_BEFORE_ACTIVATION']) add(code);
  const entries = [...mappings.values()].sort((a,b) => lexical(a.faUid,b.faUid)).map(mapping => {
    const evidence = preview.sourceEvidence.profiles.find(row => row.faUid === mapping.faUid);
    const classification = mapping.faUid === adminUid ? 'EXCLUSIVE_ADMINISTRATOR' : mapping.faUid === exceptionUid ? 'PRESERVED_EXCEPTION' : 'COMMON_USER';
    const sourceDenials = [];
    if (evidence.active !== true || evidence.access !== true) sourceDenials.push('SOURCE_PROFILE_INACTIVE_OR_NO_ACCESS');
    if (evidence.sourceAuthClassification !== 'VERIFIED_GOOGLE_CAPTURE_ONLY') sourceDenials.push('SOURCE_GOOGLE_IDENTITY_NOT_CONFIRMED');
    const differences = [];
    if (classification === 'COMMON_USER' && (evidence.role === 'administrador_app' || evidence.permissions.admin === true)) differences.push('LEGACY_ADMIN_PREDICATE_REQUIRES_EXCLUSIVE_POLICY_RECONCILIATION');
    if (classification === 'COMMON_USER' && ['usersManage','peopleManage','managementManage','documentsManage','trainingsManage','financeManage'].some(key => evidence.permissions[key] === true)) differences.push('EXPLICIT_PRIVILEGED_MASK_REQUIRES_POLICY_RECONCILIATION');
    const relations = preview.proposals.membershipCandidates.filter(row => row.faUid === mapping.faUid);
    if (mapping.faUid !== adminUid && relations.some(row => row.relation === 'MANAGER')) differences.push('EXPLICIT_MANAGER_RELATION_DOES_NOT_AUTHORIZE_ADMIN_SURFACE');
    const acl = preview.proposals.aclIntents.filter(row => row.binding?.faUid === mapping.faUid);
    if (mapping.faUid !== adminUid && acl.length) differences.push('DOCUMENT_ELIGIBILITY_DOES_NOT_AUTHORIZE_ADMIN_SURFACE');
    return {faUid: mapping.faUid, proposedFbUid: mapping.fbUid, proposedMemberId: mapping.memberId,
      sourceEvidence: {sourceProfileSha256: evidence.sourceDocumentSha256, sourceAuthRecordSha256: evidence.authRecordSha256, role: evidence.role, permissions: copy(evidence.permissions), active: evidence.active, access: evidence.access, sourceAuthClassification: evidence.sourceAuthClassification, capturedProfileVersion: evidence.profileVersion, sourceCanonicalMemberIdPresent: evidence.profileMemberIdPresent},
      applicationPolicyIntent: {classification, scope: SCOPE, roleChangeProposed: false, permissionDeltaComputed: false, overlayComputed: false, administrativeIntent: classification === 'EXCLUSIVE_ADMINISTRATOR' ? 'ALL_APP_PROCESSES_EXCLUSIVE_ADMINISTRATOR' : classification === 'PRESERVED_EXCEPTION' ? 'PRESERVE_CAPTURED_ROLE_PERMISSIONS_AND_ACL_EXACTLY' : 'COMMON_USER_AUTHORIZATION_ONLY', professionalFunctionsPreserved: true, operationalPermissionsPreserved: true, contentEligibilityPreserved: true, sourceRoleUsedAsApplicationPolicy: false, allAreaManagerAssignmentsInvented: false},
      sourceDenials, differences, membershipEvidence: copy(relations), aclEvidence: copy(acl), accountCreationProposed: false, loginAuthorized: false, active: false, access: false, effectiveGrant: false};
  });
  const common = entries.filter(row => row.applicationPolicyIntent.classification === 'COMMON_USER');
  const legacyAdmin = common.filter(row => row.differences.includes('LEGACY_ADMIN_PREDICATE_REQUIRES_EXCLUSIVE_POLICY_RECONCILIATION')).length;
  const explicitMask = common.filter(row => row.differences.includes('EXPLICIT_PRIVILEGED_MASK_REQUIRES_POLICY_RECONCILIATION')).length;
  if (legacyAdmin) add('LEGACY_ADMIN_PREDICATE_REQUIRES_EXCLUSIVE_POLICY_RECONCILIATION', legacyAdmin);
  if (explicitMask) add('EXPLICIT_PRIVILEGED_MASK_REQUIRES_POLICY_RECONCILIATION', explicitMask);
  const outsideManagers = preview.proposals.membershipCandidates.filter(row => row.relation === 'MANAGER' && row.faUid !== adminUid).length;
  if (outsideManagers) add('EXPLICIT_MANAGER_RELATIONS_REQUIRE_SEPARATE_SCOPE_RECONCILIATION', outsideManagers);
  const denied = entries.filter(row => row.sourceDenials.includes('SOURCE_PROFILE_INACTIVE_OR_NO_ACCESS')).length;
  if (denied) add('SOURCE_DENIALS_MUST_REMAIN_DENIED', denied);
  const deferred = entries.filter(row => row.sourceEvidence.sourceAuthClassification === 'DEFER_UNLINKED_SOURCE_CAPTURE_ONLY').length;
  if (deferred) add('DEFERRED_IDENTITIES_HAVE_NO_ACCOUNT_OR_ACCESS', deferred);
  if (preview.counts.unresolvedAclIntents) add('UNRESOLVED_ACL_INTENTS_HAVE_NO_BINDING_OR_GRANT', preview.counts.unresolvedAclIntents);
  if (entries.some(row => row.sourceEvidence.capturedProfileVersion === null)) add('SOURCE_AUTHORIZATION_VERSION_ABSENT', entries.filter(row => row.sourceEvidence.capturedProfileVersion === null).length);
  if (entries.some(row => !row.sourceEvidence.sourceCanonicalMemberIdPresent)) add('CANONICAL_MEMBER_BINDING_ABSENT', entries.filter(row => !row.sourceEvidence.sourceCanonicalMemberIdPresent).length);
  const adminEvidence = entries.find(row => row.faUid === adminUid);
  if (adminEvidence.sourceDenials.length) add('DESIGNATED_ADMINISTRATOR_HAS_CAPTURED_DENIALS');
  if (!(adminEvidence.sourceEvidence.role === 'administrador_app' || adminEvidence.sourceEvidence.permissions.admin === true)) add('DESIGNATED_ADMINISTRATOR_GRANT_DELTA_NOT_COMPUTED');
  const output = {schemaVersion: 1, mode: 'PRIVATE_OFFLINE_ROLE_POLICY_RECONCILIATION', previewOnly: true, structurallyReviewed: true, productionAuthorized: false, authorizationReady: false, writeEnabled: false,
    inputPins: copy(pins), sourcePins: copy(sourcePins), previousIntentSha256: humanIntent.previousIntentSha256, previousIntentLineageRevalidated: false,
    sourceProjectId: FA, destinationProjectId: FB, sourceReadTime: humanIntent.sourceReadTime, authReadTime: humanIntent.authReadTime, capturesAtomicTogether: false, operationalFreshnessEvaluated: false,
    applicationPolicyIntent: {administratorExclusive: true, commonUsersExceptPreservedException: true, scope: SCOPE, professionalFunctionsPreserved: true, operationalPermissionsPreserved: true, contentEligibilityPreserved: true, deltaComputed: false, overlayComputed: false, runtimeAuthorityCalculated: false, projectIamOwnershipProposed: false, administratorNeedsAllAreaAssignments: false},
    surfaces: {management: false, performance: false}, entries,
    preservedExceptionEvidence: {sourceProfileSha256: designated.get('PERMISSIONS_EXCEPTION').designation.sourceProfileSha256, sourceAclSha256: designated.get('PERMISSIONS_EXCEPTION').designation.sourceAclSha256, rolePermissionsAndTypedAclPreservedExactly: true},
    eligibilityEvidenceSha256: snapshotDigest({aclIntents: preview.proposals.aclIntents, contentCandidates: preview.proposals.contentCandidates, evaluationCandidates: preview.proposals.evaluationCandidates}),
    grants: [], leases: [], runtimeContexts: [], authImportRecords: [],
    gates: gates.sort((a,b) => lexical(a.code,b.code)),
    counts: {profiles: entries.length,exclusiveAdministratorIntents: 1,preservedExceptions: 1,commonUserIntents: common.length,legacyAdminDifferences: legacyAdmin,explicitPrivilegedMaskDifferences: explicitMask,managerRelationsOutsideDesignated: outsideManagers,capturedDeniedProfiles: denied,deferredIdentities: deferred,unresolvedAclIntents: preview.counts.unresolvedAclIntents,effectivePermissions: 0,effectiveMemberships: 0,effectiveAclGrants: 0,authorizedFbContexts: 0,authImports: 0,policyWrites: 0},
    effects: {firestoreReadsIssued: 0, firestoreWritesIssued: 0, authChangesIssued: 0, triggersActivated: 0}};
  output.resultSha256 = managementRolePolicyPlanDigest(output);
  return output;
}
