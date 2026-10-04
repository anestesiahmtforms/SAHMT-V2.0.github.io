import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeDocumentAccessEmail, documentGroupsFromAccess, documentCollectionForWrite, mergeManagementDocuments, managementDocumentKey} from '../src/document-access.js';

test('e-mail de acesso é normalizado e nunca permite usar caminhos de documentos', () => {
  assert.equal(normalizeDocumentAccessEmail('  Person.Name+test@Example.invalid '), 'person.name+test@example.invalid');
  for (const value of ['', 'a/b@example.invalid', 'person @example.invalid', 'person@example.invalid/path', 'invalid']) {
    assert.throws(() => normalizeDocumentAccessEmail(value));
  }
});

test('grupo só vem de cadastro ativo, coerente e com enumeração válida', () => {
  const email = 'person@example.invalid';
  const record = {id: email, email, active: true, groups: ['RESTRICTED', 'GENERAL']};
  assert.deepEqual(documentGroupsFromAccess(record, email), ['GENERAL', 'RESTRICTED']);
  for (const patch of [{active: false}, {email: 'other@example.invalid'}, {id: 'other@example.invalid'}, {groups: ['ADMIN']}, {groups: ['GENERAL', 'GENERAL']}, {groups: null}]) {
    assert.deepEqual(documentGroupsFromAccess({...record, ...patch}, email), []);
  }
  assert.deepEqual(documentGroupsFromAccess(null, email), []);
});

test('gravação preserva legado e exige escolha explícita nos documentos novos', () => {
  assert.equal(documentCollectionForWrite({}), 'documents');
  assert.equal(documentCollectionForWrite({documentCollection: 'documents'}), 'documents');
  assert.equal(documentCollectionForWrite({documentCollection: 'scopedDocuments', audienceGroup: 'GENERAL'}), 'scopedDocuments');
  for (const input of [{audienceGroup: 'GENERAL'}, {documentCollection: 'users'}, {documentCollection: 'scopedDocuments'}, {documentCollection: 'scopedDocuments', audienceGroup: 'ADMIN'}]) {
    assert.throws(() => documentCollectionForWrite(input));
  }
});

test('união mantém documentos com mesmo ID em coleções diferentes e limita a paginação conjunta', () => {
  const legacy = {id: 'same-id', publishedAt: {toMillis: () => 2}};
  const scoped = {id: 'same-id', documentCollection: 'scopedDocuments', publishedAt: {toMillis: () => 3}};
  assert.equal(managementDocumentKey(legacy), 'documents/same-id');
  assert.deepEqual(mergeManagementDocuments([legacy], [scoped]), [scoped, legacy]);
  assert.deepEqual(mergeManagementDocuments([legacy], [scoped], 1), [scoped]);
});

const dataSource = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8');
const listing = dataSource.slice(dataSource.indexOf('export async function listManagementDocuments('), dataSource.indexOf('export async function saveManagementDocument(')).replace('export ', '');
function listHarness({groups = ['GENERAL'], manages = false, checkSession = () => {}} = {}) {
  const calls = [];
  const ctx = {db: {}, scopedDocumentAccess: async () => ({groups, manages, checkSession}), mergeManagementDocuments,
    where: (...args) => ({where: args}), orderBy: (...args) => ({orderBy: args}), limit: value => ({limit: value}),
    collection: (_, name) => name, query: (collection, ...constraints) => ({collection, constraints}),
    getDocsFromServer: async request => {calls.push(request); return {docs: [{id: 'shared-id', data: () => ({publishedAt: new Date(), active: true})}]};}};
  vm.createContext(ctx); vm.runInContext(listing, ctx);
  return {calls, list: ctx.listManagementDocuments};
}

test('consulta de usuário mantém legado e restringe novo catálogo ao grupo autorizado e ativo', async () => {
  const h = listHarness(); const records = await h.list('area-documents', {includeInactive: true});
  assert.equal(records.length, 2);
  const scoped = h.calls.find(call => call.collection === 'scopedDocuments');
  assert.ok(scoped.constraints.some(item => JSON.stringify(item.where) === '["active","==",true]'));
  assert.ok(scoped.constraints.some(item => JSON.stringify(item.where) === '["audienceGroup","in",["GENERAL"]]'));
  assert.ok(h.calls.some(call => call.collection === 'documents'));
});

test('sem autorização por grupo não consulta coleção nova; administrador pode listar inativos dos dois grupos', async () => {
  const common = listHarness({groups: []}); await common.list('area-documents');
  assert.deepEqual(common.calls.map(call => call.collection), ['documents']);
  const admin = listHarness({groups: ['GENERAL', 'RESTRICTED'], manages: true}); await admin.list('area-documents', {includeInactive: true});
  const scoped = admin.calls.find(call => call.collection === 'scopedDocuments');
  assert.ok(!scoped.constraints.some(item => item.where?.[0] === 'active'));
});

test('resposta de consulta em sessão substituída não devolve documentos', async () => {
  const h = listHarness({checkSession: () => {throw new Error('A sessão mudou.');}});
  await assert.rejects(h.list('area-documents'), /sessão mudou/);
});

test('editor identifica coleção e oculta escolha de público ao editar documentos antigos', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /name="documentCollection" value="scopedDocuments"/);
  assert.match(main, /documentEditor\.elements\.audienceGroup\.disabled = !item\.audienceGroup/);
  assert.match(main, /documentEditor\.querySelector\('\[data-document-audience\]'\)\.hidden = !item\.audienceGroup/);
  assert.match(main, /\(document\.documentCollection \|\| 'documents'\) \+ '\/' \+ document\.id === button\.dataset\.documentEdit/);
});

test('índices cobrem consultas novas com público e com filtro de estado ativo', () => {
  const config = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const scoped = config.indexes.filter(index => index.collectionGroup === 'scopedDocuments');
  assert.equal(scoped.length, 2);
  assert.deepEqual(scoped.map(index => index.fields.map(field => field.fieldPath)), [
    ['managementAreaId', 'audienceGroup', 'publishedAt'],
    ['managementAreaId', 'active', 'audienceGroup', 'publishedAt']
  ]);
  assert.ok(scoped.every(index => index.queryScope === 'COLLECTION' && index.fields.at(-1).order === 'DESCENDING'));
});
