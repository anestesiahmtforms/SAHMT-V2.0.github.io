import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createFiSourceProvider} from '../worker-fi-control/sources.js';
import {parseScheduleQuestion} from '../worker-fi-control/personal-schedule.js';
const actor={uid:'fa-a',fiUid:'fi-a',email:'ana@example.test',profile:{active:true,access:true,permissions:{}},memberCategories:[]};
const sourceProfile={id:'source-a',uid:'source-a',email:actor.email,displayName:'Ana',sigla:'AA',active:true,access:true,permissions:{eventsRead:true,managementRead:true}};
function store(seed){
 const get=async(c,id)=>seed[c]?.find(r=>r.id===id)||null;
 return {get,getMany:keys=>Promise.all(keys.map(([c,id])=>get(c,id))),list:async(c,filters=[])=>structuredClone((seed[c]||[]).filter(r=>filters.every(f=>f.op==='ARRAY_CONTAINS'?r[f.field]?.includes(f.value):r[f.field]===f.value)))};
}
const fbRuntime=[{id:'independentFbCutover',status:'ACTIVE',release:'fb-independent-20261022-v1'}];
const documentAccess=(groups)=>[{id:actor.email,email:actor.email,active:true,groups}];
test('personal schedule questions parse Brazilian dates and relative dates without hijacking keyword search',()=>{
 const now=Date.parse('2026-12-12T01:30:00Z');
 const parse=query=>parseScheduleQuestion(query,now);
 assert.deepEqual(parse('Qual minha posição na escala no dia 12/12/2026?'),{status:'lookup',day:'2026-12-12'});
 assert.deepEqual(parse('Escala 2026-12-12'),{status:'lookup',day:'2026-12-12'});
 assert.deepEqual(parse('Em qual posição estou na escala amanhã?'),{status:'lookup',day:'2026-12-12'});
 assert.deepEqual(parse('Minha escala hoje'),{status:'lookup',day:'2026-12-11'});
 assert.deepEqual(parse('Minha escala'),{status:'date_required'});
 assert.deepEqual(parse('Minha escala em 31/02/2026'),{status:'invalid_date'});
 assert.deepEqual(parse('Minha escala em 11/12/2026 e 12/12/2026'),{status:'invalid_date'});
 assert.equal(parse('escala'),null);
 assert.equal(parse('escala de avaliação'),null);
 assert.equal(parse('Qual a posição de BB na escala de 12/12/2026?'),null);
});
test('personal schedule uses only the authenticated contact and returns no third-party positions',async()=>{
 const day='2026-12-11',question={status:'lookup',day};
 const profile={...sourceProfile,permissions:{scheduleRead:true}};
 const contact={id:'CR',sigla:'CR',email:actor.email,active:true};
 const date={id:day,date:day,positions:[{sigla:'BB',position:1},{sigla:'CR/LH',position:2},{sigla:'DC',position:3}]};
 const make=(overrides={})=>createFiSourceProvider({stores:{FJ:store({users:[profile],contacts:[contact],scheduleDays:[date],...overrides})}});
 assert.deepEqual(await make().personalSchedule({...actor,sigla:'BB'},question),{status:'found',day,positions:[2,3]});
 assert.deepEqual(await make({scheduleDays:[{...date,positions:[{sigla:'BB',position:1}]}]}).personalSchedule(actor,question),{status:'not_assigned',day});
 assert.deepEqual(await make({scheduleDays:[]}).personalSchedule(actor,question),{status:'schedule_missing',day});
 assert.deepEqual(await make({contacts:[{...contact,active:false}]}).personalSchedule(actor,question),{status:'identity_unlinked'});
 assert.deepEqual(await make({contacts:[contact,{...contact,id:'BB',sigla:'BB'}]}).personalSchedule(actor,question),{status:'identity_unlinked'});
 assert.deepEqual(await make({users:[{...profile,permissions:{}}]}).personalSchedule(actor,question),{status:'forbidden'});
});
test('source mapping supports distinct UIDs and excludes unrelated and textual-only event mentions',async()=>{
 const fj=store({users:[sourceProfile],contacts:[{id:'AA',sigla:'AA',name:'Ana',email:actor.email}],events:[{id:'own',createdByUid:'source-a',eventType:'Outros',description:'Segurança',active:true,version:1},{id:'sigla',createdByUid:'source-b',memberSigla:'AA',eventType:'Pessoal',active:true,version:1},{id:'named',createdByUid:'source-b',substitute:'Ana',eventType:'Suporte',active:true,version:1},{id:'other',createdByUid:'source-b',description:'Ana AA',eventType:'Outros',active:true,version:1}]});
 const sources=createFiSourceProvider({stores:{FJ:fj}}),rows=await sources.searchRecords(actor,'Segurança');
 assert.deepEqual(rows.map(r=>r.id).sort(),['FJ.events.named','FJ.events.own','FJ.events.sigla']);assert.equal(rows.find(r=>r.id.endsWith('own')).authorUid,'fa-a');
});
test('restricted legacy documents need effective membership and current source ACL',async()=>{
 const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(actor.email)))),v=>v.toString(16).padStart(2,'0')).join('');
 const fa=store({users:[{...sourceProfile,id:'fa-a',uid:'fa-a'}],documentAccessEmails:documentAccess(['GENERAL','RESTRICTED']),userCategories:[{id,schemaVersion:1,identityStatus:'LINKED',uid:actor.uid,email:actor.email,memberCategories:['EFETIVO']}]});
 const fb=store({users:[sourceProfile],evaluationRuntime:fbRuntime,documentAccessEmails:documentAccess(['GENERAL','RESTRICTED']),documents:[{id:'legacy',title:'Organograma',category:'Organograma',active:true,version:1}],scopedDocuments:[{id:'general',title:'Protocolo',category:'Categoria nova',audienceGroup:'GENERAL',active:true,version:1}]});
 const sources=createFiSourceProvider({stores:{FA:fa,FB:fb}});
 assert.deepEqual((await sources.searchRecords(actor,'protocolo')).map(r=>r.id),['FB.scopedDocuments.general']);
 assert.equal((await sources.searchRecords({...actor,memberCategories:['EFETIVO']},'protocolo')).length,2);
 assert.ok(sources.coverage.some(r=>r.status==='CONTENT_NOT_INDEXED'));
 const revoked=store({users:[sourceProfile],evaluationRuntime:fbRuntime,documentAccessEmails:documentAccess(['GENERAL']),documents:[{id:'legacy',title:'Organograma',category:'Organograma',active:false,version:1}]});
 assert.deepEqual(await createFiSourceProvider({stores:{FA:fa,FB:revoked}}).searchRecords({...actor,memberCategories:['EFETIVO']}),[]);
});
test('duplicate email mapping fails closed instead of assuming same UIDs',async()=>{
 const fj=store({users:[sourceProfile,{...sourceProfile,id:'duplicate',uid:'duplicate'}],events:[{id:'secret',createdByUid:'source-a',active:true,eventType:'Pessoal',version:1}]});
 assert.deepEqual(await createFiSourceProvider({stores:{FJ:fj}}).searchRecords(actor),[]);
});
test('general catalogue honors the active FB grant even without a legacy FA document grant',async()=>{
 const fa=store({users:[{...sourceProfile,id:actor.uid,uid:actor.uid}]});
 const docs=[
  {id:'general',title:'Dor perioperatória',category:'Protocolos',audienceGroup:'GENERAL',active:false},
  {id:'restricted',title:'Regimento',category:'Documentos administrativos',audienceGroup:'RESTRICTED'}
 ];
 const rows=grants=>createFiSourceProvider({stores:{FA:fa,FB:store({users:[sourceProfile],evaluationRuntime:fbRuntime,documentAccessEmails:documentAccess(grants),scopedDocuments:docs})}}).searchRecords(actor);
 assert.deepEqual((await rows(['GENERAL','RESTRICTED'])).map(r=>[r.id,r.active]),[['FB.scopedDocuments.general',false]]);
 assert.deepEqual(await rows([]),[]);
});
test('management activities require current permission and formal involvement',async()=>{
 const profile={...sourceProfile,permissions:{managementActivityWrite:true}};
 const fa=store({users:[{...profile,id:actor.uid,uid:actor.uid}]});
 const task={contextType:'MANAGEMENT_AREA',visibility:'AREA',title:'Revisão de material',description:'Conferir protocolos'};
 const rows=[
  {...task,id:'own',createdByUid:profile.uid},
  {...task,id:'assigned',createdByUid:'other',responsibleUids:[profile.uid]},
  {...task,id:'participant',createdByUid:'other',participantUids:[profile.uid]},
  {...task,id:'mention',createdByUid:'other',description:profile.displayName},
  {...task,id:'deleted',createdByUid:profile.uid,deleted:true}
 ];
 const fb=store({users:[profile],evaluationRuntime:fbRuntime,activities:rows});
 const provider=createFiSourceProvider({stores:{FA:fa,FB:fb}});
 assert.deepEqual((await provider.searchRecords(actor)).map(r=>r.id).sort(),['FB.activities.assigned','FB.activities.own','FB.activities.participant']);
});
test('HTML search validates the current version and audience and includes disabled folders read-only',async()=>{
 const catalogue=[
  {id:'open',title:'Material público',version:1,status:'PUBLISHED',category:'Protocolos',subcategory:'Desativados',audienceGroup:'GENERAL'},
  {id:'restricted',title:'Documento interno',version:1,status:'PUBLISHED',category:'Protocolos',audienceGroup:'RESTRICTED'},
  {id:'stale',title:'Outra edição',version:2,status:'PUBLISHED',category:'Protocolos',audienceGroup:'GENERAL'}
 ];
 const entries=catalogue.map(r=>({id:r.id,title:r.title,version:1,text:'Palavra no texto HTML'}));
 const revision='a'.repeat(64),compressed=gzipSync(JSON.stringify(entries)).toString('base64');
 const indexStore=store({fiSearchRecords:[{id:'html-library',revision,count:3},{id:'html-library-content',revision,compressed}]});
 const fa=store({users:[{...sourceProfile,id:actor.uid,uid:actor.uid}]});
 const fb=store({users:[sourceProfile],evaluationRuntime:fbRuntime,documentAccessEmails:documentAccess(['GENERAL','RESTRICTED']),htmlTrainings:catalogue,htmlTrainingSettings:[{id:'folders',disabled:['["Protocolos","Desativados"]']}]});
 const provider=createFiSourceProvider({stores:{FA:fa,FB:fb},indexStore});
 const rows=await provider.searchRecords(actor,row=>row.text.includes('HTML')?1:0);
 assert.deepEqual(rows.map(row=>[row.id,row.folderActive,row.url]),[['FB.htmlTrainings.open',false,'']]);
 assert.ok(provider.coverage.some(r=>r.source==='FB.htmlTrainings'&&r.status==='UNAVAILABLE'));
});
test('indexed search checks matching documents and their current access without scanning the whole catalogue',async()=>{
 const documents=[
  {id:'keep',title:'Protocolo A',category:'Protocolos',audienceGroup:'GENERAL',managementAreaId:'open'},
  {id:'now-restricted',title:'Protocolo B',category:'Protocolos',audienceGroup:'RESTRICTED'},
  {id:'unrelated',title:'Outra pauta',category:'Protocolos',audienceGroup:'GENERAL'}
 ];
 const indexStore=store({fiSearchRecords:[{id:'fb-catalogue',schemaVersion:1,updatedAt:100,sections:{documents:[],scopedDocuments:documents.map(({id,title})=>({id,title,text:''})),trainings:[],learningActivities:[]}}]});
 const fa=store({users:[{...sourceProfile,id:actor.uid,uid:actor.uid}]});
 const db=store({users:[sourceProfile],evaluationRuntime:fbRuntime,documentAccessEmails:documentAccess(['GENERAL']),scopedDocuments:documents,managementAreas:[{id:'open',active:true}]});
 const lists=[],pointReads=[];
 const fb={...db,list:(collection,...args)=>{lists.push(collection);return db.list(collection,...args);},
  getMany:keys=>{pointReads.push(...keys);return db.getMany(keys);}};
 const provider=createFiSourceProvider({stores:{FA:fa,FB:fb},indexStore,now:()=>110});
 const result=await provider.searchRecords(actor,row=>row.title.startsWith('Protocolo')?1:0);
 assert.deepEqual(result.map(r=>r.id),['FB.scopedDocuments.keep']);
 assert.deepEqual(lists,['users','activities','activities','activities']);
 assert.deepEqual(pointReads,[['scopedDocuments','keep'],['scopedDocuments','now-restricted'],['managementAreas','open']]);
});
test('an unavailable training collection does not discard authorized documents',async()=>{
 const profile={...sourceProfile,permissions:{...sourceProfile.permissions,trainingsRead:true}};
 const fa=store({users:[{...profile,id:actor.uid,uid:actor.uid}],documentAccessEmails:documentAccess(['GENERAL'])});
 const fb=store({users:[profile],evaluationRuntime:fbRuntime,documentAccessEmails:documentAccess(['GENERAL']),scopedDocuments:[{id:'public',title:'Manual interno',category:'Protocolos',audienceGroup:'GENERAL'}]});
 const sources=createFiSourceProvider({stores:{FA:fa,FB:{...fb,list:(collection,...args)=>{
  if(collection==='trainings')throw Object.assign(Error('READ_LIMIT'),{code:'FI_SOURCE_READ_BUDGET'});
  return fb.list(collection,...args);
 }}}});
 assert.deepEqual((await sources.searchRecords(actor)).map(row=>row.id),['FB.scopedDocuments.public']);
 assert.ok(sources.coverage.some(row=>row.source==='FB.trainings'&&row.status==='UNAVAILABLE'));
});

