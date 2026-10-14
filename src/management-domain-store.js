import {db as identityDb} from './firebase.js';
import {loadEvaluationStore} from './evaluation-store.js';

export const managementDataProject = (import.meta.env || {}).VITE_MANAGEMENT_DATA_PROJECT || 'FA';

export async function managementDatabase(expectedUid) {
  if (!['FA','FB'].includes(managementDataProject)) throw new Error('MANAGEMENT_PROJECT_INVALID');
  if (managementDataProject === 'FA') return identityDb;
  const {auth} = await import('./firebase-auth.js');
  if (expectedUid && auth?.currentUser?.uid !== expectedUid) throw new Error('A sessão mudou. Entre novamente.');
  const store = await loadEvaluationStore({faDb:identityDb, auth, target:'FB'});
  store.assertSession();
  return store.db;
}

// The FB projection is server-owned. Never copy or write an FA user profile.
export function managementProfileCollection(database) {
  return database?.app?.options?.projectId === 'sahmt-gestao-5ae66' ? 'managementAuthorizationLeases' : 'users';
}
export function managementProfileData(database, snapshot) {
  const data = snapshot?.exists() ? snapshot.data() : null;
  if (!data || managementProfileCollection(database) === 'users') return data;
  const active = data.active === true && data.revoked === false && data.managementAllowed === true &&
    data.confirmedAtMs <= Date.now() && data.validUntilMs > Date.now();
  const admin = data.permissions?.managementManage === true && (data.permissions?.admin === true || data.role === 'administrador_app');
  return {...data, uid:data.faUid, active, access:active,
    role: data.role === 'administrador_app' && !admin ? 'profissional' : data.role,
    permissions:{...data.permissions, admin}};
}
