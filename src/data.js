import {and, collection, doc, getAggregateFromServer, getDocFromServer, getDocsFromServer, limit, orderBy, or, query, runTransaction, serverTimestamp, setDoc, startAfter, sum, Timestamp, updateDoc, where, writeBatch} from 'firebase/firestore';
import {db} from './firebase.js';
import {enqueueOperation, listQueuedOperations, listUnsettledOperations, pendingOperationCount, readSafeCache, removeQueuedOperation, updateCachedTrainingProgress, updateQueuedOperation, writeSafeCache} from './outbox.js';
import {MANAGEMENT_AREA_SEED} from './management-seed.js';
import {parseManagementUids} from './management-access.js';
import {parseCatalogValues, validateEventCatalog} from './event-catalog.js';
import {normalizeDriveDocumentUrl} from './drive-document.js';
import {mayQueueOffline, stageOperationalWrite} from './record-write.js';
import {updateScheduleReleaseState} from './schedule-release.js';
import {runKeyedTask} from './keyed-task.js';
import {DEFAULT_APP_FEATURES, normalizeAppFeatures} from './feature-flags.js';

const MAX_PAGE_SIZE = 50;
const SAFE_CACHE_MODULES = new Set(['management', 'checklist', 'training']);
const moduleCollections = Object.freeze({
  events: {name: 'events', order: 'date', direction: 'desc'},
  contacts: {name: 'contacts', order: 'sigla', direction: 'asc'},
  labels: {name: 'labels', order: 'date', direction: 'desc'},
  management: {name: 'managementAreas', order: 'order', direction: 'asc'},
  checklist: {name: 'stations', order: 'order', direction: 'asc'},
  training: {name: 'trainings', order: 'order', direction: 'asc'},
  notifications: {name: 'notifications', order: 'priority', direction: 'desc'}
});

function mayUseOfflineCache(error) {
  return ['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(error?.code) || (navigator.onLine === false && !error?.code);
}

export async function readSchedule(day, uid) {
  try {
    const snapshot = await getDocFromServer(doc(db, 'scheduleDays', day));
    if (!snapshot.exists()) return null;
    const value = {id: snapshot.id, ...snapshot.data()};
    if (uid) await writeSafeCache(uid, 'scheduleDays', day, value);
    return value;
  } catch (error) {
    if (!mayUseOfflineCache(error)) throw error;
    const cached = uid ? await readSafeCache(uid, 'scheduleDays', day) : null;
    if (cached?.data) return {...cached.data, stale: true};
    throw error;
  }
}

export async function setScheduleSiglaRelease(day, sigla, marked, {groupSiglas = [], tokenSigla = sigla, uid, currentSiglas = []} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || typeof marked !== 'boolean' || !uid) {
    throw new Error('Não foi possível identificar a marcação da escala.');
  }
  const operation = {day, sigla, marked, groupSiglas, tokenSigla};
  if (!navigator.onLine) return queueScheduleSiglaRelease(operation, {uid, currentSiglas});
  try {
    const updated = await applyScheduleSiglaRelease(operation, uid);
    await removeQueuedOperation(uid, scheduleReleaseRequestId(uid, operation));
    window.dispatchEvent(new CustomEvent('sahmt-write-synced', {detail: {type: 'scheduleReleaseDirect'}}));
    return updated;
  } catch (error) {
    if (!mayUseOfflineCache(error)) throw error;
    return queueScheduleSiglaRelease(operation, {uid, currentSiglas});
  }
}

async function applyScheduleSiglaRelease(operation, uid) {
  const reference = doc(db, 'scheduleDays', operation.day);
  const updated = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('A escala deste dia não está publicada.');
    const schedule = snapshot.data();
    const current = Array.isArray(schedule.highlights?.siglas) ? schedule.highlights.siglas : [];
    const result = updateScheduleReleaseState(current, operation);
    if (!result.changed) return {...schedule, id: snapshot.id};
    const version = (Number.isInteger(schedule.version) && schedule.version > 0 ? schedule.version : 0) + 1;
    transaction.update(reference, {
      'highlights.siglas': result.siglas,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
      version
    });
    return {...schedule, id: snapshot.id, updatedByUid: uid, version, highlights: {...schedule.highlights, siglas: result.siglas}};
  });
  await writeSafeCache(uid, 'scheduleDays', operation.day, updated).catch(() => {});
  return updated;
}

async function queueScheduleSiglaRelease(operation, {uid, currentSiglas = []}) {
  const result = updateScheduleReleaseState(currentSiglas, operation);
  const requestId = scheduleReleaseRequestId(uid, operation);
  if (result.changed) {
    await enqueueOperation({
      uid, type: 'scheduleReleases', resourceId: `${operation.day}:${operation.sigla}`, requestId,
      payload: operation, coalesce: true
    });
    const cached = await readSafeCache(uid, 'scheduleDays', operation.day);
    const schedule = cached?.data || {id: operation.day, date: operation.day, positions: [], highlights: {siglas: [], events: []}, version: 0};
    await writeSafeCache(uid, 'scheduleDays', operation.day, {
      ...schedule, stale: true, highlights: {...schedule.highlights, siglas: result.siglas}
    }).catch(() => {});
    return {...schedule, stale: true, pendingFirestore: true, highlights: {...schedule.highlights, siglas: result.siglas}};
  }
  const cached = await readSafeCache(uid, 'scheduleDays', operation.day);
  return cached?.data ? {...cached.data, stale: true, pendingFirestore: false} : {id: operation.day, date: operation.day, stale: true, pendingFirestore: false, highlights: {siglas: result.siglas, events: []}};
}

function scheduleReleaseRequestId(uid, operation) {
  return `schedule-release::${uid}::${operation.day}::${operation.sigla}`;
}

export async function listVacationsForDate(day, {pageSize = 100} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Informe uma data válida para consultar as férias.');
  const result = await getDocsFromServer(query(
    collection(db, 'vacations'),
    where('active', '==', true),
    where('start', '<=', day),
    where('end', '>=', day),
    orderBy('start', 'asc'),
    limit(Math.min(100, Math.max(1, pageSize)))
  ));
  return result.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function listModuleRecords(module, uid, {pageSize = MAX_PAGE_SIZE} = {}) {
  const config = moduleCollections[module];
  if (!config) throw new Error('Módulo de dados desconhecido.');
  const maxPageSize = module === 'checklist' ? 200 : MAX_PAGE_SIZE;
  const constraints = [where('active', '==', true), orderBy(config.order, config.direction), limit(Math.min(maxPageSize, Math.max(1, pageSize)))];
  try {
    const result = await getDocsFromServer(query(collection(db, config.name), ...constraints));
    const items = result.docs.map((item) => ({id: item.id, ...item.data()}));
    if (uid && SAFE_CACHE_MODULES.has(module)) await writeSafeCache(uid, config.name, 'active', items);
    return items;
  } catch (error) {
    if (!mayUseOfflineCache(error)) throw error;
    if (uid && SAFE_CACHE_MODULES.has(module)) {
      const cached = await readSafeCache(uid, config.name, 'active');
      if (Array.isArray(cached?.data)) return cached.data.map((item) => ({...item, stale: true}));
    }
    throw error;
  }
}

export async function getManagementArea(areaId) {
  if (!['area-gestao-da-qualidade', 'area-gestao-financeira'].includes(areaId)) return null;
  const snapshot = await getDocFromServer(doc(db, 'managementAreas', areaId));
  return snapshot.exists() && snapshot.data().active === true ? {id: snapshot.id, ...snapshot.data()} : null;
}

export async function saveAppFeatures(input, actorUid) {
  const featureKeys = Object.keys(DEFAULT_APP_FEATURES);
  if (!actorUid || !input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !featureKeys.includes(key)) ||
      featureKeys.some((key) => typeof input[key] !== 'boolean')) {
    throw new Error('As configurações de módulos estão inválidas.');
  }
  const features = normalizeAppFeatures(input);
  const reference = doc(db, 'appConfig', 'app');
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists()) {
      const current = snapshot.data();
      transaction.update(reference, {
        features,
        updatedByUid: actorUid,
        updatedAt: serverTimestamp(),
        version: current.version + 1
      });
    } else {
      transaction.set(reference, {
        id: 'app',
        features,
        createdByUid: actorUid,
        createdAt: serverTimestamp(),
        updatedByUid: actorUid,
        updatedAt: serverTimestamp(),
        version: 1
      });
    }
  });
  try { await writeSafeCache(actorUid, 'appConfig', 'app', {features}); } catch { /* Server save already succeeded; cache is best-effort. */ }
  return features;
}

export async function listNotifications(profile, {pageSize = 100, canManage = false} = {}) {
  const uid = profile?.uid;
  if (!uid) return [];
  const now = Timestamp.now();
  if (canManage) {
    const snapshot = await getDocsFromServer(query(collection(db, 'notifications'), where('active', '==', true), where('startAt', '<=', now), where('endAt', '>=', now), orderBy('priority', 'desc'), limit(Math.min(100, Math.max(1, pageSize)))));
    const nowMs = now.toMillis();
    return snapshot.docs.map((item) => ({id: item.id, ...item.data()})).filter((item) => {
      const start = typeof item.startAt?.toMillis === 'function' ? item.startAt.toMillis() : new Date(item.startAt).getTime();
      const end = typeof item.endAt?.toMillis === 'function' ? item.endAt.toMillis() : new Date(item.endAt).getTime();
      return start <= nowMs && end >= nowMs;
    });
  }
  const [memberAreas, managedAreas, groups] = await Promise.all([
    getDocsFromServer(query(collection(db, 'managementAreas'), where('active', '==', true), where('memberUids', 'array-contains', uid), limit(50))),
    getDocsFromServer(query(collection(db, 'managementAreas'), where('active', '==', true), where('managerUids', 'array-contains', uid), limit(50))),
    getDocsFromServer(query(collection(db, 'notificationGroups'), where('active', '==', true), where('memberUids', 'array-contains', uid), limit(50)))
  ]);
  const targets = new Map();
  const addTarget = (type, value) => targets.set(JSON.stringify([type, value]), {type, value});
  addTarget('ALL', '');
  addTarget('USER', uid);
  if (profile.role) addTarget('ROLE', profile.role);
  if (profile.sigla) addTarget('SIGLA', profile.sigla);
  for (const area of [...memberAreas.docs, ...managedAreas.docs]) addTarget('MANAGEMENT_AREA', area.id);
  for (const group of groups.docs) addTarget('GROUP', group.id);
  const targetList = [...targets.values()];
  const batchSize = 30;
  const snapshots = await Promise.all(Array.from({length: Math.ceil(targetList.length / batchSize)}, (_, index) => {
    const batch = targetList.slice(index * batchSize, (index + 1) * batchSize);
    const audienceFilters = batch.map(({type: audienceType, value}) => and(
      where('audienceType', '==', audienceType), where('audienceValue', '==', value)
    ));
    const audienceFilter = audienceFilters.length === 1 ? audienceFilters[0] : or(...audienceFilters);
    return getDocsFromServer(query(
      collection(db, 'notifications'), and(where('active', '==', true), where('startAt', '<=', now), where('endAt', '>=', now), audienceFilter),
      orderBy('priority', 'desc'), limit(Math.min(100, Math.max(1, pageSize)))
    ));
  }));
  const nowMs = now.toMillis();
  const byId = new Map();
  for (const snapshot of snapshots) for (const item of snapshot.docs) {
    const notification = {id: item.id, ...item.data()};
    const startsAt = typeof notification.startAt?.toMillis === 'function' ? notification.startAt.toMillis() : new Date(notification.startAt).getTime();
    const endsAt = typeof notification.endAt?.toMillis === 'function' ? notification.endAt.toMillis() : new Date(notification.endAt).getTime();
    if (Number.isFinite(startsAt) && startsAt <= nowMs && Number.isFinite(endsAt) && endsAt >= nowMs) byId.set(item.id, notification);
  }
  const notifications = [...byId.values()].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || dateSortValue(b.createdAt) - dateSortValue(a.createdAt)).slice(0, Math.min(100, Math.max(1, pageSize)));
  const ids = notifications.map((item) => item.id);
  const receiptResults = await Promise.all(Array.from({length: Math.ceil(ids.length / 30)}, (_, index) => {
    const group = ids.slice(index * 30, index * 30 + 30);
    return getDocsFromServer(query(
      collection(db, 'users', uid, 'notificationReads'), where('notificationId', 'in', group)
    ));
  }));
  const readIds = new Set(receiptResults.flatMap((result) => result.docs.map((receipt) => receipt.id)));
  return notifications.map((item) => ({...item, read: readIds.has(item.id)}));
}

