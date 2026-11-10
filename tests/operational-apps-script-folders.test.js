import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {encodeFields} from '../worker-training/firestore.js';
const source=(station,file)=>readFileSync(new URL(`../apps-script-${station.toLowerCase()}/${file}`,import.meta.url),'utf8');
function runtime(station,policy){
 const calls=[],props=new Map();
 const c=vm.createContext({console:{log(){}},ScriptApp:{getOAuthToken:()=> 'synthetic'},PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)})},UrlFetchApp:{fetch(url){calls.push(url);const metadata=url.endsWith('/runtimePolicy/folders');return {getResponseCode:()=>metadata&&policy===null?404:200,getContentText:()=>JSON.stringify(metadata?{fields:encodeFields(policy)}:{documents:[]})};}},DriveApp:{getFileById:()=>assert.fail('blocked Drive read'),getFolderById:()=>assert.fail('blocked Drive read')},SpreadsheetApp:{openById:()=>assert.fail('blocked Sheets read')}});
 vm.runInContext(source(station,'Config.gs'),c);return {c,calls,props};
}
const policy=disabled=>({schemaVersion:1,revision:1,disabled});
test('each operational REST wrapper reads policy first and rejects disabled ancestors before document/query/batch/write calls',()=>{
 for(const [station,collection,folder] of [['FG','checklists','operacao/checklist'],['FH','labels','operacao/etiquetas'],['FI','events','operacao/eventos'],['FJ','scheduleDays','operacao/escala']]){
  for(const path of [folder,'operacao'])for(const kind of ['get','query','batch','commit']){
   const {c,calls}=runtime(station,policy([path]));const root=c.firestoreDocumentsUrl_('');
   const options=kind==='get'?{method:'get'}:{method:'post',payload:JSON.stringify(kind==='query'?{structuredQuery:{from:[{collectionId:collection}]}}:kind==='batch'?{documents:[root.slice('https://firestore.googleapis.com/v1/'.length)+'/'+collection+'/one']}:{writes:[{update:{name:root.slice('https://firestore.googleapis.com/v1/'.length)+'/'+collection+'/one',fields:{}}}]})};
   const suffix=kind==='get'?'/'+collection+'/one':kind==='query'?':runQuery':kind==='batch'?':batchGet':':commit';
   assert.throws(()=>c.firestoreRequest_(root+suffix,options),/CONTROLE_PASTA_DESATIVADA/);assert.deepEqual(calls,[root+'/runtimePolicy/folders']);
  }
 }
});
test('malformed existing policy fails closed while missing policy allows rollout and sibling folders stay independent',()=>{
 for(const value of [{},policy(['operacao//bad']),{schemaVersion:1,revision:0,disabled:[]}]){
  const {c,calls}=runtime('FI',value);assert.throws(()=>c.firestoreRequest_(c.firestoreDocumentsUrl_('/events/one'),{}),/CONTROLE_POLITICA_INVALIDA/);assert.equal(calls.length,1);
 }
 for(const value of [null,policy(['operacao/pessoas']),policy(['operacao/eventos-restritos'])]){
  const {c,calls}=runtime('FI',value);c.firestoreRequest_(c.firestoreDocumentsUrl_('/events/one'),{});assert.equal(calls.length,2);
 }
 const {c}=runtime('FJ',policy(['operacao/pessoas']));assert.throws(()=>c.firestoreRequest_(c.firestoreDocumentsUrl_('/contacts/one'),{}),/CONTROLE_PASTA_DESATIVADA/);
});
test('blocked operational jobs stop before opening Sheets and leave cursors unchanged',()=>{
 for(const [station,folder] of [['FG','operacao/checklist'],['FH','operacao/etiquetas'],['FI','operacao/eventos'],['FJ','operacao/eventos']]){
  const {c,calls,props}=runtime(station,policy([folder]));vm.runInContext(source(station,'OperationalSheetControl.gs'),c);
  props.set('SAHMT_OPERATIONAL_SHEETS_ENABLED','YES');props.set('SAHMT_OPERATIONAL_CURSOR_events','keep');c.oscLocked_=fn=>fn();
  assert.throws(()=>c.oscRun_('PULL',null),/CONTROLE_PASTA_DESATIVADA/);assert.equal(props.get('SAHMT_OPERATIONAL_CURSOR_events'),'keep');assert.equal(calls.length,1);
 }
});
test('FJ combined schedule/vacation source and FG scoring are gated before source or scoring clock reads',()=>{
 for(const folder of ['operacao/escala','operacao/escala/ferias']){
  const {c}=runtime('FJ',policy([folder]));vm.runInContext(source('FJ','ScheduleSourceSync.gs'),c);assert.throws(()=>c.readScheduleSource_(),/CONTROLE_PASTA_DESATIVADA/);
 }
 const {c}=runtime('FG',policy(['operacao/checklist/desempenho']));vm.runInContext(source('FG','Runtime.gs'),c);
 c.LockService={getUserLock:()=>({waitLock(){},releaseLock(){}})};c.checklistScienceAssertOperator_=()=>assert.fail('blocked science runtime read');c.fgClaimScoringClock_=()=>assert.fail('blocked scoring clock mutation');
 assert.throws(()=>c.validarCienciaChecklistFG({}),/CONTROLE_PASTA_DESATIVADA/);
});
