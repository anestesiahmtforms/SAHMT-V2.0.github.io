import {readFreshSafeCache,listUnsettledOperations,enqueueOperation,updateQueuedOperation,writeSafeCache} from './outbox.js';
import {listChannelReceipts,updateChannelReceipt,removeChannelReceipt} from './provisional-channel-storage.js';
import {auth} from './firebase-auth.js';
import {appCheckReady} from './firebase-app.js';
async function channelAppCheckHeaders(){
  try{const appCheck=await appCheckReady;if(!appCheck)return {};const {getToken}=await import('firebase/app-check');const value=await getToken(appCheck);return value?.token?{'X-Firebase-AppCheck':value.token}:{};}
  catch{return {}; /* Firebase APIs still enforce App Check when enabled; no attestation is fabricated. */}
}
import {createProvisionalChannelClient as createClient,validChannelEndpoint,provisionalWireOperation} from './provisional-channel-client.js';
const configuredUrl=import.meta.env?.VITE_OPERATIONAL_CHANNEL_ENDPOINT || '';
export {validChannelEndpoint,provisionalWireOperation};
export function provisionalChannelEnabled(){return validChannelEndpoint(configuredUrl);}
export function createProvisionalChannelClient(options={}) {
  return createClient({endpoint:configuredUrl,authSource:auth,store:{list:listChannelReceipts,update:updateChannelReceipt,remove:removeChannelReceipt},
    outbox:{list:listUnsettledOperations,enqueue:enqueueOperation,update:updateQueuedOperation},readCache:readFreshSafeCache,writeCache:writeSafeCache,getAppCheckHeaders:channelAppCheckHeaders,...options});
}

let liveClient;
export function initializeProvisionalChannel(options){liveClient=createProvisionalChannelClient({...options,getSession:options.getSession});return liveClient.start(options.reports);}
export const projectSharedSchedule=(schedule,scope)=>liveClient?.projectSchedule(schedule,scope)||schedule;
export const recoverOwnSharedOperations=(day,collection)=>liveClient?.recover(day,collection)||Promise.resolve({restored:0});
export const mirrorProvisionalSource=path=>liveClient?.mirrorSource(path)||Promise.resolve(false);
export async function markProvisionalCommitted(uid,operation){
  if(!provisionalChannelEnabled())return;
  const wire=await provisionalWireOperation(operation);if(!wire)return;
  await updateChannelReceipt(uid,wire.requestId,{collection:wire.collection,day:wire.day,localRequestId:wire.localRequestId,occurredAt:wire.data.occurredAt||null,committed:true,ackAttempts:0,ackError:null});
  window.dispatchEvent(new CustomEvent('sahmt-channel-confirm'));
}
export async function assertProvisionalReleaseCurrent(uid,operation){
  if(!provisionalChannelEnabled())return;
  if(!liveClient)throw Object.assign(Error('Aguarde a inicialização do canal compartilhado.'),{code:'unavailable'});
  const wire=await provisionalWireOperation(operation);if(!wire)return;
  // Refreshing the channel is permitted here: it does not consult Firestore.
  await liveClient.assertReleaseCurrent?.(uid,wire);
}

export async function prepareProvisionalOperation(uid,operation){
  if(!provisionalChannelEnabled())return;
  const wire=await provisionalWireOperation(operation);if(!wire)return;
  const existing=(await listChannelReceipts(uid)).find(row=>row.requestId===wire.requestId);
  if(!existing)await updateChannelReceipt(uid,wire.requestId,{collection:wire.collection,day:wire.day,localRequestId:wire.localRequestId,occurredAt:wire.data.occurredAt||null,shared:false,committed:false});
  // Staged first: an ordinary fast Firestore commit must not remove the queue
  // before the channel has had its bounded opportunity to preserve it.
  if(import.meta.env?.VITE_OPERATIONAL_CONTINUITY_ENABLED==='true')await liveClient?.share();
}

export async function withdrawProvisionalOperation(operation){if(!provisionalChannelEnabled())return;if(!liveClient)throw Error('CHANNEL_NOT_READY');return liveClient.withdraw(operation);}
