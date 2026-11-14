import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createFunctionalAuthWorker} from '../worker-functional-auth/worker.js';

const source=readFileSync(new URL('../apps-script-functional/Gateway.gs',import.meta.url),'utf8');

test('FK administrative lookup checks the actor and active effective assignment before reading a single profile',()=>{
 const requests=[];
 const env={UrlFetchApp:{fetchAll(input){return input.map(({url,...options})=>this.fetch(url,options));},fetch(url,options){
  requests.push([url,options.method]);
  if(url.includes('/functionalPerformance/'))return {getResponseCode:()=>404};
  if(url.includes('/functionalRecognition/'))return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({fields:{uid:{stringValue:'person'},message:{stringValue:'Mensagem individual'}}})};
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({fields:{uid:{stringValue:'person'},schemaVersion:{integerValue:'1'},
   updatedAt:{integerValue:'1'},sources:{mapValue:{fields:{}}}}})};
 }}};
 vm.runInNewContext(source,env);
 env.getFkSnapshotAccessToken_=()=> 'synthetic';
 env.sha256Hex_=()=> 'roster-id';
 env.readFaDocument_=(_token,path)=>path==='users/person'?{uid:'person',email:'person@example.test',active:true,access:true}:assignment;
 let assignment={schemaVersion:1,identityStatus:'LINKED',uid:'person',email:'person@example.test',memberCategories:['EFETIVO']};
 for(const group of ['EQUIPE','GESTOR','ADMINISTRADOR']){
  env.authorizeFaUser_=()=>({group,administrator:false});
  assert.throws(()=>env.readTeamOverview_('login','person'),/FK_AUTH_DENIED/);
 }
 env.authorizeFaUser_=()=>({group:'ADMINISTRADOR',administrator:true});
 for(const categories of [['RESIDENTE_1'],['SUBSTITUTO'],['EFETIVO','SUBSTITUTO']]){
  assignment.memberCategories=categories;
  assert.throws(()=>env.readTeamOverview_('login','person'),/FK_TEAM_MEMBER_DENIED/);
 }
 assert.equal(requests.length,0);
 assignment.memberCategories=['EFETIVO'];
 const overview=env.readTeamOverview_('login','person');
 assert.equal(overview.snapshot.uid,'person');
 assert.equal(overview.recognition,'Mensagem individual');
 assert.deepEqual(requests.map(([url,method])=>[url.split('/documents/').at(-1),method]),
  [['functionalProfiles/person','get'],['functionalRecognition/person','get'],['functionalPerformance/person','get']]);
});

test('FK worker signs the selected UID and rejects a mismatched result',async()=>{
 const origin='https://anestesiahmtforms.github.io', token='x'.repeat(120);
 const env={FK_AUTH_ORIGIN:origin,FK_HMAC_SECRET:'y'.repeat(32),APPS_SCRIPT_URL:'https://example.test/script'};
 let result={code:'FK_TEAM_OVERVIEW',uid:'person',snapshot:{uid:'someone-else'}};
 const worker=createFunctionalAuthWorker({fetchImpl:async(_url,options)=>{
  const envelope=JSON.parse(options.body);
  assert.match(envelope.signature,/^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(envelope.payload),{action:'READ_TEAM_OVERVIEW',faIdToken:token,subjectUid:'person'});
  return Response.json(result);
 }});
 const call=(input)=>worker.fetch(new Request('https://example.test/v1/functional/team-overview',{method:'POST',headers:{Origin:origin},body:JSON.stringify(input)}),env);
 assert.equal((await call({faIdToken:token,subjectUid:'person',admin:true})).status,400);
 assert.equal((await call({faIdToken:token,subjectUid:'person'})).status,503);
 result={code:'FK_AUTH_DENIED'};
 assert.equal((await call({faIdToken:token,subjectUid:'person'})).status,403);
 result={code:'FK_TEAM_OVERVIEW',uid:'person',snapshot:null,recognition:'Mensagem individual'};
 assert.deepEqual(await (await call({faIdToken:token,subjectUid:'person'})).json(),{uid:'person',snapshot:null,recognition:'Mensagem individual',performance:null});
});
