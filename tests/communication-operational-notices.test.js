import test from 'node:test';
import assert from 'node:assert/strict';
import {ADMINS} from '../communication/domain.js';
import {operationalNoticeIdentity,urgentNoticeInput,RELEASE_NOTICE,releaseNoticeFeedback} from '../src/communication-operational-notices.js';
import {createCommunicationService} from '../worker-communication/service.js';

const NOW=Date.parse('2026-11-04T15:00:00Z');
const operator={uid:'ff-operator',sourceUid:'fa-operator',faUid:'fa-operator',email:'marcio.henrique82@gmail.com',emailVerified:true};
const person={uid:'ff-person',sourceUid:'fa-person',faUid:'fa-person',email:'person@example.test',emailVerified:true};
const other={uid:'ff-other',sourceUid:'fa-other',faUid:'fa-other',email:'other@example.test',emailVerified:true};
function memory(){
 const data=new Map();let lock=Promise.resolve();
 const get=async(c,k)=>structuredClone(data.get(c+'/'+k)||null);
 const page=async(c,{cursor='',limit=20,filters=[]}={})=>[...data].filter(([key,v])=>key.startsWith(c+'/')&&key.slice(c.length+1)>cursor&&filters.every(([field,value])=>v[field]===value)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([key,v])=>({...structuredClone(v),id:key.slice(c.length+1)}));
 const countPublished=async(start,end)=>[...data].filter(([key,v])=>key.startsWith('communicationMessages/')&&v.firstPublishedAt>=start&&v.firstPublishedAt<end).length;
 const transaction=work=>{const result=lock.then(async()=>{const writes=[];const value=await work({get,countPublished,set:(c,k,v)=>writes.push([c+'/'+k,v]),create:(c,k,v)=>{assert.equal(data.has(c+'/'+k),false);writes.push([c+'/'+k,v]);}});for(const [key,v]of writes)data.set(key,structuredClone(v));return value;});lock=result.catch(()=>{});return result;};
 return {data,get,page,countPublished,transaction};
}
function fixture({scheduleSource}={}){
 const store=memory(),fa=memory(),queued=[],sent=[];let sequence=0;
 for(const [actor,sigla]of [[operator,'MH'],[person,'AB'],[other,'CD']])fa.data.set('users/'+actor.sourceUid,{uid:actor.sourceUid,email:actor.email,active:true,access:true,sigla,permissions:{scheduleWrite:actor===operator}});
 fa.data.set('scheduleDays/2026-11-04',{highlights:{siglas:['AB'],releaseTimes:{AB:NOW-1000}}});
 store.data.set('communicationSettings/main',{pushEnabled:true});
 const queue={send:async body=>queued.push(body),sendBatch:async batch=>queued.push(...batch.map(item=>item.body))};
 const service=createCommunicationService({store,fa,scheduleSource,now:()=>NOW,uuid:()=>`test-${++sequence}`,pushQueue:queue,send:async(token,data)=>{sent.push({token,data});return {status:'accepted'};},recipientEnabled:async()=>true});
 for(const [key,value]of fa.data)if(key.startsWith('users/'))store.data.set(key,structuredClone(value));
 const call=(action,input={},actor=operator)=>service.execute(action,input,actor);
 const deliver=async()=>{while(queued.length)await service.consumePush(queued.shift());};
 return {store,fa,queued,sent,call,deliver,queue,consume:input=>service.consumePush(input)};
}
const draft=()=>urgentNoticeInput({noticeId:'urgent-test',title:'Aviso de teste',message:'Descrição de teste'},NOW);

test('a criação de evento respeita os públicos locais e o mesmo envio só publica uma vez',async()=>{
 const f=fixture();
 for(const [actor,group] of [[person,'team'],[other,'resident']]){
  Object.assign(f.store.data.get('users/'+actor.sourceUid),{institutionalGroup:group,displayName:actor.email});
  await f.call('REGISTER_DEVICE',{token:actor.uid+'x'.repeat(70)},actor);
 }
 const input={id:'event-test',title:'Evento de teste',description:'Veja https://example.test/video',audience:'institutional-team'};
 const [first,again]=await Promise.all([f.call('CREATE_EVENT',input),f.call('CREATE_EVENT',input)]);
 assert.equal(first.message.id,input.id);assert.equal(again.alreadySent,true);assert.equal(f.queued.length,0);
 assert.equal((await f.call('INBOX',{},person)).items.length,1);
 assert.equal((await f.call('INBOX',{},other)).items.length,0);
 await f.deliver();assert.equal(f.sent.length,0);
 await assert.rejects(f.call('CREATE_EVENT',{...input,audience:'ALL'}),{code:'COMM_CONFLICT'});
 await assert.rejects(f.call('CREATE_EVENT',{...input,id:'event-area',audience:'AREA'}),{code:'COMM_INVALID_AUDIENCE'});
 await assert.rejects(f.call('CREATE_EVENT',{...input,id:'event-denied'},other),{code:'COMM_FORBIDDEN'});
 const direct=await f.call('CREATE_EVENT',{...input,id:'event-individual',audience:'USER',recipient:other.sourceUid});
 assert.equal(direct.message.audienceValue,other.sourceUid);
 const directory=await f.call('DIRECTORY');
 assert.equal(directory.items.find(user=>user.uid===person.sourceUid).institutionalGroup,'team');
});