export async function markNotificationRead(notificationId, uid) {
  if (!notificationId || !uid) throw new Error('Comunicado ou usuário inválido.');
  const ref = doc(db, 'users', uid, 'notificationReads', notificationId);
  try {
    await setDoc(ref, {id: notificationId, notificationId, uid, readAt: serverTimestamp()});
    return true;
  } catch (error) {
    const confirmed = await getDocFromServer(ref).catch(() => null);
    const receipt = confirmed?.exists() ? confirmed.data() : null;
    if (receipt?.id === notificationId && receipt.notificationId === notificationId && receipt.uid === uid) return false;
    throw error;
  }
}

export async function createNotification(input, uid) {
  const title = String(input.title || '').trim();
  const message = String(input.message || '').trim();
  const audienceType = String(input.audienceType || 'ALL');
  const audienceValue = String(input.audienceValue || '').trim();
  const startAt = String(input.startAt || '');
  const endAt = String(input.endAt || '');
  const priority = Number(input.priority || 0);
  const startDate = startAt ? new Date(`${startAt}T00:00:00-03:00`) : null;
  const endDate = endAt ? new Date(`${endAt}T23:59:59.999-03:00`) : null;
  if (!uid || !title || title.length > 120 || !message || message.length > 1200 || !startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate ||
      !['ALL', 'ROLE', 'USER', 'SIGLA', 'MANAGEMENT_AREA', 'GROUP'].includes(audienceType) || !Number.isInteger(priority) || priority < 0 || priority > 5) {
    throw new Error('Confira título, mensagem, público, datas e prioridade.');
  }
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'notifications', id), {
    id, title, message, type: String(input.type || 'INFO'), audienceType,
    audienceValue: audienceType === 'ALL' ? '' : audienceValue,
    createdAt: serverTimestamp(), createdByUid: uid, startAt: startDate, endAt: endDate,
    active: true, priority, actionRoute: String(input.actionRoute || '')
  });
  return id;
}

export async function listContactCatalog({pageSize = 200} = {}) {
  const result = await getDocsFromServer(query(
    collection(db, 'contacts'),
    orderBy('sigla', 'asc'),
    limit(Math.min(200, Math.max(1, pageSize)))
  ));
  return result.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function listLabelStaffSiglas() {
  const snapshot = await getDocFromServer(doc(db, 'appConfig', 'labelStaff'));
  if (!snapshot.exists() || snapshot.data().active !== true || !Array.isArray(snapshot.data().siglas)) return [];
  return [...new Set(snapshot.data().siglas.map((value) => String(value || '').trim().toUpperCase()).filter((value) => /^(?:[A-Z]{2}|L2)$/.test(value)))].sort();
}

export async function saveLabelStaffSiglas(values, uid) {
  const siglas = [...new Set((Array.isArray(values) ? values : String(values || '').split(/[\n,;]+/))
    .map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))].sort();
  if (!uid || siglas.length > 80 || siglas.some((value) => !/^(?:[A-Z]{2}|L2)$/.test(value))) {
    throw new Error('Informe até 80 siglas válidas (duas letras ou L2).');
  }
  const reference = doc(db, 'appConfig', 'labelStaff');
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists()) {
      const current = snapshot.data();
      transaction.update(reference, {siglas, active: true, updatedByUid: uid, updatedAt: serverTimestamp(), version: current.version + 1});
    } else {
      transaction.set(reference, {id: 'labelStaff', siglas, active: true, createdByUid: uid, createdAt: serverTimestamp(), updatedByUid: uid, updatedAt: serverTimestamp(), version: 1});
    }
  });
  return siglas;
}

