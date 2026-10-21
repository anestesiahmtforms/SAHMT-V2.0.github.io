import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {continuityRequestSignature} from '../worker-operational-channel/continuity.js';
import {channelDay} from '../src/provisional-channel-contract.js';
const origin='https://anestesiahmtforms.github.io',secret='synthetic-realtime-secret-12345678901234567890';
const token='a'.repeat(150),otherToken='b'.repeat(150);
const entry=`import {createOperationalChannelWorker} from './worker-operational-channel/worker.js';
import {issueRealtimeTicket} from './worker-operational-channel/realtime.js';
export {OperationalChannelState,OperationalChannelAuthorization} from './worker-operational-channel/worker.js';
let identityChecks=0,firestoreReads=0,proof=null,notifications=[];
const encode=value=>value===null?{nullValue:null}:typeof value==='boolean'?{booleanValue:value}:typeof value==='number'?{integerValue:String(value)}:Array.isArray(value)?{arrayValue:{values:value.map(encode)}}:typeof value==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)]))}}:{stringValue:value};
const worker=createOperationalChannelWorker({verifyIdentity:async value=>{identityChecks++;return {uid:value.startsWith('a')?'member-a':'member-b'};},fetchImpl:async url=>{firestoreReads++;if(!proof||!url.endsWith('/'+proof.path))throw Error('UNEXPECTED_FIRESTORE_READ');return Response.json({name:'projects/sahmt-17a16/databases/(default)/documents/'+proof.path,fields:Object.fromEntries(Object.entries(proof.data).map(([key,value])=>[key,encode(value)]))});}});
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==='/fixture'){
  const body=await request.json();
  if(body.action==='stats')return Response.json({identityChecks,firestoreReads,notifications});
  if(body.action==='proof'){proof=body.proof;return Response.json({ok:true});}
  if(body.action==='ticket')return Response.json(await issueRealtimeTicket(env,body.actor,body.now));
 }
 {
  const binding=env.OPERATIONAL_CHANNEL_STATE;
  env={...env,OPERATIONAL_CHANNEL_STATE:{idFromName:name=>binding.idFromName(name),get:id=>({fetch:async incoming=>{const notifying=new URL(incoming.url).pathname==='/realtime-notify';if(notifying&&request.headers.get('X-Fixture-Notify-Failure')==='yes')throw Error('SYNTHETIC_NOTIFY_FAILURE');const r=await binding.get(id).fetch(incoming);if(notifying)notifications.push({status:r.status,...await r.clone().json()});return r;}})}};
 }
 return worker.fetch(request,env);
}};`;
function nextEvent(socket,type,predicate=()=>true){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.removeEventListener(type,listener);reject(Error('Timed out waiting for '+type));},4000);
  const listener=event=>{if(predicate(event)){clearTimeout(timer);socket.removeEventListener(type,listener);resolve(event);}};
  socket.addEventListener(type,listener);
 });
}
test('WebSocketPair de produção usa SQLite: escopo, tickets únicos, revogação, confirmação e zero reads nas notificações',async t=>{
 const bundle=await build({stdin:{contents:entry,resolveDir:resolve('.')},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',tsconfigRaw:{}});
 let outboundCalls=0;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'realtime',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-06',
  durableObjects:{OPERATIONAL_CHANNEL_STATE:{className:'OperationalChannelState',useSQLite:true},OPERATIONAL_CHANNEL_AUTHORIZATION:{className:'OperationalChannelAuthorization',useSQLite:true}},
  bindings:{OPERATIONAL_CHANNEL_ENABLED:'true',OPERATIONAL_CONTINUITY_ENABLED:'true',OPERATIONAL_CHANNEL_REALTIME_ENABLED:'true',CONTINUITY_IMPORT_SECRET:secret},
  outboundService:async()=>{outboundCalls++;assert.fail('No external traffic allowed');}}));
 const sockets=[];
 try{
  const day=channelDay(Date.now()),send=async(body,as=token,extra={})=>{const r=await mf.dispatchFetch('https://channel.invalid/v1/operational-channel',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+as,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
  const fixture=async body=>(await mf.dispatchFetch('https://channel.invalid/fixture',{method:'POST',body:JSON.stringify(body)})).json();
  const install=async body=>{const text=JSON.stringify(body),time=String(Date.now()),nonce=crypto.randomUUID().replaceAll('-',''),signature=await continuityRequestSignature(secret,text,time,nonce);const r=await mf.dispatchFetch('https://channel.invalid/v1/operational-continuity/import',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Continuity-Time':time,'X-Continuity-Nonce':nonce,'X-Continuity-Signature':signature},body:text});return {status:r.status,...await r.json()};};
  const upgrade=(ticket,extra={})=>mf.dispatchFetch('https://channel.invalid/v1/operational-channel/events',{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':'sahmt-channel-v1, '+ticket,...extra}});
  const connect=async(as=token)=>{const ticket=await send({action:'watch'},as);assert.equal(ticket.code,'CHANNEL_REALTIME_TICKET');const r=await upgrade(ticket.ticket);assert.equal(r.status,101);assert.equal(r.headers.get('Sec-WebSocket-Protocol'),'sahmt-channel-v1');const socket=r.webSocket;socket.accept();sockets.push(socket);await ping(socket);return {socket,ticket:ticket.ticket};};
  const ping=async socket=>{const response=nextEvent(socket,'message',event=>event.data==='pong');socket.send('ping');await response;};
  const profiles=['member-a','member-b'].map(uid=>({schemaVersion:1,uid,verifiedAt:Date.now()-1000,profile:{uid,displayName:uid,sigla:uid==='member-a'?'AA':'BB',role:'temporario',active:true,access:true,permissions:uid==='member-a'?{checklistRead:true,checklistWrite:true,scheduleRead:true}:{labelsRead:true}}}));
  assert.equal((await install({schemaVersion:1,profiles,resources:[]})).code,'CONTINUITY_IMPORTED');
  for(const as of [token,otherToken])assert.equal((await send({action:'bootstrap',day},as)).code,'CONTINUITY_READY');
  const a=await connect(),b=await connect(otherToken),aMessages=[],bMessages=[];
  a.socket.addEventListener('message',e=>{if(e.data!=='pong')aMessages.push(JSON.parse(e.data));});
  b.socket.addEventListener('message',e=>{if(e.data!=='pong')bMessages.push(JSON.parse(e.data));});
  await t.test('ticket tamper, replay, expiry and Origin are rejected without Firebase',async()=>{
   assert.equal((await upgrade(a.ticket)).status,403);
   assert.equal((await upgrade(a.ticket.slice(0,-1)+(a.ticket.endsWith('a')?'b':'a'))).status,403);
   assert.equal((await upgrade(a.ticket,{Origin:'https://untrusted.invalid'})).status,403);
   const now=Date.now(),expired=await fixture({action:'ticket',now:now-61000,actor:{uid:'member-a',active:true,access:true,expiresAt:now+60000,permissions:{checklistRead:true}}});
   assert.equal((await upgrade(expired.ticket)).status,403);
   assert.equal((await mf.dispatchFetch('https://channel.invalid/v1/operational-channel/events?ticket='+encodeURIComponent(a.ticket),{headers:{Origin:origin,Upgrade:'websocket'}})).status,404);
   assert.equal((await fixture({action:'stats'})).firestoreReads,0);
  });
  const submission={action:'submit',collection:'checklists',day,requestId:'realtime-record',data:{date:day,stationId:'station1',condition:'SIM',status:'COMPLETED',occurrence:'',responsibleUid:null,responsibleName:null,responsibleEmail:null}};
  await t.test('durable submit/withdraw notify only allowed collections; failure preserves committed data',async()=>{
   const event=nextEvent(a.socket,'message',e=>e.data!=='pong');assert.equal((await send(submission)).code,'CHANNEL_SHARED');
   assert.deepEqual(JSON.parse((await event).data),{type:'changed',collection:'checklists',day});
   assert.equal((await send({action:'list',collection:'checklists',day})).records.length,1);
   const removed=nextEvent(a.socket,'message',e=>e.data!=='pong');assert.equal((await send({action:'withdraw',collection:'checklists',day,requestId:submission.requestId})).code,'CHANNEL_WITHDRAWN');await removed;
   await ping(b.socket);assert.deepEqual(bMessages,[]);
   assert.equal((await send({...submission,requestId:'notify-lost'},token,{'X-Fixture-Notify-Failure':'yes'})).code,'CHANNEL_SHARED');
   assert.equal((await send({action:'list',collection:'checklists',day})).records[0].id,'notify-lost');
   assert.equal((await fixture({action:'stats'})).firestoreReads,0);
  });
  await t.test('private completion and source changes invalidate metadata; acknowledgment alone reads its mocked proof',async()=>{
   await send({...submission,requestId:'private-complete'});
   assert.equal((await install({schemaVersion:1,action:'claim',uid:'member-a',requestId:'private-complete'})).code,'CONTINUITY_CLAIMED');
   const completed=nextEvent(a.socket,'message',e=>e.data!=='pong');
   assert.equal((await install({schemaVersion:1,action:'complete',uid:'member-a',requestId:'private-complete',state:'confirmed',record:{...submission.data,id:'private-complete',version:1}})).code,'CONTINUITY_COMPLETED');await completed;
   const catalog=nextEvent(a.socket,'message',e=>e.data!=='pong');
   assert.equal((await install({schemaVersion:1,action:'source-change',path:'stations/station1',data:{name:'Synthetic',active:true}})).code,'CONTINUITY_SOURCE_UPDATED');
   assert.deepEqual(JSON.parse((await catalog).data),{type:'changed',collection:'checklists',day:null});
   const schedule=nextEvent(a.socket,'message',e=>e.data!=='pong');
   assert.equal((await install({schemaVersion:1,action:'source-change',path:'scheduleDays/'+day,data:{version:1,positions:[]}})).code,'CONTINUITY_SOURCE_UPDATED');
   assert.deepEqual(JSON.parse((await schedule).data),{type:'changed',collection:'scheduleReleases',day});
   assert.equal((await fixture({action:'stats'})).firestoreReads,0);
   await send({...submission,requestId:'ack-proof'});
   await fixture({action:'proof',proof:{path:'checklists/ack-proof',data:{...submission.data,id:'ack-proof',clientMutationId:'ack-proof',createdByUid:'member-a'}}});
   const ack=nextEvent(a.socket,'message',e=>e.data!=='pong');assert.equal((await send({action:'ack',collection:'checklists',day,requestId:'ack-proof'})).code,'CHANNEL_CONFIRMED');await ack;
   assert.equal((await fixture({action:'stats'})).firestoreReads,1);
   await fixture({action:'proof',proof:{path:'stations/station1',data:{name:'Proven synthetic',active:true}}});
   const source=nextEvent(a.socket,'message',e=>e.data!=='pong');assert.equal((await send({action:'source',path:'stations/station1'})).code,'CHANNEL_SOURCE_UPDATED');await source;
   assert.equal((await fixture({action:'stats'})).firestoreReads,2);
  });
  await t.test('arbitrary client commands close; authorization expiry closes on next message',async()=>{
   const commands=await connect(),closed=nextEvent(commands.socket,'close');commands.socket.send('{"action":"submit"}');assert.equal((await closed).code,1008);
   const now=Date.now(),short=await fixture({action:'ticket',now,actor:{uid:'member-a',active:true,access:true,expiresAt:now+500,permissions:{checklistRead:true}}});
   const r=await upgrade(short.ticket);assert.equal(r.status,101);const socket=r.webSocket;socket.accept();sockets.push(socket);
   await delay(550);const expired=nextEvent(socket,'close');socket.send('check');assert.equal((await expired).code,4001);
  });
  await t.test('changed profile narrows fresh grant; revocation closes only its UID and denies unused tickets',async()=>{
   const unused=await send({action:'watch'}),aClosed=nextEvent(a.socket,'close');
   assert.equal((await install({schemaVersion:1,action:'source-change',path:'users/member-a',data:{...profiles[0].profile,permissions:{scheduleRead:true}}})).code,'CONTINUITY_PROFILE_STORED');
   assert.equal((await aClosed).code,4001);assert.equal((await upgrade(unused.ticket)).status,403);
   await ping(b.socket);assert.deepEqual(bMessages,[]);
   const narrowed=await connect(),pending=await send({action:'watch'}),revoked=nextEvent(narrowed.socket,'close');
   const decoded=JSON.parse(Buffer.from(pending.ticket.split('.')[0],'base64url').toString());assert.deepEqual(decoded.collections,['scheduleReleases']);
   assert.equal((await install({schemaVersion:1,action:'source-change',path:'users/member-a',deleted:true})).code,'CONTINUITY_PROFILE_REVOKED');
   assert.equal((await revoked).code,4001);assert.equal((await upgrade(pending.ticket)).status,403);assert.equal((await send({action:'watch'})).status,403);
   await ping(b.socket);assert.equal((await fixture({action:'stats'})).firestoreReads,2);
  });
  assert.ok(aMessages.length>=6);assert.equal(outboundCalls,0);
 }finally{for(const socket of sockets)try{socket.close();}catch{}await mf.dispose();}
});
