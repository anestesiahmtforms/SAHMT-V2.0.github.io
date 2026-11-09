import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiSourceProvider} from '../worker-fi-control/sources.js';
const actor={uid:'fa-a',fiUid:'fi-a',email:'ana@example.test',profile:{active:true,access:true,permissions:{}},memberCategories:[]};
const sourceProfile={id:'source-a',uid:'source-a',email:actor.email,displayName:'Ana',sigla:'AA',active:true,access:true,permissions:{eventsRead:true,managementRead:true}};
function store(seed){return {get:async(c,id)=>seed[c]?.find(r=>r.id===id)||null,list:async(c,filters=[])=>structuredClone((seed[c]||[]).filter(r=>filters.every(f=>f.op==='ARRAY_CONTAINS'?r[f.field]?.includes(f.value):r[f.field]===f.value)))};}
test('source mapping supports distinct UIDs and excludes unrelated and textual-only event mentions',async()=>{
 const fj=store({users:[sourceProfile],contacts:[{id:'AA',sigla:'AA',name:'Ana',email:actor.email}],events:[{id:'own',createdByUid:'source-a',eventType:'Outros',description:'Segurança',active:true,version:1},{id:'sigla',createdByUid:'source-b',memberSigla:'AA',eventType:'Pessoal',active:true,version:1},{id:'named',createdByUid:'source-b',substitute:'Ana',eventType:'Suporte',active:true,version:1},{id:'other',createdByUid:'source-b',description:'Ana AA',eventType:'Outros',active:true,version:1}]});
 const sources=createFiSourceProvider({stores:{FJ:fj}}),rows=await sources.searchRecords(actor,'Segurança');
 assert.deepEqual(rows.map(r=>r.id).sort(),['FJ.events.named','FJ.events.own','FJ.events.sigla']);assert.equal(rows.find(r=>r.id.endsWith('own')).authorUid,'fa-a');
});
test('restricted legacy documents need effective membership and current source ACL',async()=>{
 const fa=store({users:[{...sourceProfile,id:'fa-a',uid:'fa-a'}],documentAccessEmails:[{id:actor.email,email:actor.email,active:true,groups:['GENERAL','RESTRICTED']}]});
 const fb=store({users:[sourceProfile],documents:[{id:'legacy',title:'Organograma',category:'Organograma',active:true,version:1}],scopedDocuments:[{id:'general',title:'Protocolo',category:'Protocolos',audienceGroup:'GENERAL',active:true,version:1}]});
 const sources=createFiSourceProvider({stores:{FA:fa,FB:fb}});
 assert.deepEqual((await sources.searchRecords(actor,'protocolo')).map(r=>r.id),['FB.scopedDocuments.general']);
 assert.equal((await sources.searchRecords({...actor,memberCategories:['EFETIVO']},'protocolo')).length,2);
 assert.ok(sources.coverage.some(r=>r.status==='CONTENT_NOT_INDEXED'));
});
test('duplicate email mapping fails closed instead of assuming same UIDs',async()=>{
 const fj=store({users:[sourceProfile,{...sourceProfile,id:'duplicate',uid:'duplicate'}],events:[{id:'secret',createdByUid:'source-a',active:true,eventType:'Pessoal',version:1}]});
 assert.deepEqual(await createFiSourceProvider({stores:{FJ:fj}}).searchRecords(actor),[]);
});

test('source retrieval includes inactive material in inactive folders but never emits an interactive form link',async()=>{
 const fa=store({users:[{...sourceProfile,id:'fa-a',uid:'fa-a'}],documentAccessEmails:[{id:actor.email,email:actor.email,active:true,groups:['GENERAL']}]});
 const fb=store({users:[sourceProfile],managementAreas:[{id:'folder',active:false}],documents:[{id:'archived',title:'Protocolo antigo',category:'Protocolos',managementAreaId:'folder',active:false,version:1,driveUrl:'https://docs.google.com/forms/d/formId/viewform'}]});
 const rows=await createFiSourceProvider({stores:{FA:fa,FB:fb}}).searchRecords(actor);assert.equal(rows.length,1);assert.equal(rows[0].active,false);assert.equal(rows[0].folderActive,false);assert.ok(!rows[0].url.includes('viewform'));
});
test('monthly snapshots preserve missing source coverage and read values instead of recalculating',async()=>{
 const metrics=[{id:'adherence',title:'Adesão',unit:'%',cadence:'MONTHLY',target:90,months:[{period:'2026-10',status:'VALID',value:82},{period:'2026-09',status:'VALID',value:80}]}];
 const fd=store({users:[{...sourceProfile,permissions:{admin:true}}],indicatorSnapshots:[{id:'2026_management',schemaVersion:1,year:2026,platform:'management',status:'AVAILABLE',version:3,checkedAt:123,metrics}]});
 const sources=createFiSourceProvider({stores:{FD:fd}}),snapshot=await sources.monthlySnapshot({...actor,profile:{...actor.profile,permissions:{admin:true}}},'2026-10');
 assert.equal(snapshot.complete,false);assert.ok(snapshot.missingSources.includes('FD.records'));assert.equal(snapshot.indicators[0].value,82);assert.equal(snapshot.indicators[0].previous,80);
});

test('inactive trainings and activities are searchable by their original audience without action or scoring fields',async()=>{
 const profile={...sourceProfile,permissions:{trainingsRead:true}};
 const fa=store({users:[{...profile,id:actor.uid,uid:actor.uid}]});
 const fb=store({users:[profile],trainings:[{id:'old',title:'Treinamento arquivado',description:'Consulta de segurança',active:false,version:1,completionPoints:100}],learningActivities:[{id:'own',title:'Ciência encerrada',description:'Texto consultável',audienceType:'USER',audienceValue:profile.uid,status:'INACTIVE',version:2,resourceUrl:'https://docs.google.com/forms/d/abc/viewform',completionKind:'ACKNOWLEDGEMENT'},{id:'other',title:'Reservado',audienceType:'USER',audienceValue:'other',status:'INACTIVE',version:1}]});
 const rows=await createFiSourceProvider({stores:{FA:fa,FB:fb}}).searchRecords(actor);
 assert.deepEqual(rows.map(r=>r.id),['FB.trainings.old','FB.learningActivities.own']);
 assert.ok(rows.every(r=>r.active===false&&r.url===''));
 assert.ok(rows.every(r=>!('completionPoints'in r)&&!('completionKind'in r)));
});
