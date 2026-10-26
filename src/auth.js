import {firebaseConfigured} from './firebase-app.js';
import {cacheProfile, clearUserLocalData, pendingOperationCount, pendingTrainingProgressCount, readCachedProfile} from './outbox.js';
import {profileForPresentation} from './profile-presentation.js';
import {deployment} from './deployment-context.js';
import {rememberManagementReturn,consumeManagementReturn,rememberModuleNavigation} from './module-navigation.js';
import {googleProjectAuthEnabled} from './google-project-auth-config.js';
const directRuntime = () => import('./google-project-auth-runtime.js');
const reconcileFirebaseSecondarySessions = uid => googleProjectAuthEnabled
  ? directRuntime().then(module => loadAuthApi().then(api => module.reconcileGoogleProjectSessions(api.auth.currentUser)))
  : deployment.target === 'FB' ? Promise.resolve({status:'disabled'}) : import('./firebase-secondary-session-lifecycle.js').then(module => module.reconcileFirebaseSecondarySessions(uid));
const signOutAllFirebaseProjects = options => googleProjectAuthEnabled || deployment.target === 'FB'
  ? directRuntime().then(module => module.googleProjectAuth.signOutAll()).then(result => result.status === 'complete')
  : deployment.target === 'FB' ? options.signOutPrimary() : import('./firebase-secondary-session-lifecycle.js').then(module => module.signOutAllFirebaseProjects(options));
import {isManagementFaFirstLoginPending, observeManagementFaFirstLoginAuthUid,
  subscribeManagementFaFirstLoginPending} from './management-fa-first-login-state.js';
