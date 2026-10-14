/** One authoritative evaluation database. Never read both projects or fall back
 * to FA after an FB error. Identity and permissions continue to originate in FA. */
export async function resolveEvaluationStore({faDb, auth, sdk, target = 'FA', loadSecondary}) {
  if (!faDb || !['FA', 'FB'].includes(target)) throw new Error('EVALUATION_STORE_CONFIGURATION_INVALID');
  const user = auth?.currentUser;
  const assertCurrent = () => {
    if (!user || auth.currentUser !== user || !user.uid) throw new Error('A sessão expirou. Entre novamente.');
  };
  assertCurrent();
  let db = faDb, secondary;
  if (target === 'FB') {
    if (typeof loadSecondary !== 'function') throw new Error('EVALUATION_FB_UNAVAILABLE');
    secondary = await loadSecondary(user.uid);
    assertCurrent();
    if (!secondary?.db || secondary.db.app?.options?.projectId !== 'sahmt-gestao-5ae66' || secondary.auth?.currentUser?.uid !== user.uid)
      throw new Error('EVALUATION_FB_IDENTITY_MISMATCH');
    db = secondary.db;
  }
  const assertSession = () => {
    assertCurrent();
    if (secondary && secondary.auth?.currentUser?.uid !== user.uid) throw new Error('EVALUATION_FB_SESSION_ENDED');
  };
  return {db, identityDb: faDb, sdk, auth, assertSession, target};
}

export async function loadEvaluationStore({faDb, auth, sdk}) {
  const env = import.meta.env || {};
  return resolveEvaluationStore({faDb, auth, sdk, target: env.VITE_EVALUATION_DATA_PROJECT || 'FA', loadSecondary: async uid => {
    const [{getFirebaseProjectAuthOptIn}, {getManagementApp, getManagementFirestore}, authSdk] = await Promise.all([
      import('./firebase-project-auth-browser.js'), import('./management-firebase-app.js'), import('firebase/auth')
    ]);
    const app = getManagementApp();
    if (!app) throw new Error('EVALUATION_FB_DISABLED');
    let secondaryAuth;
    try { secondaryAuth = authSdk.initializeAuth(app, {persistence: authSdk.inMemoryPersistence}); }
    catch (error) { if (error?.code !== 'auth/already-initialized') throw error; secondaryAuth = authSdk.getAuth(app); }
    if (secondaryAuth.currentUser?.uid !== uid) {
      const result = await getFirebaseProjectAuthOptIn().connect(['FB']);
      if (result?.targets?.FB?.status !== 'ready') throw new Error('EVALUATION_FB_UNAVAILABLE');
    }
    return {auth: secondaryAuth, db: getManagementFirestore()};
  }});
}
