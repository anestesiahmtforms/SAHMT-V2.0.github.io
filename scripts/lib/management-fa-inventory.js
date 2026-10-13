import {managementIdentityMarkerForEmail} from './management-retirement-candidate-identities.js';

const FA = 'sahmt-17a16';
const AUTH_ENDPOINT = `https://identitytoolkit.googleapis.com/v1/projects/${FA}/accounts:batchGet`;
const FIRESTORE_ENDPOINT = `https://firestore.googleapis.com/v1/projects/${FA}/databases/(default)/documents/users`;
const PAGE_SIZE = 1000, MAX_PAGES = 50, MAX_USERS = 50000, MAX_DURATION_MS = 180000;
const PROFILE_FIELD_MASK = ['role', 'permissions.admin', 'active', 'access', 'firstLoginCohort'];
const READ_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const discardObjectFields = value => { if (isObject(value)) for (const key of Object.keys(value)) value[key] = null; };
const emptyAuthCounts = () => ({total: 0, enabled: 0, disabled: 0, disabledUnknown: 0, providerCategories: {}});
const emptyProfileCounts = () => ({documents: 0, authUsersWithProfile: 0, authUsersMissingProfile: 0, orphanProfiles: 0, invalidProfiles: 0,
  administrativeCategories: {ADMIN_ELIGIBLE: 0, ADMIN_INACTIVE_OR_NO_ACCESS: 0, NOT_ADMIN: 0, PROFILE_REVIEW: 0, PROFILE_MISSING: 0},
  firstLoginCohorts: {OPERATIONAL: 0, STRUCTURAL: 0, HOMOLOGATION: 0, REVIEW: 0, MISSING: 0, INVALID: 0},
  operationalFlow: {authEnabledAndActiveWithAccess: 0, prerequisitesBlockedOrUnknown: 0, protectedStructural: 0,
    protectedHomologation: 0, cohortOperationalAndEligible: 0}});
const addCount = (target, key) => { target[key] = (target[key] || 0) + 1; };

function providerCategory(providers) {
  if (!Array.isArray(providers)) return 'PROVIDER_DATA_INVALID';
  const ids = new Set();
  for (const provider of providers) {
    if (!isObject(provider) || typeof provider.providerId !== 'string' || provider.providerId.length === 0) return 'PROVIDER_DATA_INVALID';
    ids.add(provider.providerId);
  }
  const google = ids.has('google.com'), password = ids.has('password'), other = [...ids].some(id => id !== 'google.com' && id !== 'password');
  if (!google && !password && !other) return 'NO_PROVIDER';
  if (google && !password && !other) return 'GOOGLE_ONLY';
  if (google && password && !other) return 'GOOGLE_AND_PASSWORD';
  if (google && !password && other) return 'GOOGLE_AND_OTHER';
  if (google && password && other) return 'GOOGLE_PASSWORD_AND_OTHER';
  if (!google && password && !other) return 'PASSWORD_ONLY';
  if (!google && password && other) return 'PASSWORD_AND_OTHER';
  return 'OTHER_PROVIDERS_ONLY';
}

function docUid(documentName) {
  if (typeof documentName !== 'string') return null;
  const match = /\/documents\/users\/([^/]+)$/.exec(documentName);
  if (!match) return null;
  try { const value = decodeURIComponent(match[1]); return validUid(value) ? value : null; }
  catch { return null; }
}

function firestoreField(fields, path) {
  let current = fields;
  for (const part of path.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, part)) return {present: false};
    const value = current[part];
    if (part === path.split('.').at(-1)) return {present: true, value};
    current = value?.mapValue?.fields;
  }
  return {present: false};
}

function classifyProfile(fields) {
  if (!isObject(fields)) return 'PROFILE_REVIEW';
  const active = firestoreField(fields, 'active'), access = firestoreField(fields, 'access');
  const role = firestoreField(fields, 'role'), admin = firestoreField(fields, 'permissions.admin');
  if (!active.present || !access.present || typeof active.value?.booleanValue !== 'boolean' || typeof access.value?.booleanValue !== 'boolean'
    || role.present && typeof role.value?.stringValue !== 'string' || admin.present && typeof admin.value?.booleanValue !== 'boolean') return 'PROFILE_REVIEW';
  const adminSignal = role.value?.stringValue === 'administrador_app' || admin.value?.booleanValue === true;
  if (!adminSignal) return 'NOT_ADMIN';
  return active.value.booleanValue === true && access.value.booleanValue === true ? 'ADMIN_ELIGIBLE' : 'ADMIN_INACTIVE_OR_NO_ACCESS';
}

