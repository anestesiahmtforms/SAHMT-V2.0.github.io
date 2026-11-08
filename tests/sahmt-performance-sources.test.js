import test from 'node:test';
import assert from 'node:assert/strict';
import {createSahmtPerformanceSources} from '../worker-indicators/sahmt-performance-sources.js';
import {encodeFields} from '../worker-indicators/store.js';
const cutoff='2026-11-07T05:00:00.000Z',at=Date.parse(cutoff)-1000;
const projects={FD:'rotinas-8a617',FG:'sahmt-checklist-fg',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt',FE:'outros-48120',FI:'sahmt-operacional-fi'};
const member={uid:'fd-person',active:true,access:true,sourceUids:{FG:'fg-person',FB:'fb-person',FC:'fc-person',FE:'fe-person',FI:'fi-person'}};
function fixture(source='FG'){
 const data=new Map(),calls=[],uid=source==='FD'?member.uid:member.sourceUids[source],put=(c,id,v)=>data.set(c+'/'+id,v);
 put('users',uid,{uid,active:true,access:true,sigla:'AA'});
 if(source==='FG'){
  put('fgPerformanceRuntime','state',{status:'ACTIVE',projectId:projects.FG,rule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2',activatedAt:at-2000});
  put('fgPerformanceSummaries',uid,{uid,points:-1});
  put('fgPerformanceLedger','debit',{uid,delta:-1,points:-1,sourceType:'CHECKLIST',sourceProjectId:projects.FG,createdAt:at,day:'2026-11-07'});
 }else if(source==='FB'){
  put('fbPerformanceRuntime','current',{schemaVersion:1,projectId:projects.FB,enabled:true,mode:'FB_ONLY',effectiveFrom:at-2000});
  put('fbPerformanceReference','team',{status:'CONFIRMED',revision:3});
  put('fbPerformanceSummaries',uid,{uid,total:4,revision:3});
  put('fbPerformanceAwards','html_current',{uid,category:'PERFORMANCE',modality:'TEST',sourceProjectId:projects.FB,points:4,updatedAt:at,revision:3});
 }else if(source==='FE'){
  put('fePerformanceRuntime','current',{schemaVersion:1,projectId:projects.FE,enabled:true,effectiveFrom:at-2000});
  put('fePerformanceSummaries',uid,{uid,total:1});
  put('fePerformanceAwards',uid+'_climate_2026',{uid,category:'PERFORMANCE',points:1,survey:'climate',cycle:'2026',createdAt:at});
 }else if(source==='FC'){
  put('fcPerformanceRuntime','state',{schemaVersion:1,projectId:projects.FC,enabled:true,mode:'FC_ONLY',release:'fc-performance-exclusive-v1',automaticFbSync:false,legacyCentralStopped:true,occurrenceScoringApproved:true,effectiveFrom:at-2000,performanceDirty:false,performanceRevision:2});
  put('fcPerformanceReference','team',{performanceStatus:'CONFIRMED',performanceRevision:2});
  put('fcPerformanceSummaries',uid,{uid,status:'CONFIRMED',performanceTotal:2,performanceRevision:2});
  put('fcPerformanceAwards','occurrence',{uid,category:'PERFORMANCE',modality:'OCCURRENCE',points:2,updatedAt:at});
 }else put('events','late',{eventType:'ATRASO',memberSigla:'AA',date:'2026-11-06',delayMultiple:0,createdAt:at,active:true});
 const fetchImpl=async(url,init)=>{
  const u=new URL(url),project=u.pathname.split('/')[3],path=u.pathname.split('/documents')[1],body=init.body?JSON.parse(init.body):null;
  assert.equal(project,projects[source]);assert.equal(body?.readTime||u.searchParams.get('readTime'),cutoff);calls.push({url,body});
  const doc=(key,value)=>({name:`projects/${project}/databases/(default)/documents/${key}`,fields:encodeFields(value)});
  if(!body){const value=data.get(path.slice(1));return value?Response.json(doc(path.slice(1),value)):new Response('',{status:404});}
  const q=body.structuredQuery;assert.deepEqual(q.orderBy,[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]);
  const cursor=q.startAt?.values[0].referenceValue,rows=[...data].filter(([k])=>k.startsWith(q.from[0].collectionId+'/')).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>doc(k,v)).filter(d=>!cursor||d.name>cursor).slice(0,q.limit);
  return Response.json(rows.length?rows.map(document=>({document,readTime:cutoff})):[{readTime:cutoff}]);
 };
 const relayFor=(project,direct)=>({path,body,cutoff})=>direct('https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents'+path+'?readTime='+cutoff,{body:body?JSON.stringify(body):null});
 const fePerformanceRead=relayFor(projects.FE,fetchImpl);
 const create=(overrides={})=>createSahmtPerformanceSources({getAccessToken:async()=> 'source-token',fetchImpl,fePerformanceRead,now:()=>Date.parse(cutoff)+1000,...overrides});
 const input={source,cutoff,members:[member],fiPolicy:{rule:'ATRASO_V1',effectiveFrom:at-2000,cutoffDay:'2026-11-01'}};
 return {data,put,calls,uid,fetchImpl,fePerformanceRead,create,input};
}
test('FG signed debits map only the explicit cross-project UID',async()=>{
 const f=fixture(),r=await f.create().loadSource(f.input);
 assert.deepEqual(r.rows,[{id:'FG:debit',uid:'fd-person',category:'OPERATIONS',source:'FG',points:-1,createdAt:at,label:'Checklist'}]);assert.equal(r.readsByProject.FG,4);
});
test('FB counts a frozen current award once, never adding its overwritten ledger projection',async()=>{
 const f=fixture('FB');f.put('fbPerformanceLedger','old',{points:999});const r=await f.create().loadSource(f.input);
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].points,4);assert.equal(r.rows[0].category,'MANAGEMENT');assert.ok(!JSON.stringify(f.calls).includes('fbPerformanceLedger'));
});
test('FC validated current records awards reconcile the same published revision',async()=>{
 const f=fixture('FC');const r=await f.create().loadSource(f.input);assert.equal(r.rows[0].points,2);assert.equal(r.rows[0].category,'RECORDS');
 f.put('fcPerformanceReference','team',{performanceStatus:'CONFIRMED',performanceRevision:1});await assert.rejects(f.create().loadSource(f.input),/SAHMT_SOURCE_FC_CONFIRMED_REVISION_REQUIRED/);
});
test('FE participation award read never requests anonymous answers',async()=>{
 const f=fixture('FE'),unavailable=()=>assert.fail('FD never uses a direct FE credential or fetch');
 const r=await f.create({getAccessToken:unavailable,fetchImpl:unavailable}).loadSource(f.input);assert.equal(r.rows[0].points,1);assert.equal(r.rows[0].category,'SURVEYS');assert.equal(r.readsByProject.FE,4);assert.ok(!JSON.stringify(f.calls).includes('Responses'));
 await assert.rejects(f.create({fePerformanceRead:undefined,getAccessToken:unavailable,fetchImpl:unavailable}).loadSource(f.input),/SAHMT_SOURCE_FE_AUTHORIZATION_REQUIRED/);
});
test('confirmed source totals reconcile their historical awards but publish only the current period',async()=>{
 const f=fixture(),start=at-1000;
 const debit=f.data.get('fgPerformanceLedger/debit');
 f.put('fgPerformanceLedger','old',{...debit,delta:1,points:1,createdAt:start-1});
 f.put('fgPerformanceLedger','late-old-day',{...debit,day:'2026-11-06'});
 const r=await f.create().loadSource({...f.input,effectiveFrom:start});
 assert.deepEqual(r.rows.map(row=>row.id),['FG:debit']);
 assert.equal(r.periodsBySource.FG.effectiveFrom,new Date(start).toISOString());
});
test('a later correction does not pull a pre-period award into the new period',async()=>{
 const f=fixture('FC'),start=at-1000;
 f.put('fcPerformanceLedger','original',{awardId:'occurrence',uid:f.uid,category:'PERFORMANCE',awardVersion:1,createdAt:start-1});
 const r=await f.create().loadSource({...f.input,effectiveFrom:start});
 assert.deepEqual(r.rows,[]);
 f.put('fcPerformanceLedger','original',{awardId:'occurrence',uid:f.uid,category:'PERFORMANCE',awardVersion:1,createdAt:start});
 assert.equal((await f.create().loadSource({...f.input,effectiveFrom:start})).rows[0].createdAt,start);
});
test('a new FB training attempt counts its new-period score without importing the earlier best score',async()=>{
 const f=fixture('FB'),start=at-1000,id='html_course_'+f.uid+'_TEST';
 f.data.delete('fbPerformanceAwards/html_current');
 f.put('fbPerformanceAwards',id,{uid:f.uid,category:'PERFORMANCE',modality:'TEST',sourceProjectId:projects.FB,points:4,updatedAt:at,revision:3,awardVersion:2,activityId:'course',correctionSupported:false});
 f.put('htmlTrainingStates','state',{uid:f.uid,trainingId:'course',version:2,attempts:[{score:4,completedAt:start-1,acknowledgedAt:start-1},{score:2,completedAt:at,acknowledgedAt:start}]});
 const r=await f.create().loadSource({...f.input,effectiveFrom:start});
 assert.equal(r.rows[0].points,2);
 assert.equal(r.rows[0].id,'FB:'+id);
});
test('FI applies the existing ATRASO fractions/multiples and ignores canceled events',async()=>{
 const f=fixture('FI');f.put('events','late2',{...f.data.get('events/late'),delayMultiple:3});f.put('events','canceled',{...f.data.get('events/late'),delayMultiple:6,status:'CANCELADO'});
 const r=await f.create().loadSource(f.input);assert.deepEqual(r.rows.map(row=>row.points),[-.5,-3]);assert.ok(r.rows.every(row=>row.uid==='fd-person'&&row.source==='FI'));
});
test('FI refuses missing policy, unknown official sigla and ambiguous sigla rather than matching email/name',async()=>{
 const f=fixture('FI');await assert.rejects(f.create().loadSource({...f.input,fiPolicy:null}),/SAHMT_SOURCE_FI_POLICY_REQUIRED/);
 f.put('users',f.uid,{uid:f.uid,active:true,access:true,sigla:'OTHER',email:'same@example.test'});await assert.rejects(f.create().loadSource(f.input),/SAHMT_SOURCE_FI_EVENT_IDENTITY_REQUIRED/);
 f.put('users',f.uid,{uid:f.uid,active:true,access:true,sigla:'AA'});f.put('users','other',{uid:'other',active:true,access:true,sigla:'AA'});await assert.rejects(f.create().loadSource(f.input),/SAHMT_SOURCE_FI_EVENT_IDENTITY_REQUIRED/);
});
test('exact-full pagination advances exclusive document ID and bills terminal empty query',async()=>{
 const f=fixture();f.data.delete('fgPerformanceLedger/debit');for(let n=0;n<1000;n++)f.put('fgPerformanceLedger',String(n).padStart(4,'0'),{uid:f.uid,points:1,delta:1,sourceType:'CHECKLIST',sourceProjectId:projects.FG,createdAt:at});f.put('fgPerformanceSummaries',f.uid,{uid:f.uid,points:1000});
 const r=await f.create().loadSource(f.input);assert.equal(r.rows.length,1000);assert.equal(r.readsByProject.FG,1004);const pages=f.calls.filter(c=>c.body?.structuredQuery.from[0].collectionId==='fgPerformanceLedger');assert.equal(pages.length,2);assert.equal(pages[1].body.structuredQuery.startAt.before,false);
});
test('source authorization and historical snapshot refusal stay explicit failures',async()=>{
 const f=fixture();for(const [status,code]of [[403,'AUTHORIZATION'],[400,'HISTORICAL_SNAPSHOT']])await assert.rejects(f.create({fetchImpl:async()=>new Response('',{status})}).loadSource(f.input),new RegExp('SAHMT_SOURCE_FG_'+code+'_REQUIRED'));
});
test('null/duplicate identity mappings fail before reading and source profile UID mismatch fails',async()=>{
 const f=fixture();for(const members of [[{...member,sourceUids:{...member.sourceUids,FG:null}}],[member,{...member,uid:'other-fa'}]])await assert.rejects(f.create().loadSource({...f.input,members}),/SAHMT_SOURCE_FG_IDENTITY_REQUIRED/);assert.equal(f.calls.length,0);
 f.put('users',f.uid,{uid:'fd-person',active:true,access:true});await assert.rejects(f.create().loadSource(f.input),/SAHMT_SOURCE_FG_IDENTITY_REQUIRED/);
});
test('late entries and unreconciled totals cannot publish a complete source',async()=>{
 const f=fixture();f.put('fgPerformanceLedger','debit',{...f.data.get('fgPerformanceLedger/debit'),createdAt:Date.parse(cutoff)});await assert.rejects(f.create().loadSource(f.input),/SAHMT_SOURCE_FG_CUTOFF_REQUIRED/);
 f.put('fgPerformanceLedger','debit',{...f.data.get('fgPerformanceLedger/debit'),createdAt:at});f.put('fgPerformanceSummaries',f.uid,{uid:f.uid,points:0});await assert.rejects(f.create().loadSource(f.input),/SAHMT_SOURCE_FG_RECONCILIATION_REQUIRED/);
});
test('budget exhaustion, malformed query result and shifted readTime fail closed',async()=>{
 const f=fixture();await assert.rejects(f.create({readBudget:{reserve:async()=>{throw Error('INDICATOR_SOURCE_BUDGET_EXHAUSTED');}}}).loadSource(f.input),/SAHMT_SOURCE_FG_READ_BUDGET_REQUIRED/);
 await assert.rejects(f.create({fetchImpl:async(url,init)=>init.body?Response.json({documents:[]}):f.fetchImpl(url,init)}).loadSource(f.input),/SAHMT_SOURCE_FG_COMPLETE_QUERY_REQUIRED/);
 await assert.rejects(f.create({fetchImpl:async(url,init)=>{const r=await f.fetchImpl(url,init);if(!init.body)return r;return Response.json((await r.json()).map(row=>({...row,readTime:new Date(at).toISOString()})));}}).loadSource(f.input),/SAHMT_SOURCE_FG_HISTORICAL_SNAPSHOT_REQUIRED/);
});
test('empty or incomplete query envelopes cannot attest a complete empty source',async()=>{
 const f=fixture();for(const payload of [[],[{document:{name:`projects/${projects.FG}/databases/(default)/documents/users/${f.uid}`,fields:encodeFields({uid:f.uid,active:true,access:true})}}]])await assert.rejects(f.create({fetchImpl:async(url,init)=>init.body?Response.json(payload):f.fetchImpl(url,init)}).loadSource(f.input),/SAHMT_SOURCE_FG_COMPLETE_QUERY_REQUIRED/);
});
test('FI malformed active event dates/times and future policy scope stay pending',async()=>{
 const f=fixture('FI');f.put('events','late',{...f.data.get('events/late'),createdAt:'invalid'});await assert.rejects(f.create().loadSource(f.input),/SAHMT_SOURCE_FI_EVENT_CONTRACT_REQUIRED/);
 await assert.rejects(f.create().loadSource({...f.input,fiPolicy:{...f.input.fiPolicy,cutoffDay:'2026-11-09'}}),/SAHMT_SOURCE_FI_POLICY_REQUIRED/);
});
test('FD population excludes revoked central leaders and rejects missing institutional mappings',async()=>{
 const f=fixture('FD');f.put('users','fd-person',{uid:'fd-person',active:false,access:false});f.put('users','active-person',{uid:'active-person',active:true,access:true});
 await assert.rejects(f.create().loadEligibility({cutoff,members:[member]}),/SAHMT_SOURCE_FD_DIRECTORY_REQUIRED/);
 const r=await f.create().loadEligibility({cutoff,members:[member,{...member,uid:'active-person'}]});assert.deepEqual(r.eligibleUids,['active-person']);assert.equal(r.members.find(m=>m.uid==='fd-person').active,false);
});
test('one complete load fixes one shared cutoff across FD and every mapped source',async()=>{
 const fixtures=Object.fromEntries(['FD','FG','FI','FB','FC','FE'].map(source=>[projects[source],fixture(source)]));const fd=fixtures[projects.FD];fd.data.clear();fd.put('users','fd-person',{uid:'fd-person',active:true,access:true});
 const adapter=createSahmtPerformanceSources({getAccessToken:async()=> 'token',fetchImpl:(url,init)=>fixtures[new URL(url).pathname.split('/')[3]].fetchImpl(url,init),fePerformanceRead:fixtures[projects.FE].fePerformanceRead,now:()=>Date.parse(cutoff)+1000});
 const r=await adapter.load({cutoff,members:[member],fiPolicy:fixtures[projects.FI].input.fiPolicy});assert.equal(r.complete,true);assert.deepEqual(r.eligibleUids,['fd-person']);assert.equal(r.rows.reduce((sum,row)=>sum+row.points,0),5.5);assert.deepEqual(Object.keys(r.readsByProject).sort(),['FB','FC','FD','FE','FG','FI']);
});
test('per-project hard cap rejects a collection that cannot prove its last page',async()=>{
 const f=fixture();f.data.delete('fgPerformanceLedger/debit');for(let n=0;n<5998;n++)f.put('fgPerformanceLedger',String(n).padStart(5,'0'),{uid:f.uid,points:1,delta:1,sourceType:'CHECKLIST',sourceProjectId:projects.FG,createdAt:at});await assert.rejects(f.create().loadSource(f.input),/SAHMT_SOURCE_FG_READ_BUDGET_REQUIRED/);
});
test('one smaller project reservation funds every query and refunds unused reads once',async()=>{
 const f=fixture(),reserved=[],settled=[];const budget={reserve:async(project,count)=>{reserved.push([project,count]);return {project,count:7};},settle:async(ticket,count)=>settled.push([ticket.project,count])};const r=await f.create({readBudget:budget}).loadSource(f.input);assert.equal(r.rows[0].points,-1);assert.equal(r.readsByProject.FG,4);assert.deepEqual(reserved,[['FG',6000]]);assert.deepEqual(settled,[['FG',4]]);
});
test('failed semantic validation and unknown fetches never refund the project reservation',async()=>{
 const f=fixture(),reserved=[],settled=[];const budget={reserve:async(source,count)=>{reserved.push([source,count]);return {source,count};},settle:async()=>settled.push('unexpected')};f.put('fgPerformanceSummaries',f.uid,{uid:f.uid,points:100});
 await assert.rejects(f.create({readBudget:budget}).loadSource(f.input),/RECONCILIATION_REQUIRED/);assert.deepEqual(reserved,[['FG',6000]]);assert.deepEqual(settled,[]);
 await assert.rejects(f.create({readBudget:budget,fetchImpl:async()=>{throw Error('network');}}).loadSource(f.input),/AVAILABLE_SOURCE_REQUIRED/);assert.equal(reserved.length,2);assert.deepEqual(settled,[]);
});
test('source invocation reserves and settles once and stays below fifty external calls near the cap',async()=>{
 const f=fixture();f.data.delete('fgPerformanceLedger/debit');for(let n=0;n<5996;n++)f.put('fgPerformanceLedger',String(n).padStart(5,'0'),{uid:f.uid,points:1,delta:1,sourceType:'CHECKLIST',sourceProjectId:projects.FG,createdAt:at});f.put('fgPerformanceSummaries',f.uid,{uid:f.uid,points:5996});let budgetRequests=0;
 const r=await f.create({readBudget:{reserve:async(_source,count)=>{budgetRequests+=3;return {count};},settle:async()=>{budgetRequests++;}}}).loadSource(f.input);assert.equal(r.rows.length,5996);assert.ok(f.calls.length+budgetRequests<50);assert.equal(budgetRequests,4);assert.equal(r.readsByProject.FG,5999);
});
test('FG FB FC FE reject orphan awards and permit only explicitly inactive identities',async()=>{
 for(const source of ['FG','FB','FC','FE']){const f=fixture(source),collection={FG:'fgPerformanceLedger',FB:'fbPerformanceAwards',FC:'fcPerformanceAwards',FE:'fePerformanceAwards'}[source],entry=[...f.data].find(([key])=>key.startsWith(collection+'/'))[1];f.put(collection,'orphan',{...entry,uid:'orphan'});await assert.rejects(f.create().loadSource(f.input),new RegExp('SAHMT_SOURCE_'+source+'_IDENTITY_REQUIRED'));
  const members=[member,{uid:'revoked-central',active:false,access:false,sourceUids:{[source]:'orphan'}}];assert.equal((await f.create().loadSource({...f.input,members})).rows.length,1);
  f.put('users','orphan',{uid:'orphan',active:false,access:false});assert.equal((await f.create().loadSource(f.input)).rows.length,1);
 }
});
test('eligibility reserves once and settles once after its full paginated population scan',async()=>{
 const f=fixture('FD'),reservations=[],settlements=[];f.data.clear();f.put('users',member.uid,{uid:member.uid,active:true,access:true});const r=await f.create({readBudget:{reserve:async(source,count)=>{reservations.push([source,count]);return {count};},settle:async(_ticket,count)=>settlements.push(count)}}).loadEligibility({cutoff,members:[member]});assert.deepEqual(r.eligibleUids,[member.uid]);assert.deepEqual(reservations,[['FD',6000]]);assert.deepEqual(settlements,[1]);
});
test('source periods are explicit and keep each original activation boundary',async()=>{
 const f=fixture('FI'),r=await f.create().loadSource(f.input);assert.deepEqual(r.periodsBySource.FI,{effectiveFrom:new Date(at-2000).toISOString(),cutoffDay:'2026-11-01'});
});
