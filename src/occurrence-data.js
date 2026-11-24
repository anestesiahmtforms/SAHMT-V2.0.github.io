import {collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, where} from 'firebase/firestore';
import {FIREBASE_PROJECTS} from './firebase-projects.js';
import {OCCURRENCE_CATALOG_SPECS, OCCURRENCE_ETHICAL_REVIEW_LIMIT, OCCURRENCE_PRIVATE_FIELDS,
  OCCURRENCE_REGISTRATION_POINTS, getOccurrenceForm, occurrenceActionFollowupFields, occurrenceAppProtocol,
  occurrenceHospitalNumber, occurrenceProtocol, readOccurrenceAnalysis, validateOccurrenceValues, withOccurrencePatientFields} from './occurrence-schema.js';
import {isValidDateKey} from './schedule-date.js';
import {OCCURRENCE_COMMENT_LIMIT,OCCURRENCE_QUESTION_COUNT,OCCURRENCE_SAFETY_MAX_QUESTIONS,OCCURRENCE_OPTION_LIMIT,
  normalizeOccurrenceQuestions} from './occurrence-questionnaire.js';

const REPORTS = 'occurrenceReports';
const AUDIT = 'occurrenceAudit';
const SCORE_CLAIMS = 'occurrenceScoreClaims';
const CATALOGS = 'occurrenceCatalogs';
const FOLLOWUPS = 'occurrenceFollowups';
const QUESTIONNAIRE_RESPONSES = 'ethicalPollResponses';
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

