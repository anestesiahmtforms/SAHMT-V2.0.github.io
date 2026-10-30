import test from 'node:test';
import assert from 'node:assert/strict';
import {createHtmlTrainingService} from '../worker-training/service.js';
import {memoryStore} from './helpers/html-training-memory-store.js';
import {buildReadingPlan} from '../worker-training/reading-plan.js';
const who=uid=>({uid,email:uid+'@example.invalid',emailVerified:true,provider:'google.com'});
const denied=code=>e=>e.code===code;
async function setup(){
 const store=memoryStore();let time=1000000,serial=0;
 for(const uid of ['admin','reader']){store.seed('users',uid,{uid,active:true,access:true,role:uid==='admin'?'administrador_app':'colaborador'});store.seed('documentAccessEmails',uid+'@example.invalid',{id:uid+'@example.invalid',email:uid+'@example.invalid',active:true,groups:['GENERAL']});}
 const service=createHtmlTrainingService({store,readingRequired:true,now:()=>time,uuid:()=>`run-${++serial}`});
 const exec=(action,input={},uid='reader')=>service.execute(action,{trainingId:'document-one',...input},who(uid));
 const bank=Array.from({length:5},(_,i)=>({id:'q'+i,stem:'Pergunta '+i,points:1,options:[{id:'a',text:'Sim'},{id:'b',text:'Não'}],correctOptionId:'a'}));
 const pub={trainingId:'document-one',expectedVersion:0,training:{title:'Documento',category:'Diretrizes',subcategory:'',status:'PUBLISHED',managerUid:'',audienceGroup:'GENERAL',source:{}},sections:[{id:'body',title:'Texto',html:'<p>'+Array(60).fill('um').join(' ')+'</p>'}],bank,selectedQuestionIds:bank.map(q=>q.id)};
 await exec('PUBLISH',pub,'admin');
 const begin=await exec('BEGIN',{requestId:'first'}),runId=begin.state.run.id;
 const open=await exec('OPEN');
 return {store,exec,pub,open,runId,advance:ms=>time+=ms};
}
test('complete reading derives its time from published text and never exposes answers',async()=>{
 const h=await setup();assert.ok(h.open.readingPlan,'OPEN must supply a server plan');
 assert.equal(h.open.readingPlan.totalRequiredMs,18000);assert.equal(h.open.readingPlan.blocks.length,2);
 assert.equal(JSON.stringify(h.open.readingPlan).includes('correctOptionId'),false);
});
test('clicking read immediately cannot unlock acknowledgement or award science',async()=>{
 const h=await setup();await assert.rejects(h.exec('READ',{runId:h.runId,index:0}),denied('TRAINING_READING_REQUIRED'));
 await assert.rejects(h.exec('ACK',{runId:h.runId,accepted:true}));
 assert.equal(await h.store.get('htmlTrainingScores','reader'),null);
});
test('server rejects invented elapsed time and credits each exact batch only once',async()=>{
 const h=await setup();await h.exec('READING_START',{runId:h.runId,sessionId:'device-one'});
 const payload={runId:h.runId,sessionId:'device-one',sequence:1,increments:[[0,9000]]};
 await assert.rejects(h.exec('READING_PROGRESS',payload),denied('TRAINING_READING_TIME_INVALID'));
 h.advance(9000);const first=await h.exec('READING_PROGRESS',payload),repeat=await h.exec('READING_PROGRESS',payload);
 assert.deepEqual(repeat.state,first.state);assert.deepEqual(first.state.run.reading.credits,[9000,0]);
 await assert.rejects(h.exec('READING_PROGRESS',{...payload,increments:[[1,9000]]}),denied('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(h.exec('READ',{runId:h.runId,index:0}),denied('TRAINING_READING_INCOMPLETE'));
});
test('many tiny batches cannot accumulate credits while the server clock has not advanced',async()=>{
 const h=await setup();await h.exec('READING_START',{runId:h.runId,sessionId:'device-one'});
 await assert.rejects(h.exec('READING_PROGRESS',{runId:h.runId,sessionId:'device-one',sequence:1,increments:[[0,1]]}),denied('TRAINING_READING_TIME_INVALID'));
 h.advance(100);await h.exec('READING_PROGRESS',{runId:h.runId,sessionId:'device-one',sequence:1,increments:[[0,100]]});
 await assert.rejects(h.exec('READING_PROGRESS',{runId:h.runId,sessionId:'device-one',sequence:2,increments:[[0,1]]}),denied('TRAINING_READING_TIME_INVALID'));
});
test('all blocks and server time are required before scoring, with the existing single science point',async()=>{
 const h=await setup();await h.exec('READING_START',{runId:h.runId,sessionId:'device-one'});
 h.advance(18000);await h.exec('READING_PROGRESS',{runId:h.runId,sessionId:'device-one',sequence:1,increments:[[0,9000],[1,9000]]});
 await h.exec('READ',{runId:h.runId,index:0});await h.exec('ACK',{runId:h.runId,accepted:true});
 await h.exec('QUIZ',{runId:h.runId,answers:{q0:'a',q1:'a',q2:'a',q3:'a',q4:'a'}});
 const result=await h.exec('SUBMIT',{runId:h.runId,requestId:'final',suggestion:''});
 assert.equal(result.score.total,6);assert.equal(result.state.ackPoints,1);assert.equal(result.state.attempts.length,1);
 assert.equal((await h.exec('SUBMIT',{runId:h.runId,requestId:'final',suggestion:''})).score.total,6);
});
test('another device preserves confirmed blocks and fences the old reading session',async()=>{
 const h=await setup();await h.exec('READING_START',{runId:h.runId,sessionId:'device-one'});h.advance(9000);
 await h.exec('READING_PROGRESS',{runId:h.runId,sessionId:'device-one',sequence:1,increments:[[0,9000]]});
 const resumed=await h.exec('READING_START',{runId:h.runId,sessionId:'device-two'});assert.deepEqual(resumed.state.run.reading.credits,[9000,0]);
 h.advance(9000);await assert.rejects(h.exec('READING_PROGRESS',{runId:h.runId,sessionId:'device-one',sequence:2,increments:[[1,9000]]}),denied('TRAINING_READING_SESSION_CHANGED'));
 await h.exec('READING_PROGRESS',{runId:h.runId,sessionId:'device-two',sequence:1,increments:[[1,9000]]});
 assert.equal((await h.exec('READ',{runId:h.runId,index:0})).state.run.stage,'ACK');
});
test('new publication invalidates progress and revocation blocks a progress batch',async()=>{
 const h=await setup();await h.exec('READING_START',{runId:h.runId,sessionId:'device-one'});h.advance(18000);
 await h.exec('PUBLISH',{...h.pub,expectedVersion:1},'admin');
 await assert.rejects(h.exec('READING_PROGRESS',{runId:h.runId,sessionId:'device-one',sequence:1,increments:[[0,9000],[1,9000]]}),denied('VERSION_CHANGED'));
 assert.equal((await h.store.get('htmlTrainingStates','document-one_reader')).attempts.length,0);
 h.store.seed('users','reader',{uid:'reader',active:false,access:true});await assert.rejects(h.exec('READING_START',{runId:h.runId,sessionId:'device-two'}),denied('FORBIDDEN'));
});
test('legacy incomplete attempts must repeat reading without deleting old scores or spending a try',async()=>{
 const h=await setup();const saved=await h.store.get('htmlTrainingStates','document-one_reader');saved.run.stage='QUIZ';saved.run.readCount=1;saved.bestScore=4;saved.ackPoints=1;
 h.store.seed('htmlTrainingStates','document-one_reader',saved);h.store.seed('htmlTrainingScores','reader',{uid:'reader',total:5,items:{'document-one':{acknowledgement:1,test:4,suggestion:0}}});
 await assert.rejects(h.exec('QUIZ',{runId:h.runId,answers:{q0:'a',q1:'a',q2:'a',q3:'a',q4:'a'}}),denied('TRAINING_READING_REQUIRED'));
 const start=await h.exec('READING_START',{runId:h.runId,sessionId:'device-one'});
 assert.equal(start.state.run.stage,'READING');assert.equal(start.state.run.readCount,0);assert.equal(start.state.bestScore,4);assert.equal(start.state.ackPoints,1);assert.equal(start.state.attempts.length,0);
 assert.equal((await h.store.get('htmlTrainingScores','reader')).total,5);
});
test('existing published versions use their private prepared plan without changing material versions',async()=>{
 const h=await setup(),v=await h.store.get('htmlTrainingVersions','document-one_v1'),plan=v.readingPlan;delete v.readingPlan;
 h.store.seed('htmlTrainingVersions','document-one_v1',v);h.store.seed('htmlTrainingReadingPlans','document-one_v1',plan);
 assert.equal((await h.exec('OPEN')).readingPlan.hash,plan.hash);assert.equal((await h.exec('OPEN')).training.version,1);
});
test('decorative logos do not add time; entities and long unbroken text retain reachable ranges',()=>{
 const plan=buildReadingPlan([{html:'<img width="76" height="76" src="data:image/png;base64,AA==" alt="Logo"><p>A &amp; B</p><p>'+'x'.repeat(500)+'</p>'}]);
 assert.equal(plan.nodes.length,2);assert.equal(plan.blocks.length,4);assert.equal(plan.nodes.some(n=>n.kind==='image'),false);
 assert.deepEqual(plan.blocks.slice(1).map(b=>[b.from,b.to]),[[0,240],[240,480],[480,500]]);
 assert.ok(plan.totalRequiredMs>=15000);
});
test('simultaneous replay cannot multiply time and a second attempt starts with no reading credits',async()=>{
 const h=await setup();await h.exec('READING_START',{runId:h.runId,sessionId:'device-one'});h.advance(18000);
 const payload={runId:h.runId,sessionId:'device-one',sequence:1,increments:[[0,9000],[1,9000]]};
 await Promise.all([h.exec('READING_PROGRESS',payload),h.exec('READING_PROGRESS',payload)]);
 await h.exec('READ',{runId:h.runId,index:0});await h.exec('ACK',{runId:h.runId,accepted:true});await h.exec('QUIZ',{runId:h.runId,answers:{q0:'a',q1:'a',q2:'a',q3:'a',q4:'a'}});await h.exec('SUBMIT',{runId:h.runId,requestId:'final',suggestion:''});
 const begun=await h.exec('BEGIN',{requestId:'second'});await assert.rejects(h.exec('READ',{runId:begun.state.run.id,index:0}),denied('TRAINING_READING_REQUIRED'));
 const started=await h.exec('READING_START',{runId:begun.state.run.id,sessionId:'second-session'});assert.deepEqual(started.state.run.reading.credits,[0,0]);assert.equal(started.state.ackPoints,1);
});
