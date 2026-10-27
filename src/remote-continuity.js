import {auth} from './firebase-auth.js';
import {appCheckReady} from './firebase-app.js';
import {cacheProfile,readCachedProfile,readSafeCache,writeSafeCache,listUnsettledOperations,enqueueOperation,updateQueuedOperation,hasCommittedOperation} from './outbox.js';
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
 isCommitted:hasCommittedOperation,enqueue:enqueueOperation,updateOperation:updateQueuedOperation,saveReceipt:updateChannelReceipt,
 getAppCheckHeaders:async()=>{
  try{const appCheck=await appCheckReady;if(!appCheck)return {};const {getToken}=await import('firebase/app-check');const value=await getToken(appCheck);return value?.token?{'X-Firebase-AppCheck':value.token}:{};}
  catch{return {};}
 }
});
export async function recoverRemoteContinuity(){return null;}
export async function recoverContinuityCache(){return null;}
