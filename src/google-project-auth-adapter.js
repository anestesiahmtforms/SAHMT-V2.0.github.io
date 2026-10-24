import {createGoogleProjectAuth,createGoogleAuthProgressStore,googleIdentity,sameGoogleIdentity} from './google-project-auth-core.js';
import {googleTokenClaims,verifyExistingGoogleDestination} from './google-project-auth-preflight.js';
import {waitForGoogleProjectSession} from './google-project-session.js';

/** Firebase SDK dependency injection keeps production composition and local tests identical. */
export function createGoogleProjectAuthRuntime({sdk,auth,entries,primary='FA',enabled=false,storage,
  randomId=()=>crypto.randomUUID(),isOnline=()=>globalThis.navigator?.onLine!==false,
  requestUri=()=>location.origin+'/',restoreTimeoutMs=12000,verifyDestination=verifyExistingGoogleDestination}) {
  const {getApps,initializeApp,initializeAuth,getAuth,indexedDBLocalPersistence,browserLocalPersistence,inMemoryPersistence,
    signInWithCredential,signOut,GoogleAuthProvider,reauthenticateWithCredential,
    beforeAuthStateChanged,getAdditionalUserInfo,onAuthStateChanged,getIdTokenResult}=sdk;
const fail=code=>Object.assign(new Error(code),{code});
const initialized=new Map([[primary,auth]]),locks=new Map(),sessionChecks=new Map();
const nativeChecks=new WeakMap();
let popup=null,coordinator;
function nativeGoogleSession(user,target){
  if(!googleIdentity(user)||typeof getIdTokenResult!=='function')return Promise.resolve(false);
  const prior=nativeChecks.get(user);if(prior?.target===target)return prior.promise;
  let timer;const entry={target,promise:null};
  const task=Promise.resolve().then(async()=>{
    const {claims}=await getIdTokenResult(user,false),project=entries[target]?.config?.projectId;
    return claims?.sub===user.uid&&claims.aud===project&&claims.iss==='https://securetoken.google.com/'+project&&claims.firebase?.sign_in_provider==='google.com';
  });
  entry.promise=Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('AUTH_RESTORE_TIMEOUT')),restoreTimeoutMs);})]).finally(()=>{
    clearTimeout(timer);if(nativeChecks.get(user)===entry)nativeChecks.delete(user);
  });
  nativeChecks.set(user,entry);return entry.promise;
}
function withTargetLock(target,operation){const previous=locks.get(target)||Promise.resolve();
  const next=previous.catch(()=>{}).then(operation);locks.set(target,next);
  next.finally(()=>{if(locks.get(target)===next)locks.delete(target);}).catch(()=>{});return next;}
function targetAuth(target){
  if(initialized.has(target))return initialized.get(target);
  const entry=entries[target];if(!entry?.config?.appId)throw fail('AUTH_CONFIGURATION_REQUIRED');
  let app=getApps().find(a=>a.name===entry.appName);
  if(app&&(app.options.projectId!==entry.config.projectId||app.options.appId!==entry.config.appId))throw fail('AUTH_CONFIGURATION_REQUIRED');
  if(!app)app=initializeApp(entry.config,entry.appName);
  let instance;try{instance=initializeAuth(app,{persistence:[indexedDBLocalPersistence,browserLocalPersistence,inMemoryPersistence]});}
  catch(error){if(error.code!=='auth/already-initialized')throw error;instance=getAuth(app);}
  instance.languageCode='pt-BR';initialized.set(target,instance);
  beforeAuthStateChanged(instance,user=>{if(user&&!sameGoogleIdentity(user,googleIdentity(auth.currentUser)))throw fail('AUTH_UID_MISMATCH');});
  // Auth-only listener. No Firestore listener or periodic token refresh is added.
  onAuthStateChanged(instance,user=>{
    if(!user)coordinator?.observeTarget(target,null);
    else void nativeGoogleSession(user,target).then(valid=>{
      if(instance.currentUser===user)coordinator?.observeTarget(target,valid?user:null);
    }).catch(()=>{if(instance.currentUser===user)coordinator?.observeTarget(target,null);});
    // SDK storage events from another tab may bypass beforeAuthStateChanged.
    if(user&&!sameGoogleIdentity(user,googleIdentity(auth.currentUser))){
      void withTargetLock(target,async()=>{
        if(instance.currentUser===user&&!sameGoogleIdentity(user,googleIdentity(auth.currentUser)))await signOut(instance);
      }).catch(()=>{});
    }
  },()=>{});
  return instance;
}
async function ready(instance){let timer;
  try{await Promise.race([instance.authStateReady?.(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('AUTH_RESTORE_TIMEOUT')),restoreTimeoutMs);})]);}
  finally{clearTimeout(timer);}}
