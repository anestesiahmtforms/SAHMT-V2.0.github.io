import assert from 'node:assert/strict';
import test from 'node:test';
import {collectFaCohortProfileIndex, prepareFaFirstLoginCohortPreview} from '../scripts/lib/management-fa-cohort-preview.js';

const auth = (uid, {disabled = false, providerCategory = 'GOOGLE_ONLY', adminCategory = 'NOT_ADMIN', identityMarker = null} = {}) => ({uid, disabled, providerCategory, adminCategory, identityMarker});
const profile = (uid, {profileUid = uid, role = 'anestesiologista', active = true, access = true, permissionsAdmin = false} = {}) => ({uid, profileUid, role, active, access, permissionsAdmin});

function fixture() {
  const authIndex = {
    schemaVersion: 1, kind: 'FA_UID_COMPARISON_INDEX', projectId: 'sahmt-17a16', capturedAt: '2026-10-10T12:00:00.000Z',
    users: [
      auth('synthetic-owner', {providerCategory: 'NO_PROVIDER', adminCategory: 'ADMIN_ELIGIBLE', identityMarker: 'STRUCTURAL_OWNER'}),
      auth('synthetic-h1', {disabled: null, providerCategory: 'NO_PROVIDER', identityMarker: 'HOMOLOGATION_CANDIDATE_1'}),
      auth('synthetic-h2', {disabled: false, providerCategory: 'NO_PROVIDER', identityMarker: 'HOMOLOGATION_CANDIDATE_2'}),
      auth('synthetic-h3', {disabled: null, providerCategory: 'NO_PROVIDER'}),
      auth('synthetic-h4', {disabled: null, providerCategory: 'NO_PROVIDER'}),
      auth('synthetic-operational-admin', {providerCategory: 'NO_PROVIDER', adminCategory: 'ADMIN_ELIGIBLE'}),
      auth('synthetic-operational-google'),
      auth('synthetic-operational-no-provider', {providerCategory: 'NO_PROVIDER'}),
      auth('synthetic-disabled', {disabled: true}),
      auth('synthetic-inactive-profile'),
      auth('synthetic-profile-missing')
    ]
  };
  const profileIndex = {
    schemaVersion: 1, kind: 'FA_COHORT_PROFILE_INDEX', projectId: 'sahmt-17a16', capturedAt: '2026-10-11T12:00:00.000Z', complete: true,
    profiles: [
      profile('synthetic-owner', {role: 'administrador_app', permissionsAdmin: true}),
      ...['synthetic-h1', 'synthetic-h2', 'synthetic-h3', 'synthetic-h4'].map(uid => profile(uid, {active: false, access: false})),
      profile('synthetic-operational-admin', {role: 'administrador_app', permissionsAdmin: true}),
      profile('synthetic-operational-google'),
      profile('synthetic-operational-no-provider'),
      profile('synthetic-disabled'),
      profile('synthetic-inactive-profile', {active: false}),
      profile('synthetic-orphan')
    ]
  };
  return {authIndex, profileIndex};
}

const preview = ({authIndex, profileIndex}, options = {}) => prepareFaFirstLoginCohortPreview({
  authIndex, profileIndex, validatedOwnerUid: 'synthetic-owner', ...options
});

test('prévia agrega as quatro classes e divergências sem devolver UID, e-mail ou nome', () => {
  const {authIndex, profileIndex} = fixture();
  const report = preview({authIndex, profileIndex}, {generatedAt: '2026-10-11T13:00:00.000Z'});
  assert.deepEqual(report.cohorts, {OPERATIONAL: 3, STRUCTURAL: 1, HOMOLOGATION: 2, REVIEW: 5});
  assert.deepEqual(report.administratorsByCohort, {OPERATIONAL: 1, STRUCTURAL: 1, HOMOLOGATION: 0, REVIEW: 0});
  assert.deepEqual(report.divergenceCounts, {
    authProfilesMissing: 1, orphanProfiles: 1, invalidOrIncompleteProfiles: 0, profileUidMismatch: 0, disabledOrAuthStateUnknown: 3,
    authStateUnknownNotConfirmed: 2, structuralHomologationOverlap: 0,
    homologationCandidateIdentityAmbiguous: 0, ownerIdentityMarkerAmbiguous: 0
  });
  assert.equal(report.totalAuthAccounts, 11);
  assert.equal(report.totalProfileDocuments, 11);
  assert.equal(report.ownerUidValidatedAndProtected, true);
  assert.equal(report.providerAbsenceUsedAsPositiveSignal, false);
  assert.equal(report.roleOrPermissionsChanged, false);
  assert.equal(report.writesEnabled, false);
  assert.equal(report.readsIssued, 0);
  assert.equal(report.writesIssued, 0);
  const serialized = JSON.stringify(report);
  for (const id of ['synthetic-owner', 'synthetic-h1', 'synthetic-operational-admin', 'synthetic-profile-missing', 'synthetic-orphan']) assert.equal(serialized.includes(id), false);
  for (const pii of ['@', 'email', 'displayName', 'name']) assert.equal(serialized.includes(pii), false);
  assert.equal(JSON.stringify(authIndex).includes('email'), false);
  assert.equal(JSON.stringify(profileIndex).includes('email'), false);
});

