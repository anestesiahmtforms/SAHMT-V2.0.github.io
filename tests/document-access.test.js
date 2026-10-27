import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {renderManagementDocumentCard, renderManagementDocumentFolders, bindManagementDocumentAccessPanels} from '../src/management-document-folders.js';
import {normalizeDriveDocumentUrl} from '../src/drive-document.js';
import {DOCUMENT_GROUPS, DOCUMENT_MANAGEMENT_AREA_ID, canManageManagementDocuments, canReconcileManagementDocumentLinks, normalizeDocumentAccessEmail, documentGroupsFromAccess, documentCollectionForWrite, mergeManagementDocuments, managementDocumentKey} from '../src/document-access.js';

const approvedManager = {active: true, access: true, permissions: {managementRead: true}};
const assignedDocumentArea = {id: DOCUMENT_MANAGEMENT_AREA_ID, active: true, managerUids: ['document-manager']};

test('gestor documental usa apenas managementRead e vínculo na área ativa, sem administração global', () => {
  assert.equal(canManageManagementDocuments(approvedManager, assignedDocumentArea, 'document-manager'), true);
  assert.equal(canManageManagementDocuments(approvedManager, {...assignedDocumentArea, id: 'area-gestao-da-qualidade'}, 'document-manager'), false);
  assert.equal(canManageManagementDocuments(approvedManager, {...assignedDocumentArea, id: 'area-outra'}, 'document-manager'), false);
  assert.deepEqual(approvedManager.permissions, {managementRead: true});
});

test('usuário comum, perfil ausente/revogado e vínculo inativo ou malformado não habilitam edição', () => {
  for (const profile of [null, {...approvedManager, active: false}, {...approvedManager, access: false}, {...approvedManager, permissions: {}}]) {
    assert.equal(canManageManagementDocuments(profile, assignedDocumentArea, 'document-manager'), false);
  }
  for (const area of [null, {...assignedDocumentArea, active: false}, {...assignedDocumentArea, managerUids: []}, {...assignedDocumentArea, managerUids: 'document-manager'}, {...assignedDocumentArea, memberUids: ['ordinary-user'], managerUids: []}]) {
    assert.equal(canManageManagementDocuments(approvedManager, area, 'document-manager'), false);
  }
  assert.equal(canManageManagementDocuments(approvedManager, assignedDocumentArea, 'ordinary-user'), false);
  assert.equal(canManageManagementDocuments(approvedManager, assignedDocumentArea, ''), false);
});

test('autorizações administrativas e de Qualidade existentes permanecem limitadas ao modelo anterior', () => {
  for (const profile of [{...approvedManager, role: 'administrador_app'}, {...approvedManager, permissions: {admin: true}}, {...approvedManager, permissions: {documentsManage: true}}]) {
    assert.equal(canManageManagementDocuments(profile, {id: 'area-outra'}, 'document-manager'), true);
  }
  const quality = {...approvedManager, permissions: {qualityManage: true}};
  assert.equal(canManageManagementDocuments(quality, {id: 'area-gestao-da-qualidade'}, 'quality-manager'), true);
  assert.equal(canManageManagementDocuments(quality, assignedDocumentArea, 'document-manager'), false);
});

test('reconciliação global mantém somente os privilégios anteriores e não deriva de vínculo documental', () => {
  assert.equal(canReconcileManagementDocumentLinks(approvedManager), false);
  for (const permission of ['admin', 'documentsManage', 'managementManage', 'qualityManage', 'trainingsManage']) {
    const profile = {...approvedManager, permissions: {[permission]: true}};
    assert.equal(canReconcileManagementDocumentLinks(profile), true);
    assert.equal(canReconcileManagementDocumentLinks({...profile, active: false}), false);
    assert.equal(canReconcileManagementDocumentLinks({...profile, access: false}), false);
  }
  assert.equal(canReconcileManagementDocumentLinks({...approvedManager, role: 'administrador_app'}), true);
  for (const profile of [null, {...approvedManager, role: 'gestor'}, {...approvedManager, permissions: {documentsManage: 'true'}}]) {
    assert.equal(canReconcileManagementDocumentLinks(profile), false);
  }
});

