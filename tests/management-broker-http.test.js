import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementBrokerHttp} from '../scripts/lib/management-broker-http.js';
const origin='https://anestesiahmtforms.github.io', endpoint='https://example.invalid/v1/management/session';
const token='synthetic-private-fa-token', customToken='synthetic-private-fb-token';
const granted=()=>({ok:true,sourceProjectId:'sahmt-17a16',destinationProjectId:'sahmt-gestao-5ae66',
  faUid:'uid-a',fbUid:'uid-a',memberId:'member-a',leaseVersion:1,policyVersion:'policy-v1',customToken});
const request=(options={})=>new Request(options.url||endpoint,{method:options.method||'POST',
  headers:{Origin:origin,'Content-Type':'application/json',...options.headers},
  body:options.body??(options.method==='GET'||options.method==='OPTIONS'?undefined:JSON.stringify({faIdToken:token})),
  signal:options.signal,...options.requestOptions});
function harness(options={}) {
  const calls=[];
  const handle=createManagementBrokerHttp({enabled:true,maxRequestMs:1000,cleanupDrainMs:50,superviseExchange:()=>true,
    admitRequest:async (metadata,context)=>{calls.push(['admit',metadata,context]);return true;},
    broker:{exchange:async (body,context)=>{calls.push(['exchange',body,context]);return granted();}},...options});
  return {handle,calls};
}
const denied=async(response,status,code)=>{assert.equal(response.status,status);const body=await response.json();assert.equal(body.ok,false);assert.equal(body.code,code);assert.equal(Object.hasOwn(body,'customToken'),false);return body;};
test('HTTP desligado não admite nem troca token',async()=>{
  const {calls}=harness();
  const handle=createManagementBrokerHttp({broker:{exchange:()=>calls.push('unexpected')}});
  await denied(await handle(request()),503,'BROKER_HTTP_DISABLED');assert.equal(calls.length,0);
});
test('política, broker e admissão explícitos obrigatórios',async t=>{
  for(const field of ['broker','admitRequest','superviseExchange','maxRequestMs','cleanupDrainMs']) await t.test(field,async()=>{
    const {handle,calls}=harness({[field]:undefined});await denied(await handle(request()),503,'BROKER_HTTP_NOT_CONFIGURED');assert.equal(calls.length,0);
  });
});
test('sucesso entrega somente resposta whitelisted no-store ao domínio exato',async()=>{
  const {handle,calls}=harness({broker:{exchange:async(body,context)=>{calls.push(['exchange',body,context]);return {...granted(),rawProfile:{secret:true},password:'not-returned'};}}});
  const response=await handle(request()), body=await response.json();
  assert.equal(response.status,200);assert.deepEqual(body,granted());
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(response.headers.get('Vary'),'Origin');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.deepEqual(calls[1][1],{faIdToken:token});assert.ok(calls[1][2].signal instanceof AbortSignal);
});
test('origem ausente, diferente ou com sufixo não admitida',async t=>{
  for(const value of ['',origin+'.evil.invalid','https://other.invalid']) await t.test(value||'absent',async()=>{
    const {handle,calls}=harness();const response=await handle(request({headers:{Origin:value}}));
    await denied(response,403,'BROKER_ORIGIN_DENIED');assert.equal(response.headers.has('Access-Control-Allow-Origin'),false);assert.equal(calls.length,0);
  });
});
test('HTTPS e rota fixa sem query fragmento ou token em URL',async t=>{
  for(const url of ['http://example.invalid/v1/management/session',endpoint+'?token='+token,endpoint+'#fragment']) await t.test(url,async()=>{
    const {handle,calls}=harness();await denied(await handle(request({url})),400,'BROKER_URL_INVALID');assert.equal(calls.length,0);
  });
  const {handle}=harness();await denied(await handle(request({url:'https://example.invalid/other'})),404,'BROKER_ROUTE_NOT_FOUND');
});
test('preflight não chama admissão, Auth nem Firestore',async()=>{
  const {handle,calls}=harness();const response=await handle(request({method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}}));
  assert.equal(response.status,204);assert.equal(await response.text(),'');assert.deepEqual(calls,[]);
  await denied(await handle(request({method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'}})),403,'BROKER_HEADERS_DENIED');
});
test('método, content-type, cookies e Authorization recusados antes da admissão',async t=>{
  for(const [options,status,code] of [
    [{method:'GET'},405,'BROKER_METHOD_DENIED'],
    [{headers:{'Content-Type':'text/plain'}},415,'BROKER_CONTENT_TYPE_INVALID'],
    [{headers:{Authorization:'Bearer '+token}},400,'BROKER_HEADERS_DENIED'],
    [{headers:{Cookie:'token='+token}},400,'BROKER_HEADERS_DENIED']
  ]) await t.test(code+status,async()=>{const {handle,calls}=harness();await denied(await handle(request(options)),status,code);assert.equal(calls.length,0);});
});
test('somente faIdToken no JSON; nenhuma identidade/permissão do corpo é aceita',async t=>{
  for(const body of ['{','null','[]',JSON.stringify({faIdToken:token,uid:'other'}),JSON.stringify({faIdToken:''}),JSON.stringify({faIdToken:10})])
    await t.test(body.slice(0,12),async()=>{const {handle,calls}=harness();await denied(await handle(request({body})),400,'BROKER_BODY_INVALID');assert.equal(calls.filter(v=>v[0]==='exchange').length,0);});
});
test('limite por bytes não depende do Content-Length',async()=>{
  const {handle,calls}=harness();await denied(await handle(request({body:JSON.stringify({faIdToken:'x'.repeat(22000)})})),413,'BROKER_BODY_TOO_LARGE');
  await denied(await handle(request({headers:{'Content-Length':'22000'}})),413,'BROKER_BODY_TOO_LARGE');
  assert.equal(calls.filter(v=>v[0]==='exchange').length,0);
});
test('admissão recusada não consome corpo nem troca token',async()=>{
  const {handle,calls}=harness({admitRequest:async()=>false});await denied(await handle(request()),429,'BROKER_REQUEST_LIMITED');assert.deepEqual(calls,[]);
});
test('erros brutos não aparecem em resposta',async()=>{
  const {handle}=harness({broker:{exchange:async()=>{throw new Error(token+' '+customToken);}}});
  const response=await handle(request()), text=await response.text();assert.equal(response.status,503);assert.equal(text.includes(token),false);assert.equal(text.includes(customToken),false);
});
test('negação nunca reproduz token ou documento adicionados pelo adaptador',async()=>{
  const {handle}=harness({broker:{exchange:async()=>({ok:false,code:'FA_TOKEN_REJECTED',customToken,rawProfile:{secret:true}})}});
  const body=await denied(await handle(request()),403,'FA_TOKEN_REJECTED');assert.deepEqual(Object.keys(body).sort(),['code','ok','requiresReconciliation']);
});
test('identidade/projeto/resposta divergentes bloqueiam token e exigem reconciliação',async t=>{
  for(const patch of [{fbUid:'other'},{destinationProjectId:'other'},{leaseVersion:0},{customToken:''},{policyVersion:'invalid/value'}]) await t.test(JSON.stringify(Object.keys(patch)),async()=>{
    const {handle}=harness({broker:{exchange:async()=>({...granted(),...patch})}});
    assert.equal((await denied(await handle(request()),502,'BROKER_RESPONSE_INVALID')).requiresReconciliation,true);
  });
});
test('admissão travada tem prazo real e nenhuma troca tardia',async()=>{
  const {handle,calls}=harness({maxRequestMs:20,admitRequest:()=>new Promise(()=>{})});
  await denied(await handle(request()),504,'BROKER_HTTP_DEADLINE_EXCEEDED');assert.equal(calls.length,0);
});
test('corpo travado ou cancelamento demorado não prende resposta',async()=>{
  const body=new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})});
  const {handle,calls}=harness({maxRequestMs:20});
  const response=await handle(request({body,requestOptions:{duplex:'half'}}));
  await denied(response,504,'BROKER_HTTP_DEADLINE_EXCEEDED');assert.equal(calls.filter(v=>v[0]==='exchange').length,0);
});
test('timeout aborta broker e resposta tardia não retorna token',async()=>{
  let resolve, signal;
  const {handle}=harness({maxRequestMs:20,broker:{exchange:(_body,context)=>{signal=context.signal;return new Promise(yes=>{resolve=yes;});}}});
  const response=await handle(request());const body=await denied(response,504,'BROKER_HTTP_DEADLINE_EXCEEDED');
  assert.equal(body.requiresReconciliation,true);assert.equal(signal.aborted,true);resolve(granted());await new Promise(yes=>setImmediate(yes));
});
test('requisição já cancelada não chega à admissão',async()=>{
  const controller=new AbortController();controller.abort();
  const {handle,calls}=harness();await denied(await handle(request({signal:controller.signal})),504,'BROKER_HTTP_DEADLINE_EXCEEDED');assert.equal(calls.length,0);
});
test('cancelamento do cliente chega ao broker sem token na resposta',async()=>{
  const controller=new AbortController();
  const {handle}=harness({broker:{exchange:async(_body,context)=>{controller.abort();assert.equal(context.signal.aborted,true);return granted();}}});
  await denied(await handle(request({signal:controller.signal})),504,'BROKER_HTTP_DEADLINE_EXCEEDED');
});

