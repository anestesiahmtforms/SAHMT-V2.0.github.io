import {auth} from './firebase-auth.js';
import {appCheckReady} from './firebase-app.js';
import {cacheProfile,readCachedProfile,readSafeCache,writeSafeCache,listUnsettledOperations,enqueueOperation,updateQueuedOperation} from './outbox.js';
import {CONTINUITY_KINDS} from './remote-continuity-contract.js';
import {updateChannelReceipt} from './provisional-channel-storage.js';
import {createRemoteContinuityClient} from './remote-continuity-client.js';

const enabled=import.meta.env?.VITE_OPERATIONAL_CONTINUITY_ENABLED==='true';
const client=createRemoteContinuityClient({
 endpoint:enabled?(import.meta.env?.VITE_OPERATIONAL_CHANNEL_ENDPOINT||''):'',
 getCurrentUser:()=>auth?.currentUser,
 cacheProfile:async(uid,profile,options)=>{
  const prior=await readCachedProfile(uid);
  if(!prior||prior.cachedAt<=options.validatedAt)await cacheProfile(uid,profile,options);
 },writeCache:writeSafeCache,listOperations:listUnsettledOperations,
 enqueue:enqueueOperation,updateOperation:updateQueuedOperation,saveReceipt:updateChannelReceipt,
 getAppCheckHeaders:async()=>{
  try{const appCheck=await appCheckReady;if(!appCheck)return {};const {getToken}=await import('firebase/app-check');const value=await getToken(appCheck);return value?.token?{'X-Firebase-AppCheck':value.token}:{};}
  catch{return {};}
 }
});
export async function recoverRemoteContinuity(user,options={}){
 if(!enabled)return null;
 const result=await client.bootstrap(user,options);
 if(result&&auth?.currentUser?.uid===user.uid)globalThis.window?.dispatchEvent(new CustomEvent('sahmt-continuity-ready',{detail:{uid:user.uid,restored:result.restored}}));
 return result;
}
export async function recoverContinuityCache(uid,kind,id){
 const user=auth?.currentUser;if(!enabled||user?.uid!==uid||!CONTINUITY_KINDS.includes(kind))return null;
 const date=String(id).match(/\d{4}-\d{2}-\d{2}/)?.[0]||String(id).match(/\d{4}-\d{2}/)?.[0]?.concat('-01');
 await client.bootstrap(user,{...(date?{day:date}:{}),isCurrent:()=>auth?.currentUser?.uid===uid});
 if(auth?.currentUser?.uid!==uid)return null;
 return readSafeCache(uid,kind,id,{localOnly:true});
}
