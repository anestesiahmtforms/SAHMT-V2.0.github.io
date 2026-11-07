import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabelsWorker} from '../worker-label-fh/worker.js';
const env={MODULE_STATION:'FH',MODULE_PROJECT_ID:'sahmt-etiquetas-fh',MODULE_CUTOVER_ACTIVE:'true',OPENAI_API_KEY:'synthetic-secret'};
test('FH wrapper refuses swapped configuration before health, session or image processing',async()=>{
 let calls=0;const worker=createLabelsWorker({sessionWorker:{fetch:()=>{calls++;return new Response('session');}},imageWorker:{fetch:()=>{calls++;return new Response('image');}}});
 for(const path of ['/health','/v1/session','/v1/labels/extract']){const r=await worker.fetch(new Request('https://worker.test'+path),{...env,MODULE_PROJECT_ID:'sahmt-17a16'});assert.equal(r.status,503);assert.equal(calls,0);}
});
test('FH wrapper exposes no secrets and gates image processing until activation and private key setup',async()=>{
 let images=0,sessions=0;const worker=createLabelsWorker({sessionWorker:{fetch:()=>{sessions++;return new Response('session');}},imageWorker:{fetch:()=>{images++;return new Response('image');}}});
 const health=await worker.fetch(new Request('https://worker.test/health'),env);assert.deepEqual(await health.json(),{station:'FH',projectId:'sahmt-etiquetas-fh',loginAuthority:'FA',cutoverActive:true});assert.equal(health.headers.get('Cache-Control'),'no-store');
 for(const override of [{MODULE_CUTOVER_ACTIVE:'false'},{OPENAI_API_KEY:''}])assert.equal((await worker.fetch(new Request('https://worker.test/v1/labels/extract'),{...env,...override})).status,503);
 assert.equal(images,0);assert.equal((await worker.fetch(new Request('https://worker.test/v1/labels/extract'),env)).status,200);assert.equal(images,1);
 assert.equal((await worker.fetch(new Request('https://worker.test/v1/session'),env)).status,200);assert.equal(sessions,1);
});
