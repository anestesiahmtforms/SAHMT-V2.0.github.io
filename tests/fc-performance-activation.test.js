import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {guardCentralFcDeclaration,FC_CENTRAL_GUARDED_FUNCTIONS} from '../scripts/lib/fc-central-cutover.js';
const source=await readFile(new URL('../apps-script-fc/PerformanceActivation.gs',import.meta.url),'utf8');
function fixture({active='anestesiahmtforms3@gmail.com',early=false,triggerFailure=false}={}){
 const props=new Map([['FC_EXPECTED_SCRIPT_ID','fc-script'],['FC_INTEGRATION_ENABLED','false'],['FC_PERFORMANCE_ENABLED','false']]),triggers=[];
 const runtime={centralStoppedAt:new Date(Date.now()-480000),effectiveFrom:new Date(Date.now()-(early?120000:60000)),centralStopProofSha256:'a'.repeat(64)};
 const store={getProperty:k=>props.get(k)||null,setProperties:values=>{for(const [k,v]of Object.entries(values))props.set(k,v);}};
 const c=vm.createContext({Date,console:{log(){}},SAHMT_FC_EXECUTOR_EMAIL:'anestesiahmtforms3@gmail.com',FC_PERFORMANCE_PROJECT_:'indicadores---sahmt',
  sahmtV2Properties_:()=>store,Session:{getEffectiveUser:()=>({getEmail:()=> 'anestesiahmtforms3@gmail.com'}),getActiveUser:()=>({getEmail:()=>active})},
  DriveApp:{getFileById:()=>({getOwner:()=>({getEmail:()=> 'anestesiahmtforms3@gmail.com'})})},
  ScriptApp:{getScriptId:()=> 'fc-script',getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{if(triggerFailure)throw Error('SYNTHETIC_TRIGGER_QUOTA');assert.equal(minutes,15);const t={getHandlerFunction:()=>handler};triggers.push(t);return t;}})})}),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1)},
  evaluationGet_:()=>runtime,fcPerformanceValidateRuntime_:value=>value});vm.runInContext(source,c);return{c,props,triggers,runtime};
}
test('activation requires interactive FC owner, central drain and no unrelated triggers',()=>{
 assert.throws(()=>fixture({active:''}).c.ativarDesempenhoFcV1(),/INTERACTIVE_OWNER_REQUIRED/);
 assert.throws(()=>fixture({early:true}).c.ativarDesempenhoFcV1(),/CUTOVER_NOT_APPROVED/);
 const f=fixture();f.triggers.push({getHandlerFunction:()=> 'other-station'});assert.throws(()=>f.c.ativarDesempenhoFcV1(),/UNEXPECTED_TRIGGERS/);assert.equal(f.props.get('FC_PERFORMANCE_ENABLED'),'false');
});
test('activation is idempotent and cannot enable automatic FB synchronization or AI',()=>{
 const f=fixture();for(let i=0;i<2;i++){const result=f.c.ativarDesempenhoFcV1();assert.equal(result.automaticFbSync,false);assert.equal(result.historyImported,0);assert.equal(result.quarterlyAiEnabled,false);}assert.equal(f.triggers.length,1);assert.equal(f.props.get('QMENTUM_QUARTERLY_ENABLED'),'false');
});
test('failed scheduler creation restores disabled service properties',()=>{
 const f=fixture({triggerFailure:true});assert.throws(()=>f.c.ativarDesempenhoFcV1(),/SYNTHETIC_TRIGGER_QUOTA/);for(const key of ['FC_PERFORMANCE_ENABLED','FC_INTEGRATION_ENABLED','QMENTUM_WRITE_ENABLED','SAHMT_V2_OCCURRENCE_SCORING_ENABLED'])assert.equal(f.props.get(key),'false');assert.equal(f.triggers.length,0);
});
test('central FC guards preserve other processing and stop every known FC point/background entry',()=>{
 for(const name of FC_CENTRAL_GUARDED_FUNCTIONS){const c=vm.createContext({fcCentralPerformanceStopped_:()=>false});vm.runInContext(guardCentralFcDeclaration(name,`function ${name}(){return 'existing';}`),c);assert.equal(c[name](),'existing');c.fcCentralPerformanceStopped_=()=>true;
  if(['qmProcessParticipation_','qmDeliverFbParticipation_','evaluationDeliverOccurrence_'].includes(name))assert.throws(()=>c[name](),/FC_PERFORMANCE_MOVED/);else assert.equal(c[name]().code,'FC_PERFORMANCE_MOVED');}
 const other="function executarOutraEstacao(){return 'unchanged';}";assert.equal(guardCentralFcDeclaration('executarOutraEstacao',other),other);
});
