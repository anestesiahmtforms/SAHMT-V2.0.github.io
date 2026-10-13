import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createManagementGatewayProtocol, MANAGEMENT_GATEWAY_OPERATIONS,
  MANAGEMENT_GATEWAY_PROTOCOL_VERSION, MANAGEMENT_GATEWAY_AUDIENCE} from './lib/management-gateway-protocol.js';

const POLICY = Object.freeze({schemaVersion: 1, protocolVersion: MANAGEMENT_GATEWAY_PROTOCOL_VERSION,
  audience: MANAGEMENT_GATEWAY_AUDIENCE, keyId: 'sahmt-appscript-gateway-hmac-v1', maximumTtlMs: 20000,
  maxFutureSkewMs: 5000, maxEnvelopeBytes: 65536, operationTimeoutMs: 20000,
  customTokenMaxTtlSeconds: 600,
  enabledOperations: Object.freeze(Object.fromEntries(MANAGEMENT_GATEWAY_OPERATIONS.map(operation => [operation, false]))) });
const MAX_RESPONSE_BYTES = 8192;
const SYNTHETIC_UID = 'synthetic-homologation-uid';
const fail = code => { const error = new Error(code); error.code = code; throw error; };

function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 512) fail('HOMOLOGATION_ENDPOINT_FORMAT_INVALID');
  let url;
  try { url = new URL(value); } catch { fail('HOMOLOGATION_ENDPOINT_FORMAT_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password
    || url.hash || url.search || !/^\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(url.pathname))
    fail('HOMOLOGATION_ENDPOINT_FORMAT_INVALID');
  return url.href;
}
export function classifyEndpointInput(value) {
  if (typeof value !== 'string') return 'HOMOLOGATION_ENDPOINT_EMPTY';
  const compact = value.replace(/[\s\uFEFF\u00A0]+/gu, '');
  if (!compact) return 'HOMOLOGATION_ENDPOINT_EMPTY';
  try { validateEndpoint(compact); return 'HOMOLOGATION_ENDPOINT_FORMAT_OK'; }
  catch {
    // Treat a partially copied URL from the expected Apps Script origin/path as
    // incomplete. Do not echo the input or include it in error details.
    const partial = compact.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]{0,200})(?:\/exec)?$/i);
    if (partial && (partial[1].length < 20 || !/\/exec$/i.test(compact))) return 'HOMOLOGATION_ENDPOINT_INCOMPLETE';
    return 'HOMOLOGATION_ENDPOINT_FORMAT_INVALID';
  }
}
export function normalizeEndpointInput(value) {
  const compact = typeof value === 'string' ? value.replace(/[\s\uFEFF\u00A0]+/gu, '') : '';
  const code = classifyEndpointInput(value);
  if (code !== 'HOMOLOGATION_ENDPOINT_FORMAT_OK') fail(code);
  return validateEndpoint(compact);
}
function validateContentRedirect(value) {
  if (typeof value !== 'string' || value.length > 8192) fail('HOMOLOGATION_REDIRECT_REJECTED');
  let url;
  try { url = new URL(value); } catch { fail('HOMOLOGATION_REDIRECT_REJECTED'); }
  const entries = [...url.searchParams.entries()], names = entries.map(([key]) => key);
  if (url.protocol !== 'https:' || url.hostname !== 'script.googleusercontent.com' || url.port || url.username || url.password
    || url.hash || url.pathname !== '/macros/echo' || !url.searchParams.has('user_content_key')
    || entries.length < 1 || entries.length > 2 || new Set(names).size !== names.length
    || entries.some(([key, entry]) => !['user_content_key', 'lib'].includes(key) || !entry || entry.length > 4096))
    fail('HOMOLOGATION_REDIRECT_REJECTED');
  return url.href;
}
async function boundedJson(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) fail('HOMOLOGATION_RESPONSE_INVALID');
  const reader = response.body?.getReader?.();
  if (!reader) fail('HOMOLOGATION_RESPONSE_INVALID');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      if (!(part.value instanceof Uint8Array) || !part.value.byteLength) fail('HOMOLOGATION_RESPONSE_INVALID');
      size += part.value.byteLength; if (size > MAX_RESPONSE_BYTES) fail('HOMOLOGATION_RESPONSE_INVALID'); chunks.push(part.value);
    }
  } finally { try { await reader.cancel(); } catch {} try { reader.releaseLock(); } catch {} }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
  catch { fail('HOMOLOGATION_RESPONSE_INVALID'); }
}

