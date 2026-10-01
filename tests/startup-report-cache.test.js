import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupReportCache} from '../src/startup-report-cache.js';

test('consulta começa em segundo plano e a abertura reutiliza a resposta pendente uma vez', async () => {
  const cache = createStartupReportCache();
  let resolve, reads = 0;
  cache.warm('labels:user:today', () => { reads++; return new Promise(r => {resolve = r;}); });
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(cache.take('labels:other-user:today'), null);
  const pending = cache.take('labels:user:today');
  assert.equal(cache.take('labels:user:today'), null);
  resolve({records: [], nextCursor: null});
  assert.deepEqual(await pending, {records: [], nextCursor: null});
});
test('falha ou dados offline não são conservados como relatório sincronizado', async () => {
  const cache = createStartupReportCache();
  await assert.rejects(cache.warm('failure', () => {throw new Error('rede');}));
  assert.equal(cache.take('failure'), null);
  await assert.rejects(cache.warm('offline', () => ({stale: true, records: []})));
  assert.equal(cache.take('offline'), null);
});
test('expiração e limpeza após mudança de usuário ou escrita impedem reaproveitamento', async () => {
  let time = 0;
  const cache = createStartupReportCache({now: () => time, ttl: 30000});
  await cache.warm('today', () => ({records: []}));
  time = 30000;
  assert.equal(cache.take('today'), null);
  let resolve;
  const pending = cache.warm('other', () => new Promise(r => {resolve = r;}));
  await Promise.resolve(); cache.clear(); resolve({records: []}); await pending;
  assert.equal(cache.take('other'), null);
});