export async function saveContact(input, actorUid) {
  const sigla = String(input.sigla || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  const whatsAppLink = String(input.whatsAppLink || '').trim();
  if (!/^(?:[A-Z]{2}|L2)$/.test(sigla) || !name || name.length > 120) {
    throw new Error('Informe uma sigla válida e o nome do contato.');
  }
  if (whatsAppLink && !/^https:\/\/(?:wa\.me\/\d+|api\.whatsapp\.com\/send\?phone=\d+)$/.test(whatsAppLink)) {
    throw new Error('O link de WhatsApp deve usar um endereço wa.me ou api.whatsapp.com com telefone numérico.');
  }
  const ref = doc(db, 'contacts', sigla);
  const current = await getDocFromServer(ref);
  const record = {
    sigla, name,
    role: String(input.role || '').trim().slice(0, 80),
    phone: String(input.phone || '').trim().slice(0, 40),
    email: String(input.email || '').trim().toLowerCase().slice(0, 200),
    whatsAppLink,
    crm: String(input.crm || '').trim().slice(0, 40),
    entryDate: String(input.entryDate || '').trim().slice(0, 32),
    active: input.active === true,
    createdByUid: current.exists() ? current.data().createdByUid : actorUid,
    createdAt: current.exists() ? current.data().createdAt : serverTimestamp(),
    updatedByUid: actorUid,
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, record);
  return {id: sigla, ...record};
}

export async function listUserProfiles({pageSize = 200} = {}) {
  const result = await getDocsFromServer(query(
    collection(db, 'users'),
    orderBy('displayName', 'asc'),
    limit(Math.min(200, Math.max(1, pageSize)))
  ));
  return result.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function saveUserProfile(input, actorUid) {
  const uid = String(input.uid || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const displayName = String(input.displayName || '').trim();
  const sigla = String(input.sigla || '').trim().toUpperCase();
  const phone = String(input.phone || '').trim();
  const role = String(input.role || '').trim();
  const roleIds = ['coordenador', 'conselho_diretor', 'gestor', 'anestesiologista', 'residente', 'temporario', 'administrador_app'];
  const permissionIds = ['checklistRead', 'checklistWrite', 'checklistSign', 'checklistManage', 'labelsRead', 'labelsWrite', 'labelsManage', 'eventsRead', 'eventsWrite', 'eventsCatalogManage', 'scheduleRead', 'scheduleWrite', 'trainingsRead', 'trainingsManage', 'managementRead', 'managementManage', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage', 'qualityManage', 'equipmentManage', 'peopleManage', 'financeRead', 'financeWrite', 'financeManage', 'notificationsRead', 'notificationsManage', 'usersManage', 'admin'];
  if (!/^[^\s\/]{1,128}$/.test(uid) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName || displayName.length > 120 || sigla.length > 20 || phone.length > 40 || !roleIds.includes(role)) {
    throw new Error('Confira UID, e-mail, nome, sigla, telefone e função antes de salvar.');
  }
  if (uid === actorUid && input.permissions) throw new Error('O administrador não pode alterar as próprias permissões por este formulário.');
  const permissions = Object.fromEntries(Object.entries(input.permissions || {})
    .filter(([permission, enabled]) => permissionIds.includes(permission) && enabled === true));
  const ref = doc(db, 'users', uid);
  const current = await getDocFromServer(ref);
  const record = {
    uid, email, displayName, sigla, phone,
    active: input.active === true,
    access: input.access === true,
    role,
    permissions,
    createdAt: current.exists() ? current.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, record);
  return {id: uid, ...record};
}

export async function ensureManagementAreaCatalog(uid) {
  if (!uid) throw new Error('A sessão expirou. Entre novamente.');
  if (!navigator.onLine) throw new Error('É necessária uma conexão para preparar o catálogo de Gestão.');
  return runTransaction(db, async (transaction) => {
    const refs = MANAGEMENT_AREA_SEED.map((item) => doc(db, 'managementAreas', item.id));
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const missing = snapshots.flatMap((snapshot, index) => snapshot.exists() ? [] : [{ref: refs[index], area: MANAGEMENT_AREA_SEED[index]}]);
    for (const {ref, area} of missing) {
      transaction.set(ref, {
        id: area.id,
        name: area.name,
        shortName: '',
        description: '',
        icon: '',
        order: area.order,
        active: true,
        status: 'ACTIVE',
        managerUids: [],
        memberUids: [],
        permissions: {},
        version: 1,
        createdByUid: uid,
        updatedByUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
    return {created: missing.length, existing: snapshots.length - missing.length};
  });
}

export async function updateManagementAreaAssignments(areaId, {managerUids, memberUids, version} = {}, uid) {
  if (!uid || !areaId || !Number.isInteger(version) || version < 0) {
    throw new Error('Atualize a área e confira a sessão antes de alterar responsáveis.');
  }
  const managers = parseManagementUids(managerUids);
  const members = parseManagementUids(memberUids);
  const reference = doc(db, 'managementAreas', areaId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('A área não existe mais. Atualize a lista de Gestão.');
    const current = snapshot.data();
    const currentVersion = Number.isInteger(current.version) && current.version >= 0 ? current.version : 0;
    if (currentVersion !== version) throw new Error('A área foi atualizada por outra pessoa. Recarregue antes de salvar novamente.');
    const updated = {
      managerUids: managers,
      memberUids: members,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
      version: currentVersion + 1
    };
    transaction.update(reference, updated);
    return {...current, ...updated, updatedAt: new Date().toISOString()};
  });
}

export async function listManagementActivities(managementAreaId, {pageSize = 30} = {}) {
  if (!managementAreaId) return [];
  const maxItems = Math.min(50, Math.max(1, pageSize));
  const dueResult = await getDocsFromServer(query(
    collection(db, 'activities'),
    where('managementAreaId', '==', managementAreaId),
    where('dueAt', '>=', '0000-01-01'),
    orderBy('dueAt', 'asc'),
    orderBy('createdAt', 'desc'),
    limit(maxItems)
  ));
  const dueItems = dueResult.docs.map((item) => ({id: item.id, ...item.data()}));
  if (dueItems.length >= maxItems) return dueItems;

  const undatedResult = await getDocsFromServer(query(
    collection(db, 'activities'),
    where('managementAreaId', '==', managementAreaId),
    where('dueAt', '==', null),
    orderBy('createdAt', 'desc'),
    limit(maxItems - dueItems.length)
  ));
  return [...dueItems, ...undatedResult.docs.map((item) => ({id: item.id, ...item.data()}))];
}

const MANAGEMENT_TASK_SCORING_RULE_ID = 'management-task-completion-v1';

export async function getManagementTaskScoringRule() {
  const snapshot = await getDocFromServer(doc(db, 'scoringRules', MANAGEMENT_TASK_SCORING_RULE_ID));
  return snapshot.exists() ? {id: snapshot.id, ...snapshot.data()} : null;
}

export async function saveManagementTaskScoringRule(input, uid) {
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  const points = Number(input.points);
  const active = input.active !== false;
  const version = Number(input.version || 0);
  if (!uid || !name || name.length > 120 || description.length > 500 || !Number.isInteger(points) || points < 1 || points > 1000 || !Number.isInteger(version) || version < 0) {
    throw new Error('Confira nome, descrição e pontos inteiros entre 1 e 1.000.');
  }
  const reference = doc(db, 'scoringRules', MANAGEMENT_TASK_SCORING_RULE_ID);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) {
      if (version !== 0) throw new Error('A regra foi alterada por outra pessoa. Atualize a tela.');
      const record = {
        id: MANAGEMENT_TASK_SCORING_RULE_ID, name, description,
        sourceType: 'MANAGEMENT_TASK_COMPLETION', points, active,
        version: 1, createdByUid: uid, createdAt: serverTimestamp(),
        updatedByUid: uid, updatedAt: serverTimestamp()
      };
      transaction.set(reference, record);
      return {...record, version: 1};
    }
    const current = snapshot.data();
    if (current.version !== version || version < 1) throw new Error('A regra foi alterada por outra pessoa. Atualize a tela.');
    const record = {name, description, points, active, updatedByUid: uid, updatedAt: serverTimestamp(), version: version + 1};
    transaction.update(reference, record);
    return {...current, ...record, updatedAt: new Date().toISOString()};
  });
}

export async function completeManagementActivity(activityId, uid) {
  if (!activityId || activityId.length > 128 || !uid) throw new Error('Não foi possível identificar esta atividade ou sessão.');
  const activityRef = doc(db, 'activities', activityId);
  const interactionId = `completion-${activityId}`;
  const interactionRef = doc(db, 'activityInteractions', interactionId);
  return runTransaction(db, async (transaction) => {
    const [activitySnapshot, interactionSnapshot] = await Promise.all([
      transaction.get(activityRef), transaction.get(interactionRef)
    ]);
    if (!activitySnapshot.exists()) throw new Error('A atividade não está disponível. Atualize a lista.');
    const activity = activitySnapshot.data();
    if (activity.status === 'COMPLETED') {
      if (!interactionSnapshot.exists() || interactionSnapshot.data().type !== 'COMPLETION' || interactionSnapshot.data().activityId !== activityId) {
        throw new Error('A conclusão não tem registro de auditoria consistente. Solicite revisão da Gestão.');
      }
      return {completed: true, alreadyCompleted: true, pointsPending: interactionSnapshot.data().pointsStatus === 'PENDING_VALIDATION'};
    }
    if (activity.status !== 'IN_PROGRESS' || !Array.isArray(activity.responsibleUids) || !activity.responsibleUids.includes(uid)) {
      throw new Error('Inicie a atividade e confirme se ela está atribuída a você.');
    }
    if (activity.evidenceRequired === true) throw new Error('Esta atividade exige evidência e ainda não possui validação segura.');
    if (interactionSnapshot.exists()) throw new Error('Já existe um registro de conclusão para esta atividade. Atualize a lista.');
    const pointsPending = activity.pointsEnabled === true && Number.isInteger(activity.points) && activity.points > 0;
    transaction.update(activityRef, {
      status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: uid,
      updatedAt: serverTimestamp(), version: (Number(activity.version) || 0) + 1
    });
    transaction.set(interactionRef, {
      id: interactionId, activityId, uid, type: 'COMPLETION',
      content: 'Atividade concluída pelo responsável.', evidence: null, pointsGenerated: 0,
      ...(pointsPending ? {pointsClaimed: activity.points, pointsStatus: 'PENDING_VALIDATION'} : {pointsClaimed: 0, pointsStatus: 'NOT_APPLICABLE'}),
      createdAt: serverTimestamp()
    });
    return {completed: true, alreadyCompleted: false, pointsAwarded: 0, pointsPending};
  });
}

export async function cancelManagementActivity(activityId, uid) {
  if (!activityId || activityId.length > 128 || !uid) throw new Error('Não foi possível identificar esta atividade ou sessão.');
  const activityRef = doc(db, 'activities', activityId);
  const profileRef = doc(db, 'users', uid);
  const interactionId = `cancellation-${activityId}`;
  const interactionRef = doc(db, 'activityInteractions', interactionId);
  return runTransaction(db, async (transaction) => {
    const [activitySnapshot, interactionSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(activityRef), transaction.get(interactionRef), transaction.get(profileRef)
    ]);
    if (!activitySnapshot.exists()) throw new Error('A atividade não está disponível. Atualize a lista.');
    const activity = activitySnapshot.data();
    if (activity.status === 'CANCELLED') {
      if (!interactionSnapshot.exists() || interactionSnapshot.data().type !== 'CANCELLATION' || interactionSnapshot.data().activityId !== activityId) {
        throw new Error('O cancelamento não tem registro de auditoria consistente. Solicite revisão da Gestão.');
      }
      return {cancelled: true, alreadyCancelled: true};
    }
    const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
    const isManager = profile.active === true && profile.access === true && (profile.role === 'administrador_app' || profile.permissions?.admin === true || profile.permissions?.managementManage === true);
    if (!['OPEN', 'IN_PROGRESS'].includes(activity.status) || (activity.createdByUid !== uid && !isManager)) {
      throw new Error('Somente quem criou a atividade ou a Gestão pode cancelá-la.');
    }
    if (interactionSnapshot.exists()) throw new Error('Já existe um registro de cancelamento. Atualize a lista.');
    transaction.update(activityRef, {
      status: 'CANCELLED', completedAt: null, updatedByUid: uid,
      updatedAt: serverTimestamp(), version: (Number(activity.version) || 0) + 1
    });
    transaction.set(interactionRef, {
      id: interactionId, activityId, uid, type: 'CANCELLATION',
      content: 'Atividade cancelada pela pessoa criadora ou pela Gestão.', evidence: null,
      pointsGenerated: 0, createdAt: serverTimestamp()
    });
    return {cancelled: true, alreadyCancelled: false};
  });
}

export async function listManagementDocuments(managementAreaId, {includeInactive = false, pageSize = 50} = {}) {
  if (!managementAreaId) return [];
  const constraints = [where('managementAreaId', '==', managementAreaId)];
  if (!includeInactive) constraints.push(where('active', '==', true));
  constraints.push(orderBy('publishedAt', 'desc'));
  constraints.push(limit(Math.min(100, Math.max(1, pageSize))));
  const snapshot = await getDocsFromServer(query(collection(db, 'documents'), ...constraints));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function saveManagementDocument(input, uid) {
  const id = String(input.documentId || '').trim() || crypto.randomUUID();
  const managementAreaId = String(input.managementAreaId || '').trim();
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const category = String(input.category || '').trim();
  const {driveFileId, driveUrl} = normalizeDriveDocumentUrl(input.driveUrl);
  const currentVersion = Number(input.version || 0);
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id) || !uid || !managementAreaId || !title || title.length > 160 || description.length > 1200 || !category || category.length > 80 || !Number.isInteger(currentVersion) || currentVersion < 0 || currentVersion > 100) {
    throw new Error('Confira a área, o título, a categoria e o link do documento.');
  }
  const ref = doc(db, 'documents', id);
  const content = {managementAreaId, title, description, driveFileId, driveUrl, category, active: input.active !== false, requiredReading: input.requiredReading === true};
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      if (currentVersion !== 0) throw new Error('O documento foi removido ou mudou. Atualize a lista.');
      transaction.set(ref, {
        ...content, id, version: 1, publishedAt: serverTimestamp(), createdByUid: uid,
        createdAt: serverTimestamp(), updatedByUid: uid, updatedAt: serverTimestamp()
      });
      return;
    }
    const existing = snapshot.data();
    if (currentVersion === 0 && existing.version === 1 && existing.createdByUid === uid &&
        ['managementAreaId', 'title', 'description', 'driveFileId', 'driveUrl', 'category', 'active', 'requiredReading'].every((key) => existing[key] === content[key])) return;
    if (existing.version !== currentVersion || currentVersion < 1) throw new Error('Este documento foi atualizado por outra pessoa. Atualize a lista antes de editar.');
    transaction.update(ref, {...content, updatedByUid: uid, updatedAt: serverTimestamp(), version: currentVersion + 1});
  });
  return id;
}

export async function listEquipmentForArea(managementAreaId, {pageSize = 100} = {}) {
  if (!managementAreaId) return [];
  const snapshot = await getDocsFromServer(query(
    collection(db, 'equipment'),
    where('managementAreaId', '==', managementAreaId),
    orderBy('tag', 'asc'),
    limit(Math.min(200, Math.max(1, pageSize)))
  ));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function listEquipmentEventsForArea(managementAreaId, {pageSize = 100} = {}) {
  if (!managementAreaId) return [];
  const snapshot = await getDocsFromServer(query(collection(db, 'equipmentEvents'), where('managementAreaId', '==', managementAreaId), orderBy('createdAt', 'desc'), limit(Math.min(200, Math.max(1, pageSize)))));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function listMaintenanceRecordsForArea(managementAreaId, {pageSize = 100} = {}) {
  if (!managementAreaId) return [];
  const snapshot = await getDocsFromServer(query(collection(db, 'maintenanceRecords'), where('managementAreaId', '==', managementAreaId), orderBy('updatedAt', 'desc'), limit(Math.min(200, Math.max(1, pageSize)))));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function saveEquipment(input, uid) {
  const tag = String(input.tag || '').trim().toUpperCase();
  const id = String(input.equipmentId || tag).trim();
  const managementAreaId = String(input.managementAreaId || '').trim();
  const name = String(input.name || '').trim();
  const category = String(input.category || '').trim();
  const serialNumber = String(input.serialNumber || '').trim();
  const location = String(input.location || '').trim();
  const responsibleUid = String(input.responsibleUid || uid || '').trim();
  const currentVersion = Number(input.version || 0);
  if (!uid || !/^[A-Z0-9_-]{2,40}$/.test(id) || tag !== id || !managementAreaId || !name || name.length > 160 || !category || category.length > 80 || serialNumber.length > 120 || !location || location.length > 160 || !responsibleUid || responsibleUid.length > 128 || !Number.isInteger(currentVersion) || currentVersion < 0 || currentVersion > 100) {
    throw new Error('Confira identificação, nome, categoria, localização e responsável do equipamento.');
  }
  const ref = doc(db, 'equipment', id);
  const content = {id, tag, managementAreaId, name, category, serialNumber, location, responsibleUid};
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      if (currentVersion !== 0) throw new Error('O equipamento mudou ou foi removido. Atualize o catálogo.');
      transaction.set(ref, {...content, status: 'OPERATIONAL', active: true, lastEventId: null, lastEventAt: null, version: 1, createdByUid: uid, createdAt: serverTimestamp(), updatedByUid: uid, updatedAt: serverTimestamp()});
      return;
    }
    const existing = snapshot.data();
    if (currentVersion === 0 && existing.version === 1 && existing.createdByUid === uid && ['id', 'tag', 'managementAreaId', 'name', 'category', 'serialNumber', 'location', 'responsibleUid'].every((key) => existing[key] === content[key])) return;
    if (currentVersion < 1 || existing.version !== currentVersion) throw new Error('Este equipamento foi alterado por outra pessoa. Atualize antes de editar.');
    transaction.update(ref, {...content, updatedByUid: uid, updatedAt: serverTimestamp(), version: currentVersion + 1});
  });
  return id;
}

export async function setEquipmentActive(equipmentId, active, expectedVersion, uid) {
  if (!equipmentId || !uid || typeof active !== 'boolean' || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('Equipamento ou versão inválidos.');
  const ref = doc(db, 'equipment', equipmentId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().version !== expectedVersion) throw new Error('O equipamento mudou. Atualize o catálogo.');
    if (active && snapshot.data().status === 'RETIRED') throw new Error('Equipamento retirado não pode ser reativado. Registre uma substituição com nova identificação.');
    transaction.update(ref, {active, updatedByUid: uid, updatedAt: serverTimestamp(), version: expectedVersion + 1});
  });
}

