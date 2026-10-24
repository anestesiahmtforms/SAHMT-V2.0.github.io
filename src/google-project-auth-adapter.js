import {createGoogleProjectAuth,createGoogleAuthProgressStore,googleIdentity,sameGoogleIdentity} from './google-project-auth-core.js';
import {googleTokenClaims,verifyExistingGoogleDestination} from './google-project-auth-preflight.js';

/** Firebase SDK dependency injection keeps production composition and local tests identical. */
export function createGoogleProjectAuthRuntime({sdk,auth,entries,primary='FA',enabled=false,storage,
  randomId=()=>crypto.randomUUID(),isOnline=()=>globalThis.navigator?.onLine!==false,
  requestUri=()=>location.origin+'/',restoreTimeoutMs=12000,verifyDestination=verifyExistingGoogleDestination}) {
  const {getApps,initializeApp,initializeAuth,getAuth,indexedDBLocalPersistence,browserLocalPersistence,inMemoryPersistence,
    signInWithCredential,signOut,GoogleAuthProvider,reauthenticateWithCredential,
    beforeAuthStateChanged,getAdditionalUserInfo,onAuthStateChanged}=sdk;
const fail=code=>Object.assign(new Error(code),{code});
const initialized=new Map([[primary,auth]]),locks=new Map();
let popup=null,coordinator;
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
    coordinator?.observeTarget(target,user);
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
  try{await Promise.race([instance.authStateReady(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('AUTH_RESTORE_TIMEOUT')),restoreTimeoutMs);})]);}
  finally{clearTimeout(timer);}}
const progress=createGoogleAuthProgressStore(storage,randomId);
coordinator=createGoogleProjectAuth({primary:primary,getPrimaryUser:()=>auth.currentUser,
  isOnline,saveProgress:progress.save,
  restoreTarget:async target=>{const instance=targetAuth(target);await ready(instance);return instance.currentUser;},
  signOutTarget:(target,{isCurrent=()=>true}={})=>withTargetLock(target,async()=>{
    if(!isCurrent())return;const instance=targetAuth(target);await signOut(instance);
  }),
  connectTarget:(target,credential,expected,isCurrent)=>withTargetLock(target,async()=>{
    if(!isCurrent())throw fail('AUTH_ACCOUNT_CHANGED');
    const instance=targetAuth(target);await ready(instance);
    if(sameGoogleIdentity(instance.currentUser,expected))return instance.currentUser;
    await verifyDestination({entry:entries[target],credential,expected,isCurrent,
      requestUri:requestUri()});
    if(!isCurrent())throw fail('AUTH_ACCOUNT_CHANGED');
    let result,rejectSession=false;
    try{result=await signInWithCredential(instance,GoogleAuthProvider.credential(credential.idToken));
      if(getAdditionalUserInfo(result)?.isNewUser===true||!sameGoogleIdentity(result.user,expected)){
        rejectSession=true;throw fail('AUTH_UID_MISMATCH');
      }
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

return {controller:coordinator,confirm:confirmGoogleProjectAccess,connectFromPrimarySignIn,reconcile:reconcileGoogleProjectSessions,assertCanStartPrimarySignIn,
  getTargetAuth:target=>{if(!enabled)throw fail('AUTH_CONFIGURATION_REQUIRED');return targetAuth(target);}};
}
