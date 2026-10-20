import {firebaseConfigured} from './firebase-app.js';
import {cacheProfile, clearUserLocalData, pendingOperationCount, pendingTrainingProgressCount, readCachedProfile} from './outbox.js';
import {profileForPresentation} from './profile-presentation.js';
import {reconcileFirebaseSecondarySessions, signOutAllFirebaseProjects} from './firebase-secondary-session-lifecycle.js';
import {isManagementFaFirstLoginPending, observeManagementFaFirstLoginAuthUid,
  subscribeManagementFaFirstLoginPending} from './management-fa-first-login-state.js';
import {createManagementGoogleLogin} from './management-google-login.js';
import {managementFaFirstLoginConfig} from './management-fa-first-login-config.js';
import {isFirestoreCacheFallbackError} from './offline-cache.js';
import {operationalBackend} from './operational-backend.js';

let retryCurrentProfile = null;
const TEMPORARY_PROFILE_READ_CODES = new Set(['unavailable','deadline-exceeded','network-request-failed','resource-exhausted']);

function isTemporaryProfileReadFailure(error) {
  const code=String(error?.code||'').toLowerCase().split('/').pop();
  return TEMPORARY_PROFILE_READ_CODES.has(code);
}

function isExplicitProfileAccessDenial(error) {
  const code=String(error?.code||'').toLowerCase().split('/').pop();
  return code==='permission-denied'||code==='unauthenticated';
}
let authApiPromise = null;
let firstLoginRuntimePromise = null;

async function loadFirstLoginRuntime(api) {
  if (!managementFaFirstLoginConfig.enabled) return null;
  if (!firstLoginRuntimePromise) {
    firstLoginRuntimePromise = Promise.all([
      import('./management-fa-first-login.js'),
      import('./management-fa-first-login-transport.js'),
      import('./management-fa-google-identity.js')
    ]).then(([flowModule, transportModule, identityModule]) => {
      const endpoint = managementFaFirstLoginConfig.endpoint;
      const clientId = managementFaFirstLoginConfig.googleClientId;
      const brokerOrigin = managementFaFirstLoginConfig.allowedBrokerOrigin;
      const endpointUrl = new URL(endpoint);
      if (!brokerOrigin || endpointUrl.origin !== brokerOrigin) throw new Error('FIRST_LOGIN_ORIGIN_INVALID');
      const transport = transportModule.createManagementFaFirstLoginTransport({enabled: true,
        endpoint: endpointUrl.href, allowedBrokerOrigins: [brokerOrigin], fetchImpl: globalThis.fetch?.bind(globalThis)});
      const requestGoogleIdToken = identityModule.createGoogleIdentityTokenRequester({clientId});
      const flow = flowModule.createManagementFaFirstLoginFlow({enabled: true, auth: api.auth,
        requestGoogleIdToken, claimFirstLogin: transport.claimFirstLogin,
        googleCredential: flowModule.createGoogleCredentialFactory(api.GoogleAuthProvider),
        signInWithCustomToken: api.signInWithCustomToken, signInWithCredential: api.signInWithCredential,
        linkWithCredential: api.linkWithCredential, reload: api.reload, signOut: api.signOut});
      return Object.freeze({flow, transport});
    }).catch(error => { firstLoginRuntimePromise = null; throw error; });
  }
  return firstLoginRuntimePromise;
}

function loadAuthApi() {
  if (!authApiPromise) {
    authApiPromise = Promise.all([import('firebase/auth'), import('./firebase-auth.js')])
      .then(([api, {auth}]) => ({...api, auth}))
      .catch((error) => { authApiPromise = null; throw error; });
  }
  return authApiPromise;
}