test('ausência de providerData não basta; admin ativo pode ser operacional e admin não vira estrutural automaticamente', () => {
  const {authIndex, profileIndex} = fixture();
  const report = preview({authIndex, profileIndex});
  assert.equal(report.cohorts.OPERATIONAL, 3);
  assert.equal(report.administratorsByCohort.OPERATIONAL, 1);
  const inactive = authIndex.users.find(row => row.uid === 'synthetic-inactive-profile');
  inactive.providerCategory = 'NO_PROVIDER';
  assert.equal(preview({authIndex, profileIndex}).cohorts.REVIEW, 5);
  const incomplete = profileIndex.profiles.find(row => row.uid === 'synthetic-operational-no-provider');
  incomplete.active = null;
  const incompleteReport = preview({authIndex, profileIndex});
  assert.equal(incompleteReport.cohorts.OPERATIONAL, 2);
  assert.equal(incompleteReport.cohorts.REVIEW, 6);
});

test('UID do caminho users/{uid} basta; UID interno e permissions.admin opcionais não bloqueiam perfil íntegro', () => {
  const {authIndex, profileIndex} = fixture();
  const row = profileIndex.profiles.find(value => value.uid === 'synthetic-operational-no-provider');
  row.profileUid = null;
  row.permissionsAdmin = null;
  const report = preview({authIndex, profileIndex});
  assert.equal(report.cohorts.OPERATIONAL, 3);
  assert.equal(report.divergenceCounts.invalidOrIncompleteProfiles, 0);
  assert.equal(report.divergenceCounts.profileUidMismatch, 0);
});

test('índice de decisões com UID só é produzido explicitamente para proteção local', () => {
  const {authIndex, profileIndex} = fixture();
  const result = prepareFaFirstLoginCohortPreview({authIndex, profileIndex, validatedOwnerUid: 'synthetic-owner', includePrivateUidDecisions: true});
  assert.deepEqual(result.report.cohorts, {OPERATIONAL: 3, STRUCTURAL: 1, HOMOLOGATION: 2, REVIEW: 5});
  assert.equal(result.protectedUidDecisions.decisions.find(row => row.uid === 'synthetic-owner').cohort, 'STRUCTURAL');
  assert.equal(result.protectedUidDecisions.decisions.find(row => row.uid === 'synthetic-h1').cohort, 'HOMOLOGATION');
  assert.equal(result.protectedUidDecisions.decisions.find(row => row.uid === 'synthetic-profile-missing').cohort, 'REVIEW');
  assert.equal(JSON.stringify(result.report).includes('synthetic-'), false);
  assert.throws(() => prepareFaFirstLoginCohortPreview({authIndex, profileIndex, validatedOwnerUid: 'synthetic-owner', includePrivateUidDecisions: 'yes'}), /FA_COHORT_PRIVATE_DECISIONS_OPTION_INVALID/);
});

