const PROJECT_ID = 'sahmt-17a16';
const PROJECT_NUMBER = '1072832154794';
const WEB_APP_ID = '1:1072832154794:web:38e8e627d4189ebb0a14d3';
const ALLOWED_ORIGIN = 'https://anestesiahmtforms.github.io';
const MODEL = 'gpt-6-luna';
const AUTH_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const APP_CHECK_JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks';
const FIRESTORE_DOCUMENTS_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const APP_CHECK_MAX_KEY_AGE_SECONDS = 6 * 60 * 60;
const DEFAULT_KEY_AGE_SECONDS = 5 * 60;
const CLOCK_SKEW_SECONDS = 60;
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

const RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['nomePaciente', 'convenio', 'cirurgia', 'atendimento', 'tipo', 'credor'],
  properties: {
    nomePaciente: {type: 'string'},
    convenio: {type: 'string'},
    cirurgia: {type: 'string'},
    atendimento: {type: 'string'},
    tipo: {type: 'string'},
    credor: {type: 'string'}
  }
});

const EXTRACTION_PROMPT = [
  'Você lê etiquetas hospitalares HMT, etiquetas SADT e cartões de consulta pré-anestésica.',
  'Extraia somente nomePaciente, convenio, cirurgia, atendimento, tipo e credor, respondendo pelo esquema JSON.',
  'Etiqueta hospitalar padrão: nomePaciente é o texto após Nome: e antes de Pront:. convenio vem após Convenio: até o fim da linha. cirurgia é somente o número sob o primeiro código de barras, próximo a N.Cirur; atendimento é somente o número sob o segundo, próximo a N.Atend.',
  'Consulta pré-anestésica em cartão escuro: extraia nomePaciente e atendimento; tipo exatamente Consulta Pré-anestésica; credor exatamente Caixa; deixe convenio e cirurgia vazios.',
  'SADT: reconheça N. Guia, Senha e Convenio. Extraia nomePaciente após Nome: e antes de Pront:, convenio após Convenio: na linha da senha e atendimento sob o código de barras. tipo exatamente SADT; cirurgia e credor vazios.',
  'Na etiqueta padrão, deixe tipo e credor vazios. Nunca use número de prontuário como cirurgia ou atendimento. Compare a imagem principal com os recortes inferiores.',
  'Para números, retorne somente dígitos visíveis. Se algum dígito estiver duvidoso, retorne string vazia; nunca estime. Se não distinguir zero de oito, deixe o campo vazio.',
  'Preserve grafia natural do nome e convênio, corrigindo só erro visual inequívoco. Não invente valores.'
].join('\n');

class WorkerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(status, value, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  });
  if (origin === ALLOWED_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(JSON.stringify(value), {status, headers});
}