const progress=createGoogleAuthProgressStore(storage,randomId);
coordinator=createGoogleProjectAuth({primary:primary,getPrimaryUser:()=>auth.currentUser,
  isOnline,saveProgress:progress.save,
  restoreTarget:async target=>{const instance=targetAuth(target);await ready(instance);const user=instance.currentUser;if(user&&!await verifyTargetSession(target))throw fail('AUTH_GOOGLE_SESSION_REQUIRED');return instance.currentUser;},
  signOutTarget:(target,{isCurrent=()=>true}={})=>withTargetLock(target,async()=>{
    if(!isCurrent())return;const instance=targetAuth(target);await signOut(instance);
  }),
  connectTarget:(target,credential,expected,isCurrent)=>withTargetLock(target,async()=>{
    if(!isCurrent())throw fail('AUTH_ACCOUNT_CHANGED');
    const instance=targetAuth(target);await ready(instance);
    if(sameGoogleIdentity(instance.currentUser,expected)&&await nativeGoogleSession(instance.currentUser,target))return instance.currentUser;
    await verifyDestination({entry:entries[target],credential,expected,isCurrent,
      requestUri:requestUri()});
    if(!isCurrent())throw fail('AUTH_ACCOUNT_CHANGED');
    let result,rejectSession=false;
    try{result=await signInWithCredential(instance,GoogleAuthProvider.credential(credential.idToken));
      if(getAdditionalUserInfo(result)?.isNewUser===true||!sameGoogleIdentity(result.user,expected)){
        rejectSession=true;throw fail('AUTH_UID_MISMATCH');
      }
      if(!await nativeGoogleSession(result.user,target))throw fail('AUTH_GOOGLE_SESSION_REQUIRED');
      if(!isCurrent())throw fail('AUTH_ACCOUNT_CHANGED');return result.user;
    }catch(error){
      if(instance.currentUser&&(rejectSession||!isCurrent()||!sameGoogleIdentity(instance.currentUser,expected)))await signOut(instance);
      throw error;
    }
  })
});

function confirmGoogleProjectAccess(credential){
  assertCanStartPrimarySignIn();
  if(popup)return popup;
  if(!enabled)return Promise.reject(fail('AUTH_CONFIGURATION_REQUIRED'));
  const user=auth.currentUser,expected=googleIdentity(user);if(!expected)return Promise.reject(fail('AUTH_SOURCE_REQUIRED'));
  const claims=googleTokenClaims(credential);
  if(claims.sub!==expected.googleUid)throw fail('AUTH_GOOGLE_IDENTITY_MISMATCH');
  if(!entries[primary]?.acceptedGoogleClientIds?.includes(claims.aud))throw fail('AUTH_AUDIENCE_NOT_VERIFIED');
  // GIS obtains the Google credential before Firebase is called. Reauthentication
  // with a credential uses the existing FA User; choosing another account never signs it up.
  const request=reauthenticateWithCredential(user,GoogleAuthProvider.credential(credential.idToken));
  popup=request.then(result=>{
    if(!sameGoogleIdentity(auth.currentUser,expected)||!sameGoogleIdentity(result.user,expected))throw fail('AUTH_ACCOUNT_CHANGED');
    return coordinator.connect(credential);
  }).finally(()=>{popup=null;});return popup;
}
function reconcileGoogleProjectSessions(user){
  if(!enabled)return Promise.resolve({status:'disabled'});
  return user?coordinator.restore(user):coordinator.clearSecondaries(null);
}
function connectFromPrimarySignIn(credential,user){
  assertCanStartPrimarySignIn();
  if(!enabled)return Promise.resolve({status:'disabled'});
  const expected=googleIdentity(auth.currentUser),claims=googleTokenClaims(credential);
  if(!sameGoogleIdentity(user,expected)||claims.sub!==expected.googleUid)throw fail('AUTH_GOOGLE_IDENTITY_MISMATCH');
  if(!entries[primary]?.acceptedGoogleClientIds?.includes(claims.aud))throw fail('AUTH_AUDIENCE_NOT_VERIFIED');
  // The primary popup already authenticated this identity. Reuse its ephemeral
  // Google credential for existing destinations without another popup.
  return coordinator.connect(credential);
}
function assertCanStartPrimarySignIn(){
  if(coordinator.snapshot().signingOut)throw fail('AUTH_LOGOUT_IN_PROGRESS');
}