test('falha ao enfileirar uma liberação permite recuperar o mesmo despacho',async()=>{
 const f=fixture(),enqueue=f.queue.send;
 f.queue.send=async()=>{throw Error('Fila indisponível');};
 const first=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});
 assert.equal(first.pushPending,true);
 f.queue.send=enqueue;
 const recovered=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});
 assert.equal(recovered.alreadySent,true);
 assert.equal(recovered.pushQueued,true);
 assert.equal(f.queued.length,1);
 assert.equal(await f.store.countPublished(NOW-1000,NOW+1000),1);
});

test('FJ cutover validates the current FJ release and retains the FA operator identity and FF deduplication',async()=>{
 const fj=memory();fj.data.set('scheduleDays/2026-11-04',{highlights:{siglas:['AB'],releaseTimes:{AB:NOW-500}}});
 const f=fixture({scheduleSource:fj});
 // The old FA release deliberately differs. Only the new source may validate it.
 f.fa.data.get('scheduleDays/2026-11-04').highlights.releaseTimes.AB=NOW-5000;
 const first=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});
 const second=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});
 assert.equal(first.message.id,`release-2026-11-04-AB-${NOW-500}`);
 assert.equal(second.alreadySent,true);assert.equal(f.queued.length,1);
 fj.data.delete('scheduleDays/2026-11-04');
 await assert.rejects(f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'}),{code:'COMM_NOT_CURRENT'});
});

test('formulário fixo aplica somente ao email verificado do Márcio',()=>{
 assert.equal(operationalNoticeIdentity(operator),true);
 assert.equal(operationalNoticeIdentity({...operator,email:' MARCIO.HENRIQUE82@GMAIL.COM '}),true);
 assert.equal(operationalNoticeIdentity({...operator,emailVerified:false}),false);
 assert.equal(operationalNoticeIdentity({...operator,email:ADMINS[0]}),false);
 assert.deepEqual(draft().message,{title:'Aviso de teste',message:'Descrição de teste',category:'AVISO URGENTE',priority:'URGENT',audienceType:'ALL',audienceValue:'',route:'home',publishAt:NOW,expiresAt:NOW+7*86400000,status:'published'});
 assert.throws(()=>urgentNoticeInput({noticeId:'urgent-test',title:' ',message:'teste'},NOW),{code:'COMM_INVALID_INPUT'});
});

test('servidor fixa categoria, prioridade e público e não duplica o aviso urgente',async()=>{
 const f=fixture(),input=draft();Object.assign(input.message,{category:'COMUNICADO GERAL',priority:'NORMAL',audienceType:'USER',audienceValue:person.sourceUid,status:'draft',route:'management'});
 const first=await f.call('SAVE_MESSAGE',input),again=await f.call('SAVE_MESSAGE',input);
 assert.equal(first.message.category,'AVISO URGENTE');assert.equal(first.message.priority,'URGENT');assert.equal(first.message.audienceType,'ALL');assert.equal(first.message.audienceValue,'');assert.equal(first.message.status,'published');assert.equal(first.message.route,'home');
 assert.equal(first.pushQueued,false);assert.equal(again.alreadySent,true);assert.equal(f.queued.length,0);
 assert.equal((await f.call('INBOX',{},person)).items.length,1);
 f.store.data.get('users/'+other.sourceUid).access=false;
 await assert.rejects(f.call('INBOX',{},other),{code:'COMM_FORBIDDEN'});
});

