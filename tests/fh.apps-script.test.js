import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const read=name=>readFile(new URL('../apps-script-fh/'+name,import.meta.url),'utf8');
test('FH native sheet control accepts only its own labels and owner and begins inactive',async()=>{
 const c=vm.createContext({console,Session:{getEffectiveUser:()=>({getEmail:()=> 'wrong@example.test'})},PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})}});vm.runInContext((await Promise.all(['Config.gs','OperationalSheetControl.gs'].map(read))).join('\n'),c);
 assert.equal(vm.runInContext('SAHMT_V2_CONFIG.projectId',c),'sahmt-etiquetas-fh');assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(OSC.tables.map(t=>t.collection))',c)),['labels']);
 assert.throws(()=>c.oscOwner_(),/CONTROLE_EXECUTOR_INVALIDO/);assert.throws(()=>c.ativarControleOperacionalV1(),/FH_AGUARDANDO_MIGRACAO/);
 for(const project of ['sahmt-17a16','sahmt-operacional-fi'])assert.throws(()=>c.oscDocKey_({name:'projects/'+project+'/databases/(default)/documents/labels/l1'}),/CONTROLE_DOCUMENTO_INVALIDO/);
 assert.throws(()=>c.oscDocKey_({name:'projects/sahmt-etiquetas-fh/databases/(default)/documents/checklists/c1'}),/CONTROLE_RECURSO_INVALIDO/);
});
test('FH native activation demands a final own-project proof before enabling triggers or writing a receipt',async()=>{
 const source=(await Promise.all(['Config.gs','Activation.gs'].map(read))).join('\n');
 const valid={phase:'TARGET_READY',finalDeltaVerified:true,sourceProducersRetired:true,targetProjectId:'sahmt-etiquetas-fh',finalDeltaSha256:'a'.repeat(64)};
 for(const proof of [{},{...valid,sourceProducersRetired:false},{...valid,targetProjectId:'sahmt-17a16'},valid]){
  const props=new Map(),calls=[],triggers=[],c=vm.createContext({console,Date,OSC:{sheetId:'synthetic-private-sheet'},oscOwner_(){},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},ScriptApp:{getProjectTriggers:()=>[],newTrigger:name=>({timeBased(){return this;},everyMinutes:n=>{assert.equal(n,5);return {create:()=>triggers.push(name)};}})},ativarControleOperacionalV1:()=>({code:'ACTIVE'}),oscRun_:()=>({received:0})});
  vm.runInContext(source,c);c.sahmtV2RequirePrivateSpreadsheet_=()=>{};c.firestoreFieldsToJs_=x=>x;c.firestoreRequest_=(url,options)=>{calls.push({url,options});return {fields:proof};};
  if(proof===valid){c.ativarEtiquetasFH();assert.equal(props.get('FH_CUTOVER_ENABLED'),'YES');assert.deepEqual(triggers,['receberEtiquetasFH']);assert.ok(calls.every(x=>x.url.includes('/sahmt-etiquetas-fh/')));}else{assert.throws(()=>c.ativarEtiquetasFH(),/FH_MIGRACAO_NAO_CONFERIDA/);assert.equal(props.size,0);assert.equal(triggers.length,0);assert.equal(calls.length,1);}
 }
});
