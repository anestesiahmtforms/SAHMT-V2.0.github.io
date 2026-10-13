import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFbInventoryReport, collectFbAuthIndex, compareFaFbIndexes, safeFbInventoryDiagnostic} from '../scripts/lib/management-fb-inventory.js';
import {sealPrivateJson, openPrivateJson} from '../scripts/lib/windows-protected-json.js';

const token = 'synthetic-read-token-for-tests-only';
const response = payload => ({ok: true, status: 200, json: async () => payload});
const fa = users => ({schemaVersion: 1, kind: 'FA_UID_COMPARISON_INDEX', projectId: 'sahmt-17a16', users: users.map(value => ({...value, adminCategory: 'NOT_ADMIN'}))});
const fb = users => ({schemaVersion: 1, kind: 'FB_UID_COMPARISON_INDEX', projectId: 'sahmt-gestao-5ae66', users});
const user = (uid, disabled = false, providerCategory = 'GOOGLE_ONLY') => ({uid, disabled, providerCategory});

test('comparação classifica equivalentes, ausentes, conflitos e revisão sem expor UIDs', () => {
  const counts = compareFaFbIndexes(
    fa([user('same'), user('missing'), user('state-conflict'), user('provider-conflict'),
      {...user('homol-1', null, 'NO_PROVIDER'), identityMarker: 'HOMOLOGATION_CANDIDATE_1'},
      {...user('homol-2', false, 'NO_PROVIDER'), identityMarker: 'HOMOLOGATION_CANDIDATE_2'},
      {...user('structural', false, 'GOOGLE_ONLY'), identityMarker: 'STRUCTURAL_OWNER'},
      user('unknown-old-participant', null, 'NO_PROVIDER')]),
    fb([user('same'), user('state-conflict', true), user('provider-conflict', false, 'PASSWORD_ONLY'), user('homol-1', null, 'NO_PROVIDER'), user('structural'), user('fb-only')])
  );
  assert.deepEqual(counts, {operational: {equivalent: 1, missing: 1, conflicts: 2, review: 2},
    homologation: {accounts: 2, presentInFb: 1, absentInFb: 1, review: 0}, structural: {accounts: 1, presentInFb: 1, absentInFb: 0}});
  assert.deepEqual(Object.keys(counts.operational), ['equivalent', 'missing', 'conflicts', 'review']);
  assert.equal(JSON.stringify(counts).includes('same'), false);
  const report = buildFbInventoryReport(
    fa([user('same'), user('missing'), user('state-conflict'), user('provider-conflict'),
      {...user('homol-1', null, 'NO_PROVIDER'), identityMarker: 'HOMOLOGATION_CANDIDATE_1'},
      {...user('homol-2', false, 'NO_PROVIDER'), identityMarker: 'HOMOLOGATION_CANDIDATE_2'},
      {...user('structural', false, 'GOOGLE_ONLY'), identityMarker: 'STRUCTURAL_OWNER'}, user('unknown-old-participant', null, 'NO_PROVIDER')]),
    fb([user('same'), user('state-conflict', true), user('provider-conflict', false, 'PASSWORD_ONLY'), user('homol-1', null, 'NO_PROVIDER'), user('structural'), user('fb-only')])
  );
  assert.deepEqual(report, {totalFbAccounts: 6, operational: {equivalent: 1, missing: 1, conflicts: 2, review: 2},
    homologation: {accounts: 2, presentInFb: 1, absentInFb: 1, review: 0}, structural: {accounts: 1, presentInFb: 1, absentInFb: 0}});
  assert.equal(JSON.stringify(report).includes('same'), false);
});

test('estado disabled desconhecido não classifica homologação e não exige quantidade fixa', () => {
  const report = compareFaFbIndexes(fa([
    {...user('validated-structural-owner'), identityMarker: 'STRUCTURAL_OWNER'},
    user('unknown-one', null, 'NO_PROVIDER'), user('unknown-two', null, 'NO_PROVIDER')
  ]), fb([]));
  assert.deepEqual(report, {operational: {equivalent: 0, missing: 0, conflicts: 0, review: 2},
    homologation: {accounts: 0, presentInFb: 0, absentInFb: 0, review: 0}, structural: {accounts: 1, presentInFb: 0, absentInFb: 1}});
});