test('source retrieval includes inactive material in inactive folders but never emits an interactive form link',async()=>{
 const fa=store({users:[{...sourceProfile,id:'fa-a',uid:'fa-a'}],documentAccessEmails:[{id:actor.email,email:actor.email,active:true,groups:['GENERAL']}]});
 const fb=store({users:[sourceProfile],evaluationRuntime:fbRuntime,managementAreas:[{id:'folder',active:false}],documents:[{id:'archived',title:'Protocolo antigo',category:'Protocolos',managementAreaId:'folder',active:false,version:1,driveUrl:'https://docs.google.com/forms/d/formId/viewform'}]});
 const rows=await createFiSourceProvider({stores:{FA:fa,FB:fb}}).searchRecords(actor);assert.equal(rows.length,1);assert.equal(rows[0].active,false);assert.equal(rows[0].folderActive,false);assert.ok(!rows[0].url.includes('viewform'));
});
test('inactive form records link to their authorized PDF twin for consultation',async()=>{
 const fa=store({users:[{...sourceProfile,id:actor.uid,uid:actor.uid}],documentAccessEmails:documentAccess(['GENERAL'])});
 const base={title:'Protocolo antigo',category:'Protocolos',managementAreaId:'folder',audienceGroup:'GENERAL',active:false,version:1};
 const form={...base,id:'evaluation_formArchiveId1',driveFileId:'formArchiveId1',driveUrl:'https://docs.google.com/forms/d/formArchiveId1/viewform'};
 const pdf={...base,id:'pdf_'+form.id,driveFileId:'passiveArchiveId1',driveUrl:'https://drive.google.com/file/d/passiveArchiveId1/view'};
 const getRows=override=>createFiSourceProvider({stores:{FA:fa,FB:store({users:[sourceProfile],evaluationRuntime:fbRuntime,managementAreas:[{id:'folder',active:false}],documentAccessEmails:documentAccess(['GENERAL']),scopedDocuments:[form,{...pdf,...override}]})}}).searchRecords(actor);
 const formResult=rows=>rows.find(r=>r.id.endsWith('.'+form.id));
 const result=formResult(await getRows());
 assert.equal(result.url,'https://drive.google.com/file/d/passiveArchiveId1/preview');
 assert.equal(result.active,false);assert.equal(result.folderActive,false);
 assert.equal(formResult(await getRows({audienceGroup:'RESTRICTED'})).url,'');
 assert.equal(formResult(await getRows({trashed:true})).url,'');
});
test('monthly reads only approved QMENTUM aggregates for units in the current FC grant',async()=>{
 const month=(period,ratio)=>({id:period,schemaVersion:1,period,unitId:'a',status:'REVIEWED',definitionVersion:2,version:3,updatedAt:123,results:{QM01:{indicatorId:'QM01',status:'VALID',sourceMode:'CALCULATED',definitionVersion:2,inputVersion:3,populationKey:'surgical',ratio,target:.95,targetValidated:false}}});
 const fc=store({users:[sourceProfile],qmentumAccess:[{id:sourceProfile.uid,uid:sourceProfile.uid,active:true,role:'reviewer',units:['a','b']}],qmentumConfig:[{id:'current',enabled:true}],qmentumUnits:[{id:'a',unitId:'a',active:true},{id:'b',unitId:'b',active:true}], 'qmentumUnits/a/months':[month('2026-10',0),month('2026-09',.8)]});
 const sources=createFiSourceProvider({stores:{FC:fc}}),snapshot=await sources.monthlySnapshot({...actor,profile:{...actor.profile,permissions:{admin:true}}},'2026-10');
 assert.equal(snapshot.complete,false);assert.ok(snapshot.missingSources.includes('FC.QMENTUM.b'));assert.equal(snapshot.indicators[0].value,0);assert.equal(snapshot.indicators[0].previous,80);assert.equal(snapshot.indicators[0].target,null);
});

