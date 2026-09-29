import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createWorker} from './worker.js';

const PROJECT_ID = 'sahmt-17a16';
const PROJECT_NUMBER = '1072832154794';
const APP_ID = '1:1072832154794:web:38e8e627d4189ebb0a14d3';
const ORIGIN = 'https://anestesiahmtforms.github.io';
const nowMs = Date.parse('2026-09-28T18:00:00.000Z');
const nowSeconds = Math.floor(nowMs / 1000);
const authPair = await webcrypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
const appCheckPair = await webcrypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
const authJwk = {...await webcrypto.subtle.exportKey('jwk', authPair.publicKey), kid: 'test-auth-key', alg: 'RS256', use: 'sig'};
const appCheckJwk = {...await webcrypto.subtle.exportKey('jwk', appCheckPair.publicKey), kid: 'test-appcheck-key', alg: 'RS256', use: 'sig'};
const validExtraction = {nomePaciente: 'Paciente de Teste', convenio: 'Convênio Teste', cirurgia: '0123', atendimento: '0456', tipo: '', credor: ''};
const testJpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function signedToken(pair, kid, claims, header = {}) {
  const encodedHeader = base64url(JSON.stringify({alg: 'RS256', typ: 'JWT', kid, ...header}));
  const encodedClaims = base64url(JSON.stringify(claims));
  const input = `${encodedHeader}.${encodedClaims}`;
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${base64url(signature)}`;
}

async function tokens({idClaims = {}, appCheckClaims = {}, appCheckHeader = {}, idHeader = {}} = {}) {
  const idToken = await signedToken(authPair, 'test-auth-key', {
    iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID,
    sub: 'test-user-1', iat: nowSeconds - 60, exp: nowSeconds + 3600, auth_time: nowSeconds - 120,
    ...idClaims
  }, idHeader);
  const appCheckToken = await signedToken(appCheckPair, 'test-appcheck-key', {
    iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
    aud: [`projects/${PROJECT_NUMBER}`], sub: APP_ID,
    iat: nowSeconds - 60, exp: nowSeconds + 300,
    ...appCheckClaims
  }, appCheckHeader);
  return {idToken, appCheckToken};
}

function firestoreProfile({uid = 'test-user-1', active = true, access = true, role = 'usuario', permissions = {labelsWrite: true}} = {}) {
  return {fields: {
    uid: {stringValue: uid}, active: {booleanValue: active}, access: {booleanValue: access}, role: {stringValue: role},
    permissions: {mapValue: {fields: Object.fromEntries(Object.entries(permissions).map(([name, value]) => [name, {booleanValue: value}]))}}
  }};
}

function createFixture({profile = firestoreProfile(), openAiStatus = 200, openAiPayload, apiKey = 'test-only-secret'} = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({url, init});
    if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
      return Response.json({keys: [authJwk]}, {headers: {'Cache-Control': 'public, max-age=3600'}});
    }
    if (url === 'https://firebaseappcheck.googleapis.com/v1/jwks') {
      return Response.json({keys: [appCheckJwk]}, {headers: {'Cache-Control': 'public, max-age=7200'}});
    }
    if (url.startsWith(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/`)) {
      return profile === null ? new Response('', {status: 404}) : Response.json(profile);
    }
    if (url === 'https://api.openai.com/v1/responses') {
      if (openAiStatus !== 200) return new Response('', {status: openAiStatus});
      return Response.json(openAiPayload || {status: 'completed', output_text: JSON.stringify(validExtraction)});
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };
  const worker = createWorker({fetchImpl, crypto: webcrypto, now: () => nowMs});
  const request = async ({origin = ORIGIN, idToken, appCheckToken, body = {imageDataUrl: testJpeg, numericImageDataUrls: []}, method = 'POST', path = '/v1/labels/extract'} = {}) => {
    const headers = new Headers();
    if (origin !== null) headers.set('Origin', origin);
    if (idToken) headers.set('Authorization', `Bearer ${idToken}`);
    if (appCheckToken) headers.set('X-Firebase-AppCheck', appCheckToken);
    if (method === 'POST') headers.set('Content-Type', 'application/json');
    return worker.fetch(new Request(`https://worker.test${path}`, {method, headers, ...(method === 'POST' ? {body: JSON.stringify(body)} : {})}), {OPENAI_API_KEY: apiKey});
  };
  return {calls, request};
}

