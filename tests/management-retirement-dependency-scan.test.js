import assert from 'node:assert/strict';
import test from 'node:test';
import {describeManagementRetirementReadPlan, resolveRetirementCandidateUidsFromProtectedFaIndex,
  scanManagementRetirementDependencies, summarizeManagementRetirementDependencies} from '../scripts/lib/management-retirement-dependency-scan.js';

const ids = {FA: 'sahmt-17a16', FB: 'sahmt-gestao-5ae66', FC: 'indicadores---sahmt'};
const syntheticIndex = (changes = {}) => ({schemaVersion: 1, kind: 'FA_UID_COMPARISON_INDEX', projectId: ids.FA,
  capturedAt: '2026-10-11T12:00:00.000Z', users: [
    {uid: 'uid-owner-synthetic', identityMarker: 'STRUCTURAL_OWNER'},
    {uid: 'uid-candidate-one-synthetic', identityMarker: 'HOMOLOGATION_CANDIDATE_1'},
    {uid: 'uid-candidate-two-synthetic', identityMarker: 'HOMOLOGATION_CANDIDATE_2'}
  ], ...changes});

test('índice FA recente resolve exatamente as duas candidatas e protege o estrutural', () => {
  const result = resolveRetirementCandidateUidsFromProtectedFaIndex(syntheticIndex(), {now: Date.parse('2026-10-11T13:00:00Z')});
  assert.deepEqual(result, {candidateUids: ['uid-candidate-one-synthetic', 'uid-candidate-two-synthetic'], structuralUid: 'uid-owner-synthetic'});
});

test('índice antigo, marcador duplicado ou candidato sobreposto ao estrutural falha fechado', () => {
  assert.throws(() => resolveRetirementCandidateUidsFromProtectedFaIndex(syntheticIndex(), {now: Date.parse('2026-10-13T12:00:00Z')}), /RETIREMENT_FA_INDEX_STALE/);
  const duplicate = syntheticIndex(); duplicate.users.push({uid: 'uid-candidate-duplicate', identityMarker: 'HOMOLOGATION_CANDIDATE_1'});
  assert.throws(() => resolveRetirementCandidateUidsFromProtectedFaIndex(duplicate, {now: Date.parse('2026-10-11T13:00:00Z')}), /RETIREMENT_FA_INDEX_IDENTITY_AMBIGUOUS/);
  const overlap = syntheticIndex(); overlap.users[1].uid = overlap.users[0].uid;
  assert.throws(() => resolveRetirementCandidateUidsFromProtectedFaIndex(overlap, {now: Date.parse('2026-10-11T13:00:00Z')}), /RETIREMENT_FA_INDEX_UID_INVALID/);
});

test('plano de leitura contém somente projetos e catálogo fixos, sem UIDs ou e-mails', () => {
  const plan = describeManagementRetirementReadPlan();
  assert.deepEqual(Object.keys(plan.projects), ['FA', 'FB', 'FC']);
  assert.equal(plan.projects.FA.projectId, ids.FA);
  assert.equal(plan.projects.FB.projectId, ids.FB);
  assert.equal(plan.projects.FC.projectId, ids.FC);
  assert.equal(plan.method, 'POST (read-only structured query)');
  assert.equal(plan.projects.FA.referenceFieldChecks > 0, true);
  assert.equal(plan.projects.FA.queryCount, plan.projects.FA.referenceFieldChecks - plan.projects.FA.unqueriedReferenceFields.length);
  assert.deepEqual(plan.projects.FA.unqueriedReferenceFields, ['notificationReads.uid', 'history.createdByUid', 'history.updatedByUid']);
  assert.equal(plan.writes, 0);
  assert.equal(plan.logsContainIdentifiers, false);
  assert.equal(plan.maximumQueries, Object.values(plan.projects).reduce((sum, value) => sum + value.queryCount, 0));
  const serialized = JSON.stringify(plan);
  for (const secret of ['uid-candidate', 'homologation-a@example.invalid', 'homologation-b@example.invalid', 'fa-owner@example.invalid']) assert.equal(serialized.includes(secret), false);
  assert.ok(plan.projects.FA.collections.includes('history'));
  assert.ok(plan.projects.FB.collections.includes('managementAuthorizationLeases'));
});

