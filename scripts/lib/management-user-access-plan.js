// Pure planning: no credentials, network, persistence or account mutations.
// Names and identifiers returned here belong only in the private execution file.
const fail = code => { throw new Error(code); };
const text = value => typeof value === 'string' && value.length > 0;
const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validUid = value => text(value) && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
export const COMMON_MANAGEMENT_PERMISSIONS = Object.freeze(['managementRead', 'trainingsRead']);

export function sanitizeManagementAuthUser(raw) {
  if (!validUid(raw?.localId)) fail('AUTH_UID_INVALID');
  if (raw.disabled !== undefined && typeof raw.disabled !== 'boolean') fail('AUTH_STATE_INVALID');
  return {
    uid: raw.localId, email: typeof raw.email === 'string' ? raw.email : '',
    displayName: typeof raw.displayName === 'string' ? raw.displayName : '',
    disabled: raw.disabled === true, emailVerified: raw.emailVerified === true,
    providerData: (Array.isArray(raw.providerUserInfo) ? raw.providerUserInfo : []).map(provider => ({
      providerId: provider.providerId, uid: provider.rawId,
      ...(typeof provider.email === 'string' ? {email: provider.email} : {})
    }))
  };
}

function index(users) {
  if (!Array.isArray(users)) fail('AUTH_USERS_REQUIRED');
  const uids = new Map(), emails = new Map();
  for (const user of users) {
    if (!validUid(user?.uid) || uids.has(user.uid)) fail('AUTH_UID_DUPLICATE_OR_INVALID');
    uids.set(user.uid, user);
    for (const address of new Set([user.email, ...(user.providerData || []).map(p => p.email)].map(emailKey).filter(Boolean))) {
      if (!emails.has(address)) emails.set(address, new Set());
      emails.get(address).add(user.uid);
    }
  }
  return {uids, emails};
}

