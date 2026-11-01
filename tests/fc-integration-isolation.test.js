import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fcIntegrationEndpoint} from '../src/fc-integration-config.js';
import {createQmentumPrintClient} from '../src/qmentum-print-client.js';
import {createQmentumCommandSender} from '../src/qmentum-command.js';
import {notifyConfiguredOccurrenceScore} from '../src/occurrence-scoring-delivery.js';
import {createFcIntegrationWorker} from '../worker-fc-integration/worker.js';

// All hosts, users, tokens, secrets and backend IDs below are synthetic fixtures.
const enabled={VITE_FC_INTEGRATION_ENABLED:'true',VITE_FC_INTEGRATION_ORIGIN:'https://fc.example.test'};
const paths=['/v1/qmentum/write','/v1/qmentum/prints','/v1/evaluation/occurrence'];
const origin='https://anestesiahmtforms.github.io';
const uid='same-uid',reportId='12345678-1234-1234-1234-123456789abc';
const auth={app:{options:{projectId:'indicadores---sahmt'}},currentUser:{uid,getIdToken:async()=>'synthetic-token'}};

test('FC activation changes only its fixed service endpoints; disabling restores exact legacy fallbacks',()=>{
  for(const path of paths){
    assert.equal(fcIntegrationEndpoint(path,{env:enabled,fallback:'https://central.test/legacy'}),'https://fc.example.test'+path);
    for(const value of [undefined,'','false'])assert.equal(fcIntegrationEndpoint(path,{env:{...enabled,VITE_FC_INTEGRATION_ENABLED:value},fallback:'https://central.test/legacy'}),'https://central.test/legacy');
  }
  assert.throws(()=>fcIntegrationEndpoint('/v1/operational-sheets/notify',{env:enabled}),/FC_INTEGRATION_ROUTE_INVALID/);
});

test('an enabled malformed FC origin cannot silently forward to the central integration',()=>{
  for(const value of [undefined,'','http://fc.example.test','https://user:pass@fc.example.test','https://fc.example.test/path','https://fc.example.test?station=FA','https://fc.example.test#FC','https://fc.example.test/','https://*.example.test'])
    assert.throws(()=>fcIntegrationEndpoint(paths[0],{env:{...enabled,VITE_FC_INTEGRATION_ORIGIN:value},fallback:'https://central.test/legacy'}),/FC_INTEGRATION_CONFIG_INVALID/);
  assert.throws(()=>fcIntegrationEndpoint(paths[0],{env:{...enabled,VITE_FC_INTEGRATION_ENABLED:'yes'}}),/FC_INTEGRATION_CONFIG_INVALID/);
});

test('actual print client uses FC integration while keeping its existing FC session and request contract',async()=>{
  let seen;
  const client=createQmentumPrintClient({auth,uid,integrationEnv:{...enabled,VITE_OPERATIONAL_SHEETS_ENDPOINT:'https://central.test/v1/operational-sheets/notify'},
    fetchImpl:async(url,options)=>{seen={url,options};return Response.json({code:'QMENTUM_PRINT_SCAN',result:{candidates:[]}});}});
  assert.deepEqual(await client.scan({unitId:'unit-a',year:2026}),{candidates:[]});
  assert.equal(seen.url,'https://fc.example.test/v1/qmentum/prints');
  assert.equal(seen.options.headers.Authorization,'Bearer synthetic-token');
  assert.deepEqual(JSON.parse(seen.options.body),{unitId:'unit-a',year:2026,operation:'SCAN'});
});

test('actual QMENTUM sender preserves request IDs, FC token and confirmed response with station routing',async()=>{
  let seen,stored;
  const api={doc:(_db,...path)=>path,serverTimestamp:()=>({kind:'timestamp'}),runTransaction:async(_db,fn)=>fn({get:async()=>({exists:()=>false}),set:(path,data)=>{stored={path,data};}})};
  const sender=createQmentumCommandSender({db:{},auth,uid,ensure:()=>{},firestore:api,integrationEnv:enabled,
    fetchImpl:async(url,options)=>{seen={url,options};return Response.json({code:'QMENTUM_WRITE_CONFIRMED',version:4});}});
  assert.deepEqual(await sender('SAVE_MONTH',{unitId:'unit-a'}),{version:4});
  assert.equal(seen.url,'https://fc.example.test/v1/qmentum/write');
  assert.equal(seen.options.headers.Authorization,'Bearer synthetic-token');
  assert.equal(stored.path[0],'qmentumWriteRequests');
  assert.equal(stored.data.actorUid,uid);
  assert.equal(JSON.parse(seen.options.body).id,stored.path[1]);
});

