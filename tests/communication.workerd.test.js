import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {generateKeyPairSync} from 'node:crypto';
import {encodeFields,decodeFields} from '../worker-communication/store.js';
import {FF,ADMINS} from '../communication/domain.js';
const require=createRequire(import.meta.resolve('wrangler/package.json'));
const {build}=require('esbuild'),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
test('actual Worker runtime: FF-only Auth, zero-billing check, FF-only persistence, individual push and denial',async()=>{
 const data=new Map(),writes=[],pushes=[],requests=[];let disabledFf=false;
 const roots={FA:'projects/sahmt-17a16/databases/(default)/documents',FF:`projects/${FF.projectId}/databases/${FF.databaseId}/documents`};
 const people=[{fa:'fa-admin',ff:'ff-admin',email:ADMINS[0],google:'google-admin'},{fa:'fa-person',ff:'ff-person',email:'person@example.test',google:'google-person'}];
 for(const p of people)data.set(roots.FF+'/users/'+p.fa,{uid:p.fa,email:p.email,active:true,access:true,role:'gestor'});
 data.set(roots.FF+'/communicationSettings/main',{pushEnabled:false});
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const credentials={project_id:FF.projectId,client_email:`communication-worker@${FF.projectId}.iam.gserviceaccount.com`,private_key:privateKey.export({type:'pkcs8',format:'pem'})};
 const token=(p,project,uid)=>{const now=Math.floor(Date.now()/1000);return Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:project,iss:'https://securetoken.google.com/'+project,sub:uid,email:p.email,email_verified:true,iat:now,auth_time:now,exp:now+3600,firebase:{sign_in_provider:'google.com',identities:{'google.com':[p.google]}}})).toString('base64url')+'.'+Buffer.alloc(256).toString('base64url');};
 const bundle=await build({entryPoints:['worker-communication/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*']});
 // The pinned local workerd binary supports dates through 2026-10-13; production retains its own date.
 const mf=new Miniflare(convertV4MiniflareOptions({name:'communication-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat'],bindings:{COMMUNICATION_ENABLED:'true',WORKERS_FREE_CONFIRMED:'true',FF_SERVICE_ACCOUNT_JSON:JSON.stringify(credentials)},outboundService:async request=>{
  const u=new URL(request.url);requests.push(u.hostname+u.pathname);assert.ok(!u.pathname.includes('sahmt-17a16'),'ordinary FF calls never reach FA');
  if(u.hostname==='identitytoolkit.googleapis.com'){
   const body=await request.json();let p,uid;
   if(body.idToken){const c=JSON.parse(Buffer.from(body.idToken.split('.')[1],'base64url'));p=people.find(p=>p.email===c.email);uid=c.sub;}else{const station=u.pathname.includes('/projects/sahmt-17a16/')?'fa':'ff';p=people.find(p=>p[station]===body.localId[0]);uid=p?.[station];}
   return Response.json({users:p?[{localId:uid,email:p.email,emailVerified:true,disabled:disabledFf&&uid===people[1].ff,validSince:'0',providerUserInfo:[{providerId:'google.com',rawId:p.google}]}]:[]});
  }
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-service',expires_in:3600});
  if(u.hostname==='cloudbilling.googleapis.com')return Response.json({billingEnabled:false});
  if(u.hostname==='fcm.googleapis.com'){pushes.push(await request.json());return Response.json({name:`projects/${FF.projectId}/messages/synthetic`});}
  assert.equal(u.hostname,'firestore.googleapis.com');
  if(u.pathname.endsWith('/runtimePolicy/folders')){const value=data.get(roots.FF+'/runtimePolicy/folders');return value?Response.json({fields:encodeFields(value)}):new Response('',{status:404});}
  if(!u.pathname.includes('/documents'))return Response.json({name:`projects/${FF.projectId}/databases/${FF.databaseId}`,freeTier:true});
  if(u.pathname.endsWith(':beginTransaction'))return Response.json({transaction:'synthetic-transaction'});
  if(u.pathname.endsWith(':rollback'))return Response.json({});
  if(u.pathname.endsWith(':commit')){const payload=await request.json();for(const w of payload.writes){assert.ok(w.update.name.startsWith(roots.FF+'/'));writes.push(w.update.name);data.set(w.update.name,decodeFields(w.update.fields));}return Response.json({commitTime:new Date().toISOString()});}
  const root=decodeURIComponent(u.pathname.slice(4).split('/documents')[0]+'/documents');
  if(u.pathname.endsWith(':runAggregationQuery')){
   const {structuredAggregationQuery:q}=await request.json(),filters=q.structuredQuery.where.compositeFilter.filters;
   const start=decodeFields({v:filters[0].fieldFilter.value}).v,end=decodeFields({v:filters[1].fieldFilter.value}).v;
   const count=[...data].filter(([key,v])=>key.startsWith(root+'/communicationMessages/')&&v.firstPublishedAt>=start&&v.firstPublishedAt<end).length;
   return Response.json([{result:{aggregateFields:{published:{integerValue:String(count)}}}}]);
  }
  if(u.pathname.endsWith(':runQuery')){
   const {structuredQuery:q}=await request.json(),clauses=q.where?.compositeFilter?.filters||(q.where?[q.where]:[]),cursor=q.startAt?.values?.[0]?.referenceValue||'';
   return Response.json([...data].filter(([key,v])=>key.startsWith(root+'/'+q.from[0].collectionId+'/')&&key>cursor&&clauses.every(({fieldFilter:f})=>v[f.field.fieldPath]===decodeFields({v:f.value}).v)).sort(([a],[b])=>a.localeCompare(b)).slice(0,q.limit).map(([name,value])=>({document:{name,fields:encodeFields(value)}})));
  }
  const key=decodeURIComponent(u.pathname.slice(4));return data.has(key)?Response.json({name:key,fields:encodeFields(data.get(key))}):Response.json({error:{status:'NOT_FOUND'}},{status:404});
 }}));
 const call=async(action,input={},p=people[0])=>{requests.length=0;const r=await mf.dispatchFetch('https://worker.test/v1/communication',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json',Authorization:'Bearer '+token(p,FF.projectId,p.ff)},body:JSON.stringify({action,input})});const body=await r.json();assert.ok(requests.length<=44,'Free subrequest cap');return {status:r.status,body};};
 try{
  {const denial=await call('DIRECTORY',{},people[1]);assert.equal(denial.status,403,JSON.stringify(denial));}
  const device='synthetic-device-'+'x'.repeat(60);assert.equal((await call('REGISTER_DEVICE',{token:device},people[1])).status,200);
  const saved=await call('SAVE_MESSAGE',{version:0,message:{title:'Synthetic',message:'Never on lock screen',category:'COMUNICADO GERAL',priority:'NORMAL',audienceType:'USER',audienceValue:'fa-person',route:'management',status:'published',publishAt:Date.now()-1000,expiresAt:Date.now()+86400000}});assert.equal(saved.status,200,JSON.stringify(saved));const id=saved.body.message.id;
  data.set(roots.FF+'/communicationSettings/main',{pushEnabled:true});assert.equal((await call('PREPARE',{id})).status,200);assert.equal(pushes.length,0);
  data.set(roots.FF+'/runtimePolicy/folders',{schemaVersion:1,revision:1,disabled:['comunicacao']});
  const writesBeforePause=writes.length;
  const paused=await call('SEND_BATCH',{id,batches:0,confirmed:true});assert.equal(paused.status,403);assert.equal(paused.body.code,'COMM_FOLDER_DISABLED');assert.equal(pushes.length,0);assert.equal(writes.length,writesBeforePause);
  assert.equal((await call('BOOTSTRAP',{},people[1])).status,403);
  data.delete(roots.FF+'/runtimePolicy/folders');
  const sent=await call('SEND_BATCH',{id,batches:0,confirmed:true});assert.equal(sent.status,200,JSON.stringify(sent));assert.equal(sent.body.dispatch.accepted,1);assert.equal(pushes[0].message.token,device);assert.equal(pushes[0].message.data.route,'home');assert.equal(pushes[0].message.data.body,'Never on lock screen');
  assert.equal((await call('SEND_BATCH',{id,batches:0,confirmed:true})).status,409);assert.equal(pushes.length,1);assert.ok(writes.length>0);assert.ok(writes.every(p=>p.startsWith(roots.FF+'/')));
  data.set(roots.FF+'/communicationSettings/main',{pushEnabled:false});
  const next=await call('SAVE_MESSAGE',{version:0,message:{...saved.body.message,title:'Primary account disabled'}});assert.equal(next.status,200);
  data.set(roots.FF+'/communicationSettings/main',{pushEnabled:true});
  const nextId=next.body.message.id;await call('PREPARE',{id:nextId});disabledFf=true;
  const denied=await call('SEND_BATCH',{id:nextId,batches:0,confirmed:true});assert.equal(denied.status,200);assert.equal(denied.body.dispatch.accepted,0);assert.equal(denied.body.dispatch.skipped,1);assert.equal(pushes.length,1,'disabled FA Auth cannot receive through active FF Auth');
 }finally{await mf.dispose();}
});
