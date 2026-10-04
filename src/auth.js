import {firebaseConfigured} from './firebase-app.js';
import {cacheProfile, clearUserLocalData, pendingOperationCount, pendingTrainingProgressCount, readCachedProfile} from './outbox.js';
import {profileForPresentation} from './profile-presentation.js';

let retryCurrentProfile = null;
let authApiPromise = null;

function loadAuthApi() {
  if (!authApiPromise) {
    authApiPromise = Promise.all([import('firebase/auth'), import('./firebase-auth.js')])
      .then(([api, {auth}]) => ({...api, auth}))
      .catch((error) => { authApiPromise = null; throw error; });
  }
  return authApiPromise;
}

async function showCachedSession(user, onState) {
  const profile = await readCachedProfile(user.uid);
  if (!profile) {
    onState({status: 'profile-error', user, error: new Error('Perfil offline ausente ou expirado.')});
    return;
  }
  onState({status: profile.active && profile.access ? 'signed-in' : 'blocked', user, profile: profileForPresentation(profile, user), offline: true});
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
    onState({status: 'loading-profile', user});
    try {
      if (!navigator.onLine) {
        await showCachedSession(user, onState);
        scheduleReconnect(user, currentGeneration);
        return;
      }
      await onAuthChangedProfile(user, onState, currentGeneration, () => generation, (unsub) => { profileUnsubscribe = unsub; });
    } catch (error) {
      if (currentGeneration !== generation) return;
      if (!navigator.onLine) await showCachedSession(user, onState);
      else onState({status: 'profile-error', user, error});
    }
    scheduleReconnect(user, currentGeneration);
  };
  retryCurrentProfile = () => {
    const user = auth?.currentUser;
    if (!user) return Promise.resolve(false);
    return loadProfile(user);
  };
  onState({status: 'checking'});
  loadAuthApi().then(({onAuthStateChanged, auth: initializedAuth}) => {
    if (disposed) return;
    auth = initializedAuth;
    authUnsubscribe = onAuthStateChanged(auth, async (user) => {
      if (disposed) return;
      if (!user) {
        generation++;
        clearOnlineHandler();
        profileUnsubscribe?.();
        profileUnsubscribe = null;
        onState({status: 'signed-out'});
        return;
      }
      await loadProfile(user);
    }, (error) => { if (!disposed) onState({status: 'auth-error', error}); });
  }).catch((error) => { if (!disposed) onState({status: 'auth-error', error}); });
  return () => {
    disposed = true;
    clearOnlineHandler();
    authUnsubscribe?.();
    profileUnsubscribe?.();
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
    const snapshot = await getDoc(profileRef);
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
    onState({status: profile.active === true && profile.access === true ? 'signed-in' : 'blocked', user, profile: profileForPresentation(profile, user), offline: false});
    deferProfileListener(user, onState, currentGeneration, getGeneration, setProfileUnsubscribe);
  } catch (error) {
    if (currentGeneration !== getGeneration()) return;
    if (!navigator.onLine) await showCachedSession(user, onState);
    else onState({status: 'profile-error', user, error});
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
        onState({status: updatedProfile.active === true && updatedProfile.access === true ? 'signed-in' : 'blocked', user, profile: profileForPresentation(updatedProfile, user), offline: !navigator.onLine});
      }, (error) => {
        if (currentGeneration !== getGeneration()) return;
        if (!navigator.onLine) {
          showCachedSession(user, onState).catch((cacheError) => onState({status: 'profile-error', user, error: cacheError}));
        } else {
          onState({status: 'profile-error', user, error});
        }
      });
    } catch (error) {
      if (!cancelled && currentGeneration === getGeneration()) onState({status: 'profile-error', user, error});
    }
  };

  if (typeof window.requestIdleCallback === 'function') idleHandle = window.requestIdleCallback(attach, {timeout: 2500});
  else idleHandle = window.setTimeout(attach, 1000);
}

export async function signInGoogle() {
  const {GoogleAuthProvider, browserPopupRedirectResolver, signInWithPopup, auth} = await loadAuthApi();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  return signInWithPopup(auth, provider, browserPopupRedirectResolver);
}

export async function signOutGlobal() {
  if (!firebaseConfigured) return false;
  const {signOut, auth} = await loadAuthApi();
  if (!auth) return;
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
    const discard = pendingCount > 0 && window.confirm(`Há ${pendingDescriptions.join(' e ')} sem confirmação do Firestore. Sair e apagar esses dados deste aparelho?`);
    if (pendingCount > 0 && !discard) return false;
    await clearUserLocalData(user.uid, {clearOutbox: discard});
  }
  await signOut(auth);
  return true;
}
