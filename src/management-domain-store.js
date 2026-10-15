import {db as identityDb} from './firebase.js';
import {loadEvaluationStore} from './evaluation-store.js';

export const managementDataProject = 'FA';
export const managementDataGeneration = 'FA_CONSOLIDATED_V1';

export async function managementDatabase(expectedUid) {
  const {auth} = await import('./firebase-auth.js');
  if (expectedUid && auth?.currentUser?.uid !== expectedUid) throw new Error('A sessão mudou. Entre novamente.');
  const store = await loadEvaluationStore({faDb:identityDb, auth, target:'FA'});
  store.assertSession();
  return store.db;
}

// Permissions originate in the existing FA profile; no lease is a user profile.
export function managementProfileCollection(database) {
  if(database?.app?.options?.projectId !== 'sahmt-17a16')throw new Error('MANAGEMENT_PROJECT_INVALID');
  return 'users';
}
export function managementProfileData(database, snapshot) {
  const data = snapshot?.exists() ? snapshot.data() : null;
  managementProfileCollection(database);
  return data;
}
