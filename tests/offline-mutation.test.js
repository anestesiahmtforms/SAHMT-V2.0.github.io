import test from 'node:test';
import assert from 'node:assert/strict';
import {persistOperationalMutation} from '../src/offline-mutation.js';
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
