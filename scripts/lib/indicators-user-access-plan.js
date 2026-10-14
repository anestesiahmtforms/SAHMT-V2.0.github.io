import {planManagementUserAccess, managementIdentityImportRequest} from './management-user-access-plan.js';

/** FC access is already issued by the broker from active/access in FA.
 * Only provision missing identities. Never manufacture profile approval/admin claims. */
export function planIndicatorsUserAccess({sourceUsers, destinationUsers, profiles, excludedUids = []}) {
  const excluded = new Set(excludedUids), profileMap = new Map();
  for (const p of profiles) {
    if (!p?.uid || profileMap.has(p.uid)) throw new Error('PROFILE_IDENTITY_AMBIGUOUS');
    profileMap.set(p.uid, p);
  }
  const eligible = [], review = [], inactive = [], preserved = [];
  for (const u of sourceUsers) {
    if (excluded.has(u.uid)) { preserved.push(u.uid); continue; }
    const p = profileMap.get(u.uid);
    if (!p || !u.email || String(p.email || '').trim().toLowerCase() !== u.email.trim().toLowerCase()) { review.push(u.uid); continue; }
    if (u.disabled !== false || p.active !== true || p.access !== true) { inactive.push(u.uid); continue; }
    eligible.push(u);
  }
  // Include all source users when checking identity conflicts, even excluded profiles.
  const checked = planManagementUserAccess({sourceUsers, destinationUsers, profiles, excludedUids, protectedProfileUids: sourceUsers.map(u=>u.uid)});
  // Existing custom-token-only identities may have no email at all. The broker
  // already validates the exact FA UID, not a destination email/password login.
  // Recognize this state explicitly; never write or fabricate an email in FC.
  for (const entry of checked.entries) {
    const source = sourceUsers.find(u=>u.uid===entry.uid), existing = destinationUsers.find(u=>u.uid===entry.uid);
    if (entry.code === 'EXISTING_IDENTITY_OR_STATE_CONFLICT' && existing?.email === '' &&
      existing.providerData?.length === 0 && existing.disabled === source?.disabled) {
      entry.account = 'EXISTING'; entry.code = 'CUSTOM_TOKEN_UID_ONLY';
    }
  }
  const ids = new Set(eligible.map(u=>u.uid));
  const entries = checked.entries.filter(e=>ids.has(e.uid));
  const plan = {...checked, destinationProjectId:'indicadores---sahmt', entries,
    createUsers:checked.createUsers.filter(u=>ids.has(u.localId)), permissionUpdates:[], reviewUids:review, inactiveUids:inactive, preservedUids:preserved};
  plan.counts = {source:sourceUsers.length, destination:destinationUsers.length, eligible:eligible.length,
    existing:entries.filter(e=>e.account==='EXISTING').length, create:plan.createUsers.length,
    conflicts:entries.filter(e=>e.account==='CONFLICT').length, uidOnly:entries.filter(e=>e.code==='CUSTOM_TOKEN_UID_ONLY').length,
    review:review.length+entries.filter(e=>e.account==='REVIEW').length, inactive:inactive.length, excluded:preserved.length};
  return plan;
}
export function indicatorsIdentityImportRequest(plan) {
  if (plan?.destinationProjectId !== 'indicadores---sahmt' || plan.permissionUpdates?.length || plan.entries?.some(e=>e.account==='REVIEW')) throw new Error('FC_IMPORT_PLAN_INVALID');
  return managementIdentityImportRequest({...plan,destinationProjectId:'sahmt-gestao-5ae66'});
}
