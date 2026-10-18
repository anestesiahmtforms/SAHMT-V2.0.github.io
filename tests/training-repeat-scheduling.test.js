import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps-script-v2/TrainingRepetition.gs',import.meta.url),'utf8');
function fixture(){let triggers=[],created=0,deleted=0;const props=new Map();
 const context=vm.createContext({JSON,Math,Date,Array,Object,Number,Error,String,Set,
  evaluationAssertOperator_:()=>{},Logger:{log(){}},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||null,setProperty:(key,value)=>props.set(key,value)})},
  ScriptApp:{getProjectTriggers:()=>[...triggers],deleteTrigger:trigger=>{triggers=triggers.filter(row=>row!==trigger);deleted++;},newTrigger:handler=>({timeBased:()=>({everyMinutes:minutes=>{assert.equal(minutes,1);return {create:()=>{created++;const trigger={getHandlerFunction:()=>handler};triggers.push(trigger);return trigger;}};}})})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})}
 });vm.runInContext(source,context);return {context,props,get triggers(){return triggers;},get created(){return created;},get deleted(){return deleted;}};}
test('temporary recurring continuation survives a busy invocation and is unique',()=>{const h=fixture(),job={ids:['f1','f2'],next:0};
 h.context.trainingRepeatSchedule_(job,true);h.context.trainingRepeatSchedule_(job,true);assert.equal(h.created,1);
 h.context.LockService.getScriptLock=()=>({tryLock:()=>false});assert.equal(h.context.continuarRepeticaoTreinamentosV1().code,'TRAINING_REPEAT_BUSY');assert.equal(h.triggers.length,1);
});
test('completion removes temporary continuation; validation failure preserves cursor and pauses',()=>{const h=fixture(),job={ids:['f1','f2'],next:0};
 h.context.trainingRepeatSchedule_(job,true);h.props.set('SAHMT_TRAINING_REPEAT_JOB',JSON.stringify(job));
 h.context.trainingRepeatActivateOne_=()=>{throw Error('TRAINING_REPEAT_CONTENT_CHANGED');};assert.throws(()=>h.context.continuarRepeticaoTreinamentosV1());assert.equal(h.triggers.length,0);assert.equal(JSON.parse(h.props.get('SAHMT_TRAINING_REPEAT_JOB')).next,0);
 h.context.trainingRepeatSchedule_(job,true);h.context.trainingRepeatActivateOne_=()=>({unchanged:true});assert.equal(h.context.continuarRepeticaoTreinamentosV1().code,'TRAINING_REPEAT_READY');assert.equal(h.triggers.length,0);assert.equal(h.props.get('SAHMT_TRAINING_REPEAT_ENABLED'),'YES');
});
test('disabled processing removes recurring continuation without changing cursor',()=>{const h=fixture(),job={ids:['f1','f2'],next:1};
 h.context.trainingRepeatSchedule_(job,true);h.props.set('SAHMT_TRAINING_REPEAT_JOB',JSON.stringify(job));
 h.context.evaluationAssertOperator_=()=>{throw Error('activation disabled');};
 assert.throws(()=>h.context.continuarRepeticaoTreinamentosV1(),/activation disabled/);assert.equal(h.triggers.length,0);assert.equal(JSON.parse(h.props.get('SAHMT_TRAINING_REPEAT_JOB')).next,1);
});
test('inactive configuration is blocked individually while another valid form completes',()=>{const h=fixture(),job={ids:['f1','f2'],next:0};
 h.props.set('SAHMT_TRAINING_REPEAT_JOB',JSON.stringify(job));h.context.trainingRepeatActivateOne_=id=>{if(id==='f1')throw Error('TRAINING_REPEAT_CONFIGURATION_REQUIRED');return {unchanged:false};};
 const result=h.context.continuarRepeticaoTreinamentosV1();assert.equal(result.code,'TRAINING_REPEAT_PARTIAL_READY');assert.equal(result.completed,1);assert.equal(result.blockedConfigurations,1);
 const saved=JSON.parse(h.props.get('SAHMT_TRAINING_REPEAT_JOB'));assert.equal(saved.next,2);assert.equal(saved.blocked[0].formId,'f1');assert.equal(h.triggers.length,0);assert.equal(JSON.stringify(result).includes('f1'),false);
});
test('a completed partial job retries corrected blocked forms without replaying completed ones',()=>{const h=fixture(),previous={ids:['f1','f2'],next:2,blocked:[{formId:'f1',code:'TRAINING_REPEAT_CONFIGURATION_REQUIRED'}]};
 const plan=h.context.trainingRepeatJobPlan_(previous,{ids:['f1','f2'],missing:[],configs:[{formId:'f1',status:'READY'},{formId:'f2',status:'READY'}]});
 assert.deepEqual([...plan.job.ids],['f2','f1']);assert.equal(plan.job.next,1);assert.equal(plan.job.blocked.length,0);assert.equal(plan.backup.length,1);
});
