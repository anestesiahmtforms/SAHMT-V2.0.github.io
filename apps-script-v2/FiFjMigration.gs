/** FA-only overlay. Publication tools must rename the exact captured originals first.
 * A zero publication epoch deliberately prevents retirement. Never enable on install. */
const SAHMT_FI_FJ_PUBLICATION_EPOCH = 0;
const SAHMT_FI_FJ_SOURCE_SCRIPT = '1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD';
function sahmtFiFjRetired_() { return PropertiesService.getScriptProperties().getProperty('SAHMT_FI_FJ_PRODUCERS_RETIRED') === 'YES'; }
function sahmtFiFjTarget_(collection) {
  if(collection==='events'||collection==='eventCatalogs')return 'sahmt-operacional-fi';
  if(collection==='scheduleDays'||collection==='vacations')return 'sahmt-escala-fj';
  return null;
}
function sahmtFiFjTargetsValid_(control) { return !!(control && control.targetProjects && control.targetProjects.FI === 'sahmt-operacional-fi' && control.targetProjects.FJ === 'sahmt-escala-fj'); }
function sahmtFiFjReadsActive_() {
  if (!sahmtFiFjRetired_()) return false;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SAHMT_FI_FJ_READS_ACTIVE') === 'YES') return true;
  const control = sahmtFiFjOriginalGetFirestoreDocument_('migrationControl','fi-fj-cutover');
  if (!sahmtFiFjTargetsValid_(control) || !['TARGETS_READY','ACTIVE'].includes(control.phase) || control.finalDeltaVerified !== true || control.moduleProjectionsReady !== true) return false;
  props.setProperty('SAHMT_FI_FJ_READS_ACTIVE','YES'); return true;
}
function sahmtFiFjReadTarget_(collection) { return sahmtFiFjTarget_(collection) && sahmtFiFjReadsActive_(); }
function sahmtFiFjSourcePath_(name) {
  return /^projects\/sahmt-17a16\/databases\/\(default\)\/documents\/(events|eventCatalogs|scheduleDays|vacations)(?:\/|$)/.test(String(name));
}
function sahmtFiFjGuardWrite_(url,options) {
  if (!sahmtFiFjRetired_()) return;
  const method = String(options && options.method || 'get').toLowerCase();
  if (!['post','patch','put','delete'].includes(method)) return;
  const path = decodeURIComponent(String(url).replace(/^https:\/\/firestore.googleapis.com\/v1\//,'').split('?')[0]);
  if (sahmtFiFjSourcePath_(path)) throw Error('FI_FJ_SOURCE_MOVED');
  if (/:commit$|:batchWrite$/.test(path)) {
    const body = JSON.parse(options && options.payload || '{}');
    if ((body.writes || []).some(function(w) {return sahmtFiFjSourcePath_(w.update && w.update.name || w.delete || w.transform && w.transform.document);})) throw Error('FI_FJ_SOURCE_MOVED');
  }
}
function firestoreRequest_(url,options) { sahmtFiFjGuardWrite_(url,options); return sahmtFiFjOriginalFirestoreRequest_(url,options); }
function ocsFirestore_(suffix,options) { sahmtFiFjGuardWrite_('https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents'+suffix,options); return sahmtFiFjOriginalOcsFirestore_(suffix,options); }
function sahmtFiFjUrl_(collection,suffix) {
  const target = sahmtFiFjTarget_(collection); if (!target) throw Error('FI_FJ_READ_SCOPE_DENIED');
  return 'https://firestore.googleapis.com/v1/projects/'+target+'/databases/(default)/documents'+suffix;
}
function sahmtFiFjDocument_(collection,document) {
  const prefix = 'projects/'+sahmtFiFjTarget_(collection)+'/databases/(default)/documents/'+collection+'/';
  if (!document || typeof document.name !== 'string' || !document.name.startsWith(prefix) || !document.name.slice(prefix.length) || document.name.slice(prefix.length).includes('/')) throw Error('FI_FJ_DOCUMENT_SCOPE_DENIED');
  return document;
}
function sahmtFiFjGet_(collection,id,fields) {
  if (typeof id !== 'string' || !id || id.length>1500 || /[\/\x00-\x1f]/.test(id) || ['.','..'].includes(id)) throw Error('FI_FJ_DOCUMENT_ID_INVALID');
  const mask = Array.isArray(fields) ? fields.map(function(f) {return 'mask.fieldPaths='+encodeURIComponent(f);}).join('&') : '';
  try { return sahmtFiFjDocument_(collection,firestoreRequest_(sahmtFiFjUrl_(collection,'/'+collection+'/'+encodeURIComponent(id))+(mask?'?'+mask:''),{method:'get'})); }
  catch (error) { if (error.status === 404) return null; throw error; }
}
function sahmtFiFjQueryRaw_(collection,filters,orderBy,maximum,fields,cursor,readTime) {
  if (!Number.isSafeInteger(maximum) || maximum<1 || maximum>10001) throw Error('FI_FJ_QUERY_LIMIT_INVALID');
  const query = {from:[{collectionId:collection}],limit:maximum}; filters=filters||[];orderBy=orderBy||[];
  if (filters.length===1) query.where={fieldFilter:filters[0]};
  else if(filters.length>1) query.where={compositeFilter:{op:'AND',filters:filters.map(function(f){return {fieldFilter:f};})}};
  if(orderBy.length) query.orderBy=orderBy.map(function(o){return {field:{fieldPath:o.fieldPath},direction:o.direction};});
  if(fields && fields.length) query.select={fields:fields.map(function(f){return {fieldPath:f};})};
  if(cursor) query.startAt=cursor;
  const body={structuredQuery:query};if(readTime)body.readTime=readTime;
  const response=firestoreRequest_(sahmtFiFjUrl_(collection,':runQuery'),{method:'post',contentType:'application/json',payload:JSON.stringify(body)});
  if(!Array.isArray(response)||response.some(function(row){return row.error;}))throw Error('FI_FJ_INPUT_INCOMPLETE');
  response.forEach(function(row){if(row.document)sahmtFiFjDocument_(collection,row.document);});
  if(response.filter(function(row){return row.document;}).length>maximum)throw Error('FI_FJ_INPUT_INCOMPLETE');
  return response;
}
function sahmtFiFjDecoded_(document,evaluation,id) {
  const fields=firestoreFieldsToJs_(document.fields||{}),key=String(document.name).split('/').pop();
  return Object.assign(fields,{id:id || (evaluation?key:fields.id||key),_documentName:document.name,_updateTime:document.updateTime},evaluation?{_name:document.name,_createTime:document.createTime}:{});
}
function getFirestoreDocument_(collection,id,fields) {
  if(!sahmtFiFjReadTarget_(collection))return sahmtFiFjOriginalGetFirestoreDocument_.apply(null,arguments);
  const doc=sahmtFiFjGet_(collection,id,fields);return doc?sahmtFiFjDecoded_(doc,false,id):null;
}
function queryFirestore_(collection,filters,orderBy,maximum,fields) {
  if(!sahmtFiFjReadTarget_(collection))return sahmtFiFjOriginalQueryFirestore_.apply(null,arguments);
  return sahmtFiFjQueryRaw_(collection,filters,orderBy,maximum,fields).filter(function(r){return r.document;}).map(function(r){return sahmtFiFjDecoded_(r.document,false);});
}
function evaluationGet_(collection,id,transaction,fields) {
  if(!sahmtFiFjReadTarget_(collection))return sahmtFiFjOriginalEvaluationGet_.apply(null,arguments);
  const doc=sahmtFiFjGet_(collection,id,fields);return doc?sahmtFiFjDecoded_(doc,true,id):null;
}
function evaluationQuery_(collection,filters,orderBy,maximum,fields,transaction,cursor) {
  if(!sahmtFiFjReadTarget_(collection))return sahmtFiFjOriginalEvaluationQuery_.apply(null,arguments);
  return sahmtFiFjQueryRaw_(collection,filters,orderBy,maximum||100,fields,cursor).filter(function(r){return r.document;}).map(function(r){return sahmtFiFjDecoded_(r.document,true);});
}
function faPerformanceRead_(collection,maximum,snapshot) {
  if(collection!=='events'||!sahmtFiFjReadTarget_(collection))return sahmtFiFjOriginalFaPerformanceRead_.apply(null,arguments);
  faPerformanceIdentity_();
  const response=sahmtFiFjQueryRaw_(collection,[],[],maximum+1,['eventType','delayMultiple','date','memberSigla','active','status','createdAt'],null,snapshot.readTime);
  if(!response.length)throw Error('FA_INPUT_INCOMPLETE');
  if(!snapshot.readTime){snapshot.readTime=response[response.length-1].readTime;if(!snapshot.readTime)throw Error('FA_INPUT_INCOMPLETE');}
  const rows=response.filter(function(r){return r.document;}).map(function(r){return Object.assign(faPerformanceFields_(r.document.fields||{}),{id:r.document.name.split('/').pop(),documentCreatedAt:Date.parse(r.document.createTime)});});
  if(rows.length>maximum)throw Error('FA_INPUT_INCOMPLETE');return rows;
}
function sahmtFiFjIdentity_() {
  if(String(Session.getEffectiveUser().getEmail()).toLowerCase()!=='anestesiahmtforms@gmail.com')throw Error('FI_FJ_OWNER_REQUIRED');
  if(SAHMT_V2_CONFIG.projectId!=='sahmt-17a16')throw Error('FI_FJ_PROJECT_REQUIRED');
  if(ScriptApp.getScriptId()!==SAHMT_FI_FJ_SOURCE_SCRIPT)throw Error('FI_FJ_SCRIPT_REQUIRED');
}
function prepararSeparacaoEscalaEventosFA() {
  sahmtFiFjIdentity_();
  const counts={};['events','eventCatalogs','scheduleDays','vacations'].forEach(function(collection){counts[collection]=sahmtFiFjQueryRaw_(collection,[],[],1,['__name__']).filter(function(r){return r.document;}).length;});
  const result={code:'FI_FJ_READ_ACCESS_READY',probeCounts:counts,firestoreWrites:0};console.log(JSON.stringify(result));return result;
}
function retirarEscalaEventosFA() {
  sahmtFiFjIdentity_();
  if(!Number.isSafeInteger(SAHMT_FI_FJ_PUBLICATION_EPOCH)||SAHMT_FI_FJ_PUBLICATION_EPOCH<=0||Date.now()-SAHMT_FI_FJ_PUBLICATION_EPOCH<360000)throw Error('FI_FJ_PUBLICATION_DRAIN_REQUIRED');
  prepararSeparacaoEscalaEventosFA();
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('FI_FJ_RETIREMENT_BUSY');
  try {
    const control=sahmtFiFjOriginalGetFirestoreDocument_('migrationControl','fi-fj-cutover');
    if(!sahmtFiFjTargetsValid_(control)||!['SOURCE_RULES_FROZEN','SOURCE_PRODUCERS_RETIRED'].includes(control.phase)||!control._updateTime)throw Error('FI_FJ_SOURCE_FREEZE_REQUIRED');
    PropertiesService.getScriptProperties().setProperty('SAHMT_FI_FJ_PRODUCERS_RETIRED','YES');
    let removed=0;ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='publishScheduleSourceToFirestore'&&t.getEventType()===ScriptApp.EventType.CLOCK){ScriptApp.deleteTrigger(t);removed++;}});
    const changes={phase:'SOURCE_PRODUCERS_RETIRED',sourceProducersRetired:true,sourceScriptId:SAHMT_FI_FJ_SOURCE_SCRIPT,sourceProducersRetiredAt:new Date(),targetProjects:{FI:'sahmt-operacional-fi',FJ:'sahmt-escala-fj'}};
    firestoreRequest_('https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents:commit',{method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{update:{name:'projects/sahmt-17a16/databases/(default)/documents/migrationControl/fi-fj-cutover',fields:firestoreFieldsFromJs_(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:control._updateTime}}]})});
    const result={code:'FI_FJ_SOURCE_PRODUCERS_RETIRED',removedScheduleTriggers:removed,readersActivated:false};console.log(JSON.stringify(result));return result;
  } finally {lock.releaseLock();}
}