import {createManagementGoogleLogin} from './management-google-login.js';
import {managementFaFirstLoginConfig} from './management-fa-first-login-config.js';
import {isFirestoreCacheFallbackError} from './offline-cache.js';
import {operationalBackend} from './operational-backend.js';
import {withinDeadline} from './async-deadline.js';
import {repairAppFiles,staleModuleFailure} from './app-repair.js';

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
  if (deployment.target !== 'FA' || googleProjectAuthEnabled || !managementFaFirstLoginConfig.enabled) return null;
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
  try {profile = await withinDeadline(()=>readCachedProfile(user.uid),{timeoutMs:1500,code:'storage-unavailable'});}
  catch {
    if (isCurrent()) showAuthLimitedSession(user, onState, false, 'LOCAL_STORAGE_UNAVAILABLE');
    return;
  }
  if (!isCurrent()) return;
    if (globalThis.navigator?.onLine !== false && profile?.active !== false) {
      try {
        const recovered = await withinDeadline(async()=>{
          const {recoverRemoteContinuity} = await import('./remote-continuity.js');
          return recoverRemoteContinuity(user, {isCurrent});
        },{timeoutMs:2500});
        if (!isCurrent()) return;
        if (recovered?.profile?.uid === user.uid) {
          const chosen=profile?.uid===user.uid&&profile.cachedAt>recovered.profileVerifiedAt?profile:recovered.profile;
          onState({status: 'signed-in', user, profile: profileForPresentation(chosen, user), offline: true, continuity: true});
          return;
        }
      } catch (error) {
        if (!isCurrent()) return;
        if (error?.code === 'CONTINUITY_ACCESS_DENIED') {
          showAuthLimitedSession(user, onState, false, 'CONTINUITY_ACCESS_DENIED');
          return;
        }
      }
    }
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
  let lastState=null,profileLoad=null;
  const emit=state=>{lastState=state;onState(state);};
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
    if (lastState?.status==='signed-in' && lastState.offline===false && lastState.user?.uid===user.uid) return;
    onlineHandler = () => {
      onlineHandler = null;
      if(globalThis.document?.hidden)return;
      if (currentGeneration === generation) void loadProfile(user,{silent:true});
    };
    window.addEventListener('online', onlineHandler, {once: true});
  };
  const performProfileLoad = async (user, {silent=false,signal}={}) => {
    if (!user) return;
    const currentGeneration = ++generation;
    clearOnlineHandler();
    profileUnsubscribe?.();
    profileUnsubscribe = null;
    // Let Firebase Authentication open the restricted shell immediately.
    // Firestore profile data upgrades this to a normal authorized session.
    const preserve=silent&&lastState?.status==='signed-in'&&lastState.user?.uid===user.uid&&lastState.profile?.active===true&&lastState.profile?.access===true;
    if(!preserve)showAuthLimitedSession(user,emit,true);
    try {
      if (!navigator.onLine) {
        await showCachedSession(user, emit, () => currentGeneration === generation && !disposed);
        scheduleReconnect(user, currentGeneration);
        return;
      }
      const cached = await withinDeadline(()=>readCachedProfile(user.uid),{timeoutMs:1500,code:'storage-unavailable'}).catch(() => null);
      if (currentGeneration !== generation || disposed) return;
      if (!preserve && cached?.uid === user.uid && cached.active === true && cached.access === true) {
        emit({status: 'signed-in', user, profile: profileForPresentation(cached, user), offline: true, validatingProfile:true});
      }
      await onAuthChangedProfile(user, emit, currentGeneration, () => generation, (unsub) => { profileUnsubscribe = unsub; }, {signal});
    } catch (error) {
      if (currentGeneration !== generation) return;
      if (isFirestoreCacheFallbackError(error)) await showCachedSession(user, emit, () => currentGeneration === generation && !disposed);
      else showAuthLimitedSession(user, emit, false, profileReadFailureCode(error));
    }
    scheduleReconnect(user, currentGeneration);
  };
  const loadProfile = (user,options={}) => {
    if(profileLoad?.uid===user?.uid)return profileLoad.promise;
    const entry={uid:user?.uid,promise:null,controller:new AbortController()};
    entry.promise=withinDeadline(()=>performProfileLoad(user,{...options,signal:entry.controller.signal}),{
      timeoutMs:18000,onTimeout:error=>{
        entry.controller.abort(error);
        if(profileLoad===entry){generation++;profileUnsubscribe?.();profileUnsubscribe=null;}
      }
    }).catch(async error=>{
      if(disposed||profileLoad!==entry||auth?.currentUser?.uid!==entry.uid)return false;
      operationalBackend.noteFailure(error,`profile:${entry.uid}`);
      if(lastState?.user?.uid===entry.uid&&lastState.status==='signed-in')emit({...lastState,offline:true,validatingProfile:false});
      else await showCachedSession(user,emit,()=>!disposed&&profileLoad===entry&&auth?.currentUser?.uid===entry.uid);
      return false;
    }).finally(()=>{if(profileLoad===entry)profileLoad=null;});
    profileLoad=entry;return entry.promise;
  };
  retryCurrentProfile = () => {
    const user = auth?.currentUser;
    if (!user) return Promise.resolve(false);
    operationalBackend.reset();
    return loadProfile(user,{silent:true});
  };
  firstLoginPendingUnsubscribe = subscribeManagementFaFirstLoginPending((pending) => {
    if (disposed) return;
    const user = auth?.currentUser;
    if (pending) {
      generation++;
      clearOnlineHandler();
      profileUnsubscribe?.();
      profileUnsubscribe = null;
      if (user) emit({status: 'first-login-linking', user});
    } else if (user) {
      void reconcileFirebaseSecondarySessions(user.uid).catch(()=>{});
      void loadProfile(user);
    }
  });
  emit({status: 'checking'});
  loadAuthApi().then(({onAuthStateChanged, auth: initializedAuth}) => {
    if (disposed) return;
    auth = initializedAuth;
    authUnsubscribe = onAuthStateChanged(auth, async (user) => {
      if (disposed) return;
      const uid = user?.uid || null;
      observeManagementFaFirstLoginAuthUid(uid);
      const identityChanged=uid!==lastAuthUid;
      if (identityChanged) {
        profileLoad?.controller.abort();
        profileLoad=null;
        lastAuthUid = uid;
        // Secondary cleanup is intentionally detached from FA profile loading:
        // FB/FC outages must never delay or fail the primary session.
        if (!isManagementFaFirstLoginPending()) void reconcileFirebaseSecondarySessions(uid).catch(()=>{});
      }
      if (!user) {
        generation++;
        clearOnlineHandler();
        profileUnsubscribe?.();
        profileUnsubscribe = null;
        emit({status: 'signed-out'});
        return;
      }
      if (isManagementFaFirstLoginPending()) {
        generation++;
        clearOnlineHandler();
        profileUnsubscribe?.();
        profileUnsubscribe = null;
        emit({status: 'first-login-linking', user});
        return;
      }
      await loadProfile(user,{silent:!identityChanged});
    }, (error) => { if (!disposed) emit({status: 'auth-error', error}); });
  }).catch((error) => {
    if(disposed)return;
    emit({status:'auth-error',error});
    if(staleModuleFailure(error))repairAppFiles({target:deployment.target,automatic:true});
  });
  return () => {
    disposed = true;
    generation++;
    profileLoad?.controller.abort();
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

async function onAuthChangedProfile(user, onState, currentGeneration, getGeneration, setProfileUnsubscribe, {watch = true, force = false, signal} = {}) {
  const {readOwnProfileDocument} = await import('./profile-server.js');
  if (currentGeneration !== getGeneration()) return;
  const isCurrent=()=>currentGeneration===getGeneration()&&!signal?.aborted;
  let serverResultReceived = false;
  const acceptSnapshot = async snapshot => {
    if (currentGeneration !== getGeneration()) return;
    serverResultReceived = true;
    if (!snapshot.exists()) {
      onState({status: 'profile-missing', user});
      const requestSnapshot = await readOwnProfileDocument(user,{collection:'accessRequests',isCurrent,signal});
      if (currentGeneration !== getGeneration()) return;
      onState({status: requestSnapshot.exists() && requestSnapshot.data().status === 'PENDING' ? 'access-pending' : 'profile-missing', user});
      return;
    }
    const profile = snapshot.data();
    if (profile.uid !== user.uid) throw new Error('O UID do perfil não corresponde à identidade autenticada.');
    // Server confirmation must not wait for a stalled IndexedDB transaction.
    onState({status: profile.active === true && profile.access === true ? 'signed-in' : 'blocked', user, profile: profileForPresentation(profile, user), offline: false});
    void Promise.resolve().then(()=>isCurrent()?cacheProfile(user.uid,profile):null).catch(()=>{});
    if (watch) deferProfileListener(user, onState, currentGeneration, getGeneration, setProfileUnsubscribe);
  };
  const onLateResult = async (snapshot, error) => {
    if (currentGeneration !== getGeneration()) return;
    try {
      if (error) throw error;
      await acceptSnapshot(snapshot);
    } catch (failure) {
      if (currentGeneration === getGeneration() && !isFirestoreCacheFallbackError(failure)) {
        serverResultReceived = true;
        showAuthLimitedSession(user, onState, false, profileReadFailureCode(failure));
      }
    }
  };
  try {
    const snapshot = await operationalBackend.run(`profile:${user.uid}`, () => readOwnProfileDocument(user,{isCurrent,signal}), {force, onLateResult});
    await acceptSnapshot(snapshot);
  } catch (error) {
    if (currentGeneration !== getGeneration()) return;
    if (isFirestoreCacheFallbackError(error)) {
      if (!serverResultReceived) await showCachedSession(user, onState, () => currentGeneration === getGeneration() && !serverResultReceived);
    }
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
        if (cancelled || currentGeneration !== getGeneration()) return;
        onState({status: updatedProfile.active === true && updatedProfile.access === true ? 'signed-in' : 'blocked', user, profile: profileForPresentation(updatedProfile, user), offline: !navigator.onLine});
        void Promise.resolve().then(()=>!cancelled&&currentGeneration===getGeneration()?cacheProfile(user.uid,updatedProfile):null).catch(()=>{});
      }, (error) => {
        if (currentGeneration !== getGeneration()) return;
        if (isFirestoreCacheFallbackError(error)) {
          operationalBackend.noteFailure(error, `profile:${user.uid}`);
          // A Watch transport error does not prove REST is unavailable. One
          // server read confirms the profile; no listener is reattached here.
          onAuthChangedProfile(user, onState, currentGeneration, getGeneration, setProfileUnsubscribe, {watch: false, force: true}).catch((cacheError) => {
            if (currentGeneration === getGeneration() && !cancelled) onState({status: 'profile-error', user, error: cacheError});
          });
        } else {
          showAuthLimitedSession(user,onState,false,profileReadFailureCode(error));
        }
      });
    } catch (error) {
      if (!cancelled && currentGeneration === getGeneration()) {
        if (isTemporaryProfileReadFailure(error)) showCachedSession(user, onState,()=>!cancelled&&currentGeneration===getGeneration()).catch(() => {if(!cancelled&&currentGeneration===getGeneration())showAuthLimitedSession(user,onState);});
        else showAuthLimitedSession(user,onState,false,profileReadFailureCode(error));
      }
    }
  };

  if (typeof window.requestIdleCallback === 'function') idleHandle = window.requestIdleCallback(attach, {timeout: 2500});
  else idleHandle = window.setTimeout(attach, 1000);
}