async function validTokenPair(overrides) {
  return tokens(overrides);
}

test('health expõe somente status técnico e libera CORS apenas para o PWA oficial', async () => {
  const fixture = createFixture();
  const response = await fixture.request({method: 'GET', path: '/health'});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok: true, service: 'sahmt-label-ai', firebaseProject: PROJECT_ID, model: 'gpt-6-luna'});
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await fixture.request({method: 'GET', path: '/health', origin: 'https://example.org'})).status, 403);
});

test('preflight permite os dois tokens apenas na origem oficial', async () => {
  const fixture = createFixture();
  const response = await fixture.request({method: 'OPTIONS'});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /x-firebase-appcheck/i);
  assert.equal((await fixture.request({method: 'OPTIONS', origin: 'https://example.org'})).status, 403);
});

test('origem externa é bloqueada antes de qualquer chamada aos serviços', async () => {
  const fixture = createFixture();
  const response = await fixture.request({origin: 'https://example.org'});
  assert.equal(response.status, 403);
  assert.equal(fixture.calls.length, 0);
});

test('POST sem Firebase ID Token ou sem App Check é rejeitado', async () => {
  const fixture = createFixture();
  assert.equal((await fixture.request()).status, 401);
  const {idToken} = await validTokenPair();
  const missingAppCheck = await fixture.request({idToken});
  assert.equal(missingAppCheck.status, 401);
  assert.equal((await missingAppCheck.json()).error.code, 'APP_CHECK_REQUIRED');
  assert.equal(fixture.calls.some((call) => call.url.includes('firestore.googleapis.com')), false);
});

test('Firebase ID Token com assinatura, algoritmo ou claims inválidos é rejeitado', async () => {
  const fixture = createFixture();
  const signed = await validTokenPair({idHeader: {alg: 'HS256'}});
  assert.equal((await fixture.request({...signed})).status, 401);
  const wrongAudience = await validTokenPair({idClaims: {aud: 'outro-projeto'}});
  assert.equal((await fixture.request(wrongAudience)).status, 401);
  const expired = await validTokenPair({idClaims: {exp: nowSeconds - 1}});
  assert.equal((await fixture.request(expired)).status, 401);
});