function errorResponse(error, origin) {
  const known = error instanceof WorkerError;
  const status = known ? error.status : 503;
  const code = known ? error.code : 'SERVICE_UNAVAILABLE';
  const message = known ? error.message : 'Não foi possível realizar a leitura por IA. Tente novamente ou preencha os campos manualmente.';
  return jsonResponse(status, {error: {code, message}}, origin);
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function decodeJwt(token) {
  if (typeof token !== 'string' || token.length > 12_000) throw new WorkerError(401, 'UNAUTHENTICATED', 'Entre novamente no SAHMT para ler a etiqueta.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new WorkerError(401, 'UNAUTHENTICATED', 'A sessão não foi validada. Entre novamente no SAHMT.');
  try {
    return {
      header: decodeJwtPart(parts[0]),
      claims: decodeJwtPart(parts[1]),
      signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      signature: decodeBase64Url(parts[2])
    };
  } catch {
    throw new WorkerError(401, 'UNAUTHENTICATED', 'A sessão não foi validada. Entre novamente no SAHMT.');
  }
}

function maxAgeSeconds(response, capSeconds) {
  const directive = response.headers.get('Cache-Control')?.match(/(?:^|,)\s*max-age\s*=\s*(\d+)/i);
  const advertised = directive ? Number(directive[1]) : DEFAULT_KEY_AGE_SECONDS;
  return Math.max(0, Math.min(advertised, capSeconds));
}

function createJwkCache(fetchImpl, now) {
  const cache = new Map();
  const pending = new Map();

  async function getKeys(url, {refresh = false, maxAge = APP_CHECK_MAX_KEY_AGE_SECONDS} = {}) {
    const cached = cache.get(url);
    if (!refresh && cached && cached.expiresAt > now()) return cached.keys;
    if (!refresh && pending.has(url)) return pending.get(url);

    const request = (async () => {
      let response;
      try {
        response = await fetchImpl(url, {method: 'GET', headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(8000)});
      } catch {
        throw new WorkerError(503, 'TOKEN_VALIDATION_UNAVAILABLE', 'Não foi possível validar a sessão. Tente novamente.');
      }
      if (!response.ok) throw new WorkerError(503, 'TOKEN_VALIDATION_UNAVAILABLE', 'Não foi possível validar a sessão. Tente novamente.');
      let jwks;
      try { jwks = await response.json(); }
      catch { throw new WorkerError(503, 'TOKEN_VALIDATION_UNAVAILABLE', 'Não foi possível validar a sessão. Tente novamente.'); }
      if (!Array.isArray(jwks?.keys) || jwks.keys.length === 0) throw new WorkerError(503, 'TOKEN_VALIDATION_UNAVAILABLE', 'Não foi possível validar a sessão. Tente novamente.');
      const keys = new Map(jwks.keys.filter((key) => key?.kty === 'RSA' && typeof key.kid === 'string').map((key) => [key.kid, key]));
      if (!keys.size) throw new WorkerError(503, 'TOKEN_VALIDATION_UNAVAILABLE', 'Não foi possível validar a sessão. Tente novamente.');
      cache.set(url, {keys, expiresAt: now() + maxAgeSeconds(response, maxAge) * 1000});
      return keys;
    })();
    if (!refresh) pending.set(url, request);
    try { return await request; }
    finally { if (pending.get(url) === request) pending.delete(url); }
  }

  return getKeys;
}

function hasExpectedAudience(audience, expected) {
  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

async function verifyJwt(token, policy, {getKeys, crypto, now}) {
  const jwt = decodeJwt(token);
  const {header, claims} = jwt;
  if (header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string' || header.crit !== undefined) {
    throw new WorkerError(policy.status, policy.code, policy.message);
  }
  const keys = await getKeys(policy.jwksUrl, {maxAge: policy.maxKeyAgeSeconds});
  let jwk = keys.get(header.kid);
  if (!jwk) {
    const refreshedKeys = await getKeys(policy.jwksUrl, {refresh: true, maxAge: policy.maxKeyAgeSeconds});
    jwk = refreshedKeys.get(header.kid);
  }
  if (!jwk || jwk.alg !== 'RS256' || (jwk.use && jwk.use !== 'sig') || (jwk.key_ops && !jwk.key_ops.includes('verify'))) {
    throw new WorkerError(policy.status, policy.code, policy.message);
  }

  const issuedAt = Number(claims.iat);
  const expiresAt = Number(claims.exp);
  const currentTime = Math.floor(now() / 1000);
  const validTimes = Number.isFinite(issuedAt) && Number.isFinite(expiresAt) &&
    issuedAt <= currentTime + CLOCK_SKEW_SECONDS && expiresAt > currentTime;
  const validAuthTime = policy.requireAuthTime !== true || (Number.isFinite(Number(claims.auth_time)) && Number(claims.auth_time) <= currentTime + CLOCK_SKEW_SECONDS);
  const validClaims = claims.iss === policy.issuer && hasExpectedAudience(claims.aud, policy.audience) && validTimes && validAuthTime &&
    typeof claims.sub === 'string' && claims.sub.length > 0 && claims.sub.length <= 128;
  if (!validClaims || (policy.subject && claims.sub !== policy.subject)) throw new WorkerError(policy.status, policy.code, policy.message);

  let key;
  let validSignature = false;
  try {
    key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
    validSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, jwt.signature, jwt.signingInput);
  } catch {
    validSignature = false;
  }
  if (!validSignature) throw new WorkerError(policy.status, policy.code, policy.message);
  return claims;
}

function authorizationToken(request) {
  const value = request.headers.get('Authorization') || '';
  const match = value.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new WorkerError(401, 'UNAUTHENTICATED', 'Entre novamente no SAHMT para ler a etiqueta.');
  return match[1];
}

function field(fields, name, type) {
  return fields?.[name]?.[type];
}

function profilePermission(fields, name) {
  return field(field(fields, 'permissions', 'mapValue')?.fields, name, 'booleanValue') === true;
}

async function readAuthorizedProfile(uid, idToken, fetchImpl) {
  const query = new URLSearchParams();
  for (const path of ['uid', 'active', 'access', 'role', 'permissions.labelsWrite', 'permissions.labelsManage', 'permissions.admin']) {
    query.append('mask.fieldPaths', path);
  }
  let response;
  try {
    response = await fetchImpl(`${FIRESTORE_DOCUMENTS_URL}/users/${encodeURIComponent(uid)}?${query}`, {
      method: 'GET', headers: {Authorization: `Bearer ${idToken}`, Accept: 'application/json'}, signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw new WorkerError(503, 'PROFILE_UNAVAILABLE', 'Não foi possível confirmar seu acesso agora. Tente novamente.');
  }
  if (response.status === 404) throw new WorkerError(403, 'PERMISSION_DENIED', 'Esta conta ainda não está autorizada a ler etiquetas.');
  if (response.status === 401 || response.status === 403) throw new WorkerError(403, 'PERMISSION_DENIED', 'Seu perfil não tem permissão para ler etiquetas.');
  if (!response.ok) throw new WorkerError(503, 'PROFILE_UNAVAILABLE', 'Não foi possível confirmar seu acesso agora. Tente novamente.');

  let document;
  try { document = await response.json(); }
  catch { throw new WorkerError(503, 'PROFILE_UNAVAILABLE', 'Não foi possível confirmar seu acesso agora. Tente novamente.'); }
  const fields = document?.fields;
  if (field(fields, 'uid', 'stringValue') !== uid || field(fields, 'active', 'booleanValue') !== true || field(fields, 'access', 'booleanValue') !== true) {
    throw new WorkerError(403, 'PERMISSION_DENIED', 'Seu perfil não tem permissão para ler etiquetas.');
  }
  const role = field(fields, 'role', 'stringValue');
  const authorized = role === 'administrador_app' || profilePermission(fields, 'admin') || profilePermission(fields, 'labelsWrite') || profilePermission(fields, 'labelsManage');
  if (!authorized) throw new WorkerError(403, 'PERMISSION_DENIED', 'Seu perfil não tem permissão para ler etiquetas.');
}

function imageBytes(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0)); }
  catch { return null; }
  const kind = match[1].toLowerCase();
  const jpeg = kind === 'jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = kind === 'png' && bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = kind === 'webp' && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return jpeg || png || webp ? {kind, byteLength: bytes.length} : null;
}

function validateImages(body, request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) throw new WorkerError(413, 'IMAGE_TOO_LARGE', 'A foto excede o limite. Capture novamente ou use o registro manual.');
  if (typeof body?.imageDataUrl !== 'string' || body.imageDataUrl.length > 8 * 1024 * 1024 ||
    !Array.isArray(body.numericImageDataUrls) || body.numericImageDataUrls.length > 3 ||
    body.numericImageDataUrls.some((item) => typeof item !== 'string' || item.length > 3 * 1024 * 1024) ||
    body.imageDataUrl.length + body.numericImageDataUrls.reduce((total, item) => total + item.length, 0) > MAX_REQUEST_BYTES) {
    throw new WorkerError(400, 'INVALID_IMAGE', 'A imagem está inválida. Capture novamente ou preencha os campos manualmente.');
  }
  const image = imageBytes(body?.imageDataUrl);
  const numeric = body?.numericImageDataUrls;
  if (!image || numeric.some((item) => !imageBytes(item))) {
    throw new WorkerError(400, 'INVALID_IMAGE', 'A imagem está inválida. Capture novamente ou preencha os campos manualmente.');
  }
  return {imageDataUrl: body.imageDataUrl, numericImageDataUrls: numeric};
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalize(value) {
  return cleanText(value, 60).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function parseOpenAiOutput(payload) {
  const text = String(payload?.output_text || (payload?.output || [])
    .flatMap((item) => item?.type === 'message' ? (item.content || []).filter((part) => part?.type === 'output_text').map((part) => part.text || '') : [])
    .join('\n')).trim();
  if (!text) throw new WorkerError(502, 'AI_INVALID_RESPONSE', 'A IA não retornou campos legíveis. Tente novamente ou faça o registro manual.');
  let extracted;
  try { extracted = JSON.parse(text); }
  catch { throw new WorkerError(502, 'AI_INVALID_RESPONSE', 'A IA retornou campos inválidos. Tente novamente ou faça o registro manual.'); }
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) throw new WorkerError(502, 'AI_INVALID_RESPONSE', 'A IA retornou campos inválidos. Tente novamente ou faça o registro manual.');

  const name = cleanText(extracted.nomePaciente, 160);
  const insurance = cleanText(extracted.convenio, 120);
  const procedureCode = cleanText(extracted.cirurgia, 80).replace(/\D/g, '').slice(0, 80);
  const encounterCode = cleanText(extracted.atendimento, 80).replace(/\D/g, '').slice(0, 80);
  const rawType = normalize(extracted.tipo);
  const isConsultation = rawType === 'consulta pre-anestesica' || (!rawType && !insurance && !procedureCode && name && encounterCode);
  const isSadt = rawType === 'sadt';
  const type = isConsultation ? 'Consulta Pré-anestésica' : isSadt ? 'SADT' : '';
  const required = isConsultation ? ['patientName', 'encounterCode'] : isSadt ? ['patientName', 'insurance', 'encounterCode'] : ['patientName', 'insurance', 'procedureCode', 'encounterCode'];
  const values = {patientName: name, insurance: isConsultation ? '' : insurance, procedureCode: isConsultation || isSadt ? '' : procedureCode, encounterCode};
  return {model: MODEL, ...values, type, creditor: isConsultation ? 'Caixa' : '', uncertain: required.filter((fieldName) => !values[fieldName])};
}

async function extractWithOpenAi(images, apiKey, fetchImpl) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new WorkerError(503, 'AI_NOT_CONFIGURED', 'A leitura por IA está temporariamente indisponível. Use o registro manual.');
  const imageParts = [
    {type: 'input_image', image_url: images.imageDataUrl, detail: 'high'},
    ...images.numericImageDataUrls.map((image_url) => ({type: 'input_image', image_url, detail: 'high'}))
  ];
  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: MODEL,
        store: false,
        reasoning: {effort: 'none'},
        max_output_tokens: 320,
        input: [{role: 'user', content: [{type: 'input_text', text: EXTRACTION_PROMPT}, ...imageParts]}],
        text: {format: {type: 'json_schema', name: 'etiqueta_hmt', strict: true, schema: RESPONSE_SCHEMA}}
      }),
      signal: AbortSignal.timeout(50_000)
    });
  } catch {
    throw new WorkerError(503, 'AI_UNAVAILABLE', 'Não foi possível realizar a leitura por IA. Tente novamente ou preencha os campos manualmente.');
  }
  if (response.status === 429) throw new WorkerError(429, 'AI_RATE_LIMIT', 'A leitura por IA está temporariamente ocupada. Tente novamente ou preencha os campos manualmente.');
  if (response.status === 401 || response.status === 403) throw new WorkerError(502, 'AI_CONFIGURATION_ERROR', 'A leitura por IA está temporariamente indisponível. Use o registro manual.');
  if (!response.ok) throw new WorkerError(response.status >= 500 ? 503 : 502, 'AI_UNAVAILABLE', 'Não foi possível realizar a leitura por IA. Tente novamente ou preencha os campos manualmente.');
  let payload;
  try { payload = await response.json(); }
  catch { throw new WorkerError(502, 'AI_INVALID_RESPONSE', 'A IA retornou uma resposta inválida. Tente novamente ou faça o registro manual.'); }
  if (payload?.status && payload.status !== 'completed') throw new WorkerError(502, 'AI_INVALID_RESPONSE', 'A IA não concluiu a leitura. Tente novamente ou faça o registro manual.');
  return parseOpenAiOutput(payload);
}

