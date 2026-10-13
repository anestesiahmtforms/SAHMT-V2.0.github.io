import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFaInventory, safeInventoryDiagnostic} from '../scripts/lib/management-fa-inventory.js';
import {sealPrivateJson, openPrivateJson} from '../scripts/lib/windows-protected-json.js';

const authToken = 'synthetic-cloud-platform-oauth-token-never-output';
const profile = (uid, fields) => ({name: `projects/sahmt-17a16/databases/(default)/documents/users/${uid}`,
  fields: {...fields, email: {stringValue: 'private-email@example.invalid'}, displayName: {stringValue: 'PRIVATE PROFILE NAME'}, passwordHash: {stringValue: 'PRIVATE FIRESTORE HASH'}}});
const bool = value => ({booleanValue: value});
const string = value => ({stringValue: value});
const response = payload => ({ok: true, status: 200, json: async () => payload});

function fixtureFetch() {
  const calls = [], authPages = [
    {users: [
      {localId: 'synthetic-admin', disabled: false, email: 'fa-owner@example.invalid', displayName: 'PRIVATE AUTH NAME',
        providerUserInfo: [{providerId: 'google.com', rawId: 'private-google-id'}], passwordHash: 'PRIVATE AUTH HASH', salt: 'PRIVATE AUTH SALT', idToken: 'PRIVATE ID TOKEN', refreshToken: 'PRIVATE REFRESH TOKEN', accessToken: 'PRIVATE PROVIDER TOKEN'},
      {localId: 'synthetic-password', disabled: true, email: 'homologation-a@example.invalid', providerUserInfo: [{providerId: 'password', rawId: 'private-password-id'}], passwordHash: 'PRIVATE PASSWORD HASH', salt: 'PRIVATE PASSWORD SALT'}
    ], nextPageToken: 'PRIVATE AUTH PAGE TOKEN'},
    {users: [{localId: 'synthetic-other', email: 'homologation-b@example.invalid', providerUserInfo: [{providerId: 'apple.com', rawId: 'private-apple-id'}]}]}
  ];
  const profilePages = [
    {documents: [
      profile('synthetic-admin', {role: string('administrador_app'), active: bool(true), access: bool(true), permissions: {mapValue: {fields: {admin: bool(false)}}}}),
      profile('synthetic-password', {role: string('profissional'), active: bool(false), access: bool(true), firstLoginCohort: string('OPERATIONAL'), permissions: {mapValue: {fields: {admin: bool(true)}}}})
    ], nextPageToken: 'PRIVATE PROFILE PAGE TOKEN'},
    {documents: [
      profile('synthetic-orphan', {role: string('profissional'), active: bool(true), access: bool(true)}),
      profile('synthetic-other', {role: string('profissional'), active: bool(true), access: bool(true), firstLoginCohort: string('UNAPPROVED'), permissions: {mapValue: {fields: {admin: bool(false)}}}})
    ]}
  ];
  const sourceAuthUsers = authPages.flatMap(page => page.users);
  const sourceProfileDocuments = profilePages.flatMap(page => page.documents);
  const fetchImpl = async (url, options) => {
    calls.push({url: String(url), options});
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    const parsed = new URL(String(url));
    if (parsed.hostname === 'identitytoolkit.googleapis.com') {
      assert.equal(options.headers.Authorization, `Bearer ${authToken}`);
      assert.match(parsed.pathname, /\/projects\/sahmt-17a16\/accounts:batchGet$/);
      return response(authPages.shift());
    }
    assert.equal(options.headers.Authorization, `Bearer ${authToken}`);
    assert.equal(parsed.hostname, 'firestore.googleapis.com');
    assert.match(parsed.pathname, /\/projects\/sahmt-17a16\/databases\/\(default\)\/documents\/users$/);
    assert.deepEqual(parsed.searchParams.getAll('mask.fieldPaths'), ['role', 'permissions.admin', 'active', 'access', 'firstLoginCohort']);
    assert.equal(parsed.searchParams.get('pageSize'), '1000');
    return response(profilePages.shift());
  };
  return {fetchImpl, calls, sourceAuthUsers, sourceProfileDocuments};
}

