import {provisionalWireOperation} from './provisional-channel-client.js';
// Only a live Firestore-authorized caller may invoke this. A continuity profile
// permits remote preservation, never direct Firestore submission by itself.
export async function confirmRemoteContinuityOperations({uid,listOperations,listReceipts,authorize,isCurrent,confirm,now=Date.now}){
 if(!uid||!isCurrent())return 0;
 const [operations,receipts]=await Promise.all([listOperations(uid),listReceipts(uid)]);let count=0;
 for(const operation of operations){
  if(!isCurrent())break;
  if(operation.uid!==uid||operation.status!=='awaiting-confirmation'||(operation.nextAttemptAt||0)>now()||!authorize(operation))continue;
  const wire=await provisionalWireOperation(operation);if(!wire||!isCurrent())continue;
  const receipt=receipts.find(value=>value.requestId===wire.requestId&&value.localRequestId===operation.requestId&&value.shared===true&&value.state==='pending'&&!value.committed&&value.collection===wire.collection&&value.day===wire.day);
  if(!receipt||wire.collection==='scheduleReleases'&&receipt.occurredAt!==wire.data.occurredAt)continue;
  if(await confirm(uid,operation.requestId))count++;
 }
 return count;
}
