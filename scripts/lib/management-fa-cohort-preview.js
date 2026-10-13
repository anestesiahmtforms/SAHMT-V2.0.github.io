import {RETIREMENT_IDENTITY_MARKERS} from './management-retirement-candidate-identities.js';

const FA_PROJECT = 'sahmt-17a16';
const UID = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const PROVIDER_CATEGORIES = new Set(['NO_PROVIDER', 'PROVIDER_DATA_INVALID', 'GOOGLE_ONLY', 'GOOGLE_AND_PASSWORD', 'GOOGLE_AND_OTHER', 'GOOGLE_PASSWORD_AND_OTHER', 'PASSWORD_ONLY', 'PASSWORD_AND_OTHER', 'OTHER_PROVIDERS_ONLY']);
const ADMIN_CATEGORIES = new Set(['ADMIN_ELIGIBLE', 'ADMIN_INACTIVE_OR_NO_ACCESS', 'NOT_ADMIN', 'PROFILE_REVIEW', 'PROFILE_MISSING']);
const PROFILE_ENDPOINT = `https://firestore.googleapis.com/v1/projects/${FA_PROJECT}/databases/(default)/documents/users`;
const PROFILE_FIELD_MASK = Object.freeze(['uid', 'role', 'permissions.admin', 'active', 'access']);
const PAGE_SIZE = 1000, MAX_PAGES = 50, MAX_PROFILES = 50000, MAX_DURATION_MS = 180000;

function invalid(code) { throw new Error(code); }

function firestoreField(fields, path) {
  let current = fields;
  for (const [index, part] of path.split('.').entries()) {
    if (!isObject(current) || !Object.hasOwn(current, part)) return null;
    const value = current[part];
    if (index === path.split('.').length - 1) return value;
    current = value?.mapValue?.fields;
  }
  return null;
}

function discardTree(value) {
  if (!isObject(value) && !Array.isArray(value)) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { discardTree(value[i]); value[i] = null; }
    value.length = 0;
    return;
  }
  for (const key of Object.keys(value)) {
    discardTree(value[key]);
    value[key] = null;
  }
}

function parseDocumentUid(name) {
  if (typeof name !== 'string') return null;
  const match = /\/documents\/users\/([^/]+)$/.exec(name);
  if (!match) return null;
  try { const uid = decodeURIComponent(match[1]); return UID(uid) ? uid : null; }
  catch { return null; }
}

