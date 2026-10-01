import {readFile} from 'node:fs/promises';
import {after, before, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {and, doc, getAggregateFromServer, getDoc, getDocs, collection, deleteDoc, limit, orderBy, or, query, sum, where, setDoc, updateDoc, writeBatch, serverTimestamp, setLogLevel} from 'firebase/firestore';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {stageOperationalWrite} from '../src/record-write.js';

const projectId = 'demo-sahmt-v2';
let testEnvironment;
setLogLevel('silent');

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
    }
  });
});

beforeEach(async () => testEnvironment.clearFirestore());
after(async () => testEnvironment.cleanup());

function accessProfile(uid, permissions = {}, overrides = {}) {
  return {uid, email: `${uid}@example.invalid`, displayName: uid, sigla: '', phone: '', active: true, access: true, role: 'anestesiologista', permissions, createdAt: 'test', updatedAt: 'test', ...overrides};
}

function saoPauloDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

async function seedProfiles(profiles) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    for (const profile of profiles) await setDoc(doc(context.firestore(), 'users', profile.uid), profile);
  });
}

async function seedEventCatalog(payers = ['Membro'], creditors = ['Equipe']) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'eventCatalogs', 'operational'), {
      id: 'operational', payers, creditors,
      createdByUid: 'bootstrap', createdAt: new Date(), updatedByUid: 'bootstrap', updatedAt: new Date(), version: 1
    });
  });
}

function learningActivity(overrides = {}) {
  const now = Date.now();
  return {
    id: 'acknowledge-orientation', version: 1, title: 'Orientação', description: 'Confirme a leitura', category: 'Orientação',
    sourceKind: 'ACKNOWLEDGEMENT', resourceUrl: '', showInTraining: true, audienceType: 'ALL', audienceValue: '',
    startAt: new Date(now - 86_400_000), endAt: new Date(now + 86_400_000), status: 'ACTIVE',
    completionKind: 'ACKNOWLEDGEMENT', recurrenceMode: 'ONCE', order: 0,
    createdByUid: 'learning-admin', createdAt: new Date(), updatedByUid: 'learning-admin', updatedAt: new Date(),
    ...overrides
  };
}

async function setFirestoreRecord(db, resourceType, resourceId, record) {
  return setDoc(doc(db, resourceType, resourceId), record);
}

async function updateFirestoreRecord(db, resourceType, resourceId, updates) {
  return updateDoc(doc(db, resourceType, resourceId), updates);
}

async function updateLabelWithHistory(db, {labelId, label, uid, updates, changedFields, historyId}) {
  const version = label.version + 1;
  const batch = writeBatch(db);
  batch.update(doc(db, 'labels', labelId), {
    ...updates, updatedByUid: uid, updatedAt: serverTimestamp(), version
  });
  batch.set(doc(db, 'labels', labelId, 'history', historyId || String(version)), {
    id: historyId || String(version), labelId, version, actorUid: uid, changedFields,
    before: Object.fromEntries(changedFields.map((field) => [field, label[field]])),
    after: Object.fromEntries(changedFields.map((field) => [field, updates[field]])),
    createdAt: serverTimestamp()
  });
  return batch.commit();
}

async function updateEventWithHistory(db, {eventId, event, uid, updates, requestId}) {
  const version = event.version + 1;
  const changedFields = Object.keys(updates);
  const snapshotFields = ['date', 'memberSigla', 'scheduleSigla', 'memberStatus', 'eventType', 'description', 'delayMultiple', 'substitute', 'shift', 'payer', 'creditor', 'amountToPay', 'status'];
  const batch = writeBatch(db);
  batch.update(doc(db, 'events', eventId), {
    ...updates, updatedByName: uid, updatedByUid: uid, updatedAt: serverTimestamp(), version
  });
  batch.set(doc(db, 'events', eventId, 'history', String(version)), {
    id: String(version), eventId, version, requestId, actorUid: uid, actorName: uid, changedFields,
    before: Object.fromEntries(snapshotFields.map((field) => [field, event[field] ?? null])),
    after: Object.fromEntries(snapshotFields.map((field) => [field, (field in updates ? updates[field] : event[field]) ?? null])),
    createdAt: serverTimestamp()
  });
  return batch.commit();
}

test('usuário autenticado lê o próprio perfil, mas não o de outro UID', async () => {
  await seedProfiles([accessProfile('user-a'), accessProfile('user-b')]);
  const user = testEnvironment.authenticatedContext('user-a').firestore();
  await assertSucceeds(getDoc(doc(user, 'users', 'user-a')));
  await assertFails(getDoc(doc(user, 'users', 'user-b')));
});

test('identidade autenticada sem perfil V2 não recebe acesso por e-mail nem cria a própria autorização', async () => {
  await seedProfiles([accessProfile('provisioned', {eventsRead: true}, {email: 'shared@example.invalid'})]);
  const unprovisioned = testEnvironment.authenticatedContext('new-google-uid', {email: 'shared@example.invalid'}).firestore();
  await assertSucceeds(getDoc(doc(unprovisioned, 'users', 'new-google-uid')));
  await assertFails(getDoc(doc(unprovisioned, 'users', 'provisioned')));
  await assertFails(getDocs(collection(unprovisioned, 'events')));
  await assertFails(setDoc(doc(unprovisioned, 'events', 'forged'), {createdByUid: 'new-google-uid'}));
  await assertFails(setDoc(doc(unprovisioned, 'users', 'new-google-uid'), accessProfile('new-google-uid', {admin: true}, {role: 'administrador_app'})));
});

test('catálogo de contatos é consultável pela Home e editável somente por peopleManage', async () => {
  await seedProfiles([
    accessProfile('schedule-reader', {scheduleRead: true}),
    accessProfile('people-manager', {scheduleRead: true, peopleManage: true}),
    accessProfile('events-only', {eventsRead: true})
  ]);
  const reader = testEnvironment.authenticatedContext('schedule-reader').firestore();
  const manager = testEnvironment.authenticatedContext('people-manager').firestore();
  const unrelated = testEnvironment.authenticatedContext('events-only').firestore();
  const contact = {sigla: 'AB', name: 'Pessoa Teste', role: 'Anestesiologista', phone: '11999990000', email: 'pessoa@example.invalid', whatsAppLink: 'https://wa.me/5511999990000', crm: '12345', entryDate: '2020-01-01', active: true, createdByUid: 'people-manager', createdAt: new Date(), updatedByUid: 'people-manager', updatedAt: new Date()};
  await assertSucceeds(setDoc(doc(manager, 'contacts', 'AB'), contact));
  await assertSucceeds(getDoc(doc(reader, 'contacts', 'AB')));
  await assertSucceeds(getDocs(query(collection(reader, 'contacts'), where('active', '==', true))));
  await assertFails(getDocs(collection(unrelated, 'contacts')));
  await assertFails(setDoc(doc(reader, 'contacts', 'CD'), {...contact, sigla: 'CD'}));
  await assertFails(setDoc(doc(manager, 'contacts', 'wrong-id'), {...contact, sigla: 'CD'}));
  await assertFails(setDoc(doc(manager, 'contacts', 'EF'), {...contact, sigla: 'EF', whatsAppLink: 'javascript:alert(1)'}));
  await assertSucceeds(setDoc(doc(manager, 'contacts', 'AB'), {...contact, phone: '11988880000', updatedAt: new Date()}));
  await assertSucceeds(setDoc(doc(manager, 'contacts', 'AB'), {...contact, active: false, updatedAt: new Date()}));
  await assertFails(getDoc(doc(reader, 'contacts', 'AB')));
  await assertSucceeds(getDoc(doc(manager, 'contacts', 'AB')));
  await assertFails(deleteDoc(doc(manager, 'contacts', 'AB')));
});

test('áreas de Gestão não podem ser apagadas e continuam disponíveis após recusa', async () => {
  await seedProfiles([accessProfile('area-manager', {managementManage: true})]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-qualidade'), {
      id: 'area-qualidade', name: 'Gestão da Qualidade', active: true
    });
  });
  const manager = testEnvironment.authenticatedContext('area-manager').firestore();
  const areaRef = doc(manager, 'managementAreas', 'area-qualidade');
  await assertFails(deleteDoc(areaRef));
  await assert.equal((await assertSucceeds(getDoc(areaRef))).exists(), true);
});