test('App Check verifica assinatura, kid, algoritmo, tipo, expiração, emissor, projeto e Web App ID', async () => {
  const fixture = createFixture();
  const wrongAudience = await validTokenPair({appCheckClaims: {aud: ['projects/999']}});
  assert.equal((await fixture.request(wrongAudience)).status, 401);
  const wrongSubject = await validTokenPair({appCheckClaims: {sub: '1:outro:web:app'}});
  assert.equal((await fixture.request(wrongSubject)).status, 401);
  const expired = await validTokenPair({appCheckClaims: {exp: nowSeconds - 1}});
  assert.equal((await fixture.request(expired)).status, 401);
  const wrongType = await validTokenPair({appCheckHeader: {typ: 'at+jwt'}});
  assert.equal((await fixture.request(wrongType)).status, 401);
  const {idToken} = await validTokenPair();
  const badSignature = await signedToken(authPair, 'test-appcheck-key', {
    iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`, aud: [`projects/${PROJECT_NUMBER}`],
    sub: APP_ID, iat: nowSeconds - 60, exp: nowSeconds + 300
  });
  assert.equal((await fixture.request({idToken, appCheckToken: badSignature})).status, 401);
});

test('conta sem cadastro, inativa, sem acesso ou sem permissão recebe 403', async () => {
  const tokensForUser = await validTokenPair();
  for (const profile of [
    null,
    firestoreProfile({active: false}),
    firestoreProfile({access: false}),
    firestoreProfile({permissions: {labelsRead: true}})
  ]) {
    const fixture = createFixture({profile});
    assert.equal((await fixture.request(tokensForUser)).status, 403);
    assert.equal(fixture.calls.some((call) => call.url === 'https://api.openai.com/v1/responses'), false);
  }
});

test('labelsWrite, labelsManage, admin e papel administrador_app autorizam a leitura', async () => {
  const tokensForUser = await validTokenPair();
  for (const profile of [
    firestoreProfile({permissions: {labelsWrite: true}}),
    firestoreProfile({permissions: {labelsManage: true}}),
    firestoreProfile({permissions: {admin: true}}),
    firestoreProfile({role: 'administrador_app', permissions: {}})
  ]) {
    const fixture = createFixture({profile});
    assert.equal((await fixture.request(tokensForUser)).status, 200);
  }
});

test('imagem inválida retorna 400 sem chamar a OpenAI', async () => {
  const fixture = createFixture();
  const tokensForUser = await validTokenPair();
  const response = await fixture.request({...tokensForUser, body: {imageDataUrl: 'data:image/jpeg;base64,SGVsbG8=', numericImageDataUrls: []}});
  assert.equal(response.status, 400);
  assert.equal(fixture.calls.some((call) => call.url === 'https://api.openai.com/v1/responses'), false);
});

test('extração usa o GPT-6 Luna, imagens principais/recortes e devolve rascunho sem gravar no Firestore', async () => {
  const fixture = createFixture();
  const tokensForUser = await validTokenPair();
  const response = await fixture.request({...tokensForUser, body: {imageDataUrl: testJpeg, numericImageDataUrls: [testJpeg]}});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    model: 'gpt-6-luna', patientName: 'Paciente de Teste', insurance: 'Convênio Teste', procedureCode: '0123',
    encounterCode: '0456', type: '', creditor: '', uncertain: []
  });
  const openAiCall = fixture.calls.find((call) => call.url === 'https://api.openai.com/v1/responses');
  const openAiRequest = JSON.parse(openAiCall.init.body);
  assert.equal(openAiRequest.model, 'gpt-6-luna');
  assert.equal(openAiRequest.store, false);
  assert.deepEqual(openAiRequest.reasoning, {effort: 'none'});
  assert.equal(openAiRequest.text.format.type, 'json_schema');
  assert.equal(openAiRequest.input[0].content.filter((part) => part.type === 'input_image').length, 2);
  assert.match(openAiRequest.input[0].content[0].text, /zero de oito/);
  assert.equal(fixture.calls.filter((call) => call.url.includes('firestore.googleapis.com')).length, 1);
  assert.equal(fixture.calls.some((call) => /POST|PATCH/.test(call.init.method || 'GET') && call.url.includes('firestore.googleapis.com')), false);
});

test('Consulta Pré-anestésica e SADT mantêm os campos de rascunho correspondentes', async () => {
  const tokensForUser = await validTokenPair();
  const consultation = createFixture({openAiPayload: {status: 'completed', output_text: JSON.stringify({nomePaciente: 'Paciente', convenio: 'Convênio que será removido', cirurgia: '123', atendimento: '456', tipo: 'Consulta Pré-anestésica', credor: ''})}});
  assert.deepEqual(await (await consultation.request(tokensForUser)).json(), {
    model: 'gpt-6-luna', patientName: 'Paciente', insurance: '', procedureCode: '', encounterCode: '456',
    type: 'Consulta Pré-anestésica', creditor: 'Caixa', uncertain: []
  });
  const sadt = createFixture({openAiPayload: {status: 'completed', output_text: JSON.stringify({nomePaciente: 'Paciente', convenio: 'Convênio', cirurgia: '123', atendimento: '456', tipo: 'SADT', credor: 'Caixa'})}});
  assert.deepEqual(await (await sadt.request(tokensForUser)).json(), {
    model: 'gpt-6-luna', patientName: 'Paciente', insurance: 'Convênio', procedureCode: '', encounterCode: '456',
    type: 'SADT', creditor: '', uncertain: []
  });
});

test('indisponibilidade e limite da OpenAI retornam erros controlados sem detalhes do provedor', async () => {
  const tokensForUser = await validTokenPair();
  const unavailable = await createFixture({openAiStatus: 503}).request(tokensForUser);
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error.message, /preencha os campos manualmente/i);
  const rateLimited = await createFixture({openAiStatus: 429}).request(tokensForUser);
  assert.equal(rateLimited.status, 429);
  assert.match((await rateLimited.json()).error.message, /preencha os campos manualmente/i);
  const missingSecret = await createFixture({apiKey: ''}).request(tokensForUser);
  assert.equal(missingSecret.status, 503);
});
