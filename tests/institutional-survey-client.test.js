import test from 'node:test';import assert from 'node:assert/strict';
import {callInstitutionalSurvey} from '../src/institutional-survey-client.js';
function setup(response){const requests=[],auth={app:{options:{projectId:'sahmt-17a16'}},currentUser:{uid:'fe-user',async getIdToken(){return 'synthetic-token';}},async authStateReady(){}};return {requests,auth,fetchImpl:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return Response.json(response);}};}
test('FE performance is requested directly from FE',async()=>{
 const fixture=setup({});
 await callInstitutionalSurvey({uid:'fe-user',isCurrent:()=>true,action:'GET_PERFORMANCE',authClient:fixture.auth,fetchImpl:fixture.fetchImpl});
 assert.equal(new URL(fixture.requests[0].url).host,'sahmt-fe-surveys.anestesiahmtforms5.workers.dev');
 assert.deepEqual(fixture.requests[0].body,{action:'GET_PERFORMANCE',input:{}});

});

test('FE climate and stress use the FE Worker directly with the existing FA session',async()=>{
 const f=setup({group:'resident',alreadyResponded:false});
 for(const survey of ['climate','stress'])await callInstitutionalSurvey({uid:'fe-user',isCurrent:()=>true,survey,action:'BOOTSTRAP',authClient:f.auth,fetchImpl:f.fetchImpl});
 assert.ok(f.requests.every(r=>new URL(r.url).host==='sahmt-fe-surveys.anestesiahmtforms5.workers.dev'));
});
