import {collection, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, runTransaction, serverTimestamp} from 'firebase/firestore';
import {FIREBASE_PROJECTS} from './firebase-projects.js';
import {OCCURRENCE_CATALOG_SPECS, getOccurrenceForm, validateOccurrenceValues} from './occurrence-schema.js';

const REPORTS = 'occurrenceReports';
const AUDIT = 'occurrenceAudit';
const SCORE_CLAIMS = 'occurrenceScoreClaims';
const CATALOGS = 'occurrenceCatalogs';
const SOURCE_PROJECT = FIREBASE_PROJECTS.FA.projectId;
const MAX_RECORD_BYTES = 500000;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

export function validateOccurrenceCatalogDocument(value) {
  if (!plain(value) || value.schemaVersion !== 1 || !plain(value.catalogs)) throw new Error('OCCURRENCE_CATALOG_INVALID');
  const keys = Object.keys(value.catalogs).sort();
  if (keys.join('\n') !== Object.keys(OCCURRENCE_CATALOG_SPECS).sort().join('\n')) throw new Error('OCCURRENCE_CATALOG_INVALID');
  const catalogs = {};
  for (const [key, specification] of Object.entries(OCCURRENCE_CATALOG_SPECS)) {
    const options = value.catalogs[key];
    if (!Array.isArray(options) || options.length !== specification.count || new Set(options).size !== options.length
      || options.some(option => !boundedText(option, 600))) throw new Error('OCCURRENCE_CATALOG_INVALID');
    catalogs[key] = Object.freeze(options.map(option => option.trim()));
  }
  return Object.freeze({schemaVersion:1, catalogs:Object.freeze(catalogs)});
}

