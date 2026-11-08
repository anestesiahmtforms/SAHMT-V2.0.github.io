import {decodeFields} from './store.js';
import {projectFaPerformance} from '../fa-performance/domain.js';

// FB/FC rows below are current validated award contributions frozen at cutoff,
// not an assertion that their mutable source projections are immutable deltas.
// FD makes the chosen batch immutable; never also add source ledger revisions.
// Firestore readTime has a one-hour ordinary retention window. Older recovery
// needs configured PITR (minute-aligned cutoff, up to seven days); a refusal
// stays HISTORICAL_SNAPSHOT_REQUIRED and MUST NOT fall back to a current read.
// FI has no native award producer. Its explicitly approved FD fiPolicy reuses
// the existing ATRASO_V1 algorithm on official FI profiles/events only.
export const SAHMT_PERFORMANCE_PROJECTS=Object.freeze({FA:'sahmt-17a16',FG:'sahmt-checklist-fg',FI:'sahmt-operacional-fi',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt',FE:'outros-48120'});
export const SAHMT_PERFORMANCE_SOURCE_MANIFEST=Object.freeze({
 FG:Object.freeze({category:'OPERATIONS',runtime:'fgPerformanceRuntime/state',entries:'fgPerformanceLedger',summaries:'fgPerformanceSummaries',kind:'SIGNED_DELTA'}),
 FI:Object.freeze({category:'OPERATIONS',entries:'events',kind:'ATRASO_V1_APPROVED_SNAPSHOT'}),
 FB:Object.freeze({category:'MANAGEMENT',runtime:'fbPerformanceRuntime/current',reference:'fbPerformanceReference/team',entries:'fbPerformanceAwards',summaries:'fbPerformanceSummaries',kind:'CONFIRMED_AWARD_SNAPSHOT'}),
 FC:Object.freeze({category:'RECORDS',runtime:'fcPerformanceRuntime/state',reference:'fcPerformanceReference/team',entries:'fcPerformanceAwards',summaries:'fcPerformanceSummaries',kind:'CONFIRMED_AWARD_SNAPSHOT'}),
 FE:Object.freeze({category:'SURVEYS',runtime:'fePerformanceRuntime/current',entries:'fePerformanceAwards',summaries:'fePerformanceSummaries',kind:'IMMUTABLE_PARTICIPATION_AWARD'})
});
const fields={users:['uid','active','access','sigla'],fgPerformanceLedger:['uid','points','delta','sourceType','sourceProjectId','createdAt'],fgPerformanceSummaries:['uid','points'],fbPerformanceAwards:['uid','category','modality','points','sourceProjectId','updatedAt','revision'],fbPerformanceSummaries:['uid','total','revision'],fcPerformanceAwards:['uid','category','modality','points','updatedAt'],fcPerformanceSummaries:['uid','status','performanceTotal','performanceRevision'],fePerformanceAwards:['uid','category','points','survey','cycle','createdAt'],fePerformanceSummaries:['uid','total'],events:['eventType','memberSigla','delayMultiple','date','createdAt','active','status']};
const validUid=v=>typeof v==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(v)&&!['.','..'].includes(v);
const timestamp=v=>typeof v==='number'?v:typeof v==='string'?Date.parse(v):NaN;
const point=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1000000;
const normalized=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const dateKey=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
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
  if(body&&(!Array.isArray(value)||!value.length||value.some(row=>!row||row.error||!row.readTime)))fail(source,'COMPLETE_QUERY');
  if(body&&value.some(row=>row.readTime&&timestamp(row.readTime)!==ctx.ms))fail(source,'HISTORICAL_SNAPSHOT');
  const actual=body?Math.max(1,value.filter(row=>row.document).length):1;if(actual>take)fail(source,'COMPLETE_QUERY');ctx.readsByProject[source]=used+actual;
  return {value,take};
 }
 async function get(ctx,source,path){const {value}=await request(ctx,source,'/'+path);return value?decodeFields(value.fields||{}):null;}
 async function list(ctx,source,collection){
  const root=`projects/${SAHMT_PERFORMANCE_PROJECTS[source]}/databases/(default)/documents/${collection}/`;let cursor=null;const result=[];
  for(;;){const query={from:[{collectionId:collection}],select:{fields:fields[collection].map(fieldPath=>({fieldPath}))},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],...(cursor?{startAt:{values:[{referenceValue:cursor}],before:false}}:{})};
   const {value,take}=await request(ctx,source,':runQuery',{structuredQuery:query},1000),docs=value.filter(row=>row.document).map(row=>row.document);
   for(const doc of docs){if(typeof doc.name!=='string'||!doc.name.startsWith(root)||doc.name.slice(root.length).includes('/')||cursor&&doc.name<=cursor)fail(source,'COMPLETE_QUERY');cursor=doc.name;let row;try{row=decodeFields(doc.fields||{});}catch{fail(source,'COMPLETE_QUERY');}result.push({...row,id:doc.name.slice(root.length)});}
   if(docs.length<take)return result;
  }
 }
 function identities(source,members){
  if(!Array.isArray(members))fail(source,'IDENTITY');const mapped=new Map(),central=new Set();
  for(const member of members){if(!validUid(member?.uid)||central.has(member.uid))fail(source,'IDENTITY');central.add(member.uid);if(member.active!==true||member.access!==true)continue;const uid=member.sourceUids?.[source];if(!validUid(uid)||mapped.has(uid))fail(source,'IDENTITY');mapped.set(uid,member.uid);}
  return mapped;
 }
 async function eligible(ctx,members){
  if(!Array.isArray(members))fail('FA','IDENTITY');const directory=new Map();for(const member of members){if(!validUid(member?.uid)||directory.has(member.uid))fail('FA','IDENTITY');directory.set(member.uid,member);}
  const users=await list(ctx,'FA','users'),eligibleUids=[];for(const profile of users){if(profile.uid!==profile.id)fail('FA','IDENTITY');if(profile.active!==true||profile.access!==true)continue;if(!directory.has(profile.uid))fail('FA','DIRECTORY');eligibleUids.push(profile.uid);}
  const active=new Set(eligibleUids);return {eligibleUids,members:members.map(member=>({...member,active:active.has(member.uid),access:active.has(member.uid)}))};
 }
 async function sourceRows(ctx,source,members,fiPolicy){
  const manifest=SAHMT_PERFORMANCE_SOURCE_MANIFEST[source];if(!manifest)throw Error('SAHMT_SOURCE_UNKNOWN');
  if(source==='FI'&&(!fiPolicy||fiPolicy.rule!=='ATRASO_V1'||!Number.isFinite(timestamp(fiPolicy.effectiveFrom))||timestamp(fiPolicy.effectiveFrom)<=0||timestamp(fiPolicy.effectiveFrom)>=ctx.ms||!dateKey(fiPolicy.cutoffDay)||fiPolicy.cutoffDay>new Date(ctx.ms-3*3600000).toISOString().slice(0,10)))fail(source,'POLICY');
  const mapped=identities(source,members),runtime=manifest.runtime?await get(ctx,source,manifest.runtime):null;let effectiveFrom=0;
  if(source==='FG'){
   effectiveFrom=timestamp(runtime?.activatedAt);if(runtime?.status!=='ACTIVE'||runtime.projectId!==SAHMT_PERFORMANCE_PROJECTS.FG||runtime.rule!=='FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2'||!Number.isFinite(effectiveFrom)||effectiveFrom>=ctx.ms)fail(source,'ACTIVATION');
  }else if(source!=='FI'){
   effectiveFrom=timestamp(runtime?.effectiveFrom);if(runtime?.schemaVersion!==1||runtime.projectId!==SAHMT_PERFORMANCE_PROJECTS[source]||runtime.enabled!==true||!Number.isFinite(effectiveFrom)||effectiveFrom>=ctx.ms)fail(source,'ACTIVATION');
   if(source==='FB'&&runtime.mode!=='FB_ONLY')fail(source,'ACTIVATION');
   if(source==='FC'&&(runtime.mode!=='FC_ONLY'||runtime.release!=='fc-performance-exclusive-v1'||runtime.automaticFbSync!==false||runtime.legacyCentralStopped!==true||runtime.occurrenceScoringApproved!==true||runtime.performanceDirty!==false||!Number.isSafeInteger(runtime.performanceRevision)))fail(source,'ACTIVATION');
  }
  ctx.periodsBySource[source]={effectiveFrom:new Date(source==='FI'?timestamp(fiPolicy.effectiveFrom):effectiveFrom).toISOString(),...(source==='FI'?{cutoffDay:fiPolicy.cutoffDay}:{})};
  const profiles=await list(ctx,source,'users'),profileMap=new Map(profiles.map(row=>[row.id,row]));for(const uid of mapped.keys()){const profile=profileMap.get(uid);if(profile?.uid!==uid||profile.active!==true||profile.access!==true)fail(source,'IDENTITY');}
  const knownInactive=new Set(members.filter(m=>m.active===false||m.access===false).map(m=>m.sourceUids?.[source]).filter(validUid));
  for(const profile of profiles)if(profile.uid===profile.id&&(profile.active===false||profile.access===false))knownInactive.add(profile.uid);
  if(source==='FI'){
   const events=await list(ctx,source,'events'),official=profiles.filter(p=>p.id===p.uid&&p.active===true&&p.access===true);
   for(const event of events){const at=timestamp(event.createdAt);if(Number.isFinite(at)&&at>=ctx.ms)fail(source,'CUTOFF');if(normalized(event.eventType)!=='ATRASO'||event.active===false||['CANCELLED','CANCELED','CANCELADO','EXCLUIDO','DELETED'].includes(normalized(event.status)))continue;if(!Number.isFinite(at)||!dateKey(event.date))fail(source,'EVENT_CONTRACT');if(at<timestamp(fiPolicy.effectiveFrom)||event.date<fiPolicy.cutoffDay)continue;
    const matches=official.filter(p=>normalized(p.sigla)===normalized(event.memberSigla));if(matches.length!==1||!normalized(event.memberSigla))fail(source,'EVENT_IDENTITY');if(!mapped.has(matches[0].uid)&&!knownInactive.has(matches[0].uid))fail(source,'EVENT_IDENTITY');
   }
   let projection;try{projection=projectFaPerformance({events,profiles:official,contacts:[],signatures:[],requests:[],previousAwards:[],effectiveFrom:timestamp(fiPolicy.effectiveFrom),cutoffDay:fiPolicy.cutoffDay,now:ctx.ms-1,complete:true});}catch{fail(source,'EVENT_CONTRACT');}if(projection.pending)fail(source,'EVENT_IDENTITY');
   return projection.awards.filter(row=>mapped.has(row.uid)).map(row=>({id:'FI:'+row.id,uid:mapped.get(row.uid),category:'OPERATIONS',source:'FI',points:row.points,createdAt:row.sourceAt,label:'Atraso'}));
  }
  const reference=manifest.reference?await get(ctx,source,manifest.reference):null;
  if(source==='FB'&&(reference?.status!=='CONFIRMED'||!Number.isSafeInteger(reference.revision)||reference.revision<1))fail(source,'CONFIRMED_REVISION');
  if(source==='FC'&&(reference?.performanceStatus!=='CONFIRMED'||reference.performanceRevision!==runtime.performanceRevision))fail(source,'CONFIRMED_REVISION');
  const entries=await list(ctx,source,manifest.entries),summaries=await list(ctx,source,manifest.summaries),summaryMap=new Map(summaries.map(row=>[row.id,row])),rows=[],totals=new Map([...mapped.keys()].map(uid=>[uid,0]));
  for(const entry of entries){
   if(source==='FB'&&entry.revision!==reference.revision)continue;if(!mapped.has(entry.uid)){if(!validUid(entry.uid)||!knownInactive.has(entry.uid))fail(source,'IDENTITY');continue;}
   const at=timestamp(source==='FG'||source==='FE'?entry.createdAt:entry.updatedAt);if(!Number.isFinite(at)||at<effectiveFrom||at>=ctx.ms)fail(source,'CUTOFF');
   let points=entry.points;if(!point(points)||source==='FG'&&(![-1,1].includes(entry.delta)||points!==entry.delta||entry.sourceType!=='CHECKLIST'||entry.sourceProjectId!==SAHMT_PERFORMANCE_PROJECTS.FG))fail(source,'POINT_CONTRACT');
   if(source!=='FG'&&entry.category!=='PERFORMANCE')fail(source,'POINT_CONTRACT');
   if(source==='FB'&&(entry.sourceProjectId!==SAHMT_PERFORMANCE_PROJECTS.FB||!['ACKNOWLEDGEMENT','TEST','SUGGESTION','MANAGEMENT_TASK','TRAINING_ACCESS','TRAINING_COMPLETION'].includes(entry.modality)))fail(source,'POINT_CONTRACT');
   if(source==='FC'&&!['OCCURRENCE','ACKNOWLEDGEMENT','SUGGESTION'].includes(entry.modality))fail(source,'POINT_CONTRACT');
   if(source==='FE'&&(points!==1||!['climate','stress','epidemiological'].includes(entry.survey)||typeof entry.cycle!=='string'||entry.id!==entry.uid+'_'+entry.survey+'_'+entry.cycle))fail(source,'POINT_CONTRACT');
   totals.set(entry.uid,totals.get(entry.uid)+points);rows.push({id:source+':'+entry.id,uid:mapped.get(entry.uid),category:manifest.category,source,points,createdAt:at,label:source==='FG'?'Checklist':source==='FB'?'Treinamentos e gestão':source==='FC'?'Atividades de registros':'Participação em enquete'});
  }
  for(const [uid,total]of totals){const summary=summaryMap.get(uid);if(summary&&summary.uid!==uid)fail(source,'IDENTITY');if(source==='FB'&&(!summary||summary.revision!==reference.revision)||source==='FC'&&(!summary||summary.status!=='CONFIRMED'||summary.performanceRevision!==runtime.performanceRevision))fail(source,'CONFIRMED_REVISION');const published=summary?(source==='FG'?summary.points:source==='FC'?summary.performanceTotal:summary.total):0;if(!point(published)||Math.abs(published-total)>1e-8)fail(source,'RECONCILIATION');}
  return rows;
 }
 async function loadSource({source,cutoff,members,fiPolicy}={}){const ctx=context(cutoff);try{const rows=await sourceRows(ctx,source,members,fiPolicy);await finish(ctx,source);return {complete:true,rows,readsByProject:ctx.readsByProject,periodsBySource:ctx.periodsBySource};}catch(error){error.readsByProject={...ctx.readsByProject};throw error;}}
 async function loadEligibility({cutoff,members}={}){const ctx=context(cutoff);try{const result=await eligible(ctx,members);await finish(ctx,'FA');return {...result,readsByProject:ctx.readsByProject};}catch(error){error.readsByProject={...ctx.readsByProject};throw error;}}
 async function load({cutoff,members,fiPolicy}={}){const ctx=context(cutoff);try{const population=await eligible(ctx,members);await finish(ctx,'FA');const rows=[];for(const source of Object.keys(SAHMT_PERFORMANCE_SOURCE_MANIFEST)){rows.push(...await sourceRows(ctx,source,population.members,fiPolicy));await finish(ctx,source);}return {complete:true,rows,eligibleUids:population.eligibleUids,readsByProject:ctx.readsByProject,periodsBySource:ctx.periodsBySource};}catch(error){error.readsByProject={...ctx.readsByProject};throw error;}}
 return {load,loadSource,loadEligibility};
}
