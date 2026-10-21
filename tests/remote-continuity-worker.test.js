import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {continuityRequestSignature} from '../worker-operational-channel/continuity.js';
const now=Date.parse('2026-10-20T15:00:00Z'),day='2026-10-20',origin='https://anestesiahmtforms.github.io',secret='synthetic-import-key-12345678901234567890';
const token='a'.repeat(150),otherToken='b'.repeat(150);
const profiles=['member-a','member-b'].map(uid=>({schemaVersion:1,uid,verifiedAt:now-3600000,profile:{uid,email:'fixture@example.invalid',displayName:uid,sigla:uid==='member-a'?'AA':'BB',role:'temporario',active:true,access:true,permissions:{scheduleRead:true,scheduleWrite:true,eventsRead:true,eventsWrite:true,labelsRead:true,labelsWrite:true,checklistRead:true,checklistWrite:true}}}));
const resource=(kind,id,data)=>({schemaVersion:1,kind,id,data,revision:'test-1',verifiedAt:now-3600000});
const snapshot={schemaVersion:1,profiles,resources:[resource('stations','all',[{id:'station1',name:'Arsenal sintético',active:true}]),resource('scheduleDays',day,{id:day,positions:[{position:1,sigla:'AA'}],version:1}),resource('checklists',day,{records:[],stationIds:['station1'],priorRecords:[]}),resource('events','2026-10',{records:[{id:'private-a',date:day,active:true,createdByUid:'member-a'},{id:'private-b',date:day,active:true,createdByUid:'member-b'}]})]};
const entry=`import {createOperationalChannelWorker} from './worker-operational-channel/worker.js';
export {OperationalChannelState,OperationalChannelAuthorization} from './worker-operational-channel/worker.js';
const worker=createOperationalChannelWorker({now:()=>${now},verifyIdentity:async token=>({uid:token.startsWith('a')?'member-a':'member-b'}),fetchImpl:async url=>{
if(url.endsWith('/checklists/confirmed-operation')){
const encode=value=>value===null?{nullValue:null}:typeof value==='boolean'?{booleanValue:value}:{stringValue:String(value)};
const data={id:'confirmed-operation',clientMutationId:'confirmed-operation',createdByUid:'member-a',date:'${day}',stationId:'station1',condition:'SIM',status:'COMPLETED',occurrence:'',responsibleUid:null,responsibleName:null,responsibleEmail:null};
return Response.json({name:'projects/sahmt-17a16/databases/(default)/documents/checklists/confirmed-operation',fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,encode(value)]))});}
throw Error('FIRESTORE_FORBIDDEN_IN_THIS_TEST');}});
export default {fetch(request,env){let fail=request.headers.get('X-Fixture-Journal-Failure')==='yes';const binding=env.OPERATIONAL_CHANNEL_AUTHORIZATION;return worker.fetch(request,{...env,OPERATIONAL_CHANNEL_AUTHORIZATION:{idFromName:name=>binding.idFromName(name),get:id=>{const stub=binding.get(id);return {fetch:incoming=>{if(fail&&new URL(incoming.url).pathname==='/continuity-journal-put'){fail=false;return Response.json({code:'CONTINUITY_JOURNAL_UNAVAILABLE'},{status:503});}return stub.fetch(incoming);}};}}});}};`;
test('SQLite recupera perfil/dados/fila sem Firestore e não permite importações ou acessos divergentes',async()=>{
 const bundle=await build({stdin:{contents:entry,resolveDir:resolve('.')},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',tsconfigRaw:{}});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'continuity',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-06',durableObjects:{OPERATIONAL_CHANNEL_STATE:{className:'OperationalChannelState',useSQLite:true},OPERATIONAL_CHANNEL_AUTHORIZATION:{className:'OperationalChannelAuthorization',useSQLite:true}},bindings:{OPERATIONAL_CHANNEL_ENABLED:'true',OPERATIONAL_CONTINUITY_ENABLED:'true',CONTINUITY_IMPORT_SECRET:secret},outboundService:async()=>assert.fail('No external calls')}));
 try{
  const send=async(body,as=token,extraHeaders={})=>{const response=await mf.dispatchFetch('https://channel.invalid/v1/operational-channel',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+as,'Content-Type':'application/json',...extraHeaders},body:JSON.stringify(body)});return {status:response.status,...await response.json()};};
  let nonce=0;
  const install=async body=>{const text=JSON.stringify(body),requestNonce='synthetic-nonce-'+String(++nonce).padStart(15,'0'),signature=await continuityRequestSignature(secret,text,String(now),requestNonce);const response=await mf.dispatchFetch('https://channel.invalid/v1/operational-continuity/import',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Continuity-Time':String(now),'X-Continuity-Nonce':requestNonce,'X-Continuity-Signature':signature},body:text});return {status:response.status,...await response.json()};};
  assert.equal((await send({action:'bootstrap',day})).code,'CONTINUITY_PROFILE_MISSING');
  const imported=await install(snapshot);assert.equal(imported.code,'CONTINUITY_IMPORTED');assert.equal(imported.profiles,2);
  const boot=await send({action:'bootstrap',day});assert.equal(boot.code,'CONTINUITY_READY');assert.equal(boot.profile.uid,'member-a');assert.equal(boot.profileVerifiedAt,snapshot.profiles[0].verifiedAt);
  const eventRows=boot.entries.find(e=>e.kind==='events'&&e.id===`report:${day}:${day}:AA:100`).data.records;
  assert.deepEqual(eventRows.map(row=>row.id),['private-a']);assert.ok(boot.entries.some(e=>e.kind==='stations'));
  const submission={action:'submit',collection:'checklists',day,requestId:'stable-operation',data:{date:day,stationId:'station1',condition:'SIM',status:'COMPLETED',occurrence:'',responsibleUid:null,responsibleName:null,responsibleEmail:null}};
  assert.equal((await send(submission,token,{'X-Fixture-Journal-Failure':'yes'})).code,'CONTINUITY_JOURNAL_UNAVAILABLE');
  assert.equal((await send(submission)).code,'CHANNEL_ALREADY_SHARED');assert.equal((await send(submission)).code,'CHANNEL_ALREADY_SHARED');
  const recovered=await send({action:'bootstrap',day});assert.equal(recovered.operations.length,1);assert.equal(recovered.operations[0].requestId,submission.requestId);assert.equal(recovered.operations[0].uid,'member-a');
  const drain=await install({schemaVersion:1,action:'drain'});assert.equal(drain.code,'CONTINUITY_DRAIN');assert.equal(drain.operations[0].requestId,submission.requestId);
  const other=await send({action:'bootstrap',day},otherToken);assert.equal(other.operations.length,0);
  const changed=await send({...submission,data:{...submission.data,condition:'NAO',status:'MAINTENANCE',occurrence:'Divergência'}});assert.equal(changed.status,409);
  assert.equal((await send({action:'ack',collection:'checklists',day,requestId:submission.requestId})).code,'CHANNEL_CONFIRMATION_PENDING');
  assert.equal((await send({action:'bootstrap',day})).operations.length,1);
  assert.equal((await send({action:'withdraw',collection:'checklists',day,requestId:submission.requestId})).code,'CHANNEL_WITHDRAWN');
  assert.equal((await send({action:'bootstrap',day})).operations.length,0);
  assert.equal((await install({schemaVersion:1,action:'drain'})).operations.length,0);
  assert.equal((await send({...submission,requestId:'confirmed-operation'})).code,'CHANNEL_SHARED');
  assert.equal((await send({action:'ack',collection:'checklists',day,requestId:'confirmed-operation'})).code,'CHANNEL_CONFIRMED');
  const afterAck=await send({action:'bootstrap',day});assert.equal(afterAck.operations.length,0);
  assert.equal(afterAck.entries.find(e=>e.kind==='checklists'&&e.id===day).data.records[0]?.id,'confirmed-operation');
  const release=(id,marked,time)=>({action:'submit',collection:'scheduleReleases',day,requestId:id,data:{day,sigla:'AA',marked,groupSiglas:['AA'],tokenSigla:'AA',occurredAt:time}});
  assert.equal((await send(release('release-old',true,now-1000))).code,'CHANNEL_SHARED');
  assert.equal((await send(release('release-new',false,now))).code,'CHANNEL_SHARED');
  assert.deepEqual((await send({action:'bootstrap',day})).operations.map(row=>row.requestId),['release-new']);
  const disabled={...profiles[0],verifiedAt:now,profile:{...profiles[0].profile,active:false}};
  assert.equal((await install({schemaVersion:1,profiles:[disabled],resources:[]})).code,'CONTINUITY_IMPORTED');
  assert.equal((await send({action:'bootstrap',day})).code,'CONTINUITY_ACCESS_DENIED');
  assert.equal((await send({...submission,requestId:'after-revocation'})).status,403);
  await install({schemaVersion:1,profiles:[profiles[0]],resources:[]});assert.equal((await send({action:'bootstrap',day})).code,'CONTINUITY_ACCESS_DENIED');
  const bad=await mf.dispatchFetch('https://channel.invalid/v1/operational-continuity/import',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Continuity-Time':String(now),'X-Continuity-Nonce':'synthetic-invalid-nonce-0000000000','X-Continuity-Signature':'0'.repeat(64)},body:JSON.stringify(snapshot)});assert.equal(bad.status,401);
 }finally{await mf.dispose();}
});
