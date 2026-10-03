const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source = readFileSync(join(__dirname, '../src/data.js'), 'utf8');
let normalizeManagementEmails, normalizeDriveDocumentUrl;
before(async () => {
  ({normalizeManagementEmails} = await import('../src/management-document-access.js'));
  ({normalizeDriveDocumentUrl} = await import('../src/drive-document.js'));
});
const areaId = 'area-gestao-de-documentos';
const email = 'reader@example.invalid';
const managerEmail = 'manager@example.invalid';
const group = (id, overrides = {}) => ({id, managementAreaId: areaId, name: id, category: 'ACESSO GERAL', allowedEmails: [email], managerEmails: [managerEmail], active: true, ...overrides});
const documentValue = (id, overrides = {}) => ({id, managementAreaId: areaId, title: 'Documento fictício', description: '', category: 'ACESSO GERAL', documentGroupId: 'general', driveFileId: 'fictional_drive_document_123', driveUrl: 'https://drive.google.com/file/d/fictional_drive_document_123/view', active: false, requiredReading: false, version: 1, createdByUid: 'fixture-manager', createdAt: 'original-created', publishedAt: 'original-published', ...overrides});
const input = (overrides = {}) => ({documentId: 'fixture-document-id', managementAreaId: areaId, title: 'Documento fictício', description: '', category: 'ACESSO GERAL', documentGroupId: 'general', driveUrl: 'https://drive.google.com/file/d/fictional_drive_document_123/view', active: false, requiredReading: false, version: 1, ...overrides});
function runtime({results = [], records = {}, onRead = () => {}} = {}) {
  const queries = [], writes = [], reads = [], db = {};
  const code = source.slice(source.indexOf("const PROTECTED_DOCUMENT_AREA ="), source.indexOf('export async function listEquipmentForArea')).replaceAll('export ', '');
  const context = vm.createContext({db, normalizeManagementEmails, normalizeDriveDocumentUrl, crypto: {randomUUID: () => 'stable-fictional-mutation-id'},
    collection: (_db, name) => ({name}), where: (field, operator, value) => ({field, operator, value}), orderBy: (field, direction) => ({order: field, direction}), limit: count => ({limit: count}),
    query: (ref, ...constraints) => ({name: ref.name, constraints}), doc: (_db, name, id) => ({name, id}), serverTimestamp: () => 'server-time',
    getDocsFromServer: async value => {queries.push(value); const rows = results.shift() || []; return {docs: rows.map(row => ({id: row.id, data: () => row}))};},
    runTransaction: async (_db, callback) => callback({
      get: async ref => {reads.push(ref); onRead(ref); const value = records[`${ref.name}/${ref.id}`]; return {exists: () => !!value, data: () => value};},
      set: (ref, value) => writes.push({kind: 'set', ref, value}), update: (ref, value) => writes.push({kind: 'update', ref, value})
    })
  });
  vm.runInContext(code, context, {filename: 'document-data-fixture.js'});
  return {context, queries, writes, reads};
}
const plain = value => JSON.parse(JSON.stringify(value));
const whereValue = (queryValue, field) => queryValue.constraints.find(value => value.field === field);

test('descoberta de grupos consulta e-mail normalizado em allowedEmails e managerEmails e deduplica IDs', async () => {
  const shared = group('general');
  const rt = runtime({results: [[shared], [shared, group('restricted')]]});
  const groups = await rt.context.listManagementDocumentGroups(areaId, {uid: 'fixture-reader', email: ' Reader@Example.invalid '});
  assert.deepEqual(Array.from(groups, value => value.id), ['general', 'restricted']);
  assert.equal(rt.queries.length, 2);
  for (const [index, value] of rt.queries.entries()) {
    assert.equal(value.name, 'documentGroups');
    assert.deepEqual(plain(whereValue(value, 'managementAreaId')), {field: 'managementAreaId', operator: '==', value: areaId});
    assert.equal(whereValue(value, 'active').value, true);
    assert.deepEqual(plain(whereValue(value, index === 0 ? 'allowedEmails' : 'managerEmails')), {field: index === 0 ? 'allowedEmails' : 'managerEmails', operator: 'array-contains', value: email});
  }
});