test('liberação do Márcio mantém mensagem individual, texto exato, banner e Push só ao destinatário',async()=>{
 const f=fixture();
 for(const actor of [person,other])await f.call('REGISTER_DEVICE',{token:actor.uid+'x'.repeat(70)},actor);
 const result=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});
 assert.equal(result.message.title,'LIBERAÇÃO');assert.equal(result.message.message,'Você está Liberado! O SAHMT agradece por sua dedicação. BOM DESCANSO! 🤜🤛.');assert.equal(result.message.title,RELEASE_NOTICE.title);
 assert.equal(result.message.audienceType,'USER');assert.equal(result.message.audienceValue,person.sourceUid);assert.equal(result.message.route,'home');assert.equal(result.pushQueued,true);
 assert.equal((await f.call('INBOX',{},person)).items[0].id,result.message.id);
 assert.equal((await f.call('INBOX',{},other)).items.length,0);
 await assert.rejects(f.call('MESSAGE',{id:result.message.id},other),{code:'COMM_FORBIDDEN'});
 await f.deliver();assert.equal(f.sent.length,1);assert.equal(f.sent[0].token,person.uid+'x'.repeat(70));assert.equal(f.sent[0].data.title,RELEASE_NOTICE.title);assert.equal(f.sent[0].data.body,RELEASE_NOTICE.message);
 const again=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});assert.equal(again.alreadySent,true);assert.equal(f.queued.length,0);
});

test('primeiros aparelhos recebem o aviso enquanto as outras páginas de destinatários são preparadas',async()=>{
 const f=fixture();
 for(let i=0;i<7;i++)f.store.data.set('communicationDevices/device-'+i,{id:'device-'+i,uid:person.uid,sourceUid:person.sourceUid,email:person.email,active:true,updatedAt:NOW,token:'synthetic-'+i});
 const saved=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});
 await f.consume(f.queued.shift());
 assert.equal((await f.store.get('communicationDispatches',saved.message.id)).status,'queueing');
 await f.consume(f.queued.shift());
 assert.equal(f.sent.length,1,'o primeiro aparelho deve receber sem aguardar o fim da paginação');
 await f.deliver();
 const dispatch=await f.store.get('communicationDispatches',saved.message.id);
 assert.equal(f.sent.length,7);assert.equal(dispatch.status,'completed');assert.equal(dispatch.pendingCount,0);assert.equal(dispatch.processed,7);assert.equal(dispatch.accepted,7);
});

test('consumidores podem terminar antes da resposta do produtor sem perder o saldo de pendências',async()=>{
 const f=fixture();
 for(let i=0;i<7;i++)f.store.data.set('communicationDevices/device-'+i,{id:'device-'+i,uid:person.uid,sourceUid:person.sourceUid,email:person.email,active:true,updatedAt:NOW,token:'synthetic-'+i});
 const saved=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});
 f.queue.sendBatch=async batch=>{for(const item of batch)await f.consume(item.body);};
 await f.deliver();
 const dispatch=await f.store.get('communicationDispatches',saved.message.id);
 assert.equal(dispatch.status,'completed');assert.equal(dispatch.pendingCount,0);assert.equal(dispatch.processed,7);assert.equal(dispatch.accepted,7);
});

test('falha de enfileiramento preserva a reserva e resposta perdida não duplica os Push',async()=>{
 for(const count of [1,7])for(const acceptedBeforeFailure of [false,true]){
  const f=fixture();
  for(let i=0;i<count;i++)f.store.data.set('communicationDevices/device-'+i,{id:'device-'+i,uid:person.uid,sourceUid:person.sourceUid,email:person.email,active:true,updatedAt:NOW,token:'synthetic-'+i});
  const saved=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'}),first=f.queued.shift(),enqueue=f.queue.sendBatch;
  f.queue.sendBatch=async batch=>{if(acceptedBeforeFailure)await enqueue(batch);throw Error('synthetic queue outage');};
  await assert.rejects(f.consume(first),/synthetic queue outage/);
  const pending=(await f.store.get('communicationDispatches',saved.message.id)).pendingCount;
  f.queue.sendBatch=enqueue;await f.consume(first);
  assert.equal((await f.store.get('communicationDispatches',saved.message.id)).pendingCount,pending,'repetir o produtor não reserva os aparelhos novamente');
  await f.deliver();
  const dispatch=await f.store.get('communicationDispatches',saved.message.id);
  assert.equal(dispatch.status,'completed');assert.equal(dispatch.pendingCount,0);assert.equal(dispatch.processed,count);assert.equal(dispatch.accepted,count);
  assert.equal(f.sent.length,count);assert.equal(new Set(f.sent.map(item=>item.token)).size,count);
 }
});

