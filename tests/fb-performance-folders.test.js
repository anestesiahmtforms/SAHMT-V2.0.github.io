import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createFbPerformanceWorker} from '../worker-fb-performance/worker.js';
import {encodeFields} from '../worker-training/firestore.js';

test('FB administrator reads performance across disabled dependencies',async()=>{
 const worker=createFbPerformanceWorker({
  verifyIdentity:async()=>({uid:'admin',email:'admin@example.test'}),
  getStore:()=>({get:async collection=>{
   if(collection==='users')return {uid:'admin',email:'admin@example.test',active:true,access:true,role:'administrador_app'};
   if(collection==='fbPerformanceRuntime')return {enabled:true,projectId:'sahmt-gestao-5ae66',schemaVersion:1,mode:'FB_ONLY',effectiveFrom:'2026-01-01'};
   if(collection==='fbPerformanceReference')return {status:'CONFIRMED',revision:1,maxPerformance:3};
   if(collection==='fbPerformanceSummaries')return {revision:1,total:3};
   assert.fail('Unexpected policy or content read '+collection);
  },list:async()=>[]})
 });
 const request=new Request('https://test.invalid/v1/fb-performance',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'GET_PERFORMANCE',input:{subjectUid:'admin'}})});
 const response=await worker.fetch(request,{FB_PERFORMANCE_ENABLED:'true'});
 assert.equal(response.status,200);
 assert.equal((await response.json()).summary.performanceTotal,3);
});

const policies=[
 {global:{schemaVersion:1,revision:1,disabled:['desempenho/fb']},training:null},
 {global:{schemaVersion:1,revision:1,disabled:['gestao/area-gestao-da-qualidade']},training:null},
 {global:null,training:{version:1,disabled:['["Protocolos"]']}}
];
for(const [index,policy] of policies.entries())test('FB aggregate stops before content for disabled dependency '+index,async()=>{
 const reads=[];
 const worker=createFbPerformanceWorker({
  verifyIdentity:async()=>({uid:'member',email:'member@example.test'}),
  getStore:()=>({get:async collection=>{
   reads.push(collection);
   if(collection==='users')return {uid:'member',email:'member@example.test',active:true,access:true};
   if(collection==='runtimePolicy')return policy.global;
   if(collection==='htmlTrainingSettings')return policy.training;
   assert.fail('Unexpected content read '+collection);
  }})
 });
 const request=new Request('https://test.invalid/v1/fb-performance',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'GET_PERFORMANCE',input:{subjectUid:'member'}})});
 const response=await worker.fetch(request,{FB_PERFORMANCE_ENABLED:'true'});
 assert.equal(response.status,403);
 assert.equal((await response.json()).code,'FB_PERFORMANCE_FOLDER_DISABLED');
 assert.ok(reads.every(collection=>['users','runtimePolicy','htmlTrainingSettings'].includes(collection)));

 const context=vm.createContext({});
 vm.runInContext(readFileSync(new URL('../apps-script-fb/FbPerformance.gs',import.meta.url),'utf8'),context);
 context.fbPerformanceHttp_=path=>{
  const data=path==='/runtimePolicy/folders'?policy.global:path==='/htmlTrainingSettings/folders'?policy.training:assert.fail('Unexpected Apps Script content read');
  return data===null?null:{fields:encodeFields(data)};
 };
 assert.throws(()=>context.fbPerformanceRead_('evaluationAwards',100),/FB_FOLDER_DISABLED/);
});
