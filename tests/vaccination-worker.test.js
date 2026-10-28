import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createTrainingWorker} from '../worker-training/worker.js';
import {encodeFields,decodeFields} from '../worker-training/firestore.js';

const origin='https://anestesiahmtforms.github.io';
const body=(action='BOOTSTRAP',input={year:2026})=>JSON.stringify({action,input});
const request=(path='/v1/vaccination',data=body(),options={})=>new Request(`https://worker.test${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:data,...options});
function fixture(){const calls=[];const factory=kind=>env=>({execute:async(action,input,identity)=>{calls.push({kind,action,input,identity,env});return{kind};}});const worker=createTrainingWorker({verifyIdentity:async(auth,options)=>{assert.equal(auth,'Bearer synthetic');assert.equal(options.apiKey,'synthetic-key');return{uid:'synthetic'};},buildService:factory('training'),buildVaccinationService:factory('vaccination'),buildDocumentService:factory('documents')});return{worker,calls,env:{FB_WEB_API_KEY:'synthetic-key',VACCINATION_ENABLED:'true',HTML_TRAINING_ENABLED:'true'}};}
test('routes preserve original injected training service and separate vaccination/documents factories',async()=>{
  const h=fixture();for(const [path,kind,action]of [['/v1/training','training','LIST'],['/v1/vaccination','vaccination','BOOTSTRAP'],['/v1/professional-documents','documents','LIST_OWN']]){
    const response=await h.worker.fetch(request(path,body(action)),h.env);assert.equal(response.status,200);assert.equal((await response.json()).kind,kind);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  }assert.deepEqual(h.calls.map(c=>c.kind),['training','vaccination','documents']);
});
test('independent flags default off; document listing works while upload is disabled',async()=>{
  const h=fixture(),env={FB_WEB_API_KEY:'synthetic-key'};
  assert.equal((await h.worker.fetch(request(),env)).status,503);assert.equal((await h.worker.fetch(request('/v1/training'),env)).status,503);
  for(const action of ['LIST_OWN','LIST_ADMIN'])assert.equal((await h.worker.fetch(request('/v1/professional-documents',body(action)),env)).status,200);
  assert.equal((await h.worker.fetch(request('/v1/professional-documents',body('UPLOAD')),env)).status,503);
  assert.equal((await h.worker.fetch(request('/v1/professional-documents',body('UPLOAD')),{...env,DOCUMENT_UPLOADS_ENABLED:'true'})).status,200);
  assert.equal((await h.worker.fetch(request(),{...env,VACCINATION_ENABLED:true})).status,503);
});
test('origin, method, preflight and route controls apply to every route before execution',async()=>{
  const h=fixture();for(const path of ['/v1/training','/v1/vaccination','/v1/professional-documents']){
    for(const bad of ['https://evil.invalid','null','https://anestesiahmtforms.github.io.evil.invalid']){const r=await h.worker.fetch(request(path,body(),{headers:{Origin:bad}}),h.env);assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);}
    assert.equal((await h.worker.fetch(request(path,null,{method:'GET'}),h.env)).status,405);
    const options=await h.worker.fetch(request(path,null,{method:'OPTIONS'}),{});assert.equal(options.status,204);assert.equal(options.headers.get('Access-Control-Allow-Methods'),'POST, OPTIONS');assert.match(options.headers.get('Access-Control-Allow-Headers'),/Authorization/);
  }assert.equal((await h.worker.fetch(request('/v1/other'),h.env)).status,404);assert.equal(h.calls.length,0);
});
test('all routes accept only exact action/input envelope and JSON content type',async()=>{
  const h=fixture();for(const path of ['/v1/training','/v1/vaccination','/v1/professional-documents']){
    for(const input of ['null','[]','{}','not json',JSON.stringify({action:'LIST',input:{},projectId:'other'}),JSON.stringify({action:3,input:{}}),JSON.stringify({action:'LIST',input:[]})])assert.equal((await h.worker.fetch(request(path,input),h.env)).status,400);
    assert.equal((await h.worker.fetch(request(path,body(),{headers:{Origin:origin,'Content-Type':'text/plain'}}),h.env)).status,400);
  }assert.equal(h.calls.length,0);
});
test('body limits enforce declared and streamed sizes without authenticating or running services',async()=>{
  let auth=0;const worker=createTrainingWorker({verifyIdentity:async()=>{auth++;throw Error('not reached');}}),env={VACCINATION_ENABLED:'true',HTML_TRAINING_ENABLED:'true'};
  for(const [path,max]of [['/v1/vaccination',16*1024],['/v1/professional-documents',8*1024*1024],['/v1/training',8*1024*1024]]){
    const declared=request(path,'{}',{headers:{Origin:origin,'Content-Type':'application/json','Content-Length':String(max+1)}});assert.equal((await worker.fetch(declared,env)).status,413);
    let canceled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(max));controller.enqueue(new Uint8Array(1));},cancel(){canceled=true;}});
    const streamed=request(path,stream,{duplex:'half'});assert.equal((await worker.fetch(streamed,env)).status,413);assert.equal(canceled,true);
  }assert.equal(auth,0);
});
test('service/auth failures expose only safe domain codes and controlled status',async()=>{
  for(const [path,code]of [['/v1/vaccination','VAC_FORBIDDEN'],['/v1/professional-documents','DOCUMENT_FORBIDDEN'],['/v1/training','FORBIDDEN']]){
    const buildService=()=>({execute:async()=>{throw Object.assign(Error('private server details'),{code,status:403});}});
    const worker=createTrainingWorker({verifyIdentity:async()=>({uid:'u'}),buildService,buildVaccinationService:buildService,buildDocumentService:buildService});
    const response=await worker.fetch(request(path),{VACCINATION_ENABLED:'true',HTML_TRAINING_ENABLED:'true'});assert.equal(response.status,403);assert.deepEqual(await response.json(),{code});
  }
  for(const thrown of [Object.assign(Error('private'),{code:'OAuth secret private',status:500}),Object.assign(Error('private'),{code:'PRIVATE_SECRET_VALUE',status:200}),Error('secret')]){
    const worker=createTrainingWorker({verifyIdentity:async()=>{throw thrown;}});const response=await worker.fetch(request(),{VACCINATION_ENABLED:'true'});assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'VAC_UNAVAILABLE'});
  }
});

test('real workerd routes keep own records private, admin reports protected and document lists usable without OAuth',{timeout:60000},async()=>{
  const project='sahmt-gestao-5ae66',root=`projects/${project}/databases/(default)/documents`,data=new Map(),calls=[];
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),credentials={project_id:project,client_email:`runtime@${project}.iam.gserviceaccount.com`,private_key:privateKey.export({type:'pkcs8',format:'pem'})};
  for(const uid of ['one','two','admin'])data.set('userCategories/'+createHash('sha256').update(JSON.stringify(`${uid}@example.invalid`)).digest('hex'),{schemaVersion:1,identityStatus:'LINKED',uid,email:`${uid}@example.invalid`,memberCategories:['EFETIVO']});
  for(const uid of ['one','two','admin'])data.set(`users/${uid}`,{uid,email:`${uid}@example.invalid`,displayName:`Synthetic ${uid}`,active:true,access:true,role:uid==='admin'?'administrador_app':'colaborador'});
  const token=uid=>{const now=Math.floor(Date.now()/1000);return Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:project,iss:`https://securetoken.google.com/${project}`,sub:uid,email:`${uid}@example.invalid`,email_verified:true,iat:now,auth_time:now,exp:now+3600,firebase:{sign_in_provider:'google.com'}})).toString('base64url')+'.'+Buffer.alloc(256).toString('base64url');};
  const bundle=await build({entryPoints:['worker-training/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*']});
  const mf=new Miniflare(convertV4MiniflareOptions({name:'vaccination',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat'],bindings:{VACCINATION_ENABLED:'true',HTML_TRAINING_ENABLED:'true',DOCUMENT_UPLOADS_ENABLED:'true',PROFESSIONAL_DRIVE_OAUTH_JSON:'invalid-json-do-not-parse-for-records',FB_WEB_API_KEY:'synthetic-key',FB_TRAINING_SERVICE_ACCOUNT_JSON:JSON.stringify(credentials)},outboundService:async request=>{
    const url=new URL(request.url);calls.push(url.hostname+url.pathname);
    if(url.hostname==='identitytoolkit.googleapis.com'){const value=await request.json(),claims=JSON.parse(Buffer.from(value.idToken.split('.')[1],'base64url'));return Response.json({users:[{localId:claims.sub,email:claims.email,emailVerified:true,validSince:'0'}]});}
    if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-service-token',expires_in:3600});
    assert.equal(url.hostname,'firestore.googleapis.com');
    if(url.pathname.endsWith(':beginTransaction'))return Response.json({transaction:'synthetic-tx'});
    if(url.pathname.endsWith(':rollback'))return Response.json({});
    if(url.pathname.endsWith(':commit')){const payload=await request.json();for(const write of payload.writes)data.set(write.update.name.slice(root.length+1),decodeFields(write.update.fields));return Response.json({commitTime:'now'});}
    if(url.pathname.endsWith(':runQuery')){const {structuredQuery:q}=await request.json(),collection=q.from[0].collectionId,clauses=q.where?.compositeFilter?.filters||(q.where?[q.where]:[]);return Response.json([...data].filter(([key,value])=>key.startsWith(collection+'/')&&clauses.every(({fieldFilter:f})=>value[f.field.fieldPath]===decodeFields({v:f.value}).v)).map(([key,value])=>({document:{name:`${root}/${key}`,fields:encodeFields(value)}})));}
    const key=decodeURIComponent(url.pathname.split('/documents/')[1]||'');return data.has(key)?Response.json({name:`${root}/${key}`,fields:encodeFields(data.get(key))}):Response.json({error:{status:'NOT_FOUND'}},{status:404});
  }}));
  const call=async(path,action,input,uid='one')=>{const response=await mf.dispatchFetch(`https://worker.test${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token(uid)},body:body(action,input)});return{status:response.status,result:await response.json()};};
  try{
    const input={year:2026,category:'Equipe',awareness:false,truth:true,states:{hepatitisB:'UNKNOWN',tetanus:'PENDING',mmr:'UPDATED',influenza:'NOT_ADHERED'},declaration:'WILL_UPDATE',notes:'Synthetic only',expectedVersion:0};
    const saved=await call('/v1/vaccination','SAVE',input);assert.equal(saved.status,200,JSON.stringify(saved.result));assert.equal(saved.result.record.uid,'one');assert.equal(saved.result.record.version,1);
    assert.equal((await call('/v1/vaccination','BOOTSTRAP',{year:2026},'two')).result.record,null);
    assert.equal((await call('/v1/vaccination','REPORT',{year:2026})).status,403);
    const report=await call('/v1/vaccination','REPORT',{year:2026},'admin');assert.equal(report.status,200);assert.equal(report.result.records.length,1);
    const docs=await call('/v1/professional-documents','LIST_OWN',{context:'VACCINATION',year:2026});assert.equal(docs.status,200,JSON.stringify(docs.result));assert.equal(docs.result.uploadsEnabled,false);assert.deepEqual(docs.result.documents,[]);
    assert.equal((await call('/v1/professional-documents','LIST_ADMIN',{context:'VACCINATION',year:2026})).status,403);
    const training=await call('/v1/training','LIST',{},'admin');assert.equal(training.status,200,JSON.stringify(training.result));assert.deepEqual(training.result.trainings,[]);
    assert.equal(calls.some(path=>path.startsWith('www.googleapis.com')||path.includes('userinfo')),false);
  }finally{await mf.dispose();}
});
