import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {encodeFields} from '../worker-training/firestore.js';

test('production training bundle authenticates and reads its catalog in workerd',{timeout:60000},async()=>{
 const project='sahmt-gestao-5ae66',uid='runtime-admin',email='admin@example.invalid';
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const credentials={project_id:project,client_email:`runtime@${project}.iam.gserviceaccount.com`,private_key:privateKey.export({type:'pkcs8',format:'pem'})};
 const now=Math.floor(Date.now()/1000);
 const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:project,iss:`https://securetoken.google.com/${project}`,sub:uid,email,email_verified:true,iat:now,auth_time:now,exp:now+3600,firebase:{sign_in_provider:'google.com'}})).toString('base64url')+'.'+Buffer.alloc(256).toString('base64url');
 const root=`projects/${project}/databases/(default)/documents`;
 const training={id:'draft',title:'Runtime draft',category:'Protocols',audienceGroup:'GENERAL',managerUid:'',status:'DRAFT',version:1,sectionCount:1,maxScore:5};
 const calls=[];
 const bundle=await build({entryPoints:['worker-training/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*']});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'training',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat'],
  bindings:{HTML_TRAINING_ENABLED:'true',FB_WEB_API_KEY:'synthetic-key',FB_TRAINING_SERVICE_ACCOUNT_JSON:JSON.stringify(credentials)},
  outboundService:async request=>{
   const url=new URL(request.url),body=request.headers.get('Content-Type')?.includes('application/json')?await request.json():null;
   calls.push(url.hostname+url.pathname);
   if(url.hostname==='identitytoolkit.googleapis.com')return Response.json({users:[{localId:uid,email,emailVerified:true,validSince:'0'}]});
   if(url.hostname==='oauth2.googleapis.com'){
    const assertion=new URLSearchParams(await request.text()).get('assertion');
    const parts=assertion.split('.');assert.equal(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')),true);
    return Response.json({access_token:'synthetic-service-token',expires_in:3600});
   }
   assert.equal(url.hostname,'firestore.googleapis.com');assert.equal(request.headers.get('Authorization'),'Bearer synthetic-service-token');
   if(url.pathname.endsWith(':beginTransaction'))return Response.json({transaction:'runtime-transaction'});
   if(url.pathname.endsWith(':rollback'))return Response.json({});
   if(url.pathname.endsWith('/users/'+uid))return Response.json({name:root+'/users/'+uid,fields:encodeFields({uid,active:true,access:true,role:'administrador_app'})});
   if(url.pathname.endsWith('/htmlTrainingSettings/folders'))return Response.json({error:{status:'NOT_FOUND'}},{status:404});
   if(url.pathname.includes('/documentAccessEmails/'))return Response.json({error:{status:'NOT_FOUND'}},{status:404});
   if(url.pathname.endsWith(':runQuery'))return Response.json([{document:{name:root+'/htmlTrainings/draft',fields:encodeFields(training)}}]);
   if(url.pathname.endsWith(':batchGet'))return Response.json(body.documents.map(name=>({found:{name,fields:encodeFields(training)}})));
   assert.fail('Unexpected outbound path: '+url.pathname);
  }}));
 try{
  const response=await mf.dispatchFetch('https://training.test/v1/training',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'LIST',input:{}})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.trainings[0].title,'Runtime draft');
  assert.ok(calls.some(path=>path.endsWith(':runQuery')));assert.equal(calls.some(path=>path.endsWith(':commit')),false);
 }finally{await mf.dispose();}
});
