const MARKERS = Object.freeze(['STRUCTURAL_OWNER', 'HOMOLOGATION_CANDIDATE_1', 'HOMOLOGATION_CANDIDATE_2']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128
  && !/[\s/\x00-\x1f]/.test(value);
const validEmail = value => typeof value === 'string' && value.length <= 254
  && value === value.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const deny = code => { throw new Error(code); };

/** Server-only policy schema. Callers must source this object from trusted server configuration. */
export function validateManagementProtectedIdentityPolicy(value) {
  if (!exactKeys(value, ['schemaVersion', 'identities']) || value.schemaVersion !== 1
    || !Array.isArray(value.identities) || value.identities.length !== MARKERS.length)
    deny('AUTH_IDENTITY_POLICY_UNAVAILABLE');
  const seenMarkers = new Set(), seenUids = new Set(), seenEmails = new Set();
  const identities = value.identities.map(entry => {
    if (!exactKeys(entry, ['marker', 'uid', 'email']) || !MARKERS.includes(entry.marker)
      || !validId(entry.uid) || !validEmail(entry.email) || seenMarkers.has(entry.marker)
      || seenUids.has(entry.uid) || seenEmails.has(entry.email)) deny('AUTH_IDENTITY_POLICY_INVALID');
    seenMarkers.add(entry.marker); seenUids.add(entry.uid); seenEmails.add(entry.email);
    return Object.freeze({marker: entry.marker, uid: entry.uid, email: entry.email});
  });
  if (MARKERS.some(marker => !seenMarkers.has(marker))) deny('AUTH_IDENTITY_POLICY_INVALID');
  return Object.freeze({schemaVersion: 1, identities: Object.freeze(identities)});
}

/** Matches a trusted FA Auth projection against UID and email together; mismatches fail closed. */
export function managementProtectedIdentityMarker({uid, email}, policy) {
  const trusted = validateManagementProtectedIdentityPolicy(policy);
  if (!validId(uid) || typeof email !== 'string') deny('AUTH_IDENTITY_POLICY_INVALID');
  const normalizedEmail = email.trim().toLowerCase();
  const byUid = trusted.identities.filter(entry => entry.uid === uid);
  const byEmail = trusted.identities.filter(entry => entry.email === normalizedEmail);
  if (byUid.length > 1 || byEmail.length > 1 || (byUid.length === 0) !== (byEmail.length === 0)
    || (byUid.length && byUid[0].marker !== byEmail[0].marker)) deny('AUTH_IDENTITY_POLICY_MISMATCH');
  return byUid.length ? byUid[0].marker : null;
}

export const MANAGEMENT_PROTECTED_IDENTITY_MARKERS = MARKERS;
