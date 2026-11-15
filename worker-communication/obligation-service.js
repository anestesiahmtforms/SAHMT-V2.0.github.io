import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {BUILTIN_GROUPS,fail,id,text} from '../communication/domain.js';
import {validateObligation} from '../communication/obligations.js';

const PREVIEWS='communicationActivityPreviews',MESSAGES='communicationMessages',RECIPIENTS='communicationMessageRecipients',INDEX='communicationObligationIndex';
const exact=(value,keys,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&keys.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>keys.includes(k)||optional.includes(k));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable=()=>fail('COMM_OBLIGATION_UNAVAILABLE',503);
const orderedIds=people=>people.map(p=>p.uid).sort();
function recipientsChecked(people){
 if(!Array.isArray(people)||people.length>200)throw fail('COMM_INVALID_AUDIENCE');
 const result=people.map(p=>{
  if(!p||typeof p.email!=='string'||p.email.length>254||!p.email.includes('@')||p.active===false||p.access===false)throw fail('COMM_INVALID_AUDIENCE');
  return {uid:id(p.uid),email:p.email.trim().toLowerCase(),displayName:typeof p.displayName==='string'?p.displayName.slice(0,240):'',institutionalGroup:typeof p.institutionalGroup==='string'?p.institutionalGroup.slice(0,80):''};
 });
 if(new Set(result.map(p=>p.uid)).size!==result.length)throw fail('COMM_INVALID_AUDIENCE');
 return result;
}
function indexChecked(value){
 const result=value===null?{entries:[]}:value;
 if(!result||!Array.isArray(result.entries)||new Set(result.entries.map(e=>e?.uid)).size!==result.entries.length)throw unavailable();
 for(const entry of result.entries){
  try{id(entry.uid);if(!Array.isArray(entry.ids)||entry.ids.length>20||new Set(entry.ids).size!==entry.ids.length)throw Error();entry.ids.forEach(id);}catch{throw unavailable();}
 }
 if(Buffer.byteLength(JSON.stringify(result))>200*1024)throw unavailable();
 return {entries:result.entries.map(({uid,ids})=>({uid,ids:[...ids]}))};
}
function audienceChecked(input){
 if(!['ALL','USER',...BUILTIN_GROUPS.map(g=>g.id)].includes(input.audience))throw fail('COMM_INVALID_AUDIENCE');
 if(input.audience!=='USER'&&input.recipient!==undefined&&input.recipient!=='')throw fail('COMM_INVALID_AUDIENCE');
 return {audience:input.audience,...(input.audience==='USER'?{recipient:id(input.recipient)}:{})};
}
function ownRow(snapshot,messageId,uid){
 if(!snapshot||snapshot.messageId!==messageId||!Array.isArray(snapshot.items))throw unavailable();
 const rows=snapshot.items.filter(r=>r.uid===uid);
 if(rows.length!==1)throw fail('COMM_FORBIDDEN',403);
 if(!['PENDING','COMPLETED','CANCELLED'].includes(rows[0].status))throw unavailable();
 return rows[0];
}

