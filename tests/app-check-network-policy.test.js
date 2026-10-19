import test from 'node:test';
import assert from 'node:assert/strict';
import {withAppCheckTokenDeadline} from '../src/app-check-network-policy.js';

test('sem internet não inicia o reCAPTCHA nem fornece atestado falso', async () => {
  await assert.rejects(withAppCheckTokenDeadline(() => assert.fail('Não iniciar serviço externo'), {online: false}), {code: 'app-check/network-unavailable'});
});
test('reCAPTCHA bloqueado não mantém a autenticação esperando indefinidamente', async () => {
  await assert.rejects(withAppCheckTokenDeadline(() => new Promise(() => {}), {timeoutMs: 10}), {code: 'app-check/token-request-timeout'});
});
test('atestado válido e falha de serviço preservam os resultados originais', async () => {
  const token = {token: 'synthetic-only', expireTimeMillis: 123};
  assert.equal(await withAppCheckTokenDeadline(async () => token), token);
  await assert.rejects(withAppCheckTokenDeadline(async () => {throw Object.assign(new Error('fixture'), {code: 'app-check/service-unavailable'});}), {code: 'app-check/service-unavailable'});
});
