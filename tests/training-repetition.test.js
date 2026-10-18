import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const path=new URL('../apps-script-v2/TrainingRepetition.gs',import.meta.url);
function fixture(){
 const records=new Map([['evaluationFormConfigs/form',{id:'form',formId:'form',version:1,configVersion:2,status:'READY'}],['evaluationActivities/form',{id:'form',active:true,version:1,configVersion:2}]]);
 let limited=true,accepting=true;const mutations=[];
 const form={hasLimitOneResponsePerUser:()=>limited,canEditResponse:()=>false,isAcceptingResponses:()=>accepting,isPublished:()=>true,
  setAcceptingResponses:value=>{accepting=value;mutations.push(['accept',value]);},setLimitOneResponsePerUser:value=>{limited=value;mutations.push(['limit',value]);}};
 const context=vm.createContext({Date,JSON,Map,Set,Object,Array,String,Number,Error,
  evaluationGet_:(c,id)=>records.get(c+'/'+id)||null,evaluationClean_:v=>({...v}),
  evaluationWrite_:(c,id,changes,previous)=>({c,id,changes,previous}),
  evaluationRunTransaction_:cb=>{const plan=cb('tx');for(const w of plan.writes||[])records.set(w.c+'/'+w.id,{...records.get(w.c+'/'+w.id),...w.changes});return plan.result;},
  FormApp:{openById:()=>form},formsEvaluationMetadata_:()=>({formId:'form'}),formsEvaluationCheckedMapping_:()=>{},
  formsEvaluationSavedQuestionFingerprint_:()=> 'same',formsEvaluationQuestionFingerprint_:()=> 'same',formsEvaluationQuestionSnapshot_:()=>[],
  formsEvaluationHash_:value=>JSON.stringify(value),evaluationAssertOperator_:()=>{},
 });vm.runInContext(readFileSync(path,'utf8'),context);return {context,records,form,mutations};
}
test('repeat setting preserves version, audience and existing credit history; replay is a no-op',()=>{
 const h=fixture();h.context.trainingRepeatActivateOne_('form');const cfg=h.records.get('evaluationFormConfigs/form');
 assert.equal(cfg.repeatPolicy,'FIRST_RESPONSE_PER_VERSION');assert.equal(cfg.version,1);assert.equal(h.form.hasLimitOneResponsePerUser(),false);assert.equal(h.form.isAcceptingResponses(),true);
 const count=h.mutations.length;h.context.trainingRepeatActivateOne_('form');assert.equal(h.mutations.length,count);
});
test('revision invalidation is idempotent, resets visibility for every user and never deletes historical awards',()=>{
 const h=fixture();h.records.get('evaluationFormConfigs/form').repeatPolicy='FIRST_RESPONSE_PER_VERSION';
 h.context.trainingRepeatInvalidate_('form','MATERIAL');assert.equal(h.records.get('evaluationActivities/form').trainingRevisionRequired,true);
 assert.equal(h.records.get('evaluationFormConfigs/form').status,'CONFIGURATION_PENDING');assert.equal(h.form.isAcceptingResponses(),false);
 assert.equal(h.context.trainingRepeatInvalidate_('form','QUESTIONS').unchanged,true);
});

test('preflight detects missing document configurations and preserves unrelated forms',()=>{
 const h=fixture();h.context.gqpTrustedConfig_=()=>({bindings:[{formId:'TrustedForm111'},{formId:'TrustedForm222'}]});
 h.context.formsEvaluationAll_=()=>[{formId:'TrustedForm111',status:'READY'},{formId:'UnrelatedForm333',status:'READY'}];
 const scope=h.context.trainingRepeatScope_();assert.equal(scope.missing.length,1);assert.equal(scope.configs.length,1);assert.equal(scope.other,1);assert.equal(h.mutations.length,0);
});

test('an interrupted reopening is retried instead of falsely completing a closed Form',()=>{
 const h=fixture(),native=h.form.setAcceptingResponses;let failOnce=true;
 h.form.setAcceptingResponses=value=>{if(value&&failOnce){failOnce=false;throw Error('transient');}return native(value);};
 assert.throws(()=>h.context.trainingRepeatActivateOne_('form'));assert.equal(h.form.isAcceptingResponses(),false);
 h.context.trainingRepeatActivateOne_('form');assert.equal(h.form.isAcceptingResponses(),true);
 assert.equal(h.records.get('evaluationFormConfigs/form').repeatActivation.status,'COMPLETE');
});

test('a finished partial job includes newly configured Forms without repeating completed IDs',()=>{
 const h=fixture(),previous={ids:['TrustedForm111'],next:1,backupId:'private-backup',missingConfigurations:1};
 const scope={ids:['TrustedForm111','TrustedForm222'],configs:[{formId:'TrustedForm111',status:'READY'},{formId:'TrustedForm222',status:'READY'}],missing:[],other:0};
 const plan=h.context.trainingRepeatJobPlan_(previous,scope);assert.deepEqual([...plan.job.ids],['TrustedForm111','TrustedForm222']);assert.equal(plan.job.next,1);assert.equal(plan.job.missingConfigurations,0);assert.equal(plan.backup.length,1);assert.equal(plan.backup[0].formId,'TrustedForm222');
});
test('a concurrently active installer plan cannot rewind its cursor or change its selected IDs',()=>{
 const h=fixture(),previous={ids:['TrustedForm111','TrustedForm222'],next:1};
 const plan=h.context.trainingRepeatJobPlan_(previous,{ids:[],configs:[],missing:[]});assert.equal(plan.job,previous);assert.equal(plan.backup.length,0);
});


test('a terminal commit acknowledged as timeout recovers original accepting intent',()=>{
 const h=fixture(),transaction=h.context.evaluationRunTransaction_;let ambiguous=true;
 h.context.evaluationRunTransaction_=cb=>transaction(tx=>{const plan=cb(tx);if(ambiguous&&plan.writes.some(w=>w.changes.repeatActivation?.status==='COMPLETE')){ambiguous=false;for(const w of plan.writes)h.records.set(w.c+'/'+w.id,{...h.records.get(w.c+'/'+w.id),...w.changes});throw Error('timeout');}return plan;});
 assert.throws(()=>h.context.trainingRepeatActivateOne_('form'));assert.equal(h.form.isAcceptingResponses(),false);
 assert.equal(h.records.get('evaluationFormConfigs/form').repeatActivation.status,'COMPLETE');
 h.context.trainingRepeatActivateOne_('form');assert.equal(h.form.isAcceptingResponses(),true);
});


test('native failure reports only the stage without logging private native details',()=>{
 const h=fixture(),logs=[];h.context.Logger={log:value=>logs.push(JSON.parse(value))};
 h.form.setLimitOneResponsePerUser=()=>{throw Error('private token and response details');};
 assert.throws(()=>h.context.trainingRepeatActivateOne_('form'),/TRAINING_REPEAT_ACTIVATION_RETRY_REQUIRED/);
 assert.equal(logs[0]?.code,'TRAINING_REPEAT_SAFE_FAILURE');assert.equal(logs[0]?.stage,'RESPONSE_LIMIT');
 assert.equal(JSON.stringify(logs).includes('private'),false);assert.equal(h.form.isAcceptingResponses(),false);
});
