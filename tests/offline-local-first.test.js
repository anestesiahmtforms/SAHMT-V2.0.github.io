import test from 'node:test';
import assert from 'node:assert/strict';
import {readThroughSafeCache} from '../src/offline-cache.js';

test('leitura local vem antes do resultado remoto e a atualização ocorre em segundo plano', async () => {
  const updates = [], writes = [];
  const result = await readThroughSafeCache({uid: 'fixture', kind: 'contacts', id: 'active', localFirst: true,
    readCache: async () => ({uid: 'fixture', kind: 'contacts', cachedAt: Date.now() - 60000, data: [{id: 'local'}]}),
    fetchOnline: async () => [{id: 'remote'}], writeCache: async (...args) => writes.push(args),
    mayFallback: () => true, onRefresh: value => updates.push(value)});
  assert.equal(result[0].id, 'local'); assert.equal(result.stale, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(updates[0][0].id, 'remote'); assert.equal(writes.length, 1);
});
