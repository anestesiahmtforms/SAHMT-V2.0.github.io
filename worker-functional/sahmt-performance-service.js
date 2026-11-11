// This API reads published daily contributions and maintains an append-only
// administrator ledger. The private staged processor owns publication.
import {SAHMT_START_ISO,SAHMT_START_TIME} from './sahmt-performance-period.js';
export const SAHMT_CATEGORIES=Object.freeze(['OPERATIONS','MANAGEMENT','RECORDS','SURVEYS','NOTIFICATIONS','CONTINUING_EDUCATION']);
const manualCategories=new Set(['NOTIFICATIONS','CONTINUING_EDUCATION']);
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(value)&&!['.','..'].includes(value);
const exact=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
const money=(value,limit=1000000)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit&&Math.abs(value*100-Math.round(value*100))<1e-6;
const rounded=value=>Math.round(value*100)/100;
const reason=value=>typeof value==='string'&&value.trim().length>=8&&value.length<=1000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function createSahmtPerformanceService({store,authorize,authorizeTransaction=async()=>{},now=Date.now}={}){
 if(!store?.get||!store?.list||!store?.transaction||typeof authorize!=='function')throw Error('SAHMT_SERVICE_CONFIGURATION_REQUIRED');
 async function runtime(){const value=await store.get('sahmtPerformanceRuntime','current');if(value?.schemaVersion!==1||value?.projectId!=='sahmt-funcional-fk'||value.enabled!==true||value.effectiveFrom!==SAHMT_START_ISO)fail('SAHMT_PERFORMANCE_PREPARING',503);return value;}
 async function members(){
  const rows=await store.list('sahmtPerformanceMembers',[],501);
  if(rows.length>500)fail('SAHMT_MEMBER_LIMIT',503);
  const seen=new Set();for(const row of rows){
   if(!id(row.uid)||row.id!==row.uid||seen.has(row.uid)||typeof row.active!=='boolean'||typeof row.access!=='boolean'||typeof row.sourceUids!=='object'||!row.sourceUids)fail('SAHMT_MEMBER_DIRECTORY_INVALID',503);
   for(const key of ['FG','FJ','FB','FC','FE'])if(row.sourceUids[key]!==null&&!id(row.sourceUids[key]))fail('SAHMT_MEMBER_DIRECTORY_INVALID',503);
   seen.add(row.uid);
  }
  return rows;
 }
 async function authorizeAgain(identity,manage=false){return authorize(identity,manage);}
 const listManual=filters=>store.listAll?store.listAll('sahmtPerformanceManual',filters,30000):store.list('sahmtPerformanceManual',filters,1000);
 async function view(identity,permissions){
  if(now()<SAHMT_START_TIME)return {status:'SCHEDULED',uid:identity.uid,canManage:false,effectiveFrom:SAHMT_START_TIME};
  const expectedBatch=new Date(now()-18000000).toISOString().slice(0,10)+'_02',latestRun=await store.get('sahmtPerformanceRuns',expectedBatch),incomplete=['FAILED','PARTIAL'].includes(latestRun?.status);
  const reference=await store.get('sahmtPerformanceReference','current');
  if(reference?.effectiveFrom!==SAHMT_START_TIME){await authorizeAgain(identity);return {status:'PREPARING',uid:identity.uid,canManage:permissions.canManage===true,incomplete,effectiveFrom:SAHMT_START_TIME};}
  const summary=await store.get('sahmtPerformanceSummaries',reference.batchId+'_'+identity.uid);
  await authorizeAgain(identity);
  if(!summary||summary.batchId!==reference.batchId)return {status:'PREPARING',uid:identity.uid,canManage:permissions.canManage===true};
  return {status:'READY',uid:identity.uid,canManage:permissions.canManage===true,batchId:reference.batchId,cutoff:reference.cutoff,updatedAt:reference.publishedAt,stale:now()>=reference.cutoff+86400000,incomplete,periodsBySource:reference.periodsBySource||{},summary:{total:summary.total,percentage:reference.maxTotal>0?summary.total/reference.maxTotal*100:null,byCategory:summary.byCategory}};
 }
 async function history(input,identity){
  if(!exact(input,['category'],['batchId','cursor'])||!SAHMT_CATEGORIES.includes(input.category))fail('SAHMT_INPUT_INVALID');
  const reference=await store.get('sahmtPerformanceReference','current');
  if(now()<SAHMT_START_TIME||reference?.effectiveFrom!==SAHMT_START_TIME)fail('SAHMT_PERFORMANCE_PREPARING',503);
  if(input.batchId&&input.batchId!==reference.batchId)fail('SAHMT_BATCH_CHANGED',409);
  let page=0;
  if(input.cursor!==undefined){
   if(typeof input.cursor!=='string'||!/^\d{4}-\d{2}-\d{2}_02:[A-Z_]+:[1-9]\d{0,5}$/.test(input.cursor))fail('SAHMT_INPUT_INVALID');
   const [batch,category,index]=input.cursor.split(':');if(batch!==reference.batchId||category!==input.category)fail('SAHMT_BATCH_CHANGED',409);page=Number(index);
  }
  const summary=await store.get('sahmtPerformanceSummaries',reference.batchId+'_'+identity.uid),pages=summary?.historyPages?.[input.category];
  if(!Number.isSafeInteger(pages)||pages<1||page>=pages)fail('SAHMT_HISTORY_PAGE_INVALID');
  const value=await store.get('sahmtPerformanceHistory',reference.batchId+'_'+identity.uid+'_'+input.category+'_'+page);
  await authorizeAgain(identity);
  if(page&&!value)fail('SAHMT_HISTORY_PAGE_INVALID');
  return {batchId:reference.batchId,rows:value?.rows||[],nextCursor:value?.hasMore?reference.batchId+':'+input.category+':'+(page+1):null};
 }
 async function appendManual(action,input,identity){
  if(now()<SAHMT_START_TIME)fail('SAHMT_PERFORMANCE_NOT_STARTED',409);
  const correction=action==='CORRECT_SAHMT_MANUAL';
  const required=correction?['requestId','entryId','expectedVersion','points','reason']:['requestId','uid','category','kind','points','reason'];
  if(!exact(input,required)||!id(input.requestId)||!money(input.points)||!reason(input.reason))fail('SAHMT_INPUT_INVALID');
  if(correction?(!id(input.entryId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1):(!id(input.uid)||!manualCategories.has(input.category)||(input.category==='NOTIFICATIONS'?!['ADVERSE_EVENT','MEETING','INFRACTION','PRAISE'].includes(input.kind):input.kind!=='CONTINUING_EDUCATION')))fail('SAHMT_INPUT_INVALID');
  const entryId=await hash(identity.uid+':'+input.requestId),signature=await hash(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)))));
  await runtime();await authorizeAgain(identity,true);
  const result=await store.transaction(async tx=>{
   await authorizeTransaction(tx,identity,true);
   const prior=await tx.get('sahmtPerformanceManual',entryId);
   if(prior){if(prior.signature!==signature)fail('SAHMT_MANUAL_REQUEST_CONFLICT',409);return {entryId,pointsPending:true,alreadySaved:true};}
   let subject=input.uid,category=input.category,kind=input.kind,delta=input.points,version=1,rootId=entryId;
   if(correction){
    const original=await tx.get('sahmtPerformanceManual',input.entryId);
    if(!original||original.correctsId||!Number.isFinite(original.createdAt)||original.createdAt<SAHMT_START_TIME)fail('SAHMT_MANUAL_ORIGINAL_REQUIRED',404);
    const current=await tx.get('sahmtPerformanceManualState',input.entryId);
    if(!current||current.version!==input.expectedVersion)fail('SAHMT_MANUAL_VERSION_CONFLICT',409);
    subject=original.uid;category=original.category;kind=original.kind;delta=rounded(input.points-current.points);version=current.version+1;rootId=input.entryId;
   }
   const member=await tx.get('sahmtPerformanceMembers',subject);
   const profile=await tx.get('users',subject);
   if(member?.uid!==subject||profile?.uid!==subject||profile.active!==true||profile.access!==true)fail('SAHMT_SUBJECT_UNAVAILABLE',409);
   const at=now();
   tx.create('sahmtPerformanceManual',entryId,{uid:subject,category,kind,points:delta,reason:input.reason.trim(),actorUid:identity.uid,createdAt:at,signature,correctsId:correction?input.entryId:null,version});
   tx.set('sahmtPerformanceManualState',rootId,{uid:subject,points:input.points,version,lastEntryId:entryId,updatedAt:at});
   return {entryId,pointsPending:true,alreadySaved:false};
  });
  await authorizeAgain(identity,true);return result;
 }
 async function execute(action,input,identity){
  const manage=['LIST_SAHMT_PEOPLE','ADD_SAHMT_MANUAL','CORRECT_SAHMT_MANUAL','LIST_SAHMT_MANUAL'].includes(action);
  const permissions=await authorizeAgain(identity,manage);
  if(action==='GET_SAHMT_PERFORMANCE'){if(!exact(input,[]))fail('SAHMT_INPUT_INVALID');return view(identity,permissions);}
  if(action==='LIST_SAHMT_HISTORY')return history(input,identity);
  if(action==='LIST_SAHMT_PEOPLE'){
   if(!exact(input,[]))fail('SAHMT_INPUT_INVALID');const rows=await members();await authorizeAgain(identity,true);
   return {people:rows.filter(row=>row.active&&row.access).map(row=>({uid:row.uid,displayName:String(row.displayName||row.uid).slice(0,120)}))};
  }
  if(action==='LIST_SAHMT_MANUAL'){
   if(!exact(input,['uid'])||!id(input.uid))fail('SAHMT_INPUT_INVALID');
   const rows=(await listManual([{field:'uid',op:'EQUAL',value:input.uid}])).filter(row=>row.createdAt>=SAHMT_START_TIME);await authorizeAgain(identity,true);
   const originals=rows.filter(row=>!row.correctsId).map(row=>row.id);
   const states=new Map();
   for(let offset=0;offset<originals.length;offset+=1000){
    const keys=originals.slice(offset,offset+1000);
    const values=store.getMany
     ? await store.getMany('sahmtPerformanceManualState',keys)
     : await Promise.all(keys.map(key=>store.get('sahmtPerformanceManualState',key)));
    keys.forEach((key,index)=>states.set(key,values[index]));
   }
   await authorizeAgain(identity,true);
   return {rows:rows.sort((a,b)=>b.createdAt-a.createdAt).map(({signature,...row})=>({...row,...(!row.correctsId&&states.get(row.id)?{currentPoints:states.get(row.id).points,currentVersion:states.get(row.id).version}:{})}))};
  }
  if(['ADD_SAHMT_MANUAL','CORRECT_SAHMT_MANUAL'].includes(action))return appendManual(action,input,identity);
  fail('SAHMT_ACTION_UNKNOWN');
 }
 return Object.freeze({execute});
}