test('conta owner exige UID validado presente no índice e fica estrutural, nunca por e-mail', () => {
  const {authIndex, profileIndex} = fixture();
  assert.throws(() => prepareFaFirstLoginCohortPreview({authIndex, profileIndex}), /FA_COHORT_OWNER_UID_NOT_VALIDATED/);
  assert.throws(() => prepareFaFirstLoginCohortPreview({authIndex, profileIndex, validatedOwnerUid: 'invalid uid'}), /FA_COHORT_OWNER_UID_NOT_VALIDATED/);
  assert.throws(() => prepareFaFirstLoginCohortPreview({authIndex, profileIndex, validatedOwnerUid: 'owner@example.invalid'}), /FA_COHORT_OWNER_UID_NOT_IN_AUTH_INDEX/);
  assert.throws(() => prepareFaFirstLoginCohortPreview({authIndex, profileIndex, validatedOwnerUid: 'valid-but-absent'}), /FA_COHORT_OWNER_UID_NOT_IN_AUTH_INDEX/);
  const owner = preview({authIndex, profileIndex});
  assert.equal(owner.cohorts.STRUCTURAL, 1);
});

test('estado Auth desconhecido sem marcador de identidade confirmado permanece em REVIEW', () => {
  const {authIndex, profileIndex} = fixture();
  const report = preview({authIndex, profileIndex});
  assert.equal(report.cohorts.HOMOLOGATION, 2);
  assert.equal(report.divergenceCounts.authStateUnknownNotConfirmed, 2);
  assert.equal(report.cohorts.REVIEW, 5);
});

test('somente os dois marcadores exatos são homologação, independente de disabled', () => {
  const {authIndex, profileIndex} = fixture();
  const report = preview({authIndex, profileIndex});
  assert.equal(report.cohorts.HOMOLOGATION, 2);
  assert.equal(report.divergenceCounts.authStateUnknownNotConfirmed, 2);
});

test('UID estrutural tem precedência e é excluído de HOMOLOGATION, inclusive o UID proprietário', () => {
  const {authIndex, profileIndex} = fixture();
  authIndex.users.push(auth('synthetic-structural', {disabled: null, identityMarker: 'HOMOLOGATION_CANDIDATE_1'}));
  profileIndex.profiles.push(profile('synthetic-structural'));
  const report = preview({authIndex, profileIndex}, {
    structuralProtectedUids: ['synthetic-structural']
  });
  assert.equal(report.cohorts.STRUCTURAL, 2);
  assert.equal(report.cohorts.HOMOLOGATION, 1);
  assert.equal(report.divergenceCounts.structuralHomologationOverlap, 1);
  assert.equal(report.divergenceCounts.authStateUnknownNotConfirmed, 3);
});

test('marcadores duplicados ficam em REVIEW e o proprietário exige correspondência Auth UID/e-mail', () => {
  const {authIndex, profileIndex} = fixture();
  authIndex.users.push(auth('synthetic-h1-duplicate', {identityMarker: 'HOMOLOGATION_CANDIDATE_1'}));
  profileIndex.profiles.push(profile('synthetic-h1-duplicate'));
  const report = preview({authIndex, profileIndex});
  assert.equal(report.divergenceCounts.homologationCandidateIdentityAmbiguous, 2);
  assert.equal(report.cohorts.HOMOLOGATION, 1);
  assert.equal(report.cohorts.REVIEW, 7);
  assert.throws(() => prepareFaFirstLoginCohortPreview({authIndex, profileIndex, validatedOwnerUid: 'synthetic-h1'}), /FA_COHORT_OWNER_EMAIL_UID_MISMATCH/);
  assert.throws(() => preview({authIndex, profileIndex}, {structuralProtectedUids: ['synthetic-owner', 'synthetic-owner']}), /FA_COHORT_STRUCTURAL_UIDS_INVALID/);
});

test('snapshots incompletos, duplicados ou com perfis ambíguos são rejeitados ou classificados para revisão', () => {
  const {authIndex, profileIndex} = fixture();
  const incomplete = structuredClone(profileIndex); incomplete.complete = false;
  assert.throws(() => preview({authIndex, profileIndex: incomplete}), /FA_COHORT_PROFILE_INDEX_INVALID/);
  const duplicate = structuredClone(authIndex); duplicate.users.push(structuredClone(duplicate.users[0]));
  assert.throws(() => preview({authIndex: duplicate, profileIndex}), /FA_COHORT_AUTH_INDEX_INVALID/);
  const malformed = structuredClone(profileIndex); malformed.profiles.find(row => row.uid === 'synthetic-operational-google').active = null;
  const report = preview({authIndex, profileIndex: malformed});
  assert.equal(report.cohorts.OPERATIONAL, 2);
  assert.equal(report.cohorts.REVIEW, 6);
  assert.equal(report.divergenceCounts.invalidOrIncompleteProfiles, 1);
});