function occurrenceRedactor(identifiers) {
  const confidential = identifiers.filter(text => boundedText(text,5000))
    .map(text => text.trim()).sort((a,b) => b.length - a.length);
  const identity = confidential.map(value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const pattern = identity ? new RegExp(`(^|[^\\p{L}\\p{N}])(?:${identity})(?![\\p{L}\\p{N}])`,'giu') : null;
  return text => typeof text !== 'string' || !pattern ? text :
    text.replace(pattern,(_match,before) => before+'…');
}

function safeAppNarrative(report, redact) {
  const safeFields = values => Object.fromEntries(Object.entries(values)
    .filter(([key]) => !OCCURRENCE_PRIVATE_FIELDS.includes(key)).map(([key,value]) => [key,redact(value)]));
  return {title:redact(report.occurrence),description:redact(report.description),
    classification:safeFields(report.classification),details:safeFields(report.details)};
}

function preparationAdditions(form,values,redact=text=>text) {
  return Object.fromEntries(occurrenceActionFollowupFields(form).flatMap(field=>{
    const value=values?.[field.id];
    if(!boundedText(value,field.maxLength??300))return [];
    if(field.fixedValue)return value===field.fixedValue?[[field.id,value]]:[];
    if(field.options)return field.options.includes(value)?[[field.id,value]]:[];
    return [[field.id,redact(value.trim())]];
  }));
}

function analysisClinicalFields(values,redact=text=>text) {
  return Object.fromEntries(Object.entries({age:40,sex:12,diagnosisOrTreatment:3000}).flatMap(([key,max])=>{
    const value=values?.[key];
    return boundedText(value,max)?[[key,redact(value.trim())]]:[];
  }));
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
  const sendScore = (id, uid) => {
    void Promise.resolve().then(() => notifyScore({id,uid,auth,isCurrent})).catch(() => {});
  };

  function saveParticipationClaim(transaction, id, uid, stage) {
    const claimId = stage+'-'+id+'_'+uid;
    transaction.set(api.doc(db,SCORE_CLAIMS,claimId),{
      schemaVersion:1,id:claimId,source:stage==='analysis'?'ANALISE_OCORRENCIA':'CIENCIA_OCORRENCIA',
      sourceId:id,uid,points:1,status:'PENDING_VALIDATION',createdAt:api.serverTimestamp()
    });
  }

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
    const formFields = [...form.classification, ...form.fields];
    const details = Object.fromEntries(withOccurrencePatientFields(formFields).map(item => item.id)
      .filter(key => !commonIds.has(key) && !classificationIds.has(key) && values[key] !== undefined)
      .map(key => [key, values[key].trim()]));
    if (form.actionFollowup) {
      details.actionFollowup = Object.fromEntries(occurrenceActionFollowupFields(form)
        .map(item => [item.id, item.fixedValue ?? values[item.id].trim()]));
    }
    const report = Object.freeze({schemaVersion:1,id:recordId,formId,formTitle:form.title,
      occurredOn:form.noGeneralInformation ? null : values.eventDate.trim(),
      occurrence:form.noGeneralInformation ? null : values.occurrence.trim(),
      description:form.noGeneralInformation ? null : values.description.trim(),
      classification,details,anonymous,authorLabel:anonymous ? 'Anônimo' : displayName.trim(),
      pointsClaimed:OCCURRENCE_REGISTRATION_POINTS,pointsStatus:'PENDING_VALIDATION',createdAt:api.serverTimestamp()});
    const audit = Object.freeze({schemaVersion:1,reportId:recordId,uid,formId,anonymous,createdAt:api.serverTimestamp()});
    const scoreClaim = Object.freeze({schemaVersion:1,id:recordId,source:'REGISTRO_OCORRENCIA',sourceId:recordId,originProjectId:SOURCE_PROJECT,
      uid,formId,points:OCCURRENCE_REGISTRATION_POINTS,status:'PENDING_VALIDATION',createdAt:api.serverTimestamp()});
    if (jsonBytes({...report,createdAt:'timestamp'}) > MAX_RECORD_BYTES) throw new Error('OCCURRENCE_RECORD_TOO_LARGE');

    const reportRef = api.doc(db, REPORTS, recordId);
    const auditRef = api.doc(db, AUDIT, recordId);
    const scoreRef = api.doc(db, SCORE_CLAIMS, recordId);
    const sequenceRef = api.doc(db, 'occurrenceSequences', 'app');
    const followupRef = api.doc(db,FOLLOWUPS,recordId);
    const redact = occurrenceRedactor([displayName,user.email,values.attendance,values.patientOrAttendance,values.prescriptionNumber]);
    const safe = safeAppNarrative(report,redact);
    const preparation = preparationAdditions(form,details.actionFollowup,redact);
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
        if(Object.keys(preparation).length) {
          transaction.set(api.doc(db,FOLLOWUPS,recordId,'preparationContext','current'),{
            fields:preparation,clinical:analysisClinicalFields(details,redact),
            attendance:details.attendance??classification.patientOrAttendance
          });
        }
        transaction.set(auditRef, audit);
        transaction.set(scoreRef, scoreClaim);
        return {status:'saved',sequence};
      });
      if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
      // A confirmed FC record is not undone by FB unavailability. Its existing
      // pending claim supports recovery; no point amount is sent by the browser.
      sendScore(recordId,uid);
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
  const readAnalysisAttendance = async ({uid,id} = {}) => {
    if(!followupId(id)||id.startsWith('gr-'))return null;
    const user=auth.currentUser;
    if(!await descriptionAccess({uid}))return null;
    const context=await api.getDocFromServer(api.doc(db,FOLLOWUPS,id,'preparationContext','current'));
    if(!isCurrent()||auth.currentUser!==user)throw new Error('OCCURRENCE_SESSION_CHANGED');
    const attendance=context.exists()?context.data().attendance:null;
    if(boundedText(attendance,180))return attendance;
    let original;
    try {original=await api.getDocFromServer(api.doc(db,REPORTS,id));}
    catch(error){if(error?.code==='permission-denied')return null;throw error;}
    if(!isCurrent()||auth.currentUser!==user)throw new Error('OCCURRENCE_SESSION_CHANGED');
    if(!original.exists())return null;
    const {classification,details}=original.data();
    return details?.attendance??classification?.patientOrAttendance??null;
  };
  const readPreparationContext = async ({uid,id,formId,includeClinical=false} = {}) => {
    const form=getOccurrenceForm(formId);
    if(!form?.actionFollowup||!followupId(id)||id.startsWith('gr-'))return {};
    const user=auth.currentUser;
    if(!await descriptionAccess({uid}))throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const row=await api.getDocFromServer(api.doc(db,FOLLOWUPS,id,'preparationContext','current'));
    if(!isCurrent()||auth.currentUser!==user)throw new Error('OCCURRENCE_SESSION_CHANGED');
    const stored=row.exists()?row.data():null;
    const prepared=preparationAdditions(form,stored?.fields);
    if(stored&&(!includeClinical||stored.clinical))return {
      ...prepared,...(includeClinical?analysisClinicalFields(stored.clinical):{})
    };
    let original;
    try {original=await api.getDocFromServer(api.doc(db,REPORTS,id));}
    catch(error){if(error?.code==='permission-denied')return prepared;throw error;}
    if(!isCurrent()||auth.currentUser!==user)throw new Error('OCCURRENCE_SESSION_CHANGED');
    if(!original.exists())return prepared;
    const report=original.data();
    if(report.formId!==formId)return prepared;
    const redact=occurrenceRedactor([report.authorLabel,report.classification?.patientOrAttendance,report.details?.attendance,
      report.details?.prescriptionNumber]);
    return {...(stored?prepared:preparationAdditions(form,report.details?.actionFollowup,redact)),
      ...(includeClinical?analysisClinicalFields(report.details,redact):{})};
  };
  const ethicalReviewRef = id => {
    if (!followupId(id)) throw new Error('OCCURRENCE_INPUT_INVALID');
    return api.doc(db,FOLLOWUPS,id,'ethicalReview','current');
  };
  const readEthicalText = async (uid,ref) => {
    const {user} = await requirePermission(uid);
    const row = await api.getDocFromServer(ref);
    if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
    return row.exists() ? row.data().text : '';
  };
  const saveEthicalText = async ({uid,ref,text,expectedText,allowEmpty=false,completedRecord,dueDate,expectedDueDate}) => {
    if (typeof text !== 'string' || text.trim().length > OCCURRENCE_ETHICAL_REVIEW_LIMIT ||
      (!allowEmpty&&!text.trim()) || typeof expectedText !== 'string') throw new Error('OCCURRENCE_INPUT_INVALID');
    for(const date of [dueDate,expectedDueDate]) {
      if(date!==undefined&&date!==''&&(typeof date!=='string'||!isValidDateKey(date))) {
        throw new Error('OCCURRENCE_ANALYSIS_DATE_INVALID');
      }
    }
    const {user} = await requirePermission(uid);
    const next = text.trim();
    await api.runTransaction(db,async tx => {
      const row = await tx.get(ref);
      if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
      const previous = row.exists() ? row.data() : {};
      const previousDate = previous.dueDate??'';
      const nextDate = dueDate??previousDate;
      if ((previous.text??'')===next&&previousDate===nextDate) return;
      if ((previous.text??'')!==expectedText||(expectedDueDate!==undefined&&previousDate!==expectedDueDate)) {
        throw new Error('OCCURRENCE_ETHICAL_REVIEW_CHANGED');
      }
      tx.set(ref,{text:next,updatedAt:api.serverTimestamp(),...(nextDate?{dueDate:nextDate}:{})});
      if (completedRecord) tx.update(completedRecord,{analysisClosed:true});
    });
    return next;
  };
  const readEthicalReview = ({uid,id} = {}) => readEthicalText(uid,ethicalReviewRef(id));
  const saveEthicalReview = ({uid,id,text,expectedText} = {}) =>
    saveEthicalText({uid,ref:ethicalReviewRef(id),text,expectedText,allowEmpty:true});
  const analysisRef = (id,collection,document='current') => {
    if (!followupId(id)) throw new Error('OCCURRENCE_INPUT_INVALID');
    return api.doc(db,FOLLOWUPS,id,collection,document);
  };
  const readOccurrenceQuestionnaire = async ({uid,id} = {}) => {
    const {user} = await requirePermission(uid);
    const row = await api.getDocFromServer(analysisRef(id,'analysisQuestionnaire'));
    if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
    if(!row.exists())return null;
    const {questions,revision=0}=row.data();
    return {questions:normalizeOccurrenceQuestions(questions),revision};
  };
  const publishOccurrenceQuestionnaire = async ({uid,id,description,questions} = {}) => {
    if(!boundedText(description,5000))throw new Error('OCCURRENCE_INPUT_INVALID');
    const next=normalizeOccurrenceQuestions(questions);
    if (!await descriptionAccess({uid})) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const ref=analysisRef(id,'analysisQuestionnaire'),record=api.doc(db,FOLLOWUPS,id);
    await api.runTransaction(db,async tx => {
      const row=await tx.get(ref);
      if (!isCurrent() || auth.currentUser?.uid !== uid) throw new Error('OCCURRENCE_SESSION_CHANGED');
      if (row.exists()) throw new Error('OCCURRENCE_QUESTIONNAIRE_PUBLISHED');
      tx.set(ref,{questions:next,publishedAt:api.serverTimestamp()});
      tx.update(record,{analysisStarted:true,preparedDescription:description.trim()});
    });
    return next;
  };
  const closeOccurrenceResponses = async ({uid,id} = {}) => {
    if(!followupId(id)||!await descriptionAccess({uid}))throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const ref=api.doc(db,FOLLOWUPS,id);
    await api.runTransaction(db,async tx=>{
      const snapshot=await tx.get(ref);
      if(!isCurrent()||auth.currentUser?.uid!==uid)throw new Error('OCCURRENCE_SESSION_CHANGED');
      const record=snapshot.data();
      if(record?.responsesClosedAt)return;
      if(record?.analysisStarted!==true||record.analysisClosed===true)throw new Error('OCCURRENCE_RESPONSES_UNAVAILABLE');
      tx.update(ref,{responsesClosedAt:api.serverTimestamp()});
    });
  };
  const readOccurrenceResult = async ({uid,id} = {}) => {
    const {user} = await requirePermission(uid);
    const snapshot=await api.getDocFromServer(analysisRef(id,'ethicalPollResult'));
    if (!isCurrent()||auth.currentUser!==user) throw new Error('OCCURRENCE_SESSION_CHANGED');
    const row=snapshot.data();
    return row ? {text:row.text,updatedAt:row.updatedAt,...(row.dueDate?{dueDate:row.dueDate}:{})} : null;
  };
  const readOccurrenceAcknowledgement = async ({uid,id,resultAt} = {}) => {
    const {user}=await requirePermission(uid);
    const snapshot=await api.getDocFromServer(analysisRef(id,'analysisAcknowledgements',uid));
    if (!isCurrent()||auth.currentUser!==user) throw new Error('OCCURRENCE_SESSION_CHANGED');
    return snapshot.data()?.resultAt?.isEqual(resultAt)===true;
  };
  const acknowledgeOccurrence = async ({uid,id,resultAt} = {}) => {
    const {user}=await requirePermission(uid);
    const result=analysisRef(id,'ethicalPollResult'),receipt=analysisRef(id,'analysisAcknowledgements',uid);
    await api.runTransaction(db,async tx=>{
      const resultRow=await tx.get(result),receiptRow=await tx.get(receipt);
      if (!isCurrent()||auth.currentUser!==user) throw new Error('OCCURRENCE_SESSION_CHANGED');
      if(!resultRow.data()?.updatedAt?.isEqual(resultAt))throw new Error('OCCURRENCE_RESULT_CHANGED');
      if(receiptRow.data()?.resultAt?.isEqual(resultAt))return;
      tx.set(receipt,{resultAt,acknowledgedAt:api.serverTimestamp()});
      if(!receiptRow.exists())saveParticipationClaim(tx,id,uid,'ack');
    });
    sendScore('ack-'+id+'_'+uid,uid);
  };
  const finalizeOccurrence = async ({uid,id,resultAt} = {}) => {
    if (!await descriptionAccess({uid})) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const result=analysisRef(id,'ethicalPollResult'),record=api.doc(db,FOLLOWUPS,id);
    await api.runTransaction(db,async tx=>{
      const parent=await tx.get(record),published=await tx.get(result);
      if (!isCurrent()||auth.currentUser?.uid!==uid) throw new Error('OCCURRENCE_SESSION_CHANGED');
      if(!published.data()?.updatedAt?.isEqual(resultAt))throw new Error('OCCURRENCE_RESULT_CHANGED');
      if(parent.data()?.eventClosed!==true)tx.update(record,{eventClosed:true});
    });
  };
  const saveOccurrenceResult = ({uid,id,text,expectedText,dueDate,expectedDueDate} = {}) =>
    saveEthicalText({uid,ref:analysisRef(id,'ethicalPollResult'),text,expectedText,dueDate,expectedDueDate,
      completedRecord:api.doc(db,FOLLOWUPS,id)});
  const saveDescription = async ({uid,id,description,expectedDescription} = {}) => {
    if (!followupId(id) || !boundedText(description,5000) ||
      (expectedDescription !== null && typeof expectedDescription !== 'string')) throw new Error('OCCURRENCE_INPUT_INVALID');
    if (!await descriptionAccess({uid})) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const next = description.trim(),ref=api.doc(db,FOLLOWUPS,id);
    await api.runTransaction(db,async tx => {
      const snapshot = await tx.get(ref);
      if (!isCurrent() || auth.currentUser?.uid !== uid) throw new Error('OCCURRENCE_SESSION_CHANGED');
      if (!snapshot.exists()) throw new Error('OCCURRENCE_RECORD_NOT_FOUND');
      const previous = snapshot.data().preparedDescription ?? snapshot.data().description ?? null;
      if (previous === next) return;
      if (previous !== expectedDescription) throw new Error('OCCURRENCE_DESCRIPTION_CHANGED');
      tx.update(ref,{preparedDescription:next});
    });
    return next;
  };
  const listFollowups = async ({uid,formId,origin,after} = {}) => {
    const {user} = await requirePermission(uid);
    if ((origin!==undefined&&!['app','hospital'].includes(origin)) || (formId !== undefined && !getOccurrenceForm(formId))) throw new Error('OCCURRENCE_INPUT_INVALID');
    const pageSize = 30;
    const criteria = [api.orderBy(api.documentId()),api.limit(pageSize)];
    if (formId !== undefined) criteria.unshift(api.where('formId','==',formId));
    if (origin !== undefined) criteria.unshift(api.where('origin','==',origin));
    if (after) criteria.push(api.startAfter(after));
    const page = await api.getDocsFromServer(api.query(api.collection(db,FOLLOWUPS),...criteria));
    if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
    return {entries:page.docs.map(doc => doc.data()),next:page.docs.length === pageSize ? page.docs.at(-1) : null};
  };
  const readOccurrenceResponse = async ({uid,id} = {}) => {
    const {user} = await requirePermission(uid);
    const row = await api.getDocFromServer(analysisRef(id,QUESTIONNAIRE_RESPONSES,uid));
    if (!isCurrent() || auth.currentUser !== user) throw new Error('OCCURRENCE_SESSION_CHANGED');
    return row.exists();
  };
  const submitOccurrenceResponse = async ({uid,id,answers,comment='',questionnaireRevision=0} = {}) => {
    if (!Array.isArray(answers) || answers.length<OCCURRENCE_QUESTION_COUNT || answers.length>OCCURRENCE_SAFETY_MAX_QUESTIONS ||
      answers.some(answer=>!Number.isInteger(answer)||answer<1||answer>OCCURRENCE_OPTION_LIMIT) ||
      !Number.isSafeInteger(questionnaireRevision)||questionnaireRevision<0||
      typeof comment !== 'string' || comment.length>OCCURRENCE_COMMENT_LIMIT) throw new Error('OCCURRENCE_INPUT_INVALID');
    const {user} = await requirePermission(uid);
    const ref=analysisRef(id,QUESTIONNAIRE_RESPONSES,uid);
    const status = await api.runTransaction(db,async tx => {
      const row=await tx.get(ref);
      if(!isCurrent()||auth.currentUser!==user) throw new Error('OCCURRENCE_SESSION_CHANGED');
      if(row.exists()) return 'already-submitted';
      tx.set(ref,{answers:[...answers],comment,submittedAt:api.serverTimestamp(),
        ...(questionnaireRevision?{questionnaireRevision}:{})});
      saveParticipationClaim(tx,id,uid,'analysis');
      return 'submitted';
    });
    sendScore('analysis-'+id+'_'+uid,uid);
    return status;
  };
  const listOccurrenceResponses = async ({uid,id,after} = {}) => {
    if(!followupId(id)||!await descriptionAccess({uid})) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const pageSize=30;
    const criteria=[api.orderBy(api.documentId()),api.limit(pageSize)];
    if(after)criteria.push(api.startAfter(after));
    const page=await api.getDocsFromServer(api.query(api.collection(db,FOLLOWUPS,id,QUESTIONNAIRE_RESPONSES),...criteria));
    if(!isCurrent()||auth.currentUser?.uid!==uid) throw new Error('OCCURRENCE_SESSION_CHANGED');
    return {entries:page.docs.map(row=>row.data()),next:page.docs.length===pageSize?page.docs.at(-1):null};
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
    if (!followupId(id) || !await descriptionAccess({uid})) throw new Error('OCCURRENCE_PERMISSION_DENIED');
    const pageSize = 30;
    const criteria = [api.orderBy(api.documentId()),api.limit(pageSize)];
    if (after) criteria.push(api.startAfter(after));
    const page = await api.getDocsFromServer(api.query(api.collection(db,FOLLOWUPS,id,'analyses'),...criteria));
    if (!isCurrent() || auth.currentUser?.uid !== uid) throw new Error('OCCURRENCE_SESSION_CHANGED');
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
    hospitalAccess,saveHospital,descriptionAccess,readPreparationContext,readAnalysisAttendance,saveDescription,readEthicalReview,saveEthicalReview,
    readOccurrenceQuestionnaire,publishOccurrenceQuestionnaire,readOccurrenceResponse,submitOccurrenceResponse,listOccurrenceResponses,readOccurrenceResult,saveOccurrenceResult,readOccurrenceAcknowledgement,acknowledgeOccurrence,finalizeOccurrence,closeOccurrenceResponses,getGrant,saveGrant,
    clear:()=>{catalogCache=null;}});
}
