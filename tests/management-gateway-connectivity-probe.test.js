import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProbeCliArgs, runConnectivityProbe, validateProbeEndpoint} from '../scripts/management-gateway-connectivity-probe.mjs';

const ENDPOINT = `https://script.google.com/macros/s/${'A'.repeat(30)}/exec`;
const REDIRECT = 'https://script.googleusercontent.com/macros/echo?user_content_key=synthetic-one-time-key';

function response(url, body, {status = 200, headers = {}, redirected = false} = {}) {
  return {url, status, redirected, headers: new Headers(headers), body: body === null ? null : new Response(body).body};
}

test('probe requires explicit one-shot flag and a fixed Apps Script endpoint', () => {
  assert.deepEqual(parseProbeCliArgs([]), {ok: false, code: 'PROBE_SEND_ONCE_REQUIRED'});
  assert.deepEqual(parseProbeCliArgs(['--url', ENDPOINT]), {ok: false, code: 'PROBE_SEND_ONCE_REQUIRED'});
  assert.equal(parseProbeCliArgs(['--url', ENDPOINT, '--send-once']).ok, true);
  for (const value of ['http://script.google.com/macros/s/' + 'A'.repeat(30) + '/exec',
    'https://attacker.invalid/macros/s/' + 'A'.repeat(30) + '/exec', ENDPOINT + '?x=1',
    'https://script.google.com.evil.invalid/macros/s/' + 'A'.repeat(30) + '/exec'])
    assert.throws(() => validateProbeEndpoint(value), /PROBE_ENDPOINT_INVALID/);
});

test('valid probe sends one synthetic POST then one allowlisted GET without credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (options.method === 'POST') return response(ENDPOINT, null,
      {status: 302, headers: {location: REDIRECT}});
    return response(REDIRECT, JSON.stringify({ok: false, code: 'GATEWAY_ADMISSION_DENIED'}),
      {headers: {'content-type': 'application/json', 'content-length': '48'}});
  };
  const result = await runConnectivityProbe({endpoint: ENDPOINT, fetchImpl});
  assert.deepEqual(result, {ok: true, code: 'GATEWAY_CONNECTIVITY_DENY_REDIRECT_OK', postStatus: 302,
    finalStatus: 200, denialCode: 'GATEWAY_ADMISSION_DENIED', outboundRequests: 2});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['Accept', 'Content-Type'].sort());
  assert.equal(calls[0].options.body, JSON.stringify({probe: 'SAHMT_GATEWAY_CONNECTIVITY_V1'}));
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.deepEqual(calls[1].options.headers, {Accept: 'application/json'});
  assert.equal(calls[1].options.body, undefined);
  assert.equal(JSON.stringify(result).includes('synthetic-one-time-key'), false);
});

test('probe rejects untrusted or malformed Content Service redirects without following them', async () => {
  for (const location of ['https://evil.invalid/macros/echo?user_content_key=x',
    'https://script.googleusercontent.com/other?user_content_key=x',
    'https://script.googleusercontent.com/macros/echo?user_content_key=x&user_content_key=y',
    'https://user:pass@script.googleusercontent.com/macros/echo?user_content_key=x']) {
    let calls = 0;
    const result = await runConnectivityProbe({endpoint: ENDPOINT, fetchImpl: async () => {
      calls++;
      return response(ENDPOINT, null, {status: 302, headers: {location}});
    }});
    assert.deepEqual(result, {ok: false, code: 'PROBE_REDIRECT_DENIED', postStatus: 302, finalStatus: null});
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes('user_content_key'), false);
    assert.equal(JSON.stringify(result).includes('evil.invalid'), false);
  }
});

test('probe fails closed on an unexpected status, extra redirect, bad response, or non-denial body', async t => {
  await t.test('unexpected first status', async () => {
    let calls = 0;
    const result = await runConnectivityProbe({endpoint: ENDPOINT, fetchImpl: async () => {
      calls++;
      return response(ENDPOINT, '{}', {status: 200, headers: {'content-type': 'application/json'}});
    }});
    assert.equal(result.code, 'PROBE_REDIRECT_STATUS_INVALID');
    assert.equal(calls, 1);
  });
  await t.test('second redirect is rejected', async () => {
    const result = await runConnectivityProbe({endpoint: ENDPOINT, fetchImpl: async (url, options) => options.method === 'POST'
      ? response(ENDPOINT, null, {status: 303, headers: {location: REDIRECT}})
      : response(REDIRECT, '{}', {status: 302, redirected: true})});
    assert.equal(result.code, 'PROBE_FINAL_RESPONSE_INVALID');
  });
  await t.test('only the expected generic denial is accepted', async () => {
    const result = await runConnectivityProbe({endpoint: ENDPOINT, fetchImpl: async (url, options) => options.method === 'POST'
      ? response(ENDPOINT, null, {status: 302, headers: {location: REDIRECT}})
      : response(REDIRECT, JSON.stringify({ok: true, token: 'sensitive'}),
        {headers: {'content-type': 'application/json'}})});
    assert.equal(result.code, 'PROBE_SAFE_DENIAL_NOT_CONFIRMED');
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
  });
  await t.test('unexpected errors are sanitized and never retried', async () => {
    let calls = 0;
    const result = await runConnectivityProbe({endpoint: ENDPOINT, fetchImpl: async () => {
      calls++;
      throw new Error('private URL and token');
    }});
    assert.equal(result.code, 'PROBE_TRANSPORT_FAILED');
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(calls, 1);
  });
});
