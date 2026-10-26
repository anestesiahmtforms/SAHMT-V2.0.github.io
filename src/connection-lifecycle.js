import {firebaseFailureCode} from './firebase-failure.js';

// Recovery follows real foreground/navigation/network events. At most one
// delayed retry is allowed per failure episode; there is no heartbeat/polling.
export function createConnectionLifecycle({getSession,getBackend,isForcedOffline=()=>false,
  isOnline=()=>globalThis.navigator?.onLine!==false,isVisible=()=>true,
  restoreAuth=async()=>{},revalidate=async()=>{},resume=async()=>{},now=Date.now,
  setTimer=setTimeout,clearTimer=clearTimeout,authCooldownMs=30000,readCooldownMs=15000}={}){
 let flight=null,owner='',epoch=0,lastAuth=-Infinity,lastRead=-Infinity,retryTimer=null,retrySpent=false,disposed=false;
 const cancel=()=>{if(retryTimer!==null)clearTimer(retryTimer);retryTimer=null;};
 const reset=()=>{cancel();epoch++;flight=null;owner='';lastAuth=-Infinity;lastRead=-Infinity;retrySpent=false;};
 const eligible=state=>Boolean(state?.user?.uid)&&['signed-in','auth-limited'].includes(state.status);
 const current=(uid,ticket)=>!disposed&&isOnline()&&isVisible()&&ticket===epoch&&getSession()?.user?.uid===uid&&eligible(getSession());
 function failure(error){
  const code=firebaseFailureCode(error),state=getSession();
  if(disposed||!eligible(state)||!isOnline()||!isVisible())return;
  if(owner!==state.user.uid){reset();owner=state.user.uid;}
  if(retrySpent||retryTimer!==null||!['unavailable','deadline-exceeded','network-request-failed'].includes(code))return;
  const backend=getBackend();if(backend.code==='resource-exhausted')return;
  const delay=Math.max(1000,readCooldownMs-(now()-lastRead),Number(backend.nextRetryAt||0)-now()+100);
  if(delay>60000)return;
  retryTimer=setTimer(()=>{retryTimer=null;retrySpent=true;void recover('retry');},delay);
 }
 function recover(reason='foreground'){
  const state=getSession();
  if(disposed||!eligible(state)||!isOnline()||!isVisible())return Promise.resolve(false);
  if(owner!==state.user.uid){reset();owner=state.user.uid;}
  if(flight?.uid===owner){if(reason==='online')flight.onlineRequested=true;return flight.promise;}
  if(reason!=='retry')retrySpent=false;
  const uid=owner,ticket=epoch,entry={uid,promise:null,onlineRequested:reason==='online'};
  entry.promise=(async()=>{
   await Promise.resolve();
   if(!current(uid,ticket))return false;
   if(now()-lastAuth>=authCooldownMs){lastAuth=now();try{const result=await restoreAuth();if(['signed-out','unconfigured'].includes(result?.status))return false;}catch{}}
   if(!current(uid,ticket))return false;
   const latest=getSession(),backend=getBackend();
   const needsProfile=latest.status==='auth-limited'||latest.offline===true||isForcedOffline()||Boolean(backend.code);
   if(needsProfile){
    if(backend.nextRetryAt>now()){failure(backend);return false;}
    if(!entry.onlineRequested&&now()-lastRead<readCooldownMs){
      if(!['PROFILE_PERMISSION_DENIED','PROFILE_AUTH_REQUIRED'].includes(latest.profileFailureCode))failure({code:backend.code||'unavailable'});
      return false;
    }
    lastRead=now();try{await revalidate();}catch(error){failure(error);}
   }
   if(!current(uid,ticket))return false;
   const result=getSession(),after=getBackend();
   if(result.status!=='signed-in'||result.offline||isForcedOffline()||after.code){failure(after);return false;}
   cancel();await resume(reason);return current(uid,ticket);
  })().catch(()=>false).finally(()=>{if(flight===entry)flight=null;});
  flight=entry;return entry.promise;
 }
 return {recover,failure,suspend(){cancel();epoch++;flight=null;lastAuth=-Infinity;},sessionChanged(){if(owner&&(!eligible(getSession())||getSession().user.uid!==owner))reset();
   const state=getSession();if(state?.status==='signed-in'&&state.offline===false&&!getBackend().code)cancel();},
  dispose(){disposed=true;reset();},snapshot:()=>({busy:Boolean(flight),retryScheduled:retryTimer!==null,retrySpent})};
}