function tokenPolicy(kind) {
  if (kind === 'appCheck') return {
    jwksUrl: APP_CHECK_JWKS_URL,
    maxKeyAgeSeconds: APP_CHECK_MAX_KEY_AGE_SECONDS,
    issuer: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
    audience: `projects/${PROJECT_NUMBER}`,
    subject: WEB_APP_ID,
    status: 401,
    code: 'INVALID_APP_CHECK',
    message: 'A validação de segurança do app expirou. Atualize a página e tente novamente.'
  };
  return {
    jwksUrl: AUTH_JWKS_URL,
    maxKeyAgeSeconds: APP_CHECK_MAX_KEY_AGE_SECONDS,
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
    requireAuthTime: true,
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Entre novamente no SAHMT para ler a etiqueta.'
  };
}

export function createWorker({fetchImpl = globalThis.fetch, crypto = globalThis.crypto, now = Date.now} = {}) {
  const getKeys = createJwkCache(fetchImpl, now);

  async function handle(request, env = {}) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== ALLOWED_ORIGIN) return jsonResponse(403, {error: {code: 'ORIGIN_NOT_ALLOWED', message: 'Origem não autorizada.'}}, null);

    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse(200, {ok: true, service: 'sahmt-label-ai', firebaseProject: PROJECT_ID, model: MODEL}, origin);
    }
    if (url.pathname !== '/v1/labels/extract') return jsonResponse(404, {error: {code: 'NOT_FOUND', message: 'Rota não encontrada.'}}, origin);
    if (request.method === 'OPTIONS') {
      if (origin !== ALLOWED_ORIGIN) return jsonResponse(403, {error: {code: 'ORIGIN_NOT_ALLOWED', message: 'Origem não autorizada.'}}, null);
      return new Response(null, {status: 204, headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Firebase-AppCheck',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
        'Vary': 'Origin'
      }});
    }
    if (request.method !== 'POST') return jsonResponse(405, {error: {code: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.'}}, origin);

    try {
      const idToken = authorizationToken(request);
      const appCheckToken = request.headers.get('X-Firebase-AppCheck') || '';
      if (!appCheckToken) throw new WorkerError(401, 'APP_CHECK_REQUIRED', 'A validação de segurança do app não foi enviada. Atualize a página e tente novamente.');
      const [identity, appCheck] = await Promise.all([
        verifyJwt(idToken, tokenPolicy('auth'), {getKeys, crypto, now}),
        verifyJwt(appCheckToken, tokenPolicy('appCheck'), {getKeys, crypto, now})
      ]);
      if (!identity.sub || appCheck.sub !== WEB_APP_ID) throw new WorkerError(401, 'UNAUTHENTICATED', 'A sessão não foi validada. Entre novamente no SAHMT.');
      await readAuthorizedProfile(identity.sub, idToken, fetchImpl);

      const contentType = request.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().startsWith('application/json')) throw new WorkerError(400, 'INVALID_REQUEST', 'A imagem enviada está inválida. Capture novamente.');
      const contentLength = Number(request.headers.get('Content-Length') || 0);
      if (contentLength > MAX_REQUEST_BYTES) throw new WorkerError(413, 'IMAGE_TOO_LARGE', 'A foto excede o limite. Capture novamente ou use o registro manual.');
      let body;
      try { body = await request.json(); }
      catch { throw new WorkerError(400, 'INVALID_REQUEST', 'A imagem enviada está inválida. Capture novamente.'); }
      const images = validateImages(body, request);
      const result = await extractWithOpenAi(images, env.OPENAI_API_KEY, fetchImpl);
      return jsonResponse(200, result, origin);
    } catch (error) {
      return errorResponse(error, origin);
    }
  }

  return {fetch: handle};
}

export default createWorker();
