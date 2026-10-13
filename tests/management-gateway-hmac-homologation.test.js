import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createHash, createHmac} from 'node:crypto';
import {createManagementGatewayProtocol, MANAGEMENT_GATEWAY_OPERATIONS,
  MANAGEMENT_GATEWAY_PROTOCOL_VERSION, MANAGEMENT_GATEWAY_AUDIENCE} from '../scripts/lib/management-gateway-protocol.js';
import {classifyEndpointInput, normalizeEndpointInput, runConfirmedHmacHomologation, runHmacHomologation} from '../scripts/management-gateway-hmac-homologation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'apps-script-management-gateway', 'homologation-hmac');
const SOURCE = fs.readFileSync(path.join(TEST_DIR, 'Gateway.gs'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'appsscript.json'), 'utf8'));
const NOW = 1800000000000;
const SECRET = Buffer.alloc(32, 71);
const VERSION = MANAGEMENT_GATEWAY_PROTOCOL_VERSION;
const POLICY = {schemaVersion: 1, protocolVersion: VERSION, audience: MANAGEMENT_GATEWAY_AUDIENCE,
  keyId: 'sahmt-appscript-gateway-hmac-v1', maximumTtlMs: 20000, maxFutureSkewMs: 5000,
  maxEnvelopeBytes: 65536, operationTimeoutMs: 20000, customTokenMaxTtlSeconds: 600,
  enabledOperations: Object.fromEntries(MANAGEMENT_GATEWAY_OPERATIONS.map(operation => [operation, false]))};
function httpResponse(url, body, {status = 200, headers = {}, redirected = false} = {}) {
  return {url, status, redirected, headers:new Headers(headers), body:body === null ? null : new Response(body).body};
}

function createHarness({withoutSecret = false} = {}) {
  let now = NOW;
  const values = new Map();
  if (!withoutSecret) values.set('SAHMT_HOMOLOGATION_HMAC_SECRET_BASE64URL', SECRET.toString('base64url'));
  let lockHeld = false;
  const calls = {properties: 0, locks: 0, fetch: 0, oauth: 0, serviceNames: []};
  const scriptProperties = {
    getProperty(key) { calls.properties++; return values.has(key) ? values.get(key) : null; },
    getProperties() { calls.properties++; return Object.fromEntries(values); },
    setProperty(key, value) { calls.properties++; values.set(key, String(value)); return scriptProperties; },
    deleteProperty(key) { calls.properties++; values.delete(key); return scriptProperties; }
  };
  const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value);
  const context = {
    Date: class extends Date { static now() { return now; } },
    ContentService: {MimeType: {JSON: 'application/json'}, createTextOutput(text) {
      calls.serviceNames.push('ContentService');
      return {text, mimeType: null, setMimeType(value) { this.mimeType = value; return this; }};
    }},
    PropertiesService: {getScriptProperties() { calls.serviceNames.push('PropertiesService'); return scriptProperties; }},
    LockService: {getScriptLock() { calls.serviceNames.push('LockService'); return {
      tryLock() { calls.locks++; if (lockHeld) return false; lockHeld = true; return true; },
      releaseLock() { lockHeld = false; }
    }; }},
    Utilities: {
      DigestAlgorithm: {SHA_256: 'sha256'},
      newBlob(value) { return {getBytes: () => [...Buffer.from(value, 'utf8')]}; },
      computeDigest(_algorithm, input) { return [...createHash('sha256').update(bytes(input)).digest()]; },
      computeHmacSha256Signature(input, secret) { return [...createHmac('sha256', bytes(secret)).update(bytes(input)).digest()]; },
      base64DecodeWebSafe(value) { return [...Buffer.from(value, 'base64url')]; },
      base64EncodeWebSafe(value) { return Buffer.from(value).toString('base64url'); }
    }
  };
  vm.runInNewContext(SOURCE, context, {timeout: 1000, filename: 'Gateway.gs'});
  const protocol = createManagementGatewayProtocol({policy: POLICY, secret: new Uint8Array(SECRET), now: () => now, monotonicNow: () => 0});
  const createRequest = ({issuedAtMs = now, expiresAtMs = now + 10000, nonce = 'b'.repeat(32)} = {}) => protocol.createRequest({
    operation: 'AUTH_USER_LOOKUP_FB', requestId: 'a'.repeat(32), nonce, issuedAtMs, expiresAtMs,
    body: {uid: 'synthetic-homologation-uid'}
  });
  const call = request => {
    const contents = JSON.stringify(request);
    const output = context.doPost({postData: {type: 'application/json', length: Buffer.byteLength(contents), contents}});
    assert.equal(output.mimeType, 'application/json');
    return JSON.parse(output.text);
  };
  return {context, calls, values, protocol, createRequest, call,
    parseInVm(text) { return vm.runInNewContext(`JSON.parse(${JSON.stringify(text)})`, context); },
    setNow(value) { now = value; }};
}

