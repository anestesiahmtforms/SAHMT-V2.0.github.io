import { VACCINATION_YEARS, validateVaccinationInput, isVaccinationAdmin, vaccinationProfileCategory, isVaccinationParticipant, buildVaccinationReport } from '../src/vaccination-domain.js';
import {assignedInstitutionalGroup,institutionalAssignmentKey,INSTITUTIONAL_GROUPS} from '../src/institutional-group.js';

const COLLECTION = 'occupationalVaccinations';
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const email = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(value)) && value.length <= 254;
const validUid = value => typeof value === 'string' && /^[A-Za-z0-9_.@+:%-]{1,128}$/.test(value) && !['.', '..'].includes(value);
const checkedIdentity = identity => {
  if (!identity || identity.emailVerified !== true || identity.provider !== 'google.com' || !validUid(identity.uid) || !validEmail(identity.email)) fail('VAC_UNAUTHENTICATED', 401);
  return { uid: identity.uid, email: email(identity.email), emailVerified:true, provider:'google.com' };
};
const recordFields = ['uid', 'email', 'displayName', 'year', 'category', 'awareness', 'truth', 'states', 'declaration', 'notes', 'version', 'createdAt', 'updatedAt'];
const publicRecord = record => record ? Object.fromEntries(recordFields.filter(key => record[key] !== undefined).map(key => [key, structuredClone(record[key])])) : null;
const displayName = (profile, identity) => String(profile.displayName || profile.name || identity.email).slice(0, 200);
const checkedRecord = (record, uid, year, expectedEmail) => {
  if (record && (record.uid !== uid || record.year !== year || !Number.isSafeInteger(record.version) || record.version < 1 ||
      (expectedEmail && Object.hasOwn(record, 'email') && email(record.email) !== expectedEmail))) fail('VAC_RECORD_INVALID', 503);
  return publicRecord(record);
};

export function createVaccinationService({ store, now = Date.now, adminDriveFolderUrl, authorizeAccess=async()=>{}, eligibleParticipant=isVaccinationParticipant, onSaved=async()=>{} } = {}) {
  if (!store || !['get', 'list', 'transaction'].every(method => typeof store[method] === 'function')) throw new TypeError('VAC_STORE_REQUIRED');
  async function authorize(tx, identity, admin = false) {
    const profile = await tx.get('users', identity.uid);
    if (!profile || profile.active !== true || profile.access !== true || ('uid' in profile && profile.uid !== identity.uid) || ('email' in profile && email(profile.email) !== identity.email) || (admin && !isVaccinationAdmin(profile))) fail('VAC_FORBIDDEN', 403);
    await authorizeAccess(tx,identity,profile);
    return profile;
  }
  async function execute(action, input, principal) {
    const identity = checkedIdentity(principal);
    if (!['BOOTSTRAP', 'SAVE', 'REPORT', 'DETAIL'].includes(action) || !input || typeof input !== 'object' || Array.isArray(input)) fail('VAC_INVALID_INPUT');
    let validated;
    if (action === 'SAVE') validated = validateVaccinationInput(input);
    else {
      const fields = action === 'DETAIL' ? ['year', 'uid'] : ['year'];
      if (Object.keys(input).length !== fields.length || !fields.every(field => Object.hasOwn(input, field)) ||
          !VACCINATION_YEARS.includes(input.year) || (action === 'DETAIL' && !validUid(input.uid))) fail('VAC_INVALID_INPUT');
    }
    const year = input.year, key = `${identity.uid}_${year}`;
    if (action === 'DETAIL') {
      const uid = input.uid;
      const record = await store.transaction(async tx => {
        const adminProfile = await authorize(tx, identity, true);
        const profile = uid === identity.uid ? adminProfile : await tx.get('users', uid);
        if (profile?.uid !== uid || profile.active !== true || profile.access !== true || !validEmail(profile.email)) fail('VAC_FORBIDDEN', 403);
        const targetEmail = email(profile.email);
        const assignment = await tx.get('userCategories', await institutionalAssignmentKey(targetEmail));
        if (!assignedInstitutionalGroup(assignment, { uid, email: targetEmail }) ||
            !eligibleParticipant({ ...profile, memberCategories: assignment.memberCategories })) fail('VAC_FORBIDDEN', 403);
        return checkedRecord(await tx.get(COLLECTION, `${uid}_${year}`), uid, year, targetEmail);
      });
      // A role revoked during the record read must prevent data release.
      await store.transaction(tx => authorize(tx, identity, true));
      return { record };
    }
    if (action === 'REPORT') {
      await store.transaction(tx => authorize(tx, identity, true));
      const [profiles, allRecords, assignments] = await Promise.all([
        store.list('users', [], 1000), store.list(COLLECTION, [{ field: 'year', op: 'EQUAL', value: year }], 1000), store.list('userCategories', [], 1000),
      ]);
      const byKey = new Map(assignments.map(a=>[a.id,a]));
      const classified = await Promise.all(profiles.map(async profile => {
        const principal={uid:profile.uid||profile.id,email:email(profile.email)};
        const assignment=byKey.get(await institutionalAssignmentKey(principal.email));
        return {...profile,memberCategories:assignedInstitutionalGroup(assignment,principal)?assignment.memberCategories:[]};
      }));
      const participants = classified.filter(profile => eligibleParticipant(profile) && validUid(profile.uid || profile.id) && (!profile.uid || !profile.id || profile.uid === profile.id)).map(profile => {
        const category = vaccinationProfileCategory(profile);
        return { uid: profile.uid || profile.id, email: email(profile.email), displayName: displayName(profile, { email: email(profile.email) }), active: true, access: true, memberCategories:profile.memberCategories, ...(category ? { category } : {}) };
      });
      const participantIds = new Set(participants.map(profile => profile.uid));
      const records = allRecords.filter(record => record.year === year && participantIds.has(record.uid) && (!record.id || record.id === `${record.uid}_${year}`)).map(publicRecord);
      const report = buildVaccinationReport(participants, records, year);
      // A role revoked during the collection reads must prevent data release.
      await store.transaction(tx => authorize(tx, identity, true));
      return { participants, records, report, ...(/^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,}$/.test(adminDriveFolderUrl || '') ? {adminDriveFolderUrl} : {}) };
    }
    return store.transaction(async tx => {
      const profile = await authorize(tx, identity);
      const assignment=await tx.get('userCategories',await institutionalAssignmentKey(identity.email));
      const category=INSTITUTIONAL_GROUPS[assignedInstitutionalGroup(assignment,identity)] || null;
      const existing = checkedRecord(await tx.get(COLLECTION, key), identity.uid, year);
      if (action === 'BOOTSTRAP') {
        return { record: existing, isAdmin: isVaccinationAdmin(profile), profile: { displayName: displayName(profile, identity), email: identity.email, ...(category ? { category } : {}) } };
      }
      if(!category)fail('VAC_CATEGORY_NOT_CONFIGURED',422);
      if ((existing?.version || 0) !== validated.expectedVersion) fail('VAC_VERSION_CONFLICT', 409);
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError('VAC_CLOCK_INVALID');
      const { expectedVersion, ...fields } = validated;
      const record = { ...fields, category, uid: identity.uid, email: identity.email, displayName: displayName(profile, identity),
        version: expectedVersion + 1, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
      await onSaved(tx,record,existing);
      if (existing) tx.set(COLLECTION, key, record); else tx.create(COLLECTION, key, record);
      return { record };
    });
  }
  return { execute };
}