export async function recordEquipmentEvent(input, uid) {
  const id = String(input.eventId || '').trim();
  const equipmentId = String(input.equipmentId || '').trim();
  const type = String(input.type || '').trim();
  const description = String(input.description || '').trim();
  const requestedStatus = String(input.toStatus || '').trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id) || !equipmentId || !uid || !['INCIDENT', 'STATUS_CHANGE'].includes(type) || !description || description.length > 1000 || (type === 'STATUS_CHANGE' && !['OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED'].includes(requestedStatus))) {
    throw new Error('Informe tipo, descrição e situação válidos para o evento.');
  }
  const equipmentRef = doc(db, 'equipment', equipmentId);
  const eventRef = doc(db, 'equipmentEvents', id);
  await runTransaction(db, async (transaction) => {
    const [equipmentSnapshot, eventSnapshot] = await Promise.all([transaction.get(equipmentRef), transaction.get(eventRef)]);
    const equipment = equipmentSnapshot.exists() ? equipmentSnapshot.data() : null;
    const toStatus = type === 'STATUS_CHANGE' ? requestedStatus : equipment?.status;
    const event = {id, equipmentId, managementAreaId: equipment?.managementAreaId, type, description, fromStatus: equipment?.status, toStatus, createdByUid: uid};
    if (eventSnapshot.exists()) {
      const existing = eventSnapshot.data();
      if (existing.createdByUid === uid && existing.equipmentId === equipmentId && existing.type === type && existing.description === description &&
          (type === 'STATUS_CHANGE' ? existing.toStatus === requestedStatus : existing.fromStatus === existing.toStatus)) return;
      throw new Error('O ID deste evento já foi usado. Atualize e tente novamente.');
    }
    if (!equipment || equipment.active !== true) throw new Error('O equipamento está indisponível ou inativo.');
    if (type === 'STATUS_CHANGE' && requestedStatus === equipment.status) throw new Error('Escolha uma situação diferente para registrar a alteração.');
    transaction.set(eventRef, {...event, createdAt: serverTimestamp()});
    transaction.update(equipmentRef, {status: toStatus, active: type === 'STATUS_CHANGE' && toStatus === 'RETIRED' ? false : equipment.active, lastEventId: id, lastEventAt: serverTimestamp(), version: equipment.version + 1, updatedByUid: uid, updatedAt: serverTimestamp()});
  });
  return id;
}

export async function createMaintenanceRecord(input, uid) {
  const id = String(input.recordId || '').trim();
  const equipmentId = String(input.equipmentId || '').trim();
  const type = String(input.type || '').trim();
  const description = String(input.description || '').trim();
  const responsibleUid = String(input.responsibleUid || uid || '').trim();
  const dueAt = String(input.dueAt || '').trim() || null;
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id) || !equipmentId || !uid || !['PREVENTIVE', 'CORRECTIVE', 'CALIBRATION', 'INSPECTION'].includes(type) || !description || description.length > 1000 || !responsibleUid || responsibleUid.length > 128 || (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt))) {
    throw new Error('Confira o tipo, a descrição, o responsável e o prazo da manutenção.');
  }
  const equipmentRef = doc(db, 'equipment', equipmentId);
  const recordRef = doc(db, 'maintenanceRecords', id);
  const content = {id, equipmentId, type, description, responsibleUid, dueAt};
  await runTransaction(db, async (transaction) => {
    const [equipmentSnapshot, recordSnapshot] = await Promise.all([transaction.get(equipmentRef), transaction.get(recordRef)]);
    if (recordSnapshot.exists()) {
      const existing = recordSnapshot.data();
      if (existing.createdByUid === uid && existing.version === 1 && Object.entries(content).every(([key, value]) => existing[key] === value)) return;
      throw new Error('O ID deste registro de manutenção já foi usado. Atualize e tente novamente.');
    }
    const equipment = equipmentSnapshot.exists() ? equipmentSnapshot.data() : null;
    if (!equipment || equipment.active !== true) throw new Error('O equipamento está indisponível ou inativo.');
    transaction.set(recordRef, {...content, managementAreaId: equipment.managementAreaId, status: 'OPEN', completedAt: null, version: 1, createdByUid: uid, createdAt: serverTimestamp(), updatedByUid: uid, updatedAt: serverTimestamp()});
  });
  return id;
}

export async function transitionMaintenanceRecord(recordId, nextStatus, uid) {
  if (!recordId || !uid || !['IN_PROGRESS', 'COMPLETED'].includes(nextStatus)) throw new Error('Registro ou estado inválidos.');
  const ref = doc(db, 'maintenanceRecords', recordId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('A manutenção não existe mais. Atualize o histórico.');
    const current = snapshot.data();
    const valid = (current.status === 'OPEN' && nextStatus === 'IN_PROGRESS') || (current.status === 'IN_PROGRESS' && nextStatus === 'COMPLETED');
    if (!valid) throw new Error('O estado da manutenção mudou. Atualize o histórico.');
    transaction.update(ref, {status: nextStatus, completedAt: nextStatus === 'COMPLETED' ? serverTimestamp() : null, updatedByUid: uid, updatedAt: serverTimestamp(), version: current.version + 1});
  });
}

export async function transitionManagementActivity(activityId, nextStatus, uid) {
  if (!activityId || !uid || nextStatus !== 'IN_PROGRESS') {
    throw new Error('Não foi possível identificar a atividade ou o próximo estado.');
  }
  const ref = doc(db, 'activities', activityId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Esta atividade não está mais disponível. Atualize a lista.');
    const activity = snapshot.data();
    const ownsActivity = Array.isArray(activity.responsibleUids) && activity.responsibleUids.includes(uid);
    const validTransition = activity.status === 'OPEN' && nextStatus === 'IN_PROGRESS';
    if (!ownsActivity || !validTransition) throw new Error('O estado desta atividade mudou ou ela não está atribuída a você. Atualize a lista.');
    transaction.update(ref, {
      status: 'IN_PROGRESS',
      completedAt: null,
      updatedByUid: uid,
      updatedAt: serverTimestamp()
    });
  });
}

export async function listActivityInteractions(activityId, uid, {canReadAll = false, pageSize = 20} = {}) {
  if (!activityId || !uid) return [];
  const constraints = [where('activityId', '==', activityId)];
  if (!canReadAll) constraints.push(where('uid', '==', uid));
  constraints.push(orderBy('createdAt', 'desc'), limit(Math.min(50, Math.max(1, pageSize))));
  const snapshot = await getDocsFromServer(query(collection(db, 'activityInteractions'), ...constraints));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function addActivityInteraction(activityId, content, uid) {
  const cleanContent = String(content || '').trim();
  if (!activityId || !uid || !cleanContent || cleanContent.length > 1000) throw new Error('Escreva um comentário de até 1.000 caracteres.');
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'activityInteractions', id), {
    id, activityId, uid, type: 'COMMENT', content: cleanContent, createdAt: serverTimestamp(), evidence: null, pointsGenerated: 0
  });
  return id;
}

export async function listManagementIndicators(managementAreaId, {pageSize = 30} = {}) {
  if (!managementAreaId) return [];
  const snapshot = await getDocsFromServer(query(
    collection(db, 'indicators'),
    where('managementAreaId', '==', managementAreaId),
    where('active', '==', true),
    orderBy('name', 'asc'),
    limit(Math.min(50, Math.max(1, pageSize)))
  ));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function listIndicatorMeasurements(indicatorId, {pageSize = 12} = {}) {
  if (!indicatorId) return [];
  const snapshot = await getDocsFromServer(query(
    collection(db, 'indicatorMeasurements'),
    where('indicatorId', '==', indicatorId),
    orderBy('period', 'desc'),
    limit(Math.min(24, Math.max(1, pageSize)))
  ));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function createManagementIndicator(input, uid) {
  const managementAreaId = String(input.managementAreaId || '').trim();
  const name = String(input.name || '').trim();
  const unit = String(input.unit || '').trim();
  const target = Number(input.target);
  const direction = String(input.direction || 'MIN');
  const frequency = String(input.frequency || 'MONTHLY');
  if (!uid || !managementAreaId || !name || name.length > 120 || unit.length > 40 || !Number.isFinite(target) || !['MIN', 'MAX', 'TARGET'].includes(direction) || !['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'].includes(frequency)) {
    throw new Error('Confira nome, unidade, meta, direção e frequência do indicador.');
  }
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'indicators', id), {
    id, managementAreaId, name, description: String(input.description || '').trim().slice(0, 500), unit,
    target, direction, frequency, ownerUid: uid, active: true,
    createdByUid: uid, createdAt: serverTimestamp(), updatedByUid: uid, updatedAt: serverTimestamp()
  });
  return id;
}

export async function recordIndicatorMeasurement(indicator, input, uid) {
  const period = String(input.period || '').trim();
  const value = Number(input.value);
  const notes = String(input.notes || '').trim();
  if (!uid || !indicator?.id || !/^(?:\d{4}|\d{4}-(?:W\d{2}|\d{2}|Q[1-4]))$/.test(period) || !Number.isFinite(value) || notes.length > 800) {
    throw new Error('Informe período e valor válidos; observação limitada a 800 caracteres.');
  }
  const target = Number(indicator.target);
  const direction = indicator.direction;
  const met = direction === 'MAX' ? value <= target : direction === 'TARGET' ? value === target : value >= target;
  const status = met ? 'MET' : 'NOT_MET';
  const periodPatterns = {
    YEARLY: /^\d{4}$/,
    QUARTERLY: /^\d{4}-Q[1-4]$/,
    MONTHLY: /^\d{4}-(0[1-9]|1[0-2])$/,
    WEEKLY: /^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/
  };
  if (!periodPatterns[indicator.frequency]?.test(period)) throw new Error('O período informado não corresponde à frequência deste indicador.');
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'indicatorMeasurements', id), {
    id, indicatorId: indicator.id, period, value, target, status, notes,
    createdByUid: uid, createdAt: serverTimestamp()
  });
  return {id, status};
}

export async function listManagementActionPlans(managementAreaId, {pageSize = 30} = {}) {
  if (!managementAreaId) return [];
  const snapshot = await getDocsFromServer(query(
    collection(db, 'actionPlans'), where('managementAreaId', '==', managementAreaId),
    orderBy('openedAt', 'desc'), limit(Math.min(50, Math.max(1, pageSize)))
  ));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function listManagementActionPlanItems(planIds, {pageSize = 200} = {}) {
  const ids = [...new Set((planIds || []).filter((id) => typeof id === 'string' && id))].slice(0, 30);
  if (!ids.length) return [];
  const snapshot = await getDocsFromServer(query(
    collection(db, 'actionPlanItems'), where('planId', 'in', ids), limit(Math.min(200, Math.max(1, pageSize)))
  ));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function createManagementActionPlanItem(input, uid) {
  const planId = String(input.planId || '').trim();
  const id = String(input.itemId || '').trim();
  const description = String(input.description || '').trim();
  const dueAt = String(input.dueAt || '').trim() || null;
  let responsibleUids;
  try { responsibleUids = parseManagementUids(input.responsibleUids ?? [uid], {maxItems: 20}); }
  catch (error) { throw new Error(error.message || 'Confira a equipe responsável pela ação.'); }
  if (!uid || !planId || !/^[0-9a-f-]{36}$/i.test(id) || !description || description.length > 500 || (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt))) {
    throw new Error('Informe a ação e, se necessário, um prazo válido.');
  }
  const planSnapshot = await getDocFromServer(doc(db, 'actionPlans', planId));
  if (!planSnapshot.exists() || planSnapshot.data().responsibleUid !== uid || planSnapshot.data().status === 'COMPLETED') {
    throw new Error('Somente o responsável pode adicionar ações a um plano aberto.');
  }
  if (responsibleUids.length === 0) throw new Error('Informe pelo menos um responsável pela ação.');
  if (responsibleUids.length > 1 || responsibleUids[0] !== uid) {
    const areaSnapshot = await getDocFromServer(doc(db, 'managementAreas', planSnapshot.data().managementAreaId));
    const members = areaSnapshot.exists() && Array.isArray(areaSnapshot.data().memberUids) ? areaSnapshot.data().memberUids : [];
    if (!members.length || !members.every((memberUid) => typeof memberUid === 'string') || !responsibleUids.every((memberUid) => members.includes(memberUid))) {
      throw new Error('A equipe responsável deve conter somente UIDs cadastrados como membros desta área.');
    }
  }
  const ref = doc(db, 'actionPlanItems', id);
  try {
    await setDoc(ref, {
      id, planId, description, responsibleUids, dueAt, status: 'OPEN', evidence: null, completedAt: null,
      createdByUid: uid, createdAt: serverTimestamp(), updatedByUid: uid, updatedAt: serverTimestamp(), version: 1
    });
  } catch (error) {
    const confirmed = await getDocFromServer(ref).catch(() => null);
    const existing = confirmed?.exists() ? confirmed.data() : null;
    if (existing?.id === id && existing.planId === planId && existing.description === description &&
        JSON.stringify(existing.responsibleUids) === JSON.stringify(responsibleUids) && existing.createdByUid === uid && existing.dueAt === dueAt) return id;
    throw error;
  }
  return id;
}

export async function completeManagementActionPlanItem(itemId, uid) {
  if (!itemId || !uid) throw new Error('Ação ou usuário inválido.');
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, 'actionPlanItems', itemId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Esta ação não está mais disponível. Atualize a lista.');
    const item = snapshot.data();
    if (!Array.isArray(item.responsibleUids) || !item.responsibleUids.includes(uid) || item.status !== 'OPEN') throw new Error('A ação já mudou de estado ou não pertence a você.');
    transaction.update(ref, {status: 'COMPLETED', completedAt: serverTimestamp(), updatedByUid: uid, updatedAt: serverTimestamp(), version: item.version + 1});
  });
}

