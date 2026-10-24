export const GOOGLE_AUTH_RELEASE = 'google-five-projects-20261022-v1';
export const GOOGLE_AUTH_START = Date.parse('2026-10-22T00:00:00-03:00');
export const GOOGLE_AUTH_TARGETS = Object.freeze(['FA', 'FB', 'FC', 'FD', 'FE']);

export function googleIdentity(user) {
  const google = user?.providerData?.find(provider => provider.providerId === 'google.com');
  return user?.uid && google?.uid ? {uid:user.uid, googleUid:google.uid} : null;
}
export function sameGoogleIdentity(user, expected) {
  const identity = googleIdentity(user);
  return Boolean(expected && identity?.uid === expected.uid && identity.googleUid === expected.googleUid);
}
export function safeGoogleAuthCode(error) {
  const code=String(error?.code || 'AUTH_UNAVAILABLE');
  const allowed=new Set(['auth/network-request-failed','auth/too-many-requests','auth/user-disabled','auth/user-not-found',
    'auth/invalid-credential','auth/account-exists-with-different-credential','auth/operation-not-allowed',
    'auth/popup-blocked','auth/popup-closed-by-user','auth/user-mismatch','auth/unauthorized-domain',
    'AUTH_RESTORE_TIMEOUT','AUTH_CONFIGURATION_REQUIRED','AUTH_AUDIENCE_NOT_VERIFIED','AUTH_UID_MISMATCH','AUTH_GOOGLE_SESSION_REQUIRED',
    'AUTH_GOOGLE_IDENTITY_MISMATCH','AUTH_EXISTING_ACCOUNT_REQUIRED','AUTH_ACCOUNT_CHANGED','AUTH_CREDENTIAL_REQUIRED',
    'AUTH_OFFLINE','AUTH_UNAVAILABLE','AUTH_SOURCE_REQUIRED','AUTH_SOURCE_GOOGLE_LINK_REQUIRED','AUTH_SIGNUP_GUARD_REQUIRED',
    'AUTH_LOGOUT_FAILED','AUTH_LOGOUT_IN_PROGRESS','AUTH_POPUP_BUSY']);
  for(const value of ['AUTH_GOOGLE_SCRIPT_TIMEOUT','AUTH_GOOGLE_SCRIPT_UNAVAILABLE','AUTH_GOOGLE_SCRIPT_INVALID','AUTH_GOOGLE_BUTTON_DISPOSED'])allowed.add(value);
  return allowed.has(code)?code:'AUTH_UNAVAILABLE';
}
const transient = code => ['auth/network-request-failed','AUTH_RESTORE_TIMEOUT'].includes(code);
const fail=code=>Object.assign(new Error(code),{code});