export async function signInGoogle() {
  // The FB app restores the session established by FA. New Google entry stays
  // at the verified FA origin/client; no second signup or identity linking.
  if (deployment.target === 'FB') {
    rememberManagementReturn(location.hash||'#/management');
    location.assign(deployment.faBase + '#/offline');
    return;
  }
  const api = await loadAuthApi();
  if (googleProjectAuthEnabled) (await directRuntime()).assertCanStartPrimarySignIn();
  const popupSignIn = async () => {
    const provider = new api.GoogleAuthProvider();
    provider.setCustomParameters({prompt: 'select_account'});
    const result=await api.signInWithPopup(api.auth, provider, api.browserPopupRedirectResolver);
    if(googleProjectAuthEnabled){
      const credential=api.GoogleAuthProvider.credentialFromResult(result);
      if(credential?.idToken)try{
        const connected=await (await directRuntime()).connectGoogleProjectsFromSignIn(credential,result.user);
        if(connected.targets?.FB?.status==='ready'){
          const destination=consumeManagementReturn();if(destination){rememberModuleNavigation(deployment.fbBase);location.assign(deployment.fbBase+destination);}
        }
      }catch{/* Primary login remains valid; manual recovery stays in Synchronization. */}
    }
    return result;
  };
  const enabled = deployment.target === 'FA' && !googleProjectAuthEnabled && managementFaFirstLoginConfig.enabled;
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
