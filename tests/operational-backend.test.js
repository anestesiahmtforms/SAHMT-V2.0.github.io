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