test('marcador de candidato duplicado vai para revisão e índice inválido é rejeitado', () => {
  assert.throws(() => compareFaFbIndexes(fa([user('x'), user('x')]), fb([])), /FB_COMPARISON_INDEX_INVALID/);
  assert.throws(() => compareFaFbIndexes(fa([]), {...fb([]), projectId: 'wrong'}), /FB_COMPARISON_INDEX_INVALID/);
  const result = compareFaFbIndexes(fa([
    {...user('structural-owner'), identityMarker: 'STRUCTURAL_OWNER'},
    {...user('candidate-a'), identityMarker: 'HOMOLOGATION_CANDIDATE_1'},
    {...user('candidate-b'), identityMarker: 'HOMOLOGATION_CANDIDATE_1'}
  ]), fb([]));
  assert.equal(result.homologation.accounts, 0);
  assert.equal(result.homologation.review, 2);
  assert.throws(() => compareFaFbIndexes(fa([user('ownerless')]), fb([])), /FB_STRUCTURAL_OWNER_MARKER_UNVERIFIED/);
});

test('captura somente Auth do FB com paginação GET e descarta campos pessoais e credenciais', async () => {
  const calls = [], sourcePages = [
    {users: [{localId: 'synthetic-1', disabled: false, providerUserInfo: [{providerId: 'google.com', email: 'PRIVATE EMAIL', rawId: 'PRIVATE FEDERATED ID'}],
      email: 'PRIVATE EMAIL', displayName: 'PRIVATE NAME', passwordHash: 'PRIVATE HASH', salt: 'PRIVATE SALT', idToken: 'PRIVATE ID TOKEN', refreshToken: 'PRIVATE REFRESH TOKEN'}], nextPageToken: 'PRIVATE PAGE TOKEN'},
    {users: [{localId: 'synthetic-2', disabled: true, providerUserInfo: [{providerId: 'password'}], passwordHash: 'PRIVATE HASH 2', salt: 'PRIVATE SALT 2'}]}
  ];
  const rawUsers = sourcePages.flatMap(page => page.users);
  const requestScopes = [];
  const result = await collectFbAuthIndex({getAccessToken: async request => {
    assert.equal(request.projectId, 'sahmt-gestao-5ae66');
    assert.equal(request.api, 'AUTHENTICATION_READ_ONLY');
    requestScopes.push(request.scopes);
    return token;
  }, fetchImpl: async (url, options) => {
    calls.push({url: String(url), options});
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    const parsed = new URL(String(url));
    assert.equal(parsed.hostname, 'identitytoolkit.googleapis.com');
    assert.match(parsed.pathname, /\/projects\/sahmt-gestao-5ae66\/accounts:batchGet$/);
    assert.equal(parsed.searchParams.get('maxResults'), '1000');
    if (calls.length === 1) {
      assert.deepEqual([...parsed.searchParams.keys()], ['maxResults']);
      assert.equal(parsed.searchParams.has('nextPageToken'), false);
    } else {
      assert.deepEqual([...parsed.searchParams.keys()], ['maxResults', 'nextPageToken']);
      assert.equal(parsed.searchParams.get('nextPageToken'), 'PRIVATE PAGE TOKEN');
    }
    return response(sourcePages.shift());
  }});
  assert.deepEqual(requestScopes, [['https://www.googleapis.com/auth/cloud-platform']]);
  assert.equal(result.kind, 'FB_UID_COMPARISON_INDEX');
  assert.equal(result.projectId, 'sahmt-gestao-5ae66');
  assert.equal(result.pages, 2);
  assert.deepEqual(result.users, [user('synthetic-1', false), user('synthetic-2', true, 'PASSWORD_ONLY')]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({options}) => options.method), ['GET', 'GET']);
  assert.equal(rawUsers.every(value => Object.values(value).every(field => field === null)), true);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('HTTP 400 inspeciona somente campos estruturados em allowlist e sanitiza os diagnósticos', async t => {
  const cases = [
    {name: 'INVALID_ARGUMENT', status: 'INVALID_ARGUMENT', errors: [], expected: 'AUTH_BAD_REQUEST_INVALID_ARGUMENT'},
    {name: 'badRequest reason', errors: [{reason: 'badRequest'}], expected: 'AUTH_BAD_REQUEST_MALFORMED'},
    {name: 'invalidParameter reason', errors: [{reason: 'invalidParameter'}], expected: 'AUTH_BAD_REQUEST_INVALID_PARAMETER'},
    {name: 'required reason', errors: [{reason: 'required'}], expected: 'AUTH_BAD_REQUEST_REQUIRED_FIELD'},
    {name: 'unknown reason', errors: [{reason: 'secret-containing-unknown-reason'}], expected: 'AUTH_BAD_REQUEST_UNKNOWN'},
    {name: 'unknown status', status: 'SENSITIVE_UNKNOWN_STATUS', expected: 'AUTH_BAD_REQUEST_UNKNOWN'},
    {name: 'malformed JSON', parseFailure: true, expected: 'AUTH_BAD_REQUEST_UNKNOWN'}
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const body = item.parseFailure ? null : {error: {
      ...(item.status ? {status: item.status} : {}),
      ...(item.errors ? {errors: item.errors} : {}),
      message: 'PRIVATE EMAIL secret@example.invalid PRIVATE TOKEN PRIVATE UID',
      details: [{secret: 'PRIVATE HASH PRIVATE SALT'}]
    }};
    let parsed = false;
    const error = await collectFbAuthIndex({getAccessToken: async () => token, fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      const parsedUrl = new URL(String(url));
      assert.equal(parsedUrl.hostname, 'identitytoolkit.googleapis.com');
      assert.match(parsedUrl.pathname, /\/projects\/sahmt-gestao-5ae66\/accounts:batchGet$/);
      return {ok: false, status: 400, json: async () => {
        parsed = true;
        if (item.parseFailure) throw new Error('PRIVATE EMAIL PRIVATE TOKEN');
        return body;
      }};
    }}).catch(value => value);
    assert.equal(parsed, true);
    assert.equal(error.message, 'FB_AUTH_HTTP_400');
    const diagnostic = safeFbInventoryDiagnostic('AUTH_READ', error);
    assert.deepEqual(diagnostic, {stage: 'AUTH_READ', httpStatus: 400, category: item.expected});
    const serialized = JSON.stringify({error, diagnostic});
    for (const secret of ['PRIVATE EMAIL', 'secret@example.invalid', 'PRIVATE TOKEN', 'PRIVATE UID', 'PRIVATE HASH', 'PRIVATE SALT', 'SENSITIVE_UNKNOWN_STATUS', 'secret-containing-unknown-reason']) {
      assert.equal(serialized.includes(secret), false, `diagnostic leaked ${secret}`);
    }
    if (body) assert.deepEqual(body, {error: null}, 'parsed error object is wiped after classification');
  });
});