export function planManagementUserAccess({sourceUsers, destinationUsers, profiles, excludedUids = [], protectedProfileUids = []}) {
  const source = index(sourceUsers), destination = index(destinationUsers);
  if (!Array.isArray(profiles) || !Array.isArray(excludedUids) || !Array.isArray(protectedProfileUids)) fail('PROFILE_PLAN_INVALID');
  const profileMap = new Map();
  for (const profile of profiles) {
    if (!validUid(profile?.uid) || profileMap.has(profile.uid)) fail('PROFILE_UID_DUPLICATE_OR_INVALID');
    profileMap.set(profile.uid, profile);
  }
  if ([...excludedUids, ...protectedProfileUids].some(uid => !source.uids.has(uid))) fail('PROTECTED_UID_UNCONFIRMED');
  const excluded = new Set(excludedUids), protectedProfiles = new Set(protectedProfileUids);
  const entries = [], createUsers = [], permissionUpdates = [];
  for (const user of sourceUsers) {
    const entry = {uid: user.uid, account: 'REVIEW', access: 'UNCHANGED', code: null};
    entries.push(entry);
    if (excluded.has(user.uid)) { entry.account = 'EXCLUDED'; entry.code = 'HOMOLOGATION_PRESERVED'; continue; }
    const address = emailKey(user.email), existing = destination.uids.get(user.uid);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { entry.code = 'EMAIL_REVIEW_REQUIRED'; continue; }
    if (source.emails.get(address)?.size !== 1 || [...(destination.emails.get(address) || [])].some(uid => uid !== user.uid)) {
      entry.account = 'CONFLICT'; entry.code = 'EMAIL_UID_CONFLICT'; continue;
    }
    if (existing && (emailKey(existing.email) !== address || existing.disabled !== user.disabled)) {
      entry.account = 'CONFLICT'; entry.code = 'EXISTING_IDENTITY_OR_STATE_CONFLICT'; continue;
    }
    if (existing) entry.account = 'EXISTING';
    else {
      entry.account = 'CREATE';
      // Secondary sessions use the FA-issued custom-token flow; no password,
      // hash, custom claims or Google credential is transferred.
      createUsers.push({localId: user.uid, email: user.email, emailVerified: user.emailVerified,
        disabled: user.disabled, ...(user.displayName ? {displayName: user.displayName} : {})});
    }
    const profile = profileMap.get(user.uid);
    if (!profile || emailKey(profile.email) !== address) { entry.code = 'PROFILE_IDENTITY_REVIEW'; continue; }
    if (user.disabled || profile.active !== true || profile.access !== true) { entry.code = 'INACTIVE_PRESERVED'; continue; }
    if (protectedProfiles.has(user.uid)) { entry.code = 'PROTECTED_PROFILE_PRESERVED'; continue; }
    if (!profile.updateTime || !profile.permissions || typeof profile.permissions !== 'object' || Array.isArray(profile.permissions)) {
      entry.code = 'PROFILE_PERMISSIONS_REVIEW'; continue;
    }
    const additions = COMMON_MANAGEMENT_PERMISSIONS.filter(key => profile.permissions[key] !== true);
    if (!additions.length) { entry.access = 'READY'; continue; }
    entry.access = 'ADD_COMMON_ACCESS';
    permissionUpdates.push({uid: user.uid, updateTime: profile.updateTime, additions});
  }
  const counts = {source: sourceUsers.length, destination: destinationUsers.length, create: createUsers.length,
    existing: entries.filter(e => e.account === 'EXISTING').length,
    excluded: entries.filter(e => e.account === 'EXCLUDED').length,
    conflicts: entries.filter(e => e.account === 'CONFLICT').length,
    review: entries.filter(e => e.account === 'REVIEW' || ['PROFILE_IDENTITY_REVIEW','PROFILE_PERMISSIONS_REVIEW'].includes(e.code)).length,
    permissionUpdates: permissionUpdates.length, accessAlreadyReady: entries.filter(e => e.access === 'READY').length,
    inactivePreserved: entries.filter(e => e.code === 'INACTIVE_PRESERVED').length,
    protectedProfilesPreserved: entries.filter(e => e.code === 'PROTECTED_PROFILE_PRESERVED').length};
  return {schemaVersion: 1, sourceProjectId: 'sahmt-17a16', destinationProjectId: 'sahmt-gestao-5ae66',
    counts, entries, createUsers, permissionUpdates};
}

export function managementIdentityImportRequest(plan) {
  if (plan?.sourceProjectId !== 'sahmt-17a16' || plan.destinationProjectId !== 'sahmt-gestao-5ae66' ||
    plan.counts?.conflicts || !Array.isArray(plan.createUsers) || plan.createUsers.length > 1000) fail('IMPORT_PLAN_NOT_READY');
  const allowed = ['localId','email','emailVerified','disabled','displayName'];
  if (plan.createUsers.some(u => Object.keys(u).some(k => !allowed.includes(k)) || !validUid(u.localId))) fail('IMPORT_FIELDS_FORBIDDEN');
  return {hashAlgorithm: 'BCRYPT', sanityCheck: true, allowOverwrite: false, users: structuredClone(plan.createUsers)};
}

export function managementPermissionWrites(plan) {
  if (plan?.sourceProjectId !== 'sahmt-17a16' || plan.destinationProjectId !== 'sahmt-gestao-5ae66' || plan.counts?.conflicts) fail('ACCESS_PLAN_NOT_READY');
  return plan.permissionUpdates.map(update => {
    if (!validUid(update.uid) || !text(update.updateTime) || !update.additions.length ||
      update.additions.some(key => !COMMON_MANAGEMENT_PERMISSIONS.includes(key))) fail('PERMISSION_ADDITION_FORBIDDEN');
    return {update: {name: `projects/sahmt-17a16/databases/(default)/documents/users/${update.uid}`,
      fields: {permissions: {mapValue: {fields: Object.fromEntries(update.additions.map(key => [key, {booleanValue: true}]))}}}},
      updateMask: {fieldPaths: update.additions.map(key => `permissions.${key}`)},
      currentDocument: {updateTime: update.updateTime},
      updateTransforms: [{fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME'}]};
  });
}
