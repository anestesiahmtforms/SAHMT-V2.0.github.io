import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {encodeFields} from '../worker-training/firestore.js';
import {institutionalAssignmentKey} from '../src/institutional-group.js';
test('production worker reads own FE status with FA login only, without changing registrations',{timeout:60000},async()=>{
 const uid='rl-fixture',email='rl@example.invalid',project='sahmt-17a16',category=await institutionalAssignmentKey(email),calls=[];
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const credentials={project_id:'sahmt-gestao-5ae66',client_email:'fixture@sahmt-gestao-5ae66.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
 const now=Math.floor(Date.now()/1000),token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:project,iss:'https://securetoken.google.com/'+project,sub:uid,email,email_verified:true,iat:now,auth_time:now,exp:now+3600,firebase:{sign_in_provider:'google.com'}})).toString('base64url')+'.signature';
 const bundled=await build({entryPoints:['worker-training/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*']});
 const root='/v1/projects/outros-48120/databases/(default)/documents/';
 const values=new Map([
  ['users/'+uid,{uid,email,active:true,access:true}],
  ['userCategories/'+category,{schemaVersion:1,identityStatus:'LINKED',uid,email,memberCategories:['EFETIVO']}],
  ['yearEndSchedules/2026-2027/participation/'+uid,{schemaVersion:1,cycle:'2026-2027',sigla:'RL'}]
 ]);
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat'],bindings:{INSTITUTIONAL_SURVEYS_ENABLED:'true',FA_WEB_API_KEY:'fa-key',FB_TRAINING_SERVICE_ACCOUNT_JSON:JSON.stringify(credentials)},outboundService:async request=>{
  const url=new URL(request.url);calls.push({path:url.pathname,method:request.method});
  if(url.hostname==='identitytoolkit.googleapis.com'){assert.equal(url.pathname,'/v1/accounts:lookup');assert.equal(url.searchParams.get('key'),'fa-key');assert.equal((await request.json()).idToken,token);return Response.json({users:[{localId:uid,email,emailVerified:true,validSince:String(now-1)}]});}
  if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'service-fixture',expires_in:3600,token_type:'Bearer'});
  assert.equal(url.hostname,'firestore.googleapis.com');assert.equal(request.method,'GET');assert.ok(url.pathname.startsWith(root));
  const value=values.get(decodeURIComponent(url.pathname.slice(root.length)));return value?Response.json({fields:encodeFields(value)}):new Response('{}',{status:404});
 }}));
 const call=()=>mf.dispatchFetch('https://worker.test/v1/year-end-status',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'STATUS',input:{}})});
 try{
  let response=await call();assert.equal(response.status,200);assert.deepEqual(await response.json(),{eligible:true,completed:false});
  values.set('yearEndSchedules/2026-2027/registrations/'+uid,{uid,sigla:'RL',plantao:'carnaval',grupo:'natal',position:1});
  response=await call();assert.equal(response.status,200);assert.deepEqual(await response.json(),{eligible:true,completed:true});
  assert.equal(calls.some(call=>/:commit|:runQuery/.test(call.path)),false);assert.equal(response.headers.get('Cache-Control'),'no-store');
 }finally{await mf.dispose();}
});
