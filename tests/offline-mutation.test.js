import test from 'node:test';
import assert from 'node:assert/strict';
import {persistOperationalMutation} from '../src/offline-mutation.js';

test('confirmação que chega depois do prazo da tela também limpa a fila local', async () => {
 let finish,local=true,cleanups=0;
 const result=await persistOperationalMutation({id:'late',online:true,timeoutMs:5,saveLocal:async()=>{},
  sendRemote:()=>new Promise(resolve=>{finish=resolve;}),clearLocal:async()=>{local=false;cleanups++;},
  recoverable:error=>error.code==='deadline-exceeded'});
 assert.equal(result.pendingFirestore,true);assert.equal(local,true);
 finish({id:'late',pendingFirestore:false});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(local,false);assert.equal(cleanups,1);
});
test('gravação online também é persistida antes de tocar no backend', async () => {
  const order = [];
  const result = await persistOperationalMutation({id: 'stable', online: true, saveLocal: async () => order.push('local'), sendRemote: async () => {order.push('remote'); return {id: 'stable'};}, clearLocal: async () => order.push('confirmed'), recoverable: () => true});
  assert.deepEqual(order, ['local', 'remote', 'confirmed']); assert.equal(result.id, 'stable');
});
test('rede travada encerra a espera da tela e conserva a operação já persistida', async () => {
  let durable = false;
  const result = await persistOperationalMutation({id: 'stable', online: true, timeoutMs: 10, saveLocal: async () => {durable = true;}, sendRemote: () => new Promise(() => {}), clearLocal: async () => {durable = false;}, recoverable: error => error.code === 'deadline-exceeded'});
  assert.equal(durable, true); assert.equal(result.pendingFirestore, true);
});
test('sem rede não envia; recusa de permissão é comunicada sem descartar o registro local', async () => {
  let saves = 0, sends = 0;
  const deps = {id: 'stable', saveLocal: async () => {saves++;}, sendRemote: async () => {sends++; throw {code: 'permission-denied'};}, clearLocal: () => assert.fail('Não apagar'), recoverable: () => false};
  assert.equal((await persistOperationalMutation({...deps, online: false})).pendingFirestore, true);
  await assert.rejects(persistOperationalMutation({...deps, online: true}), {code: 'permission-denied'});
  assert.equal(saves, 2); assert.equal(sends, 1);
});


test('recusa tardia após o prazo conserva o registro e nunca confirma envio',async()=>{
 let rejectRemote,cleanups=0;
 await persistOperationalMutation({id:'late-failure',online:true,timeoutMs:5,saveLocal:async()=>{},
  sendRemote:()=>new Promise((_,reject)=>{rejectRemote=reject;}),clearLocal:async()=>{cleanups++;},
  recoverable:error=>error.code==='deadline-exceeded'});
 rejectRemote(Object.assign(Error('synthetic'),{code:'permission-denied'}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cleanups,0);
});