test('outros erros HTTP geram somente etapa, status e categoria fixa', async t => {
  for (const [status, category] of [[401, 'AUTH_HTTP_UNAUTHENTICATED'], [403, 'AUTH_HTTP_FORBIDDEN'], [404, 'AUTH_HTTP_NOT_FOUND'], [503, 'AUTH_HTTP_ERROR']]) await t.test(`HTTP ${status}`, async () => {
    let bodyRead = false;
    const error = await collectFbAuthIndex({getAccessToken: async () => token, fetchImpl: async () => ({ok: false, status, json: async () => { bodyRead = true; return {error: {message: 'PRIVATE'}}; }})}).catch(value => value);
    assert.equal(error.message, `FB_AUTH_HTTP_${status}`);
    assert.deepEqual(safeFbInventoryDiagnostic('AUTH_READ', error), {stage: 'AUTH_READ', httpStatus: status, category});
    assert.equal(bodyRead, false);
  });
});

test('falhas de rede e paginação usam erros fixos sem mensagem bruta', async t => {
  await t.test('rede', async () => {
    const error = await collectFbAuthIndex({getAccessToken: async () => token, fetchImpl: async () => { throw new Error('PRIVATE URL with token'); }}).catch(value => value);
    assert.equal(error.message, 'FB_AUTH_REQUEST_FAILED');
  });
  await t.test('token de página repetido', async () => {
    let calls = 0;
    const error = await collectFbAuthIndex({getAccessToken: async () => token, fetchImpl: async () => { calls++; return response({users: [], nextPageToken: 'PRIVATE PAGE TOKEN'}); }}).catch(value => value);
    assert.equal(error.message, 'FB_AUTH_PAGE_TOKEN_REPEATED');
    assert.equal(calls, 2);
  });
});

test('somente o índice mínimo é preparado para DPAPI e erro de proteção não revela detalhes', {skip: process.platform !== 'win32'}, async () => {
  const index = fb([user('synthetic-only')]);
  const envelope = await sealPrivateJson(index);
  assert.equal(JSON.stringify(envelope).includes('synthetic-only'), false);
  assert.deepEqual(await openPrivateJson(envelope), index);
});

test('diagnósticos de OAuth e DPAPI não incluem mensagens brutas', () => {
  assert.deepEqual(safeFbInventoryDiagnostic('OAUTH_TOKEN', new Error('invalid_scope private@example.com')), {stage: 'OAUTH_TOKEN', httpStatus: null, category: 'OAUTH_TOKEN'});
  assert.deepEqual(safeFbInventoryDiagnostic('DPAPI_FB_INDEX_SEAL', new Error('PRIVATE DPAPI data')), {stage: 'DPAPI_FB_INDEX_SEAL', httpStatus: null, category: 'LOCAL_DPAPI'});
});