test('interactive URL normalization removes accidental whitespace without returning it in diagnostics', () => {
  const endpoint = `https://script.google.com/macros/s/${'B'.repeat(30)}/exec`;
  assert.equal(normalizeEndpointInput(`  ${endpoint.slice(0, 28)}\r\n${endpoint.slice(28)}  `), endpoint);
  assert.throws(() => normalizeEndpointInput('https://example.invalid/private'), error => error.code === 'HOMOLOGATION_ENDPOINT_FORMAT_INVALID');
  assert.equal(classifyEndpointInput(' \r\n\t'), 'HOMOLOGATION_ENDPOINT_EMPTY');
  assert.equal(classifyEndpointInput(`https://script.google.com/macros/s/${'B'.repeat(30)}`), 'HOMOLOGATION_ENDPOINT_INCOMPLETE');
  assert.equal(classifyEndpointInput('https://example.invalid/private'), 'HOMOLOGATION_ENDPOINT_FORMAT_INVALID');
});

test('invalid URL and missing second confirmation make no HTTP calls', async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls++; throw Error('unexpected'); };
  const invalid = await runConfirmedHmacHomologation({endpointInput:'bad-url', confirmSend:true, secret:new Uint8Array(SECRET), fetchImpl});
  assert.equal(invalid.code, 'HOMOLOGATION_ENDPOINT_FORMAT_INVALID');
  const refused = await runConfirmedHmacHomologation({endpointInput:`https://script.google.com/macros/s/${'B'.repeat(30)}/exec`,
    confirmSend:false, secret:new Uint8Array(SECRET), fetchImpl});
  assert.equal(refused.code, 'HOMOLOGATION_SEND_NOT_CONFIRMED');
  assert.equal(fetchCalls, 0);
  assert.doesNotMatch(JSON.stringify([invalid,refused]), /script\.google|bad-url/);
});

test('client uses normal visible line input and never retains the previous hidden-input handler', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'management-gateway-hmac-homologation.mjs'), 'utf8');
  assert.match(source, /readVisibleTerminalLine\('Cole a URL \/exec da implantação HOMOLOGAÇÃO:/);
  assert.doesNotMatch(source, /readHiddenTerminalLine|entrada oculta|setRawMode\(/);
  assert.match(source, /HOMOLOGATION_ENDPOINT_EMPTY/);
  assert.match(source, /HOMOLOGATION_ENDPOINT_INCOMPLETE/);
  assert.match(source, /HOMOLOGATION_ENDPOINT_FORMAT_INVALID/);
});

test('confirmed one-shot path performs only the two expected mocked protocol requests', async () => {
  const h = createHarness(), endpoint = `https://script.google.com/macros/s/${'B'.repeat(30)}/exec`;
  const redirect = 'https://script.googleusercontent.com/macros/echo?user_content_key=mock-only-key';
  let signedResponse, calls = 0;
  const result = await runConfirmedHmacHomologation({endpointInput:` ${endpoint}\r\n`, confirmSend:true,
    secret:new Uint8Array(SECRET), clock:() => NOW, fetchImpl:async (url, options) => {
      calls++;
      if (options.method === 'POST') {
        signedResponse = h.call(JSON.parse(options.body));
        return httpResponse(endpoint, null, {status:302, headers:{location:redirect}});
      }
      return httpResponse(redirect, JSON.stringify(signedResponse),
        {headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(JSON.stringify(signedResponse)))}});
    }});
  assert.equal(result.code, 'HOMOLOGATION_HMAC_DENY_VERIFIED');
  assert.equal(result.hmacInputVerified, true);
  assert.equal(result.hmacOutputVerified, true);
  assert.equal(result.gatewayCode, 'GATEWAY_DISABLED');
  assert.equal(calls, 2);
});

