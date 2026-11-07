import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const read=name=>readFile(new URL('../apps-script-fg/'+name,import.meta.url),'utf8');
test('FG sheet control is limited to Checklist, verifies the owner and starts inactive',async()=>{
  const context=vm.createContext({Session:{getEffectiveUser:()=>({getEmail:()=> 'wrong@example.test'})},PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})}});
  vm.runInContext((await Promise.all(['Config.gs','OperationalSheetControl.gs'].map(read))).join('\n'),context);
  assert.equal(vm.runInContext('SAHMT_V2_CONFIG.projectId',context),'sahmt-checklist-fg');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(OSC.tables.map(t=>t.collection))',context)),['checklists']);
  assert.throws(()=>context.oscOwner_(),/CONTROLE_EXECUTOR_INVALIDO/);
  assert.throws(()=>context.ativarControleOperacionalV1(),/FG_AGUARDANDO_MIGRACAO/);
  assert.equal(context.oscDocKey_({name:'projects/sahmt-checklist-fg/databases/(default)/documents/checklists/synthetic'}),'checklists/synthetic');
  for(const path of ['labels/l','events/e','scheduleDays/2026-11-07'])assert.throws(()=>context.oscDocKey_({name:'projects/sahmt-checklist-fg/databases/(default)/documents/'+path}),/CONTROLE_RECURSO_INVALIDO/);
  assert.throws(()=>context.oscDocKey_({name:'projects/sahmt-17a16/databases/(default)/documents/checklists/synthetic'}),/CONTROLE_DOCUMENTO_INVALIDO/);
});
test('FG preparation creates its private report once and cannot activate triggers or write Firestore',async()=>{
  const properties=new Map(),calls=[];
  const context=vm.createContext({console:{log(){}},oscOwner_(){},sahmtPreparePrivateFolder_(){},sahmtPlaceScriptInFolder_(){},sahmtV2Properties_:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)}),SpreadsheetApp:{create:()=>{calls.push('create');return {getId:()=> 'synthetic-private-sheet'};}},DriveApp:{getFileById:()=>({moveTo:()=>calls.push('move-private')})},sahmtV2RequirePrivateFolder_:()=>({}),prepararControleOperacionalV1:()=>({code:'PREPARED',firestoreWrites:0}),OSC:{get sheetId(){return properties.get('FG_CHECKLIST_SPREADSHEET_ID');}},ScriptApp:{newTrigger:()=>assert.fail('Preparation cannot enable triggers')},firestoreRequest_:()=>assert.fail('Preparation cannot write Firestore')});
  vm.runInContext(await read('Setup.gs'),context);
  const result=context.prepararChecklistFG();assert.equal(result.cutoverEnabled,false);assert.equal(result.spreadsheetId,'synthetic-private-sheet');
  context.prepararChecklistFG();assert.deepEqual(calls,['create','move-private']);assert.equal(properties.get('FG_CUTOVER_ENABLED'),'NO');
});