test('sem sessão ou e-mail não se inicia descoberta ampla de grupos nem documentos protegidos', async () => {
  const rt = runtime();
  assert.equal((await rt.context.listManagementDocumentGroups(areaId, {uid: 'fixture-reader'})).length, 0);
  assert.equal((await rt.context.listManagementDocumentGroups(areaId, {email})).length, 0);
  assert.equal((await rt.context.listManagementDocuments(areaId, {uid: 'fixture-reader', groups: [group('general')]})).length, 0);
  assert.equal((await rt.context.listManagementDocuments(areaId, {email, groups: [group('general')]})).length, 0);
  assert.equal(rt.queries.length, 0);
});

test('consulta do leitor exige área, grupo e active true, preservando ordenação e limite de relatório', async () => {
  const rt = runtime({results: [[documentValue('general-active', {active: true})]]});
  const visible = await rt.context.listManagementDocuments(areaId, {uid: 'fixture-reader', email, includeInactive: true, pageSize: 1000, groups: [group('general'), group('unlisted', {allowedEmails: [], managerEmails: []}), group('inactive', {active: false}), group('foreign', {managementAreaId: 'different-area'})]});
  assert.equal(visible.length, 1); assert.equal(rt.queries.length, 1);
  const value = rt.queries[0];
  assert.equal(whereValue(value, 'managementAreaId').value, areaId);
  assert.equal(whereValue(value, 'documentGroupId').value, 'general');
  assert.equal(whereValue(value, 'active').value, true);
  assert.deepEqual(plain(value.constraints.find(item => item.order)), {order: 'publishedAt', direction: 'desc'});
  assert.equal(value.constraints.find(item => item.limit).limit, 100);
});

test('gestor por e-mail usa query de seu grupo incluindo rascunhos e não consulta grupo sem vínculo', async () => {
  const rt = runtime({results: [[documentValue('draft')]]});
  await rt.context.listManagementDocuments(areaId, {uid: 'fixture-manager', email: managerEmail, includeInactive: true, groups: [group('general'), group('unmanaged', {managerEmails: []})]});
  assert.equal(rt.queries.length, 1);
  assert.equal(whereValue(rt.queries[0], 'documentGroupId').value, 'general');
  assert.equal(whereValue(rt.queries[0], 'active'), undefined);
});

test('admin e gestor de área consultam área completa sem remover ordenação nem alargar outras áreas', async () => {
  for (const options of [{canManageAll: true}, {areaManager: true, uid: 'area-manager'}]) {
    const rt = runtime({results: [[], []]});
    await rt.context.listManagementDocumentGroups(areaId, options);
    await rt.context.listManagementDocuments(areaId, {...options, includeInactive: true});
    assert.equal(rt.queries.length, 2);
    for (const value of rt.queries) assert.equal(whereValue(value, 'managementAreaId').value, areaId);
    assert.equal(whereValue(rt.queries[1], 'documentGroupId'), undefined);
    assert.equal(whereValue(rt.queries[1], 'active'), undefined);
  }
});

test('consultas de grupos mesclam e ordenam documentos sem duplicar IDs', async () => {
  const newest = documentValue('same-id', {publishedAt: {seconds: 20}}), older = documentValue('older', {publishedAt: {seconds: 10}});
  const rt = runtime({results: [[older, newest], [newest]]});
  const values = await rt.context.listManagementDocuments(areaId, {uid: 'fixture-reader', email, groups: [group('general'), group('restricted')]});
  assert.deepEqual(Array.from(values, value => value.id), ['same-id', 'older']);
});

