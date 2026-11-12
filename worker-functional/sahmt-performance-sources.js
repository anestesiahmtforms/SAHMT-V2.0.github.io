import {decodeFields} from './performance-store.js';
import {SAHMT_START_TIME} from './sahmt-performance-period.js';

// Source modules push immutable, normalized batches into FK. The aggregator
// reads the configured EQUIPE roster and snapshots only from FK.
export const SAHMT_PERFORMANCE_PROJECTS=Object.freeze({FK:'sahmt-funcional-fk'});
export const SAHMT_PERFORMANCE_SOURCE_MANIFEST=Object.freeze({
 FG:Object.freeze({category:'OPERATIONS',pushCollection:'sahmtPerformanceSourceSnapshots',batchCollection:'sahmtPerformanceSourceBatches'}),
 FJ:Object.freeze({category:'OPERATIONS',pushCollection:'sahmtPerformanceSourceSnapshots',batchCollection:'sahmtPerformanceSourceBatches'}),
 FC:Object.freeze({category:'RECORDS',pushCollection:'sahmtPerformanceSourceSnapshots',batchCollection:'sahmtPerformanceSourceBatches'}),
 FE:Object.freeze({category:'SURVEYS',pushCollection:'sahmtPerformanceSourceSnapshots',batchCollection:'sahmtPerformanceSourceBatches'}),
 FK:Object.freeze({category:'SURVEYS',nativeCollection:'functionalPerformanceAwards'})
});
const fields={sahmtPerformanceSourceSnapshots:['schemaVersion','source','cutoff','effectiveFrom','chunkIndex','chunkCount','rows'],sahmtPerformanceSourceBatches:['schemaVersion','source','cutoff','effectiveFrom','chunkCount','rowCount','status'],functionalPerformanceAwards:['uid','source','category','points','survey','cycle','createdAt']};
const validUid=v=>typeof v==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(v)&&!['.','..'].includes(v);
const timestamp=v=>typeof v==='number'?v:typeof v==='string'?Date.parse(v):NaN;
const point=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1000000;
const fail=(source,reason)=>{throw Object.assign(Error(`SAHMT_SOURCE_${source}_${reason}_REQUIRED`),{code:`SAHMT_SOURCE_${source}_${reason}_REQUIRED`});};

