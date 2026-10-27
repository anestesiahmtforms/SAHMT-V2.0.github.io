import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createOperationalChannelWorker,OperationalChannelState,OperationalChannelAuthorization} from '../worker-operational-channel/worker.js';
import {channelActorFromProfile,normalizeChannelSubmission,mergeSharedChannelRecords} from '../src/provisional-channel-contract.js';
import {createChannelIdentityVerifier} from '../worker-operational-channel/identity.js';
import {createReportRuntime} from '../src/report-runtime.js';
const now=Date.parse('2026-10-19T15:00:00Z'),day='2026-10-19',origin='https://anestesiahmtforms.github.io';
const profile={role:'anestesiologista',displayName:'Pessoa sintética',sigla:'AA',active:true,access:true,permissions:{checklistRead:true,checklistWrite:true,eventsRead:true,eventsWrite:true,labelsRead:true,labelsWrite:true,scheduleRead:true,scheduleWrite:true}};
function storage(){const db=new DatabaseSync(':memory:');return {sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}};}},transactionSync(work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};}
function binding(Class){const instances=new Map();return {idFromName:x=>x,get(name){if(!instances.has(name))instances.set(name,new Class({storage:storage()}));return instances.get(name);}};}
const encode=value=>value===null?{nullValue:null}:Array.isArray(value)?{arrayValue:{values:value.map(encode)}}:typeof value==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}}:typeof value==='boolean'?{booleanValue:value}:typeof value==='number'?{doubleValue:value}:{stringValue:value};
function firestoreDocument(path,data){return {name:'projects/sahmt-17a16/databases/(default)/documents/'+path,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]))};}
function harness(){const env={OPERATIONAL_CHANNEL_ENABLED:'true',FA_FIREBASE_WEB_API_KEY:'synthetic-key-not-used',OPERATIONAL_CHANNEL_STATE:binding(OperationalChannelState),OPERATIONAL_CHANNEL_AUTHORIZATION:binding(OperationalChannelAuthorization)};let firestoreReads=0,proof=null,failFirestore=false;
  const worker=createOperationalChannelWorker({now:()=>now,verifyIdentity:async token=>({uid:token.split('.')[0]}),fetchImpl:async url=>{firestoreReads++;if(failFirestore)return Response.json({error:{}},{status:429});if(url.includes('/users/'))return Response.json(firestoreDocument('users/'+url.split('/').at(-1),profile));return proof?Response.json(proof):Response.json({error:{}},{status:404});}});
  const send=async (body,uid='userA',extra={})=>{const response=await worker.fetch(new Request('https://channel.test/v1/operational-channel',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+uid+'.'+'x'.repeat(120)+'.sig','Content-Type':'application/json',...extra},body:JSON.stringify(body)}),env);return {status:response.status,body:await response.json()};};
  return {env,send,reads:()=>firestoreReads,setProof:value=>{proof=value;},setFailure:value=>{failFirestore=value;}};
}
const checklist=(id='record1',stationId='arsenal1')=>({action:'submit',collection:'checklists',day,requestId:id,createdAt:now-1000,data:{date:day,stationId,condition:'SIM',status:'COMPLETED',occurrence:'',responsibleUid:null,responsibleName:null,responsibleEmail:null,createdByName:'untrusted'}});
const release=(id,marked,occurredAt=now)=>({action:'submit',collection:'scheduleReleases',day,requestId:id,data:{day,sigla:'AA',marked,groupSiglas:['AA'],tokenSigla:'AA',occurredAt}});
test('autoriza por um perfil do servidor; submissão e consulta não leem Firestore',async()=>{const h=harness();assert.equal((await h.send({action:'authorize'})).body.code,'CHANNEL_AUTHORIZED');assert.equal(h.reads(),1);h.setFailure(true);assert.equal((await h.send(checklist())).body.code,'CHANNEL_SHARED');const rows=await h.send({action:'list',collection:'checklists',day});assert.equal(rows.body.records.length,1);assert.equal(rows.body.records[0].createdByName,profile.displayName);assert.equal(rows.body.records[0].pendingFirestore,true);assert.equal(h.reads(),1);});
test('segundo aparelho autorizado recebe os provisórios do Checklist sem falsificar confirmação',async()=>{const h=harness();await h.send({action:'authorize'});await h.send({action:'authorize'},'userB');await h.send(checklist());const rows=await h.send({action:'list',collection:'checklists',day},'userB');assert.equal(rows.body.records.length,1);assert.equal(rows.body.own.length,0);assert.equal(rows.body.records[0].provisionalShared,true);});
test('idempotência não duplica e conteúdo divergente fica bloqueado',async()=>{const h=harness();await h.send({action:'authorize'});await h.send(checklist());assert.equal((await h.send(checklist())).body.code,'CHANNEL_ALREADY_SHARED');const different=checklist();different.data.condition='NAO';different.data.occurrence='Teste';different.data.status='MAINTENANCE';assert.equal((await h.send(different)).status,409);assert.equal((await h.send({action:'list',collection:'checklists',day})).body.records.length,1);});
test('UID sem perfil validado, conta sem permissão e origem desconhecida não acessam o canal',async()=>{const h=harness();assert.equal((await h.send(checklist())).status,403);await h.send({action:'authorize'});assert.equal((await h.send(checklist(),'userA',{Origin:'https://other.invalid'})).status,403);const stub=h.env.OPERATIONAL_CHANNEL_AUTHORIZATION.get('userA');await stub.fetch(new Request('https://channel.internal/put',{method:'POST',body:JSON.stringify({actor:channelActorFromProfile('userA',{...profile,permissions:{}},now),now})}));assert.equal((await h.send(checklist())).status,403);});
test('política expirada bloqueia submissão sem consultar Firestore',async()=>{const h=harness();await h.send({action:'authorize'});await h.env.OPERATIONAL_CHANNEL_AUTHORIZATION.get('userA').fetch(new Request('https://channel.internal/put',{method:'POST',body:JSON.stringify({actor:{...channelActorFromProfile('userA',profile,now-86400000),expiresAt:now-1},now:now-2})}));const reads=h.reads();assert.equal((await h.send(checklist())).body.code,'CHANNEL_AUTHORIZATION_EXPIRED');assert.equal(h.reads(),reads);});
test('Eventos e Etiquetas respeitam autoria e participação, sem liberação geral de dados',async()=>{const h=harness();await h.send({action:'authorize'});await h.send({action:'authorize'},'userB');const data={date:day,memberSigla:'BB',scheduleSigla:'BB',memberStatus:'Teste',eventType:'Teste',description:'',delayMultiple:null,substitute:'',shift:'',payer:'',creditor:'',amountToPay:0,status:'OPEN'};assert.equal((await h.send({action:'submit',collection:'events',requestId:'event1',day,data})).status,200);assert.equal((await h.send({action:'list',collection:'events',day},'userB')).body.records.length,0);const label={date:day,patientName:'Pessoa fictícia',procedureCode:'1',encounterCode:'2',type:'Convênio',amount:null,insurance:'Teste',creditor:'Caixa',staffSiglas:[],consultation:false,status:'CONFIRMED'};assert.equal((await h.send({action:'submit',collection:'labels',requestId:'label1',day,data:label})).status,200);assert.equal((await h.send({action:'list',collection:'labels',day},'userB')).body.records.length,0);});
test('liberação mais recente substitui a provisória anterior preservando a recuperação do autor',async()=>{const h=harness();await h.send({action:'authorize'});await h.send(release('release1',true,now-100));await h.send(release('release2',false,now));const rows=(await h.send({action:'list',collection:'scheduleReleases',day})).body;assert.deepEqual(rows.records.map(x=>x.id),['release2']);assert.equal(rows.own.find(x=>x.requestId==='release1').state,'superseded');assert.equal((await h.send(release('release3',true,now-1000))).body.code,'CHANNEL_STALE_RELEASE');});
test('ACK sem prova não confirma; prova exata confirma uma vez e não repete leitura',async()=>{const h=harness();await h.send({action:'authorize'});await h.send(checklist());const ack={action:'ack',collection:'checklists',requestId:'record1',day};assert.equal((await h.send(ack)).body.code,'CHANNEL_CONFIRMATION_PENDING');const actor=channelActorFromProfile('userA',profile,now),pending=normalizeChannelSubmission({collection:'checklists',requestId:'record1',data:checklist().data},actor,now);h.setProof(firestoreDocument('checklists/record1',{...pending.data,id:'record1',clientMutationId:'record1',createdByUid:'userA'}));assert.equal((await h.send(ack)).body.code,'CHANNEL_CONFIRMED');const reads=h.reads();assert.equal((await h.send(ack)).body.code,'CHANNEL_CONFIRMED');assert.equal(h.reads(),reads);const list=(await h.send({action:'list',collection:'checklists',day})).body;assert.equal(list.records.length,0);assert.equal(list.own[0].state,'confirmed');});
test('prova divergente mantém cópia provisória e não permite que outro UID confirme',async()=>{const h=harness();await h.send({action:'authorize'});await h.send({action:'authorize'},'userB');await h.send(checklist());h.setProof(firestoreDocument('checklists/record1',{id:'record1',clientMutationId:'record1',createdByUid:'userA',stationId:'diferente'}));assert.equal((await h.send({action:'ack',collection:'checklists',requestId:'record1',day})).body.code,'CHANNEL_CONFIRMATION_CONFLICT');assert.equal((await h.send({action:'ack',collection:'checklists',requestId:'record1',day},'userB')).status,404);assert.equal((await h.send({action:'list',collection:'checklists',day})).body.records.length,1);});
test('paginação retorna todos os arsenais sem duplicar registros entre páginas',async()=>{const h=harness();await h.send({action:'authorize'});for(let i=0;i<45;i++)assert.equal((await h.send(checklist('record'+i))).status,200);let a=(await h.send({action:'list',collection:'checklists',day})).body,b=(await h.send({action:'list',collection:'checklists',day,cursor:a.nextCursor})).body;assert.equal(a.records.length,40);assert.equal(b.records.length,5);assert.equal(new Set([...a.records,...b.records].map(x=>x.id)).size,45);});
test('deduplicação preserva oficial e adiciona apenas provisórios ausentes',()=>{const official={id:'one',date:day},shared={id:'one',date:day,provisionalShared:true},second={id:'two',date:day,provisionalShared:true};const rows=mergeSharedChannelRecords('checklists',[official],[shared,second]);assert.equal(rows.length,2);assert.equal(rows.find(x=>x.id==='one').provisionalShared,undefined);assert.equal(rows.find(x=>x.id==='two').pendingSync,true);});
test('revogar perfil no registro de autorização não é contornado por falha de Firestore',async()=>{const h=harness();await h.send({action:'authorize'});await h.env.OPERATIONAL_CHANNEL_AUTHORIZATION.get('userA').fetch(new Request('https://channel.internal/revoke',{method:'POST',body:JSON.stringify({now})}));h.setFailure(true);assert.equal((await h.send(checklist())).status,403);});
test('identidade só é aceita depois da confirmação da API Authentication',async()=>{const claims={aud:'sahmt-17a16',iss:'https://securetoken.google.com/sahmt-17a16',sub:'userA',email_verified:true,iat:now/1000-30,exp:now/1000+3000,auth_time:now/1000-30,firebase:{sign_in_provider:'google.com',identities:{'google.com':['google1']}}};const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+Buffer.alloc(256).toString('base64url');let accepted=false;const verifier=createChannelIdentityVerifier({now:()=>now,fetchImpl:async()=>accepted?Response.json({users:[{localId:'userA',emailVerified:true,validSince:'0',providerUserInfo:[{providerId:'google.com',rawId:'google1'}]}]}):Response.json({error:{}},{status:400})});await assert.rejects(()=>verifier(token,'syntheticapikey1234567890'),{code:'CHANNEL_AUTH_DENIED'});accepted=true;assert.equal((await verifier(token,'syntheticapikey1234567890')).uid,'userA');});
test('runtime exibe provisório com servidor ausente, bloqueia green e encerra na revogação',async()=>{let next,shared,valid=true,closed=0;const paints=[];const rt=createReportRuntime({subscribe:(_kind,_scope,h)=>{next=h;return()=>{};},isCurrent:()=>valid,readPending:async()=>[],onData:(_k,p)=>paints.push(p)});rt.configureSharedAdapter({watch:(_scope,cb)=>{shared=cb;return()=>closed++;},merge:(_k,p,rows)=>({...p,records:mergeSharedChannelRecords('events',p.records,rows)})});const c=rt.open('events',{key:'scope',uid:'userA',kind:'events',mode:'daily'});await new Promise(r=>setImmediate(r));shared([{id:'one',date:day,provisionalShared:true}],{records:[],stale:true});assert.equal(paints.at(-1).records.length,1);assert.equal(c.snapshot().confirmed,false);next.error({code:'permission-denied'});assert.equal(closed,1);const count=paints.length;shared([{id:'two',provisionalShared:true}],{records:[]});assert.equal(paints.length,count);valid=false;rt.clear();});
import {createProvisionalChannelClient} from '../src/provisional-channel-client.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function clientHarness(server=harness(),sharedStore){
  const receipts=sharedStore||new Map(),operations=new Map(),target=new EventTarget();
  const session={status:'signed-in',user:{uid:'userA'},profile,offline:false};
  const auth={currentUser:{uid:'userA',getIdToken:async()=> 'userA.'+'x'.repeat(120)+'.sig'}};
  const store={list:async uid=>[...receipts.values()].filter(x=>x.uid===uid).map(x=>structuredClone(x)),
    update:async(uid,id,patch)=>{const key=uid+':'+id,value={...receipts.get(key),...patch,uid,requestId:id};receipts.set(key,value);return structuredClone(value);},remove:async(uid,id)=>receipts.delete(uid+':'+id)};
  const outbox={list:async uid=>[...operations.values()].filter(x=>x.uid===uid).map(x=>structuredClone(x)),update:async(uid,id,patch)=>operations.set(id,{...operations.get(id),...patch}),enqueue:async op=>operations.set(op.requestId,op)};
  let fetcher=async(_url,options)=>{const result=await server.send(JSON.parse(options.body),options.headers.Authorization.split(' ')[1].split('.')[0]);return Response.json(result.body,{status:result.status});};
  const make=(options={})=>createProvisionalChannelClient({endpoint:'https://synthetic.invalid/v1/operational-channel',authSource:auth,getSession:()=>session,now:()=>now,eventTarget:target,documentSource:{visibilityState:'visible',querySelector:()=>null,addEventListener(){},removeEventListener(){}},online:()=>true,fetchImpl:(...a)=>fetcher(...a),store,outbox,...options});
  const queue=(id='record1',date=day)=>operations.set(id,{uid:'userA',requestId:id,resourceId:id,type:'checklists',createdAt:now,payload:{collectionName:'checklists',data:{...checklist(id).data,date}},status:'awaiting-confirmation'});
  return {server,store,outbox,operations,receipts,session,auth,make,queue,fetcher:()=>fetcher,setFetcher:fn=>fetcher=fn};
}