function verifyTargetSession(target){
  if(!enabled&&target!==primary)return Promise.resolve(false);
  const expected=googleIdentity(auth?.currentUser);if(!expected)return Promise.resolve(false);
  const instance=targetAuth(target),prior=sessionChecks.get(target);
  if(prior&&prior.source===auth.currentUser&&prior.user===instance.currentUser)return prior.promise;
  let timer;
  const task=(async()=>{
    await ready(instance);
    if(!sameGoogleIdentity(auth.currentUser,expected))return false;
    const user=instance.currentUser;
    const valid=sameGoogleIdentity(user,expected)&&await nativeGoogleSession(user,target);
    return valid&&instance.currentUser===user&&sameGoogleIdentity(auth.currentUser,expected);
  })();
  const entry={source:auth.currentUser,user:instance.currentUser,promise:null};
  entry.promise=Promise.race([task,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),restoreTimeoutMs);})]).catch(()=>false).finally(()=>{
    clearTimeout(timer);if(sessionChecks.get(target)===entry)sessionChecks.delete(target);
  });
  sessionChecks.set(target,entry);return entry.promise;
}
async function maintainSessions(){
  if(!auth)return {status:'unconfigured'};
  await ready(auth);const user=auth.currentUser;
  if(!user)return {status:'signed-out'};
  const primaryReady=await verifyTargetSession(primary);
  if(!primaryReady)return {status:'pending'};
  // SDK refreshes expiring tokens here. No popup, credential exchange or
  // Firestore read is performed; each destination keeps its own SDK session.
  if(enabled)void coordinator.restore(user).catch(()=>{});
  return {status:'ready',primary};
}

async function waitForTargetSession(target,{isCurrent=()=>true}={}){
  if(!enabled||!isCurrent()||coordinator.snapshot().signingOut)return false;
  const source=auth.currentUser,expected=googleIdentity(source);if(!expected)return false;
  const state=coordinator.snapshot();
  if(state.uid!==expected.uid||!state.busy&&state.targets[target]?.status!=='ready')void coordinator.restore(source).catch(()=>{});
  const current=()=>isCurrent()&&sameGoogleIdentity(auth.currentUser,expected)&&!coordinator.snapshot().signingOut;
  const restored=await waitForGoogleProjectSession({target,auth:targetAuth(target),getSourceUser:()=>auth.currentUser,
    controller:coordinator,isCurrent:current,timeoutMs:restoreTimeoutMs});
  return restored&&current()&&await verifyTargetSession(target)&&current();
}

return {controller:coordinator,confirm:confirmGoogleProjectAccess,connectFromPrimarySignIn,reconcile:reconcileGoogleProjectSessions,assertCanStartPrimarySignIn,maintainSessions,verifyTargetSession,waitForTargetSession,
  getTargetAuth:target=>{if(!enabled)throw fail('AUTH_CONFIGURATION_REQUIRED');return targetAuth(target);}};
}
