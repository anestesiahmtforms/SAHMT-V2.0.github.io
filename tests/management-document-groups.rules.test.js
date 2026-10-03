import {readFile} from 'node:fs/promises';
import {after, before, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, setLogLevel, updateDoc, where, writeBatch} from 'firebase/firestore';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';

const protectedArea = 'area-gestao-de-documentos';
const otherArea = 'area-document-test-unrelated';
const generalId = 'document-group-general';
const restrictedId = 'document-group-restricted';
const generalEmails = Array.from({length: 55}, (_, i) => `reader-${i + 1}@example.invalid`);
const restrictedEmails = generalEmails.slice(0, 31);
const authClaims = (email, extra = {}) => ({email, email_verified: true, firebase: {sign_in_provider: 'google.com'}, ...extra});
const profile = (uid, permissions = {managementRead: true}, overrides = {}) => ({uid, email: `${uid}@example.invalid`, displayName: uid, sigla: '', phone: '', active: true, access: true, role: 'anestesiologista', permissions, createdAt: 'fixture', updatedAt: 'fixture', ...overrides});
const group = (id, overrides = {}) => ({id, managementAreaId: protectedArea, name: id === generalId ? 'ACESSO GERAL' : 'ACESSO RESTRITO', category: id === generalId ? 'ACESSO GERAL' : 'POLITICAS E REGIMENTOS', accessMode: id === generalId ? 'GENERAL' : 'RESTRICTED', sourceFolderId: 'fictional_drive_folder_123', allowedEmails: id === generalId ? generalEmails : restrictedEmails, managerEmails: ['group-manager@example.invalid'], active: true, version: 1, createdByUid: 'fixture-admin', createdAt: new Date(), updatedByUid: 'fixture-admin', updatedAt: new Date(), ...overrides});
const documentValue = (id, groupId, overrides = {}) => ({id, managementAreaId: protectedArea, title: `Documento fictício ${id}`, description: '', driveFileId: 'fictional_drive_document_123', driveUrl: 'https://drive.google.com/file/d/fictional_drive_document_123/view', version: 1, category: groupId === generalId ? 'ACESSO GERAL' : 'POLITICAS E REGIMENTOS', active: true, publishedAt: new Date(), requiredReading: false, createdByUid: 'fixture-admin', createdAt: new Date(), updatedByUid: 'fixture-admin', updatedAt: new Date(), ...(groupId ? {documentGroupId: groupId} : {}), ...overrides});

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('ACL de documentos exige emulador explícito com dados fictícios', {skip: 'Execute npm run test:rules com Firebase Emulator.'}, () => {});
} else {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(?:127\.0\.0\.1|localhost):(?:8080|8081)$/);
  const emulatorPort = Number(process.env.FIRESTORE_EMULATOR_HOST.split(':').at(-1));
  let environment;
  setLogLevel('silent');
  const dbFor = (uid, email = `${uid}@example.invalid`, claims = {}) => environment.authenticatedContext(uid, authClaims(email, claims)).firestore();
  const seed = (kind, id, data) => environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), kind, id), data));
  const direct = (db, id) => getDoc(doc(db, 'documents', id));
  const docsQuery = (db, groupId, {includeInactive = false, areaId = protectedArea} = {}) => query(collection(db, 'documents'), where('managementAreaId', '==', areaId), ...(groupId ? [where('documentGroupId', '==', groupId)] : []), ...(includeInactive ? [] : [where('active', '==', true)]), orderBy('publishedAt', 'desc'), limit(100));
  const groupsQuery = (db, field, email, areaId = protectedArea) => query(collection(db, 'documentGroups'), where('managementAreaId', '==', areaId), where('active', '==', true), where(field, 'array-contains', email));
  const edit = (db, uid, id, changes = {}) => updateDoc(doc(db, 'documents', id), {...changes, updatedByUid: uid, updatedAt: serverTimestamp(), version: 2});
  before(async () => {
    environment = await initializeTestEnvironment({projectId: 'demo-sahmt-v2', firestore: {host: '127.0.0.1', port: emulatorPort, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')}});
  });
  beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore(), batch = writeBatch(db);
      for (const value of [
        profile('fixture-admin', {admin: true}, {role: 'administrador_app'}),
        profile('fixture-doc-manager', {documentsManage: true}),
        profile('fixture-both-reader'), profile('fixture-general-reader'), profile('fixture-outsider'),
        profile('fixture-group-manager'), profile('fixture-area-manager'),
        profile('fixture-no-module', {}), profile('fixture-unapproved', {managementRead: true}, {access: false}),
        profile('fixture-inactive', {managementRead: true}, {active: false})
      ]) batch.set(doc(db, 'users', value.uid), value);
      batch.set(doc(db, 'managementAreas', protectedArea), {id: protectedArea, name: 'Gestão de Documentos', active: true, managerUids: ['fixture-area-manager'], memberUids: []});
      batch.set(doc(db, 'managementAreas', otherArea), {id: otherArea, name: 'Área sem relação', active: true, managerUids: [], memberUids: []});
      batch.set(doc(db, 'documentGroups', generalId), group(generalId));
      batch.set(doc(db, 'documentGroups', restrictedId), group(restrictedId));
      batch.set(doc(db, 'documents', 'general-active'), documentValue('general-active', generalId));
      batch.set(doc(db, 'documents', 'restricted-active'), documentValue('restricted-active', restrictedId));
      batch.set(doc(db, 'documents', 'general-draft'), documentValue('general-draft', generalId, {active: false}));
      batch.set(doc(db, 'documents', 'restricted-draft'), documentValue('restricted-draft', restrictedId, {active: false}));
      batch.set(doc(db, 'documents', 'protected-ungrouped'), documentValue('protected-ungrouped', ''));
      batch.set(doc(db, 'documents', 'legacy-other-area'), documentValue('legacy-other-area', '', {managementAreaId: otherArea, active: false}));
      await batch.commit();
    });
  });
  after(async () => environment?.cleanup());

  test('55 membros gerais e 31 restritos: consultas selecionam apenas grupos e documentos autorizados', async () => {
    assert.equal(generalEmails.length, 55); assert.equal(restrictedEmails.length, 31);
    const generalReader = dbFor('fixture-general-reader', generalEmails[40]);
    const bothReader = dbFor('fixture-both-reader', generalEmails[0]);
    const generalGroups = await assertSucceeds(getDocs(groupsQuery(generalReader, 'allowedEmails', generalEmails[40])));
    const bothGroups = await assertSucceeds(getDocs(groupsQuery(bothReader, 'allowedEmails', generalEmails[0])));
    assert.deepEqual(generalGroups.docs.map(value => value.id), [generalId]);
    assert.deepEqual(new Set(bothGroups.docs.map(value => value.id)), new Set([generalId, restrictedId]));
    const visibleGeneral = await assertSucceeds(getDocs(docsQuery(generalReader, generalId)));
    assert.deepEqual(visibleGeneral.docs.map(value => value.id), ['general-active']);
    const visibleRestricted = await assertSucceeds(getDocs(docsQuery(bothReader, restrictedId)));
    assert.deepEqual(visibleRestricted.docs.map(value => value.id), ['restricted-active']);
    await assertFails(getDocs(docsQuery(generalReader, restrictedId)));
    await assertFails(direct(generalReader, 'restricted-active'));
    await assertFails(getDoc(doc(generalReader, 'documentGroups', restrictedId)));
  });

  test('leitor não usa consulta ampla nem lê rascunho ou documento sem grupo da área protegida', async () => {
    const reader = dbFor('fixture-both-reader', generalEmails[0]);
    await assertFails(getDocs(docsQuery(reader, '', {includeInactive: false})));
    await assertFails(getDocs(docsQuery(reader, generalId, {includeInactive: true})));
    await assertFails(getDocs(query(collection(reader, 'documentGroups'), where('managementAreaId', '==', protectedArea))));
    await assertFails(direct(reader, 'general-draft'));
    await assertFails(direct(reader, 'restricted-draft'));
    await assertFails(direct(reader, 'protected-ungrouped'));
  });

  test('e-mail da lista não aprova conta: perfil ausente, inativo, sem acesso ou sem managementRead são recusados', async () => {
    for (const uid of ['fixture-unprovisioned', 'fixture-unapproved', 'fixture-inactive', 'fixture-no-module']) {
      const db = dbFor(uid, generalEmails[0]);
      await assertFails(direct(db, 'general-active'));
      await assertFails(getDocs(docsQuery(db, generalId)));
      await assertFails(getDocs(groupsQuery(db, 'allowedEmails', generalEmails[0])));
    }
  });

  test('Rules usam e-mail verificado do token e não o e-mail editável do perfil', async () => {
    await seed('users', 'fixture-outsider', profile('fixture-outsider', {managementRead: true}, {email: generalEmails[0]}));
    const outsider = dbFor('fixture-outsider', 'unlisted@example.invalid');
    const unverified = dbFor('fixture-both-reader', generalEmails[0], {email_verified: false});
    const missingEmail = environment.authenticatedContext('fixture-both-reader', {email_verified: true}).firestore();
    await assertFails(direct(outsider, 'general-active'));
    await assertFails(direct(unverified, 'general-active'));
    await assertFails(direct(missingEmail, 'general-active'));
    await assertFails(getDocs(groupsQuery(outsider, 'allowedEmails', generalEmails[0])));
    await assertSucceeds(direct(dbFor('fixture-both-reader', generalEmails[0].toUpperCase()), 'general-active'));
  });

  test('revogar aprovação ou permissão bloqueia a leitura mesmo mantendo o e-mail no grupo', async () => {
    const reader = dbFor('fixture-both-reader', generalEmails[0]);
    await assertSucceeds(direct(reader, 'general-active'));
    await seed('users', 'fixture-both-reader', profile('fixture-both-reader', {}, {access: false}));
    await assertFails(direct(reader, 'general-active'));
    await seed('users', 'fixture-both-reader', profile('fixture-both-reader', {}));
    await assertFails(getDocs(docsQuery(reader, generalId)));
  });

  test('retirar o e-mail ou inativar o grupo bloqueia o documento imediatamente', async () => {
    const reader = dbFor('fixture-both-reader', generalEmails[0]);
    await assertSucceeds(direct(reader, 'general-active'));
    await seed('documentGroups', generalId, group(generalId, {allowedEmails: generalEmails.slice(1)}));
    await assertFails(direct(reader, 'general-active'));
    await seed('documentGroups', generalId, group(generalId, {active: false}));
    await assertFails(direct(reader, 'general-active'));
    await assertFails(getDocs(docsQuery(reader, generalId)));
  });

  test('gestor por e-mail vê e edita rascunho do seu grupo sem alterar a audiência', async () => {
    const manager = dbFor('fixture-group-manager', 'group-manager@example.invalid');
    const availableGroups = await assertSucceeds(getDocs(groupsQuery(manager, 'managerEmails', 'group-manager@example.invalid')));
    assert.equal(availableGroups.size, 2);
    const documents = await assertSucceeds(getDocs(docsQuery(manager, generalId, {includeInactive: true})));
    assert.deepEqual(new Set(documents.docs.map(value => value.id)), new Set(['general-active', 'general-draft']));
    await assertSucceeds(edit(manager, 'fixture-group-manager', 'general-draft', {title: 'Título fictício revisado', description: 'Descrição revisada'}));
    const saved = (await direct(manager, 'general-draft')).data();
    assert.equal(saved.version, 2); assert.equal(saved.updatedByUid, 'fixture-group-manager');
    assert.equal(saved.createdByUid, 'fixture-admin'); assert.equal(saved.documentGroupId, generalId);
    await assertFails(updateDoc(doc(manager, 'documentGroups', generalId), {allowedEmails: ['unlisted@example.invalid'], updatedByUid: 'fixture-group-manager', updatedAt: serverTimestamp(), version: 2}));
  });

  test('gestor de um grupo não edita outro grupo, outra área ou cria novos documentos', async () => {
    await seed('documentGroups', restrictedId, group(restrictedId, {managerEmails: ['different-manager@example.invalid']}));
    const manager = dbFor('fixture-group-manager', 'group-manager@example.invalid');
    await assertFails(direct(manager, 'restricted-draft'));
    await assertFails(edit(manager, 'fixture-group-manager', 'restricted-active', {title: 'Tentativa'}));
    await assertFails(edit(manager, 'fixture-group-manager', 'legacy-other-area', {title: 'Tentativa'}));
    const id = 'manager-cannot-create';
    await assertFails(setDoc(doc(manager, 'documents', id), documentValue(id, generalId, {createdByUid: 'fixture-group-manager', updatedByUid: 'fixture-group-manager', createdAt: serverTimestamp(), publishedAt: serverTimestamp(), updatedAt: serverTimestamp()})));
  });

  test('gestor de área vê rascunhos e edita metadados somente da própria área', async () => {
    const manager = dbFor('fixture-area-manager');
    const groups = await assertSucceeds(getDocs(query(collection(manager, 'documentGroups'), where('managementAreaId', '==', protectedArea))));
    assert.equal(groups.size, 2);
    const documents = await assertSucceeds(getDocs(docsQuery(manager, '', {includeInactive: true})));
    assert.equal(documents.size, 5);
    await assertSucceeds(edit(manager, 'fixture-area-manager', 'restricted-draft', {title: 'Revisão do gestor da área'}));
    await assertFails(edit(manager, 'fixture-area-manager', 'legacy-other-area', {title: 'Tentativa fora da área'}));
    await assertFails(updateDoc(doc(manager, 'documentGroups', restrictedId), {managerEmails: ['fixture-area-manager@example.invalid'], updatedByUid: 'fixture-area-manager', updatedAt: serverTimestamp(), version: 2}));
  });

  test('gestores locais não reclassificam grupo, área, autoria, timestamps de criação ou versão', async () => {
    const manager = dbFor('fixture-group-manager', 'group-manager@example.invalid');
    for (const changes of [{documentGroupId: restrictedId}, {category: 'RECLASSIFICAÇÃO'}, {managementAreaId: otherArea}, {createdByUid: 'fixture-group-manager'}, {createdAt: new Date(0)}, {publishedAt: new Date(0)}, {version: 10}]) {
      const patch = {...changes, updatedByUid: 'fixture-group-manager', updatedAt: serverTimestamp(), ...(Object.hasOwn(changes, 'version') ? {} : {version: 2})};
      await assertFails(updateDoc(doc(manager, 'documents', 'general-draft'), patch));
    }
  });

  test('gestor perde edição ao remover seu vínculo, permissão, aprovação ou ativação da área', async () => {
    const manager = dbFor('fixture-group-manager', 'group-manager@example.invalid');
    await seed('documentGroups', generalId, group(generalId, {managerEmails: []}));
    await assertFails(edit(manager, 'fixture-group-manager', 'general-draft', {title: 'Sem vínculo'}));
    await seed('documentGroups', generalId, group(generalId));
    await seed('users', 'fixture-group-manager', profile('fixture-group-manager', {}));
    await assertFails(edit(manager, 'fixture-group-manager', 'general-draft', {title: 'Sem módulo'}));
    await seed('users', 'fixture-group-manager', profile('fixture-group-manager', {managementRead: true}, {access: false}));
    await assertFails(edit(manager, 'fixture-group-manager', 'general-draft', {title: 'Revogado'}));
    await seed('users', 'fixture-group-manager', profile('fixture-group-manager'));
    await seed('managementAreas', protectedArea, {id: protectedArea, active: false, managerUids: ['fixture-area-manager']});
    await assertFails(edit(manager, 'fixture-group-manager', 'general-draft', {title: 'Área inativa'}));
  });

  test('administrador cadastra grupo e documento inativo, mantendo limites e auditoria de revisão', async () => {
    const admin = dbFor('fixture-admin');
    const id = 'document-group-created';
    await assertSucceeds(setDoc(doc(admin, 'documentGroups', id), group(id, {name: 'Grupo fictício', allowedEmails: ['allowed@example.invalid'], managerEmails: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp()})));
    await assertSucceeds(updateDoc(doc(admin, 'documentGroups', id), {allowedEmails: ['second@example.invalid'], updatedByUid: 'fixture-admin', updatedAt: serverTimestamp(), version: 2}));
    await assertSucceeds(setDoc(doc(admin, 'documents', 'admin-created-draft'), documentValue('admin-created-draft', id, {active: false, publishedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()})));
    await assertSucceeds(direct(admin, 'admin-created-draft'));
    await assertSucceeds(edit(admin, 'fixture-admin', 'general-draft', {documentGroupId: restrictedId}));
    await assertFails(deleteDoc(doc(admin, 'documentGroups', generalId)));
    await assertFails(deleteDoc(doc(admin, 'documents', 'general-active')));
  });

  test('cadastro de grupo recusa listas excessivas, duplicadas, e-mail inválido e campo fora do esquema', async () => {
    const admin = dbFor('fixture-admin');
    const invalid = [
      {allowedEmails: Array.from({length: 101}, (_, i) => `member-${i}@example.invalid`)},
      {managerEmails: Array.from({length: 21}, (_, i) => `manager-${i}@example.invalid`)},
      {allowedEmails: ['same@example.invalid', 'same@example.invalid']},
      {managerEmails: ['same@example.invalid', 'same@example.invalid']},
      {allowedEmails: ['NOT-AN-EMAIL']}, {allowedEmails: ['Upper@example.invalid']},
      {managerEmails: ['no email']}, {accessMode: 'ALL_PUBLIC'}, {extraPermission: 'admin'}
    ];
    for (const [index, changes] of invalid.entries()) {
      const id = `invalid-group-${index}`;
      await assertFails(setDoc(doc(admin, 'documentGroups', id), group(id, {...changes, createdAt: serverTimestamp(), updatedAt: serverTimestamp()})));
    }
  });

  test('somente documentsManage/admin administra audiência; leitor e gestor local não escalam o próprio perfil', async () => {
    const reader = dbFor('fixture-both-reader', generalEmails[0]);
    const manager = dbFor('fixture-group-manager', 'group-manager@example.invalid');
    const docManager = dbFor('fixture-doc-manager');
    for (const db of [reader, manager]) {
      await assertFails(updateDoc(doc(db, 'documentGroups', generalId), {managerEmails: ['unlisted@example.invalid'], version: 2, updatedByUid: db === reader ? 'fixture-both-reader' : 'fixture-group-manager', updatedAt: serverTimestamp()}));
      await assertFails(setDoc(doc(db, 'documentGroups', 'forged-group'), group('forged-group', {createdAt: serverTimestamp(), updatedAt: serverTimestamp()})));
    }
    await assertFails(updateDoc(doc(manager, 'users', 'fixture-group-manager'), {role: 'administrador_app', permissions: {admin: true}}));
    await assertSucceeds(updateDoc(doc(docManager, 'documentGroups', generalId), {allowedEmails: ['other@example.invalid'], version: 2, updatedByUid: 'fixture-doc-manager', updatedAt: serverTimestamp()}));
  });

  test('legado de outra área conserva suas permissões e grupo não pode apontar para área diferente', async () => {
    const reader = dbFor('fixture-both-reader', generalEmails[0]);
    await assertSucceeds(direct(reader, 'legacy-other-area'));
    await assertSucceeds(getDocs(docsQuery(reader, '', {includeInactive: true, areaId: otherArea})));
    const admin = dbFor('fixture-admin');
    await assertFails(setDoc(doc(admin, 'documents', 'wrong-group-area'), documentValue('wrong-group-area', generalId, {managementAreaId: otherArea, publishedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()})));
    await assertFails(setDoc(doc(admin, 'documents', 'missing-group'), documentValue('missing-group', 'does-not-exist', {publishedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()})));
  });

  test('grupos com 55 gerais e 31 restritos passam pelo esquema de escrita, sem UID conhecido', async () => {
    const admin = dbFor('fixture-admin');
    for (const [id, allowedEmails, accessMode] of [['general-55-fixture', generalEmails, 'GENERAL'], ['restricted-31-fixture', restrictedEmails, 'RESTRICTED']]) {
      await assertSucceeds(setDoc(doc(admin, 'documentGroups', id), group(id, {allowedEmails, accessMode, createdAt: serverTimestamp(), updatedAt: serverTimestamp()})));
      const saved = (await getDoc(doc(admin, 'documentGroups', id))).data();
      assert.equal(saved.allowedEmails.length, allowedEmails.length);
    }
  });

  test('categoria de grupo pode mudar sem impedir manutenção de documento existente por gestor local', async () => {
    await seed('documentGroups', generalId, group(generalId, {category: 'Categoria renomeada'}));
    const manager = dbFor('fixture-group-manager', 'group-manager@example.invalid');
    await assertSucceeds(edit(manager, 'fixture-group-manager', 'general-draft', {title: 'Metadados revisados'}));
    const saved = (await direct(manager, 'general-draft')).data();
    assert.equal(saved.category, 'ACESSO GERAL');
    assert.equal(saved.documentGroupId, generalId);
  });

  test('administrador não remove a proteção de grupo existente; legado protegido já sem grupo pode receber revisão', async () => {
    const admin = dbFor('fixture-admin');
    await assertFails(edit(admin, 'fixture-admin', 'general-draft', {documentGroupId: deleteField()}));
    await assertFails(edit(admin, 'fixture-admin', 'general-draft', {documentGroupId: ''}));
    await assertSucceeds(edit(admin, 'fixture-admin', 'protected-ungrouped', {title: 'Legado preservado'}));
    const noGroup = documentValue('new-protected-without-group', '', {publishedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
    await assertFails(setDoc(doc(admin, 'documents', noGroup.id), noGroup));
  });

  test('leitor autorizado não edita metadados e visitante sem login não lê grupos nem documentos', async () => {
    const reader = dbFor('fixture-both-reader', generalEmails[0]);
    await assertFails(edit(reader, 'fixture-both-reader', 'general-active', {title: 'Tentativa de leitor'}));
    const anonymous = environment.unauthenticatedContext().firestore();
    await assertFails(direct(anonymous, 'general-active'));
    await assertFails(getDoc(doc(anonymous, 'documentGroups', generalId)));
    await assertFails(getDocs(docsQuery(anonymous, generalId)));
  });

  test('grupo inativo ou identidade não verificada bloqueiam gestor por e-mail', async () => {
    const manager = dbFor('fixture-group-manager', 'group-manager@example.invalid');
    await seed('documentGroups', generalId, group(generalId, {active: false}));
    await assertFails(direct(manager, 'general-draft'));
    await assertFails(edit(manager, 'fixture-group-manager', 'general-draft', {title: 'Grupo desativado'}));
    await seed('documentGroups', generalId, group(generalId));
    const unverifiedManager = dbFor('fixture-group-manager', 'group-manager@example.invalid', {email_verified: false});
    await assertFails(direct(unverifiedManager, 'general-draft'));
    await assertFails(edit(unverifiedManager, 'fixture-group-manager', 'general-draft', {title: 'Identidade não verificada'}));
  });
}