/** A one-shot HMAC proof. No retries, credentials, cookies, or operational handlers. */
export async function runHmacHomologation({endpoint, secret, fetchImpl = globalThis.fetch, clock = Date.now} = {}) {
  let protocol, postStatus = null, finalStatus = null;
  try {
    const safeEndpoint = validateEndpoint(endpoint);
    if (!(secret instanceof Uint8Array) || secret.byteLength !== 32 || typeof fetchImpl !== 'function' || typeof clock !== 'function')
      fail('HOMOLOGATION_LOCAL_CONFIG_INVALID');
    protocol = createManagementGatewayProtocol({policy: POLICY, secret, now: clock});
    const issuedAtMs = clock();
    const request = protocol.createRequest({operation: 'AUTH_USER_LOOKUP_FB', requestId:randomBytes(16).toString('hex'), nonce:randomBytes(16).toString('hex'),
      issuedAtMs, expiresAtMs:issuedAtMs + POLICY.maximumTtlMs, body:{uid:SYNTHETIC_UID}});
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const post = await fetchImpl(safeEndpoint, {method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify(request), redirect:'manual', cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal});
      postStatus = post?.status ?? null;
      if (!post || post.redirected === true || post.url !== safeEndpoint || ![302,303].includes(post.status)) fail('HOMOLOGATION_POST_STATUS_INVALID');
      const contentUrl = validateContentRedirect(post.headers?.get?.('location'));
      try { await post.body?.cancel?.(); } catch {}
      const final = await fetchImpl(contentUrl, {method:'GET', headers:{Accept:'application/json'}, redirect:'manual', cache:'no-store',
        credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal});
      finalStatus = final?.status ?? null;
      if (!final || final.redirected === true || final.url !== contentUrl || final.status !== 200
        || !/^application\/json(?:\s*;|$)/i.test(final.headers?.get?.('content-type') || '')) fail('HOMOLOGATION_FINAL_STATUS_INVALID');
      const response = await boundedJson(final);
      const verified = protocol.verifyResponse(response, request);
      if (verified.status !== 'DENIED' || verified.code !== 'GATEWAY_DISABLED' || verified.body !== null)
        fail('HOMOLOGATION_DENIAL_NOT_VERIFIED');
      return {ok:true, code:'HOMOLOGATION_HMAC_DENY_VERIFIED', postStatus, finalStatus,
        gatewayCode:'GATEWAY_DISABLED', hmacInputVerified:true, hmacOutputVerified:true, outboundRequests:2};
    } finally { clearTimeout(timer); controller.abort(); }
  } catch (error) {
    const allowed = new Set(['HOMOLOGATION_ENDPOINT_FORMAT_INVALID','HOMOLOGATION_LOCAL_CONFIG_INVALID','HOMOLOGATION_REDIRECT_REJECTED',
      'HOMOLOGATION_POST_STATUS_INVALID','HOMOLOGATION_FINAL_STATUS_INVALID','HOMOLOGATION_RESPONSE_INVALID',
      'HOMOLOGATION_DENIAL_NOT_VERIFIED','GATEWAY_ENVELOPE_INVALID','GATEWAY_SIGNATURE_INVALID','GATEWAY_ENVELOPE_TIME_INVALID']);
    return {ok:false, code:allowed.has(error?.code) ? error.code : 'HOMOLOGATION_TRANSPORT_FAILED', postStatus, finalStatus};
  } finally { protocol?.dispose(); }
}

/** Requires a separate affirmative confirmation before any HTTP request is made. */
export async function runConfirmedHmacHomologation({endpointInput, confirmSend, secret, fetchImpl = globalThis.fetch, clock = Date.now} = {}) {
  let endpoint;
  try { endpoint = normalizeEndpointInput(endpointInput); }
  catch (error) {
    const allowed = new Set(['HOMOLOGATION_ENDPOINT_EMPTY','HOMOLOGATION_ENDPOINT_INCOMPLETE','HOMOLOGATION_ENDPOINT_FORMAT_INVALID']);
    return {ok:false, code:allowed.has(error?.code) ? error.code : 'HOMOLOGATION_ENDPOINT_FORMAT_INVALID',
      postStatus:null, finalStatus:null};
  }
  if (confirmSend !== true) return {ok:false, code:'HOMOLOGATION_SEND_NOT_CONFIRMED', postStatus:null, finalStatus:null};
  return runHmacHomologation({endpoint, secret, fetchImpl, clock});
}

