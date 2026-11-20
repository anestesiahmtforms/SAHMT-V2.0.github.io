import {id,fail} from '../communication/domain.js';
import {historyMessageRow,historyRecipientRow,historyEventRow} from '../communication/history.js';
import {obligationDueAt} from '../communication/obligations.js';
const exactId=input=>{if(!input||Object.keys(input).length!==1)throw fail('COMM_INVALID_INPUT');return id(input.id);};
const pending=(messageId)=>({messageId,events:[],lease:null,done:false});
export function createCommunicationHistory({store,drive,pushQueue,now=Date.now,year=2026,uuid=()=>crypto.randomUUID()}={}){
 if(!store?.transaction||!drive?.write||!Number.isSafeInteger(year))throw fail('COMM_HISTORY_CONFIG_REQUIRED',503);
 const send=async messageId=>{try{await pushQueue.send({kind:'history',messageId});return true;}catch{return false;}};
 const nextCounter=async tx=>await tx.get('communicationHistoryState',String(year))||{year,nextMessageRow:2,nextRecipientRow:2,nextEventRow:2};
 function event(counter,key,type,uid='',detail={}){const row=counter.nextEventRow++;if(row>200000)throw fail('COMM_HISTORY_CAPACITY',409);return {id:`${key}:${type}:${uid}`,messageId:key,uid,type,at:now(),detail,row};}
 function writeCounter(tx,counter){tx.set('communicationHistoryState',String(year),counter);}
 async function reserve(tx,message,recipients,{legacy=false}={}){
  if(!Array.isArray(recipients)||recipients.length>200||new Set(recipients.map(r=>r.uid)).size!==recipients.length)throw fail('COMM_INVALID_AUDIENCE');
  const counter=await nextCounter(tx),binding={year,messageRow:counter.nextMessageRow++,recipientStart:counter.nextRecipientRow,recipientCount:recipients.length};counter.nextRecipientRow+=recipients.length;
  if(counter.nextMessageRow>200001||counter.nextRecipientRow>200001)throw fail('COMM_HISTORY_CAPACITY',409);
  const snapshot={messageId:message.id,binding,version:1,syncVersion:0,legacy,items:recipients.map(r=>({uid:id(r.uid),email:r.email||'',displayName:r.displayName||'',institutionalGroup:r.institutionalGroup||'',readAt:null,completedAt:null,sourceCompletedAt:null,score:null,status:'PENDING'}))};
  const job={...pending(message.id),legacy,events:[event(counter,message.id,legacy?'LEGACY_IMPORTED':'PUBLISHED','',{audienceType:message.audienceType,audienceValue:message.audienceValue,recipientCount:legacy?null:recipients.length,...(message.hasActivity?{dueAt:obligationDueAt(message)}:{})})]};
  writeCounter(tx,counter);tx.create('communicationMessageRecipients',message.id,snapshot);tx.create('communicationHistoryPending',message.id,job);return binding;
 }
 async function mark(input,uid,type,evidence){
  const key=exactId(input);id(uid);
  const result=await store.transaction(async tx=>{
   const [message,snapshot,job,counter]=await Promise.all([tx.get('communicationMessages',key),tx.get('communicationMessageRecipients',key),tx.get('communicationHistoryPending',key),nextCounter(tx)]);
   if(!message||message.status!=='published'||!snapshot||!Array.isArray(snapshot.items))throw fail('COMM_FORBIDDEN',403);
   const person=snapshot.items.find(r=>r.uid===uid);if(!person)throw fail('COMM_FORBIDDEN',403);
   if(type==='READ'&&person.readAt)return {readAt:person.readAt,recorded:true,alreadyRecorded:true};
   if(type==='COMPLETED'&&person.status==='COMPLETED')return {completed:true,completedAt:person.completedAt,alreadyRecorded:true};
   if(person.status==='CANCELLED')throw fail('COMM_NOT_CURRENT',409);
   if(type==='READ')person.readAt=now();
   else{
    if(!evidence||!Number.isSafeInteger(evidence.completedAt)||evidence.completedAt<=0||evidence.completedAt>now()+60000||evidence.score!==null&&evidence.score!==undefined&&(!Number.isFinite(evidence.score)||evidence.score<0))throw fail('COMM_INVALID_INPUT');
    Object.assign(person,{status:'COMPLETED',completedAt:evidence.completedAt,confirmedAt:now(),sourceCompletedAt:evidence.sourceCompletedAt??null,score:evidence.score??null});
   }
   const work=job?.done===true?pending(key):job||pending(key);if(work.events.length>=500)throw fail('COMM_HISTORY_CAPACITY',409);
   work.events.push(event(counter,key,type,uid,type==='COMPLETED'?{score:person.score,sourceCompletedAt:person.sourceCompletedAt,confirmedAt:person.confirmedAt}:{}));
   snapshot.version++;writeCounter(tx,counter);tx.set('communicationMessageRecipients',key,snapshot);tx.set('communicationHistoryPending',key,work);
   return type==='READ'?{recorded:true,readAt:person.readAt}:{completed:true,completedAt:person.completedAt};
  });
  return {...result,syncQueued:await send(key)};
 }
 async function detail(input){
  const key=exactId(input),[message,snapshot,job]=await Promise.all([store.get('communicationMessages',key),store.get('communicationMessageRecipients',key),store.get('communicationHistoryPending',key)]);
  if(!message)throw fail('COMM_NOT_FOUND',404);
  return {message,recipients:snapshot?.items||[],recipientsRecorded:Boolean(snapshot&&!snapshot.legacy),syncPending:Boolean(job&&job.done!==true)||(snapshot?snapshot.syncVersion!==snapshot.version:false),serverNow:now()};
 }
 async function compact(messageId){
  return store.transaction(async tx=>{
   const [message,snapshot,job]=await Promise.all([
    tx.get('communicationMessages',messageId),
    tx.get('communicationMessageRecipients',messageId),
    tx.get('communicationHistoryPending',messageId)
   ]);
   if(!message?.history||!Number.isSafeInteger(message.historyArchiveAfter)||message.historyArchiveAfter>now()||
      !snapshot||snapshot.version!==snapshot.syncVersion||job?.done!==true)return false;
   if(message.hasActivity&&message.status!=='cancelled'&&snapshot.items.some(item=>item.status==='PENDING'))return false;
   tx.set('communicationMessages',messageId,{id:messageId,status:'archived',history:message.history,firstPublishedAt:message.firstPublishedAt??null,...(message.hasActivity?{dueAt:obligationDueAt(message),activityTitle:message.activity?.title||message.title}: {})});
   tx.set('communicationMessageRecipients',messageId,{messageId,archived:true});
   return true;
  });
 }
 async function recover(){
  const jobs=await store.page('communicationHistoryPending',{limit:8,filters:[['done',false]]});
  for(const job of jobs)await send(job.messageId);
  const due=await store.historyDue(now(),2);
  for(const messageId of due)await compact(messageId);
  if(!due.length)await importLegacyPage();
 }
 async function importLegacyPage(){
  const key=String(year),migration=await store.get('communicationHistoryMigrations',key);
  if(migration?.done===true)return;
  const cutoff=migration?.cutoff||now();
  const rows=await store.page('communicationMessages',{limit:5,cursor:migration?.cursor||'',publishedBefore:cutoff});
  const candidates=rows.filter(row=>!row.history);
  for(const row of candidates.slice(0,1)){
   const added=await store.transaction(async tx=>{
    const message=await tx.get('communicationMessages',row.id);
    if(!message||message.history||message.status!=='published')return false;
    const history=await reserve(tx,message,[],{legacy:true});
    tx.set('communicationMessages',row.id,{...message,history,historyLegacy:true});
    return true;
   });
   if(added)await send(row.id);
  }
  if(candidates.length>1)return;
  const last=rows.at(-1);
  await store.transaction(async tx=>tx.set('communicationHistoryMigrations',key,{
   cutoff,cursor:last?`${last.publishAt}|${last.id}`:'',done:rows.length<5
  }));
 }
 async function consume({messageId}){
  const key=id(messageId),lease=uuid();
  const claim=await store.transaction(async tx=>{
   const [work,message,snapshot]=await Promise.all([tx.get('communicationHistoryPending',key),tx.get('communicationMessages',key),tx.get('communicationMessageRecipients',key)]);
   if(!work||work.done===true)return null;
   if(!message||!snapshot?.binding)throw fail('COMM_HISTORY_UNAVAILABLE',503);
   if(work.lease&&work.lease.until>now())throw fail('COMM_HISTORY_LOCKED',409);
   tx.set('communicationHistoryPending',key,{...work,lease:{id:lease,until:now()+240000}});
   return {message,snapshot,events:work.events.slice(0,30)};
  });
  if(!claim)return {done:true};
  const {message,snapshot,events}=claim,b=snapshot.binding;
  const data=[{range:`Mensagens!A${b.messageRow}:Q${b.messageRow}`,values:[historyMessageRow(message,snapshot.legacy?undefined:b)]}];
  if(snapshot.items.length)data.push({range:`Destinatarios!A${b.recipientStart}:K${b.recipientStart+snapshot.items.length-1}`,values:snapshot.items.map(r=>historyRecipientRow(message,r))});
  for(const e of events)data.push({range:`Eventos!A${e.row}:F${e.row}`,values:[historyEventRow(e)]});
  try{
   await drive.write(data);
   const more=await store.transaction(async tx=>{
    const [work,current]=await Promise.all([tx.get('communicationHistoryPending',key),tx.get('communicationMessageRecipients',key)]);
    if(work?.lease?.id!==lease)throw fail('COMM_HISTORY_LOCKED',409);
    const remaining=work.events.filter(e=>!events.some(saved=>saved.id===e.id)),changed=current.version!==snapshot.version;
    tx.set('communicationMessageRecipients',key,{...current,syncVersion:snapshot.version});
    if(!remaining.length&&!changed)tx.set('communicationHistoryPending',key,{messageId:key,events:[],lease:null,done:true});
    else tx.set('communicationHistoryPending',key,{...work,events:remaining,lease:null,done:false});
    if(message.hasActivity&&!remaining.length&&!changed&&(message.status==='cancelled'||current.items.every(r=>r.status==='COMPLETED'))){
     const live=await tx.get('communicationMessages',key);
     if(live?.status===message.status)tx.set('communicationMessages',key,{...live,historyArchiveAfter:Math.max(message.publishAt+7*86400000,now())});
    }
    return remaining.length>0||changed;
   });
   if(more)await send(key);return {done:!more};
  }catch(error){
   await store.transaction(async tx=>{const work=await tx.get('communicationHistoryPending',key);if(work?.lease?.id===lease)tx.set('communicationHistoryPending',key,{...work,lease:null});}).catch(()=>{});
   throw error;
  }
 }
 async function cancel(input,actor,reason){
  const key=exactId(input);if(typeof reason!=='string'||reason.trim().length<5||reason.length>1000)throw fail('COMM_INVALID_INPUT');
  const result=await store.transaction(async tx=>{
   const [message,snapshot,oldJob,counter]=await Promise.all([tx.get('communicationMessages',key),tx.get('communicationMessageRecipients',key),tx.get('communicationHistoryPending',key),nextCounter(tx)]);
   if(!message?.activity||!snapshot)throw fail('COMM_NOT_FOUND',404);if(message.status==='cancelled')return {cancelled:true,alreadyCancelled:true};
   if(message.status!=='published')throw fail('COMM_NOT_CURRENT',409);
   const work=oldJob?.done===true?pending(key):oldJob||pending(key);work.events.push(event(counter,key,'CANCELLED',actor.sourceUid,{reason:reason.trim(),actorEmail:actor.email}));
   snapshot.items=snapshot.items.map(r=>r.status==='PENDING'?{...r,status:'CANCELLED'}:r);snapshot.version++;
   writeCounter(tx,counter);tx.set('communicationMessages',key,{...message,status:'cancelled',cancelledAt:now(),cancellationReason:reason.trim()});tx.set('communicationMessageRecipients',key,snapshot);tx.set('communicationHistoryPending',key,work);return {cancelled:true};
  });return {...result,syncQueued:await send(key)};
 }
 async function updateDeadline(key,actor,expectedDueAt,dueAt){
  const result=await store.transaction(async tx=>{
   const [message,snapshot,job,counter]=await Promise.all([tx.get('communicationMessages',key),tx.get('communicationMessageRecipients',key),tx.get('communicationHistoryPending',key),nextCounter(tx)]);
   if(!message?.hasActivity||!snapshot)throw fail('COMM_NOT_FOUND',404);
   if(message.status!=='published'||!snapshot.items.some(person=>person.status==='PENDING'))throw fail('COMM_NOT_CURRENT',409);
   const previousDueAt=obligationDueAt(message);
   if(previousDueAt!==expectedDueAt)throw fail('COMM_ACTIVITY_DEADLINE_CHANGED',409);
   const work=job?.done===true?pending(key):job||pending(key);
   if(work.events.length>=500)throw fail('COMM_HISTORY_CAPACITY',409);
   const change=event(counter,key,'DEADLINE_CHANGED',actor.sourceUid,{previousDueAt,dueAt,actorEmail:actor.email});
   change.id+=':'+change.row;
   work.events.push(change);
   writeCounter(tx,counter);
   tx.set('communicationMessages',key,{...message,dueAt,expiresAt:Math.max(message.expiresAt,dueAt),updatedAt:now(),updatedBy:{uid:actor.uid,sourceUid:actor.sourceUid,email:actor.email}});
   tx.set('communicationHistoryPending',key,work);
   return {dueAt};
  });
  return {...result,syncQueued:await send(key)};
 }
 return {reserve,afterPublish:message=>send(message.id),markRead:(input,uid)=>mark(input,uid,'READ'),markCompletion:(input,uid,evidence)=>mark(input,uid,'COMPLETED',evidence),cancel,updateDeadline,detail,consume,compact,recover};
}
