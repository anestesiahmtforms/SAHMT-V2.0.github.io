import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationalBackend} from '../src/operational-backend.js';

test('consultas iguais compartilham a chamada e contabilizam documentos sem identificar pessoas', async () => {
  const gate = createOperationalBackend(); let finish, calls = 0;
  const read = () => {calls++; return new Promise(resolve => {finish = resolve;});};
  const a = gate.run('fixture', read), b = gate.run('fixture', read);
  await Promise.resolve(); finish({docs: [{}, {}]});
  await Promise.all([a, b]);
  assert.equal(calls, 1); assert.equal(gate.snapshot().calls, 1); assert.equal(gate.snapshot().documentsReceived, 2);
  assert.equal(JSON.stringify(gate.snapshot()).includes('fixture'), false);
});
test('quota pausa novas consultas e libera uma tentativa após espera com jitter', async () => {
  let clock = 1000, calls = 0; const gate = createOperationalBackend({now: () => clock, random: () => .5});
  await assert.rejects(gate.run('a', async () => {calls++; throw {code: 'resource-exhausted'};}), {code: 'resource-exhausted'});
  await assert.rejects(gate.run('b', async () => {calls++;}), {code: 'resource-exhausted'});
  assert.equal(calls, 1); assert.ok(gate.snapshot().nextRetryAt >= clock + 300000);
  clock = gate.snapshot().nextRetryAt + 1;
  await gate.run('b', async () => {calls++; return {docs: []};}); assert.equal(calls, 2);
});
test('prazo de leitura termina sem esperar uma conexão travada', async () => {
  const gate = createOperationalBackend({timeoutMs: 10});
  await assert.rejects(gate.run('a', () => new Promise(() => {})), {code: 'deadline-exceeded'});
});
test('recusa de permissão bloqueia o cache do escopo e não paralisa outros módulos', async () => {
  const gate = createOperationalBackend();
  await assert.rejects(gate.run('private', async () => {throw {code: 'permission-denied'};}), {code: 'permission-denied'});
  assert.throws(() => gate.assertCacheAllowed('private'), {code: 'permission-denied'});
  assert.doesNotThrow(() => gate.assertCacheAllowed('other'));
  await gate.run('other', async () => ({docs: []}));
});

test('sucesso de outra consulta já em andamento não cancela a pausa por cota', async () => {
  let finish;
  const gate = createOperationalBackend();
  const slow = gate.run('slow', () => new Promise(resolve => {finish = resolve;}));
  await assert.rejects(gate.run('quota', async () => {throw {code: 'resource-exhausted'};}));
  finish([]); await slow;
  assert.equal(gate.snapshot().code, 'resource-exhausted');
  await assert.rejects(gate.run('third', () => assert.fail('Não repetir consulta durante a pausa')), {code: 'resource-exhausted'});
});
test('timeout não abandona a consulta real nem permite duplicá-la', async () => {
  let finish,calls=0;
  const gate=createOperationalBackend({timeoutMs:5});
  await assert.rejects(gate.run('same',()=>{calls++;return new Promise(resolve=>finish=resolve);}),{code:'deadline-exceeded'});
  gate.reset();await assert.rejects(gate.run('same',()=>{calls++;return [];}),{code:'deadline-exceeded'});
  assert.equal(calls,1);finish([]);await new Promise(resolve=>setImmediate(resolve));
  gate.reset();await gate.run('same',()=>{calls++;return [];});assert.equal(calls,2);
});
test('reset e force não contornam a pausa de cota; falha concorrente não a encurta', async () => {
  let clock=1000;const gate=createOperationalBackend({now:()=>clock,random:()=>0});
  gate.noteFailure({code:'resource-exhausted'},'a');const until=gate.snapshot().nextRetryAt;
  gate.noteFailure({code:'unavailable'},'b');assert.ok(gate.snapshot().nextRetryAt>=until);
  gate.reset();await assert.rejects(gate.run('c',()=>assert.fail('Não chamar'),{force:true}),{code:'resource-exhausted'});
  clock=gate.snapshot().nextRetryAt+1;await gate.run('c',async()=>[]);assert.equal(gate.snapshot().code,'');
});
test('pausa de cota persiste após recarregar sem armazenar identidade ou dados', async () => {
  let value=null;const storage={getItem:()=>value,setItem:(key,item)=>value=item,removeItem:()=>value=null};
  const a=createOperationalBackend({now:()=>1000,random:()=>0,storage});a.noteFailure({code:'resource-exhausted'},'private-user-key');
  assert.deepEqual(Object.keys(JSON.parse(value)),['retryAt']);assert.ok(!value.includes('private'));
  const b=createOperationalBackend({now:()=>2000,storage});
  await assert.rejects(b.run('b',()=>assert.fail('Não consultar')),{code:'resource-exhausted'});
});
test('armazenamento recusado ou corrompido não impede leituras autorizadas', async () => {
  const a=createOperationalBackend({storage:{getItem:()=>{throw Error();},removeItem:()=>{throw Error();}}});
  await a.run('a',async()=>[]);
  const b=createOperationalBackend({storage:{getItem:()=>'{invalid'}});await b.run('b',async()=>[]);
});
test('resposta tardia de cota após timeout também instala a pausa', async () => {
  let fail;const gate=createOperationalBackend({timeoutMs:5});
  await assert.rejects(gate.run('late',()=>new Promise((resolve,reject)=>fail=reject)),{code:'deadline-exceeded'});
  fail({code:'resource-exhausted'});await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(gate.run('other',()=>assert.fail('Não consultar')),{code:'resource-exhausted'});
});

test('late server result reaches coalesced observers once and clears its own timeout',async()=>{
 let finish,calls=0;const results=[],gate=createOperationalBackend({timeoutMs:5});
 await assert.rejects(gate.run('profile',()=>{calls++;return new Promise(resolve=>finish=resolve);},{onLateResult:value=>results.push(['first',value])}),{code:'deadline-exceeded'});
 await assert.rejects(gate.run('profile',()=>assert.fail('No duplicate read'),{onLateResult:value=>results.push(['second',value])}),{code:'deadline-exceeded'});
 finish('confirmed');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);assert.deepEqual(results,[['first','confirmed'],['second','confirmed']]);
 assert.equal(gate.snapshot().code,'');assert.equal(gate.snapshot().inFlight,0);assert.equal(gate.snapshot().documentsReceived,1);
});

test('late success never clears another request quota and late permission denial is reported',async()=>{
 let finish,reject;const results=[],gate=createOperationalBackend({timeoutMs:5});
 await assert.rejects(gate.run('slow',()=>new Promise(resolve=>finish=resolve)));
 gate.noteFailure({code:'resource-exhausted'},'quota');finish([]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(gate.snapshot().code,'resource-exhausted');
 const other=createOperationalBackend({timeoutMs:5});
 await assert.rejects(other.run('profile',()=>new Promise((_resolve,fail)=>reject=fail),{onLateResult:(_value,error)=>results.push(error.code)}));
 reject({code:'permission-denied'});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(results,['permission-denied']);assert.throws(()=>other.assertCacheAllowed('profile'),{code:'permission-denied'});
});
