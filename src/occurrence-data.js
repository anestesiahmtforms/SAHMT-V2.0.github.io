import {collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, where} from 'firebase/firestore';
import {FIREBASE_PROJECTS} from './firebase-projects.js';
import {OCCURRENCE_CATALOG_SPECS, OCCURRENCE_PRIVATE_FIELDS, getOccurrenceForm, occurrenceAppProtocol,
  occurrenceHospitalNumber, occurrenceProtocol, readOccurrenceAnalysis, validateOccurrenceValues} from './occurrence-schema.js';
import {isValidDateKey} from './schedule-date.js';

const REPORTS = 'occurrenceReports';
const AUDIT = 'occurrenceAudit';
const SCORE_CLAIMS = 'occurrenceScoreClaims';
const CATALOGS = 'occurrenceCatalogs';
const FOLLOWUPS = 'occurrenceFollowups';
const GRANTS = new Map([
  ['hospital','occurrenceHospitalGrants'],
  ['descriptions','occurrenceDescriptionGrants']
]);
const SOURCE_PROJECT = FIREBASE_PROJECTS.FC.projectId;
const MAX_RECORD_BYTES = 500000;
const TRANSIENT_FIRESTORE_CODES = new Set(['unavailable','deadline-exceeded','network-request-failed','resource-exhausted']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const validUid = value => boundedText(value,128) && !value.includes('/');
const fcAdministrator = profile => profile?.role === 'administrador_app' || profile?.permissions?.admin === true;
const followupId = id => /^[A-Fa-f0-9-]{36}$|^gr-[1-9]\d{0,11}$/.test(id || '');

function safeAppNarrative(report, displayName, extraIdentityValues) {
  const confidential = [displayName, ...extraIdentityValues].filter(text => boundedText(text,5000))
    .map(text => text.trim()).sort((a,b) => b.length - a.length);
  const identity = confidential.map(value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const pattern = identity ? new RegExp(`(^|[^\\p{L}\\p{N}])(?:${identity})(?![\\p{L}\\p{N}])`,'giu') : null;
  const redact = text => typeof text !== 'string' || !pattern ? text :
    text.replace(pattern,(_match,before) => before+'…');
  const safeFields = values => Object.fromEntries(Object.entries(values)
    .filter(([key]) => !OCCURRENCE_PRIVATE_FIELDS.includes(key)).map(([key,value]) => [key,redact(value)]));
  return {title:redact(report.occurrence),description:redact(report.description),
    classification:safeFields(report.classification),details:safeFields(report.details)};
}

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
    serverTimestamp: firestore.serverTimestamp || serverTimestamp,
    where: firestore.where || where,
    documentId: firestore.documentId || documentId,
    startAfter: firestore.startAfter || startAfter
  };
  let catalogCache = null;

  const requirePermission = async (uid, claimName) => {
    if (db?.app?.options?.projectId !== SOURCE_PROJECT || !auth || !boundedText(uid, 128) || typeof isCurrent !== 'function' || !isCurrent()) throw new Error('OCCURRENCE_SESSION_INVALID');
    const user = auth.currentUser;
    if (!user || user.uid !== uid) throw new Error('OCCURRENCE_SESSION_INVALID');
    let snapshot;
    try { snapshot = await api.getDocFromServer(api.doc(db, 'users', uid)); }
    catch (error) {
      if (error?.code === 'permission-denied') throw new Error('OCCURRENCE_PERMISSION_DENIED');
      throw new Error('OCCURRENCE_AUTHORIZATION_UNAVAILABLE');
    }
    if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
    const profile=snapshot?.exists?.()?snapshot.data():null;
    const permission={sahmtOccurrencesRead:'occurrencesRead',sahmtOccurrencesAuditRead:'occurrencesAuditRead'}[claimName];
    if (!plain(profile) || profile.uid !== uid || profile.active !== true || profile.access !== true
      || (permission && profile.permissions?.[permission] !== true)) {
      throw new Error('OCCURRENCE_PERMISSION_DENIED');
    }
    return {user,profile};
  };

  const loadCatalog = async ({uid} = {}) => {
    await requirePermission(uid, 'sahmtOccurrencesCatalogRead');
    if (catalogCache?.uid === uid) return catalogCache.value;
    let snapshot;
    try { snapshot = await api.getDocFromServer(api.doc(db, CATALOGS, 'current')); }
    catch (error) {
      if(error?.code==='permission-denied')throw new Error('OCCURRENCE_CATALOG_PERMISSION_DENIED');
      if(TRANSIENT_FIRESTORE_CODES.has(error?.code))throw new Error('OCCURRENCE_CATALOG_READ_UNAVAILABLE');
      throw new Error('OCCURRENCE_CATALOG_UNAVAILABLE');
    }
    if (!snapshot?.exists?.()) throw new Error('OCCURRENCE_CATALOG_UNAVAILABLE');
    const value = validateOccurrenceCatalogDocument(snapshot.data());
    if (!isCurrent()) throw new Error('OCCURRENCE_SESSION_CHANGED');
    catalogCache = {uid, value};
    return value;
  };

  const save = async ({uid, displayName, anonymous = false, formId, values, recordId, catalogs} = {}) => {
    const {user} = await requirePermission(uid, 'sahmtOccurrencesWrite');
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
    const sequenceRef = api.doc(db, 'occurrenceSequences', 'app');
    const followupRef = api.doc(db,FOLLOWUPS,recordId);
    const safe = safeAppNarrative(report,displayName,[user.email,values.attendance,values.patientOrAttendance,values.prescriptionNumber]);
    try {
      const result = await api.runTransaction(db, async transaction => {
        const [priorReport, priorAudit, priorScore] = await Promise.all([
          transaction.get(reportRef), transaction.get(auditRef), transaction.get(scoreRef)
        ]);
        if (priorReport.exists() || priorAudit.exists() || priorScore.exists()) {
          if (priorReport.exists() && priorAudit.exists() && priorScore.exists()
            && priorAudit.data()?.uid === uid && priorReport.data()?.formId === formId
            && priorScore.data()?.uid === uid && priorScore.data()?.sourceId === recordId) {
            return {status:'already-saved',sequence:priorReport.data().sequence};
          }
          throw new Error('OCCURRENCE_RECONCILIATION_REQUIRED');
        }
        const counter = await transaction.get(sequenceRef);
        const sequence = counter.exists() ? counter.data().last + 1 : 1;
        if (!occurrenceAppProtocol(sequence)) throw new Error('OCCURRENCE_RECONCILIATION_REQUIRED');
        if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
        transaction.set(sequenceRef, {last:sequence,reportId:recordId});
        transaction.set(reportRef, {...report,sequence});
        transaction.set(followupRef,{schemaVersion:1,id:recordId,origin:'app',formId,sequence,
          occurredOn:report.occurredOn,...safe,createdAt:api.serverTimestamp()});
        transaction.set(auditRef, audit);
        transaction.set(scoreRef, scoreClaim);
        return {status:'saved',sequence};
      });
      if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
      // A confirmed FC record is not undone by FB unavailability. Its existing
      // pending claim supports recovery; no point amount is sent by the browser.
      Promise.resolve().then(()=>notifyScore({id:recordId,uid,auth,isCurrent})).catch(()=>{});
      return Object.freeze({status:result.status,id:recordId,protocol:occurrenceAppProtocol(result.sequence),pointsStatus:'PENDING_VALIDATION'});
    } catch (error) {
      if (['OCCURRENCE_SESSION_CHANGED','OCCURRENCE_RECONCILIATION_REQUIRED'].includes(error?.message)) throw error;
      if (error?.code === 'permission-denied') throw new Error('OCCURRENCE_PERMISSION_DENIED');
      if (TRANSIENT_FIRESTORE_CODES.has(error?.code)) throw new Error('OCCURRENCE_TRANSIENT_WRITE_FAILED');
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

  const hasGrant = async (uid,kind) => {
    const {profile} = await requirePermission(uid);
    if (fcAdministrator(profile)) return true;
    const grant = await api.getDocFromServer(api.doc(db,GRANTS.get(kind),uid));
    return grant.exists() && grant.data().enabled === true;
  };
  const hospitalAccess = ({uid} = {}) => hasGrant(uid,'hospital');
  const descriptionAccess = ({uid} = {}) => hasGrant(uid,'descriptions');
  const saveDescription = async ({uid,id,description,expectedDescription} = {}) => {
    if (!followupId(id) || !boundedText(description,5000) ||
      (expectedDescription !== null && typeof expectedDescription !== 'string')) throw new Error('OCCURRENCE_INPUT_INVALID');
    if (!await descriptionAccess({uid})) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const next = description.trim(),ref=api.doc(db,FOLLOWUPS,id);
    await api.runTransaction(db,async tx => {
      const snapshot = await tx.get(ref);
      if (!isCurrent() || auth.currentUser?.uid !== uid) throw new Error('OCCURRENCE_SESSION_CHANGED');
      if (!snapshot.exists()) throw new Error('OCCURRENCE_RECORD_NOT_FOUND');
      const previous = snapshot.data().description ?? null;
      if (previous === next) return;
      if (previous !== expectedDescription) throw new Error('OCCURRENCE_DESCRIPTION_CHANGED');
      tx.update(ref,{description:next});
    });
    return next;
  };
  const listFollowups = async ({uid,formId,after} = {}) => {
    await requirePermission(uid);
    if (!getOccurrenceForm(formId)) throw new Error('OCCURRENCE_INPUT_INVALID');
    const pageSize = 30;
    const criteria = [api.where('formId','==',formId),api.orderBy(api.documentId()),api.limit(pageSize)];
    if (after) criteria.push(api.startAfter(after));
    const page = await api.getDocsFromServer(api.query(api.collection(db,FOLLOWUPS),...criteria));
    return {entries:page.docs.map(doc => doc.data()),next:page.docs.length === pageSize ? page.docs.at(-1) : null};
  };
  const readAnalysis = async ({uid,id} = {}) => {
    await requirePermission(uid);
    if (!followupId(id)) throw new Error('OCCURRENCE_INPUT_INVALID');
    const row = await api.getDocFromServer(api.doc(db,FOLLOWUPS,id,'analyses',uid));
    return row.exists() ? row.data().analysis : null;
  };
  const saveAnalysis = async ({uid,id,values} = {}) => {
    await requirePermission(uid);
    if (!followupId(id)) throw new Error('OCCURRENCE_INPUT_INVALID');
    const analysis = readOccurrenceAnalysis(values);
    if (!analysis) return false;
    await api.runTransaction(db,async tx => {
      tx.set(api.doc(db,FOLLOWUPS,id,'analyses',uid),{analysis,updatedAt:api.serverTimestamp()});
    });
    return true;
  };
  const listAnalyses = async ({uid,id,after} = {}) => {
    const {profile} = await requirePermission(uid);
    if (!fcAdministrator(profile) || !followupId(id)) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const pageSize = 30;
    const criteria = [api.orderBy(api.documentId()),api.limit(pageSize)];
    if (after) criteria.push(api.startAfter(after));
    const page = await api.getDocsFromServer(api.query(api.collection(db,FOLLOWUPS,id,'analyses'),...criteria));
    return {entries:page.docs.map(doc => doc.data()),next:page.docs.length === pageSize ? page.docs.at(-1) : null};
  };
  const saveHospital = async ({uid,formId,number,occurredOn,title,description} = {}) => {
    if (!await hospitalAccess({uid})) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const hospitalNumber = occurrenceHospitalNumber(number);
    if (!hospitalNumber || !getOccurrenceForm(formId) || !isValidDateKey(occurredOn)
      || !boundedText(title,180) || !boundedText(description,5000)) throw new Error('OCCURRENCE_INPUT_INVALID');
    const id = 'gr-'+hospitalNumber;
    const entry = {schemaVersion:1,id,origin:'hospital',formId,hospitalNumber,occurredOn,title:title.trim(),
      description:description.trim(),classification:{},details:{},createdAt:api.serverTimestamp()};
    await api.runTransaction(db,async transaction => {
      const ref = api.doc(db,FOLLOWUPS,id);
      const prior = await transaction.get(ref);
      if (prior.exists()) {
        if (['formId','occurredOn','title','description'].some(key => prior.data()[key] !== entry[key])) {
          throw new Error('OCCURRENCE_HOSPITAL_DUPLICATE');
        }
        return;
      }
      transaction.set(ref,entry);
      transaction.set(api.doc(db,'occurrenceHospitalAudit',id),{uid,createdAt:api.serverTimestamp()});
    });
    return occurrenceProtocol(entry);
  };
  const getGrant = async ({uid,subjectUid,kind} = {}) => {
    const {profile} = await requirePermission(uid);
    const target = GRANTS.get(kind);
    if (!target || !fcAdministrator(profile) || !validUid(subjectUid)) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const value = await api.getDocFromServer(api.doc(db,target,subjectUid));
    return value.exists() && value.data().enabled === true;
  };
  const saveGrant = async ({uid,subjectUid,kind,enabled} = {}) => {
    const {profile} = await requirePermission(uid);
    const target = GRANTS.get(kind);
    if (!target || !fcAdministrator(profile) || !validUid(subjectUid) || typeof enabled !== 'boolean') {
      throw new Error('OCCURRENCE_PERMISSION_DENIED');
    }
    await api.runTransaction(db,async tx => {
      tx.set(api.doc(db,target,subjectUid),{enabled,updatedBy:uid,updatedAt:api.serverTimestamp()});
    });
  };

  return Object.freeze({loadCatalog,save,list,listAudit,listFollowups,readAnalysis,saveAnalysis,listAnalyses,
    hospitalAccess,saveHospital,descriptionAccess,saveDescription,getGrant,saveGrant,clear:()=>{catalogCache=null;}});
}