test('inactive trainings and activities are searchable by their original audience without action or scoring fields',async()=>{
 const profile={...sourceProfile,permissions:{trainingsRead:true}};
 const fa=store({users:[{...profile,id:actor.uid,uid:actor.uid}]});
 const fb=store({users:[profile],evaluationRuntime:fbRuntime,trainings:[{id:'old',title:'Treinamento arquivado',description:'Consulta de segurança',active:false,version:1,completionPoints:100}],learningActivities:[{id:'own',title:'Ciência encerrada',description:'Texto consultável',audienceType:'USER',audienceValue:profile.uid,showInTraining:true,status:'INACTIVE',version:2,resourceUrl:'https://docs.google.com/forms/d/abc/viewform',completionKind:'ACKNOWLEDGEMENT'},{id:'other',title:'Reservado',audienceType:'USER',audienceValue:'other',showInTraining:true,status:'INACTIVE',version:1}]});
 const rows=await createFiSourceProvider({stores:{FA:fa,FB:fb}}).searchRecords(actor);
 assert.deepEqual(rows.map(r=>r.id),['FB.trainings.old','FB.learningActivities.own']);
 assert.ok(rows.every(r=>r.active===false&&r.url===''));
 assert.ok(rows.every(r=>!('completionPoints'in r)&&!('completionKind'in r)));
});

test('direct notifications use the FF recipient and publication window',async()=>{
 const base={title:'Mensagem',message:'Conteúdo',audienceType:'USER',status:'published',publishAt:100,expiresAt:300};
 const ff=store({users:[sourceProfile],communicationMessages:[{...base,id:'inbox',audienceValue:sourceProfile.uid},{...base,id:'future',publishAt:201,audienceValue:sourceProfile.uid},{...base,id:'sent',audienceValue:'other',createdByUid:sourceProfile.uid}]});
 const rows=await createFiSourceProvider({stores:{FF:ff},now:()=>200}).searchRecords(actor);
 assert.deepEqual(rows.map(r=>r.id),['FF.communicationMessages.inbox']);
 assert.match(rows[0].text,/Conteúdo/);
});
