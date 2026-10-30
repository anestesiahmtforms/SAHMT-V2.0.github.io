import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createServiceTokenProvider,verifyTrainingIdentity} from '../worker-training/google-auth.js';
import {createFirestoreStore,encodeFields,decodeFields} from '../worker-training/firestore.js';
import {createTrainingWorker} from '../worker-training/worker.js';

const FB='sahmt-gestao-5ae66';
test('an old client receives an explicit update instruction when complete reading is required',async()=>{
 const worker=createTrainingWorker({verifyIdentity:async()=>({uid:'reader'}),buildService:()=>({execute:async()=>{throw Object.assign(Error('reading required'),{code:'TRAINING_READING_REQUIRED',status:409});}})});
 const response=await worker.fetch(new Request('https://training.test/v1/training',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'READ',input:{trainingId:'item',runId:'run',index:0}})}),{HTML_TRAINING_ENABLED:'true'});
 const data=await response.json();assert.equal(response.status,409);assert.equal(data.code,'TRAINING_READING_REQUIRED');assert.match(data.message,/Atualize o aplicativo/);
});
const token=(overrides={})=>['header',Buffer.from(JSON.stringify({aud:FB,iss:`https://securetoken.google.com/${FB}`,sub:'user-1',email:'user@example.test',email_verified:true,auth_time:100,iat:100,exp:2000,firebase:{sign_in_provider:'google.com'},...overrides})).toString('base64url'),'signature'].join('.');
test('identity requires a Firebase-verified FB Google token and checks account revocation',async()=>{
 let reads=0;const fetchImpl=async(url,opts)=>{reads++;assert.match(url,/identitytoolkit.googleapis.com\/v1\/accounts:lookup/);assert.equal(JSON.parse(opts.body).idToken,token());return Response.json({users:[{localId:'user-1',email:'user@example.test',emailVerified:true,validSince:'100'}]});};
 const auth=await verifyTrainingIdentity('Bearer '+token(),{apiKey:'public-api-key',fetchImpl,now:()=>1000000});
 assert.equal(auth.uid,'user-1');assert.equal(auth.provider,'google.com');assert.equal(reads,1);
 await assert.rejects(()=>verifyTrainingIdentity('Bearer '+token({aud:'sahmt-17a16'}),{apiKey:'key',fetchImpl,now:()=>1000000}),/SESSION/);assert.equal(reads,1);
 await assert.rejects(()=>verifyTrainingIdentity('Bearer '+token(),{apiKey:'key',now:()=>1000000,fetchImpl:async()=>Response.json({users:[{localId:'user-1',email:'user@example.test',emailVerified:true,validSince:'101'}]})}),/SESSION/);
 await assert.rejects(()=>verifyTrainingIdentity('Bearer '+token(),{apiKey:'key',now:()=>1000000,fetchImpl:async()=>Response.json({users:[{localId:'user-1',disabled:true}]})}),/SESSION/);
});
test('service credentials stay on the server, bind to FB, and cache only valid OAuth tokens',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});let calls=0,now=1000000;
 const credentials={project_id:FB,client_email:`training@${FB}.iam.gserviceaccount.com`,private_key:privateKey.export({type:'pkcs8',format:'pem'})};
 const provider=createServiceTokenProvider({credentials,now:()=>now,fetchImpl:async(url,opts)=>{calls++;assert.equal(url,'https://oauth2.googleapis.com/token');const jwt=new URLSearchParams(opts.body).get('assertion');const claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url'));assert.equal(claims.iss,credentials.client_email);assert.equal(claims.aud,url);assert.equal(claims.scope,'https://www.googleapis.com/auth/datastore');return Response.json({access_token:'server-only',expires_in:3600,token_type:'Bearer'});}});
 assert.equal(await provider(),'server-only');assert.equal(await provider(),'server-only');assert.equal(calls,1);now+=3600000;await provider();assert.equal(calls,2);
 assert.throws(()=>createServiceTokenProvider({credentials:{...credentials,project_id:'sahmt-17a16'}}),/CONFIG/);
});
test('Firestore codec preserves nested sections, numeric zero and nullable fields',()=>{
 const data={count:0,score:2.5,active:false,optional:null,sections:[{id:'s0',title:'Texto',html:'<p>Olá</p>'}],map:{empty:[]}};
 assert.deepEqual(decodeFields(encodeFields(data)),data);
 assert.throws(()=>encodeFields({bad:Infinity}),/VALUE/);
});
test('Firestore transactions retry ABORTED and never lose atomic create preconditions',async()=>{
 let begins=0,commits=0;const commitsSeen=[];
 const store=createFirestoreStore({getAccessToken:async()=> 'private',fetchImpl:async(url,opts)=>{
 assert.ok(url.startsWith(`https://firestore.googleapis.com/v1/projects/${FB}/databases/(default)/documents`));assert.equal(opts.headers.Authorization,'Bearer private');
 if(url.endsWith(':beginTransaction'))return Response.json({transaction:'tx'+(++begins)});
 if(url.includes('/htmlTrainingStates/'))return Response.json({name:'state',fields:encodeFields({version:commits})});
 if(url.endsWith(':commit')){const body=JSON.parse(opts.body);commitsSeen.push(body);if(++commits===1)return Response.json({error:{status:'ABORTED'}},{status:409});return Response.json({commitTime:'now'});}
 if(url.endsWith(':rollback'))return Response.json({});throw Error(url);
 }});
 const result=await store.transaction(async tx=>{const state=await tx.get('htmlTrainingStates','item_user');tx.create('htmlTrainingAudits','audit',{v:state.version+1});return state.version;});
 assert.equal(result,1);assert.equal(commits,2);assert.equal(commitsSeen[1].transaction,'tx2');assert.deepEqual(commitsSeen[1].writes[0].currentDocument,{exists:false});
 await assert.rejects(()=>store.get('users','../secret'),/PATH/);
});
test('HTTP rejects origins and oversized bodies before invoking a service; no client chooses FB project',async()=>{
 let calls=0;
 const worker=createTrainingWorker({verifyIdentity:async()=>({uid:'u'}),buildService:()=>({execute:async(action,input)=>{calls++;assert.equal(action,'LIST');return {trainings:[]};}})});
 const env={HTML_TRAINING_ENABLED:'true'};
 const request=(origin,body)=>new Request('https://training.test/v1/training',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer token'},body});
 assert.equal((await worker.fetch(request('https://evil.test','{}'),env)).status,403);
 const valid=await worker.fetch(request('https://anestesiahmtforms.github.io',JSON.stringify({action:'LIST',input:{}})),env);assert.equal(valid.status,200);assert.equal(calls,1);assert.equal(valid.headers.get('Cache-Control'),'no-store');
 assert.equal((await worker.fetch(request('https://anestesiahmtforms.github.io',JSON.stringify({action:'LIST',input:{},projectId:'FA'})),env)).status,400);assert.equal(calls,1);
 assert.equal((await worker.fetch(request('https://anestesiahmtforms.github.io','x'.repeat(8*1024*1024+1)),env)).status,413);assert.equal(calls,1);
});

test('Firestore batch reads preserve requested order and email IDs without N network calls',async()=>{
 let calls=0;const store=createFirestoreStore({getAccessToken:async()=> 'private',fetchImpl:async(url,opts)=>{
 calls++;assert.ok(url.endsWith(':batchGet'));const names=JSON.parse(opts.body).documents;
 return Response.json([{found:{name:names[1],fields:encodeFields({email:'user@example.test'})}},{missing:names[0]}]);
 }});
 const result=await store.getMany('documentAccessEmails',['missing@example.test','user@example.test']);
 assert.equal(calls,1);assert.equal(result[0],null);assert.equal(result[1].email,'user@example.test');
 await assert.rejects(()=>store.get('users','..'),/PATH/);
});

test('a missing commit endpoint never reports a successful write',async()=>{
 const store=createFirestoreStore({getAccessToken:async()=> 'private',fetchImpl:async url=>url.endsWith(':beginTransaction')?Response.json({transaction:'tx'}):url.endsWith(':rollback')?Response.json({}):Response.json({error:{status:'NOT_FOUND'}},{status:404})});
 await assert.rejects(()=>store.transaction(tx=>{tx.set('htmlTrainingStates','user_item',{version:1});return {accepted:true};}),/STORE_UNAVAILABLE/);
});

test('outbound credentials never follow redirects, using the manual mode supported by workerd',async()=>{
 const redirect=async(url,options)=>{assert.equal(options.redirect,'manual');return Response.json({},{status:302,headers:{Location:'https://untrusted.invalid/'}});};
 await assert.rejects(verifyTrainingIdentity('Bearer '+token(),{apiKey:'key',now:()=>1000000,fetchImpl:redirect}),/SESSION/);
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const provider=createServiceTokenProvider({credentials:{project_id:FB,client_email:`training@${FB}.iam.gserviceaccount.com`,private_key:privateKey.export({type:'pkcs8',format:'pem'})},fetchImpl:redirect});
 await assert.rejects(provider(),/AUTH_UNAVAILABLE/);
 const store=createFirestoreStore({getAccessToken:async()=> 'synthetic',fetchImpl:redirect});
 await assert.rejects(store.get('users','synthetic'),/STORE_UNAVAILABLE/);
});