async function showCachedSession(user, onState, isCurrent = () => true) {
  let profile;
  try {profile = await readCachedProfile(user.uid);}
  catch {
    if (isCurrent()) showAuthLimitedSession(user, onState, false, 'LOCAL_STORAGE_UNAVAILABLE');
    return;
  }
  if (!isCurrent()) return;
  if (!profile || profile.uid !== user.uid) {
    showAuthLimitedSession(user, onState, false, 'LOCAL_PROFILE_UNAVAILABLE');
    return;
  }
  onState({status: profile.active === true && profile.access === true ? 'signed-in' : 'blocked', user, profile: profileForPresentation(profile, user), offline: true});
}

function profileReadFailureCode(error) {
  const code = String(error?.code || '').toLowerCase().split('/').pop();
  if (code === 'permission-denied') return 'PROFILE_PERMISSION_DENIED';
  if (code === 'unauthenticated') return 'PROFILE_AUTH_REQUIRED';
  return 'PROFILE_READ_FAILED';
}

function showAuthLimitedSession(user, onState, validatingProfile=false, profileFailureCode='') {
  onState({status:'auth-limited',user,offline:true,validatingProfile,profileFailureCode,profile:{uid:user.uid,email:user.email||'',displayName:user.displayName||'Usuário',sigla:'',phone:'',active:false,access:false,role:'',permissions:{}}});
}

export function watchSession(onState) {
  if (!firebaseConfigured) {
    onState({status: 'unconfigured'});
    return () => {};
  }
  let disposed = false;
  let authUnsubscribe = null;
  let auth = null;
  let profileUnsubscribe = null;
  let firstLoginPendingUnsubscribe = null;
  let lastAuthUid;
  let generation = 0;
  let onlineHandler = null;
  const clearOnlineHandler = () => {
    if (onlineHandler) window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  };
  const scheduleReconnect = (user, currentGeneration) => {
    if (currentGeneration !== generation) return;
    onlineHandler = () => {
      onlineHandler = null;
      if (currentGeneration === generation) void loadProfile(user);
    };
    window.addEventListener('online', onlineHandler, {once: true});
  };
  const loadProfile = async (user) => {
    if (!user) return;
    const currentGeneration = ++generation;
    clearOnlineHandler();
    profileUnsubscribe?.();
    profileUnsubscribe = null;
    // Let Firebase Authentication open the restricted shell immediately.
    // Firestore profile data upgrades this to a normal authorized session.
    showAuthLimitedSession(user,onState,true);
    try {
      if (!navigator.onLine) {
        await showCachedSession(user, onState, () => currentGeneration === generation && !disposed);
        scheduleReconnect(user, currentGeneration);
        return;
      }
      const cached = await readCachedProfile(user.uid).catch(() => null);
      if (currentGeneration !== generation || disposed) return;
      if (cached?.uid === user.uid && cached.active === true && cached.access === true) {
        onState({status: 'signed-in', user, profile: profileForPresentation(cached, user), offline: true});
      }
      await onAuthChangedProfile(user, onState, currentGeneration, () => generation, (unsub) => { profileUnsubscribe = unsub; });
    } catch (error) {
      if (currentGeneration !== generation) return;
      if (isFirestoreCacheFallbackError(error)) await showCachedSession(user, onState, () => currentGeneration === generation && !disposed);
      else showAuthLimitedSession(user, onState, false, profileReadFailureCode(error));
    }
    scheduleReconnect(user, currentGeneration);
  };
  retryCurrentProfile = () => {
    const user = auth?.currentUser;
    if (!user) return Promise.resolve(false);
    operationalBackend.reset();
    return loadProfile(user);
  };
  firstLoginPendingUnsubscribe = subscribeManagementFaFirstLoginPending((pending) => {
    if (disposed) return;
    const user = auth?.currentUser;
    if (pending) {
      generation++;
      clearOnlineHandler();
      profileUnsubscribe?.();
      profileUnsubscribe = null;
      if (user) onState({status: 'first-login-linking', user});
    } else if (user) {
      void reconcileFirebaseSecondarySessions(user.uid);
      void loadProfile(user);
    }
  });
  onState({status: 'checking'});
  loadAuthApi().then(({onAuthStateChanged, auth: initializedAuth}) => {
    if (disposed) return;
    auth = initializedAuth;
    authUnsubscribe = onAuthStateChanged(auth, async (user) => {
      if (disposed) return;
      const uid = user?.uid || null;
      observeManagementFaFirstLoginAuthUid(uid);
      if (uid !== lastAuthUid) {
        lastAuthUid = uid;
        // Secondary cleanup is intentionally detached from FA profile loading:
        // FB/FC outages must never delay or fail the primary session.
        if (!isManagementFaFirstLoginPending()) void reconcileFirebaseSecondarySessions(uid);
      }
      if (!user) {
        generation++;
        clearOnlineHandler();
        profileUnsubscribe?.();
        profileUnsubscribe = null;
        onState({status: 'signed-out'});
        return;
      }
      if (isManagementFaFirstLoginPending()) {
        generation++;
        clearOnlineHandler();
        profileUnsubscribe?.();
        profileUnsubscribe = null;
        onState({status: 'first-login-linking', user});
        return;
      }
      await loadProfile(user);
    }, (error) => { if (!disposed) onState({status: 'auth-error', error}); });
  }).catch((error) => { if (!disposed) onState({status: 'auth-error', error}); });
  return () => {
    disposed = true;
    generation++;
    clearOnlineHandler();
    authUnsubscribe?.();
    profileUnsubscribe?.();
    firstLoginPendingUnsubscribe?.();
    retryCurrentProfile = null;
  };
}