test('homologation manifest requests only script.storage for its private secret and replay ledger', () => {
  assert.deepEqual(MANIFEST, {timeZone: 'America/Sao_Paulo', runtimeVersion: 'V8',
    oauthScopes: ['https://www.googleapis.com/auth/script.storage']});
});

test('isolated Gateway has no authentication or external API dispatch code and fixes all six operations off', () => {
  for (const operation of MANAGEMENT_GATEWAY_OPERATIONS) {
    assert.match(SOURCE, new RegExp(operation + ': false'));
  }
  assert.doesNotMatch(SOURCE, /\b(?:ScriptApp|UrlFetchApp|FirebaseApp|Firestore|Session|IdentityToolkit|iamcredentials)\b/);
  assert.doesNotMatch(SOURCE, /function\s+(?:mgwSign|mgwLookup|mgwFirstLogin|signIn|createUser)\w*\s*\(/i);
  assert.equal((SOURCE.match(/function\s+doPost\s*\(/g) || []).length, 1);
  assert.doesNotMatch(SOURCE, /function\s+doGet\s*\(/);
});

test('valid synthetic Worker envelope yields a signed GATEWAY_DISABLED response verifiable by the real protocol', () => {
  const h = createHarness(), request = h.createRequest(), response = h.call(request);
  const vmRequest = h.parseInVm(JSON.stringify(request));
  assert.doesNotThrow(() => h.context.homValidateRequest_(vmRequest, h.context.homSecret_(), NOW));
  assert.equal(response.code, 'GATEWAY_DISABLED');
  assert.equal(response.direction, 'APPS_SCRIPT_TO_WORKER');
  assert.equal(response.status, 'DENIED');
  assert.equal(response.code, 'GATEWAY_DISABLED');
  assert.equal(response.body, null);
  assert.deepEqual(h.protocol.verifyResponse(response, request), {status: 'DENIED', code: 'GATEWAY_DISABLED', body: null});
  assert.equal(h.calls.fetch, 0);
  assert.equal(h.calls.oauth, 0);
  assert.deepEqual([...new Set(h.calls.serviceNames)].sort(), ['ContentService', 'LockService', 'PropertiesService']);
  assert.equal(JSON.stringify(response).includes(SECRET.toString('base64url')), false);
});

test('HMAC one-shot client and isolated GAS doPost interoperate end to end with mocked fetch only', async () => {
  const h = createHarness(), endpoint = `https://script.google.com/macros/s/${'A'.repeat(30)}/exec`;
  const redirect = 'https://script.googleusercontent.com/macros/echo?user_content_key=mock-only-key';
  let signedResponse; const calls = [];
  const result = await runHmacHomologation({endpoint, secret:new Uint8Array(SECRET), clock:() => NOW,
    fetchImpl:async (url, options) => {
      calls.push({url, options});
      if (options.method === 'POST') {
        signedResponse = h.call(JSON.parse(options.body));
        return httpResponse(endpoint, null, {status:302, headers:{location:redirect}});
      }
      return httpResponse(redirect, JSON.stringify(signedResponse),
        {headers:{'content-type':'application/json', 'content-length':String(Buffer.byteLength(JSON.stringify(signedResponse)))}});
    }});
  assert.deepEqual(result, {ok:true, code:'HOMOLOGATION_HMAC_DENY_VERIFIED', postStatus:302, finalStatus:200,
    gatewayCode:'GATEWAY_DISABLED', hmacInputVerified:true, hmacOutputVerified:true, outboundRequests:2});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.equal(JSON.stringify(result).includes('mock-only-key'), false);
  assert.equal(JSON.stringify(result).includes(SECRET.toString('base64url')), false);
});

test('tampered request is rejected before nonce storage and returns only generic denial', () => {
  const h = createHarness(), request = h.createRequest();
  request.body.uid = 'tampered-synthetic-uid';
  const response = h.call(request);
  assert.deepEqual(response, {ok: false, code: 'GATEWAY_ADMISSION_DENIED'});
  assert.equal([...h.values.keys()].some(key => key.startsWith('SAHMT_HOMOLOGATION_NONCE_V1_')), false);
  assert.equal(h.calls.locks, 0);
});

test('validly shaped request signed with the wrong key is rejected before nonce storage', () => {
  const h = createHarness(), request = h.createRequest();
  h.values.set('SAHMT_HOMOLOGATION_HMAC_SECRET_BASE64URL', Buffer.alloc(32, 72).toString('base64url'));
  assert.deepEqual(h.call(request), {ok:false, code:'GATEWAY_ADMISSION_DENIED'});
  assert.equal(h.calls.locks, 0);
  assert.equal([...h.values.keys()].some(key => key.startsWith('SAHMT_HOMOLOGATION_NONCE_V1_')), false);
});

test('expired request is rejected before nonce storage and cannot receive an accepted HMAC response', () => {
  const h = createHarness(), request = h.createRequest({expiresAtMs: NOW + 10000});
  h.setNow(NOW + 10000);
  assert.deepEqual(h.call(request), {ok: false, code: 'GATEWAY_ADMISSION_DENIED'});
  assert.equal([...h.values.keys()].some(key => key.startsWith('SAHMT_HOMOLOGATION_NONCE_V1_')), false);
  assert.equal(h.calls.locks, 0);
});

test('replay is rejected with a separately signed response after the first disabled-operation denial', () => {
  const h = createHarness(), request = h.createRequest();
  const first = h.call(request), replay = h.call(request);
  assert.equal(first.code, 'GATEWAY_DISABLED');
  assert.equal(replay.code, 'GATEWAY_REPLAY_DENIED');
  assert.deepEqual(h.protocol.verifyResponse(first, request), {status: 'DENIED', code: 'GATEWAY_DISABLED', body: null});
  assert.deepEqual(h.protocol.verifyResponse(replay, request), {status: 'DENIED', code: 'GATEWAY_REPLAY_DENIED', body: null});
  assert.equal(h.calls.locks, 2);
});

test('reusing a request ID with a fresh nonce is still rejected as replay', () => {
  const h = createHarness(), firstRequest = h.createRequest(), secondRequest = h.createRequest({nonce:'c'.repeat(32)});
  assert.equal(h.call(firstRequest).code, 'GATEWAY_DISABLED');
  const replay = h.call(secondRequest);
  assert.equal(replay.code, 'GATEWAY_REPLAY_DENIED');
  assert.deepEqual(h.protocol.verifyResponse(replay, secondRequest), {status:'DENIED', code:'GATEWAY_REPLAY_DENIED', body:null});
});

test('one-shot client rejects a tampered HMAC response and emits no response content', async () => {
  const h = createHarness(), endpoint = `https://script.google.com/macros/s/${'B'.repeat(30)}/exec`;
  const redirect = 'https://script.googleusercontent.com/macros/echo?user_content_key=mock-only-key';
  let signedResponse;
  const result = await runHmacHomologation({endpoint, secret:new Uint8Array(SECRET), clock:() => NOW,
    fetchImpl:async (url, options) => {
      if (options.method === 'POST') {
        signedResponse = h.call(JSON.parse(options.body));
        return httpResponse(endpoint, null, {status:303, headers:{location:redirect}});
      }
      signedResponse.signature = '0'.repeat(64);
      const text = JSON.stringify(signedResponse);
      return httpResponse(redirect, text, {headers:{'content-type':'application/json', 'content-length':String(Buffer.byteLength(text))}});
    }});
  assert.deepEqual(result, {ok:false, code:'GATEWAY_SIGNATURE_INVALID', postStatus:303, finalStatus:200});
  assert.doesNotMatch(JSON.stringify(result), /mock-only-key|signature|synthetic-homologation/);
});

test('missing disposable secret fails closed before replay or privileged APIs', () => {
  const h = createHarness({withoutSecret: true}), request = h.createRequest();
  assert.deepEqual(h.call(request), {ok: false, code: 'GATEWAY_ADMISSION_DENIED'});
  assert.equal(h.calls.locks, 0);
  assert.equal(h.calls.fetch, 0);
  assert.equal(h.calls.oauth, 0);
});
