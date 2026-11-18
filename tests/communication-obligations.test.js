import test from 'node:test';
import assert from 'node:assert/strict';
let api = {};
try { api = await import('../communication/obligations.js'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
const training = {id:'safe-airway',version:3,maxScore:10};
const activity = {kind:'TRAINING',id:training.id,version:3,minimumScore:8,maxScore:10,title:'Via aérea'};
const attempt = {trainingVersion:3,acknowledgedAt:100,completedAt:200,score:8,maxScore:10};
test('obligation growth reaches full container after five complete server days',()=>{
 assert.equal(typeof api.obligationStage,'function');
 const start=1_000_000,day=86_400_000;
 for (const [elapsed,stage] of [[-1,0],[0,0],[day-1,0],[day,1],[day*4,4],[day*5-1,4],[day*5,5],[day*8,5]]) assert.equal(api.obligationStage(start,start+elapsed),stage);
 assert.throws(()=>api.obligationStage(start,NaN));
});
test('training completion requires authenticated subject, completed exact version and sufficient score',()=>{
 assert.equal(typeof api.trainingCompletion,'function');
 const state={uid:'person-1',trainingId:training.id,attempts:[attempt]};
 assert.deepEqual(api.trainingCompletion(training,state,activity,'person-1'),{completed:true,completedAt:200,score:8});
 for(const altered of [{...attempt,score:7},{...attempt,trainingVersion:2},{...attempt,completedAt:null},{...attempt,acknowledgedAt:null},{...attempt,score:11},{...attempt,maxScore:20}]) assert.equal(api.trainingCompletion(training,{...state,attempts:[altered]},activity,'person-1').completed,false);
 assert.equal(api.trainingCompletion(training,{...state,uid:'other'},activity,'person-1').completed,false);
 assert.equal(api.trainingCompletion({...training,version:4},state,activity,'person-1').completed,false);
});
test('a custom deadline controls the final stage and extending it releases an overdue screen',()=>{
 const start=1_000_000,hour=3_600_000,end=start+10*hour;
 assert.equal(api.obligationStage(start,start+8*hour,end),4);
 assert.equal(api.obligationStage(start,end-1,end),4);
 assert.equal(api.obligationStage(start,end,end),5);
 assert.equal(api.obligationStage(start,end,end+10*hour),2);
});
test('prior valid completion counts and later insufficient attempts do not revoke it',()=>{
 assert.equal(typeof api.trainingCompletion,'function');
 const result=api.trainingCompletion(training,{uid:'person-1',trainingId:training.id,attempts:[attempt,{...attempt,score:6,completedAt:300}]},activity,'person-1');
 assert.equal(result.completedAt,200);
});
test('activity validation rejects impossible thresholds and arbitrary source identifiers',()=>{
 assert.equal(typeof api.validateObligation,'function');
 assert.deepEqual(api.validateObligation(activity),activity);
 for(const value of [{...activity,minimumScore:0},{...activity,minimumScore:11},{...activity,version:0},{...activity,id:'https://attacker.test'},{...activity,completed:true},{...activity,kind:'URL'}]) assert.throws(()=>api.validateObligation(value),{code:'COMM_INVALID_ACTIVITY'});
 const survey={kind:'SURVEY',id:'climate',cycle:'2026',title:'Clima'};
 assert.deepEqual(api.validateObligation(survey),survey);
 assert.throws(()=>api.validateObligation({...survey,minimumScore:1}),{code:'COMM_INVALID_ACTIVITY'});
});