test('cliente integrado recebe aviso imediato e atualiza relatório pelo Worker sem nova leitura Firestore',async()=>{
 const h=clientHarness(),fetcher=h.fetcher();let socket,refreshes=0;const paints=[];
 h.setFetcher(async(url,options)=>JSON.parse(options.body).action==='watch'?Response.json({code:'CHANNEL_REALTIME_TICKET',ticket:'synthetic-ticket',authorizedUntil:now+900000}):fetcher(url,options));
 class Socket extends EventTarget{readyState=0;send(){}close(){this.readyState=3;}open(){this.readyState=1;this.dispatchEvent(new Event('open'));}message(value){const e=new Event('message');e.data=JSON.stringify(value);this.dispatchEvent(e);}}
 const client=h.make({realtimeEnabled:true,createRealtimeSocket:()=>socket=new Socket(),refreshRealtimeSnapshot:async()=>{refreshes++;}});
 const stop=client.start({configureSharedAdapter(){}});
 try{
  for(let i=0;i<30&&!socket;i++)await new Promise(r=>setImmediate(r));assert.ok(socket);socket.open();
  const unwatch=client.watch({kind:'checklist',mode:'daily',day,uid:'userA'},rows=>paints.push(rows));
  try{
   h.server.setFailure(true);h.queue();await client.share();
   socket.message({type:'changed',collection:'checklists',day});await new Promise(r=>setTimeout(r,320));
   assert.ok(refreshes>=2);assert.equal(paints.at(-1)[0].id,'record1');assert.equal(h.server.reads(),1);
  }finally{unwatch();}
 }finally{stop();}
});
test('reconexão recupera os períodos visíveis e novo aviso durante hidratação não se perde',async()=>{
 const h=clientHarness(),fetcher=h.fetcher(),days=[];let socket,release;
 h.setFetcher(async(url,options)=>JSON.parse(options.body).action==='watch'?Response.json({code:'CHANNEL_REALTIME_TICKET',ticket:'synthetic-ticket',authorizedUntil:now+900000}):fetcher(url,options));
 class Socket extends EventTarget{readyState=0;send(){}close(){this.readyState=3;}open(){this.readyState=1;this.dispatchEvent(new Event('open'));}message(value){const e=new Event('message');e.data=JSON.stringify(value);this.dispatchEvent(e);}}
 const doc={visibilityState:'visible',querySelector:selector=>selector==='#event-schedule-date'?{value:'2026-10-18'}:null,addEventListener(){},removeEventListener(){}};
 const client=h.make({documentSource:doc,realtimeEnabled:true,createRealtimeSocket:()=>socket=new Socket(),refreshRealtimeSnapshot:async(_uid,{day})=>{days.push(day);if(days.length===1)await new Promise(resolve=>release=resolve);}});
 const stop=client.start({configureSharedAdapter(){},get:kind=>kind==='events'?{snapshot:()=>({scope:{uid:'userA',mode:'monthly',month:'2026-09'}})}:null});
 try{
  for(let i=0;i<30&&!socket;i++)await new Promise(r=>setImmediate(r));socket.open();await new Promise(r=>setImmediate(r));
  socket.message({type:'changed',collection:'scheduleReleases',day:'2026-10-18'});await new Promise(r=>setTimeout(r,300));release();
  for(let i=0;i<20&&days.length<3;i++)await new Promise(r=>setImmediate(r));
  assert.equal(days.filter(day=>day==='2026-10-18').length,2);assert.ok(days.includes('2026-09-01'));assert.equal(h.server.reads(),1);
 }finally{stop();}
});
test('contrato Checklist preserva exatamente campos graváveis e limita ocorrência a 500 caracteres',()=>{
  const actor=channelActorFromProfile('userA',profile,now),input=checklist();
  const normalized=normalizeChannelSubmission({collection:input.collection,requestId:input.requestId,data:input.data},actor,now);
  assert.equal(Object.hasOwn(normalized.data,'updatedByName'),false);
  input.data.occurrence='x';assert.throws(()=>normalizeChannelSubmission({collection:input.collection,requestId:input.requestId,data:input.data},actor,now),{code:'CHANNEL_CHECKLIST_INVALID'});
  input.data.condition='NAO';input.data.status='MAINTENANCE';input.data.occurrence='x'.repeat(501);assert.throws(()=>normalizeChannelSubmission({collection:input.collection,requestId:input.requestId,data:input.data},actor,now),{code:'CHANNEL_CHECKLIST_INVALID'});
});
test('um item antigo recusado não impede compartilhar o próximo registro válido',async()=>{
  const h=clientHarness(),client=h.make();await client.authorize();h.queue('antigo','2026-10-01');h.queue('atual');await client.share();
  assert.equal(h.receipts.get('userA:antigo').shareError,'CHANNEL_DATE_INVALID');assert.equal(h.receipts.get('userA:atual').shared,true);assert.equal(h.operations.size,2);assert.equal(h.server.reads(),1);
});
test('ACK divergente não bloqueia ACK independente nem apaga seu rascunho',async()=>{
  const h=clientHarness(),client=h.make();await client.authorize();h.queue('divergente');h.queue('correto');await client.share();
  for(const id of ['divergente','correto'])await h.store.update('userA',id,{committed:true});
  const data=normalizeChannelSubmission({collection:'checklists',requestId:'correto',data:checklist('correto').data},channelActorFromProfile('userA',profile,now),now).data;
  h.server.setProof(firestoreDocument('checklists/correto',{...data,id:'correto',clientMutationId:'correto',createdByUid:'userA'}));await client.acknowledge();
  assert.equal(h.receipts.has('userA:correto'),false);assert.equal(h.receipts.get('userA:divergente').ackError,'CHANNEL_CONFIRMATION_CONFLICT');assert.equal(h.operations.size,2);
});
test('descarte espera submit em andamento e retira a cópia compartilhada antes de liberar exclusão local',async()=>{
  const h=clientHarness(),client=h.make();await client.authorize();h.queue();let release,arrived;
  const gate=new Promise(resolve=>release=resolve),arrival=new Promise(resolve=>arrived=resolve),original=h.fetcher();
  h.setFetcher(async(url,options)=>{const response=await original(url,options);if(JSON.parse(options.body).action==='submit'){arrived();await gate;}return response;});
  const sharing=client.share();await arrival;let withdrawn=false;const withdrawing=client.withdraw(h.operations.get('record1')).then(()=>withdrawn=true);await new Promise(r=>setImmediate(r));assert.equal(withdrawn,false);
  release();await sharing;await withdrawing;assert.equal(h.receipts.size,0);const rows=await h.server.send({action:'list',collection:'checklists',day});assert.equal(rows.body.records.length,0);assert.equal(rows.body.own[0].state,'withdrawn');
});
test('retirada cria tombstone e bloqueia submit que chegou atrasado',async()=>{
  const h=harness();await h.send({action:'authorize'});assert.equal((await h.send({action:'withdraw',collection:'checklists',day,requestId:'atrasado'})).body.code,'CHANNEL_WITHDRAWN');assert.equal((await h.send(checklist('atrasado'))).status,409);assert.equal((await h.send({action:'list',collection:'checklists',day})).body.records.length,0);
});
test('reabertura recupera recibo com resposta perdida e confirma somente com prova do commit',async()=>{
  const h=clientHarness(),client=h.make();await client.authorize();h.queue();const original=h.fetcher();h.setFetcher(async(...args)=>{const response=await original(...args);if(JSON.parse(args[1].body).action==='submit')throw Error('rede interrompida após aceite');return response;});await client.share();
  assert.equal(h.receipts.get('userA:record1').attempted,true);assert.equal(h.receipts.get('userA:record1').shared,false);
  h.setFetcher(original);await h.store.update('userA','record1',{committed:true});h.operations.clear();
  const data=normalizeChannelSubmission({collection:'checklists',requestId:'record1',data:checklist().data},channelActorFromProfile('userA',profile,now),now).data;h.server.setProof(firestoreDocument('checklists/record1',{...data,id:'record1',clientMutationId:'record1',createdByUid:'userA'}));
  await h.make().acknowledge();assert.equal(h.receipts.size,0);assert.equal((await h.server.send({action:'list',collection:'checklists',day})).body.records.length,0);
});
test('sem confirmação real o cliente nunca tenta ler Firestore para confirmar',async()=>{
  const h=clientHarness(),client=h.make();await client.authorize();h.queue();await client.share();for(let i=0;i<5;i++)await client.acknowledge();assert.equal(h.server.reads(),1);assert.equal(h.receipts.get('userA:record1').shared,true);assert.equal(h.operations.size,1);
});
test('liberação superseded não pode receber ACK mesmo que o estado coincida no Firestore',async()=>{
  const h=harness();await h.send({action:'authorize'});await h.send(release('a',true,now-10));await h.send(release('b',false,now));const reads=h.reads();assert.equal((await h.send({action:'ack',collection:'scheduleReleases',day,requestId:'a'})).body.code,'CHANNEL_CONFIRMATION_CONFLICT');assert.equal(h.reads(),reads);
});
test('transação da escala não rebaseia automaticamente liberação antiga após alteração concorrente',async()=>{
  const source=readFileSync(new URL('../src/data.js',import.meta.url),'utf8');const begin=source.indexOf('async function applyScheduleSiglaRelease('),end=source.indexOf('function scheduleReleaseRequestId(',begin);let callback,writes=0;
  const context=vm.createContext({Boolean,Number,Date,db:{},doc:()=>({}),serverTimestamp:()=>0,updateScheduleReleaseState:()=>({changed:true,siglas:['AA']}),updateScheduleReleaseTimes:()=>({AA:now}),writeSafeCache:async()=>{},runTransaction:async(_db,work)=>{callback=work;await work({get:async()=>({exists:()=>true,id:day,data:()=>({version:1,highlights:{siglas:[]}})}),update:()=>writes++});return work({get:async()=>({exists:()=>true,id:day,data:()=>({version:2,highlights:{siglas:[]}})}),update:()=>writes++});}});
  vm.runInContext(source.slice(begin,end).replaceAll('import.meta.env.VITE_OPERATIONAL_CHANNEL_ENDPOINT','true'),context);
  await assert.rejects(()=>context.applyScheduleSiglaRelease({day,sigla:'AA',marked:true,occurredAt:now,expectedVersion:1},'userA'),{code:'stale-version'});assert.equal(writes,1);assert.equal(typeof callback,'function');
});
test('provisórios recebidos reaparecem offline após reabrir, sem consultar Firestore nem o canal',async()=>{
 const h=clientHarness(),cache=new Map();const local={writeCache:async(uid,kind,id,data)=>cache.set(uid+kind+id,{data}),readCache:async(uid,kind,id)=>cache.get(uid+kind+id)};
 const client=h.make(local);await client.authorize();h.queue();await client.share();let resolve;const observed=new Promise(r=>resolve=r),scope={uid:'userA',kind:'checklist',mode:'daily',day};const stop=client.watch(scope,rows=>resolve(rows));assert.equal((await observed).length,1);stop();const reads=h.server.reads();
 const offline=h.make({...local,online:()=>false,fetchImpl:()=>assert.fail('Não consultar rede ao reabrir offline')});let resolveOffline;const observedOffline=new Promise(r=>resolveOffline=r),close=offline.watch(scope,rows=>resolveOffline(rows));assert.equal((await observedOffline)[0].provisionalShared,true);close();assert.equal(h.server.reads(),reads);
 const saved=[...cache.values()].find(row=>Array.isArray(row.data.records));saved.data.expiresAt=now-1;let exposed=false;const expired=h.make({...local,online:()=>false}),end=expired.watch(scope,()=>exposed=true);await new Promise(r=>setImmediate(r));assert.equal(exposed,false);end();
});
test('alteração de permissões não reutiliza o cache provisório anterior',async()=>{
 const h=clientHarness(),cache=new Map();const local={writeCache:async(uid,kind,id,data)=>cache.set(uid+kind+id,{data}),readCache:async(uid,kind,id)=>cache.get(uid+kind+id)};
 const client=h.make(local);await client.authorize();h.queue();await client.share();let done;const seen=new Promise(r=>done=r),scope={uid:'userA',kind:'checklist',mode:'daily',day};const stop=client.watch(scope,()=>done());await seen;stop();h.session.profile={...profile,permissions:{}};
 let exposed=false;const other=h.make({...local,online:()=>false}),close=other.watch(scope,()=>exposed=true);await new Promise(r=>setImmediate(r));assert.equal(exposed,false);close();
});
test('confirmação sem mudança de Liberar também avança a versão que bloqueia operação antiga',async()=>{
 const source=readFileSync(new URL('../src/data.js',import.meta.url),'utf8'),begin=source.indexOf('async function applyScheduleSiglaRelease('),end=source.indexOf('function scheduleReleaseRequestId(',begin);let patch;
 const context=vm.createContext({Boolean,Number,Date,db:{},doc:()=>({}),serverTimestamp:()=>0,updateScheduleReleaseState:()=>({changed:false,siglas:[]}),updateScheduleReleaseTimes:()=>({}),writeSafeCache:async()=>{},runTransaction:async(_db,work)=>work({get:async()=>({exists:()=>true,id:day,data:()=>({version:1,highlights:{siglas:[]}})}),update:(_ref,value)=>patch=value})});
 vm.runInContext(source.slice(begin,end).replaceAll('import.meta.env.VITE_OPERATIONAL_CHANNEL_ENDPOINT','true'),context);await context.applyScheduleSiglaRelease({day,sigla:'AA',marked:false,occurredAt:now,expectedVersion:1},'userA');assert.equal(patch.version,2);
});
test('NOT_READY não consome tentativas de prova e confirmação volta após backoff',async()=>{
 const h=clientHarness();let clock=now;const client=h.make({now:()=>clock});await client.authorize();h.queue();await client.share();await h.store.update('userA','record1',{committed:true});const original=h.fetcher();
 h.setFetcher(async()=>Response.json({code:'CHANNEL_UNAVAILABLE'},{status:503}));await client.acknowledge();for(let i=0;i<4;i++)await client.acknowledge();assert.equal(h.receipts.get('userA:record1').ackAttempts,undefined);
 clock+=300001;h.setFetcher(original);const data=normalizeChannelSubmission({collection:'checklists',requestId:'record1',data:checklist().data},channelActorFromProfile('userA',profile,now),now).data;h.server.setProof(firestoreDocument('checklists/record1',{...data,id:'record1',clientMutationId:'record1',createdByUid:'userA'}));await client.acknowledge();assert.equal(h.receipts.size,0);
});
test('projeção da escala deixa de aplicar provisórios quando a concessão expira com aba aberta',async t=>{
 const h=clientHarness();await h.server.send({action:'authorize'});await h.server.send(release('release-expira',true));let clock=now,ready;const seen=new Promise(r=>ready=r);
 const client=h.make({now:()=>clock,onSchedule:()=>ready(),documentSource:{visibilityState:'visible',querySelector:id=>id==='#schedule-date'?{value:day}:null,addEventListener(){},removeEventListener(){}}});const close=client.start({configureSharedAdapter(){}});t.after(close);await seen;
 const base={highlights:{siglas:[]}};assert.equal(client.projectSchedule(base,{uid:'userA',day}).sharedProvisional,true);clock+=86400001;assert.equal(client.projectSchedule(base,{uid:'userA',day}),base);
});
test('edições de etiqueta e novos registros recusam operação offline sem enfileirar',async()=>{
 const source=readFileSync(new URL('../src/data.js',import.meta.url),'utf8');const context=vm.createContext({navigator:{onLine:false},crypto,
  assertOnlineOperation:({online=context.navigator.onLine}={})=>{if(!online)throw Object.assign(new Error('online required'),{code:'online-required'});},
  persistOperationalMutation:()=>assert.fail('Não deve persistir uma fila offline'),removeQueuedOperation:()=>assert.fail('Não deve limpar fila local')});
 const first=source.indexOf('export async function updateLabelRecord('),last=source.indexOf('export async function listLabelHistory(',first);vm.runInContext(source.slice(first,last).replace('export ',''),context);
 await assert.rejects(context.updateLabelRecord('label',{},'userA','Pessoa sintética',1),{code:'online-required'});
 const begin=source.indexOf('export async function createOperationalRecord('),end=source.indexOf('async function sendOperationalRecordInFirestore(',begin);vm.runInContext(source.slice(begin,end).replace('export ',''),context);
 await assert.rejects(context.createOperationalRecord('checklists',{date:day},{uid:'userA',requestId:'new',forceQueue:true}),{code:'online-required'});
});
test('recusa explícita do servidor impede reidratar cache depois de reabrir offline',async()=>{
 const h=clientHarness(),cache=new Map(),local={writeCache:async(uid,kind,id,data)=>cache.set(uid+kind+id,{data}),readCache:async(uid,kind,id)=>cache.get(uid+kind+id)};const client=h.make(local);await client.authorize();h.queue();await client.share();let ready;const seen=new Promise(r=>ready=r),scope={uid:'userA',kind:'checklist',mode:'daily',day};let close=client.watch(scope,rows=>ready(rows));await seen;close();
 await h.server.env.OPERATIONAL_CHANNEL_AUTHORIZATION.get('userA').fetch(new Request('https://channel.internal/revoke',{method:'POST',body:JSON.stringify({now})}));let denied;const denial=new Promise(r=>denied=r);close=client.watch(scope,rows=>{if(!rows.length)denied();});await denial;close();assert.equal(cache.get('userAprovisionalChannelaccess').data.denied,true);
 let exposed=false;const offline=h.make({...local,online:()=>false}),end=offline.watch(scope,()=>exposed=true);await new Promise(r=>setImmediate(r));assert.equal(exposed,false);end();
});
test('troca de usuário durante obtenção da atestação cancela envio com identidade antiga',async()=>{
 const h=clientHarness();let arrive,release;const arrived=new Promise(r=>arrive=r),gate=new Promise(r=>release=r);const client=h.make({getAppCheckHeaders:async()=>{arrive();await gate;return {};},fetchImpl:()=>assert.fail('Não enviar token da sessão anterior')});const pending=client.authorize();await arrived;h.auth.currentUser={uid:'userB',getIdToken:async()=>''};h.session.user={uid:'userB'};release();await assert.rejects(pending,{message:'CHANNEL_SESSION_CHANGED'});assert.equal(h.server.reads(),0);
});