test('scanner consulta só endpoint fixo, POST estruturado com filtro UID/projeção e retorna contagens sem metadados de documentos', async () => {
  const seenStages = [];
  const calls = [];
  const token = 'synthetic-oauth-token-that-is-never-returned';
  const result = await scanManagementRetirementDependencies({projectAlias: 'FA', protectedFaIndex: syntheticIndex(),
    now: Date.parse('2026-10-11T13:00:00Z'), getAccessToken: async request => {
      assert.equal(request.projectId, ids.FA);
      assert.deepEqual(request.scopes, ['https://www.googleapis.com/auth/cloud-platform']);
      assert.equal(request.purpose, 'RETIREMENT_DEPENDENCY_READ_ONLY');
      return token;
    }, onStage: stage => seenStages.push(stage), fetchImpl: async (url, init) => {
      calls.push({url, init});
      assert.equal(url, `https://firestore.googleapis.com/v1/projects/${ids.FA}/databases/(default)/documents:runQuery`);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.match(init.headers.Authorization, /^Bearer synthetic-oauth-token/);
      const body = JSON.parse(init.body).structuredQuery;
      assert.equal(body.limit, 501);
      assert.equal(body.where.compositeFilter, undefined, 'UID lookup stays a single-field query to avoid composite indexes');
      assert.ok(body.select.fields.length <= 8, 'projection should stay limited to UID/state/audience fields');
      assert.ok(!JSON.stringify(body).includes('homologation-a@example.invalid'));
      const collection = body.from[0].collectionId;
      const firstBranch = body.where.compositeFilter?.filters?.[0] || body.where;
      const firstFilter = firstBranch.fieldFilter || firstBranch.compositeFilter?.filters?.[0];
      const field = firstFilter?.field?.fieldPath;
      const values = firstFilter?.value?.arrayValue?.values;
      assert.ok(values.every(value => value.stringValue || value.referenceValue));
      let document, extraDocuments = [];
      if (collection === 'managementAreas' && field === 'memberUids') {
        document = {fields: {memberUids: {arrayValue: {values: [{stringValue: 'uid-candidate-one-synthetic'}, {stringValue: 'uid-candidate-two-synthetic'}]}}},
          name: 'private/document/name', privateEmail: 'homologation-a@example.invalid', privateToken: 'secret'};
      } else if (collection === 'trainingProgress' && field === 'uid') {
        document = {fields: {uid: {stringValue: 'uid-candidate-one-synthetic'}, status: {stringValue: 'IN_PROGRESS'}, passwordHash: {stringValue: 'do-not-copy'}}, name: 'private/training/path'};
        extraDocuments = [{document: {fields: {uid: {stringValue: 'uid-candidate-two-synthetic'}, status: {stringValue: 'COMPLETED'}}, name: 'private/completed-training/path'}}];
      } else if (collection === 'events' && body.select.fields.some(item => ['createdByUid', 'updatedByUid'].includes(item.fieldPath))) {
        document = {fields: {createdByUid: {stringValue: 'uid-candidate-two-synthetic'}, updatedByUid: {stringValue: 'uid-candidate-two-synthetic'}, email: {stringValue: 'private'}}, name: 'private/event/path'};
      } else if (collection === 'checklistSignatureRequests' && field === 'signerUid') {
        document = {fields: {signerUid: {stringValue: 'uid-candidate-one-synthetic'}, status: {stringValue: 'NEEDS_REVIEW'}, token: {stringValue: 'secret'}}, name: 'private/request/path'};
      } else if (collection === 'users' && body.select.fields.some(item => item.fieldPath === '__name__')) {
        document = {name: `projects/${ids.FA}/databases/(default)/documents/users/uid-candidate-one-synthetic`, fields: {role: {stringValue: 'private'}}};
      }
      return {ok: true, status: 200, json: async () => document ? [{document}, ...extraDocuments, {readTime: '2026-10-11T13:00:00Z'}] : []};
    }});

  assert.equal(calls.length, describeManagementRetirementReadPlan().projects.FA.queryCount);
  assert.equal(seenStages.length, calls.length);
  assert.ok(seenStages.every(stage => /^DEPENDENCY_QUERY_[1-9][0-9]*_[A-Za-z0-9_.]+_[A-Za-z0-9_.]+$/.test(stage)));
  assert.equal(result.complete, true);
  assert.equal(result.failures, 0);
  assert.equal(result.coverageScope, 'STATIC_REPOSITORY_SCHEMA_ALLOWLIST');
  assert.equal(result.unmappedCollectionsReviewed, false);
  assert.equal(result.globalAbsenceConfirmed, false);
  assert.equal(result.references.find(row => row.uid === 'uid-candidate-one-synthetic' && row.category === 'OPERATIONAL')?.count, 3);
  assert.equal(result.references.find(row => row.uid === 'uid-candidate-one-synthetic' && row.category === 'OTHER')?.count, 1);
  assert.equal(result.references.find(row => row.uid === 'uid-candidate-two-synthetic' && row.category === 'OPERATIONAL')?.count, 1);
  assert.equal(result.references.find(row => row.uid === 'uid-candidate-two-synthetic' && row.category === 'TRAINING')?.count, 1,
    'completed progress is historical training, while in-progress data is active');
  assert.equal(result.references.find(row => row.uid === 'uid-candidate-two-synthetic' && row.category === 'AUDIT')?.count, 1,
    'two actor fields in one document count as one dependency document');
  const plan = describeManagementRetirementReadPlan().projects.FA;
  assert.equal(result.queriesCompleted, plan.referenceFieldChecks - plan.unqueriedReferenceFields.length);
  const serialized = JSON.stringify(result);
  for (const secret of ['homologation-a@example.invalid', 'private/document/name', 'private/training/path', 'passwordHash', 'do-not-copy', 'private/event/path', 'secret', token, 'uid-owner-synthetic']) assert.equal(serialized.includes(secret), false);
});