export function retryAuthenticatedProfile() {
  return retryCurrentProfile ? retryCurrentProfile() : Promise.resolve(false);
}

async function onAuthChangedProfile(user, onState, currentGeneration, getGeneration, setProfileUnsubscribe) {
  const [{doc, getDoc}, {db}] = await Promise.all([import('firebase/firestore/lite'), import('./firebase-lite.js')]);
  if (currentGeneration !== getGeneration()) return;
  const profileRef = doc(db, 'users', user.uid);
  try {
    const snapshot = await operationalBackend.run(`profile:${user.uid}`, () => getDoc(profileRef));
    if (currentGeneration !== getGeneration()) return;
    if (!snapshot.exists()) {
      const requestSnapshot = await getDoc(doc(db, 'accessRequests', user.uid));
      if (currentGeneration !== getGeneration()) return;
      onState({status: requestSnapshot.exists() && requestSnapshot.data().status === 'PENDING' ? 'access-pending' : 'profile-missing', user});
      return;
    }
    const profile = snapshot.data();
    if (profile.uid !== user.uid) throw new Error('O UID do perfil não corresponde à identidade autenticada.');
    await cacheProfile(user.uid, profile);
    if (currentGeneration !== getGeneration()) return;
    onState({status: profile.active === true && profile.access === true ? 'signed-in' : 'blocked', user, profile: profileForPresentation(profile, user), offline: false});
    deferProfileListener(user, onState, currentGeneration, getGeneration, setProfileUnsubscribe);
  } catch (error) {
    if (currentGeneration !== getGeneration()) return;
    if (isFirestoreCacheFallbackError(error)) await showCachedSession(user, onState, () => currentGeneration === getGeneration());
    else showAuthLimitedSession(user, onState, false, profileReadFailureCode(error));
  }
}

