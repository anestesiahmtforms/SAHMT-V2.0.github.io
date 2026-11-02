import test from 'node:test';import assert from 'node:assert/strict';
import {callInstitutionalSurvey} from '../src/institutional-survey-client.js';
function setup(response){const requests=[],auth={app:{options:{projectId:'sahmt-17a16'}},currentUser:{uid:'fe-user',async getIdToken(){return 'synthetic-token';}},async authStateReady(){}};return {requests,auth,fetchImpl:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return Response.json(response);}};}
test('FE performance client requests only the authenticated user summary and strips response fields',async()=>{
 const fixture=setup({status:'READY',uid:'fe-user',summary:{uid:'fe-user',total:1},reference:{maxTotal:2},awards:[{uid:'fe-user',category:'PERFORMANCE',points:1,survey:'climate',cycle:'2026',createdAt:10,answers:{Q01:'private'}}]});
 const result=await callInstitutionalSurvey({uid:'fe-user',isCurrent:()=>true,action:'GET_PERFORMANCE',authClient:fixture.auth,fetchImpl:fixture.fetchImpl});
 assert.deepEqual(fixture.requests[0].body,{action:'GET_PERFORMANCE',input:{}});assert.equal(result.awards.length,1);assert.equal(Object.hasOwn(result.awards[0],'answers'),false);
});
test('FE performance client rejects a response bound to another UID',async()=>{
 const fixture=setup({status:'READY',uid:'other',summary:{uid:'other',total:0},reference:{maxTotal:0},awards:[]});
 await assert.rejects(callInstitutionalSurvey({uid:'fe-user',isCurrent:()=>true,action:'GET_PERFORMANCE',authClient:fixture.auth,fetchImpl:fixture.fetchImpl}),e=>e.message==='SURVEY_UNAVAILABLE');
});