async function readLocalSecret() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) fail('HOMOLOGATION_KEY_UNAVAILABLE');
  const file = path.join(process.env.LOCALAPPDATA, 'SAHMT', 'management-gateway-homologation', 'hmac-secret.txt');
  try {
    const encoded = (await fs.readFile(file, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) fail('HOMOLOGATION_KEY_UNAVAILABLE');
    const secret = Buffer.from(encoded, 'base64url');
    if (secret.length !== 32 || secret.toString('base64url') !== encoded) { secret.fill(0); fail('HOMOLOGATION_KEY_UNAVAILABLE'); }
    return secret;
  } catch { fail('HOMOLOGATION_KEY_UNAVAILABLE'); }
}

async function readVisibleTerminalLine(prompt) {
  if (!process.stdin.isTTY) fail('HOMOLOGATION_INTERACTIVE_TERMINAL_REQUIRED');
  const {createInterface} = await import('node:readline/promises');
  const terminal = createInterface({input:process.stdin, output:process.stdout});
  try {
    return await new Promise((resolve, reject) => {
      let value = '', timer = null, settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        terminal.off('line', onLine);
        terminal.off('SIGINT', onInterrupt);
        error ? reject(error) : resolve(result);
      };
      const onLine = line => {
        value += line;
        if (value.length > 1024) return finish(Error('HOMOLOGATION_ENDPOINT_FORMAT_INVALID'));
        clearTimeout(timer);
        // Allow consecutive lines from a multiline paste to be joined before
        // validating; a normal Enter completes after this short quiet period.
        timer = setTimeout(() => finish(null, value), 350);
      };
      const onInterrupt = () => finish(Error('HOMOLOGATION_INPUT_CANCELLED'));
      terminal.on('line', onLine);
      terminal.on('SIGINT', onInterrupt);
      terminal.setPrompt(prompt);
      terminal.prompt();
    });
  } finally { terminal.close(); }
}

async function confirmSendInTerminal() {
  const {createInterface} = await import('node:readline/promises');
  const terminal = createInterface({input:process.stdin, output:process.stdout});
  try {
    const answer = await terminal.question('Confirme que esta URL pertence à cópia HOMOLOGAÇÃO v2; digite HOMOLOGACAO V2 para enviar uma vez: ');
    return answer.trim() === 'HOMOLOGACAO V2';
  } finally { terminal.close(); }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--send-once') {
    process.stdout.write(JSON.stringify({ok:false, code:'HOMOLOGATION_SEND_ONCE_REQUIRED'}) + '\n'); process.exitCode = 2; return;
  }
  let secret;
  try {
    const endpointInput = await readVisibleTerminalLine('Cole a URL /exec da implantação HOMOLOGAÇÃO: ');
    let endpoint;
    try { endpoint = normalizeEndpointInput(endpointInput); }
    catch (error) {
      const allowed = new Set(['HOMOLOGATION_ENDPOINT_EMPTY','HOMOLOGATION_ENDPOINT_INCOMPLETE','HOMOLOGATION_ENDPOINT_FORMAT_INVALID']);
      process.stdout.write(`${allowed.has(error?.code) ? error.code : 'HOMOLOGATION_ENDPOINT_FORMAT_INVALID'}\n`);
      process.exitCode = 1; return;
    }
    process.stdout.write('HOMOLOGATION_ENDPOINT_FORMAT_OK\n');
    const confirmed = await confirmSendInTerminal();
    if (!confirmed) {
      process.stdout.write('HOMOLOGATION_SEND_NOT_CONFIRMED\n'); process.exitCode = 1; return;
    }
    secret = await readLocalSecret();
    const result = await runConfirmedHmacHomologation({endpointInput:endpoint, confirmSend:true, secret});
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const allowed = new Set(['HOMOLOGATION_KEY_UNAVAILABLE','HOMOLOGATION_INTERACTIVE_TERMINAL_REQUIRED','HOMOLOGATION_INPUT_CANCELLED',
      'HOMOLOGATION_ENDPOINT_EMPTY','HOMOLOGATION_ENDPOINT_INCOMPLETE','HOMOLOGATION_ENDPOINT_FORMAT_INVALID','HOMOLOGATION_SEND_NOT_CONFIRMED']);
    const code = allowed.has(error?.code) ? error.code : 'HOMOLOGATION_PREPARATION_FAILED';
    process.stdout.write(JSON.stringify({ok:false, code, postStatus:null, finalStatus:null}) + '\n'); process.exitCode = 1;
  } finally { secret?.fill(0); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