/** Parent authenticates the FF profile/admin and admits the operation before calling execute. */
export function createObligationService({store,source,history,saveActivity,resolveRecipients,now=Date.now,uuid=()=>crypto.randomUUID()}={}){
 if(!store?.get||!store?.getMany||!store?.transaction||typeof saveActivity!=='function'||typeof resolveRecipients!=='function')throw TypeError('COMM_OBLIGATION_CONFIG_REQUIRED');
 const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<=0)throw unavailable();return value;};
 async function authoritative(requested){
  // The browser can select a registry entry and a minimum, never its maximum/title.
  const keys=requested?.kind==='TRAINING'?['kind','id','title','version','maxScore','minimumScore']:['kind','id','title','cycle'];
  if(!exact(requested,keys)||!['TRAINING','SURVEY'].includes(requested.kind))throw fail('COMM_INVALID_ACTIVITY');
  const result=await source.catalog({kind:requested.kind});
  if(!Array.isArray(result?.items))throw fail('COMM_SOURCE_UNAVAILABLE',503);
  const matches=result.items.filter(item=>item.kind===requested.kind&&item.id===requested.id);
  if(matches.length!==1)throw fail('COMM_ACTIVITY_UNAVAILABLE',409);
  const item=matches[0];
  if(requested.kind==='TRAINING'?item.version!==requested.version:item.cycle!==requested.cycle)throw fail('COMM_ACTIVITY_CHANGED',409);
  return validateObligation(requested.kind==='TRAINING'?{kind:item.kind,id:item.id,title:item.title,version:item.version,maxScore:item.maxScore,minimumScore:requested.minimumScore}:{kind:item.kind,id:item.id,title:item.title,cycle:item.cycle});
 }
 async function eligible(activity,recipients){
  const result=await source.eligibility({activity,recipients});
  if(!Array.isArray(result?.eligibleUids)||!Array.isArray(result.excluded))throw fail('COMM_SOURCE_UNAVAILABLE',503);
  const ids=[...result.eligibleUids,...result.excluded.map(r=>r?.uid)];
  if(ids.length!==recipients.length||new Set(ids).size!==ids.length||ids.some(uid=>!recipients.some(r=>r.uid===uid))||result.excluded.some(r=>typeof r.reason!=='string'||!/^[A-Z0-9_]{1,90}$/.test(r.reason)))throw fail('COMM_SOURCE_UNAVAILABLE',503);
  return {recipients:recipients.filter(p=>result.eligibleUids.includes(p.uid)),excluded:result.excluded.map(({uid,reason})=>({uid,reason}))};
 }
 async function reserveIndex(tx,message,recipients){
  const messageId=id(message.id);validateObligation(message.activity);
  const people=recipientsChecked(recipients),index=indexChecked(await tx.get(INDEX,'current'));
  if(!people.length)throw fail('COMM_NO_ELIGIBLE_RECIPIENTS',409);
  for(const person of people){
   let entry=index.entries.find(e=>e.uid===person.uid);
   if(!entry){entry={uid:person.uid,ids:[]};index.entries.push(entry);}
   if(entry.ids.includes(messageId))continue;
   if(entry.ids.length>=20)throw fail('COMM_OBLIGATION_LIMIT',409);
   entry.ids.push(messageId);
  }
  index.entries.sort((a,b)=>a.uid.localeCompare(b.uid));
  if(Buffer.byteLength(JSON.stringify(index))>200*1024)throw fail('COMM_OBLIGATION_INDEX_LIMIT',409);
  tx.set(INDEX,'current',index);
 }
 async function removeIndex(messageId,uid){
  return store.transaction(async tx=>{
   const index=indexChecked(await tx.get(INDEX,'current'));let changed=false;
   for(const entry of index.entries)if((uid===undefined||entry.uid===uid)&&entry.ids.includes(messageId)){entry.ids=entry.ids.filter(value=>value!==messageId);changed=true;}
   if(changed)tx.set(INDEX,'current',{entries:index.entries.filter(e=>e.ids.length)});
  });
 }
 function previewOwned(preview,actor){if(!preview||preview.sourceUid!==actor.sourceUid)throw fail('COMM_FORBIDDEN',403);}
 function evidence(row){return {completed:true,completedAt:row.completedAt,sourceCompletedAt:row.sourceCompletedAt??null,score:row.score??null};}
 async function execute(action,input={},actor){
  id(actor?.sourceUid);const serverNow=clock();
  if(action==='ACTIVITY_CATALOG'){
   if(!exact(input,['kind'])||!['TRAINING','SURVEY'].includes(input.kind))throw fail('COMM_INVALID_INPUT');
   return source.catalog({kind:input.kind});
  }
  if(action==='PREVIEW_ACTIVITY'){
   if(!exact(input,['activity','audience'],['recipient']))throw fail('COMM_INVALID_INPUT');
   const selection=audienceChecked(input),activity=await authoritative(input.activity);
   const selected=recipientsChecked(await resolveRecipients(selection,actor)),result=await eligible(activity,selected),previewId=id(uuid());
   await store.transaction(async tx=>tx.create(PREVIEWS,previewId,{sourceUid:actor.sourceUid,selection,activity,selected,recipients:result.recipients,excluded:result.excluded,createdAt:serverNow,expiresAt:serverNow+600000}));
   return {previewId,activity,...result};
  }
  if(action==='CREATE_ACTIVITY'){
   if(!exact(input,['id','previewId','title','description','confirmed'])||input.confirmed!==true)throw fail('COMM_INVALID_INPUT');
   const messageId=id(input.id),previewId=id(input.previewId),title=text(input.title,120),description=text(input.description,4000);
   if(!messageId.startsWith('activity-')||messageId.length<10)throw fail('COMM_INVALID_ID');
   const request={id:messageId,previewId,title,description},hash=fingerprint(request);
   const preview=await store.get(PREVIEWS,previewId);previewOwned(preview,actor);
   if(preview.claim&&preview.claim.fingerprint!==hash)throw fail('COMM_IDEMPOTENCY_CONFLICT',409);
   const existing=await store.get(MESSAGES,messageId);
   if(existing){
    if(!preview.claim||existing.createdBy?.sourceUid!==actor.sourceUid||existing.title!==title||existing.message!==description||!same(existing.activity,preview.activity)||existing.previewId!==previewId||existing.fingerprint!==hash)throw fail('COMM_IDEMPOTENCY_CONFLICT',409);
    return {message:existing,alreadySent:true,pushQueued:false};
   }
   if(preview.expiresAt<=serverNow)throw fail('COMM_ACTIVITY_PREVIEW_EXPIRED',409);
   const activity=await authoritative(preview.activity);
   if(!same(activity,preview.activity))throw fail('COMM_ACTIVITY_CHANGED',409);
   const selected=recipientsChecked(await resolveRecipients(preview.selection,actor));
   if(!same(orderedIds(selected),orderedIds(preview.selected))||selected.some(p=>preview.selected.find(old=>old.uid===p.uid)?.email!==p.email))throw fail('COMM_ACTIVITY_AUDIENCE_CHANGED',409);
   const fresh=await eligible(activity,selected);
   if(!same(orderedIds(fresh.recipients),orderedIds(preview.recipients)))throw fail('COMM_ACTIVITY_AUDIENCE_CHANGED',409);
   if(!fresh.recipients.length)throw fail('COMM_NO_ELIGIBLE_RECIPIENTS',409);
   await store.transaction(async tx=>{
    const current=await tx.get(PREVIEWS,previewId);previewOwned(current,actor);
    if(current.claim&&current.claim.fingerprint!==hash)throw fail('COMM_IDEMPOTENCY_CONFLICT',409);
    if(current.expiresAt<=clock())throw fail('COMM_ACTIVITY_PREVIEW_EXPIRED',409);
    if(!current.claim)tx.set(PREVIEWS,previewId,{...current,claim:{id:messageId,fingerprint:hash,at:serverNow}});
   });
   const audience=preview.selection.audience;
   return saveActivity({id:messageId,previewId,fingerprint:hash,title,description,activity,recipients:fresh.recipients,audienceType:['ALL','USER'].includes(audience)?audience:'GROUP',audienceValue:audience==='ALL'?'':audience==='USER'?preview.selection.recipient:audience},actor);
  }
  if(action==='PENDING_ACTIVITIES'){
   if(!exact(input,[]))throw fail('COMM_INVALID_INPUT');
   const index=indexChecked(await store.get(INDEX,'current')),ids=index.entries.find(e=>e.uid===actor.sourceUid)?.ids||[];
   if(!ids.length)return {items:[],serverNow};
   const [messages,snapshots]=await Promise.all([store.getMany(MESSAGES,ids),store.getMany(RECIPIENTS,ids)]);
   const items=[];
   for(let n=0;n<ids.length;n++){
    const message=messages[n];
    if(message?.status==='archived')continue;
    if(!message||message.id!==ids[n]||message.hasActivity!==true)throw unavailable();
    const row=ownRow(snapshots[n],ids[n],actor.sourceUid);
    if(row.status!=='PENDING'||message.status!=='published'||message.publishAt>serverNow)continue;
    items.push({id:message.id,title:message.title,message:message.message,publishAt:message.publishAt,activity:validateObligation(message.activity),status:'PENDING'});
   }
   items.sort((a,b)=>a.publishAt-b.publishAt||a.id.localeCompare(b.id));return {items,serverNow};
  }
  if(action==='VERIFY_ACTIVITY'){
   if(!exact(input,['id']))throw fail('COMM_INVALID_INPUT');const messageId=id(input.id);
   const [message,snapshot]=await Promise.all([store.get(MESSAGES,messageId),store.get(RECIPIENTS,messageId)]);
   if(!message||message.hasActivity!==true)throw fail('COMM_NOT_FOUND',404);
   const row=ownRow(snapshot,messageId,actor.sourceUid);
   if(row.status==='COMPLETED'){await removeIndex(messageId,actor.sourceUid);return {id:messageId,...evidence(row),serverNow};}
   if(message.status!=='published'||row.status==='CANCELLED')return {id:messageId,completed:false,unavailable:true,reason:'ACTIVITY_CANCELLED',serverNow};
   if(message.publishAt>serverNow)throw fail('COMM_NOT_CURRENT',409);
   const activity=validateObligation(message.activity),result=await source.completion({activity});
   if(typeof result?.completed!=='boolean')throw fail('COMM_SOURCE_UNAVAILABLE',503);
   if(!result.completed)return {id:messageId,completed:false,...(result.unavailable===true?{unavailable:true,reason:typeof result.reason==='string'&&/^[A-Z0-9_]{1,90}$/.test(result.reason)?result.reason:'SOURCE_UNAVAILABLE'}:{}),serverNow:clock()};
   const confirmedAt=clock();
   if(activity.kind==='TRAINING'&&(!Number.isSafeInteger(result.completedAt)||result.completedAt<=0||result.completedAt>confirmedAt||!Number.isFinite(result.score)||result.score<activity.minimumScore||result.score>activity.maxScore))throw fail('COMM_SOURCE_UNAVAILABLE',503);
   const sourceCompletedAt=activity.kind==='TRAINING'?result.completedAt:null;
   await history.markCompletion({id:messageId},actor.sourceUid,{completedAt:sourceCompletedAt??confirmedAt,score:activity.kind==='TRAINING'?result.score:null,sourceCompletedAt,confirmedAt});
   const saved=ownRow(await store.get(RECIPIENTS,messageId),messageId,actor.sourceUid);
   if(saved.status!=='COMPLETED')return {id:messageId,completed:false,unavailable:true,reason:'ACTIVITY_CANCELLED',serverNow:clock()};
   await removeIndex(messageId,actor.sourceUid);
   return {id:messageId,...evidence(saved),serverNow:clock()};
  }
  if(action==='CANCEL_ACTIVITY'){
   if(!exact(input,['id','reason']))throw fail('COMM_INVALID_INPUT');const messageId=id(input.id),reason=text(input.reason,2000);
   const message=await store.get(MESSAGES,messageId);if(!message||message.hasActivity!==true)throw fail('COMM_NOT_FOUND',404);
   const result=await history.cancel({id:messageId},actor,reason);await removeIndex(messageId);
   return {...result,id:messageId,cancelled:true,serverNow:clock()};
  }
  throw fail('COMM_INVALID_ACTION');
 }
 return Object.freeze({execute,reserveIndex});
}
