import {authSourceRecordDigest} from './management-auth-import-plan.js';
import {MANAGEMENT_RETIREMENT_CANDIDATE_EMAILS, MANAGEMENT_STRUCTURAL_OWNER_EMAIL, managementNormalizeEmail} from './management-retirement-candidate-identities.js';

const PROJECTS = Object.freeze({FA: 'sahmt-17a16', FB: 'sahmt-gestao-5ae66', FC: 'indicadores---sahmt'});
const UID = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const OBJECT = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const CATEGORIES = new Set(['OPERATIONAL', 'TRAINING', 'AUDIT', 'OTHER']);
const isEmailMentioned = (user, expected) => [user?.email, ...(Array.isArray(user?.providerData) ? user.providerData.map(item => item?.email) : [])]
  .some(value => managementNormalizeEmail(value) === expected);

function demand(condition, code) { if (!condition) throw new Error(code); }

function validateAuthSnapshot(snapshot, alias) {
  demand(OBJECT(snapshot) && snapshot.projectId === PROJECTS[alias] && snapshot.coverage?.complete === true && Array.isArray(snapshot.users), 'RETIREMENT_AUTH_SNAPSHOT_INVALID');
  const seen = new Set();
  for (const user of snapshot.users) {
    demand(OBJECT(user) && UID(user.uid) && !seen.has(user.uid), 'RETIREMENT_AUTH_UID_INVALID_OR_DUPLICATED');
    demand(user.email === undefined || typeof user.email === 'string', 'RETIREMENT_AUTH_EMAIL_INVALID');
    seen.add(user.uid);
  }
  return snapshot.users;
}

function resolveIdentity(users, expectedEmail) {
  const references = users.filter(user => isEmailMentioned(user, expectedEmail));
  const primary = references.filter(user => managementNormalizeEmail(user.email) === expectedEmail);
  if (references.length !== 1 || primary.length !== 1) return null;
  return primary[0];
}

function validateProfileSnapshot(snapshot, alias) {
  demand(OBJECT(snapshot) && snapshot.projectId === PROJECTS[alias] && snapshot.complete === true && Array.isArray(snapshot.profileUids), 'RETIREMENT_PROFILE_SNAPSHOT_INVALID');
  demand(snapshot.profileUids.every(UID) && new Set(snapshot.profileUids).size === snapshot.profileUids.length, 'RETIREMENT_PROFILE_UID_INVALID_OR_DUPLICATED');
  return new Set(snapshot.profileUids);
}

function validateDependencyIndex(index, alias) {
  demand(OBJECT(index) && index.projectId === PROJECTS[alias] && index.complete === true
    && Number.isSafeInteger(index.collectionsScanned) && index.collectionsScanned >= 0
    && Number.isSafeInteger(index.failures) && index.failures === 0 && Array.isArray(index.references)
    && index.coverageScope === 'STATIC_REPOSITORY_SCHEMA_ALLOWLIST'
    && typeof index.unmappedCollectionsReviewed === 'boolean'
    && index.globalAbsenceConfirmed === false, 'RETIREMENT_DEPENDENCY_COVERAGE_INCOMPLETE');
  const seen = new Set();
  for (const row of index.references) {
    demand(OBJECT(row) && UID(row.uid) && CATEGORIES.has(row.category)
      && Number.isSafeInteger(row.count) && row.count >= 0, 'RETIREMENT_DEPENDENCY_INDEX_INVALID');
    const key = `${row.uid}\u0000${row.category}`;
    demand(!seen.has(key), 'RETIREMENT_DEPENDENCY_INDEX_DUPLICATED');
    seen.add(key);
  }
  return index.references;
}

/**
 * Pure local impact aggregation for a future reviewed deletion decision.
 * Inputs must be complete read-only snapshots prepared separately. The result
 * contains only counts, never account identifiers or document references.
 */