export async function createManagementActionPlan(input, uid) {
  const managementAreaId = String(input.managementAreaId || '').trim();
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const dueAt = String(input.dueAt || '').trim() || null;
  const priority = String(input.priority || 'Normal');
  if (!uid || !managementAreaId || !title || title.length > 160 || description.length > 1200 ||
      (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) || !['Normal', 'Alta', 'Urgente'].includes(priority)) {
    throw new Error('Confira área, título, prazo e prioridade do plano.');
  }
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'actionPlans', id), {
    id, managementAreaId, origin: 'MANAGEMENT_AREA', title, description, responsibleUid: uid,
    participantUids: [], status: 'OPEN', priority, openedAt: serverTimestamp(), dueAt, completedAt: null,
    createdByUid: uid, createdAt: serverTimestamp(), updatedByUid: uid, updatedAt: serverTimestamp(), version: 1
  });
  return id;
}

export async function transitionManagementActionPlan(planId, nextStatus, uid) {
  if (!planId || !uid || !['IN_PROGRESS', 'COMPLETED'].includes(nextStatus)) throw new Error('Plano ou estado inválido.');
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, 'actionPlans', planId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Este plano não está mais disponível. Atualize a lista.');
    const plan = snapshot.data();
    const valid = plan.responsibleUid === uid && ((plan.status === 'OPEN' && nextStatus === 'IN_PROGRESS') || (plan.status === 'IN_PROGRESS' && nextStatus === 'COMPLETED'));
    if (!valid) throw new Error('O estado do plano mudou ou ele não está atribuído a você. Atualize a lista.');
    transaction.update(ref, {status: nextStatus, completedAt: nextStatus === 'COMPLETED' ? serverTimestamp() : null, updatedByUid: uid, updatedAt: serverTimestamp()});
  });
}

export async function listEventRecords({from, to, uid, pageSize = 100, cursor = null, includePending = true} = {}) {
  if (!from || !to || from > to) throw new Error('Informe um período válido para consultar os eventos.');
  let records = [];
  let stale = navigator.onLine === false;
  let nextCursor = null;
  if (!stale) {
    try {
      const result = await getDocsFromServer(query(
        collection(db, 'events'),
        where('active', '==', true),
        where('date', '>=', from),
        where('date', '<=', to),
        orderBy('date', 'desc'),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(Math.min(100, Math.max(1, pageSize)))
      ));
      records = result.docs.map((item) => ({id: item.id, ...item.data()}));
      nextCursor = result.docs.length === Math.min(100, Math.max(1, pageSize)) ? result.docs[result.docs.length - 1] : null;
    } catch (error) {
      if (!mayUseOfflineCache(error)) throw error;
      stale = true;
    }
  }
  if (uid && includePending) {
    const unsettled = await listUnsettledOperations(uid);
    const pending = unsettled
      .filter((item) => item.type === 'events' && item.payload?.collectionName === 'events' &&
        typeof item.payload.data?.date === 'string' && item.payload.data.date >= from && item.payload.data.date <= to)
      .map((item) => ({
        id: item.requestId,
        ...item.payload.data,
        createdAt: new Date(item.createdAt),
        pendingFirestore: item.status === 'queued',
        syncFailed: item.status === 'failed',
        syncError: item.lastError || ''
      }));
    const eventEdits = unsettled
      .filter((item) => item.type === 'eventEdits' && item.payload?.collectionName === 'events' && item.payload.eventId &&
        (records.some((record) => record.id === item.payload.eventId) ||
          (typeof item.payload.data?.date === 'string' && item.payload.data.date >= from && item.payload.data.date <= to)))
      .map((item) => ({
        id: item.status === 'conflict' ? `${item.payload.eventId}::draft::${item.requestId}` : item.payload.eventId,
        sourceEventId: item.payload.eventId,
        ...item.payload.data,
        version: item.payload.expectedVersion + 1,
        createdAt: new Date(item.createdAt),
        pendingFirestore: item.status === 'queued',
        syncFailed: item.status === 'failed',
        syncError: item.lastError || '',
        pendingEdit: true
      }));
    const seen = new Set(records.map((item) => item.id));
    records.push(...pending.filter((item) => !seen.has(item.id)));
    for (const edit of eventEdits) {
      const existing = records.findIndex((item) => item.id === edit.sourceEventId);
      if (existing >= 0 && edit.syncFailed) records.push(edit);
      else if (existing >= 0) records[existing] = edit;
      else records.push(edit);
    }
  }
  records.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')) || dateSortValue(right.createdAt) - dateSortValue(left.createdAt));
  return {records, stale, nextCursor: stale ? null : nextCursor || null};
}

export async function getEventCatalog(uid) {
  try {
    const snapshot = await getDocFromServer(doc(db, 'eventCatalogs', 'operational'));
    const catalog = snapshot.exists()
      ? {id: snapshot.id, ...snapshot.data()}
      : {id: 'operational', payers: [], creditors: [], version: 0};
    if (uid) await writeSafeCache(uid, 'eventCatalogs', 'operational', catalog);
    return catalog;
  } catch (error) {
    if (uid && mayUseOfflineCache(error)) {
      const cached = await readSafeCache(uid, 'eventCatalogs', 'operational');
      if (cached?.data) return {...cached.data, stale: true};
    }
    throw error;
  }
}

export async function saveEventCatalog(input, uid) {
  if (!uid) throw new Error('A sessão expirou. Entre novamente.');
  const {payers, creditors} = validateEventCatalog({
    payers: parseCatalogValues(input.payers, 'Pagadores'),
    creditors: parseCatalogValues(input.creditors, 'Credores')
  });
  const ref = doc(db, 'eventCatalogs', 'operational');
  let saved = null;
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    const previous = current.exists() ? current.data() : null;
    saved = {
      id: 'operational', payers, creditors,
      createdByUid: previous?.createdByUid || uid,
      createdAt: previous?.createdAt || serverTimestamp(),
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
      version: Math.max(0, Number(previous?.version) || 0) + 1
    };
    transaction.set(ref, saved);
  });
  return saved;
}

async function confirmCommittedEventEdit(eventId, updates, uid, requestId, version) {
  const snapshot = await getDocFromServer(doc(db, 'events', eventId));
  if (!snapshot.exists()) return false;
  const saved = snapshot.data();
  return saved.id === eventId && saved.updatedByUid === uid && saved.version === version &&
    Object.entries(updates).every(([key, value]) => JSON.stringify(canonicalValue(saved[key])) === JSON.stringify(canonicalValue(value)));
}

