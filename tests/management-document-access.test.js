import test from 'node:test';
import assert from 'node:assert/strict';
import {DOCUMENT_MANAGEMENT_AREA, normalizeManagementEmails, verifiedManagementEmail, isManagementDocumentAreaManager, canManageManagementDocument, canReadManagementDocument} from '../src/management-document-access.js';

const emails = Array.from({length: 55}, (_, i) => `reader-${i + 1}@example.invalid`);
const area = {id: DOCUMENT_MANAGEMENT_AREA, active: true, managerUids: ['area-manager']};
const generalGroup = {id: 'general', managementAreaId: area.id, active: true, allowedEmails: emails, managerEmails: ['manager@example.invalid']};
const restrictedGroup = {id: 'restricted', managementAreaId: area.id, active: true, allowedEmails: emails.slice(0, 31), managerEmails: ['manager@example.invalid']};
const groups = [generalGroup, restrictedGroup];
const documentValue = (groupId, overrides = {}) => ({id: 'fictitious-document', managementAreaId: area.id, documentGroupId: groupId, active: true, ...overrides});
const user = (email = emails[0], overrides = {}) => ({uid: 'approved-reader', email, emailVerified: true, ...overrides});
const scope = (document, overrides = {}) => ({document, area, groups, user: user(), canReadLegacy: true, ...overrides});

test('listas por e-mail normalizam caixa e delimitadores, sem inventar UIDs', () => {
  assert.deepEqual(normalizeManagementEmails('First@Example.invalid\n second@example.invalid;FIRST@example.invalid,third@example.invalid'), ['first@example.invalid', 'second@example.invalid', 'third@example.invalid']);
  assert.deepEqual(normalizeManagementEmails([' First@Example.invalid ', 'first@example.invalid', '']), ['first@example.invalid']);
  assert.deepEqual(normalizeManagementEmails(''), []);
  assert.equal(normalizeManagementEmails(emails).length, 55);
  assert.equal(normalizeManagementEmails(emails.slice(0, 31)).length, 31);
});

test('listas recusam endereços inválidos, tipo inválido e excesso depois de deduplicar', () => {
  for (const value of ['nome', 'nome com espaço@example.invalid', '@example.invalid', 'user@localhost', {}, undefined, ['valid@example.invalid', 'invalid']]) {
    assert.throws(() => normalizeManagementEmails(value), /e-mails|endereço/);
  }
  assert.throws(() => normalizeManagementEmails(emails, {maxItems: 20}), /no máximo 20/);
  assert.throws(() => normalizeManagementEmails(['x'.repeat(242) + '@example.invalid']), /endereço/);
  assert.deepEqual(normalizeManagementEmails(['same@example.invalid', 'SAME@example.invalid'], {maxItems: 1}), ['same@example.invalid']);
});

test('identidade de audiência usa somente emailVerified e e-mail válido da conta autenticada', () => {
  assert.equal(verifiedManagementEmail(user('Mixed@Example.invalid')), 'mixed@example.invalid');
  for (const value of [null, {}, user(''), user('invalid'), user(emails[0], {emailVerified: false}), user(emails[0], {emailVerified: 'true'})]) assert.equal(verifiedManagementEmail(value), '');
});

test('gestor de área depende de UID registrado e área ativa', () => {
  assert.equal(isManagementDocumentAreaManager(area, 'area-manager'), true);
  assert.equal(isManagementDocumentAreaManager(area, 'unlisted'), false);
  assert.equal(isManagementDocumentAreaManager({...area, active: false}, 'area-manager'), false);
  assert.equal(isManagementDocumentAreaManager({...area, managerUids: undefined}, 'area-manager'), false);
  assert.equal(isManagementDocumentAreaManager(area, ''), false);
});

test('55 gerais e 31 restritos mantêm suas audiências específicas', () => {
  const generalOnly = user(emails[40]);
  assert.equal(canReadManagementDocument(scope(documentValue('general'), {user: generalOnly})), true);
  assert.equal(canReadManagementDocument(scope(documentValue('restricted'), {user: generalOnly})), false);
  assert.equal(canReadManagementDocument(scope(documentValue('restricted'))), true);
  assert.equal(canReadManagementDocument(scope(documentValue('general'), {user: user('unlisted@example.invalid')})), false);
});