test('supervisor ausente/recusado bloqueia antes da troca',async()=>{
  const {handle,calls}=harness({superviseExchange:()=>false});
  await denied(await handle(request()),503,'BROKER_SUPERVISOR_REJECTED');
  assert.equal(calls.filter(v=>v[0]==='exchange').length,0);
});
test('supervisor recebe conclusão sanitizada sem token/Response',async()=>{
  let completion, metadata;
  const {handle}=harness({superviseExchange:(value,details)=>{completion=value;metadata=details;return true;}});
  assert.equal((await handle(request())).status,200);
  assert.deepEqual(await completion,{settled:true,started:true,requiresReconciliation:false,code:'BROKER_COMPLETED'});
  assert.equal(JSON.stringify(await completion).includes(customToken),false);
  assert.ok(metadata.maximumLifetimeMs<=1050);
});
test('supervisão limitada registra resultado desconhecido de broker que nunca resolve',async()=>{
  let completion;
  const {handle}=harness({maxRequestMs:20,cleanupDrainMs:15,superviseExchange:value=>{completion=value;return true;},
    broker:{exchange:()=>new Promise(()=>{})}});
  await denied(await handle(request()),504,'BROKER_HTTP_DEADLINE_EXCEEDED');
  assert.deepEqual(await completion,{settled:false,started:true,requiresReconciliation:true,code:'BROKER_COMPLETION_UNCONFIRMED'});
});
test('chunks vazios ou leitura fragmentada sem limite não monopolizam microtasks',async()=>{
  for(const empty of [true,false]) {
    let count=0;
    const body=new ReadableStream({pull(controller){count++;controller.enqueue(new Uint8Array(empty?0:1));}});
    const {handle,calls}=harness();
    await denied(await handle(request({body,requestOptions:{duplex:'half'}})),400,'BROKER_BODY_INVALID');
    assert.ok(count<520);assert.equal(calls.filter(v=>v[0]==='exchange').length,0);
  }
});