test('configured occurrence delivery switches FC independently of the old broker origin',async()=>{
  let seen;
  const result=await notifyConfiguredOccurrenceScore({id:reportId,uid,auth,fetchImpl:async(url,options)=>{seen={url,options};return new Response(null,{status:200});}},
    {env:{...enabled,VITE_OCCURRENCE_SCORING_ENABLED:'true',VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN:'https://central.test'}});
  assert.equal(result.code,'OCCURRENCE_SCORE_NOTIFICATION_SENT');
  assert.equal(seen.url,'https://fc.example.test/v1/evaluation/occurrence');
  assert.deepEqual(JSON.parse(seen.options.body),{id:reportId});
});

const fixtureEnv=()=>({FC_INTEGRATION_ENABLED:'true',QMENTUM_WRITE_ENABLED:'true',OCCURRENCE_SCORING_ENABLED:'true',
  OPERATIONAL_SHEETS_HMAC_SECRET:'s'.repeat(43),OCCURRENCE_SCORING_HMAC_SECRET:'s'.repeat(43),
  FC_MODULE_SCRIPT_URL:'https://script.google.com/macros/s/'+'fixture'.repeat(5)+'/exec',
  FC_ADMISSION:{idFromName:name=>name,get:()=>({fetch:async request=>Response.json({ok:true,admitted:new URL(request.url).pathname==='/admit'})})}});
const request=(path,extra={})=>new Request('https://fc.example.test'+path,{method:'POST',headers:{Origin:origin,...extra},body:'{}'});

test('FC Worker does not expose central login, reading or operational sheet routes',async()=>{
  let calls=0;const worker=createFcIntegrationWorker({fetchImpl:async()=>{calls++;throw Error('unexpected');}});
  for(const path of ['/v1/auth/exchange','/v1/auth/first-login','/v1/diretrizes/reading','/v1/operational-sheets/notify'])
    assert.equal((await worker.fetch(request(path),fixtureEnv())).status,404);
  assert.equal(calls,0);
});

test('FC Worker stays disabled until explicitly enabled and requires its own backend URL',async()=>{
  let calls=0;const worker=createFcIntegrationWorker({fetchImpl:async()=>{calls++;throw Error('unexpected');}});
  const env=fixtureEnv();delete env.FC_MODULE_SCRIPT_URL;
  env.OPERATIONAL_SHEETS_SCRIPT_URL='https://script.google.com/macros/s/'+'central'.repeat(5)+'/exec';
  env.OCCURRENCE_SCORING_SCRIPT_URL=env.OPERATIONAL_SHEETS_SCRIPT_URL;
  for(const path of paths)assert.equal((await worker.fetch(request(path),env)).status,503);
  for(const path of paths)assert.equal((await worker.fetch(request(path),{...fixtureEnv(),FC_INTEGRATION_ENABLED:'false'})).status,503);
  assert.equal(calls,0);
});

test('all dedicated FC routes retain authentication and CORS rejections before upstream calls',async()=>{
  let calls=0;const worker=createFcIntegrationWorker({fetchImpl:async()=>{calls++;throw Error('unexpected');}}),env=fixtureEnv();
  for(const path of paths){
    assert.equal((await worker.fetch(request(path),env)).status,401);
    assert.equal((await worker.fetch(request(path,{Origin:'https://untrusted.invalid'}),env)).status,403);
    const preflight=await worker.fetch(new Request('https://fc.example.test'+path,{method:'OPTIONS',headers:{Origin:origin}}),env);
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  }
  assert.equal(calls,0);
});

