import test from 'node:test';import assert from 'node:assert/strict';
import {createTrainingWorker} from '../worker-training/worker.js';import {verifyTrainingIdentity} from '../worker-training/google-auth.js';import {createFirestoreStore} from '../worker-training/firestore.js';
const origin='https://anestesiahmtforms.github.io';
test('only survey route selects FA issuer and key; caller cannot choose its project',async()=>{
 const calls=[];const worker=createTrainingWorker({verifyIdentity:async(header,options)=>{calls.push(options);assert.equal(header,'Bearer synthetic');return {uid:'synthetic'};},buildSurveyService:()=>({execute:async(action,input)=>{assert.equal(action,'BOOTSTRAP');assert.deepEqual(input,{survey:'stress',cycle:'2026'});return {group:'resident',alreadyResponded:false};}})});
 const request=body=>new Request('https://worker.test/v1/institutional-surveys',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify(body)});
 const body={action:'BOOTSTRAP',input:{survey:'stress',cycle:'2026'}},env={INSTITUTIONAL_SURVEYS_ENABLED:'true',FA_WEB_API_KEY:'fa-public-key',FB_WEB_API_KEY:'fb-public-key'};
 assert.equal((await worker.fetch(request(body),{})).status,503);assert.equal(calls.length,0);
 const result=await worker.fetch(request(body),env);assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.deepEqual(calls,[{apiKey:'fa-public-key',projectId:'sahmt-17a16'}]);
 assert.equal((await worker.fetch(request({...body,projectId:'other'}),env)).status,400);
});
test('FA tokens pass only an explicitly FA-bound verification; other issuers cannot widen the existing FB routes',async()=>{
 const claims={aud:'sahmt-17a16',iss:'https://securetoken.google.com/sahmt-17a16',sub:'synthetic',email:'one@example.invalid',email_verified:true,auth_time:10,iat:10,exp:3000,firebase:{sign_in_provider:'google.com'}},token=['header',Buffer.from(JSON.stringify(claims)).toString('base64url'),'signature'].join('.');
 let reads=0;const options={apiKey:'fa-public-key',projectId:'sahmt-17a16',now:()=>1000000,fetchImpl:async()=>{reads++;return Response.json({users:[{localId:'synthetic',email:'one@example.invalid',emailVerified:true,validSince:'10'}]});}};
 assert.equal((await verifyTrainingIdentity('Bearer '+token,options)).uid,'synthetic');assert.equal(reads,1);
 await assert.rejects(verifyTrainingIdentity('Bearer '+token,{...options,projectId:'sahmt-gestao-5ae66'}),/SESSION/);assert.equal(reads,1);
 await assert.rejects(verifyTrainingIdentity('Bearer '+token,{...options,projectId:'untrusted'}),/CONFIG/);
});
test('FE adapter creates immutable documents in FE and cannot be pointed at arbitrary projects',async()=>{
 const requests=[],store=createFirestoreStore({projectId:'outros-48120',getAccessToken:async()=> 'synthetic-service',fetchImpl:async(url,options)=>{requests.push({url,body:options.body?JSON.parse(options.body):undefined});assert.match(url,/projects\/outros-48120\/databases\/\(default\)\/documents/);if(url.endsWith(':beginTransaction'))return Response.json({transaction:'synthetic-tx'});if(url.includes('/surveyParticipation/'))return new Response('{}',{status:404});return Response.json({});}});
 await store.transaction(async tx=>{assert.equal(await tx.get('surveyParticipation','synthetic_stress_2026'),null);tx.create('stressResponses','a'.repeat(32),{group:'team',answers:{S01:0}});});
 const commit=requests.find(r=>r.url.endsWith(':commit'));assert.equal(commit.body.writes[0].currentDocument.exists,false);assert.match(commit.body.writes[0].update.name,/^projects\/outros-48120\//);
 assert.throws(()=>createFirestoreStore({projectId:'arbitrary',getAccessToken:async()=>''}),/CONFIG/);
});
