import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {encodeFields} from '../worker-training/firestore.js';

const source=readFileSync(new URL('../apps-script-v2/Config.gs',import.meta.url),'utf8');
const root=project=>'https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents';
const cases=[
 ['sahmt-escala-fj','/scheduleDays/day',{},'operacao/escala/ferias'],
 ['indicadores---sahmt','/qmentumUnits/unit/months:runQuery',{structuredQuery:{from:[{collectionId:'months'}]}},'registros/qmentum'],
 ['sahmt-gestao-5ae66',':runAggregationQuery',{structuredAggregationQuery:{structuredQuery:{from:[{collectionId:'documents'}]}}},'gestao/area-gestao-da-qualidade'],
 ['sahmt-17a16',':batchGet',{documents:['projects/sahmt-17a16/databases/(default)/documents/labels/one']},'operacao/etiquetas']
];
for(const [project,suffix,payload,disabled] of cases)test('legacy transport blocks content before fetch '+suffix,()=>{
 const calls=[];
 const context=vm.createContext({
  ScriptApp:{getOAuthToken:()=> 'synthetic'},
  UrlFetchApp:{fetch(url){
   calls.push(url);
   assert.equal(url,root(project)+'/runtimePolicy/folders');
   return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({fields:encodeFields({schemaVersion:1,revision:1,disabled:[disabled]})})};
  }}
 });
 vm.runInContext(source,context);
 assert.throws(()=>context.firestoreRequest_(root(project)+suffix,{payload:JSON.stringify(payload)}),/CONTROLE_PASTA_DESATIVADA/);
 assert.equal(calls.length,1);
});
