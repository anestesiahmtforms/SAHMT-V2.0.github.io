import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker-fi-operacional/retired.js';
test('retired FI refuses session exchanges and performs no work even with old active configuration', async () => {
  const env = {MODULE_CUTOVER_ACTIVE:'true', ALLOWED_ORIGINS:'https://example.test',
    get MODULE_SERVICE_ACCOUNT_JSON() {throw Error('RETIRED_SERVICE_MUST_NOT_USE_CREDENTIALS');}};
  await worker.scheduled({}, env, {waitUntil() {throw Error('RETIRED_SERVICE_MUST_NOT_SCHEDULE_WORK');}});
  const response = await worker.fetch(new Request('https://fi.test/v1/session', {method:'POST', headers:{Origin:'https://example.test'}, body:'{}'}), env);
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'DOMAIN_MODULE_RETIRED');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://example.test');
  const health = await worker.fetch(new Request('https://fi.test/health'), env);
  assert.deepEqual(await health.json(), {station:'FI', projectId:'sahmt-operacional-fi', cutoverActive:false, retired:true, destination:'FJ'});
});
