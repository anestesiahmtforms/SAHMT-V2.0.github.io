import {GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged} from 'firebase/auth';
const defaultAuthApi={GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged};
async function boundedAuth(task,timeoutMs=12000){let timer;try{return await Promise.race([task,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('FC_MODULE_RESTORE_TIMEOUT')),timeoutMs);})]);}finally{clearTimeout(timer);}}

export function createFcModuleSession({auth, sourceUid, authApi = defaultAuthApi,timeoutMs=12000} = {}) {
  if (!auth || typeof sourceUid !== 'string' || !sourceUid
    || typeof authApi.GoogleAuthProvider !== 'function' || typeof authApi.signInWithPopup !== 'function'
    || typeof authApi.signOut !== 'function') throw new Error('FC_MODULE_AUTH_CONFIG_INVALID');

  const current = () => auth.currentUser?.uid === sourceUid ? auth.currentUser : null;
  async function connect() {
    const existing = current();
    if (existing) {
      await boundedAuth(existing.getIdToken?.(false),timeoutMs);
      if(current()!==existing)throw Error('FC_MODULE_UID_MISMATCH');
      return existing;
    }
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

export async function waitForFcModuleSession(container, {auth, sourceUid, title, isCurrent = () => true,authApi=defaultAuthApi,timeoutMs=12000,restoreSession} = {}) {
  const session = createFcModuleSession({auth, sourceUid,authApi,timeoutMs});
  const restore=()=>restoreSession?boundedAuth(Promise.resolve().then(restoreSession),timeoutMs):session.connect();
  try{
    if(restoreSession){if(await restore()&&session.current()&&isCurrent()&&container?.isConnected)return auth;}
    else{await boundedAuth(auth.authStateReady?.(),timeoutMs);if(session.current()){await restore();if(isCurrent())return auth;}}
  }catch{}
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
    let unsubscribe,observer,settled=false;
    const cleanup = () => { unsubscribe?.();observer?.disconnect();container.removeEventListener('fc-module-authenticated', done); globalThis.removeEventListener?.('hashchange', finish); };
    const finish = () => {if(settled)return;settled=true;cleanup();resolve(isCurrent()&&session.current()?auth:null);};
    const done = () => finish();
    container.addEventListener('fc-module-authenticated', done, {once: true});
    globalThis.addEventListener?.('hashchange', finish, {once: true});
    unsubscribe=authApi.onAuthStateChanged?.(auth,()=>{
      if(!container.isConnected||!isCurrent()){finish();return;}
      if(session.current())void restore().then(ready=>{if(ready)finish();},()=>{});
    });
    if(settled)unsubscribe?.();
    if(globalThis.MutationObserver&&globalThis.document?.body){observer=new MutationObserver(()=>{if(!container.isConnected||!isCurrent())finish();});observer.observe(document.body,{childList:true,subtree:true});if(settled)observer.disconnect();}
    if (!container.isConnected || !isCurrent()) finish();
  });
}