export function createOccurrenceRepository({db, auth, firestore = {}, idGenerator = () => crypto.randomUUID(), isCurrent = () => true,
  notifyScore = options => import('./occurrence-scoring-delivery.js').then(module=>module.notifyConfiguredOccurrenceScore(options))} = {}) {
  const api = {
    collection: firestore.collection || collection,
    doc: firestore.doc || doc,
    getDocFromServer: firestore.getDocFromServer || getDocFromServer,
    getDocsFromServer: firestore.getDocsFromServer || getDocsFromServer,
    limit: firestore.limit || limit,
    orderBy: firestore.orderBy || orderBy,
    query: firestore.query || query,
    runTransaction: firestore.runTransaction || runTransaction,
    serverTimestamp: firestore.serverTimestamp || serverTimestamp
  };
  let catalogCache = null;

  const requirePermission = async (uid, claimName) => {
    if (db?.app?.options?.projectId !== SOURCE_PROJECT || !auth || !boundedText(uid, 128) || typeof isCurrent !== 'function' || !isCurrent()) throw new Error('OCCURRENCE_SESSION_INVALID');
    const user = auth.currentUser;
    if (!user || user.uid !== uid) throw new Error('OCCURRENCE_SESSION_INVALID');
    let snapshot;
    try { snapshot = await api.getDocFromServer(api.doc(db, 'users', uid)); }
    catch { throw new Error('OCCURRENCE_AUTHORIZATION_UNAVAILABLE'); }
    if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
    const profile=snapshot?.exists?.()?snapshot.data():null;
    const permission={sahmtOccurrencesRead:'occurrencesRead',sahmtOccurrencesAuditRead:'occurrencesAuditRead'}[claimName];
    if (!plain(profile) || profile.uid !== uid || profile.active !== true || profile.access !== true
      || (permission && profile.permissions?.[permission] !== true)) {
      throw new Error('OCCURRENCE_PERMISSION_DENIED');
    }
    return user;
  };

  const loadCatalog = async ({uid} = {}) => {
    await requirePermission(uid, 'sahmtOccurrencesCatalogRead');
    if (catalogCache?.uid === uid) return catalogCache.value;
    let snapshot;
    try { snapshot = await api.getDocFromServer(api.doc(db, CATALOGS, 'current')); }
    catch (error) { throw new Error(error?.code === 'permission-denied'
      ? 'OCCURRENCE_CATALOG_PERMISSION_DENIED' : 'OCCURRENCE_CATALOG_UNAVAILABLE'); }
    if (!snapshot?.exists?.()) throw new Error('OCCURRENCE_CATALOG_UNAVAILABLE');
    const value = validateOccurrenceCatalogDocument(snapshot.data());
    if (!isCurrent()) throw new Error('OCCURRENCE_SESSION_CHANGED');
    catalogCache = {uid, value};
    return value;
  };

  const save = async ({uid, displayName, anonymous = false, formId, values, recordId, catalogs} = {}) => {
    const user = await requirePermission(uid, 'sahmtOccurrencesWrite');
    if (!/^[A-Fa-f0-9-]{36}$/.test(recordId || '') || typeof anonymous !== 'boolean') throw new Error('OCCURRENCE_INPUT_INVALID');
    const form = getOccurrenceForm(formId);
    if (!form) throw new Error('OCCURRENCE_FORM_INVALID');
    const resolvedCatalogs = catalogs || (await loadCatalog({uid})).catalogs;
    const validation = validateOccurrenceValues(formId, values, resolvedCatalogs);
    if (!validation.valid) throw new Error('OCCURRENCE_FORM_INVALID');
    if (!anonymous && !boundedText(displayName, 120)) throw new Error('OCCURRENCE_AUTHOR_INVALID');
    if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');

    const commonIds = new Set(['eventDate','occurrence','description']);
    const classificationIds = new Set(form.classification.map(item => item.id));
    const classification = Object.fromEntries([...classificationIds].filter(key => values[key] !== undefined).map(key => [key, values[key].trim()]));
    const details = Object.fromEntries(Object.keys(values).filter(key => !commonIds.has(key) && !classificationIds.has(key))
      .map(key => [key, typeof values[key] === 'string' ? values[key].trim() : values[key]]));
    const report = Object.freeze({schemaVersion:1,id:recordId,formId,formTitle:form.title,
      occurredOn:form.noGeneralInformation ? null : values.eventDate.trim(),
      occurrence:form.noGeneralInformation ? null : values.occurrence.trim(),
      description:form.noGeneralInformation ? null : values.description.trim(),
      classification,details,anonymous,authorLabel:anonymous ? 'Anônimo' : displayName.trim(),
      pointsClaimed:2,pointsStatus:'PENDING_VALIDATION',createdAt:api.serverTimestamp()});
    const audit = Object.freeze({schemaVersion:1,reportId:recordId,uid,formId,anonymous,createdAt:api.serverTimestamp()});
    const scoreClaim = Object.freeze({schemaVersion:1,id:recordId,source:'REGISTRO_OCORRENCIA',sourceId:recordId,originProjectId:SOURCE_PROJECT,
      uid,formId,points:2,status:'PENDING_VALIDATION',createdAt:api.serverTimestamp()});
    if (jsonBytes({...report,createdAt:'timestamp'}) > MAX_RECORD_BYTES) throw new Error('OCCURRENCE_RECORD_TOO_LARGE');

    const reportRef = api.doc(db, REPORTS, recordId);
    const auditRef = api.doc(db, AUDIT, recordId);
    const scoreRef = api.doc(db, SCORE_CLAIMS, recordId);
    try {
      const result = await api.runTransaction(db, async transaction => {
        const [priorReport, priorAudit, priorScore] = await Promise.all([
          transaction.get(reportRef), transaction.get(auditRef), transaction.get(scoreRef)
        ]);
        if (priorReport.exists() || priorAudit.exists() || priorScore.exists()) {
          if (priorReport.exists() && priorAudit.exists() && priorScore.exists()
            && priorAudit.data()?.uid === uid && priorReport.data()?.formId === formId
            && priorScore.data()?.uid === uid && priorScore.data()?.sourceId === recordId) return 'already-saved';
          throw new Error('OCCURRENCE_RECONCILIATION_REQUIRED');
        }
        if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
        transaction.set(reportRef, report);
        transaction.set(auditRef, audit);
        transaction.set(scoreRef, scoreClaim);
        return 'saved';
      });
      if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
      // A confirmed FC record is not undone by FB unavailability. Its existing
      // pending claim supports recovery; no point amount is sent by the browser.
      Promise.resolve().then(()=>notifyScore({id:recordId,uid,auth,isCurrent})).catch(()=>{});
      return Object.freeze({status:result,id:recordId,pointsStatus:'PENDING_VALIDATION'});
    } catch (error) {
      if (['OCCURRENCE_SESSION_CHANGED','OCCURRENCE_RECONCILIATION_REQUIRED'].includes(error?.message)) throw error;
      throw new Error('OCCURRENCE_SAVE_FAILED');
    }
  };

  const list = async ({uid, pageSize = 30} = {}) => {
    await requirePermission(uid, 'sahmtOccurrencesRead');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('OCCURRENCE_QUERY_INVALID');
    try {
      const result = await api.getDocsFromServer(api.query(api.collection(db, REPORTS), api.orderBy('createdAt','desc'), api.limit(pageSize)));
      if (!isCurrent()) throw new Error('OCCURRENCE_SESSION_CHANGED');
      return result.docs.map(snapshot => Object.freeze({id:snapshot.id,...snapshot.data()}));
    } catch (error) {
      if (error?.message === 'OCCURRENCE_SESSION_CHANGED') throw error;
      throw new Error('OCCURRENCE_READ_FAILED');
    }
  };

  const listAudit = async ({uid, pageSize = 30} = {}) => {
    await requirePermission(uid, 'sahmtOccurrencesAuditRead');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('OCCURRENCE_QUERY_INVALID');
    try {
      const result = await api.getDocsFromServer(api.query(api.collection(db, AUDIT), api.orderBy('createdAt','desc'), api.limit(pageSize)));
      if (!isCurrent()) throw new Error('OCCURRENCE_SESSION_CHANGED');
      return result.docs.map(snapshot => {
        const data=snapshot.data();
        return Object.freeze({id:snapshot.id,reportId:data.reportId,formId:data.formId,anonymous:data.anonymous,createdAt:data.createdAt});
      });
    } catch (error) {
      if (error?.message === 'OCCURRENCE_SESSION_CHANGED') throw error;
      throw new Error('OCCURRENCE_READ_FAILED');
    }
  };

  return Object.freeze({loadCatalog,save,list,listAudit,clear:()=>{catalogCache=null;}});
}
