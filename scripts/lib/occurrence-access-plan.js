/** Exact additive FA permission patch. FC/broker remains the enforcement layer. */
export function planOccurrenceAccess({sourceUsers, profiles, excludedUids = [], protectedUids = []}) {
  const users = new Map();
  for (const u of sourceUsers) {
    if (!u?.uid || users.has(u.uid)) throw new Error('AUTH_UID_INVALID'); users.set(u.uid,u);
  }
  const skip = new Set([...excludedUids,...protectedUids]);
  if ([...skip].some(uid=>!users.has(uid))) throw new Error('PROTECTED_UID_UNCONFIRMED');
  const writes=[],seen=new Set();
  for (const p of profiles) {
    if (!p?.uid || seen.has(p.uid)) throw new Error('PROFILE_UID_INVALID'); seen.add(p.uid);
    const u=users.get(p.uid);
    if (skip.has(p.uid)||!u||u.disabled!==false||p.active!==true||p.access!==true) continue;
    if (!u.email || String(p.email||'').trim().toLowerCase()!==u.email.trim().toLowerCase()) throw new Error('PROFILE_IDENTITY_CONFLICT');
    if (p.permissions?.occurrencesWrite===true) continue;
    if (!p.updateTime || !p.permissions || typeof p.permissions!=='object' || Array.isArray(p.permissions)) throw new Error('PROFILE_REVIEW_REQUIRED');
    writes.push({update:{name:`projects/sahmt-17a16/databases/(default)/documents/users/${u.uid}`,
      fields:{permissions:{mapValue:{fields:{occurrencesWrite:{booleanValue:true}}}}}},
      updateMask:{fieldPaths:['permissions.occurrencesWrite']},currentDocument:{updateTime:p.updateTime},
      updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]});
  }
  return {writes,counts:{profiles:profiles.length,additions:writes.length,protected:protectedUids.length,excluded:excludedUids.length}};
}
