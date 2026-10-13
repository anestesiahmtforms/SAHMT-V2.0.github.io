import {pathToFileURL} from 'node:url';

const MAX_RESPONSE_BYTES = 8192;
const REQUEST_TIMEOUT_MS = 15000;
const PROBE_BODY = JSON.stringify({probe: 'SAHMT_GATEWAY_CONNECTIVITY_V1'});
const SAFE_DENIAL_CODE = 'GATEWAY_ADMISSION_DENIED';

function requireProbe(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

export function validateProbeEndpoint(value) {
  requireProbe(typeof value === 'string' && value.length <= 512, 'PROBE_ENDPOINT_INVALID');
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('PROBE_ENDPOINT_INVALID'), {code: 'PROBE_ENDPOINT_INVALID'}); }
  requireProbe(url.protocol === 'https:' && url.hostname === 'script.google.com' && !url.port
    && !url.username && !url.password && !url.hash && url.pathname
      .match(/^\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/)
    && !url.search, 'PROBE_ENDPOINT_INVALID');
  return url.href;
}

function validateContentRedirect(value) {
  requireProbe(typeof value === 'string' && value.length <= 8192, 'PROBE_REDIRECT_DENIED');
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('PROBE_REDIRECT_DENIED'), {code: 'PROBE_REDIRECT_DENIED'}); }
  const entries = [...url.searchParams.entries()];
  const keys = entries.map(([key]) => key);
  requireProbe(url.protocol === 'https:' && url.hostname === 'script.googleusercontent.com' && !url.port
    && !url.username && !url.password && !url.hash && url.pathname === '/macros/echo'
    && url.searchParams.has('user_content_key') && entries.length >= 1 && entries.length <= 2
    && entries.every(([key, content]) => ['user_content_key', 'lib'].includes(key)
      && content.length > 0 && content.length <= 4096)
    && new Set(keys).size === keys.length, 'PROBE_REDIRECT_DENIED');
  return url.href;
}

async function readBoundedJson(response) {
  const length = response.headers.get('content-length');
  requireProbe(length === null || /^\d+$/.test(length) && Number(length) <= MAX_RESPONSE_BYTES,
    'PROBE_RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader?.();
  requireProbe(reader && typeof reader.read === 'function', 'PROBE_RESPONSE_INVALID');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      requireProbe(part.value instanceof Uint8Array && part.value.byteLength > 0, 'PROBE_RESPONSE_INVALID');
      size += part.value.byteLength;
      requireProbe(size <= MAX_RESPONSE_BYTES, 'PROBE_RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* sanitized probe; no raw errors */ }
    try { reader.releaseLock(); } catch { /* sanitized probe; no raw errors */ }
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
  } catch {
    throw Object.assign(new Error('PROBE_RESPONSE_INVALID'), {code: 'PROBE_RESPONSE_INVALID'});
  }
  return parsed;
}

/** Sends exactly one synthetic POST and, only after an allowlisted GAS redirect, one GET. */
export async function runConnectivityProbe({endpoint, fetchImpl = globalThis.fetch} = {}) {
  let postStatus = null;
  let finalStatus = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const safeEndpoint = validateProbeEndpoint(endpoint);
    requireProbe(typeof fetchImpl === 'function', 'PROBE_TRANSPORT_UNAVAILABLE');
    const post = await fetchImpl(safeEndpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json'},
      body: PROBE_BODY,
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
    postStatus = post?.status ?? null;
    requireProbe(post && post.redirected !== true && post.url === safeEndpoint
      && (post.status === 302 || post.status === 303), 'PROBE_REDIRECT_STATUS_INVALID');

    // Treat Location as a short-lived bearer URL: validate it, use it once, never return or log it.
    const contentUrl = validateContentRedirect(post.headers?.get?.('location'));
    try { await post.body?.cancel?.(); } catch { /* ignore raw transport detail */ }
    const final = await fetchImpl(contentUrl, {
      method: 'GET',
      headers: {Accept: 'application/json'},
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
    finalStatus = final?.status ?? null;
    requireProbe(final && final.redirected !== true && final.url === contentUrl
      && final.status === 200 && /^application\/json(?:\s*;|$)/i.test(final.headers?.get?.('content-type') || ''),
    'PROBE_FINAL_RESPONSE_INVALID');
    const body = await readBoundedJson(final);
    requireProbe(body && typeof body === 'object' && !Array.isArray(body)
      && body.ok === false && body.code === SAFE_DENIAL_CODE,
    'PROBE_SAFE_DENIAL_NOT_CONFIRMED');
    return {ok: true, code: 'GATEWAY_CONNECTIVITY_DENY_REDIRECT_OK', postStatus, finalStatus,
      denialCode: SAFE_DENIAL_CODE, outboundRequests: 2};
  } catch (error) {
    const allowed = new Set(['PROBE_ENDPOINT_INVALID', 'PROBE_TRANSPORT_UNAVAILABLE', 'PROBE_REDIRECT_DENIED',
      'PROBE_REDIRECT_STATUS_INVALID', 'PROBE_FINAL_RESPONSE_INVALID', 'PROBE_RESPONSE_TOO_LARGE',
      'PROBE_RESPONSE_INVALID', 'PROBE_SAFE_DENIAL_NOT_CONFIRMED']);
    return {ok: false, code: allowed.has(error?.code) ? error.code : 'PROBE_TRANSPORT_FAILED',
      postStatus, finalStatus};
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function parseProbeCliArgs(args) {
  if (!Array.isArray(args) || args.length !== 3 || args[0] !== '--url' || args[2] !== '--send-once')
    return {ok: false, code: 'PROBE_SEND_ONCE_REQUIRED'};
  try { return {ok: true, endpoint: validateProbeEndpoint(args[1])}; }
  catch { return {ok: false, code: 'PROBE_ENDPOINT_INVALID'}; }
}

async function main() {
  const parsed = parseProbeCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stdout.write(JSON.stringify(parsed) + '\n');
    process.exitCode = 2;
    return;
  }
  const result = await runConnectivityProbe({endpoint: parsed.endpoint});
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
