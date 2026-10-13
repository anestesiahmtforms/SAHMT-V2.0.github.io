const FB = 'sahmt-gestao-5ae66';
const AUTH_ENDPOINT = `https://identitytoolkit.googleapis.com/v1/projects/${FB}/accounts:batchGet`;
const PAGE_SIZE = 1000, MAX_PAGES = 50, MAX_USERS = 50000, MAX_DURATION_MS = 180000;
const READ_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const discardObjectFields = value => { if (isObject(value)) for (const key of Object.keys(value)) value[key] = null; };
const emptyCounts = () => ({equivalent: 0, missing: 0, conflicts: 0, review: 0});
function scrubAccount(raw) {
  if (!isObject(raw)) return;
  if (Array.isArray(raw.providerUserInfo)) {
    for (let i = 0; i < raw.providerUserInfo.length; i++) {
      discardObjectFields(raw.providerUserInfo[i]);
      raw.providerUserInfo[i] = null;
    }
    raw.providerUserInfo.length = 0;
  }
  discardObjectFields(raw);
}

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

const HTTP_CATEGORIES = Object.freeze({401: 'AUTH_HTTP_UNAUTHENTICATED', 403: 'AUTH_HTTP_FORBIDDEN', 404: 'AUTH_HTTP_NOT_FOUND'});
const BAD_REQUEST_STATUS = Object.freeze({INVALID_ARGUMENT: 'AUTH_BAD_REQUEST_INVALID_ARGUMENT', BAD_REQUEST: 'AUTH_BAD_REQUEST_INVALID_ARGUMENT'});
const BAD_REQUEST_REASON = Object.freeze({
  badRequest: 'AUTH_BAD_REQUEST_MALFORMED',
  invalid: 'AUTH_BAD_REQUEST_INVALID',
  invalidParameter: 'AUTH_BAD_REQUEST_INVALID_PARAMETER',
  invalidQuery: 'AUTH_BAD_REQUEST_INVALID_PARAMETER',
  required: 'AUTH_BAD_REQUEST_REQUIRED_FIELD'
});
const ALLOWED_DIAGNOSTIC_CATEGORIES = new Set([
  'AUTH_BAD_REQUEST_INVALID_ARGUMENT', 'AUTH_BAD_REQUEST_MALFORMED', 'AUTH_BAD_REQUEST_INVALID',
  'AUTH_BAD_REQUEST_INVALID_PARAMETER', 'AUTH_BAD_REQUEST_REQUIRED_FIELD', 'AUTH_BAD_REQUEST_UNKNOWN',
  'AUTH_HTTP_UNAUTHENTICATED', 'AUTH_HTTP_FORBIDDEN', 'AUTH_HTTP_NOT_FOUND', 'AUTH_HTTP_ERROR',
  'LOCAL_VALIDATION', 'LOCAL_OUTPUT', 'LOCAL_DPAPI', 'FIREBASE_CLI_AUTH', 'OAUTH_TOKEN', 'AUTH_READ'
]);

function classifyBadRequest(body) {
  const error = isObject(body) && isObject(body.error) ? body.error : null;
  if (!error) return 'AUTH_BAD_REQUEST_UNKNOWN';
  const found = [];
  if (error.status !== undefined) {
    if (typeof error.status !== 'string' || !Object.hasOwn(BAD_REQUEST_STATUS, error.status)) return 'AUTH_BAD_REQUEST_UNKNOWN';
    found.push(BAD_REQUEST_STATUS[error.status]);
  }
  if (error.errors !== undefined) {
    if (!Array.isArray(error.errors)) return 'AUTH_BAD_REQUEST_UNKNOWN';
    for (const item of error.errors) {
      if (!isObject(item) || typeof item.reason !== 'string' || !Object.hasOwn(BAD_REQUEST_REASON, item.reason)) return 'AUTH_BAD_REQUEST_UNKNOWN';
      found.push(BAD_REQUEST_REASON[item.reason]);
    }
  }
  if (!found.length) return 'AUTH_BAD_REQUEST_UNKNOWN';
  const reasons = found.filter(value => value !== 'AUTH_BAD_REQUEST_INVALID_ARGUMENT');
  if (reasons.some(value => value !== reasons[0])) return 'AUTH_BAD_REQUEST_UNKNOWN';
  return reasons[0] || 'AUTH_BAD_REQUEST_INVALID_ARGUMENT';
}

function discardHttpErrorBody(body) {
  if (!isObject(body)) return;
  const error = isObject(body.error) ? body.error : null;
  if (error) {
    if (Array.isArray(error.errors)) {
      for (const item of error.errors) discardObjectFields(item);
      error.errors.length = 0;
    }
    discardObjectFields(error);
  }
  discardObjectFields(body);
}

