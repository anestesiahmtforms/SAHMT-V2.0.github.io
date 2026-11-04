import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunicationService} from '../worker-communication/service.js';
import {createCommunicationWorker} from '../worker-communication/worker.js';
import {createStore} from '../worker-communication/store.js';
import {assertFreeProject} from '../worker-communication/google.js';
import {ADMINS,fail} from '../communication/domain.js';
import {COMMUNICATION_LIMITS,communicationUsagePeriod,communicationLimitMessage} from '../src/communication-usage.js';

const NOW=Date.parse('2026-11-04T15:00:00Z'),actor={uid:'ff-admin',sourceUid:'fa-admin',email:ADMINS[0],emailVerified:true};
function memory(){
 const data=new Map();let lock=Promise.resolve();
 const get=async(c,k)=>structuredClone(data.get(c+'/'+k)||null);
 const page=async(c,{limit=20,filters=[]}={})=>[...data].filter(([key,v])=>key.startsWith(c+'/')&&filters.every(([f,value])=>v[f]===value)).slice(0,limit).map(([key,v])=>({...structuredClone(v),id:key.split('/')[1]}));
 const countPublished=async(start,end)=>[...data].filter(([key,v])=>key.startsWith('communicationMessages/')&&v.firstPublishedAt>=start&&v.firstPublishedAt<end).length;
 const transaction=work=>{const result=lock.then(async()=>{const writes=[];const result=await work({get,countPublished,set:(c,k,v)=>writes.push([c+'/'+k,v]),create:(c,k,v)=>{assert.equal(data.has(c+'/'+k),false);writes.push([c+'/'+k,v]);}});for(const [key,v]of writes)data.set(key,structuredClone(v));return result;});lock=result.catch(()=>{});return result;};
 return {data,get,page,countPublished,transaction};
}
function fixture(){
 const store=memory(),fa=memory();let time=NOW;
 fa.data.set('users/'+actor.sourceUid,{uid:actor.sourceUid,email:actor.email,active:true,access:true});
 store.data.set('communicationSettings/main',{pushEnabled:false});
 const service=createCommunicationService({store,fa,now:()=>time,uuid:()=>crypto.randomUUID()});
 return {store,fa,call:(action,input={},user=actor)=>service.execute(action,input,user),advance:()=>time+=60000};
}
const draft=(id,status='published')=>({id,version:0,message:{title:'Aviso de teste',message:'Somente dados sintéticos',category:'COMUNICADO GERAL',priority:'NORMAL',audienceType:'ALL',audienceValue:'',route:'home',status,publishAt:NOW-1000,expiresAt:NOW+86400000}});

test('o antigo saldo de 200 operações não bloqueia um aviso novo nem é apagado',async()=>{
 const f=fixture();f.store.data.set('communicationBudgets/2026-11-04',{requests:200,at:NOW-1000});
 const saved=await f.call('SAVE_MESSAGE',draft('first'));
 assert.equal(saved.publicationUsage.used,1);assert.equal(saved.publicationUsage.limit,200);
 const usage=await f.call('USAGE');assert.equal(usage.operations.used,202);assert.equal(usage.operations.unclassified,200);assert.equal(usage.publications.used,1);assert.equal(usage.publications.remaining,199);
});

test('mais de 200 consultas da Home não consomem avisos publicados',async()=>{
 const f=fixture();for(let i=0;i<201;i++){if(i%10===0)f.advance();await f.call('INBOX');}
 const usage=await f.call('USAGE');assert.equal(usage.operations.used,202);assert.equal(usage.operations.reads,202);assert.equal(usage.publications.used,0);assert.equal(usage.publications.remaining,200);
});

test('saldo inicial conta publicações antigas do dia e ignora outro dia e rascunhos',async()=>{
 const f=fixture(),period=communicationUsagePeriod(NOW);
 for(let i=0;i<3;i++)f.store.data.set('communicationMessages/old-'+i,{...draft('old-'+i).message,firstPublishedAt:NOW-1000});
 f.store.data.set('communicationMessages/yesterday',{...draft('yesterday').message,firstPublishedAt:period.startsAt-1});
 await f.call('SAVE_MESSAGE',draft('draft-only','draft'));
 assert.equal((await f.call('USAGE')).publications.used,3);
 const saved=await f.call('SAVE_MESSAGE',draft('new'));assert.equal(saved.publicationUsage.used,4);
 await f.call('SAVE_MESSAGE',{...draft('new'),version:1});assert.equal((await f.call('USAGE')).publications.used,4,'editar não publica o mesmo aviso pela primeira vez novamente');
 await assert.rejects(f.call('SAVE_MESSAGE',{...draft('invalid'),message:{...draft('invalid').message,title:''}}),{code:'COMM_INVALID_INPUT'});
 assert.equal((await f.call('USAGE')).publications.used,4);
});