function deferProfileListener(user, onState, currentGeneration, getGeneration, setProfileUnsubscribe) {
  let cancelled = false;
  let listenerUnsubscribe = null;
  let idleHandle = null;
  const cancel = () => {
    cancelled = true;
    if (idleHandle !== null) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle);
      else window.clearTimeout(idleHandle);
    }
    listenerUnsubscribe?.();
  };
  setProfileUnsubscribe?.(cancel);

  const attach = async () => {
    idleHandle = null;
    if (cancelled || currentGeneration !== getGeneration()) return;
    try {
      const [{doc, onSnapshot}, {db}] = await Promise.all([import('firebase/firestore'), import('./firebase.js')]);
      if (cancelled || currentGeneration !== getGeneration()) return;
      listenerUnsubscribe = onSnapshot(doc(db, 'users', user.uid), async (latest) => {
        if (currentGeneration !== getGeneration()) return;
        if (latest.metadata?.fromCache === true || latest.metadata?.hasPendingWrites === true) return;
        if (!latest.exists()) {
          onState({status: 'profile-missing', user});
          return;
        }
        const updatedProfile = latest.data();
        if (updatedProfile.uid !== user.uid) {
          onState({status: 'profile-error', user, error: new Error('O UID do perfil não corresponde à identidade autenticada.')});
          return;
        }
        await cacheProfile(user.uid, updatedProfile);
        if (cancelled || currentGeneration !== getGeneration()) return;
        onState({status: updatedProfile.active === true && updatedProfile.access === true ? 'signed-in' : 'blocked', user, profile: profileForPresentation(updatedProfile, user), offline: !navigator.onLine});
      }, (error) => {
        if (currentGeneration !== getGeneration()) return;
        if (isFirestoreCacheFallbackError(error)) {
          operationalBackend.noteFailure(error, `profile:${user.uid}`);
          showCachedSession(user, onState, () => currentGeneration === getGeneration() && !cancelled).catch((cacheError) => {
            if (currentGeneration === getGeneration() && !cancelled) onState({status: 'profile-error', user, error: cacheError});
          });
        } else {
          showAuthLimitedSession(user,onState,false,profileReadFailureCode(error));
        }
      });
    } catch (error) {
      if (!cancelled && currentGeneration === getGeneration()) {
        if (isTemporaryProfileReadFailure(error)) showCachedSession(user, onState).catch(() => showAuthLimitedSession(user,onState));
        else showAuthLimitedSession(user,onState,false,profileReadFailureCode(error));
      }
    }
  };

  if (typeof window.requestIdleCallback === 'function') idleHandle = window.requestIdleCallback(attach, {timeout: 2500});
  else idleHandle = window.setTimeout(attach, 1000);
}

export async function signInGoogle() {
  const api = await loadAuthApi();
  const popupSignIn = () => {
    const provider = new api.GoogleAuthProvider();
    provider.setCustomParameters({prompt: 'select_account'});
    return api.signInWithPopup(api.auth, provider, api.browserPopupRedirectResolver);
  };
  const enabled = managementFaFirstLoginConfig.enabled;
  if (!enabled) return popupSignIn();
  const runtime = await loadFirstLoginRuntime(api);
  const login = createManagementGoogleLogin({enabled, firstLogin: runtime?.flow, popupSignIn});
  return login.signIn();
}

export async function signOutGlobal() {
  if (!firebaseConfigured) return false;
  const {signOut, auth} = await loadAuthApi();
  if (!auth) return false;
  const user = auth.currentUser;
  if (user) {
    const [pendingOperations, pendingTrainingProgress] = await Promise.all([
      pendingOperationCount(user.uid),
      pendingTrainingProgressCount(user.uid)
    ]);
    const pendingDescriptions = [
      pendingOperations ? `${pendingOperations} ${pendingOperations === 1 ? 'ação operacional' : 'ações operacionais'}` : '',
      pendingTrainingProgress ? `progresso de ${pendingTrainingProgress} ${pendingTrainingProgress === 1 ? 'treinamento' : 'treinamentos'}` : ''
    ].filter(Boolean);
    const pendingCount = pendingOperations + pendingTrainingProgress;
    if (pendingCount > 0 && !window.confirm(`Há ${pendingDescriptions.join(' e ')} sem confirmação do Firestore. Sair mantendo os registros neste aparelho? Entre novamente com esta mesma conta para revisar e enviar.`)) return false;
    await clearUserLocalData(user.uid, {clearOutbox: false});
  }
  return signOutAllFirebaseProjects({signOutPrimary: () => signOut(auth)});
}