test('qualityManage abre somente a área de Qualidade e permite seus indicadores e documentos', async () => {
  await seedProfiles([accessProfile('quality-manager', {qualityManage: true})]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'managementAreas', 'area-gestao-da-qualidade'), {id: 'area-gestao-da-qualidade', active: true, name: 'Gestão da Qualidade'});
    await setDoc(doc(db, 'managementAreas', 'area-gestao-financeira'), {id: 'area-gestao-financeira', active: true, name: 'Gestão Financeira'});
  });
  const manager = testEnvironment.authenticatedContext('quality-manager').firestore();
  await assertSucceeds(getDoc(doc(manager, 'managementAreas', 'area-gestao-da-qualidade')));
  await assertFails(getDoc(doc(manager, 'managementAreas', 'area-gestao-financeira')));
  await assertFails(getDocs(query(collection(manager, 'managementAreas'), where('active', '==', true))));

  await assertSucceeds(setDoc(doc(manager, 'indicators', 'quality-indicator'), {
    id: 'quality-indicator', managementAreaId: 'area-gestao-da-qualidade', name: 'Aderência a protocolos', description: '', unit: '%',
    target: 95, direction: 'MIN', frequency: 'MONTHLY', ownerUid: 'quality-manager', active: true,
    createdByUid: 'quality-manager', createdAt: serverTimestamp(), updatedByUid: 'quality-manager', updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(manager, 'indicators', 'finance-indicator'), {
    id: 'finance-indicator', managementAreaId: 'area-gestao-financeira', name: 'Indicador financeiro', description: '', unit: 'R$',
    target: 100, direction: 'MAX', frequency: 'MONTHLY', ownerUid: 'quality-manager', active: true,
    createdByUid: 'quality-manager', createdAt: serverTimestamp(), updatedByUid: 'quality-manager', updatedAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(manager, 'documents', 'quality-protocol-1'), {
    id: 'quality-protocol-1', managementAreaId: 'area-gestao-da-qualidade', title: 'Protocolo institucional', description: '',
    driveFileId: 'abcdefghij', driveUrl: 'https://drive.google.com/file/d/abcdefghij/view', version: 1, category: 'Protocolo',
    active: true, publishedAt: serverTimestamp(), requiredReading: false, createdByUid: 'quality-manager', createdAt: serverTimestamp(),
    updatedByUid: 'quality-manager', updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(manager, 'documents', 'finance-document-1'), {
    id: 'finance-document-1', managementAreaId: 'area-gestao-financeira', title: 'Documento financeiro', description: '',
    driveFileId: 'abcdefghijk', driveUrl: 'https://drive.google.com/file/d/abcdefghijk/view', version: 1, category: 'Financeiro',
    active: true, publishedAt: serverTimestamp(), requiredReading: false, createdByUid: 'quality-manager', createdAt: serverTimestamp(),
    updatedByUid: 'quality-manager', updatedAt: serverTimestamp()
  }));
});

test('gestor autorizado atualiza vínculos de gestores/equipe com versão e escopo de campos', async () => {
  await seedProfiles([
    accessProfile('area-owner', {managementManage: true}),
    accessProfile('area-reader', {managementRead: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-team'), {
      id: 'area-team', name: 'Gestão Operacional', active: true, managerUids: [], memberUids: [], version: 1,
      createdByUid: 'bootstrap', createdAt: new Date(), updatedByUid: 'bootstrap', updatedAt: new Date()
    });
  });
  const owner = testEnvironment.authenticatedContext('area-owner').firestore();
  const reader = testEnvironment.authenticatedContext('area-reader').firestore();
  const reference = doc(owner, 'managementAreas', 'area-team');
  await assertSucceeds(updateDoc(reference, {
    managerUids: ['manager-uid'], memberUids: ['member-uid'], version: 2,
    updatedByUid: 'area-owner', updatedAt: serverTimestamp()
  }));
  await assert.equal((await assertSucceeds(getDoc(reference))).data().memberUids[0], 'member-uid');
  await assertFails(updateDoc(reference, {
    managerUids: [], memberUids: [], version: 2,
    updatedByUid: 'area-owner', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(reference, {
    managerUids: Array.from({length: 101}, (_, index) => `uid-${index}`), memberUids: ['member-uid'], version: 3,
    updatedByUid: 'area-owner', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(reference, {
    name: 'Alteração fora do fluxo de vínculos', managerUids: ['manager-uid'], memberUids: ['member-uid'], version: 3,
    updatedByUid: 'area-owner', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(reader, 'managementAreas', 'area-team'), {
    managerUids: [], memberUids: [], version: 3, updatedByUid: 'area-reader', updatedAt: serverTimestamp()
  }));
});

test('documentos de Gestão guardam metadados do Drive, validam o link e preservam versão e autoria', async () => {
  await seedProfiles([
    accessProfile('document-manager', {documentsManage: true}),
    accessProfile('document-reader', {managementRead: true}),
    accessProfile('document-unrelated', {eventsRead: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-documents'), {id: 'area-documents', active: true, name: 'Gestão de Documentos'});
  });
  const manager = testEnvironment.authenticatedContext('document-manager').firestore();
  const reader = testEnvironment.authenticatedContext('document-reader').firestore();
  const unrelated = testEnvironment.authenticatedContext('document-unrelated').firestore();
  const fileId = 'DriveFile_A1234567';
  const reference = doc(manager, 'documents', 'document-0001');
  const metadata = {
    id: 'document-0001', managementAreaId: 'area-documents', title: 'Protocolo de segurança', description: 'Versão vigente',
    driveFileId: fileId, driveUrl: `https://drive.google.com/file/d/${fileId}/view`, version: 1, category: 'Protocolo',
    active: true, publishedAt: serverTimestamp(), requiredReading: true, createdByUid: 'document-manager', createdAt: serverTimestamp(),
    updatedByUid: 'document-manager', updatedAt: serverTimestamp()
  };
  await assertSucceeds(getDocs(query(collection(manager, 'managementAreas'), where('active', '==', true))));
  await assertSucceeds(setDoc(reference, metadata));
  await assertSucceeds(getDocs(query(collection(reader, 'documents'), where('managementAreaId', '==', 'area-documents'), where('active', '==', true))));
  await assertFails(getDocs(collection(unrelated, 'documents')));
  await assertFails(setDoc(doc(manager, 'documents', 'document-0002'), {...metadata, id: 'document-0002', driveUrl: 'https://example.com/file'}));
  await assertFails(setDoc(doc(manager, 'documents', 'document-0003'), {...metadata, id: 'document-0003', driveFileId: 'anotherFile_A1234567'}));
  await assertSucceeds(updateDoc(reference, {title: 'Protocolo atualizado', version: 2, updatedByUid: 'document-manager', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(reference, {title: 'Sobrescrever versão', version: 2, updatedByUid: 'document-manager', updatedAt: serverTimestamp()}));
  await assertFails(deleteDoc(reference));
});

test('Equipamentos valida cadastro, exige evento atômico para mudança de situação e mantém histórico de manutenção', async () => {
  await seedProfiles([accessProfile('equipment-manager', {equipmentManage: true}), accessProfile('equipment-unrelated', {eventsRead: true})]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-gestao-de-equipamentos'), {id: 'area-gestao-de-equipamentos', active: true, name: 'Gestão de Equipamentos'});
  });
  const manager = testEnvironment.authenticatedContext('equipment-manager').firestore();
  const unrelated = testEnvironment.authenticatedContext('equipment-unrelated').firestore();
  const equipmentRef = doc(manager, 'equipment', 'ASSET_01');
  const equipment = {
    id: 'ASSET_01', tag: 'ASSET_01', managementAreaId: 'area-gestao-de-equipamentos', name: 'Monitor', category: 'Monitorização',
    serialNumber: '', location: 'Sala 1', responsibleUid: 'equipment-manager', status: 'OPERATIONAL', active: true,
    lastEventId: null, lastEventAt: null, version: 1, createdByUid: 'equipment-manager', createdAt: serverTimestamp(),
    updatedByUid: 'equipment-manager', updatedAt: serverTimestamp()
  };
  await assertSucceeds(getDocs(query(collection(manager, 'managementAreas'), where('active', '==', true))));
  await assertSucceeds(setDoc(equipmentRef, equipment));
  await assertSucceeds(getDocs(query(collection(manager, 'equipment'), where('managementAreaId', '==', 'area-gestao-de-equipamentos'))));
  await assertFails(getDocs(collection(unrelated, 'equipment')));
  await assertSucceeds(updateDoc(equipmentRef, {name: 'Monitor de transporte', version: 2, updatedByUid: 'equipment-manager', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(equipmentRef, {status: 'OUT_OF_SERVICE', version: 3, updatedByUid: 'equipment-manager', updatedAt: serverTimestamp()}));

  const eventId = 'equipment-event-0001';
  const change = writeBatch(manager);
  change.update(equipmentRef, {status: 'MAINTENANCE', active: true, lastEventId: eventId, lastEventAt: serverTimestamp(), version: 3, updatedByUid: 'equipment-manager', updatedAt: serverTimestamp()});
  change.set(doc(manager, 'equipmentEvents', eventId), {
    id: eventId, equipmentId: 'ASSET_01', managementAreaId: 'area-gestao-de-equipamentos', type: 'STATUS_CHANGE',
    description: 'Iniciada manutenção preventiva', fromStatus: 'OPERATIONAL', toStatus: 'MAINTENANCE',
    createdByUid: 'equipment-manager', createdAt: serverTimestamp()
  });
  await assertSucceeds(change.commit());
  await assertFails(updateDoc(doc(manager, 'equipmentEvents', eventId), {description: 'Alterado'}));
  await assertFails(deleteDoc(doc(manager, 'equipmentEvents', eventId)));

  const maintenanceRef = doc(manager, 'maintenanceRecords', 'maintenance-record-001');
  const maintenance = {
    id: 'maintenance-record-001', equipmentId: 'ASSET_01', managementAreaId: 'area-gestao-de-equipamentos', type: 'PREVENTIVE',
    description: 'Revisão elétrica', responsibleUid: 'equipment-manager', dueAt: '2026-10-10', status: 'OPEN', completedAt: null,
    version: 1, createdByUid: 'equipment-manager', createdAt: serverTimestamp(), updatedByUid: 'equipment-manager', updatedAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(maintenanceRef, maintenance));
  await assertSucceeds(updateDoc(maintenanceRef, {status: 'IN_PROGRESS', completedAt: null, version: 2, updatedByUid: 'equipment-manager', updatedAt: serverTimestamp()}));
  await assertSucceeds(updateDoc(maintenanceRef, {status: 'COMPLETED', completedAt: serverTimestamp(), version: 3, updatedByUid: 'equipment-manager', updatedAt: serverTimestamp()}));
  await assertFails(deleteDoc(maintenanceRef));
});

test('atividade de Gestão tem responsável próprio e ciclo de estado validado pelo servidor', async () => {
  await seedProfiles([
    accessProfile('activity-owner', {managementActivityWrite: true}),
    accessProfile('activity-peer', {managementRead: true, managementActivityWrite: true}),
    accessProfile('activity-observer', {managementActivityWrite: true}),
    accessProfile('activity-manager', {managementManage: true, managementRead: true, managementActivityWrite: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-1'), {active: true, name: 'Qualidade', memberUids: ['activity-owner', 'activity-peer', 'activity-observer']});
  });
  const owner = testEnvironment.authenticatedContext('activity-owner').firestore();
  const peer = testEnvironment.authenticatedContext('activity-peer').firestore();
  const observer = testEnvironment.authenticatedContext('activity-observer').firestore();
  const manager = testEnvironment.authenticatedContext('activity-manager').firestore();
  await assertSucceeds(getDocs(collection(owner, 'managementAreas')));
  const activityRef = doc(owner, 'activities', 'task-1');
  const activity = {
    title: 'Revisar fluxo', description: '', contextType: 'MANAGEMENT_AREA', contextId: 'area-1', managementAreaId: 'area-1',
    type: 'TASK', status: 'OPEN', priority: 'Normal', responsibleUids: ['activity-owner'], participantUids: [],
    createdByUid: 'activity-owner', createdAt: serverTimestamp(), dueAt: null, completedAt: null,
    evidenceRequired: false, pointsEnabled: false, points: 0, scoringRuleId: '', scoringRuleVersion: 0, visibility: 'AREA', active: true,
    id: 'task-1', clientMutationId: 'task-1', updatedByUid: 'activity-owner', updatedAt: serverTimestamp(), version: 1
  };
  const activityBatch = writeBatch(owner);
  stageOperationalWrite(activityBatch, {
    collectionName: 'activities', data: {
      title: activity.title, description: activity.description, contextType: activity.contextType,
      contextId: activity.contextId, managementAreaId: activity.managementAreaId, type: activity.type,
      status: activity.status, priority: activity.priority, responsibleUids: activity.responsibleUids,
      participantUids: activity.participantUids, dueAt: activity.dueAt, completedAt: activity.completedAt,
      evidenceRequired: activity.evidenceRequired, pointsEnabled: activity.pointsEnabled,
      points: activity.points, scoringRuleId: activity.scoringRuleId, scoringRuleVersion: activity.scoringRuleVersion, visibility: activity.visibility
    },
    uid: 'activity-owner', requestId: 'task-1', now: serverTimestamp(),
    recordRef: activityRef
  });
  await assertSucceeds(activityBatch.commit());
  await assertSucceeds(getDocs(collection(owner, 'activities')));
  await assertFails(setDoc(doc(owner, 'activities', 'forged-points'), {...activity, id: 'forged-points', clientMutationId: 'forged-points', pointsEnabled: true, points: 50}));
  await assertFails(setDoc(doc(owner, 'activities', 'forged-owner'), {...activity, id: 'forged-owner', clientMutationId: 'forged-owner', responsibleUids: ['activity-peer']}));
  await assertFails(setDoc(doc(owner, 'activities', 'forged-area'), {...activity, id: 'forged-area', clientMutationId: 'forged-area', managementAreaId: 'inactive-area', contextId: 'inactive-area'}));
  await assertFails(updateDoc(doc(peer, 'activities', 'task-1'), {status: 'IN_PROGRESS', updatedByUid: 'activity-peer', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(activityRef, {status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: 'activity-owner', updatedAt: serverTimestamp()}));
  await assertSucceeds(updateDoc(activityRef, {status: 'IN_PROGRESS', updatedByUid: 'activity-owner', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(activityRef, {status: 'CANCELLED', updatedByUid: 'activity-owner', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(activityRef, {points: 100, updatedByUid: 'activity-owner', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(activityRef, {status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: 'activity-owner', updatedAt: serverTimestamp()}));
  await assertFails(deleteDoc(activityRef));

  const teamActivity = {...activity, id: 'team-task-1', clientMutationId: 'team-task-1', createdByUid: 'activity-manager', updatedByUid: 'activity-manager', responsibleUids: ['activity-owner', 'activity-peer'], participantUids: ['activity-observer']};
  const teamRef = doc(manager, 'activities', teamActivity.id);
  const teamBatch = writeBatch(manager);
  stageOperationalWrite(teamBatch, {
    collectionName: 'activities', data: {
      title: teamActivity.title, description: teamActivity.description, contextType: teamActivity.contextType,
      contextId: teamActivity.contextId, managementAreaId: teamActivity.managementAreaId, type: teamActivity.type,
      status: teamActivity.status, priority: teamActivity.priority, responsibleUids: teamActivity.responsibleUids,
      participantUids: teamActivity.participantUids, dueAt: teamActivity.dueAt, completedAt: teamActivity.completedAt,
      evidenceRequired: teamActivity.evidenceRequired, pointsEnabled: teamActivity.pointsEnabled,
      points: teamActivity.points, scoringRuleId: teamActivity.scoringRuleId, scoringRuleVersion: teamActivity.scoringRuleVersion, visibility: teamActivity.visibility
    }, uid: 'activity-manager', requestId: teamActivity.id, now: serverTimestamp(), recordRef: teamRef
  });
  await assertSucceeds(teamBatch.commit());
  await assertSucceeds(updateDoc(doc(peer, 'activities', teamActivity.id), {status: 'IN_PROGRESS', updatedByUid: 'activity-peer', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(doc(observer, 'activities', teamActivity.id), {status: 'IN_PROGRESS', updatedByUid: 'activity-observer', updatedAt: serverTimestamp()}));
  await assertFails(setDoc(doc(manager, 'activities', 'team-task-outsider-participant'), {
    ...teamActivity, id: 'team-task-outsider-participant', clientMutationId: 'team-task-outsider-participant', participantUids: ['not-an-area-member']
  }));
  await assertSucceeds(setDoc(doc(owner, 'activityInteractions', 'team-owner-comment'), {
    id: 'team-owner-comment', activityId: teamActivity.id, uid: 'activity-owner', type: 'COMMENT', content: 'Iniciei a revisão.',
    createdAt: serverTimestamp(), evidence: null, pointsGenerated: 0
  }));
  await assertSucceeds(setDoc(doc(observer, 'activityInteractions', 'team-participant-comment'), {
    id: 'team-participant-comment', activityId: teamActivity.id, uid: 'activity-observer', type: 'COMMENT', content: 'Vou revisar o protocolo.',
    createdAt: serverTimestamp(), evidence: null, pointsGenerated: 0
  }));
  await assertSucceeds(getDocs(query(collection(observer, 'activityInteractions'), where('activityId', '==', teamActivity.id), orderBy('createdAt', 'desc'))));
  const outsiderTeamActivity = {...teamActivity, id: 'team-task-outsider', clientMutationId: 'team-task-outsider', responsibleUids: ['activity-owner', 'not-an-area-member']};
  const outsiderBatch = writeBatch(manager);
  stageOperationalWrite(outsiderBatch, {
    collectionName: 'activities', data: {
      title: outsiderTeamActivity.title, description: outsiderTeamActivity.description, contextType: outsiderTeamActivity.contextType,
      contextId: outsiderTeamActivity.contextId, managementAreaId: outsiderTeamActivity.managementAreaId, type: outsiderTeamActivity.type,
      status: outsiderTeamActivity.status, priority: outsiderTeamActivity.priority, responsibleUids: outsiderTeamActivity.responsibleUids,
      participantUids: outsiderTeamActivity.participantUids, dueAt: outsiderTeamActivity.dueAt, completedAt: outsiderTeamActivity.completedAt,
      evidenceRequired: outsiderTeamActivity.evidenceRequired, pointsEnabled: outsiderTeamActivity.pointsEnabled,
      points: outsiderTeamActivity.points, scoringRuleId: outsiderTeamActivity.scoringRuleId, scoringRuleVersion: outsiderTeamActivity.scoringRuleVersion, visibility: outsiderTeamActivity.visibility
    }, uid: 'activity-manager', requestId: outsiderTeamActivity.id, now: serverTimestamp(), recordRef: doc(manager, 'activities', outsiderTeamActivity.id)
  });
  await assertFails(outsiderBatch.commit());
});

test('regra de pontuação de tarefas é exclusiva de Gestão, versionada e não pode ser apagada', async () => {
  await seedProfiles([
    accessProfile('scoring-manager', {managementManage: true, managementRead: true, managementActivityWrite: true}),
    accessProfile('scoring-member', {managementActivityWrite: true}),
    accessProfile('scoring-peer', {managementActivityWrite: true})
  ]);
  const manager = testEnvironment.authenticatedContext('scoring-manager').firestore();
  const member = testEnvironment.authenticatedContext('scoring-member').firestore();
  const ruleRef = doc(manager, 'scoringRules', 'management-task-completion-v1');
  const rule = {
    id: 'management-task-completion-v1', name: 'Conclusão de tarefa', description: '',
    sourceType: 'MANAGEMENT_TASK_COMPLETION', points: 10, active: true, version: 1,
    createdByUid: 'scoring-manager', createdAt: serverTimestamp(),
    updatedByUid: 'scoring-manager', updatedAt: serverTimestamp()
  };
  await assertFails(setDoc(doc(member, 'scoringRules', rule.id), {...rule, createdByUid: 'scoring-member', updatedByUid: 'scoring-member'}));
  await assertSucceeds(setDoc(ruleRef, rule));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-scoring'), {
      active: true, name: 'Qualidade', memberUids: ['scoring-member', 'scoring-peer']
    });
  });
  const task = {
    title: 'Revisar protocolo', description: '', contextType: 'MANAGEMENT_AREA', contextId: 'area-scoring',
    managementAreaId: 'area-scoring', type: 'TASK', status: 'OPEN', priority: 'Normal',
    responsibleUids: ['scoring-member'], participantUids: [], createdByUid: 'scoring-manager',
    createdAt: serverTimestamp(), dueAt: null, completedAt: null, evidenceRequired: false,
    pointsEnabled: true, points: 10, scoringRuleId: rule.id, scoringRuleVersion: 1, visibility: 'AREA',
    active: true, id: 'snapshot-task', clientMutationId: 'snapshot-task',
    updatedByUid: 'scoring-manager', updatedAt: serverTimestamp(), version: 1
  };
  const taskRef = doc(manager, 'activities', task.id);
  await assertSucceeds(setDoc(taskRef, task));
  await assertFails(setDoc(doc(manager, 'activities', 'multi-scored-task'), {
    ...task, id: 'multi-scored-task', clientMutationId: 'multi-scored-task',
    responsibleUids: ['scoring-member', 'scoring-peer'], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(ruleRef, {points: 12, version: 2, updatedByUid: 'scoring-manager', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(ruleRef, {points: 15, version: 4, updatedByUid: 'scoring-manager', updatedAt: serverTimestamp()}));
  const savedTask = (await getDoc(doc(member, 'activities', task.id))).data();
  assert.equal(savedTask.scoringRuleVersion, 1);
  assert.equal(savedTask.points, 10);
  await assertFails(setDoc(doc(manager, 'activities', 'stale-rule-task'), {
    ...task, id: 'stale-rule-task', clientMutationId: 'stale-rule-task', version: 1,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedByUid: 'scoring-manager'
  }));
  await assertFails(deleteDoc(ruleRef));
});

test('indicadores de Gestão só aceitam medições ligadas à meta e ao período', async () => {
  await seedProfiles([
    accessProfile('indicator-writer', {managementIndicatorsWrite: true}),
    accessProfile('indicator-reader', {managementRead: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-1'), {active: true, name: 'Qualidade'});
  });
  const writer = testEnvironment.authenticatedContext('indicator-writer').firestore();
  const reader = testEnvironment.authenticatedContext('indicator-reader').firestore();
  const indicator = {id: 'indicator-1', managementAreaId: 'area-1', name: 'Adesão ao protocolo', description: '', unit: '%', target: 90, direction: 'MIN', frequency: 'MONTHLY', ownerUid: 'indicator-writer', active: true, createdByUid: 'indicator-writer', createdAt: serverTimestamp(), updatedByUid: 'indicator-writer', updatedAt: serverTimestamp()};
  await assertSucceeds(setDoc(doc(writer, 'indicators', 'indicator-1'), indicator));
  await assertSucceeds(getDoc(doc(reader, 'indicators', 'indicator-1')));
  await assertFails(getDocs(collection(writer, 'activities')));
  const measurement = {id: 'measure-1', indicatorId: 'indicator-1', period: '2026-09', value: 92, target: 90, status: 'MET', notes: '', createdByUid: 'indicator-writer', createdAt: serverTimestamp()};
  await assertSucceeds(setDoc(doc(writer, 'indicatorMeasurements', 'measure-1'), measurement));
  await assertFails(setDoc(doc(writer, 'indicatorMeasurements', 'wrong-target'), {...measurement, id: 'wrong-target', target: 80}));
  await assertFails(setDoc(doc(writer, 'indicatorMeasurements', 'wrong-status'), {...measurement, id: 'wrong-status', status: 'NOT_MET'}));
  await assertFails(setDoc(doc(writer, 'indicatorMeasurements', 'wrong-period'), {...measurement, id: 'wrong-period', period: '2026-W39'}));
  await assertFails(setDoc(doc(reader, 'indicatorMeasurements', 'reader-write'), {...measurement, id: 'reader-write', createdByUid: 'indicator-reader'}));
  await assertFails(updateDoc(doc(writer, 'indicatorMeasurements', 'measure-1'), {value: 95}));
  await assertFails(deleteDoc(doc(writer, 'indicatorMeasurements', 'measure-1')));
});

test('plano de ação pertence ao responsável e segue transição imutável', async () => {
  await seedProfiles([
    accessProfile('plan-owner', {managementRead: true, managementPlansManage: true}),
    accessProfile('plan-peer', {managementRead: true, managementPlansManage: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-1'), {active: true, name: 'Qualidade'});
  });
  const owner = testEnvironment.authenticatedContext('plan-owner').firestore();
  const peer = testEnvironment.authenticatedContext('plan-peer').firestore();
  const plan = {id: 'plan-1', managementAreaId: 'area-1', origin: 'MANAGEMENT_AREA', title: 'Revisar protocolo', description: '', responsibleUid: 'plan-owner', participantUids: [], status: 'OPEN', priority: 'Alta', openedAt: serverTimestamp(), dueAt: null, completedAt: null, createdByUid: 'plan-owner', createdAt: serverTimestamp(), updatedByUid: 'plan-owner', updatedAt: serverTimestamp(), version: 1};
  await assertSucceeds(setDoc(doc(owner, 'actionPlans', 'plan-1'), plan));
  await assertFails(updateDoc(doc(peer, 'actionPlans', 'plan-1'), {status: 'IN_PROGRESS', updatedByUid: 'plan-peer', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(doc(owner, 'actionPlans', 'plan-1'), {status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: 'plan-owner', updatedAt: serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(owner, 'actionPlans', 'plan-1'), {status: 'IN_PROGRESS', updatedByUid: 'plan-owner', updatedAt: serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(owner, 'actionPlans', 'plan-1'), {status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: 'plan-owner', updatedAt: serverTimestamp()}));
  await assertFails(deleteDoc(doc(owner, 'actionPlans', 'plan-1')));
});

test('itens do plano pertencem ao responsável, registram conclusão versionada e não aceitam evidência do cliente', async () => {
  await seedProfiles([
    accessProfile('item-owner', {managementRead: true, managementPlansManage: true}),
    accessProfile('item-peer', {managementRead: true, managementPlansManage: true}),
    accessProfile('item-outsider', {eventsRead: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'managementAreas', 'area-item'), {active: true, name: 'Qualidade', memberUids: ['item-owner', 'item-peer']});
    await setDoc(doc(context.firestore(), 'actionPlans', 'plan-item'), {
      id: 'plan-item', managementAreaId: 'area-item', origin: 'MANAGEMENT_AREA', title: 'Plano de qualidade', description: '',
      responsibleUid: 'item-owner', participantUids: [], status: 'OPEN', priority: 'Alta', openedAt: new Date(), dueAt: null,
      completedAt: null, createdByUid: 'item-owner', createdAt: new Date(), updatedByUid: 'item-owner', updatedAt: new Date(), version: 1
    });
  });
  const owner = testEnvironment.authenticatedContext('item-owner').firestore();
  const peer = testEnvironment.authenticatedContext('item-peer').firestore();
  const outsider = testEnvironment.authenticatedContext('item-outsider').firestore();
  const item = {
    id: 'plan-item-1', planId: 'plan-item', description: 'Revisar checklist do carrinho', responsibleUids: ['item-owner'],
    dueAt: '2026-10-01', status: 'OPEN', evidence: null, completedAt: null,
    createdByUid: 'item-owner', createdAt: serverTimestamp(), updatedByUid: 'item-owner', updatedAt: serverTimestamp(), version: 1
  };
  await assertSucceeds(setDoc(doc(owner, 'actionPlanItems', 'plan-item-1'), item));
  await assertFails(setDoc(doc(peer, 'actionPlanItems', 'peer-item'), {...item, id: 'peer-item', createdByUid: 'item-peer', updatedByUid: 'item-peer', responsibleUids: ['item-peer']}));
  await assertFails(setDoc(doc(owner, 'actionPlanItems', 'item-outsider'), {...item, id: 'item-outsider', responsibleUids: ['item-owner', 'item-outsider']}));
  await assertFails(setDoc(doc(owner, 'actionPlanItems', 'forged-evidence'), {...item, id: 'forged-evidence', evidence: 'https://example.invalid/evidence'}));
  await assertFails(getDocs(collection(outsider, 'actionPlanItems')));
  await assertSucceeds(getDocs(query(collection(owner, 'actionPlanItems'), where('planId', 'in', ['plan-item']))));
  await assertSucceeds(updateDoc(doc(owner, 'actionPlanItems', 'plan-item-1'), {
    status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: 'item-owner', updatedAt: serverTimestamp(), version: 2
  }));
  const teamItem = {...item, id: 'plan-item-team', responsibleUids: ['item-owner', 'item-peer']};
  await assertSucceeds(setDoc(doc(owner, 'actionPlanItems', teamItem.id), teamItem));
  await assertSucceeds(updateDoc(doc(peer, 'actionPlanItems', teamItem.id), {
    status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: 'item-peer', updatedAt: serverTimestamp(), version: 2
  }));
  await assertFails(updateDoc(doc(owner, 'actionPlanItems', teamItem.id), {
    status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: 'item-owner', updatedAt: serverTimestamp(), version: 2
  }));
  await assertFails(updateDoc(doc(owner, 'actionPlanItems', 'plan-item-1'), {status: 'OPEN', completedAt: null, version: 3, updatedByUid: 'item-owner', updatedAt: serverTimestamp()}));
  await assertFails(deleteDoc(doc(owner, 'actionPlanItems', 'plan-item-1')));
});

test('interações exigem vínculo com atividade e não concedem pontos nem evidência', async () => {
  await seedProfiles([
    accessProfile('interaction-owner', {managementActivityWrite: true}),
    accessProfile('interaction-reader', {managementRead: true}),
    accessProfile('interaction-participant', {managementActivityWrite: true}),
    accessProfile('interaction-outsider', {eventsRead: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'activities', 'task-1'), {
      id: 'task-1', active: true, createdByUid: 'interaction-owner', responsibleUids: ['interaction-owner'], participantUids: ['interaction-participant'], status: 'OPEN'
    });
  });
  const owner = testEnvironment.authenticatedContext('interaction-owner').firestore();
  const manager = testEnvironment.authenticatedContext('interaction-reader').firestore();
  const participant = testEnvironment.authenticatedContext('interaction-participant').firestore();
  const outsider = testEnvironment.authenticatedContext('interaction-outsider').firestore();
  const interaction = {id: 'comment-1', activityId: 'task-1', uid: 'interaction-owner', type: 'COMMENT', content: 'Revisão iniciada.', createdAt: serverTimestamp(), evidence: null, pointsGenerated: 0};
  await assertSucceeds(setDoc(doc(owner, 'activityInteractions', 'comment-1'), interaction));
  await assertSucceeds(setDoc(doc(participant, 'activityInteractions', 'comment-participant'), {
    ...interaction, id: 'comment-participant', uid: 'interaction-participant', content: 'Revisarei a ação.'
  }));
  const ownComments = query(collection(owner, 'activityInteractions'), where('activityId', '==', 'task-1'), where('uid', '==', 'interaction-owner'), orderBy('createdAt', 'desc'));
  const allComments = query(collection(manager, 'activityInteractions'), where('activityId', '==', 'task-1'), orderBy('createdAt', 'desc'));
  await assertSucceeds(getDocs(ownComments));
  await assertSucceeds(getDocs(allComments));
  await assertSucceeds(getDocs(query(collection(participant, 'activityInteractions'), where('activityId', '==', 'task-1'), orderBy('createdAt', 'desc'))));
  await assertFails(getDocs(collection(outsider, 'activityInteractions')));
  await assertFails(setDoc(doc(owner, 'activityInteractions', 'forged-points'), {...interaction, id: 'forged-points', pointsGenerated: 10}));
  await assertFails(setDoc(doc(owner, 'activityInteractions', 'forged-evidence'), {...interaction, id: 'forged-evidence', evidence: 'https://example.invalid/file'}));
  await assertFails(setDoc(doc(owner, 'activityInteractions', 'missing-activity'), {...interaction, id: 'missing-activity', activityId: 'missing'}));
  await assertFails(updateDoc(doc(owner, 'activityInteractions', 'comment-1'), {content: 'alterado'}));
  await assertFails(deleteDoc(doc(owner, 'activityInteractions', 'comment-1')));
});

test('notificações são lidas somente pelo público-alvo e suportam grupos/áreas autorizados', async () => {
  await seedProfiles([
    accessProfile('notice-recipient', {notificationsRead: true}, {role: 'gestor', sigla: 'AB'}),
    accessProfile('notice-other', {notificationsRead: true}, {role: 'residente', sigla: 'CD'}),
    accessProfile('notice-manager', {notificationsManage: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'managementAreas', 'area-1'), {active: true, managerUids: ['notice-recipient'], memberUids: []});
    await setDoc(doc(db, 'notificationGroups', 'group-1'), {id: 'group-1', name: 'Plantão A', memberUids: ['notice-recipient'], active: true});
    const base = {title: 'Comunicado', message: 'Conteúdo do comunicado.', type: 'INFO', createdAt: new Date(), createdByUid: 'notice-manager', startAt: new Date('2026-09-01T00:00:00Z'), endAt: new Date('2026-10-01T00:00:00Z'), active: true, priority: 2, actionRoute: ''};
    const notices = [
      ['all', 'ALL', ''], ['role-ok', 'ROLE', 'gestor'], ['role-no', 'ROLE', 'residente'],
      ['user-ok', 'USER', 'notice-recipient'], ['user-no', 'USER', 'notice-other'],
      ['sigla-ok', 'SIGLA', 'AB'], ['sigla-no', 'SIGLA', 'CD'],
      ['area-ok', 'MANAGEMENT_AREA', 'area-1'], ['group-ok', 'GROUP', 'group-1']
    ];
    for (const [id, audienceType, audienceValue] of notices) await setDoc(doc(db, 'notifications', id), {...base, id, audienceType, audienceValue});
  });
  const recipient = testEnvironment.authenticatedContext('notice-recipient').firestore();
  const other = testEnvironment.authenticatedContext('notice-other').firestore();
  const manager = testEnvironment.authenticatedContext('notice-manager').firestore();
  for (const id of ['all', 'role-ok', 'user-ok', 'sigla-ok', 'area-ok', 'group-ok']) await assertSucceeds(getDoc(doc(recipient, 'notifications', id)));
  for (const id of ['role-no', 'user-no', 'sigla-no']) await assertFails(getDoc(doc(recipient, 'notifications', id)));
  await assertSucceeds(getDoc(doc(other, 'notifications', 'role-no')));
  await assertFails(getDoc(doc(other, 'notifications', 'user-ok')));
  await assertFails(getDocs(collection(recipient, 'notifications')));
  const recipientRoleQuery = query(collection(recipient, 'notifications'), where('active', '==', true), where('audienceType', '==', 'ROLE'), where('audienceValue', '==', 'gestor'), orderBy('priority', 'desc'));
  await assertSucceeds(getDocs(recipientRoleQuery));
  const combinedAudienceQuery = query(collection(recipient, 'notifications'), and(where('active', '==', true), or(
    and(where('audienceType', '==', 'ALL'), where('audienceValue', '==', '')),
    and(where('audienceType', '==', 'USER'), where('audienceValue', '==', 'notice-recipient')),
    and(where('audienceType', '==', 'ROLE'), where('audienceValue', '==', 'gestor')),
    and(where('audienceType', '==', 'SIGLA'), where('audienceValue', '==', 'AB')),
    and(where('audienceType', '==', 'MANAGEMENT_AREA'), where('audienceValue', '==', 'area-1')),
    and(where('audienceType', '==', 'GROUP'), where('audienceValue', '==', 'group-1'))
  )), orderBy('priority', 'desc'));
  await assertSucceeds(getDocs(combinedAudienceQuery));
  await assertSucceeds(getDocs(collection(manager, 'notifications')));
  const newNotice = {id: 'created', title: 'Novo', message: 'Para todos.', type: 'INFO', audienceType: 'ALL', audienceValue: '', createdAt: serverTimestamp(), createdByUid: 'notice-manager', updatedByUid: 'notice-manager', updatedAt: serverTimestamp(), startAt: new Date('2026-09-24T00:00:00Z'), endAt: new Date('2026-10-01T00:00:00Z'), active: true, priority: 1, actionRoute: 'home', version: 1};
  await assertSucceeds(setDoc(doc(manager, 'notifications', 'created'), newNotice));
  await assertFails(setDoc(doc(recipient, 'notifications', 'forged'), {...newNotice, id: 'forged', createdByUid: 'notice-recipient', updatedByUid: 'notice-recipient'}));
  await assertFails(setDoc(doc(manager, 'notifications', 'bad-route'), {...newNotice, id: 'bad-route', actionRoute: 'javascript:alert(1)'}));
});

test('confirmação de leitura é privada, válida apenas para o público e imutável', async () => {
  await seedProfiles([
    accessProfile('read-recipient', {notificationsRead: true}, {role: 'gestor'}),
    accessProfile('read-other', {notificationsRead: true}, {role: 'residente'})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'notifications', 'notice-all'), {
      id: 'notice-all', active: true, audienceType: 'ALL', audienceValue: '', title: 'Todos',
      startAt: new Date('2026-09-01T00:00:00Z'), endAt: new Date('2026-10-01T00:00:00Z')
    });
    await setDoc(doc(db, 'notifications', 'notice-private'), {
      id: 'notice-private', active: true, audienceType: 'ROLE', audienceValue: 'residente', title: 'Residentes',
      startAt: new Date('2026-09-01T00:00:00Z'), endAt: new Date('2026-10-01T00:00:00Z')
    });
  });
  const recipient = testEnvironment.authenticatedContext('read-recipient').firestore();
  const other = testEnvironment.authenticatedContext('read-other').firestore();
  const receipt = {id: 'notice-all', notificationId: 'notice-all', uid: 'read-recipient', readAt: serverTimestamp()};
  const ownReceipt = doc(recipient, 'users', 'read-recipient', 'notificationReads', 'notice-all');
  await assertSucceeds(setDoc(ownReceipt, receipt));
  await assertSucceeds(getDoc(ownReceipt));
  await assertSucceeds(getDocs(collection(recipient, 'users', 'read-recipient', 'notificationReads')));
  await assertFails(setDoc(doc(recipient, 'users', 'read-recipient', 'notificationReads', 'notice-private'), {
    id: 'notice-private', notificationId: 'notice-private', uid: 'read-recipient', readAt: serverTimestamp()
  }));
  await assertFails(getDoc(doc(other, 'users', 'read-recipient', 'notificationReads', 'notice-all')));
  await assertFails(updateDoc(ownReceipt, {uid: 'read-other'}));
  await assertFails(deleteDoc(ownReceipt));
});

test('férias seguem intervalo, siglas e permissão da escala sem permitir exclusão', async () => {
  await seedProfiles([
    accessProfile('schedule-reader', {scheduleRead: true}),
    accessProfile('schedule-manager', {scheduleRead: true, scheduleWrite: true}),
    accessProfile('events-only', {eventsRead: true})
  ]);
  const reader = testEnvironment.authenticatedContext('schedule-reader').firestore();
  const manager = testEnvironment.authenticatedContext('schedule-manager').firestore();
  const unrelated = testEnvironment.authenticatedContext('events-only').firestore();
  const vacation = {id: 'vac-1', start: '2026-09-20', end: '2026-09-30', siglas: ['CR', 'AD'], label: 'CR, AD (férias)', notes: '', active: true, createdByUid: 'schedule-manager', createdAt: new Date(), updatedByUid: 'schedule-manager', updatedAt: new Date()};
  await assertSucceeds(setDoc(doc(manager, 'vacations', 'vac-1'), vacation));
  const dayQuery = query(collection(reader, 'vacations'), where('active', '==', true), where('start', '<=', '2026-09-24'), where('end', '>=', '2026-09-24'), orderBy('start', 'asc'));
  const result = await assertSucceeds(getDocs(dayQuery));
  assert.equal(result.size, 1);
  await assertFails(getDocs(collection(unrelated, 'vacations')));
  await assertFails(setDoc(doc(manager, 'vacations', 'bad-range'), {...vacation, id: 'bad-range', start: '2026-10-01', end: '2026-09-30'}));
  await assertSucceeds(setDoc(doc(manager, 'vacations', 'vac-1'), {...vacation, active: false, updatedAt: new Date()}));
  await assertFails(getDoc(doc(reader, 'vacations', 'vac-1')));
  await assertSucceeds(getDoc(doc(manager, 'vacations', 'vac-1')));
  await assertFails(deleteDoc(doc(manager, 'vacations', 'vac-1')));
});

test('liberação de sigla altera somente a lista compartilhada sob scheduleWrite', async () => {
  await seedProfiles([
    accessProfile('schedule-reader', {scheduleRead: true}),
    accessProfile('schedule-manager', {scheduleRead: true, scheduleWrite: true})
  ]);
  const reader = testEnvironment.authenticatedContext('schedule-reader').firestore();
  const manager = testEnvironment.authenticatedContext('schedule-manager').firestore();
  const day = '2026-09-25';
  const schedule = {
    id: day, date: day, positions: [{position: 1, sigla: 'AB'}],
    highlights: {siglas: [], events: ['SUPORTE']},
    version: 1, createdByUid: 'schedule-manager', updatedByUid: 'schedule-manager',
    createdAt: new Date(), updatedAt: new Date()
  };
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'scheduleDays', day), schedule);
  });

  await assertFails(updateDoc(doc(reader, 'scheduleDays', day), {
    'highlights.siglas': ['AB'], updatedByUid: 'schedule-reader', updatedAt: serverTimestamp(), version: 2
  }));
  await assertSucceeds(updateDoc(doc(manager, 'scheduleDays', day), {
    'highlights.siglas': ['AB'], updatedByUid: 'schedule-manager', updatedAt: serverTimestamp(), version: 2
  }));
  await assertFails(updateDoc(doc(manager, 'scheduleDays', day), {
    positions: [{position: 1, sigla: 'ZZ'}], updatedByUid: 'schedule-manager', updatedAt: serverTimestamp(), version: 9
  }));
  await assertFails(updateDoc(doc(manager, 'scheduleDays', day), {
    'highlights.events': ['AD'], updatedByUid: 'schedule-manager', updatedAt: serverTimestamp(), version: 3
  }));

  const stored = await getDoc(doc(manager, 'scheduleDays', day));
  assert.deepEqual(stored.data().positions, schedule.positions);
  assert.deepEqual(stored.data().highlights, {siglas: ['AB'], events: ['SUPORTE']});
  assert.equal(stored.data().version, 2);
});

test('planilha é a fonte da escala; clientes não criam nem alteram posições', async () => {
  await seedProfiles([
    accessProfile('schedule-editor', {scheduleWrite: true}),
    accessProfile('events-reader', {eventsRead: true})
  ]);
  const editor = testEnvironment.authenticatedContext('schedule-editor').firestore();
  const eventsReader = testEnvironment.authenticatedContext('events-reader').firestore();
  const day = '2026-09-26';
  const reference = doc(editor, 'scheduleDays', day);
  const initial = {
    id: day, date: day, positions: [{position: 1, sigla: 'AB'}],
    highlights: {siglas: [], events: []}, version: 1,
    createdByUid: 'schedule-editor', createdAt: serverTimestamp(),
    updatedByUid: 'schedule-editor', updatedAt: serverTimestamp()
  };
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'scheduleDays', day), {...initial, createdByUid: 'migration:sheet-schedule-source', updatedByUid: 'migration:sheet-schedule-source', createdAt: new Date(), updatedAt: new Date()});
  });
  await assertFails(setDoc(doc(eventsReader, 'scheduleDays', day), {...initial, createdByUid: 'events-reader', updatedByUid: 'events-reader'}));
  await assertFails(setDoc(reference, initial));
  await assertSucceeds(getDoc(doc(eventsReader, 'scheduleDays', day)));
  await assertFails(updateDoc(doc(eventsReader, 'scheduleDays', day), {
    positions: [{position: 1, sigla: 'ZZ'}], updatedByUid: 'events-reader', updatedAt: serverTimestamp(), version: 2
  }));
  await assertFails(updateDoc(reference, {
    positions: [{position: 1, sigla: 'AB'}, {position: 2, sigla: 'DC'}],
    updatedByUid: 'schedule-editor', updatedAt: serverTimestamp(), version: 2
  }));
  await assertFails(updateDoc(reference, {
    positions: [{position: 1, sigla: 'ZZ'}],
    'highlights.events': ['EVENTO:ZZ:forged'],
    updatedByUid: 'schedule-editor', updatedAt: serverTimestamp(), version: 3
  }));
  await assertFails(deleteDoc(reference));
  const stored = await assertSucceeds(getDoc(reference));
  assert.deepEqual(stored.data().positions, [{position: 1, sigla: 'AB'}]);
  assert.deepEqual(stored.data().highlights, {siglas: [], events: []});
});

test('titular pode corrigir dados básicos, mas não editar autorização do próprio perfil', async () => {
  await seedProfiles([accessProfile('self', {eventsRead: true})]);
  const user = testEnvironment.authenticatedContext('self').firestore();
  const profile = accessProfile('self', {eventsRead: true});
  await assertSucceeds(setDoc(doc(user, 'users', 'self'), {...profile, displayName: 'Nome Atualizado', phone: '11999990000', updatedAt: new Date()}));
  await assertFails(setDoc(doc(user, 'users', 'self'), {...profile, permissions: {admin: true}, updatedAt: new Date()}));
  await assertFails(setDoc(doc(user, 'users', 'self'), {...profile, access: false, updatedAt: new Date()}));
});

test('perfil inativo pode ser lido pelo titular, mas não autoriza operações', async () => {
  await seedProfiles([accessProfile('inactive', {eventsRead: true, eventsWrite: true}, {active: false})]);
  const user = testEnvironment.authenticatedContext('inactive').firestore();
  await assertSucceeds(getDoc(doc(user, 'users', 'inactive')));
  await assertFails(getDoc(doc(user, 'events', 'event-1')));
});

test('permissão de leitura permite consultar eventos, mas não gravá-los', async () => {
  await seedProfiles([accessProfile('reader', {eventsRead: true}, {sigla: 'AB'})]);
  const user = testEnvironment.authenticatedContext('reader').firestore();
  await assertSucceeds(getDocs(query(collection(user, 'events'), where('createdByUid', '==', 'reader'))));
  await assertFails(setDoc(doc(user, 'events', 'event-1'), {createdByUid: 'reader'}));
});

test('catálogo de Eventos é global, administrável por permissão própria e obrigatório na gravação', async () => {
  await seedProfiles([
    accessProfile('catalog-manager', {eventsRead: true, eventsCatalogManage: true}),
    accessProfile('catalog-reader', {eventsRead: true}),
    accessProfile('event-writer', {eventsWrite: true}),
    accessProfile('catalog-outsider')
  ]);
  const manager = testEnvironment.authenticatedContext('catalog-manager').firestore();
  const reader = testEnvironment.authenticatedContext('catalog-reader').firestore();
  const writer = testEnvironment.authenticatedContext('event-writer').firestore();
  const outsider = testEnvironment.authenticatedContext('catalog-outsider').firestore();
  const catalogRef = doc(manager, 'eventCatalogs', 'operational');
  const catalog = {id: 'operational', payers: ['Equipe'], creditors: ['Caixa'], createdByUid: 'catalog-manager', createdAt: serverTimestamp(), updatedByUid: 'catalog-manager', updatedAt: serverTimestamp(), version: 1};
  await assertSucceeds(setDoc(catalogRef, catalog));
  await assertSucceeds(getDoc(doc(reader, 'eventCatalogs', 'operational')));
  await assertSucceeds(getDoc(doc(writer, 'eventCatalogs', 'operational')));
  await assertFails(setDoc(doc(writer, 'eventCatalogs', 'other'), {...catalog, id: 'other'}));
  await assertFails(getDoc(doc(outsider, 'eventCatalogs', 'operational')));
  await assertSucceeds(updateDoc(catalogRef, {payers: ['Equipe', 'Caixa'], updatedByUid: 'catalog-manager', updatedAt: serverTimestamp(), version: 2}));
  await assertFails(deleteDoc(catalogRef));
  await assertFails(setDoc(doc(manager, 'eventCatalogs', 'invalid'), {...catalog, id: 'invalid', legacySheetRow: 2}));
});

test('permissão de escrita cria evento próprio diretamente no Firestore', async () => {
  await seedProfiles([
    accessProfile('writer', {eventsRead: true, eventsWrite: true}),
    accessProfile('other-writer', {eventsRead: true, eventsWrite: true}),
    accessProfile('event-admin', {admin: true}, {role: 'administrador_app'})
  ]);
  await seedEventCatalog();
  const user = testEnvironment.authenticatedContext('writer').firestore();
  const other = testEnvironment.authenticatedContext('other-writer').firestore();
  const admin = testEnvironment.authenticatedContext('event-admin').firestore();
  const now = new Date();
  const event = {date: '2026-09-24', memberSigla: 'AB', scheduleSigla: 'AB', memberStatus: 'AB — Atrasado', eventType: 'ATRASO', description: '', delayMultiple: 2, substitute: '', shift: '', payer: 'Membro', creditor: 'Equipe', amountToPay: 200, status: 'OPEN', active: true, id: 'request-1', clientMutationId: 'request-1', createdByUid: 'writer', updatedByUid: 'writer', createdAt: now, updatedAt: now, version: 1};
  await assertSucceeds(setFirestoreRecord(user, 'events', 'standalone', {...event, id: 'standalone', clientMutationId: 'standalone', createdAt: serverTimestamp(), updatedAt: serverTimestamp()}, 'writer'));
  await assertSucceeds(setFirestoreRecord(user, 'events', 'request-1', {...event, createdAt: serverTimestamp(), updatedAt: serverTimestamp()}, 'writer'));
  const shiftEvent = {...event, id: 'shift-valid', clientMutationId: 'shift-valid', eventType: 'Gestão', memberStatus: 'AB — Ausente', delayMultiple: null, substitute: 'Substituto', shift: 'Manhã', amountToPay: 1000};
  await assertSucceeds(setFirestoreRecord(user, 'events', 'shift-valid', shiftEvent, 'writer'));
  await assertFails(setFirestoreRecord(user, 'events', 'shift-invalid-amount', {...shiftEvent, id: 'shift-invalid-amount', clientMutationId: 'shift-invalid-amount', amountToPay: 2000}, 'writer'));
  const supportEvent = {...shiftEvent, id: 'support-valid', clientMutationId: 'support-valid', eventType: 'Suporte', memberStatus: 'SUPORTE', shift: 'Integral', amountToPay: 2000};
  await assertSucceeds(setFirestoreRecord(user, 'events', 'support-valid', supportEvent, 'writer'));
  await assertFails(setFirestoreRecord(user, 'events', 'support-invalid-amount', {...supportEvent, id: 'support-invalid-amount', clientMutationId: 'support-invalid-amount', amountToPay: 1000}, 'writer'));
  const absenceEvent = {...shiftEvent, id: 'absence-manual', clientMutationId: 'absence-manual', eventType: 'Ausência', shift: 'Integral', amountToPay: 375};
  await assertSucceeds(setFirestoreRecord(user, 'events', 'absence-manual', absenceEvent, 'writer'));
  const legacyEvent = {...event, id: 'legacy-event', clientMutationId: 'legacy-event', amountToPay: 400};
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'events', 'legacy-event'), {
      ...legacyEvent, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  await assertSucceeds(updateEventWithHistory(admin, {
    eventId: 'legacy-event', event: legacyEvent, uid: 'event-admin',
    updates: {memberStatus: 'CD — Atrasado'}, requestId: 'legacy-event-edit'
  }));
  await assertFails(updateEventWithHistory(user, {eventId: 'request-1', event, uid: 'writer', updates: {amountToPay: 220}, requestId: 'event-edit-2'}));
  await assertFails(updateEventWithHistory(admin, {eventId: 'request-1', event, uid: 'event-admin', updates: {amountToPay: 220}, requestId: 'event-edit-2-admin'}));
  await assertFails(setFirestoreRecord(user, 'events', 'invalid-delay-amount', {...event, id: 'invalid-delay-amount', clientMutationId: 'invalid-delay-amount', amountToPay: 400}, 'writer'));
  await assertFails(setFirestoreRecord(user, 'events', 'missing-member', {...event, id: 'missing-member', clientMutationId: 'missing-member', memberStatus: ''}, 'writer'));
  await assertFails(setFirestoreRecord(user, 'events', 'invalid-delay', {...event, id: 'invalid-delay', clientMutationId: 'invalid-delay', delayMultiple: 8}, 'writer'));
  await assertFails(setFirestoreRecord(user, 'events', 'unknown-payer', {...event, id: 'unknown-payer', clientMutationId: 'unknown-payer', payer: 'Não catalogado'}, 'writer'));
  await assertFails(setFirestoreRecord(user, 'events', 'bad-other', {...event, id: 'bad-other', clientMutationId: 'bad-other', eventType: 'Outros', description: ''}, 'writer'));
  await assertSucceeds(updateEventWithHistory(admin, {eventId: 'request-1', event, uid: 'event-admin', updates: {memberStatus: 'CD — Atrasado'}, requestId: 'event-edit-3'}));
  const editedEvent = {...event, memberStatus: 'CD — Atrasado', version: 2};
  await assertSucceeds(updateEventWithHistory(admin, {eventId: 'request-1', event: editedEvent, uid: 'event-admin', updates: {memberStatus: 'EF — Atrasado'}, requestId: 'event-edit-4'}));
  await assertFails(updateFirestoreRecord(user, 'events', 'request-1', {memberStatus: 'EF — Atrasado', updatedByUid: 'writer', updatedAt: serverTimestamp(), version: 3}, 'writer'));
  await assertFails(updateFirestoreRecord(other, 'events', 'request-1', {memberStatus: 'EF — Atrasado', updatedByUid: 'other-writer', updatedAt: serverTimestamp(), version: 4}, 'other-writer'));
  await assertFails(deleteDoc(doc(user, 'events', 'request-1')));
});

test('escrita em nome de outra pessoa é negada', async () => {
  await seedProfiles([accessProfile('writer', {eventsWrite: true})]);
  const user = testEnvironment.authenticatedContext('writer').firestore();
  await assertFails(setDoc(doc(user, 'events', 'forged'), {createdByUid: 'someone-else'}));
  await assertSucceeds(getDocs(query(collection(user, 'events'), where('createdByUid', '==', 'writer'))));
});

test('checklist aceita resposta própria e exige ocorrência em não conformidade', async () => {
  const today = saoPauloDay();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = `${today.slice(0, 7)}-${String(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
  await seedProfiles([
    accessProfile('checker', {checklistRead: true, checklistWrite: true}, {sigla: 'AB'}),
    accessProfile('writer-only', {checklistWrite: true}, {sigla: 'CD'}),
    accessProfile('signer-only', {checklistSign: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'stations', 'station-1'), {id: 'station-1', name: 'Estação', qrCode: 'QR-1', active: true, start: shiftDay(today, -3), end: shiftDay(today, 3)});
    await setDoc(doc(db, 'stations', 'station-inactive'), {id: 'station-inactive', name: 'Inativa', active: false});
    await setDoc(doc(db, 'stations', 'station-future'), {id: 'station-future', name: 'Futura', active: true, start: shiftDay(today, 10)});
    await setDoc(doc(db, 'stations', 'station-malformed'), {id: 'station-malformed', name: 'Inválida', active: true, start: 'amanhã'});
    await setDoc(doc(db, 'stations', 'station-monthly'), {id: 'station-monthly', name: 'Histórico mensal', qrCode: 'QR-M', active: true});
    await setDoc(doc(db, 'scheduleDays', today), {date: today, checklistResponsibleSigla: 'AB'});
    await setDoc(doc(db, 'checklists', 'prior-old'), {stationId: 'station-1', date: shiftDay(today, -2), condition: 'SIM', createdAt: new Date(`${shiftDay(today, -2)}T10:00:00Z`)});
    await setDoc(doc(db, 'checklists', 'prior-latest'), {stationId: 'station-1', date: shiftDay(today, -1), condition: 'NAO', createdAt: new Date(`${shiftDay(today, -1)}T10:00:00Z`)});
    await setDoc(doc(db, 'checklists', 'prior-month'), {stationId: 'station-monthly', date: shiftDay(monthStart, -1), condition: 'NAO', createdAt: new Date(`${shiftDay(monthStart, -1)}T10:00:00Z`)});
    await setDoc(doc(db, 'checklists', 'prior-other-station'), {stationId: 'station-2', date: shiftDay(today, -1), condition: 'SIM', createdAt: new Date(`${shiftDay(today, -1)}T11:00:00Z`)});
  });
  const user = testEnvironment.authenticatedContext('checker').firestore();
  const writer = testEnvironment.authenticatedContext('writer-only').firestore();
  const signer = testEnvironment.authenticatedContext('signer-only').firestore();
  const record = {id: 'check-1', clientMutationId: 'check-1', stationId: 'station-1', date: today, condition: 'SIM', status: 'COMPLETED', occurrence: '', responsibleUid: null, responsibleName: null, responsibleEmail: null, active: true, createdByUid: 'checker', updatedByUid: 'checker', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), version: 1};
  await assertSucceeds(setFirestoreRecord(user, 'checklists', 'check-1', record, 'checker'));
  await assertSucceeds(getDoc(doc(writer, 'stations', 'station-1')));
  await assertFails(getDoc(doc(writer, 'scheduleDays', today)));
  await assertSucceeds(getDoc(doc(writer, 'checklists', 'check-1')));
  await assertSucceeds(getDoc(doc(signer, 'stations', 'station-1')));
  const prior = await getDocs(query(collection(user, 'checklists'), where('stationId', '==', 'station-1'), where('date', '<', record.date), orderBy('date', 'desc'), orderBy('createdAt', 'desc'), limit(1)));
  assert.equal(prior.docs[0]?.id, 'prior-latest');
  const monthPrior = await getDocs(query(collection(user, 'checklists'), where('stationId', '==', 'station-monthly'), where('date', '<', monthStart), orderBy('date', 'desc'), orderBy('createdAt', 'desc'), limit(1)));
  assert.equal(monthPrior.docs[0]?.id, 'prior-month');
  const monthRecords = await getDocs(query(collection(user, 'checklists'), where('date', '>=', monthStart), where('date', '<=', monthEnd), orderBy('date', 'asc'), orderBy('createdAt', 'desc'), limit(2001)));
  assert.equal(monthRecords.docs.some((item) => item.id === 'check-1'), true);
  const todayRecords = await getDocs(query(collection(user, 'checklists'), where('date', '==', record.date), orderBy('createdAt', 'desc'), limit(200)));
  assert.equal(todayRecords.docs.some((item) => item.id === 'check-1'), true);
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-1', {...record, occurrence: 'Alteração após envio', updatedAt: new Date(), updatedByUid: 'checker'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'wrong-document-id', {...record, id: 'check-1', clientMutationId: 'check-1'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-extra-field', {...record, id: 'check-extra-field', clientMutationId: 'check-extra-field', legacySheetRow: 15}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-forged-responsible', {...record, id: 'check-forged-responsible', clientMutationId: 'check-forged-responsible', responsibleUid: 'checker', responsibleName: 'Outra pessoa', responsibleEmail: 'other@example.invalid'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-forged-time', {...record, id: 'check-forged-time', clientMutationId: 'check-forged-time', createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2020-01-01T00:00:00Z')}, 'checker'));
  await assertSucceeds(setFirestoreRecord(writer, 'checklists', 'check-writer-with-different-sigla', {...record, id: 'check-writer-with-different-sigla', clientMutationId: 'check-writer-with-different-sigla', createdByUid: 'writer-only', updatedByUid: 'writer-only'}, 'writer-only'));
  await assertFails(setFirestoreRecord(signer, 'checklists', 'check-signer-without-write', {...record, id: 'check-signer-without-write', clientMutationId: 'check-signer-without-write'}, 'signer-only'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-2', {...record, id: 'check-2', clientMutationId: 'check-2', condition: 'NAO', status: 'MAINTENANCE'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-3', {...record, id: 'check-3', clientMutationId: 'check-3', responsibleUid: 'other'}, 'checker'));
  await assertSucceeds(setFirestoreRecord(user, 'checklists', 'check-4', {...record, id: 'check-4', clientMutationId: 'check-4', condition: 'NAO', status: 'MAINTENANCE', occurrence: 'Equipamento indisponível'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-missing-station', {...record, id: 'check-missing-station', clientMutationId: 'check-missing-station', stationId: 'missing'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-inactive-station', {...record, id: 'check-inactive-station', clientMutationId: 'check-inactive-station', stationId: 'station-inactive'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-future-station', {...record, id: 'check-future-station', clientMutationId: 'check-future-station', stationId: 'station-future'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-malformed-station', {...record, id: 'check-malformed-station', clientMutationId: 'check-malformed-station', stationId: 'station-malformed'}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-outside-period', {...record, id: 'check-outside-period', clientMutationId: 'check-outside-period', date: shiftDay(today, 10)}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-past-day', {...record, id: 'check-past-day', clientMutationId: 'check-past-day', date: shiftDay(today, -1)}, 'checker'));
  await assertFails(setFirestoreRecord(user, 'checklists', 'check-future-day', {...record, id: 'check-future-day', clientMutationId: 'check-future-day', date: shiftDay(today, 1)}, 'checker'));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), 'scheduleDays', today));
  });
  const unscheduledRecord = {...record, id: 'check-no-schedule', clientMutationId: 'check-no-schedule', createdByUid: 'writer-only', updatedByUid: 'writer-only'};
  await assertSucceeds(setFirestoreRecord(writer, 'checklists', 'check-no-schedule', unscheduledRecord, 'writer-only'));
});

test('etiqueta preserva campos validados e recusa tipo/estrutura inválidos', async () => {
  await seedProfiles([accessProfile('label-writer', {labelsRead: true, labelsWrite: true}), accessProfile('other-label-writer', {labelsRead: true, labelsWrite: true})]);
  const user = testEnvironment.authenticatedContext('label-writer').firestore();
  const other = testEnvironment.authenticatedContext('other-label-writer').firestore();
  const label = {id: 'label-1', clientMutationId: 'label-1', date: '2026-09-24', patientName: 'Paciente Teste', procedureCode: '123', encounterCode: '456', type: 'Convênio', amount: null, insurance: 'Teste', creditor: 'Caixa', staffSiglas: [], consultation: false, status: 'CONFIRMED', active: true, createdByUid: 'label-writer', updatedByUid: 'label-writer', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), version: 1};
  await assertSucceeds(setFirestoreRecord(user, 'labels', 'label-1', label, 'label-writer'));
  await assertFails(setFirestoreRecord(user, 'labels', 'wrong-document', {...label, id: 'wrong-document'}, 'label-writer'));
  await assertFails(setFirestoreRecord(user, 'labels', 'label-2', {...label, id: 'label-2', clientMutationId: 'label-2', type: 'Outro'}, 'label-writer'));
  await assertFails(setFirestoreRecord(user, 'labels', 'label-3', {...label, id: 'label-3', clientMutationId: 'label-3', legacySheetRow: 14}, 'label-writer'));
  await assertSucceeds(updateFirestoreRecord(user, 'labels', 'label-1', {patientName: 'Paciente Atualizado', updatedByUid: 'label-writer', updatedAt: serverTimestamp(), version: 2}, 'label-writer'));
  await assertFails(updateFirestoreRecord(other, 'labels', 'label-1', {patientName: 'Alteração indevida', updatedByUid: 'other-label-writer', updatedAt: serverTimestamp(), version: 3}, 'other-label-writer'));
  await assertFails(deleteDoc(doc(user, 'labels', 'label-1')));
  const queuedLabel = {...label, id: 'label-queue', clientMutationId: 'label-queue'};
  await assertSucceeds(setFirestoreRecord(user, 'labels', 'label-queue', queuedLabel, 'label-writer'));
  await assertSucceeds(updateFirestoreRecord(user, 'labels', 'label-queue', {patientName: 'Paciente Atualizado', updatedByUid: 'label-writer', updatedAt: serverTimestamp(), version: 2}, 'label-writer'));
});

test('histórico de Etiquetas registra todas as alterações em batch e conserva a privacidade', async () => {
  await seedProfiles([
    accessProfile('label-owner', {labelsRead: true, labelsWrite: true}),
    accessProfile('label-reader', {labelsRead: true}),
    accessProfile('label-manager', {labelsManage: true})
  ]);
  const owner = testEnvironment.authenticatedContext('label-owner').firestore();
  const reader = testEnvironment.authenticatedContext('label-reader').firestore();
  const manager = testEnvironment.authenticatedContext('label-manager').firestore();
  const labelId = 'label-history';
  const label = {id: labelId, clientMutationId: labelId, date: '2026-09-24', patientName: 'Paciente Teste', procedureCode: '123', encounterCode: '456', type: 'Convênio', amount: null, insurance: 'Teste', creditor: 'Caixa', staffSiglas: [], consultation: false, status: 'CONFIRMED', active: true, createdByUid: 'label-owner', updatedByUid: 'label-owner', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), version: 1};
  await assertSucceeds(setFirestoreRecord(owner, 'labels', labelId, label, 'label-owner'));

  await assertSucceeds(updateLabelWithHistory(owner, {
    labelId, label, uid: 'label-owner',
    updates: {patientName: 'Paciente Corrigido', encounterCode: '789'},
    changedFields: ['patientName', 'encounterCode']
  }));
  await assertSucceeds(getDoc(doc(owner, 'labels', labelId, 'history', '2')));
  await assertFails(getDoc(doc(reader, 'labels', labelId, 'history', '2')));
  await assertFails(updateDoc(doc(owner, 'labels', labelId, 'history', '2'), {actorUid: 'forged'}));
  await assertFails(deleteDoc(doc(owner, 'labels', labelId, 'history', '2')));

  const current = {...label, patientName: 'Paciente Corrigido', encounterCode: '789', version: 2};
  await assertFails(updateLabelWithHistory(owner, {
    labelId, label: current, uid: 'label-owner',
    updates: {patientName: 'Outro Nome', date: '2026-09-25'},
    changedFields: ['patientName']
  }));
  await assertFails(updateLabelWithHistory(owner, {
    labelId, label: current, uid: 'label-owner',
    updates: {patientName: current.patientName}, changedFields: ['patientName']
  }));
  await assertFails(updateLabelWithHistory(manager, {
    labelId, label: current, uid: 'label-manager',
    updates: {patientName: 'Alterado pela gestão'},
    changedFields: ['patientName'], historyId: 'forged-version-path'
  }));
});

test('catálogo compartilhado de siglas é restrito e validado pelas Rules', async () => {
  await seedProfiles([
    accessProfile('label-manager', {labelsManage: true}),
    accessProfile('label-writer', {labelsRead: true, labelsWrite: true}),
    accessProfile('label-reader', {labelsRead: true}),
    accessProfile('unrelated-reader', {eventsRead: true})
  ]);
  const manager = testEnvironment.authenticatedContext('label-manager').firestore();
  const writer = testEnvironment.authenticatedContext('label-writer').firestore();
  const reader = testEnvironment.authenticatedContext('label-reader').firestore();
  const unrelated = testEnvironment.authenticatedContext('unrelated-reader').firestore();
  const catalog = {id: 'labelStaff', siglas: ['AB', 'CD'], active: true, createdByUid: 'label-manager', createdAt: serverTimestamp(), updatedByUid: 'label-manager', updatedAt: serverTimestamp(), version: 1};
  await assertSucceeds(setDoc(doc(manager, 'appConfig', 'labelStaff'), catalog));
  await assertSucceeds(getDoc(doc(writer, 'appConfig', 'labelStaff')));
  await assertFails(setDoc(doc(writer, 'appConfig', 'labelStaff'), catalog));

  const label = {id: 'label-roster-valid', clientMutationId: 'label-roster-valid', date: '2026-09-24', patientName: 'Paciente Teste', procedureCode: '123', encounterCode: '456', type: 'Convênio', amount: null, insurance: 'Teste', creditor: 'Plantão', staffSiglas: ['AB'], consultation: false, status: 'CONFIRMED', active: true, createdByUid: 'label-writer', updatedByUid: 'label-writer', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), version: 1};
  await assertSucceeds(setFirestoreRecord(writer, 'labels', label.id, label, 'label-writer'));
  const invalid = {...label, id: 'label-roster-invalid', clientMutationId: 'label-roster-invalid', staffSiglas: ['ZZ']};
  await assertFails(setFirestoreRecord(writer, 'labels', invalid.id, invalid, 'label-writer'));
  await assertSucceeds(getDoc(doc(reader, 'appConfig', 'labelStaff')));
  await assertSucceeds(getDoc(doc(unrelated, 'appConfig', 'labelStaff')));

  await assertSucceeds(updateDoc(doc(manager, 'appConfig', 'labelStaff'), {siglas: ['CD'], updatedByUid: 'label-manager', updatedAt: serverTimestamp(), version: 2}));
  await assertSucceeds(updateFirestoreRecord(writer, 'labels', label.id, {patientName: 'Paciente Atualizado', updatedByUid: 'label-writer', updatedAt: serverTimestamp(), version: 2}, 'label-writer'));
  const changedHistoricalSigla = {...label, id: 'label-old-sigla', clientMutationId: 'label-old-sigla', staffSiglas: ['AB']};
  await assertFails(setFirestoreRecord(writer, 'labels', changedHistoricalSigla.id, changedHistoricalSigla, 'label-writer'));
});

test('feature flags da aplicação exigem administrador, campos válidos e versão crescente', async () => {
  await seedProfiles([
    accessProfile('feature-admin', {admin: true}, {role: 'administrador_app'}),
    accessProfile('feature-user', {eventsRead: true}),
    accessProfile('feature-access-manager', {usersManage: true})
  ]);
  const admin = testEnvironment.authenticatedContext('feature-admin').firestore();
  const user = testEnvironment.authenticatedContext('feature-user').firestore();
  const accessManager = testEnvironment.authenticatedContext('feature-access-manager').firestore();
  const configRef = doc(admin, 'appConfig', 'app');
  const features = {checklist: true, labels: true, trainings: true, management: true, notifications: true, esg: false, innovation: false};
  const config = {
    id: 'app', features, createdByUid: 'feature-admin', createdAt: serverTimestamp(),
    updatedByUid: 'feature-admin', updatedAt: serverTimestamp(), version: 1
  };

  await assertSucceeds(setDoc(configRef, config));
  await assertSucceeds(getDoc(doc(user, 'appConfig', 'app')));
  await assertFails(setDoc(doc(user, 'appConfig', 'app'), config));
  await assertFails(setDoc(doc(accessManager, 'appConfig', 'app'), config));

  await assertSucceeds(updateDoc(configRef, {
    features: {...features, checklist: false}, updatedByUid: 'feature-admin',
    updatedAt: serverTimestamp(), version: 2
  }));
  await assertFails(updateDoc(configRef, {
    features: {...features, labels: false}, updatedByUid: 'feature-admin',
    updatedAt: serverTimestamp(), version: 4
  }));
  await assertFails(updateDoc(configRef, {
    features: {...features, unknown: true}, updatedByUid: 'feature-admin',
    updatedAt: serverTimestamp(), version: 3
  }));
  await assertFails(deleteDoc(configRef));
});

test('administrador gerencia perfis e perfil comum não consegue se promover', async () => {
  await seedProfiles([accessProfile('admin', {admin: true}, {role: 'administrador_app'}), accessProfile('user')]);
  const admin = testEnvironment.authenticatedContext('admin').firestore();
  const user = testEnvironment.authenticatedContext('user').firestore();
  await assertSucceeds(setDoc(doc(admin, 'users', 'new-user'), accessProfile('new-user', {}, {createdAt: new Date(), updatedAt: new Date()})));
  await assertFails(setDoc(doc(admin, 'users', 'mismatched'), accessProfile('other-uid', {}, {createdAt: new Date(), updatedAt: new Date()})));
  await assertFails(setDoc(doc(admin, 'users', 'invalid-role'), accessProfile('invalid-role', {}, {role: 'root', createdAt: new Date(), updatedAt: new Date()})));
  await assertSucceeds(setDoc(doc(admin, 'users', 'new-admin'), accessProfile('new-admin', {admin: true}, {role: 'administrador_app', createdAt: new Date(), updatedAt: new Date()})));
  await assertFails(setDoc(doc(user, 'users', 'user'), accessProfile('user', {admin: true}, {role: 'administrador_app'})));
});

test('gestor de acessos administra perfis comuns sem conceder acesso administrativo', async () => {
  await seedProfiles([accessProfile('access-manager', {usersManage: true}), accessProfile('staff')]);
  const manager = testEnvironment.authenticatedContext('access-manager').firestore();
  const ordinary = accessProfile('new-staff', {eventsRead: true}, {createdAt: new Date(), updatedAt: new Date()});
  await assertSucceeds(getDocs(collection(manager, 'users')));
  await assertSucceeds(setDoc(doc(manager, 'users', 'new-staff'), ordinary));
  await assertFails(setDoc(doc(manager, 'users', 'promoted'), accessProfile('promoted', {usersManage: true}, {createdAt: new Date(), updatedAt: new Date()})));
  await assertFails(setDoc(doc(manager, 'users', 'admin'), accessProfile('admin', {admin: true}, {role: 'administrador_app', createdAt: new Date(), updatedAt: new Date()})));
  await assertFails(setDoc(doc(manager, 'users', 'new-staff'), {...ordinary, permissions: {admin: true}, updatedAt: new Date()}));
  await assertFails(setDoc(doc(manager, 'users', 'access-manager'), {...accessProfile('access-manager', {usersManage: true}), permissions: {admin: true}, updatedAt: new Date()}));
  await assertSucceeds(setDoc(doc(manager, 'users', 'new-staff'), {...ordinary, active: false, access: false, updatedAt: new Date()}));
  await assertFails(deleteDoc(doc(manager, 'users', 'staff')));
});

test('assinatura de checklist permanece bloqueada até existir fluxo de relatório íntegro', async () => {
  await seedProfiles([accessProfile('signer', {checklistSign: true}), accessProfile('reader', {checklistRead: true})]);
  const signer = testEnvironment.authenticatedContext('signer').firestore();
  const reader = testEnvironment.authenticatedContext('reader').firestore();
  const signature = {checklistId: 'check-1', responsibleUid: 'signer', createdByUid: 'signer', declaration: 'Confirmo', revision: 1};
  await assertFails(setDoc(doc(signer, 'checklistSignatures', 'sig-1'), signature));
  await assertFails(setDoc(doc(signer, 'checklistSignatures', 'sig-2'), {...signature, responsibleUid: 'reader'}));
  await assertFails(setDoc(doc(reader, 'checklistSignatures', 'sig-3'), {...signature, responsibleUid: 'reader', createdByUid: 'reader'}));
});

test('progresso de treinamento é individual, ligado ao catálogo ativo e não aceita conclusão/pontos do cliente', async () => {
  await seedProfiles([accessProfile('trainee', {trainingsRead: true}), accessProfile('other-trainee', {trainingsRead: true}), accessProfile('no-training-access')]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'trainings', 'video-1'), {title: 'Treinamento', active: true});
    await setDoc(doc(context.firestore(), 'trainings', 'inactive-video'), {title: 'Inativo', active: false});
    await setDoc(doc(context.firestore(), 'trainingReceipts', 'start-receipt'), {uid: 'trainee', trainingId: 'video-1'});
  });
  const trainee = testEnvironment.authenticatedContext('trainee').firestore();
  const other = testEnvironment.authenticatedContext('other-trainee').firestore();
  const denied = testEnvironment.authenticatedContext('no-training-access').firestore();
  const progress = {uid: 'trainee', trainingId: 'video-1', startedAt: new Date(), lastPosition: 0, watchedRanges: [], duration: 120, status: 'STARTED', updatedAt: new Date()};
  await assertSucceeds(setDoc(doc(trainee, 'trainingProgress', 'trainee_video-1'), progress));
  await assertSucceeds(setDoc(doc(trainee, 'trainingProgress', 'trainee_video-1'), {...progress, lastPosition: 20, watchedRanges: [{start: 0, end: 18}], status: 'IN_PROGRESS', updatedAt: new Date()}));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'trainingProgress', 'trainee_video-1'), {status: 'COMPLETED', completedAt: new Date()});
  });
  await assertFails(setDoc(doc(trainee, 'trainingProgress', 'trainee_video-1'), {...progress, lastPosition: 20, watchedRanges: [{start: 0, end: 18}], status: 'IN_PROGRESS', updatedAt: new Date()}));
  await assertFails(setDoc(doc(trainee, 'trainingProgress', 'trainee_video-1'), {...progress, lastPosition: 120, watchedRanges: [{start: 0, end: 120}], status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date()}));
  await assertFails(getDoc(doc(other, 'trainingProgress', 'trainee_video-1')));
  await assertFails(setDoc(doc(other, 'trainingProgress', 'trainee_video-1'), {...progress, uid: 'other-trainee'}));
  await assertFails(setDoc(doc(trainee, 'trainingProgress', 'wrong-id'), progress));
  await assertFails(setDoc(doc(trainee, 'trainingProgress', 'trainee_inactive-video'), {...progress, trainingId: 'inactive-video'}));
  await assertFails(setDoc(doc(trainee, 'trainingProgress', 'trainee_video-1'), {...progress, points: 100, updatedAt: new Date()}));
  await assertFails(getDocs(collection(denied, 'trainingProgress')));
  await assertSucceeds(getDoc(doc(trainee, 'trainingReceipts', 'start-receipt')));
  await assertFails(getDoc(doc(other, 'trainingReceipts', 'start-receipt')));
  await assertFails(setDoc(doc(trainee, 'trainingReceipts', 'forged-receipt'), {uid: 'trainee', trainingId: 'video-1'}));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'trainingCompletions', 'completed-receipt'), {uid: 'trainee', trainingId: 'video-1'});
  });
  await assertSucceeds(getDoc(doc(trainee, 'trainingCompletions', 'completed-receipt')));
  await assertFails(getDoc(doc(other, 'trainingCompletions', 'completed-receipt')));
  await assertFails(setDoc(doc(trainee, 'trainingCompletions', 'forged-receipt'), {uid: 'trainee', trainingId: 'video-1'}));
});

test('pontos só podem ser lançados por serviço confiável e cada usuário lê apenas os seus', async () => {
  await seedProfiles([
    accessProfile('score-owner', {checklistSign: true}),
    accessProfile('score-other', {}),
    accessProfile('score-manager', {managementIndicatorsRead: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'scores', 'score-owner-entry'), {
      id: 'score-owner-entry', uid: 'score-owner', sourceType: 'checklistSignature',
      sourceId: 'signature-1', ruleId: 'checklist-daily-responsible-v1', points: 1,
      createdByUid: 'score-owner', createdAt: new Date()
    });
  });
  const owner = testEnvironment.authenticatedContext('score-owner').firestore();
  const other = testEnvironment.authenticatedContext('score-other').firestore();
  const manager = testEnvironment.authenticatedContext('score-manager').firestore();
  const forged = {
    id: 'forged-score', uid: 'score-owner', sourceType: 'checklistSignature',
    sourceId: 'signature-1', ruleId: 'checklist-daily-responsible-v1', points: 999,
    createdByUid: 'score-owner', createdAt: new Date()
  };
  await assertSucceeds(getDoc(doc(owner, 'scores', 'score-owner-entry')));
  const total = await assertSucceeds(getAggregateFromServer(
    query(collection(owner, 'scores'), where('uid', '==', 'score-owner')),
    {points: sum('points')}
  ));
  assert.equal(total.data().points, 1);
  await assertFails(getAggregateFromServer(
    query(collection(other, 'scores'), where('uid', '==', 'score-owner')),
    {points: sum('points')}
  ));
  await assertFails(getDoc(doc(other, 'scores', 'score-owner-entry')));
  await assertFails(setDoc(doc(owner, 'scores', 'forged-score'), forged));
  await assertFails(updateDoc(doc(owner, 'scores', 'score-owner-entry'), {points: 999}));
  await assertSucceeds(getDoc(doc(manager, 'scores', 'score-owner-entry')));
});

test('catálogo de treinamentos valida versão, autoria e permissão de gestão', async () => {
  await seedProfiles([
    accessProfile('training-admin', {trainingsManage: true}),
    accessProfile('training-reader', {trainingsRead: true})
  ]);
  const admin = testEnvironment.authenticatedContext('training-admin').firestore();
  const reader = testEnvironment.authenticatedContext('training-reader').firestore();
  const trainingRef = doc(admin, 'trainings', 'orientation-video');
  const record = {
    id: 'orientation-video', title: 'Orientação', description: '', videoId: 'abcdefghijk',
    videoUrl: 'https://youtu.be/abcdefghijk', accessPoints: 0, completionPoints: 5,
    order: 0, active: true, createdByUid: 'training-admin', createdAt: serverTimestamp(),
    updatedByUid: 'training-admin', updatedAt: serverTimestamp(), version: 1
  };
  await assertSucceeds(setDoc(trainingRef, record));
  await assertSucceeds(getDoc(doc(reader, 'trainings', 'orientation-video')));
  await assertFails(setDoc(doc(reader, 'trainings', 'forbidden'), {...record, id: 'forbidden'}));
  await assertFails(setDoc(doc(admin, 'trainings', 'malformed'), {...record, id: 'malformed', videoId: 'invalid'}));
  await assertSucceeds(updateDoc(trainingRef, {title: 'Orientação atualizada', version: 2, updatedByUid: 'training-admin', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(trainingRef, {createdByUid: 'forged', version: 3, updatedByUid: 'training-admin', updatedAt: serverTimestamp()}));
  await assertFails(deleteDoc(trainingRef));
});

test('feed de aprendizagem restringe leitura a perfil ativo, audiência e estado publicado', async () => {
  await seedProfiles([
    accessProfile('learning-reader', {trainingsRead: true}, {role: 'equipe'}),
    accessProfile('learning-other-role', {trainingsRead: true}, {role: 'gestor'}),
    accessProfile('learning-user-reader', {trainingsRead: true}, {role: 'equipe'}),
    accessProfile('learning-manager', {trainingsManage: true}),
    accessProfile('learning-no-access'),
    accessProfile('learning-inactive', {trainingsRead: true}, {active: false})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'learningActivities', 'audience-all'), learningActivity({id: 'audience-all'}));
    await setDoc(doc(db, 'learningActivities', 'audience-role'), learningActivity({id: 'audience-role', audienceType: 'ROLE', audienceValue: 'equipe'}));
    await setDoc(doc(db, 'learningActivities', 'audience-user'), learningActivity({id: 'audience-user', audienceType: 'USER', audienceValue: 'learning-user-reader'}));
    await setDoc(doc(db, 'learningActivities', 'wrong-role'), learningActivity({id: 'wrong-role', audienceType: 'ROLE', audienceValue: 'gestor'}));
    await setDoc(doc(db, 'learningActivities', 'wrong-user'), learningActivity({id: 'wrong-user', audienceType: 'USER', audienceValue: 'another-user'}));
    await setDoc(doc(db, 'learningActivities', 'hidden'), learningActivity({id: 'hidden', showInTraining: false}));
    await setDoc(doc(db, 'learningActivities', 'inactive'), learningActivity({id: 'inactive', status: 'INACTIVE'}));
  });
  const reader = testEnvironment.authenticatedContext('learning-reader').firestore();
  const otherRole = testEnvironment.authenticatedContext('learning-other-role').firestore();
  const userReader = testEnvironment.authenticatedContext('learning-user-reader').firestore();
  const manager = testEnvironment.authenticatedContext('learning-manager').firestore();
  const noAccess = testEnvironment.authenticatedContext('learning-no-access').firestore();
  const inactive = testEnvironment.authenticatedContext('learning-inactive').firestore();
  for (const id of ['audience-all', 'audience-role']) await assertSucceeds(getDoc(doc(reader, 'learningActivities', id)));
  await assertFails(getDoc(doc(reader, 'learningActivities', 'audience-user')));
  await assertSucceeds(getDoc(doc(userReader, 'learningActivities', 'audience-user')));
  await assertFails(getDoc(doc(otherRole, 'learningActivities', 'audience-role')));
  await assertFails(getDoc(doc(reader, 'learningActivities', 'wrong-role')));
  await assertFails(getDoc(doc(userReader, 'learningActivities', 'wrong-user')));
  await assertFails(getDoc(doc(reader, 'learningActivities', 'hidden')));
  await assertFails(getDoc(doc(reader, 'learningActivities', 'inactive')));
  await assertFails(getDoc(doc(noAccess, 'learningActivities', 'audience-all')));
  await assertFails(getDoc(doc(inactive, 'learningActivities', 'audience-all')));
  await assertSucceeds(getDoc(doc(manager, 'learningActivities', 'hidden')));
  await assertSucceeds(getDoc(doc(manager, 'learningActivities', 'inactive')));
  await assertFails(getDocs(collection(noAccess, 'learningActivities')));
});

test('catálogo de aprendizagem limita criação, versão, autoria e exclusão', async () => {
  await seedProfiles([
    accessProfile('learning-manager', {trainingsManage: true}),
    accessProfile('learning-reader', {trainingsRead: true})
  ]);
  const manager = testEnvironment.authenticatedContext('learning-manager').firestore();
  const reader = testEnvironment.authenticatedContext('learning-reader').firestore();
  const ref = doc(manager, 'learningActivities', 'acknowledge-orientation');
  const record = learningActivity({createdByUid: 'learning-manager', createdAt: serverTimestamp(), updatedByUid: 'learning-manager', updatedAt: serverTimestamp()});
  await assertSucceeds(setDoc(ref, record));
  await assertFails(setDoc(doc(reader, 'learningActivities', 'reader-created'), learningActivity({id: 'reader-created'})));
  await assertFails(setDoc(doc(manager, 'learningActivities', 'malformed'), learningActivity({id: 'malformed', sourceKind: 'CUSTOM', resourceUrl: 'javascript:alert(1)'})));
  await assertFails(setDoc(doc(manager, 'learningActivities', 'extra-field'), {...learningActivity({id: 'extra-field'}), points: 100}));
  await assertSucceeds(updateDoc(ref, {title: 'Orientação revisada', version: 2, updatedByUid: 'learning-manager', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(ref, {createdByUid: 'forged', version: 3, updatedByUid: 'learning-manager', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(ref, {title: 'Versão pulada', version: 4, updatedByUid: 'learning-manager', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(ref, {title: 'Sem nova versão', version: 2, updatedByUid: 'learning-manager', updatedAt: serverTimestamp()}));
  await assertFails(deleteDoc(ref));
});

test('recibos de ciência são idempotentes, próprios e exigem audiência, versão e janela vigentes', async () => {
  await seedProfiles([
    accessProfile('learning-reader', {trainingsRead: true}, {role: 'equipe'}),
    accessProfile('learning-other', {trainingsRead: true}, {role: 'gestor'}),
    accessProfile('learning-no-access'),
    accessProfile('learning-manager', {trainingsManage: true})
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'learningActivities', 'ack-once'), learningActivity({id: 'ack-once', audienceType: 'ROLE', audienceValue: 'equipe'}));
    await setDoc(doc(db, 'learningActivities', 'ack-versioned'), learningActivity({id: 'ack-versioned', recurrenceMode: 'ONCE_PER_VERSION', version: 3}));
    await setDoc(doc(db, 'learningActivities', 'ack-future'), learningActivity({id: 'ack-future', startAt: new Date(Date.now() + 86_400_000)}));
    await setDoc(doc(db, 'learningActivities', 'ack-expired'), learningActivity({id: 'ack-expired', endAt: new Date(Date.now() - 86_400_000)}));
    await setDoc(doc(db, 'learningActivities', 'ack-inactive'), learningActivity({id: 'ack-inactive', status: 'INACTIVE'}));
    await setDoc(doc(db, 'learningActivities', 'ack-hidden'), learningActivity({id: 'ack-hidden', showInTraining: false}));
    await setDoc(doc(db, 'learningActivities', 'ack-wrong-audience'), learningActivity({id: 'ack-wrong-audience', audienceType: 'ROLE', audienceValue: 'gestor'}));
    await setDoc(doc(db, 'learningActivities', 'ack-external'), learningActivity({id: 'ack-external', sourceKind: 'EXTERNAL_LINK', resourceUrl: 'https://example.invalid/resource', completionKind: 'NONE'}));
  });
  const reader = testEnvironment.authenticatedContext('learning-reader').firestore();
  const other = testEnvironment.authenticatedContext('learning-other').firestore();
  const noAccess = testEnvironment.authenticatedContext('learning-no-access').firestore();
  const manager = testEnvironment.authenticatedContext('learning-manager').firestore();
  const makeReceipt = (uid, activityId, version = 1) => ({
    id: activityId === 'ack-versioned' ? `${uid}_${activityId}_v${version}` : `${uid}_${activityId}_once`,
    activityId, activityVersion: version, uid, evidenceKind: 'ACKNOWLEDGEMENT', status: 'CONFIRMED', createdAt: serverTimestamp()
  });
  const onceId = 'learning-reader_ack-once_once';
  await assertSucceeds(setDoc(doc(reader, 'learningActivityReceipts', onceId), makeReceipt('learning-reader', 'ack-once')));
  await assertFails(setDoc(doc(reader, 'learningActivityReceipts', onceId), makeReceipt('learning-reader', 'ack-once')));
  await assertSucceeds(getDoc(doc(reader, 'learningActivityReceipts', onceId)));
  await assertFails(getDoc(doc(other, 'learningActivityReceipts', onceId)));
  await assertFails(updateDoc(doc(reader, 'learningActivityReceipts', onceId), {status: 'PENDING_VALIDATION'}));
  await assertFails(deleteDoc(doc(reader, 'learningActivityReceipts', onceId)));
  const versionedId = 'learning-reader_ack-versioned_v3';
  await assertSucceeds(setDoc(doc(reader, 'learningActivityReceipts', versionedId), makeReceipt('learning-reader', 'ack-versioned', 3)));
  await assertFails(setDoc(doc(reader, 'learningActivityReceipts', 'wrong-id'), makeReceipt('learning-reader', 'ack-versioned', 3)));
  await assertFails(setDoc(doc(reader, 'learningActivityReceipts', 'learning-reader_ack-versioned_v2'), makeReceipt('learning-reader', 'ack-versioned', 2)));
  for (const id of ['ack-future', 'ack-expired', 'ack-inactive', 'ack-hidden', 'ack-wrong-audience', 'ack-external']) {
    await assertFails(setDoc(doc(reader, 'learningActivityReceipts', `learning-reader_${id}_once`), makeReceipt('learning-reader', id)));
  }
  await assertFails(setDoc(doc(other, 'learningActivityReceipts', 'learning-other_ack-once_once'), makeReceipt('learning-other', 'ack-once')));
  await assertFails(setDoc(doc(noAccess, 'learningActivityReceipts', 'learning-no-access_ack-versioned_v3'), makeReceipt('learning-no-access', 'ack-versioned', 3)));
  await assertSucceeds(getDoc(doc(manager, 'learningActivityReceipts', 'missing-receipt')));
  await assertSucceeds(getDocs(query(collection(reader, 'learningActivityReceipts'), where('uid', '==', 'learning-reader'))));
  await assertFails(getDocs(query(collection(reader, 'learningActivityReceipts'), where('uid', '==', 'learning-other'))));
});

test('coleções não declaradas ficam fechadas por padrão', async () => {
  await seedProfiles([accessProfile('user')]);
  const user = testEnvironment.authenticatedContext('user').firestore();
  await assertFails(getDoc(doc(user, 'unlistedCollection', 'document')));
  await assertFails(getDoc(doc(user, 'syncQueue', 'report-job')));
  await assertFails(setDoc(doc(user, 'syncQueue', 'forged-report-job'), {
    id: 'forged-report-job', resourceType: 'events', resourceId: 'event-1', status: 'pending'
  }));
});

test('admin autor original edita Outros com nome de autoria e histórico completo', async () => {
  const uid = 'outros-admin';
  await seedProfiles([accessProfile(uid, {admin: true}, {role: 'administrador_app'})]);
  await seedEventCatalog(['Carlos'], ['Adelson']);
  const db = testEnvironment.authenticatedContext(uid).firestore();
  const id = 'outros-author-edit';
  const event = {
    id, clientMutationId: id, date: '2026-09-30', memberSigla: 'CM', scheduleSigla: 'CM',
    memberStatus: 'Carlos', eventType: 'Outros', description: 'Ffggggg', delayMultiple: 2,
    substitute: 'Adelson', shift: 'Manhã', payer: 'Carlos', creditor: 'Adelson', amountToPay: 1000,
    status: 'OPEN', active: true, createdByUid: uid, updatedByUid: uid,
    createdByName: uid, updatedByName: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), version: 1
  };
  await assertSucceeds(setDoc(doc(db, 'events', id), event));
  const saved = (await getDoc(doc(db, 'events', id))).data();
  await assertSucceeds(updateEventWithHistory(db, {
    eventId: id, event: saved, uid, updates: {description: 'Descrição corrigida'}, requestId: 'outros-description-edit'
  }));
  const edited = (await getDoc(doc(db, 'events', id))).data();
  await assertSucceeds(updateEventWithHistory(db, {
    eventId: id, event: edited, uid, updates: {amountToPay: 1200, delayMultiple: 3}, requestId: 'outros-values-edit'
  }));
  const final = (await getDoc(doc(db, 'events', id))).data();
  assert.equal(final.createdByUid, uid);
  assert.equal(final.createdByName, uid);
  assert.equal(final.version, 3);
  await assertFails(updateDoc(doc(db, 'events', id), {createdByName: 'Outra pessoa', updatedByUid: uid, updatedAt: serverTimestamp(), version: 4}));
  await assertFails(updateEventWithHistory(db, {
    eventId: id, event: final, uid, updates: {description: ''}, requestId: 'outros-empty-description'
  }));
});
