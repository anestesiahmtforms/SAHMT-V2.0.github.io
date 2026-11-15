import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivitySource} from '../worker-communication/activity-source.js';
import {createHtmlTrainingService} from '../worker-training/service.js';
import {createSurveyService} from '../worker-training/survey-service.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
import {institutionalAssignmentKey} from '../src/institutional-group.js';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const actor={uid:'ff-user',email:'user@example.invalid',googleUid:'google-one'};
const identity={uid:'source-user',email:actor.email,emailVerified:true,provider:'google.com'};
const activity={kind:'TRAINING',id:'training-one',title:'Training',version:1,maxScore:5,minimumScore:4};
function token(project='sahmt-gestao-5ae66',googleUid=actor.googleUid){
 const now=Math.floor(Date.now()/1000);
 return 'Bearer '+['header',Buffer.from(JSON.stringify({aud:project,iss:`https://securetoken.google.com/${project}`,sub:identity.uid,email:actor.email,email_verified:true,iat:now,auth_time:now,exp:now+3600,firebase:{sign_in_provider:'google.com',identities:{'google.com':[googleUid]}}})).toString('base64url'),'signature'].join('.');
}
function remote({googleUid=actor.googleUid,result={completed:true,completedAt:20,score:4},authorization=token()}={}){
 const calls=[];
 const source=createActivitySource({actor,headers:{'X-SAHMT-FB-Authorization':authorization,'X-SAHMT-FA-Authorization':token('sahmt-17a16')},fetchImpl:async(url,options)=>{
  calls.push({url,options});
  return Response.json(url.includes('accounts:lookup')?{users:[{localId:identity.uid,email:actor.email,emailVerified:true,providerUserInfo:[{providerId:'google.com',rawId:googleUid}]}]}:result);
 }});
 return {source,calls};
}
test('source binds Google identity before forwarding only to fixed service, with no caller completion fields',async()=>{
 const h=remote();assert.deepEqual(await h.source.completion({activity}),{completed:true,completedAt:20,score:4});
 assert.equal(h.calls.length,2);assert.match(h.calls[1].url,/^https:\/\/sahmt-html-training\.anestesiahmtforms2\.workers\.dev\/v1\/training$/);
 assert.deepEqual(JSON.parse(h.calls[1].options.body),{action:'OBLIGATION_STATUS',input:{trainingId:activity.id,version:1,minimumScore:4}});
 await assert.rejects(h.source.completion({activity:{...activity,score:5,completed:true}}),{code:'COMM_INVALID_ACTIVITY'});
 await assert.rejects(h.source.completion({activity:{...activity,id:'https://evil.invalid'}}),{code:'COMM_INVALID_ACTIVITY'});
});
test('foreign provider identity and wrong Firebase project are rejected before source request',async()=>{
 for(const h of [remote({googleUid:'foreign'}),remote({authorization:token('sahmt-17a16')}),remote({authorization:token('sahmt-gestao-5ae66','foreign')})]){
  await assert.rejects(h.source.completion({activity}),{code:'COMM_SOURCE_IDENTITY_MISMATCH'});assert.ok(h.calls.length<=1);
 }
});
test('survey source uses FA token, filters answer payloads, and never accepts a supplied URL',async()=>{
 const h=remote({result:{completed:true,answers:{private:true}}});
 assert.deepEqual(await h.source.completion({activity:{kind:'SURVEY',id:'climate',title:'Climate',cycle:'2026'}}),{completed:true});
 assert.match(h.calls.at(-1).url,/sahmt-fe-surveys\.anestesiahmtforms5/);
 await assert.rejects(h.source.catalog({kind:'https://evil.invalid'}),{code:'COMM_INVALID_ACTIVITY'});
});
test('eligibility uses bounded batches, preserves excluded IDs, and refuses incomplete source replies',async()=>{
 const calls=[],recipients=Array.from({length:17},(_,n)=>({uid:`ff-${n}`,email:`person${n}@example.invalid`,institutionalGroup:'team'}));
 const source=createActivitySource({actor,headers:{'X-SAHMT-FB-Authorization':token()},fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('accounts:lookup'))return Response.json({users:[{localId:identity.uid,email:actor.email,emailVerified:true,providerUserInfo:[{providerId:'google.com',rawId:actor.googleUid}]}]});
  const {input}=JSON.parse(options.body);assert.ok(input.recipients.length<=8);
  assert.ok(input.recipients.every(r=>Object.keys(r).sort().join(',')==='email,uid'));
  return Response.json({eligibleUids:input.recipients.map(r=>r.uid),excluded:[]});
 }});
 assert.deepEqual(await source.eligibility({activity,recipients}),{eligibleUids:recipients.map(r=>r.uid),excluded:[]});assert.equal(calls.length,4);
 const broken=remote({result:{eligibleUids:[],excluded:[]}});
 await assert.rejects(broken.source.eligibility({activity,recipients:recipients.slice(0,1)}),{code:'COMM_SOURCE_UNAVAILABLE'});
});
test('source rejects redirected, oversized and inconsistent completion evidence',async()=>{
 for(const result of [{completed:true,completedAt:1,score:6},{completed:true,completedAt:1,score:3},{completed:true,score:5}])await assert.rejects(remote({result}).source.completion({activity}),{code:'COMM_SOURCE_UNAVAILABLE'});
 const source=createActivitySource({actor,headers:{'X-SAHMT-FB-Authorization':token()},fetchImpl:async(url,options)=>{
  assert.equal(options.redirect,'manual');
  return new Response('x'.repeat(512*1024+1));
 }});
 await assert.rejects(source.completion({activity}),{code:'COMM_SOURCE_UNAVAILABLE'});
});
function trainingFixture(){
 const store=vaccinationMemoryStore();
 store.seed('users',identity.uid,{uid:identity.uid,email:identity.email,active:true,access:true});
 store.seed('users','admin',{uid:'admin',email:'admin@example.invalid',active:true,access:true,role:'administrador_app'});
 store.seed('documentAccessEmails',identity.email,{id:identity.email,email:identity.email,active:true,groups:['GENERAL']});
 store.seed('htmlTrainings',activity.id,{id:activity.id,title:activity.title,status:'PUBLISHED',version:1,maxScore:5,audienceGroup:'GENERAL',folderPath:['ROPs']});
 return {store,service:createHtmlTrainingService({store}),admin:{...identity,uid:'admin',email:'admin@example.invalid'}};
}
test('training restricted status is read-only, own-only and requires exact-version acknowledged completed sufficient attempt',async()=>{
 const h=trainingFixture();const input={trainingId:activity.id,version:1,minimumScore:4};
 const state={uid:identity.uid,trainingId:activity.id,attempts:[{trainingVersion:1,acknowledgedAt:10,completedAt:20,maxScore:5,score:4,answers:{secret:'answer'},suggestion:'private'}]};
 h.store.seed('htmlTrainingStates',`${activity.id}_${identity.uid}`,state);
 assert.deepEqual(await h.service.execute('OBLIGATION_STATUS',input,identity),{completed:true,completedAt:20,score:4});
 assert.deepEqual(await h.store.get('htmlTrainingStates',`${activity.id}_${identity.uid}`),state);
 assert.deepEqual(await h.store.list('htmlTrainingScores'),[]);
 await assert.rejects(h.service.execute('OBLIGATION_STATUS',{...input,subjectUid:'admin'},identity),{code:'INVALID_INPUT'});
 for(const patch of [{score:3},{trainingVersion:2},{acknowledgedAt:null},{completedAt:null}]){
  h.store.seed('htmlTrainingStates',`${activity.id}_${identity.uid}`,{...state,attempts:[{...state.attempts[0],...patch}]});
  assert.equal((await h.service.execute('OBLIGATION_STATUS',input,identity)).completed,false);
 }
 assert.deepEqual(await h.service.execute('OBLIGATION_STATUS',{...input,version:2},identity),{completed:false,unavailable:true,reason:'VERSION_CHANGED'});
 h.store.seed('htmlTrainingStates',`${activity.id}_${identity.uid}`,{...state,attempts:[{...state.attempts[0],score:2},{...state.attempts[0],score:3}]});
 assert.deepEqual(await h.service.execute('OBLIGATION_STATUS',input,identity),{completed:false,unavailable:true,reason:'ATTEMPT_LIMIT'});
});
test('training eligibility resolves source UID by email and uses document access, not institutional group',async()=>{
 const h=trainingFixture(),input={trainingId:activity.id,version:1,minimumScore:4,recipients:[{uid:actor.uid,email:actor.email}]};
 assert.deepEqual(await h.service.execute('OBLIGATION_ELIGIBILITY',input,h.admin),{eligibleUids:[actor.uid],excluded:[]});
 await assert.rejects(h.service.execute('OBLIGATION_CATALOG',{},identity),{code:'FORBIDDEN'});
 h.store.seed('documentAccessEmails',identity.email,{id:identity.email,email:identity.email,active:true,groups:['RESTRICTED']});
 assert.deepEqual(await h.service.execute('OBLIGATION_ELIGIBILITY',input,h.admin),{eligibleUids:[],excluded:[{uid:actor.uid,reason:'FORBIDDEN'}]});
 h.store.seed('htmlTrainingSettings','folders',{version:1,disabled:[JSON.stringify(['ROPs'])]});
 assert.deepEqual(await h.service.execute('OBLIGATION_CATALOG',{},h.admin),{items:[]});
});
test('survey restricted completion recognizes existing participation when closed without reading answers or awarding points',async()=>{
 const profiles=vaccinationMemoryStore(),responses=vaccinationMemoryStore();
 profiles.seed('users',identity.uid,{uid:identity.uid,email:identity.email,active:true,access:true});
 profiles.seed('userCategories',await institutionalAssignmentKey(identity.email),{schemaVersion:1,identityStatus:'LINKED',uid:identity.uid,email:identity.email,memberCategories:['EFETIVO']});
 responses.seed('climateCycles','2026',{status:'closed'});
 responses.seed('surveyParticipation',`${identity.uid}_climate_2026`,{uid:identity.uid,survey:'climate',cycle:'2026',completed:true});
 const service=createSurveyService({profileStore:profiles,responseStore:responses,checkSurvey:async()=>{throw Object.assign(Error(),{code:'SURVEY_FOLDER_DISABLED',status:403});}});
 assert.deepEqual(await service.execute('OBLIGATION_STATUS',{survey:'climate',cycle:'2026'},identity),{completed:true});
 await assert.rejects(service.execute('OBLIGATION_STATUS',{survey:'climate',cycle:'2026',uid:'foreign'},identity),{code:'SURVEY_INVALID_INPUT'});
 assert.deepEqual(await responses.list('fePerformanceAwards'),[]);
});
test('survey eligibility uses source membership, distinguishes closed cycles, and recognizes prior completion',async()=>{
 const profiles=vaccinationMemoryStore(),responses=vaccinationMemoryStore();
 const admin={...identity,uid:'admin',email:'admin@example.invalid'};
 for(const [person,category] of [[admin,'EFETIVO'],[identity,'RESIDENTE_1']]){
  profiles.seed('users',person.uid,{uid:person.uid,email:person.email,active:true,access:true,...(person===admin?{role:'administrador_app'}:{})});
  profiles.seed('userCategories',await institutionalAssignmentKey(person.email),{schemaVersion:1,identityStatus:'LINKED',uid:person.uid,email:person.email,memberCategories:[category]});
 }
 responses.seed('climateCycles','2026',{status:'open'});
 const service=createSurveyService({profileStore:profiles,responseStore:responses});
 const input={survey:'climate',cycle:'2026',recipients:[{uid:actor.uid,email:actor.email}]};
 assert.deepEqual(await service.execute('OBLIGATION_ELIGIBILITY',input,admin),{eligibleUids:[],excluded:[{uid:actor.uid,reason:'SURVEY_FORBIDDEN'}]});
 await assert.rejects(service.execute('OBLIGATION_CATALOG',{},identity),{code:'SURVEY_FORBIDDEN'});
 assert.deepEqual(await service.execute('OBLIGATION_CATALOG',{},admin),{items:[{kind:'SURVEY',id:'climate',title:'Pesquisa de Clima Organizacional',cycle:'2026'}]});
 profiles.seed('userCategories',await institutionalAssignmentKey(identity.email),{schemaVersion:1,identityStatus:'LINKED',uid:identity.uid,email:identity.email,memberCategories:['EFETIVO']});
 responses.seed('climateCycles','2026',{status:'closed'});
 assert.deepEqual(await service.execute('OBLIGATION_ELIGIBILITY',input,admin),{eligibleUids:[],excluded:[{uid:actor.uid,reason:'SURVEY_CYCLE_CLOSED'}]});
 responses.seed('surveyParticipation',`${identity.uid}_climate_2026`,{uid:identity.uid,survey:'climate',cycle:'2026',completed:true});
 assert.deepEqual(await service.execute('OBLIGATION_ELIGIBILITY',input,admin),{eligibleUids:[actor.uid],excluded:[]});
});
test('restricted source adapter binds and forwards source credentials inside workerd',{timeout:60000},async()=>{
 const authorization=token();
 const bundle=await build({stdin:{contents:`import {createActivitySource} from './worker-communication/activity-source.js';
 export default {async fetch(request){return Response.json(await createActivitySource({actor:${JSON.stringify(actor)},headers:{'X-SAHMT-FB-Authorization':request.headers.get('Authorization')}}).completion({activity:${JSON.stringify(activity)}}));}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*']});
 const calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({name:'activity-source',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat'],outboundService:async request=>{
  calls.push(request.url);
  if(new URL(request.url).hostname==='identitytoolkit.googleapis.com')return Response.json({users:[{localId:identity.uid,email:actor.email,emailVerified:true,providerUserInfo:[{providerId:'google.com',rawId:actor.googleUid}]}]});
  assert.equal(request.url,'https://sahmt-html-training.anestesiahmtforms2.workers.dev/v1/training');
  assert.equal(request.headers.get('Authorization'),authorization);
  assert.deepEqual(await request.json(),{action:'OBLIGATION_STATUS',input:{trainingId:activity.id,version:1,minimumScore:4}});
  return Response.json({completed:true,completedAt:20,score:4});
 }}));
 try{const response=await mf.dispatchFetch('https://synthetic.invalid/',{headers:{Authorization:authorization}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{completed:true,completedAt:20,score:4});assert.equal(calls.length,2);}
 finally{await mf.dispose();}
});
