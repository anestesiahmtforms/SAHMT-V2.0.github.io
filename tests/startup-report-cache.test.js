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

function liveLease(id, events = []) {
  const controller = {id};
  return {controller, close: () => events.push(`close:${id}`)};
}

test('listener pré-carregado é transferido uma vez sem iniciar consulta ou fechar o controller', () => {
  const events = [], cache = createStartupReportCache(), lease = liveLease('labels:user:today', events);
  assert.equal(cache.holdLive('labels:user:today', lease), lease);
  assert.equal(cache.takeLive('labels:other-user:today'), null);
  assert.equal(cache.takeLive('labels:user:today'), lease);
  assert.equal(cache.takeLive('labels:user:today'), null);
  cache.clear();
  assert.deepEqual(events, []);
});

test('holdLive com a mesma lease não duplica ownership nem reinicia o prazo', () => {
  let time = 0;
  const events = [], cache = createStartupReportCache({now: () => time, ttl: 30000}), lease = liveLease('same', events);
  cache.holdLive('same', lease); time = 20000; cache.holdLive('same', lease);
  assert.deepEqual(events, []); time = 30000;
  assert.equal(cache.takeLive('same'), null); assert.deepEqual(events, ['close:same']);
});

test('takeLive expira no limite de 30 segundos e fecha ownership apenas uma vez', () => {
  let time = 0;
  const events = [], cache = createStartupReportCache({now: () => time, ttl: 30000});
  cache.holdLive('valid', liveLease('valid', events)); time = 29999;
  assert.equal(cache.takeLive('valid').controller.id, 'valid');
  cache.holdLive('expired', liveLease('expired', events)); time = 59999;
  assert.equal(cache.takeLive('expired'), null); assert.equal(cache.takeLive('expired'), null);
  cache.clear(); assert.deepEqual(events, ['close:expired']);
});

test('substituição fecha listener anterior antes de registrar o substituto', () => {
  const events = [], cache = createStartupReportCache();
  const old = {controller: {id: 'old'}, close: () => {events.push('close:old'); assert.equal(cache.takeLive('same'), null);}};
  cache.holdLive('same', old); const replacement = liveLease('new', events); cache.holdLive('same', replacement);
  assert.deepEqual(events, ['close:old']); assert.equal(cache.takeLive('same'), replacement);
  cache.clear(); assert.deepEqual(events, ['close:old']);
});

test('limpeza por logout/permissão fecha todos os listeners sem fechar os já transferidos', () => {
  const events = [], cache = createStartupReportCache();
  cache.holdLive('events:user:today:permissionsA', liveLease('events', events));
  cache.holdLive('labels:user:today:permissionsA', liveLease('labels', events));
  const transferred = liveLease('checklists', events); cache.holdLive('checklists:user:today:permissionsA', transferred);
  assert.equal(cache.takeLive('checklists:user:today:permissionsA'), transferred);
  cache.clear(); cache.clear();
  assert.deepEqual(events, ['close:events', 'close:labels']);
  assert.equal(cache.takeLive('events:user:today:permissionsA'), null);
  assert.equal(cache.takeLive('labels:user:today:permissionsA'), null);
});

test('late worker resolution after clear does not repopulate promises or live ownership', async () => {
  let resolve;
  const events = [], cache = createStartupReportCache();
  const pending = cache.warm('old', () => new Promise(r => {resolve = r;}));
  cache.holdLive('old', liveLease('old', events)); await Promise.resolve();
  cache.clear(); resolve({records: [{id: 'private'}]}); await pending;
  assert.equal(cache.take('old'), null); assert.equal(cache.takeLive('old'), null);
  assert.deepEqual(events, ['close:old']);
});

test('rejection of an old promise cannot delete new ownership after clear', async () => {
  let reject;
  const cache = createStartupReportCache();
  const old = cache.warm('same', () => new Promise((_, no) => {reject = no;})); await Promise.resolve();
  cache.clear(); const replacement = cache.warm('same', () => ({records: [{id: 'new'}]}));
  const lease = liveLease('new'); cache.holdLive('same', lease); reject(new Error('late failure')); await assert.rejects(old);
  assert.equal(cache.take('same'), replacement); assert.equal(cache.takeLive('same'), lease);
});

test('legacy warm/take is independent of live ownership and single-use semantics remain', async () => {
  const events = [], cache = createStartupReportCache(), lease = liveLease('same', events);
  let reads = 0;
  const first = cache.warm('same', () => {reads++; return {records: []};});
  assert.equal(cache.warm('same', () => {reads++;}), first);
  cache.holdLive('same', lease); await first;
  assert.equal(cache.take('same'), first); assert.equal(cache.take('same'), null);
  assert.equal(cache.takeLive('same'), lease); assert.equal(reads, 1); assert.deepEqual(events, []);
});

test('cleanup exceptions still release all in-memory leases and allow replacement', () => {
  const events = [], cache = createStartupReportCache();
  cache.holdLive('throw', {controller: {}, close: () => {events.push('throw'); throw new Error('cleanup');}});
  cache.holdLive('next', liveLease('next', events)); assert.doesNotThrow(() => cache.clear());
  assert.deepEqual(events, ['throw', 'close:next']); assert.equal(cache.takeLive('throw'), null); assert.equal(cache.takeLive('next'), null);
  cache.holdLive('throw', {controller: {}, close: () => {throw new Error('cleanup');}});
  const replacement = liveLease('replacement'); assert.doesNotThrow(() => cache.holdLive('throw', replacement)); assert.equal(cache.takeLive('throw'), replacement);
});

test('invalid lease does not discard a valid existing listener', () => {
  const cache = createStartupReportCache(), existing = liveLease('existing'); cache.holdLive('key', existing);
  for (const invalid of [null, {}, {controller: {}}, {close() {}}, {controller: {}, close: false}]) assert.throws(() => cache.holdLive('key', invalid));
  assert.equal(cache.takeLive('key'), existing);
});

test('warm-to-open handoff retains the same live controller without another subscription', async () => {
  const {createLiveReportSession} = await import('../src/live-report-session.js');
  let subscriptions = 0, stops = 0; let hooks;
  const controller = createLiveReportSession({subscribe: (_scope, nextHooks) => {subscriptions++; hooks=nextHooks; return () => stops++;}});
  const cache = createStartupReportCache();
  const key = 'labels:user:today:read';
  controller.start({key, uid:'user', module:'labels', phase:'warm'});
  hooks.next({data:{records:[]}, fromCache:false, hasPendingWrites:false});
  cache.holdLive(key, {controller, close: () => controller.close()});
  const transferred = cache.takeLive(key); transferred.controller.start({key, uid:'user', module:'labels', phase:'open'});
  cache.clear(); assert.equal(subscriptions,1); assert.equal(stops,0); assert.equal(transferred.controller.snapshot().confirmed,true);
  transferred.controller.close(); assert.equal(stops,1);
});
