import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeBiosafetyService} from '../worker-fe-surveys/biosafety-service.js';
import {createFeSurveyWorker} from '../worker-fe-surveys/worker.js';
import legacy from '../worker-training/worker.js';
import {createSurveyService} from '../worker-training/survey-service.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
import {institutionalAssignmentKey} from '../src/institutional-group.js';

const now=()=>Date.parse('2026-11-14T15:00:00Z');
const input={year:2026,awareness:true,truth:true,states:{hepatitisB:'UNKNOWN',tetanus:'PENDING',mmr:'UPDATED',influenza:'NOT_ADHERED'},declaration:'WILL_UPDATE',notes:'',expectedVersion:0};
const principal=uid=>({uid,email:uid+'@example.invalid',emailVerified:true,provider:'google.com'});
async function fixture(){
 const store=vaccinationMemoryStore();
 for(const [uid,group] of [['team','EFETIVO'],['admin','EFETIVO'],['resident','RESIDENTE_1'],['substitute','SUBSTITUTO']]){
  const identity=principal(uid);
  store.seed('users',uid,{...identity,active:true,access:true,role:uid==='admin'?'administrador_app':'medico'});
  store.seed('userCategories',await institutionalAssignmentKey(identity.email),{schemaVersion:1,identityStatus:'LINKED',uid,email:identity.email,memberCategories:[group]});
 }
 store.seed('fePerformanceRuntime','current',{schemaVersion:1,projectId:'outros-48120',enabled:true,effectiveFrom:'2026-10-01T00:00:00Z'});
 const service=createFeBiosafetyService({store,now,checkFolder:async()=>{}});
 return {store,request:(kind,action,payload,actor='team')=>service.execute(action,{kind,payload},principal(actor)),service};
}
test('the first accepted vaccine record per year awards one FE-local point and never updates the export ledger',async()=>{
 const {store,request}=await fixture();
 const concurrent=await Promise.allSettled([request('vaccination','SAVE',input),request('vaccination','SAVE',input)]);
 assert.equal(concurrent.filter(item=>item.status==='fulfilled').length,1);
 await request('vaccination','SAVE',{...input,expectedVersion:1});
 await request('vaccination','SAVE',{...input,year:2027});
 await request('dosimetry','GET_OWN',{year:2026});
 assert.equal((await store.get('feVaccinationPerformanceSummaries','team')).total,2);
 assert.equal((await store.list('feVaccinationPerformanceAwards')).length,2);
 assert.equal((await store.list('fePerformanceAwards')).length,0);
 const surveyService=createSurveyService({profileStore:store,responseStore:store,now,performanceEnabled:true});
 const result=await surveyService.execute('GET_PERFORMANCE',{},principal('team'));
 assert.equal(result.summary.total,2);assert.equal(result.reference.maxTotal,2);
 assert.deepEqual(result.awards.map(award=>award.survey),['vaccination','vaccination']);
});

test('FE proves membership before reading histories, executing writes or serving private vaccination uploads',async()=>{
 const {request,store}=await fixture(),selection={context:'VACCINATION',year:2026};
 const file={...selection,subject:'hepatitisB',requestId:'12345678-1234-4234-8234-123456789012',mimeType:'application/pdf',dataBase64:Buffer.from('%PDF-1.7\n%%EOF').toString('base64')};
 for(const uid of ['resident','substitute']){
  await assert.rejects(request('vaccination','SAVE',input,uid),{code:'VAC_FORBIDDEN'});
  await assert.rejects(request('dosimetry','GET_OWN',{year:2026},uid),{code:'VAC_FORBIDDEN'});
  await assert.rejects(request('documents','UPLOAD',file,uid),{code:'VAC_FORBIDDEN'});
 }
 await request('documents','UPLOAD',file);
 await request('documents','UPLOAD',file);
 assert.equal((await request('documents','LIST_OWN',selection)).documents.length,1);
 assert.equal((await request('documents','GET',{...selection,requestId:file.requestId})).dataBase64,file.dataBase64);
 await assert.rejects(request('documents','GET',{...selection,requestId:file.requestId,uid:'admin'}),{code:'DOCUMENT_FORBIDDEN'});
 assert.equal((await request('documents','GET',{...selection,requestId:file.requestId,uid:'team'},'admin')).dataBase64,file.dataBase64);
 assert.equal((await store.list('feVaccinationPerformanceAwards')).length,0);
});

test('legacy health actions are retired before authorization while the manual stays separate',async()=>{
 const headers={Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'};
 for(const path of ['vaccination','dosimetry','professional-documents']){
  const input=path==='professional-documents'?{context:'VACCINATION'}:{year:2026};
  const result=await legacy.fetch(new Request('https://fixture.test/v1/'+path,{method:'POST',headers,body:JSON.stringify({action:'LIST_OWN',input})}),{});
  assert.equal(result.status,410);
 }
 const result=await legacy.fetch(new Request('https://fixture.test/v1/biosafety-manual',{method:'OPTIONS',headers}),{});
 assert.equal(result.status,204);
});

test('the FE worker verifies the shared FA login and uses the FE Biossegurança route',async()=>{
 const {service}=await fixture();
 const worker=createFeSurveyWorker({
  verifyIdentity:async(_header,options)=>{assert.equal(options.projectId,'sahmt-17a16');return principal('team');},
  buildFeBiosafetyService:()=>service
 });
 const response=await worker.fetch(new Request('https://fixture.test/v1/biosafety',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'BOOTSTRAP',input:{kind:'vaccination',payload:{year:2026}}})}),{});
 assert.equal(response.status,200);
 assert.equal((await response.json()).record,null);
});