test('entrega antecipada exige reserva válida do aparelho e do próprio aviso',async()=>{
 const f=fixture();f.store.data.set('communicationDevices/device-0',{id:'device-0',uid:person.uid,sourceUid:person.sourceUid,email:person.email,active:true,updatedAt:NOW,token:'synthetic-0'});
 const saved=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'});
 for(const plan of [{reserved:false,dispatchId:saved.message.id,deviceIds:['device-0']},{reserved:true,dispatchId:'other-notice',deviceIds:['device-0']},{reserved:true,dispatchId:saved.message.id,deviceIds:['other-device']}]){
  f.store.data.set('communicationPushFanoutPages/invalid',plan);
  await assert.rejects(f.consume({kind:'device',dispatchId:saved.message.id,deviceId:'device-0',fanoutPageId:'invalid'}),{code:'COMM_QUEUE_RETRY'});
 }
 assert.equal(f.sent.length,0);
});

test('liberação exige permissão de escala, marca confirmada e destinatário ativo único',async()=>{
 const f=fixture();await assert.rejects(f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'},person),{code:'COMM_FORBIDDEN'});
 await assert.rejects(f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'CD'}),{code:'COMM_NOT_CURRENT'});
 f.store.data.get('users/'+other.sourceUid).sigla='AB';
 await assert.rejects(f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'}),{code:'COMM_INVALID_AUDIENCE'});
 assert.equal(f.queued.length,0);
});

test('administradores por função ou permissão e Márcio podem publicar a liberação sem flag individual',async()=>{
 for(const profile of [{role:'administrador_app',permissions:{}},{role:'gestor',permissions:{admin:true}},{role:'gestor',permissions:{}}]){
  const f=fixture(),actor=profile.role==='gestor'&&!profile.permissions.admin?operator:{...operator,email:'admin@example.test'};
  Object.assign(f.fa.data.get('users/'+operator.sourceUid),profile,{email:actor.email});Object.assign(f.store.data.get('users/'+operator.sourceUid),profile,{email:actor.email});
  const result=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'},actor);
  assert.equal(result.message.audienceValue,person.sourceUid);
 }
 const f=fixture(), delegated={...operator,email:'gestor@example.test'};
 Object.assign(f.fa.data.get('users/'+operator.sourceUid),{role:'gestor',permissions:{scheduleWrite:true,eventsWrite:true,eventsManage:true},email:delegated.email});
 Object.assign(f.store.data.get('users/'+operator.sourceUid),{email:delegated.email});
 await assert.rejects(f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'},delegated),{code:'COMM_FORBIDDEN'});
 Object.assign(f.fa.data.get('users/'+operator.sourceUid),{email:operator.email,access:false});
 Object.assign(f.store.data.get('users/'+operator.sourceUid),{email:operator.email});
 await assert.rejects(f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'AB'}),{code:'COMM_FORBIDDEN'});
});

test('liberação de RL aparece na primeira página da própria Home mesmo após muitos avisos de terceiros',async()=>{
 const f=fixture();f.store.data.get('users/'+person.sourceUid).sigla='RL';
 f.fa.data.set('scheduleDays/2026-11-04',{highlights:{siglas:['RL'],releaseTimes:{RL:NOW-1000}}});
 for(let i=0;i<100;i++){const id='a-'+String(i).padStart(3,'0');f.store.data.set('communicationMessages/'+id,{...draft().message,id,audienceType:'USER',audienceValue:other.sourceUid});}
 const result=await f.call('SCHEDULE_RELEASE_NOTICE',{day:'2026-11-04',sigla:'RL'});
 assert.equal(result.pushEligible,false);
 const first=await f.call('INBOX',{},person);assert.equal(first.items.length,1);assert.equal(first.items[0].id,result.message.id);assert.ok(first.cursor);
 assert.equal((await f.call('INBOX',{},operator)).items.length,0);
});

test('confirmação distingue fila, ausência de aparelho, Push desativado e aceitação pelo FCM',()=>{
 assert.match(releaseNoticeFeedback({pushEnabled:true,pushEligible:true,pushQueued:true},'RL'),/fila de processamento; recebimento ainda não confirmado/);
 assert.match(releaseNoticeFeedback({pushEnabled:true,pushEligible:false,pushQueued:true},'RL'),/Nenhum aparelho com Push ativo/);
 assert.match(releaseNoticeFeedback({pushEnabled:false,pushQueued:false},'RL'),/Push está desativado/);
 assert.match(releaseNoticeFeedback({pushEnabled:true,pushEligible:true,dispatch:{status:'completed',accepted:1}},'RL'),/Push aceito pelo serviço/);
 assert.match(releaseNoticeFeedback({pushEnabled:true,pushEligible:true,dispatch:{status:'completed',failed:1,processed:1}},'RL'),/Push não foi confirmado/);
});