test('captura FA usa paginação e projeção, produz somente categorias e índice mínimo', async () => {
  const {fetchImpl, calls, sourceAuthUsers, sourceProfileDocuments} = fixtureFetch();
  const scopes = [];
  const result = await collectFaInventory({fetchImpl, getAccessToken: async request => {
    assert.equal(request.projectId, 'sahmt-17a16'); scopes.push([request.api, ...request.scopes]);
    assert.equal(request.api, 'READ_ONLY_DATA');
    return authToken;
  }});
  assert.deepEqual(scopes, [['READ_ONLY_DATA', 'https://www.googleapis.com/auth/cloud-platform']]);
  assert.equal(result.report.projectId, 'sahmt-17a16');
  assert.deepEqual(result.report.auth, {total: 3, enabled: 1, disabled: 1, disabledUnknown: 1,
    providerCategories: {GOOGLE_ONLY: 1, PASSWORD_ONLY: 1, OTHER_PROVIDERS_ONLY: 1}});
  assert.deepEqual(result.report.profiles.administrativeCategories, {ADMIN_ELIGIBLE: 1, ADMIN_INACTIVE_OR_NO_ACCESS: 1, NOT_ADMIN: 2, PROFILE_REVIEW: 0, PROFILE_MISSING: 0});
  assert.deepEqual(result.report.profiles.firstLoginCohorts, {OPERATIONAL: 1, STRUCTURAL: 0, HOMOLOGATION: 0, REVIEW: 0, MISSING: 2, INVALID: 1});
  assert.deepEqual(result.report.profiles.operationalFlow, {authEnabledAndActiveWithAccess: 1, prerequisitesBlockedOrUnknown: 2,
    protectedStructural: 1, protectedHomologation: 2, cohortOperationalAndEligible: 0});
  assert.equal(result.report.profiles.orphanProfiles, 1);
  assert.equal(result.report.profiles.authUsersMissingProfile, 0);
  assert.deepEqual(result.report.pages, {authentication: 2, firestoreProfiles: 2});
  assert.equal(result.report.accountChangesIssued, 0);
  assert.equal(result.report.firestoreWritesIssued, 0);
  assert.deepEqual(result.protectedIndex.users.map(user => user.uid), ['synthetic-admin', 'synthetic-password', 'synthetic-other']);
  assert.deepEqual(result.protectedIndex.users.map(user => user.identityMarker), ['STRUCTURAL_OWNER', 'HOMOLOGATION_CANDIDATE_1', 'HOMOLOGATION_CANDIDATE_2']);
  const serialized = JSON.stringify(result);
  for (const sensitive of ['fa-owner@example.invalid', 'homologation-a@example.invalid', 'homologation-b@example.invalid', 'PRIVATE AUTH NAME', 'PRIVATE AUTH HASH', 'PRIVATE AUTH SALT', 'PRIVATE ID TOKEN', 'PRIVATE REFRESH TOKEN', 'PRIVATE PROVIDER TOKEN', 'private-google-id', 'PRIVATE PASSWORD HASH', 'PRIVATE PASSWORD SALT', 'PRIVATE PROFILE NAME', 'PRIVATE FIRESTORE HASH', 'PRIVATE AUTH PAGE TOKEN', 'PRIVATE PROFILE PAGE TOKEN']) {
    assert.equal(serialized.includes(sensitive), false, `sensitive fixture leaked: ${sensitive}`);
  }
  assert.equal(sourceAuthUsers.every(user => Object.values(user).every(value => value === null)), true, 'raw Auth user fields were not discarded');
  assert.equal(sourceProfileDocuments.every(document => Object.values(document).every(value => value === null)), true, 'raw Firestore document fields were not discarded');
  assert.equal(calls.length, 4);
  assert.equal(calls.some(call => call.options.method !== 'GET'), false);
});

test('arquivo protegido guarda apenas índice de UID e categorias; resumo e envelope não expõem credenciais', {skip: process.platform !== 'win32'}, async () => {
  const {fetchImpl} = fixtureFetch();
  const result = await collectFaInventory({fetchImpl, getAccessToken: async () => authToken});
  const envelope = await sealPrivateJson(result.protectedIndex);
  const diskPayload = JSON.stringify({report: result.report, envelope});
  for (const sensitive of ['fa-owner@example.invalid', 'homologation-a@example.invalid', 'homologation-b@example.invalid', 'PRIVATE AUTH NAME', 'PRIVATE AUTH HASH', 'PRIVATE AUTH SALT', 'PRIVATE ID TOKEN', 'PRIVATE REFRESH TOKEN', 'PRIVATE PROVIDER TOKEN', 'private-google-id', 'PRIVATE PASSWORD HASH', 'PRIVATE PROFILE NAME', 'PRIVATE FIRESTORE HASH']) {
    assert.equal(diskPayload.includes(sensitive), false, `persisted sensitive fixture: ${sensitive}`);
  }
  assert.equal(diskPayload.includes('synthetic-admin'), false);
  const opened = await openPrivateJson(envelope);
  assert.deepEqual(opened.users.map(user => user.uid), ['synthetic-admin', 'synthetic-password', 'synthetic-other']);
  assert.deepEqual(opened.users.map(user => user.identityMarker), ['STRUCTURAL_OWNER', 'HOMOLOGATION_CANDIDATE_1', 'HOMOLOGATION_CANDIDATE_2']);
  assert.deepEqual(Object.keys(opened.users[0]).sort(), ['adminCategory', 'disabled', 'identityMarker', 'providerCategory', 'uid']);
  assert.equal(Object.hasOwn(opened.users[0], 'email'), false);
});

test('403 da primeira leitura Auth gera apenas código seguro e não persiste resposta do serviço', async () => {
  let calls = 0;
  await assert.rejects(collectFaInventory({getAccessToken: async () => authToken, fetchImpl: async () => {
    calls++;
    return {ok: false, status: 403, json: async () => ({message: 'PRIVATE SERVICE ERROR BODY'})};
  }}), error => error.message === 'FA_AUTH_HTTP_403');
  assert.equal(calls, 1);
});

