import {doc, getDocFromServer} from 'firebase/firestore';
import {db} from './firebase.js';
import {assignedInstitutionalGroup} from './institutional-group.js';

const ADMIN_EMAIL = 'wx2064@gmail.com';
const MANAGER_EMAIL = 'marcio.henrique82@gmail.com';
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const sessionEligibility = new WeakMap();

/** Auth coordination uses the same FA eligibility check as the module menu. */
export function functionalSessionEligible(user) {
  if(!user?.uid)return Promise.resolve(false);
  const prior=sessionEligibility.get(user);
  if(prior&&Date.now()-prior.at<60000)return prior.promise;
  const promise=(async()=>{
    const snapshot=await getDocFromServer(doc(db,'users',user.uid));
    const access=await getFunctionalAccess({status:'signed-in',user,profile:snapshot.exists()?snapshot.data():null});
    if(access.allowed)return true;
    if(['PROFILE_INACTIVE','GROUP_NOT_ALLOWED'].includes(access.code))return false;
    throw Object.assign(new Error('AUTH_UNAVAILABLE'),{code:'AUTH_UNAVAILABLE'});
  })();
  const entry={at:Date.now(),promise};sessionEligibility.set(user,entry);
  promise.catch(()=>{if(sessionEligibility.get(user)===entry)sessionEligibility.delete(user);});
  return promise;
}

async function ownCategoryAssignment(user) {
  const email = normalizeEmail(user?.email);
  if (!db || !user?.uid || user.emailVerified !== true || !email) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(email)));
  const id = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const snapshot = await getDocFromServer(doc(db, 'userCategories', id));
  if (!snapshot.exists()) return null;
  const row = snapshot.data();
  if (row.schemaVersion !== 1 || row.identityStatus !== 'LINKED' || row.uid !== user.uid
    || normalizeEmail(row.email) !== email || !Array.isArray(row.memberCategories)) return null;
  return row;
}

/** Checks the FA roster category before showing or opening the individual FK module. */
export async function getFunctionalAccess(session) {
  const user = session?.user, profile = session?.profile;
  if (session?.status !== 'signed-in' || !user?.uid || profile?.uid !== user.uid
    || profile?.active !== true || profile?.access !== true) return Object.freeze({allowed: false, code: 'PROFILE_INACTIVE'});
  const email = normalizeEmail(user.email);
  if (user.emailVerified === true && normalizeEmail(profile.email) === ADMIN_EMAIL && email === ADMIN_EMAIL)
    return Object.freeze({allowed: true, group: 'ADMINISTRADOR', admin: true});
  if (user.emailVerified === true && normalizeEmail(profile.email) === MANAGER_EMAIL && email === MANAGER_EMAIL
    && profile.role === 'gestor')
    return Object.freeze({allowed: true, group: 'GESTOR', admin: false});
  try {
    const assignment = await ownCategoryAssignment(user);
    if (assignedInstitutionalGroup(assignment, {uid:user.uid,email}) === 'team')
      return Object.freeze({allowed: true, group: 'EQUIPE', admin: false});
    return Object.freeze({allowed: false, code: assignment ? 'GROUP_NOT_ALLOWED' : 'TEAM_ASSIGNMENT_MISSING'});
  } catch {
    return Object.freeze({allowed: false, code: 'TEAM_ASSIGNMENT_UNAVAILABLE'});
  }
}