function httpError(status, category) {
  const error = new Error(`FB_AUTH_HTTP_${status}`);
  error.httpStatus = status;
  error.safeCategory = category;
  return error;
}

async function responseJson(fetchImpl, url, accessToken) {
  let response;
  try {
    response = await fetchImpl(url, {method: 'GET', headers: {Authorization: `Bearer ${accessToken}`},
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000)});
  } catch { throw new Error('FB_AUTH_REQUEST_FAILED'); }
  if (!response || response.ok !== true) {
    const status = Number.isInteger(response?.status) ? response.status : 0;
    let category = status === 400 ? 'AUTH_BAD_REQUEST_UNKNOWN' : (HTTP_CATEGORIES[status] || 'AUTH_HTTP_ERROR');
    if (status === 400 && typeof response?.json === 'function') {
      let body = null;
      try { body = await response.json(); category = classifyBadRequest(body); }
      catch { category = 'AUTH_BAD_REQUEST_UNKNOWN'; }
      finally { discardHttpErrorBody(body); body = null; }
    }
    response = null;
    throw httpError(status, category);
  }
  try { const value = await response.json(); response = null; return value; }
  catch { response = null; throw new Error('FB_AUTH_RESPONSE_INVALID'); }
}

/** Reads only FB Authentication, discarding each raw account object after classification. */
export async function collectFbAuthIndex({fetchImpl = globalThis.fetch, getAccessToken, now = Date.now, onStage = () => {}} = {}) {
  if (typeof fetchImpl !== 'function' || typeof getAccessToken !== 'function' || typeof now !== 'function' || typeof onStage !== 'function') throw new Error('FB_INVENTORY_DEPENDENCIES_INVALID');
  const started = now(), usersByUid = new Map();
  let accessToken = null, pages = 0;
  try {
    onStage('OAUTH_TOKEN');
    accessToken = await getAccessToken({projectId: FB, api: 'AUTHENTICATION_READ_ONLY', scopes: [READ_SCOPE]});
    if (typeof accessToken !== 'string' || accessToken.length < 20) throw new Error('FB_READ_ACCESS_TOKEN_UNAVAILABLE');
    let nextPageToken = '', seenPageTokens = new Set();
    do {
      if (now() - started > MAX_DURATION_MS) throw new Error('FB_INVENTORY_TIME_LIMIT');
      if (++pages > MAX_PAGES) throw new Error('FB_AUTH_PAGE_LIMIT');
      onStage('AUTH_READ');
      const query = new URLSearchParams({maxResults: String(PAGE_SIZE), ...(nextPageToken ? {nextPageToken} : {})});
      let page = await responseJson(fetchImpl, `${AUTH_ENDPOINT}?${query}`, accessToken);
      let following = '';
      try {
        if (!isObject(page) || page.users !== undefined && !Array.isArray(page.users) || page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string') throw new Error('FB_AUTH_RESPONSE_INVALID');
        const accounts = Array.isArray(page.users) ? page.users : [];
        following = page.nextPageToken || '';
        for (let position = 0; position < accounts.length; position++) {
          const raw = accounts[position];
          try {
            if (!isObject(raw) || !validUid(raw.localId) || usersByUid.has(raw.localId)) throw new Error('FB_AUTH_USER_ID_INVALID_OR_DUPLICATED');
            const uid = raw.localId;
            const category = providerCategory(raw.providerUserInfo === undefined ? [] : raw.providerUserInfo);
            const disabled = typeof raw.disabled === 'boolean' ? raw.disabled : null;
            usersByUid.set(uid, {uid, disabled, providerCategory: category});
          } finally {
            // Wipe provider and account fields, including PII, hashes, salts, tokens and unknown fields.
            scrubAccount(raw);
            accounts[position] = null;
          }
        }
        if (usersByUid.size > MAX_USERS) throw new Error('FB_INVENTORY_RECORD_LIMIT');
      } finally {
        if (Array.isArray(page?.users)) page.users.length = 0;
        discardObjectFields(page);
        page = null;
      }
      if (following && seenPageTokens.has(following)) throw new Error('FB_AUTH_PAGE_TOKEN_REPEATED');
      if (following) seenPageTokens.add(following);
      nextPageToken = following;
    } while (nextPageToken);
    accessToken = null;
    return {schemaVersion: 1, kind: 'FB_UID_COMPARISON_INDEX', projectId: FB,
      users: [...usersByUid.values()], pages};
  } finally {
    accessToken = null;
  }
}

function validateIndex(index, expectedKind, expectedProject) {
  if (!isObject(index) || index.schemaVersion !== 1 || index.kind !== expectedKind || index.projectId !== expectedProject || !Array.isArray(index.users)) throw new Error('FB_COMPARISON_INDEX_INVALID');
  const result = new Map();
  for (const user of index.users) {
    if (!isObject(user) || !validUid(user.uid) || result.has(user.uid)) throw new Error('FB_COMPARISON_INDEX_INVALID');
    const allowedKeys = expectedKind === 'FA_UID_COMPARISON_INDEX' ? ['uid', 'disabled', 'providerCategory', 'adminCategory', 'identityMarker'] : ['uid', 'disabled', 'providerCategory'];
    if (Object.keys(user).some(key => !allowedKeys.includes(key)) || allowedKeys.slice(0, 3).some(key => !Object.hasOwn(user, key))) throw new Error('FB_COMPARISON_INDEX_INVALID');
    if (user.disabled !== null && typeof user.disabled !== 'boolean') throw new Error('FB_COMPARISON_INDEX_INVALID');
    if (typeof user.providerCategory !== 'string' || !/^(?:NO_PROVIDER|PROVIDER_DATA_INVALID|GOOGLE_ONLY|GOOGLE_AND_PASSWORD|GOOGLE_AND_OTHER|GOOGLE_PASSWORD_AND_OTHER|PASSWORD_ONLY|PASSWORD_AND_OTHER|OTHER_PROVIDERS_ONLY)$/.test(user.providerCategory)) throw new Error('FB_COMPARISON_INDEX_INVALID');
    if (expectedKind === 'FA_UID_COMPARISON_INDEX' && (typeof user.adminCategory !== 'string' || !/^(?:ADMIN_ELIGIBLE|ADMIN_INACTIVE_OR_NO_ACCESS|NOT_ADMIN|PROFILE_REVIEW|PROFILE_MISSING)$/.test(user.adminCategory))) throw new Error('FB_COMPARISON_INDEX_INVALID');
    if (expectedKind === 'FA_UID_COMPARISON_INDEX' && user.identityMarker !== undefined && user.identityMarker !== null
      && !/^(?:STRUCTURAL_OWNER|HOMOLOGATION_CANDIDATE_1|HOMOLOGATION_CANDIDATE_2)$/.test(user.identityMarker)) throw new Error('FB_COMPARISON_INDEX_INVALID');
    result.set(user.uid, {uid: user.uid, disabled: user.disabled, providerCategory: user.providerCategory,
      ...(expectedKind === 'FA_UID_COMPARISON_INDEX' ? {identityMarker: user.identityMarker ?? null} : {})});
  }
  return result;
}

/** Only aggregate counts escape. Ambiguous provider/disabled metadata and FB-only UIDs go to review. */
export function compareFaFbIndexes(faIndex, fbIndex) {
  const fa = validateIndex(faIndex, 'FA_UID_COMPARISON_INDEX', 'sahmt-17a16');
  const fb = validateIndex(fbIndex, 'FB_UID_COMPARISON_INDEX', FB);
  const counts = {operational: emptyCounts(), homologation: {accounts: 0, presentInFb: 0, absentInFb: 0, review: 0},
    structural: {accounts: 0, presentInFb: 0, absentInFb: 0}};
  const markerCounts = new Map();
  for (const source of fa.values()) if (source.identityMarker === 'HOMOLOGATION_CANDIDATE_1' || source.identityMarker === 'HOMOLOGATION_CANDIDATE_2') {
    markerCounts.set(source.identityMarker, (markerCounts.get(source.identityMarker) || 0) + 1);
  }
  if ([...fa.values()].filter(source => source.identityMarker === 'STRUCTURAL_OWNER').length !== 1) throw new Error('FB_STRUCTURAL_OWNER_MARKER_UNVERIFIED');
  for (const [uid, source] of fa) {
    const destination = fb.get(uid);
    if (source.identityMarker === 'STRUCTURAL_OWNER') {
      counts.structural.accounts++;
      if (destination) counts.structural.presentInFb++;
      else counts.structural.absentInFb++;
      continue;
    }
    if (source.identityMarker === 'HOMOLOGATION_CANDIDATE_1' || source.identityMarker === 'HOMOLOGATION_CANDIDATE_2') {
      if (markerCounts.get(source.identityMarker) !== 1) { counts.homologation.review++; continue; }
      counts.homologation.accounts++;
      if (destination) counts.homologation.presentInFb++;
      else counts.homologation.absentInFb++;
      continue;
    }
    const ambiguous = source.disabled === null || destination?.disabled === null
      || source.providerCategory === 'NO_PROVIDER' || destination?.providerCategory === 'NO_PROVIDER'
      || source.providerCategory === 'PROVIDER_DATA_INVALID' || destination?.providerCategory === 'PROVIDER_DATA_INVALID';
    if (ambiguous) counts.operational.review++;
    else if (!destination) counts.operational.missing++;
    else if (source.disabled !== destination.disabled || source.providerCategory !== destination.providerCategory) counts.operational.conflicts++;
    else counts.operational.equivalent++;
  }
  for (const uid of fb.keys()) if (!fa.has(uid)) counts.operational.review++;
  return Object.freeze(counts);
}

/** Aggregate report for the requested inventory; never includes account identifiers. */
export function buildFbInventoryReport(faIndex, fbIndex) {
  const comparison = compareFaFbIndexes(faIndex, fbIndex);
  return Object.freeze({totalFbAccounts: fbIndex.users.length, operational: comparison.operational, homologation: comparison.homologation,
    structural: comparison.structural});
}

const DIAGNOSTIC_CATEGORIES = Object.freeze({STARTUP: 'LOCAL_VALIDATION', OUTPUT_DIRECTORY: 'LOCAL_OUTPUT', DPAPI_PREFLIGHT: 'LOCAL_DPAPI', FA_INDEX_READ: 'LOCAL_DPAPI',
  CLI_AUTH_LOAD: 'FIREBASE_CLI_AUTH', CLI_ACCOUNT_LOOKUP: 'FIREBASE_CLI_AUTH', OAUTH_TOKEN: 'OAUTH_TOKEN', AUTH_READ: 'AUTH_READ',
  DPAPI_FA_INDEX_OPEN: 'LOCAL_DPAPI', DPAPI_FB_INDEX_SEAL: 'LOCAL_DPAPI', LOCAL_INDEX_WRITE: 'LOCAL_OUTPUT', LOCAL_REPORT_WRITE: 'LOCAL_OUTPUT'});
const SAFE_CODES = new Set(['FB_INVENTORY_TAKES_NO_ARGUMENTS', 'FB_INVENTORY_OUTPUT_NOT_GIT_IGNORED', 'FB_INVENTORY_OUTPUT_PATH_INVALID',
  'FB_INVENTORY_OUTPUT_LINK_FORBIDDEN', 'FB_INVENTORY_PROTECTION_PROBE_FAILED', 'FB_INVENTORY_EXPECTED_ACCOUNT_LOGIN_REQUIRED',
  'FB_INVENTORY_OAUTH_SCOPE_INVALID', 'FB_READ_ACCESS_TOKEN_UNAVAILABLE', 'FB_INVENTORY_DEPENDENCIES_INVALID', 'FB_INVENTORY_TIME_LIMIT',
  'FB_INVENTORY_RECORD_LIMIT', 'FB_AUTH_REQUEST_FAILED', 'FB_AUTH_RESPONSE_INVALID', 'FB_AUTH_USER_ID_INVALID_OR_DUPLICATED',
  'FB_AUTH_PAGE_TOKEN_REPEATED', 'FB_AUTH_PAGE_LIMIT', 'FB_COMPARISON_INDEX_INVALID', 'FB_STRUCTURAL_OWNER_MARKER_UNVERIFIED']);

export function safeFbInventoryDiagnostic(stage, error) {
  const safeStage = Object.hasOwn(DIAGNOSTIC_CATEGORIES, stage) ? stage : 'STARTUP';
  const message = typeof error?.message === 'string' ? error.message : '';
  let category = DIAGNOSTIC_CATEGORIES[safeStage];
  const httpStatus = Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : null;
  if (httpStatus !== null) {
    category = ALLOWED_DIAGNOSTIC_CATEGORIES.has(error?.safeCategory) ? error.safeCategory
      : httpStatus === 400 ? 'AUTH_BAD_REQUEST_UNKNOWN' : (HTTP_CATEGORIES[httpStatus] || 'AUTH_HTTP_ERROR');
    return {stage: safeStage, httpStatus, category};
  }
  if (safeStage === 'OAUTH_TOKEN') {
    if (/invalid_scope|requires new authorization scopes/i.test(message)) category = 'OAUTH_TOKEN';
    else if (/invalid_grant|reauth|invalid credential/i.test(message)) category = 'OAUTH_TOKEN';
    else category = 'OAUTH_TOKEN';
  } else if (/^FB_AUTH_HTTP_(?:0|[1-5][0-9]{2})$/.test(message)) {
    category = 'AUTH_HTTP_ERROR';
  } else if (!SAFE_CODES.has(message)) {
    category = DIAGNOSTIC_CATEGORIES[safeStage];
  }
  if (!ALLOWED_DIAGNOSTIC_CATEGORIES.has(category)) category = 'AUTH_READ';
  return {stage: safeStage, httpStatus: null, category};
}

export const FB_INVENTORY_PRIVATE_OUTPUT = Object.freeze({directory: '.local-preview/management-split',
  indexPattern: 'fb-auth-index-<UTC_TIMESTAMP>.dpapi.json', reportPattern: 'fb-auth-comparison-<UTC_TIMESTAMP>-summary.json'});