test('401, 403 e 404 de Authentication são classificados sem corpo da resposta', async t => {
  for (const status of [401, 403, 404]) await t.test(String(status), async () => {
    const result = await collectFaInventory({getAccessToken: async () => authToken, fetchImpl: async () => ({
      ok: false, status, json: async () => ({message: 'PRIVATE EMAIL token=secret'})
    })}).catch(error => error);
    assert.equal(result.message, `FA_AUTH_HTTP_${status}`);
    assert.deepEqual(safeInventoryDiagnostic('AUTH_READ', result), {
      stage: 'AUTH_READ', category: 'AUTH_READ', errorCode: `FA_AUTH_HTTP_${status}`
    });
    assert.equal(JSON.stringify(safeInventoryDiagnostic('AUTH_READ', result)).includes('PRIVATE'), false);
  });
});

test('401, 403 e 404 de Firestore são classificados sem corpo da resposta', async t => {
  for (const status of [401, 403, 404]) await t.test(String(status), async () => {
    let calls = 0;
    const result = await collectFaInventory({getAccessToken: async () => authToken, fetchImpl: async url => {
      calls++;
      if (String(url).includes('identitytoolkit.googleapis.com')) return response({users: []});
      return {ok: false, status, json: async () => ({message: 'PRIVATE PROFILE token=secret'})};
    }}).catch(error => error);
    assert.equal(calls, 2);
    assert.equal(result.message, `FA_PROFILES_HTTP_${status}`);
    const diagnostic = safeInventoryDiagnostic('FIRESTORE_READ', result);
    assert.deepEqual(diagnostic, {stage: 'FIRESTORE_READ', category: 'FIRESTORE_READ', errorCode: `FA_PROFILES_HTTP_${status}`});
    assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'), false);
  });
});

test('falha de rede e erros de paginação produzem códigos seguros', async t => {
  await t.test('rede', async () => {
    await assert.rejects(collectFaInventory({getAccessToken: async () => authToken,
      fetchImpl: async () => { throw new Error('https://private.invalid/?token=secret'); }}), error => error.message === 'FA_AUTH_REQUEST_FAILED');
  });
  await t.test('token de paginação repetido em Auth', async () => {
    let calls = 0;
    await assert.rejects(collectFaInventory({getAccessToken: async () => authToken, fetchImpl: async () => {
      calls++;
      return response({users: [], nextPageToken: 'PRIVATE_PAGE_TOKEN'});
    }}), error => error.message === 'FA_AUTH_PAGE_TOKEN_REPEATED');
    assert.equal(calls, 2);
  });
  await t.test('token de paginação repetido em Firestore', async () => {
    let calls = 0;
    await assert.rejects(collectFaInventory({getAccessToken: async () => authToken, fetchImpl: async url => {
      calls++;
      if (String(url).includes('identitytoolkit.googleapis.com')) return response({users: []});
      return response({documents: [], nextPageToken: 'PRIVATE_PAGE_TOKEN'});
    }}), error => error.message === 'FA_PROFILE_PAGE_TOKEN_REPEATED');
    assert.equal(calls, 3);
  });
});

test('falhas OAuth, DPAPI e gravação local geram diagnóstico categorizado sem detalhes privados', async () => {
  const mockOAuthRefresh = async () => { throw new Error('invalid_scope for private@example.com'); };
  const oauthError = await mockOAuthRefresh().catch(error => error);
  assert.deepEqual(safeInventoryDiagnostic('OAUTH_TOKEN', oauthError), {
    stage: 'OAUTH_TOKEN', category: 'OAUTH_TOKEN', errorCode: 'FA_OAUTH_SCOPES_REQUIRED'
  });
  assert.deepEqual(safeInventoryDiagnostic('OAUTH_TOKEN', new Error('invalid_grant private refresh token')), {
    stage: 'OAUTH_TOKEN', category: 'OAUTH_TOKEN', errorCode: 'FA_OAUTH_REAUTH_REQUIRED'
  });
  const mockDpapiSeal = async () => { throw new Error('PRIVATE DPAPI key material'); };
  const dpapiError = await mockDpapiSeal().catch(error => error);
  const dpapi = safeInventoryDiagnostic('DPAPI_INDEX_SEAL', dpapiError);
  assert.deepEqual(dpapi, {stage: 'DPAPI_INDEX_SEAL', category: 'LOCAL_DPAPI', errorCode: 'FA_DPAPI_INDEX_SEAL_FAILED'});
  const mockLocalWrite = async () => { throw new Error('C:\\private\\email@example.com'); };
  const localWriteError = await mockLocalWrite().catch(error => error);
  const output = safeInventoryDiagnostic('LOCAL_REPORT_WRITE', localWriteError);
  assert.deepEqual(output, {stage: 'LOCAL_REPORT_WRITE', category: 'LOCAL_OUTPUT', errorCode: 'FA_LOCAL_REPORT_WRITE_FAILED'});
  assert.equal(JSON.stringify({dpapi, output}).includes('PRIVATE'), false);
  assert.equal(JSON.stringify({dpapi, output}).includes('email@example.com'), false);
});