export function createSahmtPerformanceSources({getAccessToken,fetchImpl=fetch,readBudget=null,now=Date.now}={}){
 if(typeof getAccessToken!=='function'||typeof fetchImpl!=='function')throw Error('SAHMT_SOURCE_CONFIGURATION_REQUIRED');
 function context(cutoff){const ms=timestamp(cutoff);if(!Number.isFinite(ms)||ms>now())throw Error('SAHMT_SOURCE_CUTOFF_REQUIRED');return {cutoff:new Date(ms).toISOString(),ms,readsByProject:{},periodsBySource:{},reservations:{}};}
 async function reservation(ctx,source){
  if(!Object.hasOwn(ctx.reservations,source)){
   let ticket=null;try{if(readBudget){ticket=await readBudget.reserve(source,6000);if(!Number.isSafeInteger(ticket?.count)||ticket.count<1||ticket.count>6000)fail(source,'READ_BUDGET');}}catch{fail(source,'READ_BUDGET');}
   ctx.reservations[source]={ticket,count:ticket?.count||6000,settled:false};
  }
  return ctx.reservations[source];
 }
 async function finish(ctx,source){
  const held=ctx.reservations[source];if(!held||held.settled)return;
  if(held.ticket)try{await readBudget.settle(held.ticket,Math.max(1,ctx.readsByProject[source]||0));}catch{fail(source,'READ_ACCOUNTING');}
  held.settled=true;
 }
 async function request(ctx,source,path,body=null,take=1){
  const held=await reservation(ctx,source),used=ctx.readsByProject[source]||0;if(used>=held.count||held.settled)fail(source,'READ_BUDGET');
  take=Math.min(take,held.count-used);
  if(body)body={...body,readTime:ctx.cutoff,structuredQuery:{...body.structuredQuery,limit:take}};
  const root='https://firestore.googleapis.com/v1/projects/'+SAHMT_PERFORMANCE_PROJECTS[source]+'/databases/(default)/documents';
  let response;
  try{response=await fetchImpl(root+path+(body?'':(path.includes('?')?'&':'?')+'readTime='+encodeURIComponent(ctx.cutoff)),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getAccessToken(source),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(25000)});}catch{fail(source,'AVAILABLE_SOURCE');}
  // Failed/unknown reads remain fully reserved, never refunded optimistically.
  if(!response.ok&&response.status!==404){await response.body?.cancel();if([401,403].includes(response.status))fail(source,'AUTHORIZATION');if([400,412].includes(response.status))fail(source,'HISTORICAL_SNAPSHOT');fail(source,'AVAILABLE_SOURCE');}
  let value=null;try{if(response.status!==404)value=await response.json();else await response.body?.cancel();}catch{fail(source,'COMPLETE_QUERY');}
  if(body&&(!Array.isArray(value)||value.some(row=>!row||row.error||!row.readTime)))fail(source,'COMPLETE_QUERY');
  if(body&&value.some(row=>row.readTime&&timestamp(row.readTime)!==ctx.ms))fail(source,'HISTORICAL_SNAPSHOT');
  const actual=body?Math.max(1,value.filter(row=>row.document).length):1;if(actual>take)fail(source,'COMPLETE_QUERY');ctx.readsByProject[source]=used+actual;
  return {value,take};
 }
 async function list(ctx,source,collection,where){
  const root=`projects/${SAHMT_PERFORMANCE_PROJECTS[source]}/databases/(default)/documents/${collection}/`;let cursor=null;const result=[];
  for(;;){const query={from:[{collectionId:collection}],select:{fields:fields[collection].map(fieldPath=>({fieldPath}))},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],...(where?{where}:{}),...(cursor?{startAt:{values:[{referenceValue:cursor}],before:false}}:{})};
   const {value,take}=await request(ctx,source,':runQuery',{structuredQuery:query},1000),docs=value.filter(row=>row.document).map(row=>row.document);
   for(const doc of docs){if(typeof doc.name!=='string'||!doc.name.startsWith(root)||doc.name.slice(root.length).includes('/')||cursor&&doc.name<=cursor)fail(source,'COMPLETE_QUERY');cursor=doc.name;let row;try{row=decodeFields(doc.fields||{});}catch{fail(source,'COMPLETE_QUERY');}result.push({...row,id:doc.name.slice(root.length)});}
   if(docs.length<take)return result;
  }
 }
 async function listSourceBatches(ctx,source,manifest){
  const collection=manifest.batchCollection,root=`projects/${SAHMT_PERFORMANCE_PROJECTS.FK}/databases/(default)/documents/${collection}/`;
  const where={compositeFilter:{op:'AND',filters:[
   {fieldFilter:{field:{fieldPath:'source'},op:'EQUAL',value:{stringValue:source}}},
   {fieldFilter:{field:{fieldPath:'cutoff'},op:'LESS_THAN_OR_EQUAL',value:{integerValue:String(ctx.ms)}}}
  ]}};
  const manifests=[];let cursor=null;
  for(;;){
   const query={from:[{collectionId:collection}],where,
    orderBy:[{field:{fieldPath:'cutoff'},direction:'ASCENDING'},{field:{fieldPath:'__name__'},direction:'ASCENDING'}],
    select:{fields:fields[collection].map(fieldPath=>({fieldPath}))},
    ...(cursor?{startAt:{values:[{integerValue:String(cursor.cutoff)},{referenceValue:cursor.name}],before:false}}:{})};
   const {value,take}=await request(ctx,'FK',':runQuery',{structuredQuery:query},1000),documents=value.filter(row=>row.document).map(row=>row.document);
   for(const document of documents){
    if(typeof document.name!=='string'||!document.name.startsWith(root)||document.name.slice(root.length).includes('/'))fail(source,'PUSH_QUERY_INVALID');
    let row;try{row=decodeFields(document.fields||{});}catch{fail(source,'PUSH_QUERY_INVALID');}
    if(!Number.isSafeInteger(row.cutoff)||row.cutoff>ctx.ms||cursor&&(row.cutoff<cursor.cutoff||row.cutoff===cursor.cutoff&&document.name<=cursor.name))fail(source,'PUSH_QUERY_INVALID');
    manifests.push({...row,id:document.name.slice(root.length)});cursor={cutoff:row.cutoff,name:document.name};
   }
   if(documents.length<take)break;
  }
  const batches=[];
  for(const batch of manifests){
   if(batch.schemaVersion!==1||batch.source!==source||batch.status!=='COMPLETE'||batch.id!==source+'_'+batch.cutoff||
     !Number.isSafeInteger(batch.effectiveFrom)||batch.effectiveFrom<SAHMT_START_TIME||batch.effectiveFrom>=batch.cutoff||
     !Number.isSafeInteger(batch.chunkCount)||batch.chunkCount<1||batch.chunkCount>100||!Number.isSafeInteger(batch.rowCount)||batch.rowCount<0||batch.rowCount>30000)
     fail(source,'PUSH_BATCH_INVALID');
   const chunks=await list(ctx,'FK',manifest.pushCollection,[
    {field:'source',op:'EQUAL',value:source},{field:'cutoff',op:'EQUAL',value:batch.cutoff}
   ]);
   if(chunks.length!==batch.chunkCount)fail(source,'PUSH_BATCH_INCOMPLETE');
   const indexes=new Set();let rowCount=0;
   for(const chunk of chunks){
    if(chunk.schemaVersion!==1||chunk.source!==source||chunk.cutoff!==batch.cutoff||chunk.effectiveFrom!==batch.effectiveFrom||
      chunk.chunkCount!==batch.chunkCount||!Number.isSafeInteger(chunk.chunkIndex)||chunk.chunkIndex<0||chunk.chunkIndex>=batch.chunkCount||
      indexes.has(chunk.chunkIndex)||!Array.isArray(chunk.rows))fail(source,'PUSH_BATCH_INVALID');
    indexes.add(chunk.chunkIndex);rowCount+=chunk.rows.length;
   }
   if(indexes.size!==batch.chunkCount||rowCount!==batch.rowCount)fail(source,'PUSH_BATCH_INCOMPLETE');
   batches.push({...batch,chunks:chunks.sort((a,b)=>a.chunkIndex-b.chunkIndex)});
  }
  return batches;
 } function identities(source,members){
  if(!Array.isArray(members))fail(source,'IDENTITY');const mapped=new Map(),central=new Set();
  for(const member of members){if(!validUid(member?.uid)||central.has(member.uid))fail(source,'IDENTITY');central.add(member.uid);if(member.active!==true||member.access!==true)continue;const uid=member.sourceUids?.[source];if(!validUid(uid)||mapped.has(uid))fail(source,'IDENTITY');mapped.set(uid,member.uid);}
  return mapped;
 }
 async function eligible(_ctx,members){
  if(!Array.isArray(members))fail('FK','IDENTITY');
  const directory=new Map();
  for(const member of members){
   if(!validUid(member?.uid)||member.id!==member.uid||directory.has(member.uid)||member.group!=='EQUIPE'||
      typeof member.active!=='boolean'||typeof member.access!=='boolean')fail('FK','DIRECTORY');
   directory.set(member.uid,member);
  }
  const eligibleUids=members.filter(member=>member.active&&member.access).map(member=>member.uid);
  return {eligibleUids,members:members.map(member=>({...member}))};
 }
 async function sourceRows(ctx,source,members,fiPolicy,periodStart){
  const manifest=SAHMT_PERFORMANCE_SOURCE_MANIFEST[source];if(!manifest)fail(source,'PUSH_INTEGRATION_REQUIRED');
  if(periodStart!==undefined&&(!Number.isSafeInteger(periodStart)||periodStart<=0||periodStart>=ctx.ms))fail(source,'CUTOFF');
  if(source==='FK'){
   const mapped=new Map(members.filter(member=>member.active===true&&member.access===true&&member.group==='EQUIPE').map(member=>[member.uid,member.uid]));
   const awards=await list(ctx,'FK',manifest.nativeCollection),rows=[],start=periodStart||SAHMT_START_TIME;
   for(const award of awards){
    if(award.source!=='FK'||award.category!=='SURVEYS'||!['climate','stress','epidemiological'].includes(award.survey)||
      typeof award.cycle!=='string'||!Number.isSafeInteger(award.createdAt)||award.createdAt<SAHMT_START_TIME||award.createdAt>=ctx.ms||
      !point(award.points)||award.points!==1)fail(source,'PUSH_ROW_INVALID');
    if(!mapped.has(award.uid))continue;
    if(award.createdAt>=start)rows.push({id:'FK:'+award.id,uid:award.uid,category:manifest.category,source,points:award.points,
      createdAt:award.createdAt,label:'Participação em pesquisa institucional'});
   }
   return {complete:true,rows,readsByProject:{FK:ctx.readsByProject.FK||0},periodsBySource:{FK:{effectiveFrom:new Date(start).toISOString()}}};
  }
  const mapped=identities(source,members);
  const batches=await listSourceBatches(ctx,source,manifest);
  if(!batches.length)fail(source,'PUSH_BATCH_REQUIRED');
  const latestCutoff=batches.at(-1).cutoff;
  if(latestCutoff<ctx.ms-20*60*60*1000)fail(source,'PUSH_BATCH_STALE');
  const effectiveFrom=batches[0].effectiveFrom;
  if(batches.some(batch=>batch.effectiveFrom!==effectiveFrom))fail(source,'PUSH_BATCH_INVALID');
  const start=Math.max(periodStart||0,effectiveFrom),rows=[],seen=new Map(),category=manifest.category;
  for(const batch of batches)for(const chunk of batch.chunks)for(const row of chunk.rows){
    if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_.@+:%-]{1,200}$/.test(row.id)||!validUid(row.uid)||row.category!==category||!point(row.points)||
      !Number.isSafeInteger(row.createdAt)||row.createdAt<effectiveFrom||row.createdAt>=batch.cutoff||typeof row.label!=='string'||row.label.length>120)fail(source,'PUSH_ROW_INVALID');
    const key=source+':'+row.id,signature=JSON.stringify([row.uid,row.category,row.points,row.createdAt,row.label]);
    if(seen.has(key)){if(seen.get(key)!==signature)fail(source,'PUSH_ROW_CONFLICT');continue;}
    seen.set(key,signature);
    // Only the EQUIPE roster is eligible in FK. Source batches can include
    // non-team records; drop those whose origin identity is outside that roster.
    if(!mapped.has(row.uid))continue;
    if(row.createdAt>=start)rows.push({id:key,uid:mapped.get(row.uid),category,source,points:row.points,createdAt:row.createdAt,label:row.label});
  }
  ctx.periodsBySource[source]={effectiveFrom:new Date(start).toISOString(),sourceEffectiveFrom:new Date(effectiveFrom).toISOString(),sourceCutoff:new Date(latestCutoff).toISOString()};
  return {complete:true,rows,readsByProject:{FK:ctx.readsByProject.FK||0},periodsBySource:ctx.periodsBySource};
 } async function loadSource({source,cutoff,members,fiPolicy,effectiveFrom}={}){const ctx=context(cutoff);try{const input=await sourceRows(ctx,source,members,fiPolicy,effectiveFrom);await finish(ctx,'FK');return {...input,readsByProject:ctx.readsByProject,periodsBySource:ctx.periodsBySource};}catch(error){error.readsByProject={...ctx.readsByProject};throw error;}}
 async function loadEligibility({cutoff,members}={}){const ctx=context(cutoff);try{const result=await eligible(ctx,members);return {...result,readsByProject:ctx.readsByProject};}catch(error){error.readsByProject={...ctx.readsByProject};throw error;}}
 async function load({cutoff,members,fiPolicy,effectiveFrom}={}){const ctx=context(cutoff);try{fail('FB','PUSH_INTEGRATION_REQUIRED');const population=await eligible(ctx,members);const rows=[];for(const source of Object.keys(SAHMT_PERFORMANCE_SOURCE_MANIFEST)){const input=await sourceRows(ctx,source,population.members,fiPolicy,effectiveFrom);rows.push(...input.rows);}await finish(ctx,'FK');return {complete:true,rows,eligibleUids:population.eligibleUids,readsByProject:ctx.readsByProject,periodsBySource:ctx.periodsBySource};}catch(error){error.readsByProject={...ctx.readsByProject};throw error;}}
 return {load,loadSource,loadEligibility};
}