test('prazo monotônico impede troca após admissão imediata que excedeu limite',async t=>{
  let time=0; t.mock.method(performance,'now',()=>time);
  const {handle,calls}=harness({maxRequestMs:10,admitRequest:async()=>{time=11;return true;}});
  await denied(await handle(request()),504,'BROKER_HTTP_DEADLINE_EXCEEDED');
  assert.equal(calls.filter(v=>v[0]==='exchange').length,0);
});
test('prazo monotônico limita body antes de timers executarem',async t=>{
  let time=0; t.mock.method(performance,'now',()=>time);
  let reads=0;
  const body=new ReadableStream({pull(controller){time+=6;reads++;controller.enqueue(new Uint8Array([32]));}});
  const {handle,calls}=harness({maxRequestMs:10});
  await denied(await handle(request({body,requestOptions:{duplex:'half'}})),504,'BROKER_HTTP_DEADLINE_EXCEEDED');
  assert.equal(calls.filter(v=>v[0]==='exchange').length,0);assert.ok(reads<10);
});
test('prazo monotônico não entrega token retornado antes do timer mas após limite',async t=>{
  let time=0,completion;t.mock.method(performance,'now',()=>time);
  const {handle}=harness({maxRequestMs:10,superviseExchange:value=>{completion=value;return true;},
    broker:{exchange:async()=>{time=11;return granted();}}});
  const result=await denied(await handle(request()),504,'BROKER_HTTP_DEADLINE_EXCEEDED');
  assert.equal(result.requiresReconciliation,true);
  assert.equal((await completion).requiresReconciliation,true);
});
