import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trainingParticipationState, trainingActivityId} from '../src/training-participation-state.js';
const activity={id:'form-1',creditScopeId:'matter',version:2,status:'READY',modalities:{test:true,acknowledgement:true}};
const attempt={uid:'person',activityId:'form-1',creditScopeId:'matter',version:2,training:{complete:true,score:5,maxScore:10}};
test('unstarted and obsolete versions are blue, including revisions of questions or material',()=>{
 for(const row of [null,{...attempt,version:1},{...attempt,uid:'other'}])assert.equal(trainingParticipationState(activity,row?[row]:[],{uid:'person'}).color,'blue');
 assert.equal(trainingParticipationState({...activity,status:'CONFIGURATION_PENDING'},[attempt],{uid:'person'}).color,'blue');
});
test('exactly fifty percent and complete is green; less than fifty or incomplete is yellow',()=>{
 assert.equal(trainingParticipationState(activity,[attempt],{uid:'person'}).color,'green');
 for(const training of [{complete:true,score:4.99,maxScore:10},{complete:false,score:10,maxScore:10},{complete:true,score:null,maxScore:10}])assert.equal(trainingParticipationState(activity,[{...attempt,training}],{uid:'person'}).color,'yellow');
});
test('latest retake drives color, while the first credited result stays intact',()=>{
 const first={...attempt,training:{complete:false,score:2,maxScore:10},latestTraining:{complete:true,score:8,maxScore:10}};
 assert.equal(trainingParticipationState(activity,[first],{uid:'person'}).color,'green');assert.equal(first.training.score,2);
});
test('reading without response is partial and another users reading cannot color a button',()=>{
 const receipt={uid:'person',formId:'form-1',materialVersion:2,status:'READING'};
 assert.equal(trainingParticipationState(activity,[],{uid:'person',receipts:[receipt]}).color,'yellow');
 assert.equal(trainingParticipationState(activity,[],{uid:'other',receipts:[receipt]}).color,'blue');
});
test('document aliases resolve to the form identity without title guessing',()=>{
 assert.equal(trainingActivityId({id:'pdf_evaluation_form-1'}),'form-1');
 assert.equal(trainingActivityId({id:'evaluation_form-1'}),'form-1');
 assert.equal(trainingActivityId({id:'material',trainingFormId:'form-1'}),'form-1');
 assert.equal(trainingActivityId({id:'unrelated'}),null);
});
test('missing scope never borrows a different activity completion',()=>{
 assert.equal(trainingParticipationState({...activity,creditScopeId:undefined},[{...attempt,activityId:'another',creditScopeId:undefined}],{uid:'person'}).color,'blue');
});
