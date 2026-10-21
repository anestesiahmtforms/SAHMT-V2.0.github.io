import {channelActorFromProfile,canWriteChannel,normalizeChannelSubmission} from './provisional-channel-contract.js';
import {updateScheduleReleaseState,updateScheduleReleaseTimes} from './schedule-release.js';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
export function reconcileContinuityOperation(operation,profile,{now=Date.now(),getDocument,commit}){
 const conflict=code=>({state:'conflict',code});
 if(profile?.uid!==operation?.uid||!profile.active||!profile.access)return conflict('CONTINUITY_ACCESS_DENIED');
 const actor=channelActorFromProfile(operation.uid,profile,now);
 if(!canWriteChannel(operation.collection,actor))return conflict('CONTINUITY_ACCESS_DENIED');
 // Validate the originally admitted payload at its actual occurrence time;
 // historical recovery never changes a day to bypass current-day client Rules.
 let normalized;try{normalized=normalizeChannelSubmission({collection:operation.collection,requestId:operation.requestId,data:operation.data,createdAt:operation.createdAt},actor,operation.createdAt);}catch{return conflict('CONTINUITY_OPERATION_INVALID');}
 const path=operation.collection==='scheduleReleases'?'scheduleDays/'+operation.day:operation.collection+'/'+operation.requestId;
 const prior=getDocument(path),writes=[];let record;
 if(operation.collection==='scheduleReleases'){
  if(!prior)return conflict('CONTINUITY_SCHEDULE_MISSING');
  const data=prior.data,current=data.highlights?.siglas||[],changed=updateScheduleReleaseState(current,operation.data);
  if(!changed.changed)return {state:'confirmed',code:'CONTINUITY_ALREADY_COMMITTED',path,record:{...data,id:operation.day}};
  if(!Number.isSafeInteger(operation.data.expectedVersion)||operation.data.expectedVersion!==(data.version||0))return conflict('CONTINUITY_SCHEDULE_CONFLICT');
  record={...data,id:operation.day,version:(data.version||0)+1,updatedByUid:operation.uid,updatedAt:new Date(now).toISOString(),highlights:{...data.highlights,siglas:changed.siglas,releaseTimes:updateScheduleReleaseTimes(data.highlights?.releaseTimes,current,changed.siglas,operation.data.occurredAt)}};
  writes.push({path,record,currentDocument:{updateTime:prior.updateTime}});
 }else{
  if(prior){
   const data=prior.data,matches=data.id===operation.requestId&&data.clientMutationId===operation.requestId&&data.createdByUid===operation.uid&&Object.entries(operation.data).filter(([key])=>!['createdByName','updatedByName'].includes(key)).every(([key,value])=>canonical(data[key])===canonical(value));
   return matches?{state:'confirmed',code:'CONTINUITY_ALREADY_COMMITTED',path,record:data}:conflict('CONTINUITY_RECORD_CONFLICT');
  }
  record={...normalized.data,id:operation.requestId,clientMutationId:operation.requestId,createdByUid:operation.uid,updatedByUid:operation.uid,createdAt:new Date(operation.createdAt).toISOString(),updatedAt:new Date(now).toISOString(),active:true,version:1};
  writes.push({path,record,currentDocument:{exists:false}});
  if(operation.collection==='events'&&operation.data.scheduleSigla){
   const schedulePath='scheduleDays/'+operation.day,schedule=getDocument(schedulePath);
   if(schedule){const data=schedule.data,marker=`EVENTO:${operation.data.scheduleSigla.toUpperCase()}:${operation.data.memberSigla?.toUpperCase()||'-'}:${operation.requestId}`;
    writes.push({path:schedulePath,currentDocument:{updateTime:schedule.updateTime},record:{...data,highlights:{...data.highlights,events:[...new Set([...(data.highlights?.events||[]),marker])]},version:(data.version||0)+1,updatedAt:new Date(now).toISOString(),updatedByUid:operation.uid}});
   }
  }
 }
 commit(writes);
 return {state:'confirmed',code:'CONTINUITY_COMMITTED',path,record};
}