/** No Firestore, tokens, permissions or timer-based maintenance in this coordinator. */
export function createGoogleProjectAuth({primary='FA',getPrimaryUser,restoreTarget,connectTarget,signOutTarget,
  onState=()=>{},saveProgress=()=>{},isOnline=()=>true,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  let generation=0,identity=null,sourceUid=null,running=null,runningIdentity=null,restoring=null,loggingOut=null;
  let states=Object.fromEntries(GOOGLE_AUTH_TARGETS.map(target=>[target,{status:'pending',code:null}]));
  const listeners=new Set();
  const snapshot=()=>({release:GOOGLE_AUTH_RELEASE,uid:sourceUid,busy:Boolean(running||restoring||loggingOut),connecting:Boolean(running),signingOut:Boolean(loggingOut),
    complete:GOOGLE_AUTH_TARGETS.every(target=>states[target].status==='ready'),targets:structuredClone(states)});
  function emit(){const value=snapshot();onState(value);for(const listener of listeners)listener(value);
    if(identity)try{saveProgress({release:GOOGLE_AUTH_RELEASE,uid:identity.uid,complete:value.complete,
      readyTargets:GOOGLE_AUTH_TARGETS.filter(target=>states[target].status==='ready')});}catch{/* Optional UI progress must not fail Auth. */}}
  const current=(ticket,expected)=>ticket===generation&&sameGoogleIdentity(getPrimaryUser(),expected);
  const update=(target,value,ticket)=>{if(ticket===generation){states[target]=value;emit();}};
  async function pool(items,work){let index=0;await Promise.all([0,1].map(async()=>{while(index<items.length){const item=items[index++];await work(item);}}));}
  function adopt(user){const next=googleIdentity(user);if((user?.uid||null)!==sourceUid||next?.uid!==identity?.uid||next?.googleUid!==identity?.googleUid){
    generation++;identity=next;sourceUid=user?.uid||null;states=Object.fromEntries(GOOGLE_AUTH_TARGETS.map(t=>[t,{status:'pending',code:null}]));
  }return generation;}
  async function scan(user){
    const ticket=adopt(user),expected=identity;
    if(!expected){emit();return snapshot();}
    update(primary,{status:'ready',code:null},ticket);
    // Restoration only reads existing SDK sessions. A slow project must not
    // occupy the connection pool and hold up healthy destinations.
    await Promise.all(GOOGLE_AUTH_TARGETS.filter(t=>t!==primary).map(async target=>{
      if(!current(ticket,expected))return;
      if(states[target].status!=='ready')update(target,{status:'restoring',code:null},ticket);
      try{const existing=await restoreTarget(target);
        if(!current(ticket,expected))return;
        if(existing&&!sameGoogleIdentity(existing,expected)){
          await signOutTarget(target,{isCurrent:()=>current(ticket,expected)});update(target,{status:'pending',code:'AUTH_UID_MISMATCH'},ticket);
        }else update(target,{status:existing?'ready':'pending',code:null},ticket);
      }catch(error){update(target,{status:'pending',code:safeGoogleAuthCode(error)},ticket);}
    }));
    return snapshot();
  }
  function restore(user=getPrimaryUser()) {
    if(loggingOut)return loggingOut.then(()=>restore(getPrimaryUser()));
    const expected=googleIdentity(user);
    if(!expected)return clearSecondaries(user).then(()=>snapshot());
    if(restoring&&identity?.uid===expected?.uid&&identity?.googleUid===expected?.googleUid)return restoring;
    const operation=scan(user);restoring=operation;emit();
    operation.finally(()=>{if(restoring===operation){restoring=null;emit();}}).catch(()=>{});
    return operation;
  }
  function connect(credential) {
    if(loggingOut)return Promise.reject(fail('AUTH_ACCOUNT_CHANGED'));
    if(!credential)return Promise.reject(fail('AUTH_CREDENTIAL_REQUIRED'));
    const expected=googleIdentity(getPrimaryUser());if(!expected)return Promise.reject(fail('AUTH_SOURCE_REQUIRED'));
    if(running){
      if(expected.uid===runningIdentity?.uid&&expected.googleUid===runningIdentity?.googleUid)return running;
      // A new account must not receive the old account's result or lose its credential.
      adopt(getPrimaryUser());
      return running.catch(()=>{}).then(()=>{
        if(!sameGoogleIdentity(getPrimaryUser(),expected))throw fail('AUTH_ACCOUNT_CHANGED');
        return connect(credential);
      });
    }
    const ticket=adopt(getPrimaryUser());
    const operation=(async()=>{
      await restore(getPrimaryUser());
      if(!current(ticket,expected))throw fail('AUTH_ACCOUNT_CHANGED');
      update(primary,{status:'ready',code:null},ticket);
      await pool(GOOGLE_AUTH_TARGETS.filter(t=>t!==primary&&states[t].status!=='ready'),async target=>{
        if(!current(ticket,expected))return;
        if(!isOnline()){update(target,{status:'pending',code:'AUTH_OFFLINE',phase:'connect'},ticket);return;}
        update(target,{status:'connecting',code:null},ticket);
        for(let attempt=0;attempt<2;attempt++){
          if(!current(ticket,expected))return;
          try{const user=await connectTarget(target,credential,expected,()=>current(ticket,expected));
            if(!current(ticket,expected))return;
            if(!sameGoogleIdentity(user,expected)){
              await signOutTarget(target,{isCurrent:()=>current(ticket,expected)});throw fail('AUTH_UID_MISMATCH');
            }
            update(target,{status:'ready',code:null},ticket);break;
          }catch(error){
            const code=safeGoogleAuthCode(error);
            if(attempt===0&&transient(code)&&isOnline()&&current(ticket,expected)){await sleep(700);continue;}
            update(target,{status:'pending',code,phase:'connect'},ticket);break;
          }
        }
      });
      return snapshot();
    })();
    running=operation;runningIdentity=expected;emit();
    operation.finally(()=>{if(running===operation){running=null;runningIdentity=null;emit();}}).catch(()=>{});
    return operation;
  }
  function clearSecondaries(source=getPrimaryUser()){
    const ticket=++generation;identity=null;sourceUid=source?.uid||null;
    states=Object.fromEntries(GOOGLE_AUTH_TARGETS.map(t=>[t,{status:'pending',code:null}]));
    if(source)states[primary].code='AUTH_SOURCE_GOOGLE_LINK_REQUIRED';emit();
    // An Auth signed-out observation is not permission to sign out a subsequent login.
    const isCurrent=()=>ticket===generation&&getPrimaryUser()===source&&!googleIdentity(source);
    return Promise.allSettled(GOOGLE_AUTH_TARGETS.filter(t=>t!==primary)
      .map(target=>signOutTarget(target,{isCurrent})));
  }
  function signOutAll(){
    if(loggingOut)return loggingOut;
    const source=getPrimaryUser(),expected=googleIdentity(source);
    const isCurrent=()=>!getPrimaryUser()||getPrimaryUser()===source||sameGoogleIdentity(getPrimaryUser(),expected);
    generation++;identity=null;sourceUid=null;const active=running;states=Object.fromEntries(GOOGLE_AUTH_TARGETS.map(t=>[t,{status:'pending',code:null}]));
    const operation=(async()=>{
      // Invalidate in-flight sign-ins, then perform a second sweep after they settle.
      const clear=()=>Promise.allSettled(GOOGLE_AUTH_TARGETS.map(target=>signOutTarget(target,{isCurrent})));
      const first=await clear();
      if(active)await active.catch(()=>{});
      const second=active?await clear():first;
      if(!isCurrent())return {status:'superseded'};
      return {status:second.every(result=>result.status==='fulfilled')?'complete':'partial'};
    })();loggingOut=operation;emit();operation.finally(()=>{loggingOut=null;emit();}).catch(()=>{});return operation;
  }
  return Object.freeze({restore,connect,signOutAll,clearSecondaries,snapshot,
    observeTarget(target,user){if(!identity||!sameGoogleIdentity(getPrimaryUser(),identity)||target===primary||!GOOGLE_AUTH_TARGETS.includes(target))return;
      states[target]=sameGoogleIdentity(user,identity)?{status:'ready',code:null}:{status:'pending',code:user?'AUTH_UID_MISMATCH':null};emit();},
    subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    invalidate(){generation++;identity=null;sourceUid=null;emit();}});
}

/** Local metadata only: no credential, token, email or authorization decision. */
export function createGoogleAuthProgressStore(storage,randomId) {
  let installation='memory';
  try{installation=storage.getItem('sahmt-google-auth-installation')||randomId();storage.setItem('sahmt-google-auth-installation',installation);}catch{}
  return {save(value){try{storage.setItem(`sahmt-google-auth:${GOOGLE_AUTH_RELEASE}:${installation}:${value.uid}`,
    JSON.stringify({release:GOOGLE_AUTH_RELEASE,complete:value.complete===true,readyTargets:value.readyTargets.filter(t=>GOOGLE_AUTH_TARGETS.includes(t))}));}catch{}}};
}