test('equal UID from another Firebase project is rejected without invoking Apps Script',async()=>{
  const token='header.'+Buffer.from(JSON.stringify({aud:'sahmt-17a16',iss:'https://securetoken.google.com/sahmt-17a16',sub:uid})).toString('base64url')+'.synthetic-signature';
  const calls=[];
  const worker=createFcIntegrationWorker({fetchImpl:async(url)=>{calls.push(url);return Response.json({name:'projects/indicadores---sahmt/databases/(default)/documents/occurrenceScoreClaims/'+reportId,fields:{uid:{stringValue:uid},sourceId:{stringValue:reportId}}});}});
  const response=await worker.fetch(new Request('https://fc.example.test/v1/evaluation/occurrence',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token},body:JSON.stringify({id:reportId})}),fixtureEnv());
  assert.equal(response.status,403);
  assert.equal((await response.json()).code,'OCCURRENCE_SCORE_AUTHOR_DENIED');
  assert.equal(calls.length,1);assert.match(calls[0],/^https:\/\/firestore.googleapis.com\/v1\/projects\/indicadores---sahmt\//);
});

test('all dedicated routes complete authenticated signed exchanges and release their own admission',async()=>{
  const token='header.'+Buffer.from(JSON.stringify({aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt',sub:uid})).toString('base64url')+'.synthetic-signature';
  const hash='a'.repeat(64),commandId=uid+'_'+hash;
  const cases=[
    {path:paths[0],input:{id:commandId},action:'qmentum-write-v1',domain:'SAHMT_QMENTUM_WRITE_V1\n',code:'QMENTUM_WRITE_CONFIRMED',answer:{version:3},name:'qmentumWriteRequests/'+commandId,fields:{actorUid:{stringValue:uid},payloadHash:{stringValue:hash}}},
    {path:paths[1],input:{operation:'SCAN',unitId:'unit-a',year:2026},action:'qmentum-prints-v1',domain:'SAHMT_QMENTUM_PRINT_V1\n',code:'QMENTUM_PRINT_SCAN',answer:{result:{candidates:[]}},name:'qmentumAccess/'+uid,fields:{uid:{stringValue:uid},role:{stringValue:'manager'},active:{booleanValue:true},units:{arrayValue:{values:[{stringValue:'unit-a'}]}}}},
    {path:paths[2],input:{id:reportId},action:'occurrence-score-v1',domain:'SAHMT_OCCURRENCE_SCORE_V1\n',code:'OCCURRENCE_SCORE_ACCEPTED',answer:{},name:'occurrenceScoreClaims/'+reportId,fields:{uid:{stringValue:uid},sourceId:{stringValue:reportId}}}
  ];
  for(const item of cases){
    const env=fixtureEnv(),admission=[],upstream=[];
    env.OPERATIONAL_SHEETS_SCRIPT_URL='https://central.example.test/forbidden';
    env.OCCURRENCE_SCORING_SCRIPT_URL='https://central.example.test/forbidden';
    env.FC_ADMISSION.get=()=>({fetch:async request=>{const path=new URL(request.url).pathname;admission.push(path);return Response.json({ok:true,admitted:path==='/admit'});}});
    const sign=value=>createHmac('sha256',env.OPERATIONAL_SHEETS_HMAC_SECRET).update(item.domain+value).digest('hex');
    const worker=createFcIntegrationWorker({fetchImpl:async(url,options)=>{
      upstream.push(url);
      if(url.startsWith('https://firestore.googleapis.com/'))return Response.json({name:'projects/indicadores---sahmt/databases/(default)/documents/'+item.name,fields:item.fields});
      assert.equal(url,env.FC_MODULE_SCRIPT_URL+'?action='+item.action);
      const envelope=JSON.parse(options.body);assert.equal(envelope.mac,sign(envelope.payload));
      const request=JSON.parse(Buffer.from(envelope.payload,'base64url'));assert.equal(request.uid,uid);
      const payload=Buffer.from(JSON.stringify({v:1,nonce:request.nonce,code:item.code,...item.answer})).toString('base64url');
      return Response.json({payload,mac:sign(payload)});
    }});
    const response=await worker.fetch(new Request('https://fc.example.test'+item.path,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token},body:JSON.stringify(item.input)}),env);
    assert.equal(response.status,200,item.path);assert.equal((await response.json()).code,item.code);
    assert.deepEqual(admission,['/admit','/release']);assert.equal(upstream.length,2);
    assert.equal(upstream.some(url=>url.includes('central.example.test')),false);
  }
});