test('leitor listado não gerencia documentos nem vê rascunhos, grupo inativo ou legado protegido', () => {
  assert.equal(canManageManagementDocument(scope(documentValue('general'))), false);
  assert.equal(canReadManagementDocument(scope(documentValue('general', {active: false}))), false);
  assert.equal(canReadManagementDocument(scope(documentValue('general'), {groups: [{...generalGroup, active: false}]})), false);
  assert.equal(canReadManagementDocument(scope(documentValue('missing'))), false);
  assert.equal(canReadManagementDocument(scope(documentValue(undefined))), false);
});

test('vínculo por e-mail verificado permite ao gestor local editar o documento existente de seu grupo', () => {
  const manager = user('manager@example.invalid', {uid: 'group-manager'});
  assert.equal(canManageManagementDocument(scope(documentValue('general', {active: false}), {user: manager})), true);
  assert.equal(canReadManagementDocument(scope(documentValue('restricted', {active: false}), {user: manager})), true);
  assert.equal(canManageManagementDocument(scope(documentValue('restricted'), {user: manager, groups: [{...restrictedGroup, managerEmails: []}]})), false);
  assert.equal(canManageManagementDocument(scope(documentValue('general'), {user: {...manager, emailVerified: false}})), false);
  assert.equal(canManageManagementDocument(scope(null, {user: manager})), false);
});

test('gestor de área edita rascunho e legado próprios sem ganhar acesso a outra área', () => {
  const manager = user('area-manager@example.invalid', {uid: 'area-manager'});
  assert.equal(canManageManagementDocument(scope(documentValue('general', {active: false}), {user: manager})), true);
  assert.equal(canManageManagementDocument(scope(documentValue(undefined), {user: manager})), true);
  assert.equal(canManageManagementDocument(scope(documentValue('general', {managementAreaId: 'other-area'}), {user: manager})), false);
});

test('revogação de managementRead, área inativa ou falta de sessão bloqueiam leitores e gestores locais', () => {
  for (const currentUser of [user(), user('manager@example.invalid'), user('area-manager@example.invalid', {uid: 'area-manager'})]) {
    const selected = scope(documentValue('general'), {user: currentUser});
    assert.equal(canReadManagementDocument({...selected, canReadLegacy: false}), false);
    assert.equal(canManageManagementDocument({...selected, canReadLegacy: false}), false);
    assert.equal(canReadManagementDocument({...selected, area: {...area, active: false}}), false);
    assert.equal(canManageManagementDocument({...selected, area: {...area, active: false}}), false);
    assert.equal(canReadManagementDocument({...selected, user: {...currentUser, uid: ''}}), false);
  }
});

test('admin autorizado pode gerenciar rascunho; flag global não permite documento de área diferente ou sessão ausente', () => {
  assert.equal(canReadManagementDocument(scope(documentValue('general', {active: false}), {canManageAll: true, canReadLegacy: false})), true);
  assert.equal(canManageManagementDocument(scope(documentValue('missing'), {canManageAll: true})), true);
  assert.equal(canManageManagementDocument(scope(documentValue('general', {managementAreaId: 'other-area'}), {canManageAll: true})), false);
  assert.equal(canReadManagementDocument(scope(documentValue('general'), {canManageAll: true, user: null})), false);
});

test('grupos de outra área nunca justificam acesso e legado de outra área conserva o acesso existente', () => {
  assert.equal(canReadManagementDocument(scope(documentValue('general'), {groups: [{...generalGroup, managementAreaId: 'other-area'}]})), false);
  const legacyArea = {...area, id: 'legacy-area', managerUids: []};
  const legacyDocument = {id: 'legacy-document', managementAreaId: legacyArea.id, active: true};
  assert.equal(canReadManagementDocument(scope(legacyDocument, {area: legacyArea, groups: []})), true);
  assert.equal(canReadManagementDocument(scope(legacyDocument, {area: legacyArea, groups: [], canReadLegacy: false})), false);
});