import {db as identityDb} from './firebase.js';
import {loadEvaluationStore} from './evaluation-store.js';

import {deployment} from './deployment-context.js';
export const managementDataProject = deployment.target;
export const managementDataGeneration = deployment.generation;

export async function managementDatabase(expectedUid) {
  const {auth} = await import('./firebase-auth.js');
  if (expectedUid && auth?.currentUser?.uid !== expectedUid) throw new Error('A sessão mudou. Entre novamente.');
  const store = await loadEvaluationStore({faDb:identityDb, auth, target:deployment.target});
  store.assertSession();
  return store.db;
}

// Permissions originate in the existing FA profile; no lease is a user profile.
export function managementProfileCollection(database) {
  if(database?.app?.options?.projectId !== deployment.projectId)throw new Error('MANAGEMENT_PROJECT_INVALID');
  return 'users';
}
export function managementProfileData(database, snapshot) {
  const data = snapshot?.exists() ? snapshot.data() : null;
  managementProfileCollection(database);
  return data;
}
