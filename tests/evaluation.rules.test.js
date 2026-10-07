import {readFile} from 'node:fs/promises';
import {before, beforeEach, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, serverTimestamp, setLogLevel} from 'firebase/firestore';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';
let env; setLogLevel('silent');
before(async () => { env = await initializeTestEnvironment({projectId: 'demo-sahmt-v2', firestore: {host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')}}); });
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, permissions, overrides] of [['member', {trainingsRead: true, checklistRead: true}, {}], ['other', {trainingsRead: true}, {}], ['manager', {managementRead: true}, {}], ['admin', {admin: true}, {role: 'administrador_app'}], ['revoked', {admin: true}, {access: false}]]) await setDoc(doc(db, 'users', uid), {uid, role: 'anestesiologista', active: true, access: true, permissions, ...overrides});
    await setDoc(doc(db, 'evaluationAwards', 'award'), {uid: 'member', category: 'PERFORMANCE', points: 1, awardVersion: 1});
    await setDoc(doc(db, 'evaluationAwards', 'governance'), {uid: 'manager', category: 'GOVERNANCE', points: 1, awardVersion: 1});
    await setDoc(doc(db, 'evaluationLedger', 'ledger'), {uid: 'member', category: 'PERFORMANCE', points: 1});
    await setDoc(doc(db, 'evaluationSummaries', 'member'), {uid: 'member', performanceTotal: 1, governanceTotal: 0});
    await setDoc(doc(db, 'evaluationReference', 'team'), {maxPerformance: 1, eligibleCount: 2, allZero: false});
    await setDoc(doc(db, 'evaluationAssignments', 'area'), {id: 'area', uid: 'manager', areaId: 'area', version: 1});
    await setDoc(doc(db, 'evaluationActivities', 'form'), {eligibleUids: ['member'], managerUid: 'manager'});
    await setDoc(doc(db, 'users', 'group-general'), {uid: 'group-general', email: 'general@example.invalid', role: 'anestesiologista', active: true, access: true, permissions: {}});
    await setDoc(doc(db, 'users', 'group-restricted'), {uid: 'group-restricted', email: 'restricted@example.invalid', role: 'anestesiologista', active: true, access: true, permissions: {}});
    await setDoc(doc(db, 'users', 'group-unlisted'), {uid: 'group-unlisted', email: 'unlisted@example.invalid', role: 'anestesiologista', active: true, access: true, permissions: {}});
    await setDoc(doc(db, 'documentAccessEmails', 'general@example.invalid'), {id: 'general@example.invalid', email: 'general@example.invalid', active: true, groups: ['GENERAL']});
    await setDoc(doc(db, 'documentAccessEmails', 'restricted@example.invalid'), {id: 'restricted@example.invalid', email: 'restricted@example.invalid', active: true, groups: ['RESTRICTED']});
    await setDoc(doc(db, 'evaluationActivities', 'general-form'), {eligibleUids: [], eligibleGroups: ['GENERAL']});
    await setDoc(doc(db, 'evaluationActivities', 'restricted-form'), {eligibleUids: [], eligibleGroups: ['RESTRICTED']});
    await setDoc(doc(db, 'evaluationParticipations', 'participation'), {uid: 'member', managerUid: 'manager', areaIds: ['area'], suggestion: {status: 'PENDING'}});
    await setDoc(doc(db, 'evaluationParticipations', 'manager-self'), {uid: 'manager', managerUid: 'manager', areaIds: ['area'], suggestion: {status: 'PENDING'}});
    await setDoc(doc(db, 'evaluationGovernanceRevisions', 'revision'), {uid: 'manager', activityId: 'form', status: 'PENDING'});
    await setDoc(doc(db, 'evaluationGovernanceRevisions', 'admin-revision'), {uid: 'admin', status: 'PENDING'});
    await setDoc(doc(db, 'checklistResponsibilities', '2026-10-03'), {status: 'CONFIRMED', responsible: {uid: 'member', sigla: 'AA'}});
  });
});
const dbFor = (uid, verified = true) => env.authenticatedContext(uid, {email_verified: verified}).firestore();
const request = (uid, type, payload, id = 'request') => ({id, actorUid: uid, type, payload, status: 'PENDING', createdAt: serverTimestamp()});
test('histórico próprio permitido; terceiros, consultas amplas e escrita de pontuação bloqueados', async () => {
  const db = dbFor('member');
  for (const [collectionName, id] of [['evaluationAwards', 'award'], ['evaluationLedger', 'ledger'], ['evaluationSummaries', 'member']]) {
    await assertSucceeds(getDoc(doc(db, collectionName, id))); await assertFails(getDoc(doc(dbFor('other'), collectionName, id)));
    await assertFails(updateDoc(doc(db, collectionName, id), {points: 900})); await assertFails(deleteDoc(doc(dbFor('admin'), collectionName, id)));
  }
  await assertFails(getDocs(collection(db, 'evaluationAwards')));
  await assertSucceeds(getDocs(query(collection(db, 'evaluationAwards'), where('uid', '==', 'member'))));
  await assertSucceeds(getDoc(doc(dbFor('admin'), 'evaluationAwards', 'governance')));
});
test('referência é anônima; manager não ganha poder administrativo ou histórico alheio', async () => {
  await assertSucceeds(getDoc(doc(dbFor('member'), 'evaluationReference', 'team')));
  await assertFails(getDoc(doc(dbFor('manager'), 'evaluationAwards', 'award')));
  await assertSucceeds(getDoc(doc(dbFor('manager'), 'evaluationParticipations', 'participation')));
  await assertFails(getDoc(doc(dbFor('other'), 'evaluationParticipations', 'participation')));
  await assertFails(getDoc(doc(dbFor('revoked'), 'evaluationReference', 'team')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'evaluationReference', 'team')));
});
test('atividade apenas público elegível/gestor/admin; fonte e snapshots privados nunca expostos', async () => {
  for (const uid of ['member', 'manager', 'admin']) await assertSucceeds(getDoc(doc(dbFor(uid), 'evaluationActivities', 'form')));
  await assertFails(getDoc(doc(dbFor('other'), 'evaluationActivities', 'form')));
  for (const name of ['evaluationFormConfigs', 'evaluationRuntime', 'evaluationChecklistTransfers']) await assertFails(setDoc(doc(dbFor('admin'), name, 'private'), {points: 1}));
});
test('atividade por grupo exige e-mail Google verificado e cadastro ativo no grupo correto', async () => {
  const identity = (uid, email, verified = true, provider = 'google.com') => env.authenticatedContext(uid, {email, email_verified: verified, firebase: {sign_in_provider: provider}}).firestore();
  await assertSucceeds(getDoc(doc(identity('group-general', 'general@example.invalid'), 'evaluationActivities', 'general-form')));
  await assertFails(getDoc(doc(identity('group-general', 'general@example.invalid'), 'evaluationActivities', 'restricted-form')));
  await assertSucceeds(getDoc(doc(identity('group-restricted', 'restricted@example.invalid'), 'evaluationActivities', 'restricted-form')));
  await assertFails(getDoc(doc(identity('group-restricted', 'restricted@example.invalid'), 'evaluationActivities', 'general-form')));
  await assertFails(getDoc(doc(identity('group-unlisted', 'unlisted@example.invalid'), 'evaluationActivities', 'general-form')));
  await assertFails(getDoc(doc(identity('group-general', 'general@example.invalid', false), 'evaluationActivities', 'general-form')));
  await assertFails(getDoc(doc(identity('group-general', 'general@example.invalid', true, 'password'), 'evaluationActivities', 'general-form')));
});
test('somente administrador solicita correção categoria fixa/motivo/versão, inclusive zero', async () => {
  const payload = {awardId: 'award', category: 'PERFORMANCE', expectedAwardVersion: 1, correctedPoints: 0, reason: 'Correção de fixture'};
  await assertSucceeds(setDoc(doc(dbFor('admin'), 'evaluationRequests', 'request'), request('admin', 'CORRECT_SCORE', payload)));
  for (const [uid, changes] of [['member', {}], ['manager', {}], ['admin', {category: 'GOVERNANCE'}], ['admin', {reason: 'x'}], ['admin', {uid: 'other'}]]) await assertFails(setDoc(doc(dbFor(uid), 'evaluationRequests', 'invalid'), request(uid, 'CORRECT_SCORE', {...payload, ...changes}, 'invalid')));
  await assertFails(updateDoc(doc(dbFor('admin'), 'evaluationRequests', 'request'), {status: 'CONFIRMED'}));
});
test('requisição nunca aceita crédito/UID arbitrário ou conta não verificada', async () => {
  await assertFails(setDoc(doc(dbFor('admin', false), 'evaluationRequests', 'request'), request('admin', 'RECONCILE_LINKS', {})));
  await assertFails(setDoc(doc(dbFor('admin'), 'evaluationRequests', 'request'), request('admin', 'AWARD', {points: 10})));
  await assertFails(setDoc(doc(dbFor('admin'), 'evaluationRequests', 'request'), {...request('admin', 'RECONCILE_LINKS', {}), actorUid: 'other'}));
  await assertFails(setDoc(doc(dbFor('admin'), 'evaluationRequests', 'request'), request('admin', 'CORRECT_CHECKLIST_TRANSFER', {signerUid: 'other'})));
  await assertSucceeds(getDoc(doc(dbFor('member'), 'evaluationRequests', 'new-unused-id')));
});
test('revisão de sugestão independente; gestor não aprova governança própria', async () => {
  const payload = {participationId: 'participation', decision: 'APPROVE', note: 'Aprovação fictícia'};
  await assertSucceeds(setDoc(doc(dbFor('manager'), 'evaluationRequests', 'request'), request('manager', 'REVIEW_SUGGESTION', payload)));
  await assertFails(setDoc(doc(dbFor('member'), 'evaluationRequests', 'request-self'), request('member', 'REVIEW_SUGGESTION', payload, 'request-self')));
  await assertFails(setDoc(doc(dbFor('manager'), 'evaluationRequests', 'manager-self'), request('manager', 'REVIEW_SUGGESTION', {...payload, participationId: 'manager-self'}, 'manager-self')));
  await assertFails(setDoc(doc(dbFor('manager'), 'evaluationRequests', 'manager-invalid'), request('manager', 'REVIEW_SUGGESTION', {...payload, points: 900}, 'manager-invalid')));
  await assertFails(setDoc(doc(dbFor('manager'), 'evaluationRequests', 'gov'), request('manager', 'REVIEW_GOVERNANCE', {revisionId: 'revision', decision: 'APPROVE', note: 'Aprovação fictícia'}, 'gov')));
  await assertFails(setDoc(doc(dbFor('admin'), 'evaluationRequests', 'gov-self'), request('admin', 'REVIEW_GOVERNANCE', {revisionId: 'admin-revision', decision: 'APPROVE', note: 'Aprovação fictícia'}, 'gov-self')));
  await assertSucceeds(setDoc(doc(dbFor('admin'), 'evaluationRequests', 'gov-admin'), request('admin', 'REVIEW_GOVERNANCE', {revisionId: 'revision', decision: 'APPROVE', note: 'Aprovação fictícia'}, 'gov-admin')));
});
test('gestor vigente solicita revisão com evidência; não designa gestor ou configura atividade', async () => {
  const payload = {activityId: 'form', areaId: 'area', assignmentId: 'area', previousVersion: 1, newVersion: 2, summary: 'Conteúdo fictício revisado', components: ['MATERIAL'], materialEvidence: ['https://drive.google.com/file/d/fixture12345/view'], questionEvidence: []};
  await assertSucceeds(setDoc(doc(dbFor('manager'), 'evaluationRequests', 'request'), request('manager', 'REQUEST_GOVERNANCE', payload)));
  await assertFails(setDoc(doc(dbFor('other'), 'evaluationRequests', 'other'), request('other', 'REQUEST_GOVERNANCE', payload, 'other')));
  await assertFails(setDoc(doc(dbFor('manager'), 'evaluationRequests', 'no-evidence'), request('manager', 'REQUEST_GOVERNANCE', {...payload, materialEvidence: []}, 'no-evidence')));
  await assertFails(setDoc(doc(dbFor('manager'), 'evaluationRequests', 'assign'), request('manager', 'ASSIGN_MANAGER', {areaId: 'area', managerUid: 'other', expectedVersion: 1}, 'assign')));
});
test('responsável confiável Checklist é somente leitura de usuários autorizados', async () => {
  await assertSucceeds(getDoc(doc(dbFor('member'), 'checklistResponsibilities', '2026-10-03')));
  await assertFails(getDoc(doc(dbFor('other'), 'checklistResponsibilities', '2026-10-03')));
  await assertFails(setDoc(doc(dbFor('admin'), 'checklistResponsibilities', '2026-10-03'), {responsible: {uid: 'other'}}));
});

test('captura de homologação é privada do executor, sem leitura ou escrita pelo PWA', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'evaluationHomologationInputs', 'capture-fixture'), {schemaVersion: 1, uid: 'member', responses: [{responseId: 'fictional'}]}));
  for (const uid of ['member', 'manager', 'admin']) {
    const db = dbFor(uid);
    await assertFails(getDoc(doc(db, 'evaluationHomologationInputs', 'capture-fixture')));
    await assertFails(getDocs(collection(db, 'evaluationHomologationInputs')));
    await assertFails(setDoc(doc(db, 'evaluationHomologationInputs', 'fake-capture'), {schemaVersion: 1}));
  }
});
