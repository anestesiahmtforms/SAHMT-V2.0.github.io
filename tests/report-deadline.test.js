import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeReportWithDeadline} from '../src/report-deadline.js';
test('listener sem confirmação encerra a conexão e comunica indisponibilidade uma vez', async () => {
  let stopped = 0, failed = 0;
  const close = await subscribeReportWithDeadline({scope: {}, timeoutMs: 10, callbacks: {isCurrent: () => true, error: error => {assert.equal(error.code, 'deadline-exceeded'); failed++;}}, subscribe: async () => () => {stopped++;}});
  await new Promise(resolve => setTimeout(resolve, 30)); close(); close(); assert.equal(stopped, 1); assert.equal(failed, 1);
});
test('fontes confirmadas cancelam o prazo e sair da tela encerra o listener', async () => {
  let stopped = 0;
  const close = await subscribeReportWithDeadline({scope: {sourceKeys: ['catalog', 'report']}, timeoutMs: 10,
    callbacks: {isCurrent: () => true, next() {}, error: () => assert.fail('Servidor já confirmado')},
    subscribe: async hooks => {for (const key of ['catalog', 'report']) hooks.next(key, {complete: true, fromCache: false, hasPendingWrites: false}); return () => {stopped++;};}});
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(stopped, 0); close(); assert.equal(stopped, 1);
});