export function prepareManagementRetirementImpact({authSnapshots, profileSnapshots, dependencyIndexes, structuralOwnerIdentity} = {}) {
  demand(OBJECT(authSnapshots) && OBJECT(profileSnapshots) && OBJECT(dependencyIndexes), 'RETIREMENT_INPUTS_INVALID');
  const authByProject = {}, profilesByProject = {}, refsByProject = {};
  for (const alias of Object.keys(PROJECTS)) {
    authByProject[alias] = validateAuthSnapshot(authSnapshots[alias], alias);
    profilesByProject[alias] = validateProfileSnapshot(profileSnapshots[alias], alias);
    refsByProject[alias] = validateDependencyIndex(dependencyIndexes[alias], alias);
  }

  const faUsers = authByProject.FA;
  demand(OBJECT(structuralOwnerIdentity) && UID(structuralOwnerIdentity.uid)
    && /^[a-f0-9]{64}$/.test(structuralOwnerIdentity.sourceRecordSha256 || ''), 'RETIREMENT_STRUCTURAL_OWNER_PROOF_INVALID');
  const ownerMatches = faUsers.filter(user => user.uid === structuralOwnerIdentity.uid);
  demand(ownerMatches.length === 1 && authSourceRecordDigest(ownerMatches[0]) === structuralOwnerIdentity.sourceRecordSha256
    && managementNormalizeEmail(ownerMatches[0].email) === MANAGEMENT_STRUCTURAL_OWNER_EMAIL, 'RETIREMENT_STRUCTURAL_OWNER_PROOF_INVALID');

  const candidates = [];
  let identityReview = 0;
  for (const expectedEmail of MANAGEMENT_RETIREMENT_CANDIDATE_EMAILS) {
    const user = resolveIdentity(faUsers, expectedEmail);
    if (!user || user.uid === structuralOwnerIdentity.uid) { identityReview++; continue; }
    candidates.push({uid: user.uid, email: expectedEmail});
  }

  const projects = {};
  for (const alias of Object.keys(PROJECTS)) {
    const users = authByProject[alias], profileUids = profilesByProject[alias], references = refsByProject[alias];
    let authSameUidAndEmail = 0, authMissing = 0, authEmailUidConflict = 0, profilesPresent = 0;
    const dependencyCounts = {OPERATIONAL: 0, TRAINING: 0, AUDIT: 0, OTHER: 0};
    for (const candidate of candidates) {
      const uidMatches = users.filter(user => user.uid === candidate.uid);
      const emailMatches = users.filter(user => isEmailMentioned(user, candidate.email));
      if (emailMatches.some(user => user.uid !== candidate.uid)) authEmailUidConflict++;
      else if (uidMatches.length === 1 && managementNormalizeEmail(uidMatches[0].email) === candidate.email) authSameUidAndEmail++;
      else if (uidMatches.length === 0 && emailMatches.length === 0) authMissing++;
      else authEmailUidConflict++;
      if (profileUids.has(candidate.uid)) profilesPresent++;
      for (const row of references) if (row.uid === candidate.uid) dependencyCounts[row.category] += row.count;
    }
    projects[alias] = {
      projectId: PROJECTS[alias],
      authSameUidAndEmail,
      authMissing,
      authEmailUidConflict,
      profileDocumentsPresent: profilesPresent,
      dependencyCoverageComplete: true,
      dependencyCoverageScope: dependencyIndexes[alias].coverageScope,
      unmappedCollectionsReviewed: dependencyIndexes[alias].unmappedCollectionsReviewed,
      globalAbsenceConfirmed: false,
      collectionsScanned: dependencyIndexes[alias].collectionsScanned,
      dependencyCounts,
      activeCriticalReferences: dependencyCounts.OPERATIONAL,
      historicalTrainingReferences: dependencyCounts.TRAINING,
      historicalAuditReferences: dependencyCounts.AUDIT,
      ambiguousReferences: dependencyCounts.OTHER,
      blocksAnyDeletionProposal: dependencyCounts.OPERATIONAL > 0 || dependencyCounts.OTHER > 0 || authEmailUidConflict > 0 || !dependencyIndexes[alias].unmappedCollectionsReviewed,
      historicalRecordsReferenced: dependencyCounts.TRAINING + dependencyCounts.AUDIT
    };
  }

  const totalCriticalReferences = Object.values(projects).reduce((sum, project) => sum + project.activeCriticalReferences, 0);
  const totalAmbiguousReferences = Object.values(projects).reduce((sum, project) => sum + project.ambiguousReferences, 0);
  const totalAuthIdentityConflicts = Object.values(projects).reduce((sum, project) => sum + project.authEmailUidConflict, 0);
  const blockingReasons = [];
  if (identityReview > 0) blockingReasons.push('CANDIDATE_IDENTITY_UNRESOLVED_OR_AMBIGUOUS');
  if (totalCriticalReferences > 0) blockingReasons.push('ACTIVE_DEPENDENCY_FOUND');
  if (totalAmbiguousReferences > 0) blockingReasons.push('DEPENDENCY_REQUIRES_REVIEW');
  if (totalAuthIdentityConflicts > 0) blockingReasons.push('DESTINATION_AUTH_IDENTITY_CONFLICT');
  if (Object.values(dependencyIndexes).some(index => index.unmappedCollectionsReviewed !== true)) blockingReasons.push('UNMAPPED_COLLECTIONS_NOT_REVIEWED');

  return Object.freeze({
    schemaVersion: 1,
    mode: 'LOCAL_RETIREMENT_IMPACT_PREVIEW',
    previewOnly: true,
    readsIssued: 0,
    writesIssued: 0,
    automaticDeletionEnabled: false,
    candidateIdentities: {allowed: MANAGEMENT_RETIREMENT_CANDIDATE_EMAILS.length,
      confirmedByUniqueFaUidAndEmail: candidates.length, unresolvedOrAmbiguous: identityReview},
    structuralOwnerProtected: true,
    projects,
    blockingReasons: Object.freeze(blockingReasons),
    deletionImpact: {authAccountsToDeleteAutomatically: 0, firestoreDocumentsToDeleteAutomatically: 0,
      historicalTrainingOrAuditRecordsDeleted: 0, manualReviewRequired: true,
      deletionAllowed: false, deletionProposalBlocked: blockingReasons.length > 0}
  });
}
