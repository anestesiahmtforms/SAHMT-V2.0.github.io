import {GoogleAuthProvider, signInWithPopup, signOut} from 'firebase/auth';

export function createFcModuleSession({auth, sourceUid, authApi = {GoogleAuthProvider, signInWithPopup, signOut}} = {}) {
  if (!auth || typeof sourceUid !== 'string' || !sourceUid
    || typeof authApi.GoogleAuthProvider !== 'function' || typeof authApi.signInWithPopup !== 'function'
    || typeof authApi.signOut !== 'function') throw new Error('FC_MODULE_AUTH_CONFIG_INVALID');

  const current = () => auth.currentUser?.uid === sourceUid ? auth.currentUser : null;
  async function connect() {
    const existing = current();
    if (existing) return existing;
    if (auth.currentUser) {
      try { await authApi.signOut(auth); } catch { throw new Error('FC_MODULE_SESSION_RESET_FAILED'); }
    }
    let credential;
    try { credential = await authApi.signInWithPopup(auth, new authApi.GoogleAuthProvider()); }
    catch { throw new Error('FC_MODULE_GOOGLE_SIGN_IN_FAILED'); }
    if (auth.currentUser !== credential?.user || credential.user?.uid !== sourceUid) {
      try { await authApi.signOut(auth); } catch {}
      throw new Error('FC_MODULE_UID_MISMATCH');
    }
    return credential.user;
  }
  return Object.freeze({current, connect});
}

export async function waitForFcModuleSession(container, {auth, sourceUid, title, isCurrent = () => true} = {}) {
  const session = createFcModuleSession({auth, sourceUid});
  await auth.authStateReady?.();
  if (session.current()) return auth;
  if (!container?.isConnected || !isCurrent()) return null;
  container.innerHTML = `<section class="management-area-detail"><h3>Conectar ao Firebase Registros</h3><p>Para abrir ${title}, confirme a mesma conta Google usada no app.</p><button class="primary-button" type="button" data-fc-module-login>Continuar com Google</button><p role="status" aria-live="polite" data-fc-module-status></p></section>`;
  const button = container.querySelector('[data-fc-module-login]'), status = container.querySelector('[data-fc-module-status]');
  button.disabled = false;
  button.addEventListener('click', async () => {
    if (!isCurrent() || !container.isConnected || button.disabled) return;
    button.disabled = true;
    status.textContent = 'Validando sua conta no Firebase Registros…';
    try {
      await session.connect();
      if (isCurrent() && container.isConnected) container.dispatchEvent(new CustomEvent('fc-module-authenticated'));
    } catch (error) {
      status.textContent = error.message === 'FC_MODULE_UID_MISMATCH'
        ? 'Esta conta não corresponde ao UID do app. Entre com a mesma conta Google.'
        : 'Não foi possível confirmar a conta no Firebase Registros. Tente novamente.';
      button.disabled = false;
    }
  });
  return await new Promise(resolve => {
    const cleanup = () => { container.removeEventListener('fc-module-authenticated', done); globalThis.removeEventListener?.('hashchange', finish); };
    const finish = () => { cleanup(); resolve(isCurrent() ? auth : null); };
    const done = () => finish();
    container.addEventListener('fc-module-authenticated', done, {once: true});
    globalThis.addEventListener?.('hashchange', finish, {once: true});
    if (!container.isConnected || !isCurrent()) finish();
  });
}