/** Read-only Firestore profile projection. Raw response objects are scrubbed before return. */
export async function collectFaCohortProfileIndex({fetchImpl = globalThis.fetch, accessToken, now = Date.now} = {}) {
  if (typeof fetchImpl !== 'function' || typeof accessToken !== 'string' || accessToken.length < 20 || typeof now !== 'function') invalid('FA_COHORT_READ_DEPENDENCIES_INVALID');
  const started = now(), profiles = new Map();
  let pageToken = '', pages = 0;
  do {
    if (now() - started > MAX_DURATION_MS) invalid('FA_COHORT_PROFILE_READ_TIME_LIMIT');
    if (++pages > MAX_PAGES || profiles.size > MAX_PROFILES) invalid('FA_COHORT_PROFILE_READ_LIMIT');
    const query = new URLSearchParams({pageSize: String(PAGE_SIZE)});
    for (const field of PROFILE_FIELD_MASK) query.append('mask.fieldPaths', field);
    if (pageToken) query.set('pageToken', pageToken);
    let response = null, page = null;
    try {
      response = await fetchImpl(`${PROFILE_ENDPOINT}?${query}`, {
        method: 'GET', headers: {Authorization: `Bearer ${accessToken}`}, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000)
      });
      if (!response || response.ok !== true) invalid('FA_COHORT_PROFILE_READ_HTTP_ERROR');
      page = await response.json();
      if (!isObject(page) || page.documents !== undefined && !Array.isArray(page.documents)
        || page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string') invalid('FA_COHORT_PROFILE_READ_RESPONSE_INVALID');
      const documents = Array.isArray(page.documents) ? page.documents : [];
      const following = page.nextPageToken || '';
      for (const document of documents) {
        const uid = parseDocumentUid(document?.name);
        if (!uid || profiles.has(uid)) invalid('FA_COHORT_PROFILE_UID_INVALID_OR_DUPLICATED');
        const fields = isObject(document.fields) ? document.fields : {};
        const roleValue = firestoreField(fields, 'role');
        const profileUidValue = firestoreField(fields, 'uid');
        const activeValue = firestoreField(fields, 'active');
        const accessValue = firestoreField(fields, 'access');
        const adminValue = firestoreField(fields, 'permissions.admin');
        profiles.set(uid, {
          uid,
          profileUid: typeof profileUidValue?.stringValue === 'string' ? profileUidValue.stringValue : null,
          role: typeof roleValue?.stringValue === 'string' ? roleValue.stringValue : null,
          active: typeof activeValue?.booleanValue === 'boolean' ? activeValue.booleanValue : null,
          access: typeof accessValue?.booleanValue === 'boolean' ? accessValue.booleanValue : null,
          permissionsAdmin: typeof adminValue?.booleanValue === 'boolean' ? adminValue.booleanValue : null
        });
        discardTree(document);
      }
      documents.length = 0;
      pageToken = following;
    } catch (error) {
      const safeCodes = new Set(['FA_COHORT_PROFILE_READ_HTTP_ERROR', 'FA_COHORT_PROFILE_READ_RESPONSE_INVALID', 'FA_COHORT_PROFILE_UID_INVALID_OR_DUPLICATED']);
      if (safeCodes.has(error?.message)) throw error;
      invalid('FA_COHORT_PROFILE_READ_FAILED');
    } finally {
      if (page) discardTree(page);
      page = null;
      response = null;
    }
    if (profiles.size > MAX_PROFILES) invalid('FA_COHORT_PROFILE_READ_LIMIT');
  } while (pageToken);
  return {schemaVersion: 1, kind: 'FA_COHORT_PROFILE_INDEX', projectId: FA_PROJECT,
    capturedAt: new Date(now()).toISOString(), complete: true, pages, profiles: [...profiles.values()]};
}

function validatedAuthUsers(index) {
  if (!isObject(index) || index.schemaVersion !== 1 || index.kind !== 'FA_UID_COMPARISON_INDEX'
    || index.projectId !== FA_PROJECT || !Array.isArray(index.users)) invalid('FA_COHORT_AUTH_INDEX_INVALID');
  const users = new Map();
  for (const row of index.users) {
    if (!isObject(row) || !UID(row.uid) || users.has(row.uid)
      || Object.keys(row).some(key => !['uid', 'disabled', 'providerCategory', 'adminCategory', 'identityMarker'].includes(key))
      || !Object.hasOwn(row, 'disabled') || !Object.hasOwn(row, 'providerCategory')
      || row.disabled !== null && typeof row.disabled !== 'boolean'
      || !PROVIDER_CATEGORIES.has(row.providerCategory)
      || row.adminCategory !== undefined && !ADMIN_CATEGORIES.has(row.adminCategory)
      || row.identityMarker !== undefined && row.identityMarker !== null && !RETIREMENT_IDENTITY_MARKERS.includes(row.identityMarker)) invalid('FA_COHORT_AUTH_INDEX_INVALID');
    users.set(row.uid, row);
  }
  return users;
}

function validatedProfiles(snapshot) {
  if (!isObject(snapshot) || snapshot.schemaVersion !== 1 || snapshot.kind !== 'FA_COHORT_PROFILE_INDEX'
    || snapshot.projectId !== FA_PROJECT || snapshot.complete !== true || !Array.isArray(snapshot.profiles)) invalid('FA_COHORT_PROFILE_INDEX_INVALID');
  const profiles = new Map();
  for (const row of snapshot.profiles) {
    if (!isObject(row) || !UID(row.uid) || profiles.has(row.uid)
      || row.role !== null && typeof row.role !== 'string'
      || row.profileUid !== null && typeof row.profileUid !== 'string'
      || row.active !== null && typeof row.active !== 'boolean'
      || row.access !== null && typeof row.access !== 'boolean'
      || row.permissionsAdmin !== null && typeof row.permissionsAdmin !== 'boolean') invalid('FA_COHORT_PROFILE_INDEX_INVALID');
    profiles.set(row.uid, row);
  }
  return profiles;
}

