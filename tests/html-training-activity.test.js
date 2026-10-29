import test from 'node:test';
import assert from 'node:assert/strict';
import {htmlTrainingActivityState,loadHtmlTrainingDocument,hydrateHtmlTrainingActivities} from '../src/html-training-activity.js';

const training={id:'document',version:2,maxScore:5};
const attempt=(overrides={})=>({trainingVersion:2,acknowledgedAt:10,completedAt:20,score:5,maxScore:5,suggestion:'Sugestão enviada',...overrides});
const state=(overrides={})=>({uid:'user',trainingId:'document',attempts:[],run:null,...overrides});
const color=s=>htmlTrainingActivityState(training,s,'user');
test('unstarted documents are red and a started reading is yellow',()=>{
  assert.equal(color(state()).color,'red');
  assert.equal(color(state({run:{trainingVersion:2,stage:'READING',readCount:0}})).color,'yellow');
});
test('green requires reading, a submitted assessment with the maximum grade, and a nonblank suggestion',()=>{
  const ready=color(state({attempts:[attempt()],suggestionDecision:null}));
  assert.equal(ready.color,'green');assert.equal(ready.complete,true);
  for(const changed of [{suggestion:''},{suggestion:'  '},{score:4.99},{score:0},{maxScore:0},{acknowledgedAt:null},{completedAt:null}])assert.notEqual(color(state({attempts:[attempt(changed)]})).color,'green');
});
test('manual suggestion points do not gate completion and the best current-version grade is preserved',()=>{
  assert.equal(color(state({attempts:[attempt()],suggestionDecision:{points:0}})).color,'green');
  assert.equal(color(state({attempts:[attempt({suggestion:''}),attempt({score:3})]})).color,'green');
  assert.equal(color(state({attempts:[attempt()],run:{trainingVersion:2,stage:'READING',readCount:0}})).color,'green');
});
test('other users, another document, old versions and aggregate scores cannot paint a document green',()=>{
  assert.equal(color(state({uid:'other',attempts:[attempt()]})).color,'red');
  assert.equal(color(state({trainingId:'other',attempts:[attempt()]})).color,'red');
  assert.equal(color(state({attempts:[attempt({trainingVersion:1})]})).color,'yellow');
  assert.equal(color(state({bestScore:5,ackPoints:1,suggestionDecision:{points:2}})).complete,false);
  assert.equal(color(state({attempts:[attempt({maxScore:4,score:4})]})).color,'yellow');
});
test('authorized metadata and content begin loading in parallel',async()=>{
  const calls=[],release={};
  const api=(action,input)=>{calls.push({action,input});return new Promise(resolve=>{release[action]=resolve;});};
  const loading=loadHtmlTrainingDocument(api,{trainingId:'document',version:2});
  assert.deepEqual(calls.map(c=>c.action),['OPEN','CONTENT']);
  release.CONTENT({sections:[{html:'<p>Texto</p>'}],revision:2});release.OPEN({training});
  assert.match((await loading).content.sections[0].html,/Texto/);
});
test('revoked access wins over a concurrently loaded body',async()=>{
  const forbidden=Object.assign(Error('Revoked'),{status:403});
  await assert.rejects(loadHtmlTrainingDocument(async action=>{if(action==='OPEN')throw forbidden;return {sections:[{html:'private'}],revision:2};},{trainingId:'document',version:2}),error=>error===forbidden);
});
test('a publication race reloads only the current authorized version',async()=>{
  const calls=[];
  const result=await loadHtmlTrainingDocument(async(action,input)=>{calls.push({action,input});if(action==='OPEN')return {training:{...training,version:3}};if(input.version===2)throw Object.assign(Error('changed'),{code:'VERSION_CHANGED'});return {sections:[],revision:3};},{trainingId:'document',version:2});
  assert.equal(result.content.revision,3);assert.deepEqual(calls.map(c=>c.action),['OPEN','CONTENT','CONTENT']);assert.equal(calls[2].input.version,3);
});
test('visible progress checks are bounded and stop scheduling work when a document opens',async()=>{
  let active=true,inflight=0,peak=0;const started=[],release=[],painted=[];
  const loading=hydrateHtmlTrainingActivities({trainings:[1,2,3,4],isCurrent:()=>active,read:async t=>{started.push(t);peak=Math.max(peak,++inflight);await new Promise(resolve=>release.push(resolve));inflight--;return t;},onResult:t=>painted.push(t)});
  assert.deepEqual(started,[1,2]);assert.equal(peak,2);active=false;release.forEach(resolve=>resolve());await loading;
  assert.deepEqual(started,[1,2]);assert.deepEqual(painted,[]);
});
test('a failed progress read does not prevent checking the next visible document',async()=>{
  const values=[],failures=[];await hydrateHtmlTrainingActivities({trainings:[1,2],concurrency:1,isCurrent:()=>true,read:async t=>{if(t===1)throw Error('offline');return t;},onResult:t=>values.push(t),onError:t=>failures.push(t)});
  assert.deepEqual(values,[2]);assert.deepEqual(failures,[1]);
});