test('duas publicações concorrentes no último saldo liberam só uma e preservam consultas',async()=>{
 const f=fixture();f.store.data.set('communicationPublicationBudgets/2026-11-04',{published:199});
 const results=await Promise.allSettled([f.call('SAVE_MESSAGE',draft('one')),f.call('SAVE_MESSAGE',draft('two'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const rejected=results.find(r=>r.status==='rejected').reason;assert.equal(rejected.code,'COMM_DAILY_PUBLICATION_LIMIT');assert.equal(rejected.used,200);assert.equal(rejected.limit,200);
 const usage=await f.call('USAGE');assert.equal(usage.publications.used,200);assert.equal(usage.publications.remaining,0);
 assert.equal((await f.call('INBOX')).items.length,1);await f.call('SAVE_MESSAGE',draft('draft-after-cap','draft'));
});

test('limite geral continua fechando operações, mas o diagnóstico autorizado continua acessível',async()=>{
 const f=fixture();f.store.data.set('communicationBudgets/2026-11-04',{requests:COMMUNICATION_LIMITS.dailyOperations});
 await assert.rejects(f.call('INBOX'),{code:'COMM_DAILY_OPERATION_LIMIT',used:2000,limit:2000});
 const usage=await f.call('USAGE');assert.equal(usage.operations.used,2001);
 const person={...actor,email:'ordinary@example.test'};
 await assert.rejects(f.call('USAGE',{},person),{code:'COMM_FORBIDDEN'});
 f.fa.data.get('users/'+actor.sourceUid).access=false;await assert.rejects(f.call('USAGE'),{code:'COMM_FORBIDDEN'});
});

test('limite por minuto e renovação UTC permanecem independentes da cota de avisos',async()=>{
 const f=fixture();for(let i=0;i<20;i++)await f.call('BOOTSTRAP');await assert.rejects(f.call('USAGE'),{code:'COMM_RATE_LIMIT'});
 f.advance();assert.equal((await f.call('USAGE')).publications.used,0);
 assert.equal(communicationUsagePeriod(NOW).resetsAt,Date.parse('2026-11-05T00:00:00Z'));
});

test('agregação usa firstPublishedAt e participa da transação, sem baixar todos os avisos',async()=>{
 const calls=[];const store=createStore({getToken:async()=> 'synthetic',fetchImpl:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
  if(url.endsWith(':beginTransaction'))return Response.json({transaction:'test-transaction'});
  if(url.endsWith(':rollback'))return Response.json({});
  assert.ok(url.endsWith(':runAggregationQuery'));return Response.json([{result:{aggregateFields:{published:{integerValue:'7'}}}}]);
 }});
 const {startsAt,resetsAt}=communicationUsagePeriod(NOW);assert.equal(await store.countPublished(startsAt,resetsAt),7);assert.equal(await store.transaction(tx=>tx.countPublished(startsAt,resetsAt)),7);
 const queries=calls.filter(c=>c.url.endsWith(':runAggregationQuery'));assert.equal(queries[1].body.transaction,'test-transaction');
 assert.deepEqual(queries[0].body.structuredAggregationQuery.structuredQuery.where.compositeFilter.filters.map(f=>f.fieldFilter.op),['GREATER_THAN_OR_EQUAL','LESS_THAN']);
});

test('quota do provedor e orçamento interno têm códigos diferentes e não ativam faturamento',async()=>{
 const store=createStore({getToken:async()=> 'synthetic',fetchImpl:async()=>Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429})});
 await assert.rejects(store.get('communicationSettings','main'),{code:'COMM_PROVIDER_QUOTA_EXHAUSTED'});
 await assert.rejects(assertFreeProject(async()=> 'synthetic',async()=>Response.json({billingEnabled:true})),{code:'COMM_FREE_PLAN_UNCONFIRMED'});
 assert.match(communicationLimitMessage({code:'COMM_DAILY_PUBLICATION_LIMIT',used:200,limit:200,resetsAt:communicationUsagePeriod(NOW).resetsAt}),/200\/200/);
 assert.doesNotMatch(communicationLimitMessage({code:'COMM_OPERATION_WORK_LIMIT'}),/diári|Renova/);
});

test('Worker devolve somente números de diagnóstico autorizados, sem detalhes privados do erro',async()=>{
 const error=Object.assign(fail('COMM_DAILY_PUBLICATION_LIMIT',429),{used:200,limit:200,resetsAt:communicationUsagePeriod(NOW).resetsAt,privateDetail:'never expose'});
 const app=createCommunicationWorker({verify:async()=>actor,buildService:()=>({execute:async()=>{throw error;}})});
 const response=await app.fetch(new Request('https://worker.example/v1/communication',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'SAVE_MESSAGE'})}),{COMMUNICATION_ENABLED:'true',WORKERS_FREE_CONFIRMED:'true'});
 assert.equal(response.status,429);assert.deepEqual(await response.json(),{code:error.code,used:200,limit:200,resetsAt:error.resetsAt});
});