test('área legada sem grupos preserva query existente e área protegida sem grupos permanece fechada', async () => {
  const rt = runtime();
  await rt.context.listManagementDocuments('legacy-area', {includeInactive: true});
  assert.equal(rt.queries.length, 1); assert.equal(whereValue(rt.queries[0], 'managementAreaId').value, 'legacy-area');
  await rt.context.listManagementDocuments(areaId, {uid: 'fixture-reader', email, includeInactive: true});
  assert.equal(rt.queries.length, 1);
});

test('editar documento preserva grupo, criação, ID e publicação, incrementando apenas revisão e auditoria de edição', async () => {
  const id = 'fixture-document-id', original = documentValue(id);
  const rt = runtime({records: {[`documents/${id}`]: original, 'documentGroups/general': group('general')}});
  const savedId = await rt.context.saveManagementDocument(input({documentGroupId: undefined, title: 'Título revisado'}), 'fixture-manager');
  assert.equal(savedId, id); assert.equal(rt.writes.length, 1);
  const write = rt.writes[0];
  assert.equal(write.kind, 'update'); assert.equal(write.value.documentGroupId, 'general');
  assert.equal(write.value.version, 2); assert.equal(write.value.updatedByUid, 'fixture-manager'); assert.equal(write.value.updatedAt, 'server-time');
  for (const immutable of ['createdAt', 'createdByUid', 'publishedAt', 'id']) assert.equal(Object.hasOwn(write.value, immutable), false);
});

test('save recusa grupo inexistente, área diferente ou remoção do grupo protegido', async () => {
  const id = 'fixture-document-id';
  for (const groupValue of [undefined, group('general', {managementAreaId: 'different-area'})]) {
    const rt = runtime({records: {[`documents/${id}`]: documentValue(id), ...(groupValue ? {'documentGroups/general': groupValue} : {})}});
    await assert.rejects(rt.context.saveManagementDocument(input(), 'fixture-manager'), /grupo de acesso desta área/);
    assert.equal(rt.writes.length, 0);
  }
  const rt = runtime({records: {[`documents/${id}`]: documentValue(id)}});
  await assert.rejects(rt.context.saveManagementDocument(input({documentGroupId: ''}), 'fixture-manager'), /grupo de acesso/);
  assert.equal(rt.writes.length, 0);
});

test('guarda de sessão é repetida depois de leituras e impede write após revogação', async () => {
  const id = 'fixture-document-id';
  let revoked = false, guards = 0;
  const rt = runtime({records: {[`documents/${id}`]: documentValue(id), 'documentGroups/general': group('general')}, onRead: ref => {if (ref.name === 'documentGroups') revoked = true;}});
  const assertCurrent = () => {guards++; if (revoked) throw new Error('Sessão revogada');};
  await assert.rejects(rt.context.saveManagementDocument(input(), 'fixture-manager', {assertCurrent}), /Sessão revogada/);
  assert.ok(guards >= 3); assert.equal(rt.writes.length, 0);
});

test('conflito de revisão é recusado, sem perder ID estável nem sobrescrever metadados', async () => {
  const id = 'fixture-document-id';
  const rt = runtime({records: {[`documents/${id}`]: documentValue(id, {version: 2}), 'documentGroups/general': group('general')}});
  await assert.rejects(rt.context.saveManagementDocument(input(), 'fixture-manager'), /atualizado por outra pessoa/);
  assert.equal(rt.writes.length, 0);
  assert.equal(rt.reads[0].id, id);
});

test('repetir criação com o mesmo ID e conteúdo confirmado não gera nova revisão', async () => {
  const id = 'fixture-document-id';
  const rt = runtime({records: {[`documents/${id}`]: documentValue(id), 'documentGroups/general': group('general')}});
  assert.equal(await rt.context.saveManagementDocument(input({version: 0}), 'fixture-manager'), id);
  assert.equal(rt.writes.length, 0);
});

