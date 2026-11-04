import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createCommunicationWorker} from '../worker-communication/worker.js';
import {encodeFields,decodeFields} from '../worker-communication/store.js';

test('fila entrega a todos os aparelhos mantendo cada execução dentro do orçamento gratuito',async()=>{
 const configuration=JSON.parse(readFileSync(new URL('../worker-communication/wrangler.jsonc',import.meta.url),'utf8'));
 const batchSize=configuration.queues.consumers[0].max_batch_size;
 const now=Date.now(),documents=new Map(),accepted=[];
 const root='projects/sahmt-comunicacao-ff/databases/comunicacao/documents/';
 const put=(key,value)=>documents.set(root+key,structuredClone(value));
 const notice={id:'release-test',status:'published',title:'LIBERAÇÃO',message:'Você está Liberado!',category:'INFORMAÇÃO INSTITUCIONAL',audienceType:'USER',audienceValue:'fa-rl',publishAt:now-1000,expiresAt:now+86400000,version:1};
 put('communicationMessages/release-test',notice);
 put('communicationSettings/main',{pushEnabled:true});
 put('communicationDispatches/release-test',{id:'release-test',automatic:true,status:'processing',version:1,pendingCount:3,processed:0,accepted:0,failed:0,skipped:0,unknown:0});
 documents.set('projects/sahmt-17a16/databases/(default)/documents/users/fa-rl',{uid:'fa-rl',email:'rl@example.test',active:true,access:true});
 const messages=[];
 for(let i=0;i<3;i++){put('communicationDevices/device-'+i,{uid:'ff-rl',sourceUid:'fa-rl',email:'rl@example.test',googleUid:'google-rl',active:true,updatedAt:now,token:'test-token-'+i});messages.push({body:{kind:'device',dispatchId:'release-test',deviceId:'device-'+i}});}
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const env={COMMUNICATION_ENABLED:'true',WORKERS_FREE_CONFIRMED:'true',FF_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'sahmt-comunicacao-ff',client_email:'communication-worker@sahmt-comunicacao-ff.iam.gserviceaccount.com',private_key:privateKey}),COMMUNICATION_PUSH_QUEUE:{send:async()=>{},sendBatch:async()=>{}}};
 const previousFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,options={})=>{
  calls++;const url=new URL(input),body=options.body&&typeof options.body==='string'?JSON.parse(options.body):null;
  if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-service-token'});
  if(url.hostname==='cloudbilling.googleapis.com')return Response.json({billingEnabled:false});
  if(url.hostname==='identitytoolkit.googleapis.com')return Response.json({users:[{localId:body.localId[0],email:'rl@example.test',emailVerified:true,providerUserInfo:[{providerId:'google.com',rawId:'google-rl'}]}]});
  if(url.hostname==='fcm.googleapis.com'){accepted.push(body.message.token);return Response.json({name:'synthetic-fcm-result'});}
  assert.equal(url.hostname,'firestore.googleapis.com');
  const path=decodeURIComponent(url.pathname).slice('/v1/'.length);
  if(!path.includes('/documents'))return Response.json({name:'projects/sahmt-comunicacao-ff/databases/comunicacao',freeTier:true});
  if(path.endsWith(':beginTransaction'))return Response.json({transaction:'synthetic-transaction'});
  if(path.endsWith(':rollback'))return Response.json({});
  if(path.endsWith(':commit')){for(const write of body.writes||[])documents.set(write.update.name,decodeFields(write.update.fields));return Response.json({writeResults:[]});}
  if(path.endsWith(':runQuery')){
   const q=body.structuredQuery,clauses=q.where?.compositeFilter?.filters||(q.where?[q.where]:[]),cursor=q.startAt?.values?.[0]?.referenceValue||'',collection=root+q.from[0].collectionId+'/';
   return Response.json([...documents].filter(([key,value])=>key.startsWith(collection)&&key>cursor&&clauses.every(({fieldFilter:f})=>value[f.field.fieldPath]===decodeFields({v:f.value}).v)).sort(([a],[b])=>a.localeCompare(b)).slice(0,q.limit).map(([name,value])=>({document:{name,fields:encodeFields(value)}})));
  }
  const value=documents.get(path);return value?Response.json({name:path,fields:encodeFields(value)}):Response.json({error:{status:'NOT_FOUND'}},{status:404});
 };
 try{
  const worker=createCommunicationWorker();
  for(let offset=0;offset<messages.length;offset+=batchSize){
   calls=0;const acked=[],retried=[];
   const batch=messages.slice(offset,offset+batchSize).map((message,index)=>({...message,ack:()=>acked.push(index),retry:()=>retried.push(index)}));
   await worker.queue({messages:batch},env);
   assert.deepEqual(retried,[],'cada aparelho deve concluir sem retry por estouro do orçamento');assert.equal(acked.length,batch.length);assert.ok(calls<=44);
  }
  assert.deepEqual(accepted,['test-token-0','test-token-1','test-token-2']);
  const dispatch=documents.get(root+'communicationDispatches/release-test');assert.equal(dispatch.status,'completed');assert.equal(dispatch.accepted,3);assert.equal(dispatch.pendingCount,0);
  // Exercise the complete producer/consumer pipeline across multiple pages, not only prequeued devices.
  for(let i=3;i<7;i++)put('communicationDevices/device-'+i,{uid:'ff-rl',sourceUid:'fa-rl',email:'rl@example.test',googleUid:'google-rl',active:true,updatedAt:now,token:'test-token-'+i});
  put('communicationMessages/urgent-fanout',{...notice,id:'urgent-fanout',audienceType:'ALL',audienceValue:''});
  put('communicationDispatches/urgent-fanout',{id:'urgent-fanout',automatic:true,status:'queueing',version:1,pendingCount:1,processed:0,accepted:0,failed:0,skipped:0,unknown:0});
  const waiting=[{kind:'fanout',dispatchId:'urgent-fanout',cursor:''}],retryDelays=[];
  env.COMMUNICATION_PUSH_QUEUE.sendBatch=async batch=>waiting.push(...batch.map(item=>item.body));
  while(waiting.length){
   calls=0;let acked=false;
   await worker.queue({messages:[{body:waiting.shift(),ack:()=>acked=true,retry:options=>retryDelays.push(options)}]},env);
   assert.equal(acked,true,'o envio não deve aguardar o término de todas as páginas');assert.ok(calls<=44,'cada produtor e consumidor respeita o orçamento externo');
  }
  assert.deepEqual(retryDelays,[]);
  const complete=documents.get(root+'communicationDispatches/urgent-fanout');assert.equal(complete.status,'completed');assert.equal(complete.accepted,7);assert.equal(complete.processed,7);assert.equal(complete.pendingCount,0);
  assert.deepEqual(accepted.slice(3),Array.from({length:7},(_,i)=>'test-token-'+i));
 }finally{globalThis.fetch=previousFetch;}
});

test('repetição da fila aguarda 30 segundos sem consumir todas as tentativas imediatamente',async()=>{
 const attempts=[],worker=createCommunicationWorker({buildService:()=>({consumePush:async()=>{throw Object.assign(Error('synthetic contention'),{code:'COMM_QUEUE_RETRY'});}})});
 await worker.queue({messages:[{body:{},ack:()=>assert.fail('não deve confirmar falha'),retry:options=>attempts.push(options)}]},{COMMUNICATION_ENABLED:'true',WORKERS_FREE_CONFIRMED:'true'});
 assert.deepEqual(attempts,[{delaySeconds:30}]);
});
