import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../apps-script-fg/Activation.gs',import.meta.url),'utf8');
const valid={phase:'TARGET_READY',sourceProducersRetired:true,sourceRulesFrozen:true,finalDeltaVerified:true,targetProjectId:'sahmt-checklist-fg',finalDeltaSha256:'a'.repeat(64)};
function fixture(proof,{failPull=false,alreadyActive=false}={}){
  const props=new Map(),triggers=[],removed=[],transactions=[],commits=[];
  const context=vm.createContext({console:{log(){}},Date,Map,SAHMT_V2_CONFIG:{projectId:'sahmt-checklist-fg'},FG_NATIVE_RELEASE:'fg-checklist-independent-v1',OSC:{sheetId:'synthetic-private-sheet',enabled:'enabled',handlers:['own-edit']},fgNativeOwner_(){},getFirestoreDocument_:()=>proof,
    verificarProntidaoChecklistFG(){},sahmtV2Properties_:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)}),
    checklistSourceTransaction_:fn=>{const result=fn('synthetic');transactions.push(result.writes);return result.result;},evaluationGet_:(collection)=>alreadyActive?{release:'fg-checklist-independent-v1',finalDeltaSha256:valid.finalDeltaSha256,activatedAt:new Date('2026-11-07T18:00:00Z')}:null,
    evaluationWrite_:(collection,id,data,previous,times)=>({collection,id,data,previous,times}),ativarControleOperacionalV1:()=>({code:'SHEET_ACTIVE'}),ScriptApp:{getProjectTriggers:()=>triggers.map(name=>({getHandlerFunction:()=>name})),deleteTrigger:trigger=>removed.push(trigger.getHandlerFunction()),newTrigger:name=>({timeBased(){return this;},everyMinutes(n){assert.equal(n,5);return this;},create(){triggers.push(name);}})},
    oscRun_:()=>{if(failPull)throw Error('SYNTHETIC_PULL_FAILURE');return {received:0};},validarCienciaChecklistFG:()=>({code:'FG_CHECKLIST_PROCESSADO'}),firestoreDocumentsUrl_:path=>'https://firestore.googleapis.com/v1/projects/sahmt-checklist-fg/databases/(default)/documents'+path,firestoreDocumentName_:(collection,id)=>'projects/sahmt-checklist-fg/databases/(default)/documents/'+collection+'/'+id,firestoreFieldsFromJs_:value=>value,firestoreRequest_:(url,options)=>commits.push({url,body:JSON.parse(options.payload)})});
  vm.runInContext(source,context);context.reconciliarBaseFinalChecklistFG_=hash=>assert.equal(hash,valid.finalDeltaSha256);
  return {context,props,triggers,removed,transactions,commits};
}
test('FG native activation requires source producer retirement, frozen writes and the exact final destination proof',()=>{
  for(const proof of [{},{...valid,sourceRulesFrozen:false},{...valid,sourceProducersRetired:false},{...valid,finalDeltaVerified:false},{...valid,targetProjectId:'sahmt-17a16'}]){
    const f=fixture(proof);assert.throws(()=>f.context.ativarChecklistFG(),/FG_MIGRATION_NOT_VERIFIED/);assert.equal(f.props.size,0);assert.equal(f.transactions.length,0);assert.equal(f.triggers.length,0);
  }
});
test('FG activation initializes its own science and scoring runtime, installs only owned tasks and writes one destination receipt',()=>{
  const f=fixture(valid),result=f.context.ativarChecklistFG();assert.equal(result.code,'FG_CHECKLIST_INDEPENDENTE_ATIVO');
  assert.equal(f.props.get('FG_CUTOVER_ENABLED'),'YES');assert.deepEqual(f.triggers,['receberChecklistFG','validarCienciaChecklistFG']);
  assert.deepEqual(Array.from(f.transactions[0],w=>w.collection),['checklistScienceRuntime','fgPerformanceRuntime']);
  assert.equal(f.commits.length,1);assert.equal(f.commits[0].body.writes[0].update.name,'projects/sahmt-checklist-fg/databases/(default)/documents/migrationControl/apps-script-activation');
});
test('a failed native activation disables owned automation and cannot leave a success receipt',()=>{
  const f=fixture(valid,{failPull:true});assert.throws(()=>f.context.ativarChecklistFG(),/SYNTHETIC_PULL_FAILURE/);assert.equal(f.props.get('FG_CUTOVER_ENABLED'),'NO');assert.equal(f.props.get('enabled'),'NO');assert.equal(f.commits.length,0);assert.deepEqual(f.removed,['receberChecklistFG','validarCienciaChecklistFG']);
});
test('an activation retry preserves the original science and performance activation epochs',()=>{
  const f=fixture(valid,{alreadyActive:true});f.context.ativarChecklistFG();assert.ok(f.transactions[0].every(w=>!w.times.includes('activatedAt')));
});
