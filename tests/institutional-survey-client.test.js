import test from 'node:test';import assert from 'node:assert/strict';
import {callInstitutionalSurvey} from '../src/institutional-survey-client.js';
function setup(response){const requests=[],auth={app:{options:{projectId:'sahmt-17a16'}},currentUser:{uid:'fe-user',async getIdToken(){return 'synthetic-token';}},async authStateReady(){}};return {requests,auth,fetchImpl:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return Response.json(response);}};}
test('legacy performance reads are rejected before any network request',async()=>{
 const fixture=setup({});
 await assert.rejects(callInstitutionalSurvey({uid:'fe-user',isCurrent:()=>true,action:'GET_PERFORMANCE',authClient:fixture.auth,fetchImpl:fixture.fetchImpl}),e=>e.message==='SURVEY_ACTION_INVALID');
 assert.equal(fixture.requests.length,0);
});

test('FE climate and stress use the FE Worker directly with the existing FA session',async()=>{
 const f=setup({group:'resident',alreadyResponded:false});
 for(const survey of ['climate','stress'])await callInstitutionalSurvey({uid:'fe-user',isCurrent:()=>true,survey,action:'BOOTSTRAP',authClient:f.auth,fetchImpl:f.fetchImpl});
 assert.ok(f.requests.every(r=>new URL(r.url).host==='sahmt-fe-surveys.anestesiahmtforms5.workers.dev'));
});