/**
 * Aggregates a local-only first-login cohort preview. Owner and structural
 * identities are pinned by validated UIDs. The two retirement candidates are
 * classified only from private Auth-index markers derived from exact emails;
 * unknown Auth state is never used as a proxy for cohort membership.
 */
export function prepareFaFirstLoginCohortPreview({authIndex, profileIndex, validatedOwnerUid, structuralProtectedUids = [], generatedAt = new Date().toISOString(), includePrivateUidDecisions = false} = {}) {
  if (!UID(validatedOwnerUid)) invalid('FA_COHORT_OWNER_UID_NOT_VALIDATED');
  if (typeof includePrivateUidDecisions !== 'boolean') invalid('FA_COHORT_PRIVATE_DECISIONS_OPTION_INVALID');
  const authUsers = validatedAuthUsers(authIndex);
  const profiles = validatedProfiles(profileIndex);
  if (!authUsers.has(validatedOwnerUid)) invalid('FA_COHORT_OWNER_UID_NOT_IN_AUTH_INDEX');
  if (authUsers.get(validatedOwnerUid).identityMarker !== 'STRUCTURAL_OWNER') invalid('FA_COHORT_OWNER_EMAIL_UID_MISMATCH');
  const checkedUidSet = (value, errorCode) => {
    if (!Array.isArray(value) || value.some(uid => !UID(uid)) || new Set(value).size !== value.length
      || value.some(uid => !authUsers.has(uid))) invalid(errorCode);
    return new Set(value);
  };
  const structuralSet = checkedUidSet(structuralProtectedUids, 'FA_COHORT_STRUCTURAL_UIDS_INVALID');
  structuralSet.add(validatedOwnerUid);
  const markerUids = new Map(RETIREMENT_IDENTITY_MARKERS.map(marker => [marker, []]));
  for (const [uid, auth] of authUsers) if (auth.identityMarker) markerUids.get(auth.identityMarker).push(uid);
  const ownerMarkerUids = markerUids.get('STRUCTURAL_OWNER');
  const ownerIdentityMarkerAmbiguous = Math.max(0, ownerMarkerUids.length - 1);
  const candidateMarkerUids = [...markerUids.get('HOMOLOGATION_CANDIDATE_1'), ...markerUids.get('HOMOLOGATION_CANDIDATE_2')];
  const effectiveHomologationSet = new Set(), ambiguousCandidateSet = new Set();
  for (const marker of ['HOMOLOGATION_CANDIDATE_1', 'HOMOLOGATION_CANDIDATE_2']) {
    const matches = markerUids.get(marker);
    if (matches.length === 1) {
      if (structuralSet.has(matches[0])) continue;
      effectiveHomologationSet.add(matches[0]);
    } else for (const uid of matches) ambiguousCandidateSet.add(uid);
  }
  const structuralHomologationOverlap = candidateMarkerUids.filter(uid => structuralSet.has(uid)).length;
  const counts = {OPERATIONAL: 0, STRUCTURAL: 0, HOMOLOGATION: 0, REVIEW: 0};
  const administrators = {OPERATIONAL: 0, STRUCTURAL: 0, HOMOLOGATION: 0, REVIEW: 0};
  const privateUidDecisions = includePrivateUidDecisions ? [] : null;
  const divergenceCounts = {
    authProfilesMissing: 0,
    orphanProfiles: 0,
    invalidOrIncompleteProfiles: 0,
    profileUidMismatch: 0,
    disabledOrAuthStateUnknown: 0,
    authStateUnknownNotConfirmed: 0,
    structuralHomologationOverlap,
    homologationCandidateIdentityAmbiguous: ambiguousCandidateSet.size,
    ownerIdentityMarkerAmbiguous
  };
  for (const uid of authUsers.keys()) {
    const auth = authUsers.get(uid);
    const profile = profiles.get(uid);
    let cohort = 'REVIEW';
    // The document path users/{uid} is the canonical UID binding. Some valid
    // profiles do not duplicate it in a `uid` field, and non-admin profiles
    // may omit permissions.admin; neither omission makes an otherwise intact
    // profile ambiguous. An explicit UID mismatch or malformed value remains
    // a review case.
    let profileValid = profile && profile.uid === uid
      && (profile.profileUid === null || profile.profileUid === uid)
      && (profile.role === null || typeof profile.role === 'string')
      && typeof profile.active === 'boolean' && typeof profile.access === 'boolean'
      && (profile.permissionsAdmin === null || typeof profile.permissionsAdmin === 'boolean');
    const admin = profileValid && (profile.role === 'administrador_app' || profile.permissionsAdmin === true);

    if (structuralSet.has(uid)) cohort = 'STRUCTURAL';
    else if (effectiveHomologationSet.has(uid)) cohort = 'HOMOLOGATION';
    else if (ambiguousCandidateSet.has(uid) || auth.identityMarker === 'STRUCTURAL_OWNER') cohort = 'REVIEW';
    else if (auth.disabled === false && profileValid && profile.active === true && profile.access === true
      && auth.providerCategory !== 'PROVIDER_DATA_INVALID') cohort = 'OPERATIONAL';

    if (!profile) divergenceCounts.authProfilesMissing++;
    else if (!profileValid) {
      divergenceCounts.invalidOrIncompleteProfiles++;
      if (profile.profileUid !== uid) divergenceCounts.profileUidMismatch++;
    }
    if (auth.disabled !== false && !structuralSet.has(uid) && !effectiveHomologationSet.has(uid)) divergenceCounts.disabledOrAuthStateUnknown++;
    if (auth.disabled === null && !structuralSet.has(uid) && !effectiveHomologationSet.has(uid)) divergenceCounts.authStateUnknownNotConfirmed++;
    counts[cohort]++;
    if (admin) administrators[cohort]++;
    if (privateUidDecisions) privateUidDecisions.push({uid, cohort, administrator: admin});
  }
  for (const uid of profiles.keys()) if (!authUsers.has(uid)) divergenceCounts.orphanProfiles++;

  const report = Object.freeze({
    schemaVersion: 1,
    mode: 'LOCAL_FIRST_LOGIN_COHORT_PREVIEW',
    previewOnly: true,
    writesEnabled: false,
    authProjectId: FA_PROJECT,
    authSnapshotAt: typeof authIndex.capturedAt === 'string' ? authIndex.capturedAt : null,
    profileSnapshotAt: typeof profileIndex.capturedAt === 'string' ? profileIndex.capturedAt : null,
    generatedAt,
    totalAuthAccounts: authUsers.size,
    totalProfileDocuments: profiles.size,
    cohorts: counts,
    administratorsByCohort: administrators,
    divergenceCounts,
    ownerUidValidatedAndProtected: true,
    structuralUidsExcludedFromHomologation: true,
    homologationRequiresUniqueAuthEmailToUidMarker: true,
    confirmedHomologationCandidateCount: effectiveHomologationSet.size,
    providerAbsenceUsedAsPositiveSignal: false,
    roleOrPermissionsChanged: false,
    readsIssued: 0,
    writesIssued: 0,
  });
  if (!privateUidDecisions) return report;
  return Object.freeze({report, protectedUidDecisions: Object.freeze({schemaVersion: 1, kind: 'FA_FIRST_LOGIN_COHORT_DECISION_INDEX',
    projectId: FA_PROJECT, generatedAt, decisions: privateUidDecisions})});
}
