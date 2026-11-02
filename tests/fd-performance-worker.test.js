import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndicatorWorker} from '../worker-indicators/worker.js';

const origin='https://anestesiahmtforms.github.io';

test('FD performance actions remain on the authenticated FD indicators route and preserve safe service errors',async()=>{
 const calls=[];
 const worker=createIndicatorWorker({
  verifyIdentity:async(authorization,options)=>{assert.equal(authorization,'Bearer synthetic');assert.equal(options.apiKey,'fa-public-key');return {uid:'fd-user'};},
  build:()=>({execute:async(action,input,identity)=>{calls.push({action,input,uid:identity.uid});throw Object.assign(Error('FD_PERFORMANCE_DISABLED'),{code:'FD_PERFORMANCE_DISABLED',status:503});}})
 });
 const request=new Request('https://worker.test/v1/indicators',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify({action:'GET_PERFORMANCE',input:{}})});
 const response=await worker.fetch(request,{INDICATORS_ENABLED:'true',FA_WEB_API_KEY:'fa-public-key'});
 assert.equal(response.status,503);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(await response.json(),{code:'FD_PERFORMANCE_DISABLED'});
 assert.deepEqual(calls,[{action:'GET_PERFORMANCE',input:{},uid:'fd-user'}]);
});
