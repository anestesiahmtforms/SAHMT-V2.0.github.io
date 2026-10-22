/** Consolidated store: the existing FA session is the only identity and the
 * default FA database is the only data authority. No secondary auth or lease. */
import {deployment} from './deployment-context.js';
export async function resolveEvaluationStore({faDb, auth, sdk, target = deployment.target}) {
  if (target !== deployment.target || faDb?.app?.options?.projectId !== deployment.projectId) throw new Error('EVALUATION_STORE_CONFIGURATION_INVALID');
  const user = auth?.currentUser;
  const assertCurrent = () => {
    if (!user || auth.currentUser !== user || !user.uid) throw new Error('A sessão expirou. Entre novamente.');
  };
  assertCurrent();
  return {db:faDb, identityDb:faDb, sdk, auth, assertSession:assertCurrent, target:deployment.target};
}

export async function loadEvaluationStore({faDb, auth, sdk, target}) {
  return resolveEvaluationStore({faDb,auth,sdk,target:target || deployment.target});
}
