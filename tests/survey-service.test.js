import test from 'node:test';import assert from 'node:assert/strict';
import {createSurveyService} from '../worker-training/survey-service.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
import {institutionalAssignmentKey} from '../src/institutional-group.js';
import {VERSION as climateVersion} from '../climate-domain/schema.js';
import {VERSION as stressVersion,QUESTIONS} from '../stress-domain/schema.js';
const identity={uid:'synthetic-one',email:'one@example.invalid',emailVerified:true,provider:'google.com'};
const response=(kind,id='a'.repeat(32))=>({survey_cycle:'2026',survey_version:kind==='climate'?climateVersion:stressVersion,submission_id:id,group:'substitute',...(kind==='climate'?{consent:true,answers:{Q01:4},comments:{O01:'Synthetic comment'}}:{answers:Object.fromEntries(QUESTIONS.map(q=>[q.id,2]))})});
async function fixture(){const profiles=vaccinationMemoryStore(),responses=vaccinationMemoryStore();profiles.seed('users',identity.uid,{uid:identity.uid,email:identity.email,active:true,access:true});profiles.seed('userCategories',await institutionalAssignmentKey(identity.email),{schemaVersion:1,identityStatus:'LINKED',uid:identity.uid,email:identity.email,memberCategories:['EFETIVO']});for(const kind of ['climate','stress'])responses.seed(kind+'Cycles','2026',{status:'open'});return {profiles,responses,service:createSurveyService({profileStore:profiles,responseStore:responses,uuid:()=> 'b'.repeat(32)})};}
const input=(kind,id)=>({survey:kind,cycle:'2026',response:response(kind,id)});
test('one account gets one response per survey/cycle; participation data contains no answer identifier or group',async()=>{
 const {service,responses}=await fixture();
 for(const kind of ['climate','stress']){
  assert.deepEqual(await service.execute('BOOTSTRAP',{survey:kind,cycle:'2026'},identity),{group:'team',alreadyResponded:false});
  assert.deepEqual(await service.execute('SUBMIT',input(kind),identity),{accepted:true,alreadyResponded:false});
  const again=input(kind,'c'.repeat(32));again.response.answers[kind==='climate'?'Q01':'S01']=5;
  assert.deepEqual(await service.execute('SUBMIT',again,identity),{accepted:true,alreadyResponded:true});
  assert.deepEqual(await service.execute('BOOTSTRAP',{survey:kind,cycle:'2026'},identity),{group:'team',alreadyResponded:true});
  const ledger=await responses.get('surveyParticipation',`${identity.uid}_${kind}_2026`);assert.deepEqual(ledger,{uid:identity.uid,survey:kind,cycle:'2026',completed:true});
  const rows=await responses.list(kind+'Responses');assert.equal(rows.length,1);assert.equal(rows[0].group,'team');assert.equal(rows[0].answers[kind==='climate'?'Q01':'S01'],kind==='climate'?4:2);
  for(const key of ['uid','email','name','ip','timestamp','participationId','score','band'])assert.equal(Object.hasOwn(rows[0],key),false);
  assert.equal((await responses.get(kind+'Responses','c'.repeat(32))),null);
 }
 const comments=await responses.list('climateComments');assert.equal(comments.length,1);assert.equal(Object.hasOwn(comments[0],'uid'),false);assert.equal(Object.hasOwn(comments[0],'group'),false);
});
test('concurrent submissions with distinct random IDs commit a single ledger and a single answer',async()=>{
 const {service,responses}=await fixture();const results=await Promise.all(Array.from({length:20},(_,i)=>service.execute('SUBMIT',input('stress',(i+1).toString(16).padStart(32,'0')),identity)));
 assert.equal(results.filter(r=>!r.alreadyResponded).length,1);assert.equal((await responses.list('stressResponses')).length,1);assert.equal((await responses.list('surveyParticipation')).length,1);
});
test('invalid identity, schema, closed cycle or revoked profile cannot consume a participation slot',async()=>{
 for(const patch of [{emailVerified:false},{provider:'password'},{uid:'../bad'},{email:'other@example.invalid'}]){const f=await fixture();await assert.rejects(f.service.execute('SUBMIT',input('stress'),{...identity,...patch}));assert.equal((await f.responses.list('surveyParticipation')).length,0);}
 for(const field of ['uid','email','ip','responseId']){const f=await fixture(),payload=input('stress');payload.response[field]='forbidden';await assert.rejects(f.service.execute('SUBMIT',payload,identity),e=>e.code==='SURVEY_INVALID_INPUT');assert.equal((await f.responses.list('surveyParticipation')).length,0);}
 const f=await fixture();f.responses.seed('stressCycles','2026',{status:'closed'});await assert.rejects(f.service.execute('SUBMIT',input('stress'),identity),e=>e.code==='SURVEY_CYCLE_CLOSED');assert.equal((await f.responses.list('surveyParticipation')).length,0);
 f.responses.seed('stressCycles','2026',{status:'open'});f.profiles.seed('users',identity.uid,{uid:identity.uid,email:identity.email,active:true,access:false});await assert.rejects(f.service.execute('SUBMIT',input('stress'),identity),e=>e.code==='SURVEY_FORBIDDEN');assert.equal((await f.responses.list('stressResponses')).length,0);
});