export async function updateEventRecord(eventId, input, uid, expectedVersion, requestId = crypto.randomUUID(), {queueOffline = true} = {}) {
  if (!eventId || !uid) throw new Error('A sessão expirou. Entre novamente.');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('A versão deste evento não está disponível. Atualize o relatório antes de editar.');
  const ref = doc(db, 'events', eventId);
  const fields = ['date', 'memberStatus', 'eventType', 'description', 'delayMultiple', 'substitute', 'shift', 'payer', 'creditor', 'amountToPay'];
  const updates = Object.fromEntries(fields.map((field) => [field, input[field]]));
  if (typeof updates.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(updates.date)) throw new Error('A data do evento é inválida.');
  const queueOfflineEdit = async () => {
    await enqueueOperation({uid, type: 'eventEdits', resourceId: eventId, requestId, payload: {collectionName: 'events', eventId, expectedVersion, data: updates}});
    return {id: eventId, pendingFirestore: true};
  };
  if (!navigator.onLine) {
    if (queueOffline) return queueOfflineEdit();
    throw Object.assign(new Error('A conexão caiu durante a sincronização desta edição.'), {code: 'unavailable'});
  }
  try {
    await runTransaction(db, async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists()) throw Object.assign(new Error('Este evento não está mais disponível. Atualize o relatório.'), {code: 'stale-version'});
      const event = current.data();
      if (event.status !== 'OPEN' || event.active !== true || Number(event.version || 1) !== expectedVersion) {
        throw Object.assign(new Error('Outra pessoa atualizou este evento enquanto você editava.'), {code: 'stale-version'});
      }
      const version = expectedVersion + 1;
      transaction.update(ref, {...updates, updatedByUid: uid, updatedAt: serverTimestamp(), version});
    });
  } catch (error) {
    if (error.code === 'stale-version') throw error;
    try {
      if (await confirmCommittedEventEdit(eventId, updates, uid, requestId, expectedVersion + 1)) return {id: eventId, pendingFirestore: false, alreadyCommitted: true};
    } catch {}
    if (!['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(error.code) && navigator.onLine) throw error;
    if (!queueOffline) throw error;
    return queueOfflineEdit();
  }
  return {id: eventId, pendingFirestore: false};
}

export async function listLabelRecords({from, to, uid, sigla = '', canManage = false, pageSize = 100, cursor = null} = {}) {
  if (!from || !to || from > to) throw new Error('Informe um período válido para consultar as etiquetas.');
  if (!uid) throw new Error('A sessão expirou. Entre novamente para consultar etiquetas.');
  const currentLimit = Math.min(100, Math.max(1, pageSize));
  const base = [where('active', '==', true), where('date', '>=', from), where('date', '<=', to)];
  const cursorMode = canManage ? 'admin' : 'staff';
  if (cursor && cursor.mode !== cursorMode) cursor = null;
  const list = async (extra = [], after = null) => getDocsFromServer(query(
    collection(db, 'labels'), ...base, ...extra, orderBy('date', 'desc'), ...(after ? [startAfter(after)] : []), limit(currentLimit)
  ));
  let snapshots = [];
  let nextCursor = null;
  if (canManage) {
    const done = cursor?.adminDone === true;
    const snapshot = done ? null : await list([], cursor?.admin || null);
    if (snapshot) snapshots.push(snapshot);
    nextCursor = snapshot && snapshot.docs.length === currentLimit
      ? {mode: 'admin', admin: snapshot.docs[snapshot.docs.length - 1], adminDone: false}
      : null;
  } else {
    const ownDone = cursor?.ownDone === true;
    const staffDone = !sigla || cursor?.staffDone === true;
    const [own, staff] = await Promise.all([
      ownDone ? null : list([where('createdByUid', '==', uid)], cursor?.own || null),
      staffDone ? null : list([where('staffSiglas', 'array-contains', sigla)], cursor?.staff || null)
    ]);
    if (own) snapshots.push(own);
    if (staff) snapshots.push(staff);
    const nextOwnDone = ownDone || !own || own.docs.length < currentLimit;
    const nextStaffDone = staffDone || !staff || staff.docs.length < currentLimit;
    nextCursor = nextOwnDone && nextStaffDone ? null : {
      mode: 'staff',
      own: own?.docs.length ? own.docs[own.docs.length - 1] : cursor?.own || null,
      ownDone: nextOwnDone,
      staff: staff?.docs.length ? staff.docs[staff.docs.length - 1] : cursor?.staff || null,
      staffDone: nextStaffDone
    };
  }
  const records = new Map();
  for (const snapshot of snapshots) {
    for (const item of snapshot.docs) records.set(item.id, {id: item.id, ...item.data()});
  }
  return {
    records: [...records.values()].sort((left, right) => String(right.date).localeCompare(String(left.date)) || dateSortValue(right.createdAt) - dateSortValue(left.createdAt)),
    nextCursor
  };
}

export async function updateLabelRecord(labelId, input, uid) {
  if (!labelId || !uid) throw new Error('A sessão expirou. Entre novamente.');
  const ref = doc(db, 'labels', labelId);
  const current = await getDocFromServer(ref);
  if (!current.exists()) throw new Error('Esta etiqueta não está mais disponível. Atualize o relatório.');
  const label = current.data();
  if (label.active !== true || label.status !== 'CONFIRMED') {
    throw Object.assign(new Error('Esta etiqueta foi alterada ou desativada desde que o relatório foi aberto.'), {code: 'stale-version'});
  }
  const fields = ['date', 'patientName', 'procedureCode', 'encounterCode', 'type', 'amount', 'insurance', 'creditor', 'staffSiglas', 'consultation'];
  const updates = Object.fromEntries(fields.map((field) => [field, input[field]]));
  const version = Math.max(1, Number(label.version) || 1) + 1;
  const changedFields = fields.filter((field) => JSON.stringify(canonicalValue(label[field] ?? null)) !== JSON.stringify(canonicalValue(updates[field] ?? null)));
  if (!changedFields.length) throw new Error('Nenhuma alteração foi feita nesta etiqueta.');
  const historyRef = doc(db, 'labels', labelId, 'history', String(version));
  const historyEntry = {
    id: String(version), labelId, version, actorUid: uid,
    changedFields,
    before: Object.fromEntries(changedFields.map((field) => [field, label[field] ?? null])),
    after: Object.fromEntries(changedFields.map((field) => [field, updates[field] ?? null])),
    createdAt: serverTimestamp()
  };
  const batch = writeBatch(db);
  batch.update(ref, {...updates, updatedByUid: uid, updatedAt: serverTimestamp(), version});
  batch.set(historyRef, historyEntry);
  try {
    await batch.commit();
  } catch (error) {
    try {
      const latest = await getDocFromServer(ref);
      if (latest.exists() && Number(latest.data().version || 1) > version - 1) {
        throw Object.assign(new Error('Outra pessoa atualizou esta etiqueta enquanto você editava.'), {code: 'stale-version'});
      }
    } catch (checkError) {
      if (checkError.code === 'stale-version') throw checkError;
    }
    throw error;
  }
}

export async function listLabelHistory(labelId, {pageSize = 20} = {}) {
  if (!labelId) throw new Error('Selecione uma etiqueta para consultar o histórico.');
  const result = await getDocsFromServer(query(
    collection(db, 'labels', labelId, 'history'),
    orderBy('version', 'desc'),
    limit(Math.min(50, Math.max(1, pageSize)))
  ));
  return result.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function listChecklistStations({pageSize = 200} = {}) {
  const result = await getDocsFromServer(query(
    collection(db, 'stations'),
    orderBy('order', 'asc'),
    limit(Math.min(200, Math.max(1, pageSize)))
  ));
  return result.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function listTrainingCatalogForAdmin({pageSize = 100} = {}) {
  const result = await getDocsFromServer(query(
    collection(db, 'trainings'),
    orderBy('order', 'asc'),
    orderBy('title', 'asc'),
    limit(Math.min(100, Math.max(1, pageSize)))
  ));
  return result.docs.map((item) => ({id: item.id, ...item.data()}));
}

export async function saveTrainingCatalogRecord(input, uid) {
  if (!uid) throw new Error('A sessão expirou. Entre novamente.');
  if (!navigator.onLine) throw new Error('Conecte-se para atualizar o catálogo de treinamentos.');
  const title = String(input.title || '').trim().replace(/\s+/g, ' ');
  const description = String(input.description || '').trim();
  let videoId = '';
  try {
    const url = new URL(String(input.videoUrl || '').trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol === 'https:' && ['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
      videoId = host === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0] || '' : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})(?:\/|$)/)?.[1] || '';
    }
  } catch { /* The validation below reports an invalid URL. */ }
  const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
  const accessPoints = Number(input.accessPoints);
  const completionPoints = Number(input.completionPoints);
  const order = Number(input.order);
  const trainingId = String(input.trainingId || crypto.randomUUID()).trim();
  if (!title || title.length > 120 || description.length > 500 || !/^[\w-]{11}$/.test(videoId) ||
      !Number.isFinite(accessPoints) || accessPoints < 0 || accessPoints > 1000 ||
      !Number.isFinite(completionPoints) || completionPoints < 0 || completionPoints > 1000 ||
      !Number.isInteger(order) || order < 0 || order > 9999 || !/^[^/]{1,128}$/.test(trainingId)) {
    throw new Error('Confira título, link do YouTube, pontos e ordem do treinamento.');
  }
  const ref = doc(db, 'trainings', trainingId);
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    const old = current.exists() ? current.data() : null;
    const record = {
      id: trainingId,
      title,
      description,
      videoId,
      videoUrl,
      accessPoints,
      completionPoints,
      order,
      active: input.active === true,
      createdByUid: old?.createdByUid || uid,
      createdAt: old?.createdAt || serverTimestamp(),
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
      version: old ? Math.max(1, Number(old.version) || 1) + 1 : 1
    };
    transaction.set(ref, record);
    return record;
  });
}

export async function saveChecklistStation(input, uid) {
  if (!uid) throw new Error('A sessão expirou. Entre novamente.');
  if (!navigator.onLine) throw new Error('Conecte-se para atualizar o catálogo do Checklist.');
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  const qrCode = String(input.qrCode || '').trim();
  const start = String(input.start || '').trim();
  const end = String(input.end || '').trim();
  const order = Number(input.order);
  const stationId = String(input.stationId || crypto.randomUUID()).trim();
  const isoDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!name || name.length > 120 || !qrCode || qrCode.length > 300 || /[\u0000-\u001f\u007f]/u.test(qrCode) ||
      !Number.isInteger(order) || order < 0 || order > 9999 ||
      (start && !isoDay(start)) || (end && !isoDay(end)) || (start && end && start > end) ||
      !/^[^/]{1,128}$/.test(stationId)) {
    throw new Error('Confira nome, QR, vigência e ordem da estação.');
  }
  const duplicate = await getDocsFromServer(query(collection(db, 'stations'), where('qrCode', '==', qrCode), limit(2)));
  if (duplicate.docs.some((item) => item.id !== stationId)) throw new Error('Este código QR já pertence a outra estação.');
  const ref = doc(db, 'stations', stationId);
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    const record = {
      id: stationId,
      name,
      qrCode,
      ...(start ? {start} : {}),
      ...(end ? {end} : {}),
      order,
      active: input.active === true,
      createdByUid: current.exists() ? current.data().createdByUid : uid,
      createdAt: current.exists() ? current.data().createdAt : serverTimestamp(),
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
      version: current.exists() ? Math.max(1, Number(current.data().version) || 1) + 1 : 1
    };
    transaction.set(ref, record);
    return record;
  });
}

export async function listChecklistRecords(day, uid, {pageSize = 200, stationIds = []} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Informe uma data válida para o checklist.');
  const currentLimit = Math.min(1000, Math.max(1, pageSize));
  const requestedStationIds = [...new Set(stationIds.map((id) => String(id || '').trim()).filter(Boolean))].sort();
  let records; let priorRecords = []; let historyIncomplete = false; let stale = false;
  try {
    const base = collection(db, 'checklists');
    const [currentResult, ...priorResults] = await Promise.all([
      getDocsFromServer(query(base, where('date', '==', day), orderBy('createdAt', 'desc'), limit(currentLimit))),
      ...requestedStationIds.map((stationId) => getDocsFromServer(query(
        base,
        where('stationId', '==', stationId),
        where('date', '<', day),
        orderBy('date', 'desc'),
        orderBy('createdAt', 'desc'),
        limit(1)
      )))
    ]);
    records = currentResult.docs.map((item) => ({id: item.id, ...item.data()}));
    priorRecords = priorResults.flatMap((result) => result.docs.map((item) => ({id: item.id, ...item.data()})));
    if (uid) await writeSafeCache(uid, 'checklists', day, {records, priorRecords, stationIds: requestedStationIds});
  } catch (error) {
    if (!mayUseOfflineCache(error)) throw error;
    const cached = uid ? await readSafeCache(uid, 'checklists', day) : null;
    if (Array.isArray(cached?.data)) {
      records = cached.data.map((item) => ({...item, stale: true}));
      historyIncomplete = requestedStationIds.length > 0;
    }
    else if (Array.isArray(cached?.data?.records)) {
      records = cached.data.records.map((item) => ({...item, stale: true}));
      const sameCatalog = JSON.stringify(cached.data.stationIds || []) === JSON.stringify(requestedStationIds);
      priorRecords = sameCatalog ? (cached.data.priorRecords || []).map((item) => ({...item, stale: true})) : [];
      historyIncomplete = !sameCatalog;
    } else throw error;
    stale = true;
  }
  if (uid) {
    const unsettled = await listUnsettledOperations(uid);
    const pending = unsettled
      .filter((item) => item.payload?.collectionName === 'checklists' && item.payload.data?.date === day)
      .map((item) => ({id: item.requestId, ...item.payload.data, createdAt: new Date(item.createdAt), pendingSync: item.status === 'queued', syncFailed: item.status === 'failed', syncError: item.lastError || ''}));
    const seen = new Set(records.map((item) => item.id));
    records.push(...pending.filter((item) => !seen.has(item.id)));
  }
  return {
    records: records.sort((a, b) => dateSortValue(b.createdAt) - dateSortValue(a.createdAt)),
    priorRecords,
    historyIncomplete,
    stale
  };
}

