import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {runConnectivityProbe} from '../scripts/management-gateway-connectivity-probe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'apps-script-management-gateway', 'homologation-http');
const GAS_SOURCE = fs.readFileSync(path.join(TEST_DIR, 'Gateway.gs'), 'utf8');
const MANIFEST_TEXT = fs.readFileSync(path.join(TEST_DIR, 'appsscript.json'), 'utf8');
const ENDPOINT = `https://script.google.com/macros/s/${'A'.repeat(30)}/exec`;
const REDIRECT = 'https://script.googleusercontent.com/macros/echo?user_content_key=synthetic-one-time-key';
const EXPECTED_BODY = JSON.stringify({ok: false, code: 'GATEWAY_ADMISSION_DENIED'});

function executeHandler(event) {
  const calls = [];
  const context = {
    ContentService: {
      MimeType: {JSON: 'application/json'},
      createTextOutput(text) {
        calls.push({operation: 'createTextOutput', text});
        return {setMimeType(mimeType) {
          calls.push({operation: 'setMimeType', mimeType});
          return {text, mimeType};
        }};
      }
    }
  };
  vm.runInNewContext(GAS_SOURCE, context, {timeout: 1000, filename: 'Gateway.gs'});
  const output = context.doPost(event);
  return {output, calls};
}

function response(url, body, {status = 200, headers = {}, redirected = false} = {}) {
  return {url, status, redirected, headers: new Headers(headers), body: body === null ? null : new Response(body).body};
}

test('isolated manifest uses V8 and requires no explicit OAuth scopes', () => {
  const manifest = JSON.parse(MANIFEST_TEXT);
  assert.equal(manifest.timeZone, 'America/Sao_Paulo');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(Object.hasOwn(manifest, 'oauthScopes'), false);
});

test('test Gateway contains only one denial handler and no privileged service references', () => {
  assert.equal((GAS_SOURCE.match(/function\s+doPost\s*\(/g) || []).length, 1);
  assert.doesNotMatch(GAS_SOURCE, /function\s+doGet\s*\(/);
  assert.doesNotMatch(GAS_SOURCE, /\b(?:UrlFetchApp|ScriptApp|PropertiesService|LockService|Session|FirebaseApp|Firestore|IdentityToolkit)\b/);
  assert.doesNotMatch(GAS_SOURCE, /iamcredentials\.googleapis\.com|identitytoolkit\.googleapis\.com/);
});

test('handler ignores malformed or sensitive synthetic POST data and returns fixed denial', () => {
  for (const event of [undefined, null, {}, {postData: {contents: '{bad-json'}},
    {postData: {contents: JSON.stringify({token: 'do-not-log', email: 'private@example.invalid'})}}]) {
    const {output, calls} = executeHandler(event);
    assert.deepEqual(JSON.parse(output.text), {ok: false, code: 'GATEWAY_ADMISSION_DENIED'});
    assert.equal(output.mimeType, 'application/json');
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(output).includes('do-not-log'), false);
    assert.equal(JSON.stringify(output).includes('private@example.invalid'), false);
  }
});

test('connectivity client accepts the isolated denial and Content Service redirect using mocks only', async () => {
  const handler = executeHandler({postData: {contents: '{"probe":"SAHMT_GATEWAY_CONNECTIVITY_V1"}'}}).output;
  assert.equal(handler.text, EXPECTED_BODY);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (options.method === 'POST') {
      assert.equal(options.body, JSON.stringify({probe: 'SAHMT_GATEWAY_CONNECTIVITY_V1'}));
      return response(ENDPOINT, null, {status: 302, headers: {location: REDIRECT}});
    }
    return response(REDIRECT, handler.text,
      {status: 200, headers: {'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(handler.text))}});
  };
  const result = await runConnectivityProbe({endpoint: ENDPOINT, fetchImpl});
  assert.deepEqual(result, {ok: true, code: 'GATEWAY_CONNECTIVITY_DENY_REDIRECT_OK', postStatus: 302,
    finalStatus: 200, denialCode: 'GATEWAY_ADMISSION_DENIED', outboundRequests: 2});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.deepEqual(calls[0].options.headers, {'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json'});
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-one-time-key|script\.googleusercontent/);
});

test('untrusted Content Service redirect fails closed and is not followed', async () => {
  let calls = 0;
  const result = await runConnectivityProbe({endpoint: ENDPOINT, fetchImpl: async () => {
    calls++;
    return response(ENDPOINT, null, {status: 302,
      headers: {location: 'https://attacker.invalid/macros/echo?user_content_key=secret'}});
  }});
  assert.deepEqual(result, {ok: false, code: 'PROBE_REDIRECT_DENIED', postStatus: 302, finalStatus: null});
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /attacker|secret|user_content_key/);
});