test('captura de perfil usa somente GET com field mask mínimo, pagina e descarta PII/token de página', async () => {
  const pageOne = {documents: [{name: 'projects/sahmt-17a16/databases/(default)/documents/users/synthetic-user',
    fields: {uid: {stringValue: 'synthetic-user'}, email: {stringValue: 'PRIVATE_EMAIL'}, displayName: {stringValue: 'PRIVATE_NAME'},
      role: {stringValue: 'anestesiologista'}, active: {booleanValue: true}, access: {booleanValue: true},
      permissions: {mapValue: {fields: {admin: {booleanValue: false}, unexpected: {stringValue: 'PRIVATE_FIELD'}}}}, passwordHash: {stringValue: 'PRIVATE_HASH'}}}],
    nextPageToken: 'PRIVATE_PAGE_TOKEN'};
  const pageTwo = {documents: [{name: 'projects/sahmt-17a16/databases/(default)/documents/users/synthetic-second', fields: {
    uid: {stringValue: 'synthetic-second'}, role: {stringValue: 'temporario'}, active: {booleanValue: false}, access: {booleanValue: true}, permissions: {mapValue: {fields: {admin: {booleanValue: true}}}}
  }}]};
  const rawPages = [pageOne, pageTwo], calls = [];
  const result = await collectFaCohortProfileIndex({accessToken: 'synthetic-access-token-not-for-output', now: () => 1000,
    fetchImpl: async (url, options) => {
      calls.push({url: String(url), options});
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-access-token-not-for-output');
      return {ok: true, status: 200, json: async () => rawPages.shift()};
    }});
  assert.equal(result.complete, true);
  assert.equal(result.pages, 2);
  assert.deepEqual(result.profiles, [
    {uid: 'synthetic-user', profileUid: 'synthetic-user', role: 'anestesiologista', active: true, access: true, permissionsAdmin: false},
    {uid: 'synthetic-second', profileUid: 'synthetic-second', role: 'temporario', active: false, access: true, permissionsAdmin: true}
  ]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.hostname, 'firestore.googleapis.com');
    assert.equal(url.pathname, '/v1/projects/sahmt-17a16/databases/(default)/documents/users');
    assert.equal(url.searchParams.get('pageSize'), '1000');
    assert.deepEqual(url.searchParams.getAll('mask.fieldPaths'), ['uid', 'role', 'permissions.admin', 'active', 'access']);
  }
  assert.equal(new URL(calls[0].url).searchParams.has('pageToken'), false);
  assert.equal(new URL(calls[1].url).searchParams.get('pageToken'), 'PRIVATE_PAGE_TOKEN');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-access-token-not-for-output'), false);
  assert.equal(Object.values(pageOne).every(value => value === null || Array.isArray(value) && value.length === 0), true);
  assert.equal(Object.values(pageTwo).every(value => value === null || Array.isArray(value) && value.length === 0), true);
});

test('falha HTTP do Firestore não preserva mensagem, corpo nem dados pessoais', async () => {
  await assert.rejects(collectFaCohortProfileIndex({accessToken: 'synthetic-access-token-not-for-output', fetchImpl: async () => ({
    ok: false, status: 403, json: async () => ({error: {message: 'PRIVATE_EMAIL PRIVATE_TOKEN'}})
  })}), error => error.message === 'FA_COHORT_PROFILE_READ_HTTP_ERROR'
    && !error.message.includes('PRIVATE_EMAIL') && !error.message.includes('PRIVATE_TOKEN'));
});

test('UID interno divergente do caminho do perfil bloqueia OPERATIONAL e vira divergência agregada', () => {
  const {authIndex, profileIndex} = fixture();
  profileIndex.profiles.find(row => row.uid === 'synthetic-operational-google').profileUid = 'different-synthetic-uid';
  const report = preview({authIndex, profileIndex});
  assert.equal(report.cohorts.OPERATIONAL, 2);
  assert.equal(report.cohorts.REVIEW, 6);
  assert.equal(report.divergenceCounts.profileUidMismatch, 1);
});