export async function listMonthlyChecklistRecords(month, uid, {pageSize = 2000, stationIds = []} = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('Informe um mês válido para consultar o checklist.');
  const maxRecords = Math.min(2000, Math.max(1, pageSize));
  const requestedStationIds = [...new Set(stationIds.map((id) => String(id || '').trim()).filter(Boolean))].sort();
  const [year, monthNumber] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  let records; let priorRecords = []; let stale = false; let truncated = false; let historyIncomplete = false;
  try {
    const base = collection(db, 'checklists');
    const [result, ...priorResults] = await Promise.all([
      getDocsFromServer(query(base, where('date', '>=', from), where('date', '<=', to), orderBy('date', 'asc'), orderBy('createdAt', 'desc'), limit(maxRecords + 1))),
      ...requestedStationIds.map((stationId) => getDocsFromServer(query(
        base,
        where('stationId', '==', stationId),
        where('date', '<', from),
        orderBy('date', 'desc'),
        orderBy('createdAt', 'desc'),
        limit(1)
      )))
    ]);
    truncated = result.docs.length > maxRecords;
    records = result.docs.slice(0, maxRecords).map((item) => ({id: item.id, ...item.data()}));
    priorRecords = priorResults.flatMap((items) => items.docs.map((item) => ({id: item.id, ...item.data()})));
    if (uid) await writeSafeCache(uid, 'checklists', `month:${month}`, {records, priorRecords, stationIds: requestedStationIds, truncated});
  } catch (error) {
    if (!mayUseOfflineCache(error)) throw error;
    const cached = uid ? await readSafeCache(uid, 'checklists', `month:${month}`) : null;
    const cachedRecords = Array.isArray(cached?.data) ? cached.data : cached?.data?.records;
    if (!Array.isArray(cachedRecords)) throw error;
    records = cachedRecords.map((item) => ({...item, stale: true}));
    truncated = Boolean(cached?.data?.truncated);
    const sameCatalog = JSON.stringify(cached?.data?.stationIds || []) === JSON.stringify(requestedStationIds);
    priorRecords = sameCatalog && Array.isArray(cached?.data?.priorRecords)
      ? cached.data.priorRecords.map((item) => ({...item, stale: true}))
      : [];
    historyIncomplete = requestedStationIds.length > 0 && (!sameCatalog || !Array.isArray(cached?.data?.priorRecords));
    stale = true;
  }
  if (uid) {
    const unsettled = await listUnsettledOperations(uid);
    const pending = unsettled
      .filter((item) => item.payload?.collectionName === 'checklists' && item.payload.data?.date >= from && item.payload.data?.date <= to)
      .map((item) => ({id: item.requestId, ...item.payload.data, createdAt: new Date(item.createdAt), pendingSync: item.status === 'queued', syncFailed: item.status === 'failed', syncError: item.lastError || ''}));
    const seen = new Set(records.map((item) => item.id));
    records.push(...pending.filter((item) => !seen.has(item.id)));
  }
  return {
    records: records.sort((a, b) => a.date.localeCompare(b.date) || dateSortValue(b.createdAt) - dateSortValue(a.createdAt)),
    priorRecords, stale, truncated, historyIncomplete
  };
}

function checklistSignatureRequestId(day, revision, uid) {
  return `${day}_${revision}_${uid}`;
}

export async function previewChecklistSignatureRequest({day, stations = [], records = [], uid} = {}) {
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Não foi possível identificar o Checklist ou a sessão.');
  const latest = new Map();
  for (const record of records) if (!latest.has(record.stationId)) latest.set(record.stationId, record);
  const entries = stations.filter((station) => station.active === true).map((station) => {
    const record = latest.get(station.id);
    const responseAt = record?.createdAt?.toMillis?.() ?? (record?.createdAt instanceof Date ? record.createdAt.getTime() : null);
    return {stationId: station.id, stationName: station.name || station.id, condition: record?.condition || null, occurrence: record?.occurrence || '', responseId: record?.id || null, responseAt};
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({day, entries})));
  const revision = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const id = checklistSignatureRequestId(day, revision, uid);
  const snapshot = await getDocFromServer(doc(db, 'checklistSignatureRequests', id));
  const request = snapshot.exists() ? snapshot.data() : null;
  return {
    day, revision, total: entries.length, missing: entries.filter((entry) => !entry.condition).length,
    responsible: null,
    declaration: 'Confirmo que revisei o relatório do Checklist e solicito a validação da assinatura.',
    requestStatus: request?.status || '', requestId: request?.id || '', validationMessage: request?.validationMessage || ''
  };
}

export async function createChecklistSignatureRequest({day, revision, declaration, justification, uid} = {}) {
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !/^[a-f0-9]{64}$/.test(revision || '') || declaration !== true) {
    throw new Error('Atualize o relatório e confirme a declaração antes de solicitar a validação.');
  }
  const reason = String(justification || '').trim().slice(0, 500);
  if (reason.length < 8) throw new Error('Informe uma justificativa de pelo menos 8 caracteres para a auditoria.');
  const id = checklistSignatureRequestId(day, revision, uid);
  const reference = doc(db, 'checklistSignatureRequests', id);
  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists()) {
      const request = existing.data();
      if (request.signerUid !== uid || request.day !== day || request.revision !== revision) {
        throw new Error('O pedido de assinatura existente não corresponde a esta sessão.');
      }
      return {id, status: request.status, alreadyRequested: true};
    }
    transaction.set(reference, {
      id, day, revision, signerUid: uid, declaration: true,
      justification: reason, status: 'PENDING_VALIDATION', requestedAt: serverTimestamp()
    });
    return {id, status: 'PENDING_VALIDATION', alreadyRequested: false};
  });
}

function mergeWatchedRanges(ranges, duration) {
  const values = ranges.map((range) => {
    const start = Array.isArray(range) ? range[0] : range?.start;
    const end = Array.isArray(range) ? range[1] : range?.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + 2) {
      throw new Error('O progresso do vídeo está fora dos limites válidos.');
    }
    return {start, end: Math.min(end, duration)};
  }).filter(({start, end}) => end > start).sort((a, b) => a.start - b.start);
  if (values.length > 5000) throw new Error('O progresso do vídeo ficou fragmentado demais. Retome a reprodução para consolidá-lo.');
  const merged = [];
  for (const range of values) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 0.25) last.end = Math.max(last.end, range.end);
    else merged.push({...range});
  }
  if (merged.length > 500) throw new Error('O progresso do vídeo ficou fragmentado demais. Retome a reprodução para consolidá-lo.');
  return merged;
}

function trainingProgressId(uid, trainingId) { return `${uid}_${trainingId}`; }

export async function startTrainingInFirestore(uid, trainingId) {
  if (!uid || !trainingId || trainingId.length > 128) throw new Error('Não foi possível identificar o treinamento ou a sessão.');
  const receiptId = trainingProgressId(uid, trainingId);
  const receiptRef = doc(db, 'trainingReceipts', receiptId);
  const trainingRef = doc(db, 'trainings', trainingId);
  return runTransaction(db, async (transaction) => {
    const [receiptSnapshot, trainingSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(trainingRef)
    ]);
    if (receiptSnapshot.exists()) {
      const receipt = receiptSnapshot.data();
      if (receipt.uid !== uid || receipt.trainingId !== trainingId || receipt.sourceType !== 'trainingStart') {
        throw new Error('O recibo de início do treinamento está inconsistente.');
      }
      return {started: true, alreadyStarted: true, pointsPending: receipt.accessPointsStatus === 'PENDING_VALIDATION'};
    }
    if (!trainingSnapshot.exists() || trainingSnapshot.data().active !== true) throw new Error('Este treinamento não está ativo.');
    const training = trainingSnapshot.data();
    const accessPoints = Number(training.accessPoints);
    const completionPoints = Number(training.completionPoints);
    if (!Number.isFinite(accessPoints) || accessPoints < 0 || accessPoints > 1000 ||
        !Number.isFinite(completionPoints) || completionPoints < 0 || completionPoints > 1000 || !Number.isInteger(training.version)) {
      throw new Error('A configuração deste treinamento não pode ser registrada com segurança.');
    }
    transaction.set(receiptRef, {
      id: receiptId, uid, trainingId, trainingVersion: training.version,
      accessPointsClaimed: accessPoints, completionPointsClaimed: completionPoints,
      accessPointsStatus: accessPoints > 0 ? 'PENDING_VALIDATION' : 'NOT_APPLICABLE',
      sourceType: 'trainingStart', startedAt: serverTimestamp()
    });
    return {started: true, alreadyStarted: false, pointsPending: accessPoints > 0};
  });
}

export async function completeTrainingInFirestore(uid, trainingId, {ended = false} = {}) {
  if (!uid || !trainingId || trainingId.length > 128) throw new Error('Não foi possível identificar o treinamento ou a sessão.');
  if (ended !== true) throw new Error('O player ainda não sinalizou o encerramento do vídeo.');
  const progressId = trainingProgressId(uid, trainingId);
  const progressRef = doc(db, 'trainingProgress', progressId);
  const receiptRef = doc(db, 'trainingReceipts', progressId);
  const completionId = `complete-${progressId}`;
  const completionRef = doc(db, 'trainingCompletions', completionId);
  return runTransaction(db, async (transaction) => {
    const [progressSnapshot, receiptSnapshot, completionSnapshot] = await Promise.all([
      transaction.get(progressRef), transaction.get(receiptRef), transaction.get(completionRef)
    ]);
    if (!progressSnapshot.exists() || !receiptSnapshot.exists()) throw new Error('Inicie e sincronize o treinamento antes de concluir.');
    const progress = progressSnapshot.data();
    const receipt = receiptSnapshot.data();
    if (progress.uid !== uid || progress.trainingId !== trainingId || receipt.uid !== uid || receipt.trainingId !== trainingId) {
      throw new Error('O progresso ou o recibo deste treinamento não pertence à sessão atual.');
    }
    if (completionSnapshot.exists()) {
      const completion = completionSnapshot.data();
      if (completion.uid !== uid || completion.trainingId !== trainingId || completion.sourceType !== 'trainingCompletion' || progress.status !== 'COMPLETED') {
        throw new Error('O recibo de conclusão está inconsistente. Solicite revisão da Administração.');
      }
      return {completed: true, alreadyCompleted: true, pointsAwarded: 0, pointsPending: completion.pointsStatus === 'PENDING_VALIDATION', watchedPercent: completion.watchedPercent};
    }
    if (!['STARTED', 'IN_PROGRESS'].includes(progress.status)) throw new Error('Este progresso já foi concluído ou não pode ser alterado.');
    const duration = Number(progress.duration);
    const ranges = mergeWatchedRanges(progress.watchedRanges || [], duration);
    const watchedSeconds = ranges.reduce((total, range) => total + range.end - range.start, 0);
    const watchedPercent = duration > 0 ? Math.min(100, Math.round(watchedSeconds / duration * 1000) / 10) : 0;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400 || watchedSeconds / duration < 0.95) {
      throw new Error(`O vídeo precisa registrar pelo menos 95% de reprodução; o progresso atual é ${watchedPercent}%.`);
    }
    const points = Number(receipt.completionPointsClaimed);
    if (!Number.isFinite(points) || points < 0 || points > 1000) throw new Error('O snapshot de pontos deste treinamento está inválido.');
    const completedAt = serverTimestamp();
    transaction.update(progressRef, {
      status: 'COMPLETED', completedAt, completionStatus: 'PENDING_VALIDATION', updatedAt: serverTimestamp()
    });
    transaction.set(completionRef, {
      id: completionId, uid, trainingId, trainingVersion: receipt.trainingVersion,
      sourceType: 'trainingCompletion', duration, watchedSeconds, watchedPercent, ended: true,
      points, pointsStatus: points > 0 ? 'PENDING_VALIDATION' : 'NOT_APPLICABLE',
      validationStatus: 'PENDING_VALIDATION', completedAt
    });
    return {completed: true, alreadyCompleted: false, pointsAwarded: 0, pointsPending: points > 0, watchedPercent};
  });
}

export async function getMyScoreTotal(uid) {
  if (!uid) throw new Error('A sessão expirou. Entre novamente.');
  const cache = await readSafeCache(uid, 'scores', 'total');
  if (!navigator.onLine) return {total: cache?.data?.total ?? null, stale: true};
  try {
    const snapshot = await getAggregateFromServer(
      query(collection(db, 'scores'), where('uid', '==', uid)),
      {total: sum('points')}
    );
    const total = snapshot.data().total ?? 0;
    await writeSafeCache(uid, 'scores', 'total', {total}).catch(() => {});
    return {total, stale: false};
  } catch (error) {
    if (!mayUseOfflineCache(error)) throw error;
    return {total: cache?.data?.total ?? null, stale: true};
  }
}