test('e-mail de acesso é normalizado e nunca permite usar caminhos de documentos', () => {
  assert.equal(normalizeDocumentAccessEmail('  test-user-1@example.test '), 'test-user-1@example.test');
  for (const value of ['', 'a/test-user-2@example.test', 'person @example.invalid', 'test-user-3@example.test/path', 'invalid']) {
    assert.throws(() => normalizeDocumentAccessEmail(value));
  }
});

test('grupo só vem de cadastro ativo, coerente e com enumeração válida', () => {
  const email = 'test-user-3@example.test';
  const record = {id: email, email, active: true, groups: ['RESTRICTED', 'GENERAL']};
  assert.deepEqual(documentGroupsFromAccess(record, email), ['GENERAL', 'RESTRICTED']);
  for (const patch of [{active: false}, {email: 'test-user-4@example.test'}, {id: 'test-user-4@example.test'}, {groups: ['ADMIN']}, {groups: ['GENERAL', 'GENERAL']}, {groups: null}]) {
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
test('PDF de apoio é associado ao formulário sem alterar registros persistidos ou duplicar cartões', () => {
  const original = {id: 'evaluation_form-1', driveFileId: 'form-1', documentCollection: 'scopedDocuments', audienceGroup: 'GENERAL', category: 'PROTOCOLOS', managementAreaId: 'area-docs', active: true};
  const pdf = {...original, id: 'pdf_evaluation_form-1', driveFileId: 'pdf-1', driveUrl: 'https://drive.google.com/file/d/pdf-1/view'};
  const result = mergeManagementDocuments([], [original, pdf]);
  assert.equal(result.length, 1);
  assert.equal(result[0].materialPdfUrl, pdf.driveUrl);
  assert.equal(result[0].materialPdfSourceFileId, original.driveFileId);
  assert.equal(original.materialPdfUrl, undefined);
});

test('PDF divergente, inativo ou de outro público não é associado ao treinamento', () => {
  const original = {id: 'evaluation_form-1', driveFileId: 'form-1', documentCollection: 'scopedDocuments', audienceGroup: 'GENERAL', category: 'PROTOCOLOS', managementAreaId: 'area-docs', active: true};
  const pdf = {...original, id: 'pdf_evaluation_form-1', driveFileId: 'pdf-1', driveUrl: 'https://drive.google.com/file/d/pdf-1/view'};
  for (const patch of [{audienceGroup: 'RESTRICTED'}, {active: false}, {category: 'OTHER'}, {managementAreaId: 'other'}, {driveUrl: 'https://example.invalid/file'}, {driveFileId: 'other-file'}]) {
    const result = mergeManagementDocuments([], [original, {...pdf, ...patch}]);
    assert.equal(result.find(item => item.id === original.id).materialPdfUrl, undefined);
  }
  assert.equal(mergeManagementDocuments([], [{...original, driveFileId: 'new-form'}, pdf]).find(item => item.id === original.id).materialPdfUrl, undefined);
});

test('PDF sem formulário presente continua acessível como documento normal', () => {
  const pdf = {id: 'pdf_evaluation_form-1', documentCollection: 'scopedDocuments', driveFileId: 'pdf-1', driveUrl: 'https://drive.google.com/file/d/pdf-1/view', active: true};
  assert.deepEqual(mergeManagementDocuments([], [pdf]), [pdf]);
});

const accessSource = dataSource.slice(dataSource.indexOf('async function scopedDocumentAccess('), dataSource.indexOf('export async function listManagementDocuments('))
  .replace("await import('./firebase-auth.js')", 'authModule');
function accessHarness({profile = approvedManager, area = assignedDocumentArea, afterAreaRead = () => {}} = {}) {
  const calls = [];
  const email = 'test-user-5@example.test';
  const user = {uid: 'document-manager', getIdTokenResult: async () => ({claims: {email, email_verified: true, firebase: {sign_in_provider: 'google.com'}}})};
  const auth = {currentUser: user};
  const ctx = {assertOnlineOperation(){},db: {}, identityDb: {}, managementDatabase:async()=>({}), managementProfileCollection:()=> 'users',
    managementProfileData:(_db,snapshot)=>snapshot.exists()?snapshot.data():null,
    authModule: {auth}, DOCUMENT_GROUPS, DOCUMENT_MANAGEMENT_AREA_ID, canManageManagementDocuments,
    normalizeDocumentAccessEmail, documentGroupsFromAccess, doc: (_, collection, id) => ({collection, id}),
    getDocFromServer: async ref => {
      calls.push(ref); const value = ref.collection === 'users' ? profile : ref.collection === 'managementAreas' ? area :
        {id: email, email, active: true, groups: ['GENERAL']};
      if (ref.collection === 'managementAreas') afterAreaRead(auth);
      return {id: ref.id, exists: () => !!value, data: () => value};
    }};
  vm.createContext(ctx); vm.runInContext(accessSource, ctx);
  return {calls, auth, ctx, access: ctx.scopedDocumentAccess};
}

const saving = dataSource.slice(dataSource.indexOf('export async function saveManagementDocument('), dataSource.indexOf('export async function saveDocumentAccessEmail(')).replace('export ', '');
const reconciling = dataSource.slice(dataSource.indexOf('function queueEvaluationReconciliation('), dataSource.indexOf('export async function listEquipmentForArea('));
const documentInput = {documentId: 'manager-document-01', managementAreaId: DOCUMENT_MANAGEMENT_AREA_ID,
  title: 'Documento de teste', description: 'Sem dados reais', category: 'Orientação', driveUrl: 'https://drive.google.com/file/d/DriveFile_1234567/view',
  active: false, requiredReading: true, version: 0};
function saveHarness({profile = approvedManager, area = assignedDocumentArea, transactionProfile = profile, transactionArea = area, beforeTransaction = () => {}, beforeWrite = () => {}} = {}) {
  const h = accessHarness({profile, area}), records = new Map(), commits = [], reads = [];
  Object.assign(h.ctx, {crypto: {randomUUID}, documentCollectionForWrite, normalizeDriveDocumentUrl, canReconcileManagementDocumentLinks,
    serverTimestamp: () => 'server-timestamp', runTransaction: async (_, callback) => {
      beforeTransaction(h.auth);
      const staged = [];
      const transaction = {
        get: async ref => {
          reads.push(ref);
          const record = ref.collection === 'users' ? transactionProfile : ref.collection === 'managementAreas' ? transactionArea : records.get(`${ref.collection}/${ref.id}`);
          beforeWrite(h.auth);
          return {id: ref.id, exists: () => !!record, data: () => record};
        },
        set: (ref, value) => staged.push({ref, value: structuredClone(value)}),
        update: (ref, value) => staged.push({ref, value: {...records.get(`${ref.collection}/${ref.id}`), ...structuredClone(value)}})
      };
      await callback(transaction);
      for (const item of staged) records.set(`${item.ref.collection}/${item.ref.id}`, item.value);
      commits.push(staged);
    }});
  vm.runInContext(saving + reconciling, h.ctx);
  return {...h, records, commits, reads, save: h.ctx.saveManagementDocument};
}

test('salvamento real do gestor documental cria/edita ambas as coleções com auditoria e sem request global', async () => {
  for (const documentCollection of ['documents', 'scopedDocuments']) {
    const h = saveHarness(), input = {...documentInput, documentCollection};
    if (documentCollection === 'scopedDocuments') input.audienceGroup = 'RESTRICTED';
    assert.equal(await h.save(input, 'document-manager'), input.documentId);
    const key = `${documentCollection}/${input.documentId}`, created = h.records.get(key);
    assert.equal(created.version, 1); assert.equal(created.createdByUid, 'document-manager');
    assert.equal(created.updatedByUid, 'document-manager'); assert.equal(created.active, false);
    await h.save({...input, title: 'Revisão periódica', version: 1}, 'document-manager');
    const edited = h.records.get(key);
    assert.equal(edited.version, 2); assert.equal(edited.title, 'Revisão periódica');
    assert.equal(edited.createdAt, created.createdAt); assert.equal(edited.publishedAt, created.publishedAt);
    assert.equal(edited.updatedByUid, 'document-manager');
    assert.deepEqual(h.commits.map(items => items.map(item => item.ref.collection)), [[documentCollection], [documentCollection]]);
    assert.ok(h.reads.some(ref => ref.collection === 'users'));
    assert.ok(h.reads.some(ref => ref.collection === 'managementAreas'));
  }
});

test('administradores e documentsManage conservam reconciliação atômica ao criar e editar documento', async () => {
  for (const profile of [{...approvedManager, role: 'administrador_app'}, {...approvedManager, permissions: {documentsManage: true}}, {...approvedManager, permissions: {qualityManage: true}}]) {
    const h = saveHarness({profile});
    const input = {...documentInput, managementAreaId: profile.permissions.qualityManage ? 'area-gestao-da-qualidade' : documentInput.managementAreaId};
    await h.save(input, 'document-manager');
    await h.save({...input, title: 'Revisão autorizada', version: 1}, 'document-manager');
    assert.deepEqual(h.commits.map(items => items.map(item => item.ref.collection)), [['documents', 'evaluationRequests'], ['documents', 'evaluationRequests']]);
    for (const item of h.commits.flat().filter(item => item.ref.collection === 'evaluationRequests')) {
      assert.equal(item.value.type, 'RECONCILE_LINKS'); assert.equal(item.value.actorUid, 'document-manager');
      assert.equal(item.value.status, 'PENDING'); assert.deepEqual(item.value.payload, {});
    }
  }
});

test('revogação de perfil ou vínculo após preflight impede a transação de gravar documento', async () => {
  for (const options of [{transactionProfile: null}, {transactionProfile: {...approvedManager, active: false}},
    {transactionProfile: {...approvedManager, access: false}}, {transactionProfile: {...approvedManager, permissions: {}}},
    {transactionArea: {...assignedDocumentArea, active: false}}, {transactionArea: {...assignedDocumentArea, managerUids: []}}, {transactionArea: null}]) {
    const h = saveHarness(options);
    await assert.rejects(h.save(documentInput, 'document-manager'), /revogada/);
    assert.equal(h.records.size, 0); assert.equal(h.commits.length, 0);
  }
});

test('sessão alterada, autor diferente e gestor de outra área não iniciam salvamento autorizado', async () => {
  const changed = saveHarness({beforeWrite: auth => {auth.currentUser = {uid: 'other-user'};}});
  await assert.rejects(changed.save(documentInput, 'document-manager'), /sessão mudou/);
  assert.equal(changed.records.size, 0); assert.equal(changed.commits.length, 0);
  for (const [options, input, uid] of [[{profile: null}, documentInput, 'document-manager'],
    [{}, documentInput, 'other-user'], [{}, {...documentInput, managementAreaId: 'area-outra'}, 'document-manager']]) {
    const h = saveHarness(options);
    await assert.rejects(h.save(input, uid), /revogado|sessão expirou|permissão/);
    assert.equal(h.reads.length, 0); assert.equal(h.commits.length, 0);
  }
});

test('repetição idempotente preserva versão e não cria reconciliação duplicada; edição antiga é rejeitada', async () => {
  const h = saveHarness({profile: {...approvedManager, permissions: {documentsManage: true}}});
  await h.save(documentInput, 'document-manager');
  await h.save(documentInput, 'document-manager');
  assert.equal(h.records.size, 2); assert.equal(h.commits[1].length, 0);
  await assert.rejects(h.save({...documentInput, title: 'Conflito', version: 3}, 'document-manager'), /outra pessoa/);
  assert.equal(h.records.get(`documents/${documentInput.documentId}`).version, 1);
});

test('listagem documental confere o vínculo vigente no servidor antes de oferecer os dois grupos/inativos', async () => {
  const h = accessHarness(), result = await h.access(DOCUMENT_MANAGEMENT_AREA_ID, 'document-manager');
  assert.equal(result.manages, true); assert.deepEqual([...result.groups], ['GENERAL', 'RESTRICTED']);
  assert.deepEqual(h.calls.map(ref => ref.collection), ['users', 'managementAreas']);
  const revoked = accessHarness({area: {...assignedDocumentArea, managerUids: []}});
  const common = await revoked.access(DOCUMENT_MANAGEMENT_AREA_ID, 'document-manager');
  assert.equal(common.manages, false); assert.deepEqual([...common.groups], ['GENERAL']);
  assert.deepEqual(revoked.calls.map(ref => ref.collection), ['users', 'managementAreas', 'documentAccessEmails']);
});

test('perfil ausente e troca de sessão durante leitura do vínculo bloqueiam antes de devolver documentos', async () => {
  await assert.rejects(accessHarness({profile: null}).access(DOCUMENT_MANAGEMENT_AREA_ID, 'document-manager'), /revogado/);
  await assert.rejects(accessHarness({afterAreaRead: auth => {auth.currentUser = {uid: 'other-user'};}}).access(DOCUMENT_MANAGEMENT_AREA_ID, 'document-manager'), /sessão mudou/);
});
const listing = dataSource.slice(dataSource.indexOf('export async function listManagementDocuments('), dataSource.indexOf('export async function saveManagementDocument(')).replace('export ', '');
function listHarness({groups = ['GENERAL'], manages = false, checkSession = () => {}} = {}) {
  const calls = [];
  const ctx = {assertOnlineOperation(){},db: {}, managementDatabase:async()=>({}), scopedDocumentAccess: async () => ({groups, manages, checkSession}), mergeManagementDocuments,
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

test('editor e rascunhos usam permissão documental da área sem alterar o can global de outros módulos', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /const managesDocuments = canManageManagementDocuments\(session\.profile, area, session\.user\.uid\)/);
  assert.match(main, /includeInactive: managesDocuments/);
  assert.match(main, /const documentForm = managesDocuments \?/);
  assert.match(main, /const documentOptions = {canEdit: managesDocuments}/);
  const item = {id: 'synthetic-document', title: 'Protocolo sintético', category: 'Protocolos', driveUrl: 'https://example.invalid/document', documentCollection: 'scopedDocuments'};
  for (const render of [options => renderManagementDocumentCard(item, options), options => renderManagementDocumentFolders([item], options)]) {
    assert.match(render({canEdit: true}), /data-document-edit="scopedDocuments\/synthetic-document"/);
    assert.doesNotMatch(render({canEdit: false}), /data-document-edit=/);
    assert.doesNotMatch(render(), /data-document-edit=/);
  }
  assert.match(main, /const assignmentEditor = can\('managementManage'\) \?/);
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

test('fechar cada painel retorna o foco e a rolagem para as pastas de Gestão de documentos', () => {
  for (const access of ['GENERAL', 'RESTRICTED']) {
    const events = new Map();
    const panel = {dataset: {documentAccessPanel: access}, open: false, isConnected: true,
      addEventListener: (name, callback) => events.set(name, callback),
      showModal() { this.open = true; }, close() { this.open = false; events.get('close')?.(); }};
    const trigger = {dataset: {documentAccessOpen: access}, isConnected: true, focused: false, scrolled: false,
      addEventListener: (name, callback) => events.set('trigger-' + access, callback),
      focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; }};
    const root = {querySelectorAll: selector => selector === '[data-document-access-open]' ? [trigger] : [panel]};
    bindManagementDocumentAccessPanels(root);

    events.get('trigger-' + access)();
    assert.equal(panel.open, true);
    panel.close();
    assert.equal(panel.open, false);
    assert.equal(trigger.focused, true);
    assert.equal(trigger.scrolled, true);
  }
});

test('fechar um painel para editar documento preserva o foco do editor', () => {
  let closeHandler;
  const panel = {dataset: {documentAccessPanel: 'GENERAL'}, open: true, isConnected: true,
    addEventListener: (name, callback) => { if (name === 'close') closeHandler = callback; }};
  const trigger = {dataset: {documentAccessOpen: 'GENERAL'}, isConnected: true, focused: false,
    addEventListener() {}, focus() { this.focused = true; }, scrollIntoView() {}};
  bindManagementDocumentAccessPanels({querySelectorAll: selector => selector === '[data-document-access-open]' ? [trigger] : [panel]});
  panel.dataset.closeAction = 'edit';
  closeHandler();
  assert.equal(trigger.focused, false);
  assert.equal('closeAction' in panel.dataset, false);
});