test('novo grupo normaliza e-mails e autoria sem modificar usuários ou papéis', async () => {
  const rt = runtime();
  const id = await rt.context.saveManagementDocumentGroup({groupId: 'general', managementAreaId: areaId, name: 'ACESSO GERAL', category: 'ACESSO GERAL', accessMode: 'GENERAL', sourceFolderId: 'fictional_drive_folder_123', allowedEmails: 'First@Example.invalid\nfirst@example.invalid\nsecond@example.invalid', managerEmails: ' Manager@Example.invalid ', active: true, version: 0}, 'fixture-admin');
  assert.equal(id, 'general'); assert.equal(rt.writes.length, 1);
  const write = rt.writes[0];
  assert.equal(write.ref.name, 'documentGroups'); assert.equal(write.kind, 'set');
  assert.deepEqual(plain(write.value.allowedEmails), ['first@example.invalid', 'second@example.invalid']);
  assert.deepEqual(plain(write.value.managerEmails), [managerEmail]);
  assert.equal(write.value.createdByUid, 'fixture-admin'); assert.equal(write.value.version, 1);
});

test('guarda de sessão bloqueia atualização de grupo após leitura e conflito de versão não altera a audiência', async () => {
  let revoked = false;
  const original = {...group('general'), accessMode: 'GENERAL', sourceFolderId: '', version: 2, createdByUid: 'fixture-admin'};
  const rt = runtime({records: {'documentGroups/general': original}, onRead: () => {revoked = true;}});
  const value = {groupId: 'general', managementAreaId: areaId, name: 'ACESSO GERAL', category: 'ACESSO GERAL', allowedEmails: email, managerEmails: managerEmail, version: 1};
  await assert.rejects(rt.context.saveManagementDocumentGroup(value, 'fixture-admin', {assertCurrent: () => {if (revoked) throw new Error('Sessão revogada');}}), /Sessão revogada/);
  assert.equal(rt.writes.length, 0);
  const conflict = runtime({records: {'documentGroups/general': original}});
  await assert.rejects(conflict.context.saveManagementDocumentGroup(value, 'fixture-admin'), /atualizado por outra pessoa/);
  assert.equal(conflict.writes.length, 0);
});
test('renomear a categoria do grupo não invalida edição de metadados de documento já vinculado', async () => {
  const id = 'fixture-document-id';
  const rt = runtime({records: {[`documents/${id}`]: documentValue(id), 'documentGroups/general': group('general', {category: 'Categoria atualizada'})}});
  await rt.context.saveManagementDocument(input({title: 'Título revisado mantendo grupo'}), 'fixture-manager');
  assert.equal(rt.writes.length, 1);
  assert.equal(rt.writes[0].value.documentGroupId, 'general');
  assert.equal(rt.writes[0].value.category, 'ACESSO GERAL');
});

test('legado protegido pode receber revisão sem grupo, mas nova criação exige grupo e legado externo não admite grupo', async () => {
  const id = 'fixture-document-id';
  const legacy = documentValue(id); delete legacy.documentGroupId;
  const existing = runtime({records: {[`documents/${id}`]: legacy}});
  await existing.context.saveManagementDocument(input({documentGroupId: '', title: 'Revisão do legado'}), 'fixture-manager');
  assert.equal(existing.writes.length, 1); assert.equal(Object.hasOwn(existing.writes[0].value, 'documentGroupId'), false);
  const creating = runtime();
  await assert.rejects(creating.context.saveManagementDocument(input({documentGroupId: '', version: 0}), 'fixture-admin'), /Escolha o grupo de acesso/);
  assert.equal(creating.writes.length, 0);
  const external = runtime({records: {'documentGroups/general': group('general')}});
  await assert.rejects(external.context.saveManagementDocument(input({managementAreaId: 'legacy-area', version: 0}), 'fixture-admin'), /exclusivos da Gestão de Documentos/);
  assert.equal(external.writes.length, 0);
});