test('FB authorization fence is treated as an active critical dependency', async () => {
  const result = await scanManagementRetirementDependencies({projectAlias: 'FB', protectedFaIndex: syntheticIndex(),
    now: Date.parse('2026-10-11T13:00:00Z'), getAccessToken: async () => 'synthetic-token-value-123456',
    fetchImpl: async (url, init) => {
      const query = JSON.parse(init.body).structuredQuery;
      const document = query.from[0].collectionId === 'managementAuthorizationFences'
        && query.where.fieldFilter?.field?.fieldPath === 'uid'
        ? {document: {name: `projects/${ids.FB}/databases/(default)/documents/managementAuthorizationFences/synthetic`,
          fields: {uid: {stringValue: 'uid-candidate-two-synthetic'}}}}
        : null;
      return {ok: true, status: 200, json: async () => document ? [document] : []};
    }});
  assert.equal(result.references.find(row => row.uid === 'uid-candidate-two-synthetic' && row.category === 'OPERATIONAL')?.count, 1);
});

test('resumo público troca UIDs por rótulos sintéticos e bloqueia qualquer exclusão', () => {
  const result = summarizeManagementRetirementDependencies({projectId: ids.FA, complete: true, failures: 0,
    coverageScope: 'STATIC_REPOSITORY_SCHEMA_ALLOWLIST', collectionsScanned: 3, queriesCompleted: 3,
    references: [
      {uid: 'uid-candidate-one-synthetic', category: 'TRAINING', count: 2},
      {uid: 'uid-candidate-two-synthetic', category: 'OPERATIONAL', count: 1}
    ]}, syntheticIndex(), {now: Date.parse('2026-10-11T13:00:00Z')});
  assert.equal(result.candidates.candidateOne.TRAINING, 2);
  assert.equal(result.candidates.candidateTwo.OPERATIONAL, 1);
  assert.equal(result.identifiersIncluded, false);
  assert.equal(result.deletionAllowed, false);
  assert.equal(result.unmappedCollectionsReviewed, false);
  const serialized = JSON.stringify(result);
  for (const secret of ['uid-candidate', 'homologation-a@example.invalid', 'homologation-b@example.invalid']) assert.equal(serialized.includes(secret), false);
});

test('scanner não aceita projeto desconhecido nem pode ser configurado com coleção/campo livre', async () => {
  await assert.rejects(scanManagementRetirementDependencies({projectAlias: 'OTHER', protectedFaIndex: syntheticIndex(), getAccessToken: async () => 'x'.repeat(24)}), /RETIREMENT_PROJECT_NOT_ALLOWED/);
});

test('erros HTTP e rede são sanitizados sem encaminhar corpo de resposta ou token', async () => {
  const common = {projectAlias: 'FC', protectedFaIndex: syntheticIndex(), now: Date.parse('2026-10-11T13:00:00Z'), getAccessToken: async () => 'sensitive-token-value-123456'};
  await assert.rejects(scanManagementRetirementDependencies({...common, fetchImpl: async () => ({ok: false, status: 403, text: async () => 'homologation-a@example.invalid sensitive-token-value-123456'})}), error => {
    assert.equal(error.message, 'RETIREMENT_SCAN_HTTP_403');
    assert.equal(error.message.includes('sensitive'), false);
    return true;
  });
  await assert.rejects(scanManagementRetirementDependencies({...common, fetchImpl: async () => { throw new Error('homologation-a@example.invalid sensitive-token-value-123456'); }}), error => {
    assert.equal(error.message, 'RETIREMENT_SCAN_REQUEST_FAILED');
    return true;
  });
});

test('consulta truncada, resposta inválida ou UID inesperado bloqueia o relatório', async () => {
  const common = {projectAlias: 'FB', protectedFaIndex: syntheticIndex(), now: Date.parse('2026-10-11T13:00:00Z'), getAccessToken: async () => 'synthetic-token-value-123456'};
  await assert.rejects(scanManagementRetirementDependencies({...common, fetchImpl: async () => ({ok: true, json: async () => Array.from({length: 501}, (_, index) => ({document: {
    name: `projects/${ids.FB}/databases/(default)/documents/trainingProgress/doc-${index}`,
    fields: {uid: {stringValue: index % 2 ? 'uid-candidate-one-synthetic' : 'uid-candidate-two-synthetic'}, status: {stringValue: 'IN_PROGRESS'}}
  }}))})}), /RETIREMENT_QUERY_TRUNCATED/);
  await assert.rejects(scanManagementRetirementDependencies({...common, fetchImpl: async () => ({ok: true, json: async () => ({raw: true})})}), /RETIREMENT_QUERY_RESPONSE_INVALID/);
  const unexpectedUid = {document: {name: 'synthetic/doc', fields: {
    eligibleUids: {arrayValue: {values: [{stringValue: 'uid-unexpected'}]}}
  }}};
  await assert.rejects(scanManagementRetirementDependencies({...common,
    fetchImpl: async () => ({ok: true, json: async () => [unexpectedUid]})
  }), /RETIREMENT_SCAN_RESULT_UID_UNEXPECTED/);
});