function firstLoginCohort(fields) {
  const cohort = firestoreField(fields, 'firstLoginCohort');
  if (!cohort.present) return 'MISSING';
  const value = cohort.value?.stringValue;
  return ['OPERATIONAL', 'STRUCTURAL', 'HOMOLOGATION', 'REVIEW'].includes(value) ? value : 'INVALID';
}

async function responseJson(fetchImpl, url, accessToken, errorPrefix) {
  let response;
  try {
    response = await fetchImpl(url, {method: 'GET', headers: {Authorization: `Bearer ${accessToken}`},
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000)});
  } catch { throw new Error(`${errorPrefix}_REQUEST_FAILED`); }
  if (!response || response.ok !== true) {
    const status = Number.isInteger(response?.status) ? response.status : 0;
    response = null;
    throw new Error(`${errorPrefix}_HTTP_${status}`);
  }
  try { const value = await response.json(); response = null; return value; }
  catch { response = null; throw new Error(`${errorPrefix}_RESPONSE_INVALID`); }
}

/**
 * FA-only paginated read. The full Auth response exists only while each page
 * is processed. Output contains counts and an in-memory UID comparison index;
 * callers must seal that index before writing it anywhere.
 */
export async function collectFaInventory({fetchImpl = globalThis.fetch, getAccessToken, now = Date.now, onStage = () => {}} = {}) {
  if (typeof fetchImpl !== 'function' || typeof getAccessToken !== 'function' || typeof now !== 'function' || typeof onStage !== 'function') throw new Error('FA_INVENTORY_DEPENDENCIES_INVALID');
  const started = now(), authCounts = emptyAuthCounts(), profileCounts = emptyProfileCounts();
  const authByUid = new Map(), profileByUid = new Map();
  let accessToken = null, authPages = 0, profilePages = 0;
  const demandLimit = () => {
    if (now() - started > MAX_DURATION_MS) throw new Error('FA_INVENTORY_TIME_LIMIT');
    if (authCounts.total > MAX_USERS || profileCounts.documents > MAX_USERS) throw new Error('FA_INVENTORY_RECORD_LIMIT');
  };
  try {
    onStage('OAUTH_TOKEN');
    accessToken = await getAccessToken({projectId: FA, api: 'READ_ONLY_DATA', scopes: [READ_SCOPE]});
    if (typeof accessToken !== 'string' || accessToken.length < 20) throw new Error('FA_READ_ACCESS_TOKEN_UNAVAILABLE');
    let nextPageToken = '', seenPageTokens = new Set();
    do {
      demandLimit();
      if (++authPages > MAX_PAGES) throw new Error('FA_AUTH_PAGE_LIMIT');
      onStage('AUTH_READ');
      const query = new URLSearchParams({maxResults: String(PAGE_SIZE), ...(nextPageToken ? {nextPageToken} : {})});
      let page = await responseJson(fetchImpl, `${AUTH_ENDPOINT}?${query}`, accessToken, 'FA_AUTH');
      if (!isObject(page) || page.users !== undefined && !Array.isArray(page.users) || page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string') throw new Error('FA_AUTH_RESPONSE_INVALID');
      const users = Array.isArray(page.users) ? page.users : [];
      const following = page.nextPageToken || '';
      for (let position = 0; position < users.length; position++) {
        let raw = users[position];
        if (!isObject(raw) || !validUid(raw.localId) || authByUid.has(raw.localId)) throw new Error('FA_AUTH_USER_ID_INVALID_OR_DUPLICATED');
        const uid = raw.localId;
        let providerRows = raw.providerUserInfo;
        const category = providerCategory(providerRows === undefined ? [] : providerRows);
        const disabled = typeof raw.disabled === 'boolean' ? raw.disabled : null;
        const identityMarker = managementIdentityMarkerForEmail(raw.email);
        authByUid.set(uid, {uid, disabled, providerCategory: category, adminCategory: 'PROFILE_MISSING', identityMarker});
        authCounts.total++;
        if (disabled === true) authCounts.disabled++;
        else if (disabled === false) authCounts.enabled++;
        else authCounts.disabledUnknown++;
        addCount(authCounts.providerCategories, category);
        // Clear provider detail, then all raw account fields (hashes, salts, tokens, PII, etc.).
        if (Array.isArray(providerRows)) {
          for (let providerIndex = 0; providerIndex < providerRows.length; providerIndex++) {
            discardObjectFields(providerRows[providerIndex]);
            providerRows[providerIndex] = null;
          }
          providerRows.length = 0;
        }
        providerRows = null;
        discardObjectFields(raw);
        raw = null;
        users[position] = null;
      }
      users.length = 0;
      discardObjectFields(page);
      page = null;
      if (following && seenPageTokens.has(following)) throw new Error('FA_AUTH_PAGE_TOKEN_REPEATED');
      if (following) seenPageTokens.add(following);
      nextPageToken = following;
    } while (nextPageToken);
    let pageToken = '', seenProfileTokens = new Set();
    do {
      demandLimit();
      if (++profilePages > MAX_PAGES) throw new Error('FA_PROFILE_PAGE_LIMIT');
      onStage('FIRESTORE_READ');
      const query = new URLSearchParams({pageSize: String(PAGE_SIZE)});
      for (const field of PROFILE_FIELD_MASK) query.append('mask.fieldPaths', field);
      if (pageToken) query.set('pageToken', pageToken);
      let page = await responseJson(fetchImpl, `${FIRESTORE_ENDPOINT}?${query}`, accessToken, 'FA_PROFILES');
      if (!isObject(page) || page.documents !== undefined && !Array.isArray(page.documents) || page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string') throw new Error('FA_PROFILES_RESPONSE_INVALID');
      const documents = Array.isArray(page.documents) ? page.documents : [];
      const following = page.nextPageToken || '';
      for (let position = 0; position < documents.length; position++) {
        let document = documents[position];
        const uid = docUid(document?.name);
        if (!uid || profileByUid.has(uid)) throw new Error('FA_PROFILE_DOCUMENT_ID_INVALID_OR_DUPLICATED');
        const category = classifyProfile(document.fields);
        const cohort = firstLoginCohort(document.fields);
        addCount(profileCounts.firstLoginCohorts, cohort);
        profileByUid.set(uid, category);
        profileCounts.documents++;
        if (authByUid.has(uid)) {
          profileCounts.authUsersWithProfile++;
          const source = authByUid.get(uid);
          source.adminCategory = category;
          const active = firestoreField(document.fields, 'active'), access = firestoreField(document.fields, 'access');
          const prerequisitesReady = source.disabled === false && active.value?.booleanValue === true && access.value?.booleanValue === true;
          if (prerequisitesReady) profileCounts.operationalFlow.authEnabledAndActiveWithAccess++;
          else profileCounts.operationalFlow.prerequisitesBlockedOrUnknown++;
          if (source.identityMarker === 'STRUCTURAL_OWNER') profileCounts.operationalFlow.protectedStructural++;
          if (source.identityMarker === 'HOMOLOGATION_CANDIDATE_1' || source.identityMarker === 'HOMOLOGATION_CANDIDATE_2') profileCounts.operationalFlow.protectedHomologation++;
          if (prerequisitesReady && cohort === 'OPERATIONAL' && !source.identityMarker)
            profileCounts.operationalFlow.cohortOperationalAndEligible++;
        } else profileCounts.orphanProfiles++;
        if (category === 'PROFILE_REVIEW') profileCounts.invalidProfiles++;
        addCount(profileCounts.administrativeCategories, category);
        // Clear the document ID and projected/unexpected fields immediately after classification.
        document.name = null;
        document.fields = null;
        discardObjectFields(document);
        document = null;
        documents[position] = null;
      }
      documents.length = 0;
      discardObjectFields(page);
      page = null;
      if (following && seenProfileTokens.has(following)) throw new Error('FA_PROFILE_PAGE_TOKEN_REPEATED');
      if (following) seenProfileTokens.add(following);
      pageToken = following;
    } while (pageToken);
    accessToken = null;
    for (const user of authByUid.values()) {
      if (!profileByUid.has(user.uid)) {
        profileCounts.authUsersMissingProfile++;
        addCount(profileCounts.firstLoginCohorts, 'MISSING');
        profileCounts.operationalFlow.prerequisitesBlockedOrUnknown++;
        user.adminCategory = 'PROFILE_MISSING';
        addCount(profileCounts.administrativeCategories, 'PROFILE_MISSING');
      }
    }
    const capturedAt = new Date(now()).toISOString();
    const report = {schemaVersion: 1, kind: 'FA_READ_ONLY_AUTH_PROFILE_INVENTORY', projectId: FA, capturedAt,
      auth: authCounts, profiles: profileCounts, pages: {authentication: authPages, firestoreProfiles: profilePages},
      readsOnly: true, accountChangesIssued: 0, firestoreWritesIssued: 0, logsContainPersonalData: false};
    const protectedIndex = {schemaVersion: 1, kind: 'FA_UID_COMPARISON_INDEX', projectId: FA, capturedAt,
      users: [...authByUid.values()].map(({uid, disabled, providerCategory, adminCategory, identityMarker}) => ({uid, disabled, providerCategory, adminCategory, identityMarker}))};
    return {report, protectedIndex};
  } finally {
    accessToken = null;
  }
}

export const FA_INVENTORY_PRIVATE_OUTPUT = Object.freeze({directory: '.local-preview/management-split',
  indexPattern: 'fa-auth-index-<UTC_TIMESTAMP>.dpapi.json', reportPattern: 'fa-auth-inventory-<UTC_TIMESTAMP>-summary.json'});

const DIAGNOSTIC_CATEGORIES = Object.freeze({
  STARTUP: 'LOCAL_VALIDATION', OUTPUT_DIRECTORY: 'LOCAL_OUTPUT', DPAPI_PREFLIGHT: 'LOCAL_DPAPI',
  CLI_AUTH_LOAD: 'FIREBASE_CLI_AUTH', CLI_ACCOUNT_LOOKUP: 'FIREBASE_CLI_AUTH', OAUTH_TOKEN: 'OAUTH_TOKEN',
  AUTH_READ: 'AUTH_READ', FIRESTORE_READ: 'FIRESTORE_READ', DPAPI_INDEX_SEAL: 'LOCAL_DPAPI',
  LOCAL_INDEX_WRITE: 'LOCAL_OUTPUT', LOCAL_REPORT_WRITE: 'LOCAL_OUTPUT'
});
const SAFE_DIAGNOSTIC_CODES = new Set([
  'FA_INVENTORY_TAKES_NO_ARGUMENTS', 'FA_INVENTORY_OUTPUT_NOT_GIT_IGNORED', 'FA_INVENTORY_OUTPUT_PATH_INVALID',
  'FA_INVENTORY_OUTPUT_LINK_FORBIDDEN', 'FA_INVENTORY_PROTECTION_PROBE_FAILED', 'FA_INVENTORY_EXPECTED_ACCOUNT_LOGIN_REQUIRED',
  'FA_INVENTORY_OAUTH_SCOPE_INVALID', 'FA_READ_ACCESS_TOKEN_UNAVAILABLE', 'FA_INVENTORY_DEPENDENCIES_INVALID',
  'FA_INVENTORY_TIME_LIMIT', 'FA_INVENTORY_RECORD_LIMIT', 'FA_AUTH_REQUEST_FAILED', 'FA_AUTH_RESPONSE_INVALID', 'FA_AUTH_USER_ID_INVALID_OR_DUPLICATED',
  'FA_AUTH_PAGE_TOKEN_REPEATED', 'FA_AUTH_PAGE_LIMIT', 'FA_PROFILE_PAGE_TOKEN_REPEATED', 'FA_PROFILE_PAGE_LIMIT',
  'FA_PROFILE_DOCUMENT_ID_INVALID_OR_DUPLICATED', 'FA_PROFILES_REQUEST_FAILED', 'FA_PROFILES_RESPONSE_INVALID'
]);

/** Map only a fixed stage and safe code to diagnostics; never forward error messages or response bodies. */
export function safeInventoryDiagnostic(stage, error) {
  const safeStage = Object.hasOwn(DIAGNOSTIC_CATEGORIES, stage) ? stage : 'STARTUP';
  const message = typeof error?.message === 'string' ? error.message : '';
  let errorCode = `FA_${safeStage}_FAILED`;
  if (safeStage === 'OAUTH_TOKEN') {
    if (/invalid_scope|requires new authorization scopes/i.test(message)) errorCode = 'FA_OAUTH_SCOPES_REQUIRED';
    else if (/invalid_grant|reauth|invalid credential/i.test(message)) errorCode = 'FA_OAUTH_REAUTH_REQUIRED';
    else errorCode = 'FA_OAUTH_TOKEN_REFRESH_FAILED';
  } else if (/^FA_(?:AUTH|PROFILES)_HTTP_(?:0|[1-5][0-9]{2})$/.test(message) || SAFE_DIAGNOSTIC_CODES.has(message)) errorCode = message;
  return {stage: safeStage, category: DIAGNOSTIC_CATEGORIES[safeStage], errorCode};
}