export async function listTrainingProgress(uid, {pageSize = 100} = {}) {
  if (!uid) throw new Error('A sessão expirou. Entre novamente.');
  const cache = await readSafeCache(uid, 'trainingProgress', 'mine');
  try {
    const result = await getDocsFromServer(query(
      collection(db, 'trainingProgress'),
      where('uid', '==', uid),
      limit(Math.min(100, Math.max(1, pageSize)))
    ));
    const records = result.docs.map((item) => ({id: item.id, ...item.data()}));
    const pending = new Map((cache?.data?.records || []).filter((item) => item.syncPending).map((item) => [item.id, item]));
    for (const [id, item] of pending) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) {
        records.push(item);
        continue;
      }
      const remote = records[index];
      const localDuration = Number(item.duration);
      const remoteDuration = Number(remote.duration);
      if (Math.abs(localDuration - remoteDuration) > 0.05) {
        records[index] = {
          ...item,
          syncPending: true,
          syncConflict: true,
          syncConflictRemote: {
            duration: remoteDuration,
            lastPosition: Number(remote.lastPosition) || 0,
            watchedRanges: Array.isArray(remote.watchedRanges) ? remote.watchedRanges : []
          },
          syncError: item.syncError || 'O vídeo deste treinamento mudou. O progresso local foi preservado; revise-o na área Offline antes de descartar ou tentar sincronizar novamente.'
        };
        continue;
      }
      const latest = dateSortValue(item.updatedAt) >= dateSortValue(remote.updatedAt) ? item : remote;
      records[index] = {
        ...remote,
        ...latest,
        id,
        uid,
        trainingId: item.trainingId,
        startedAt: remote.startedAt || item.startedAt,
        completionRequested: item.completionRequested === true || remote.completionRequested === true,
        duration: localDuration,
        lastPosition: Math.min(Number(latest.lastPosition) || 0, localDuration),
        watchedRanges: mergeWatchedRanges([...(remote.watchedRanges || []), ...(item.watchedRanges || [])], localDuration),
        syncPending: true,
        syncConflict: false,
        syncConflictRemote: undefined,
        syncError: item.syncConflict ? '' : item.syncError || '',
        syncAttempts: item.syncAttempts || 0
      };
    }
    await writeSafeCache(uid, 'trainingProgress', 'mine', {records});
    return {records, stale: false};
  } catch (error) {
    if (!mayUseOfflineCache(error) || !Array.isArray(cache?.data?.records)) throw error;
    return {records: cache.data.records.map((item) => ({...item, stale: true})), stale: true};
  }
}

export async function saveTrainingProgress(uid, trainingId, {duration, lastPosition, watchedRanges, completionRequested = false} = {}) {
  if (!uid || !trainingId) throw new Error('Não foi possível identificar o treinamento desta sessão.');
  duration = Number(duration);
  lastPosition = Number(lastPosition);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400 || !Number.isFinite(lastPosition) || lastPosition < 0 || lastPosition > duration + 2) {
    throw new Error('O progresso do vídeo está fora dos limites válidos.');
  }
  const inputRanges = mergeWatchedRanges(watchedRanges || [], duration);
  const id = trainingProgressId(uid, trainingId);
  const ref = doc(db, 'trainingProgress', id);
  const commit = async () => runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref);
    const old = existing.exists() ? existing.data() : null;
    if (old?.status === 'COMPLETED') return {id, ...old, syncPending: false};
    const ranges = mergeWatchedRanges([...(old?.watchedRanges || []), ...inputRanges], duration);
    const record = {
      uid,
      trainingId,
      lastPosition,
      duration,
      watchedRanges: ranges,
      status: old ? 'IN_PROGRESS' : 'STARTED',
      updatedAt: new Date().toISOString()
    };
    if (old) transaction.update(ref, {...record, updatedAt: serverTimestamp()});
    else transaction.set(ref, {...record, startedAt: serverTimestamp(), updatedAt: serverTimestamp()});
    return {id, ...old, ...record, startedAt: old?.startedAt || new Date().toISOString(), syncPending: false};
  });

  let saved;
  try {
    if (!navigator.onLine) throw Object.assign(new Error('Offline'), {code: 'unavailable'});
    saved = await commit();
  } catch (error) {
    if (!mayUseOfflineCache(error)) throw error;
    const cache = await readSafeCache(uid, 'trainingProgress', 'mine');
    const records = cache?.data?.records || [];
    const old = records.find((item) => item.id === id);
    saved = {id, uid, trainingId, startedAt: old?.startedAt || new Date().toISOString(), lastPosition, duration, watchedRanges: mergeWatchedRanges([...(old?.watchedRanges || []), ...inputRanges], duration), status: old ? 'IN_PROGRESS' : 'STARTED', updatedAt: new Date().toISOString(), completionRequested: completionRequested || old?.completionRequested === true, syncPending: true};
  }
  const cache = await readSafeCache(uid, 'trainingProgress', 'mine');
  const records = (cache?.data?.records || []).filter((item) => item.id !== id);
  records.push(saved);
  await writeSafeCache(uid, 'trainingProgress', 'mine', {records});
  return saved;
}

export async function syncPendingTrainingProgress(uid, {trainingId} = {}) {
  if (!uid || !navigator.onLine) return 0;
  const cache = await readSafeCache(uid, 'trainingProgress', 'mine');
  const pending = (cache?.data?.records || []).filter((item) => item.syncPending && !item.syncError && (!trainingId || item.trainingId === trainingId));
  let synced = 0;
  for (const item of pending) {
    try {
      const result = await saveTrainingProgress(uid, item.trainingId, item);
      if (!result.syncPending) synced++;
      else break;
      if (item.completionRequested === true && !result.syncPending) {
        const {startTraining, completeTraining} = await import('./training-start.js');
        await startTraining(item.trainingId, uid);
        const completion = await completeTraining(item.trainingId, {ended: true, uid});
        await updateCachedTrainingProgress(uid, item.trainingId, {
          status: 'COMPLETED', completedAt: new Date().toISOString(), completionRequested: false,
          syncPending: false, syncError: '', syncAttempts: item.syncAttempts || 0,
          completionPointsAwarded: 0, completionPointsPending: completion.pointsPending
        }, {requirePending: false});
      }
    } catch (error) {
      await updateCachedTrainingProgress(uid, item.trainingId, {
        ...(item.completionRequested === true ? {completionRequested: true, syncPending: true} : {}),
        syncError: error.code || error.message || 'Falha ao sincronizar',
        syncAttempts: (item.syncAttempts || 0) + 1,
        syncFailedAt: new Date().toISOString()
      }, {requirePending: false});
    }
  }
  return synced;
}

export async function retryTrainingProgress(uid, trainingId) {
  await updateCachedTrainingProgress(uid, trainingId, {syncError: '', syncFailedAt: ''});
  return syncPendingTrainingProgress(uid, {trainingId});
}

function dateSortValue(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}

function buildRecordBatch(batch, {collectionName, data, uid, requestId}) {
  stageOperationalWrite(batch, {
    collectionName, data, uid, requestId, now: serverTimestamp(),
    recordRef: doc(db, collectionName, requestId)
  });
}

function canonicalValue(value) {
  if (value instanceof Date) return {$timestamp: value.getTime()};
  if (value && typeof value.toMillis === 'function') return {$timestamp: value.toMillis()};
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

async function confirmCommittedMutation({collectionName, data, uid, requestId}) {
  const snapshot = await getDocFromServer(doc(db, collectionName, requestId));
  if (!snapshot.exists()) return false;
  const saved = snapshot.data();
  if (saved.id !== requestId || saved.clientMutationId !== requestId || saved.createdByUid !== uid) return false;
  return Object.entries(data).every(([key, value]) =>
    JSON.stringify(canonicalValue(saved[key])) === JSON.stringify(canonicalValue(value)));
}

export async function createOperationalRecord(collectionName, data, {uid, requestId = crypto.randomUUID()} = {}) {
  if (!uid) throw new Error('A sessão expirou. Entre novamente.');
  const payload = {collectionName, data};
  if (!navigator.onLine) {
    if (!mayQueueOffline(collectionName)) throw new Error('Etiquetas precisam de conexão para serem confirmadas; os dados do paciente não ficam salvos neste aparelho.');
    await enqueueOperation({uid, type: collectionName, resourceId: requestId, requestId, payload});
    return {id: requestId, pendingFirestore: true};
  }
  const batch = writeBatch(db);
  buildRecordBatch(batch, {collectionName, data, uid, requestId});
  try {
    await batch.commit();
    return {id: requestId, pendingFirestore: false};
  } catch (error) {
    try {
      if (await confirmCommittedMutation({collectionName, data, uid, requestId})) {
        return {id: requestId, pendingFirestore: false, alreadyCommitted: true};
      }
    } catch {}
    if (error.code !== 'unavailable' && error.code !== 'deadline-exceeded' && error.code !== 'network-request-failed' && navigator.onLine) throw error;
    if (!mayQueueOffline(collectionName)) throw new Error('O Firestore não confirmou a etiqueta. Os dados continuam apenas no formulário e não foram armazenados neste aparelho.');
    await enqueueOperation({uid, type: collectionName, resourceId: requestId, requestId, payload});
    return {id: requestId, pendingFirestore: true};
  }
}

const flushPromises = new Map();
export async function flushOutbox(uid, {requestId} = {}) {
  if (!uid || !navigator.onLine) return {synced: 0, pending: 0};
  return runKeyedTask(flushPromises, uid, async () => {
    let synced = 0;
    const queued = await listQueuedOperations(uid);
    const operations = requestId ? queued.filter((operation) => operation.requestId === requestId) : queued;
    for (const operation of operations) {
      try {
        if (operation.type === 'scheduleReleases') {
          await applyScheduleSiglaRelease(operation.payload, uid);
        } else if (operation.type === 'eventEdits') {
          await updateEventRecord(operation.payload.eventId, operation.payload.data, uid, operation.payload.expectedVersion, operation.requestId, {queueOffline: false});
        } else {
          const batch = writeBatch(db);
          buildRecordBatch(batch, {
            collectionName: operation.payload.collectionName,
            data: operation.payload.data,
            uid,
            requestId: operation.requestId,
          });
          await batch.commit();
        }
        await removeQueuedOperation(uid, operation.requestId);
        synced++;
        window.dispatchEvent(new CustomEvent('sahmt-write-synced', {detail: {requestId: operation.requestId, type: operation.type}}));
      } catch (error) {
        try {
          if (operation.type === 'scheduleReleases') throw error;
          const committed = operation.type === 'eventEdits'
            ? await confirmCommittedEventEdit(operation.payload.eventId, operation.payload.data, uid, operation.requestId, operation.payload.expectedVersion + 1)
            : await confirmCommittedMutation({collectionName: operation.payload.collectionName, data: operation.payload.data, uid, requestId: operation.requestId});
          if (committed) {
            await removeQueuedOperation(uid, operation.requestId);
            synced++;
            window.dispatchEvent(new CustomEvent('sahmt-write-synced', {detail: {requestId: operation.requestId, replay: true}}));
            continue;
          }
        } catch {}
        const attempts = operation.attempts + 1;
        const conflict = error.code === 'stale-version' && operation.type === 'eventEdits';
        const permanent = ['permission-denied', 'invalid-argument', 'failed-precondition'].includes(error.code);
        const delay = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempts, 10));
        await updateQueuedOperation(uid, operation.requestId, {
          status: conflict ? 'conflict' : permanent ? 'failed' : 'queued',
          attempts,
          nextAttemptAt: Date.now() + delay,
          lastError: String(error.message || error).slice(0, 300),
          lastErrorCode: error.code || ''
        });
        if (permanent) window.dispatchEvent(new CustomEvent('sahmt-write-rejected', {detail: {message: 'Uma ação offline foi recusada pelo Firestore. Verifique suas permissões.'}}));
        if (!navigator.onLine || !permanent) break;
      }
    }
    return {synced, pending: await pendingOperationCount(uid)};
  });
}
