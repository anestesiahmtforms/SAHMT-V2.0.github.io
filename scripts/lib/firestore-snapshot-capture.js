import {createHash} from 'node:crypto';
import {snapshotDigest, validateSplitSnapshot} from './management-split-plan.js';

// This core never obtains credentials, creates files, or calls a network client.
// The caller owns authentication, private persistence, and the daily read policy.
const PROJECTS = new Set(['sahmt-17a16', 'sahmt-gestao-5ae66']);
const ROOT_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const byteLength = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
class CaptureFailure extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new CaptureFailure(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathPart = value => typeof value === 'string' && value.length > 0 && !['.', '..', '*'].includes(value) && !/[\/\\\x00-\x1f]/.test(value);
const iso = milliseconds => new Date(milliseconds).toISOString();
function readTimeMicros(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/.exec(value);
  requireValue(match && Number(value.slice(0, 4)) > 0, 'INVALID_READ_TIME');
  const seconds = Date.parse(match[1] + 'Z');
  requireValue(Number.isFinite(seconds) && iso(seconds).slice(0, 19) === match[1], 'INVALID_READ_TIME');
  return BigInt(seconds) * 1000n + BigInt((match[2] || '').padEnd(6, '0'));
}
function configuration(options, requireAdapters = true) {
  requireValue(object(options), 'INVALID_CAPTURE_OPTIONS');
  requireValue(PROJECTS.has(options.projectId) && (options.databaseId || '(default)') === '(default)', 'PROJECT_OR_DATABASE_NOT_APPROVED');
  requireValue(Array.isArray(options.rootCollections) && options.rootCollections.length > 0 && options.rootCollections.every(id => typeof id === 'string' && ROOT_ID.test(id)) && new Set(options.rootCollections).size === options.rootCollections.length, 'EXPLICIT_ROOT_SCOPE_REQUIRED');
  if (requireAdapters) requireValue(['transport', 'reserveReads', 'clock', 'checkpoint'].every(key => typeof options[key] === 'function'), 'INJECTED_ADAPTERS_REQUIRED');
  const limits = {maxPages: 20000, maxDepth: 30, maxBytes: 64 * 1024 * 1024, maxDocuments: 100000, maxDurationMs: 45 * 60 * 1000, requestTimeoutMs: 30000, ...(options.limits || {})};
  requireValue(Object.keys(limits).every(key => ['maxPages', 'maxDepth', 'maxBytes', 'maxDocuments', 'maxDurationMs', 'requestTimeoutMs'].includes(key)) && Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0), 'INVALID_CAPTURE_LIMITS');
  requireValue(limits.maxDurationMs < 60 * 60 * 1000, 'DURATION_MUST_FIT_READ_TIME_WINDOW');
  const pageSize = options.pageSize ?? 100, collectionPageSize = options.collectionPageSize ?? 100;
  requireValue([pageSize, collectionPageSize].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1000), 'INVALID_PAGE_SIZE');
  const batchEnabled = options.maxBatchDocuments !== undefined;
  if (batchEnabled) {
    requireValue(Number.isSafeInteger(options.maxBatchDocuments) && options.maxBatchDocuments > 0 && options.maxBatchDocuments <= limits.maxDocuments
      && Number.isSafeInteger(options.maxBatches) && options.maxBatches > 0 && options.maxBatches <= 4, 'INVALID_BATCH_LIMITS');
    requireValue(limits.maxDurationMs <= 180000, 'BATCH_DURATION_LIMIT_REQUIRED');
  } else requireValue(options.maxBatches === undefined && options.resumeState === undefined
    && options.resumeStateSha256 === undefined && options.resumeReviewId === undefined, 'BATCH_OPTIONS_REQUIRED_FOR_RESUME');
  return {...options, databaseId: '(default)', rootCollections: [...options.rootCollections].sort(), limits, pageSize, collectionPageSize,
    batchEnabled, readMicros: readTimeMicros(options.readTime)};
}

const plain = value => object(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => own(value,key));
const hashValue = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum && !Object.is(value,-0);
const equal = (left,right) => snapshotDigest(left) === snapshotDigest(right);
const taskKey = task => task.operation + ':' + task.parentPath + ':' + (task.collectionId || '');
const collectionPath = task => task.parentPath ? task.parentPath + '/' + task.collectionId : task.collectionId;
const entriesCaptured = state => state.documents.length + state.missingDocumentPaths.length;
function configPin(config) {
  return snapshotDigest({schemaVersion:1,projectId:config.projectId,databaseId:config.databaseId,rootCollections:config.rootCollections,
    readTime:config.readTime,pageSize:config.pageSize,collectionPageSize:config.collectionPageSize,limits:config.limits,
    maxBatchDocuments:config.maxBatchDocuments,maxBatches:config.maxBatches});
}
function privateJson(value,maximumBytes) {
  const state={seen:new Set(),nodes:0};
  const walk=(item,depth=0)=>{
    requireValue(depth <= 100 && ++state.nodes <= 1500000,'RESUME_STATE_JSON_LIMIT');
    if(item===null || typeof item==='boolean' || typeof item==='string')return;
    if(typeof item==='number'){requireValue(Number.isFinite(item),'RESUME_STATE_JSON_INVALID');return;}
    requireValue(Array.isArray(item) || plain(item),'RESUME_STATE_JSON_INVALID');
    requireValue(!state.seen.has(item),'RESUME_STATE_JSON_INVALID');state.seen.add(item);
    const keys=Reflect.ownKeys(item);
    requireValue(keys.every(key=>typeof key==='string'),'RESUME_STATE_JSON_INVALID');
    if(Array.isArray(item))requireValue(Object.keys(item).length===item.length && keys.length===item.length+1,'RESUME_STATE_JSON_INVALID');
    for(const key of keys){
      if(Array.isArray(item) && key==='length')continue;
      const descriptor=Object.getOwnPropertyDescriptor(item,key);
      requireValue(descriptor.enumerable && own(descriptor,'value'),'RESUME_STATE_JSON_INVALID');
      if(Array.isArray(item))requireValue(/^(0|[1-9][0-9]*)$/.test(key) && Number(key)<item.length,'RESUME_STATE_JSON_INVALID');
      walk(descriptor.value,depth+1);
    }
    state.seen.delete(item);
  };
  walk(value);requireValue(byteLength(value)<=maximumBytes,'RESUME_STATE_BYTE_LIMIT');return clone(value);
}
function timeMs(value) {
  requireValue(typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value),'RESUME_STATE_TIME_INVALID');
  const ms=Date.parse(value);requireValue(integer(ms) && iso(ms)===value,'RESUME_STATE_TIME_INVALID');return ms;
}
function documentPath(path,config) {
  const parts=typeof path==='string' ? path.split('/') : [];
  return parts.length>=2 && parts.length%2===0 && parts.length/2<=config.limits.maxDepth
    && config.rootCollections.includes(parts[0]) && parts.every(pathPart);
}
function validTask(task,config,paths,knownCollections) {
  requireValue(plain(task) && ['listDocuments','listCollectionIds'].includes(task.operation)
    && typeof task.parentPath==='string' && integer(task.depth,1),'RESUME_TASK_INVALID');
  const keys=['operation','parentPath','depth',...(task.operation==='listDocuments'?['collectionId']:[])];
  requireValue(exactKeys(task,keys),'RESUME_TASK_INVALID');
  if(task.operation==='listDocuments'){
    requireValue(pathPart(task.collectionId) && knownCollections.has(collectionPath(task)),'RESUME_TASK_INVALID');
    requireValue(task.parentPath==='' ? task.depth===1 && config.rootCollections.includes(task.collectionId)
      : paths.has(task.parentPath) && task.depth===task.parentPath.split('/').length/2+1,'RESUME_TASK_INVALID');
  }else requireValue(paths.has(task.parentPath) && task.depth===task.parentPath.split('/').length/2,'RESUME_TASK_INVALID');
  requireValue(task.depth<=config.limits.maxDepth,'RESUME_TASK_INVALID');
  return task;
}
function resumeState(config) {
  requireValue(config.batchEnabled && config.resumeState!==undefined,'BATCH_OPTIONS_REQUIRED_FOR_RESUME');
  requireValue(hashValue(config.resumeStateSha256) && typeof config.resumeReviewId==='string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(config.resumeReviewId),'EXPLICIT_BATCH_RESUME_REVIEW_REQUIRED');
  const state=privateJson(config.resumeState,config.limits.maxBytes);
  requireValue(snapshotDigest(state)===config.resumeStateSha256,'RESUME_STATE_PIN_MISMATCH');
  const keys=['schemaVersion','mode','projectId','databaseId','readTime','rootCollections','scopeSha256','startedAt','status','queue','active',
    'documents','missingDocumentPaths','completedCollections','completedDiscoveryParents','pages','totalReservedReads','totalResponseBytes',
    'finishedAt','captureConfigSha256','batch','batchHistory','knownCollections','lastObservedAt'];
  requireValue(exactKeys(state,keys) && state.schemaVersion===1 && state.mode==='READ_ONLY_FIRESTORE_CAPTURE'
    && state.status==='PARTIAL_REVIEW','RESUME_REQUIRES_CLEAN_PARTIAL_REVIEW');
  requireValue(state.projectId===config.projectId && state.databaseId===config.databaseId && state.readTime===config.readTime
    && equal(state.rootCollections,config.rootCollections) && state.captureConfigSha256===configPin(config)
    && state.scopeSha256===snapshotDigest({projectId:config.projectId,databaseId:config.databaseId,rootCollections:config.rootCollections}),
  'RESUME_CAPTURE_CONTEXT_CHANGED');
  const started=timeMs(state.startedAt),finished=timeMs(state.finishedAt),last=timeMs(state.lastObservedAt);
  requireValue(started<=finished && finished<=last,'RESUME_STATE_TIME_INVALID');
  const batchKeys=['number','maxDocuments','maxBatches','documentEntriesAtStart','startedAt','reviewId'];
  const batch=state.batch;
  requireValue(exactKeys(batch,batchKeys) && integer(batch.number,1) && batch.number<=config.maxBatches
    && batch.maxDocuments===config.maxBatchDocuments && batch.maxBatches===config.maxBatches
    && integer(batch.documentEntriesAtStart) && timeMs(batch.startedAt)>=started
    && timeMs(batch.startedAt)<=finished && (batch.number===1 ? batch.reviewId===null : typeof batch.reviewId==='string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(batch.reviewId)), 'RESUME_BATCH_INVALID');
  requireValue(batch.number<config.maxBatches,'BATCH_CAPTURE_PLAN_EXHAUSTED_REQUIRES_NEW_PLAN');
  requireValue(Array.isArray(state.documents) && Array.isArray(state.missingDocumentPaths)
    && state.documents.length<=config.limits.maxDocuments && new Set(state.missingDocumentPaths).size===state.missingDocumentPaths.length,
  'RESUME_DOCUMENTS_INVALID');
  try{validateSplitSnapshot({schemaVersion:1,projectId:config.projectId,databaseId:config.databaseId,readTime:config.readTime,
    coverage:{complete:true,consistent:true,rootCollections:config.rootCollections},documents:state.documents});}catch{fail('RESUME_DOCUMENTS_INVALID');}
  const paths=new Set(state.documents.map(row=>row.path));
  requireValue([...paths].every(path=>documentPath(path,config)) && state.missingDocumentPaths.every(path=>documentPath(path,config) && !paths.has(path)),
    'RESUME_DOCUMENTS_INVALID');
  for(const path of state.missingDocumentPaths)paths.add(path);
  requireValue(entriesCaptured(state)-batch.documentEntriesAtStart===config.maxBatchDocuments,'RESUME_BATCH_COUNTER_INVALID');
  requireValue(Array.isArray(state.knownCollections) && state.knownCollections.length>0
    && new Set(state.knownCollections).size===state.knownCollections.length
    && state.knownCollections.every(path=>{
      const parts=typeof path==='string'?path.split('/'):[];
      return parts.length%2===1 && parts.every(pathPart) && config.rootCollections.includes(parts[0])
        && (parts.length===1 || paths.has(parts.slice(0,-1).join('/')));
    }) && config.rootCollections.every(root=>state.knownCollections.includes(root)),'RESUME_COLLECTION_COVERAGE_INVALID');
  const known=new Set(state.knownCollections);
  requireValue([...paths].every(path=>known.has(path.split('/').slice(0,-1).join('/'))),'RESUME_COLLECTION_COVERAGE_INVALID');
  requireValue(Array.isArray(state.completedCollections) && new Set(state.completedCollections).size===state.completedCollections.length
    && state.completedCollections.every(path=>known.has(path)) && Array.isArray(state.completedDiscoveryParents)
    && new Set(state.completedDiscoveryParents).size===state.completedDiscoveryParents.length
    && state.completedDiscoveryParents.every(path=>paths.has(path)), 'RESUME_COMPLETED_TASKS_INVALID');
  requireValue(Array.isArray(state.queue),'RESUME_QUEUE_INVALID');
  const pending=state.queue.map(task=>validTask(task,config,paths,known)),pendingKeys=new Set(pending.map(taskKey));
  requireValue(pendingKeys.size===pending.length,'RESUME_QUEUE_INVALID');
  let active=null;
  if(state.active!==null){
    const activeKeys=['operation','parentPath','depth',...(state.active.operation==='listDocuments'?['collectionId']:[]),'pageToken',
      'consumedTokenHashes',...(state.active.operation==='listCollectionIds'?['discoveredCollectionIds']:[])];
    requireValue(exactKeys(state.active,activeKeys) && typeof state.active.pageToken==='string' && state.active.pageToken.length>0
      && state.active.pageToken.length<=65536 && Array.isArray(state.active.consumedTokenHashes)
      && state.active.consumedTokenHashes.every(hashValue) && new Set(state.active.consumedTokenHashes).size===state.active.consumedTokenHashes.length,
    'RESUME_ACTIVE_CURSOR_INVALID');
    active={operation:state.active.operation,parentPath:state.active.parentPath,depth:state.active.depth,
      ...(state.active.operation==='listDocuments'?{collectionId:state.active.collectionId}:{})};
    validTask(active,config,paths,known);
    requireValue(!pendingKeys.has(taskKey(active)),'RESUME_QUEUE_INVALID');
    pending.push(active);pendingKeys.add(taskKey(active));
    if(active.operation==='listCollectionIds')requireValue(Array.isArray(state.active.discoveredCollectionIds)
      && state.active.discoveredCollectionIds.every(pathPart)
      && new Set(state.active.discoveredCollectionIds).size===state.active.discoveredCollectionIds.length
      && state.active.discoveredCollectionIds.every(id=>known.has(active.parentPath+'/'+id)),'RESUME_ACTIVE_CURSOR_INVALID');
  }
  requireValue(pending.length>0,'RESUME_QUEUE_EMPTY');
  for(const path of known){
    const queued=pending.filter(task=>task.operation==='listDocuments' && collectionPath(task)===path).length;
    requireValue(queued+(state.completedCollections.includes(path)?1:0)===1,'RESUME_COLLECTION_COVERAGE_INVALID');
  }
  for(const path of paths){
    const queued=pending.filter(task=>task.operation==='listCollectionIds' && task.parentPath===path).length;
    requireValue(queued+(state.completedDiscoveryParents.includes(path)?1:0)===1,'RESUME_DISCOVERY_COVERAGE_INVALID');
  }
  requireValue(Array.isArray(state.pages) && state.pages.length>0 && state.pages.length<=config.limits.maxPages
    && integer(state.totalReservedReads) && integer(state.totalResponseBytes)
    && state.totalResponseBytes<=config.limits.maxBytes,'RESUME_PAGE_PROOFS_INVALID');
  const byTask=new Map();let reserved=0,bytes=0,documents=0,missing=0;
  for(const [index,page] of state.pages.entries()){
    const pageKeys=['attempt','operation','parentPath',...(page.operation==='listDocuments'?['collectionId']:[]),'readTime','requestSha256',
      'pageTokenSha256','maximumReads','status','responseSha256','responseBytes','returnedCount','nextPageTokenSha256',
      ...(page.operation==='listDocuments'?['existingCount','missingCount']:[])];
    requireValue(exactKeys(page,pageKeys) && page.attempt===index+1 && page.status==='COMPLETE' && page.readTime===config.readTime
      && hashValue(page.requestSha256) && hashValue(page.responseSha256) && integer(page.responseBytes,1)
      && integer(page.returnedCount) && integer(page.maximumReads,1)
      && [page.pageTokenSha256,page.nextPageTokenSha256].every(value=>value===null || hashValue(value)),'RESUME_PAGE_PROOFS_INVALID');
    const task={operation:page.operation,parentPath:page.parentPath,depth:page.parentPath? page.parentPath.split('/').length/2+(page.operation==='listDocuments'?1:0):1,
      ...(page.operation==='listDocuments'?{collectionId:page.collectionId}:{})};
    validTask(task,config,paths,known);
    if(page.operation==='listDocuments'){
      requireValue(page.maximumReads<=config.pageSize && page.returnedCount<=page.maximumReads && integer(page.existingCount)
        && integer(page.missingCount) && page.existingCount+page.missingCount===page.returnedCount,'RESUME_PAGE_PROOFS_INVALID');
      documents+=page.existingCount;missing+=page.missingCount;
    }else requireValue(page.maximumReads===1 && page.returnedCount<=config.collectionPageSize,'RESUME_PAGE_PROOFS_INVALID');
    const key=taskKey(task),previous=byTask.get(key);
    requireValue(previous ? previous.last.nextPageTokenSha256!==null && page.pageTokenSha256===previous.last.nextPageTokenSha256
      : page.pageTokenSha256===null,'RESUME_PAGE_CHAIN_INVALID');
    const tokenHashes=previous?.tokenHashes||[];
    if(page.nextPageTokenSha256!==null){
      requireValue(page.nextPageTokenSha256!==page.pageTokenSha256 && !tokenHashes.includes(page.nextPageTokenSha256),'RESUME_PAGE_CHAIN_INVALID');
      tokenHashes.push(page.nextPageTokenSha256);
    }
    byTask.set(key,{last:page,tokenHashes});reserved+=page.maximumReads;bytes+=page.responseBytes;
  }
  requireValue(reserved===state.totalReservedReads && bytes===state.totalResponseBytes && documents===state.documents.length
    && missing===state.missingDocumentPaths.length,'RESUME_PAGE_COUNTER_INVALID');
  for(const [key,value] of byTask){
    const page=value.last;
    if(page.nextPageTokenSha256!==null){
      requireValue(active && key===taskKey(active) && digest(state.active.pageToken)===page.nextPageTokenSha256
        && equal(state.active.consumedTokenHashes,value.tokenHashes),'RESUME_ACTIVE_CURSOR_INVALID');
    }else requireValue(page.operation==='listDocuments' ? state.completedCollections.includes(collectionPath(page))
      : state.completedDiscoveryParents.includes(page.parentPath),'RESUME_COMPLETED_TASKS_INVALID');
  }
  if(active)requireValue(byTask.has(taskKey(active)) && byTask.get(taskKey(active)).last.nextPageTokenSha256!==null,'RESUME_ACTIVE_CURSOR_INVALID');
  for(const task of state.queue)requireValue(!byTask.has(taskKey(task)),'RESUME_QUEUE_INVALID');
  requireValue(state.completedCollections.every(path=>[...byTask.values()].some(row=>row.last.operation==='listDocuments'
      && collectionPath(row.last)===path && row.last.nextPageTokenSha256===null))
    && state.completedDiscoveryParents.every(path=>byTask.get('listCollectionIds:'+path+':')?.last.nextPageTokenSha256===null),
  'RESUME_COMPLETED_TASKS_INVALID');
  requireValue(Array.isArray(state.batchHistory) && state.batchHistory.length===batch.number,'RESUME_BATCH_HISTORY_INVALID');
  let totalEntries=0,previousFinish=started;const reviews=new Set();
  for(const [index,row] of state.batchHistory.entries()){
    requireValue(exactKeys(row,['number','startedAt','finishedAt','documentEntries','reviewId','status']) && row.number===index+1
      && row.status==='PARTIAL_REVIEW' && row.documentEntries===config.maxBatchDocuments
      && timeMs(row.startedAt)>=previousFinish && timeMs(row.finishedAt)>=timeMs(row.startedAt)
      && timeMs(row.finishedAt)-timeMs(row.startedAt)<=config.limits.maxDurationMs
      && (index===0 ? row.reviewId===null : typeof row.reviewId==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.reviewId)
        && !reviews.has(row.reviewId)),'RESUME_BATCH_HISTORY_INVALID');
    if(row.reviewId!==null)reviews.add(row.reviewId);previousFinish=timeMs(row.finishedAt);totalEntries+=row.documentEntries;
  }
  const previousBatch=state.batchHistory.at(-1);
  requireValue(totalEntries===entriesCaptured(state) && batch.documentEntriesAtStart===totalEntries-config.maxBatchDocuments
    && previousBatch.startedAt===batch.startedAt && previousBatch.finishedAt===state.finishedAt && previousBatch.reviewId===batch.reviewId
    && !reviews.has(config.resumeReviewId),'RESUME_BATCH_HISTORY_INVALID');
  if(config.nowMs!==undefined){
    requireValue(integer(config.nowMs) && config.nowMs>=last,'CLOCK_MOVED_BACKWARDS');
    const current=BigInt(config.nowMs)*1000n;
    requireValue(config.readMicros<=current,'READ_TIME_IN_FUTURE');
    requireValue(current-config.readMicros<60n*60n*1000000n,'READ_TIME_EXPIRED');
  }
  return state;
}
/** Pure pre-credential continuation validation. Returned state is private.
 * nowMs is explicit; this function does not read a clock, files or adapters. */
export function validateFirestoreCaptureResume(options) {
  const config=configuration(options,false);
  requireValue(integer(config.nowMs),'RESUME_NOW_REQUIRED');
  return resumeState(config);
}

function makeRequest(config, task, pageToken, documentPageSize = config.pageSize) {
  const parent = `projects/${config.projectId}/databases/${config.databaseId}/documents${task.parentPath ? '/' + task.parentPath : ''}`;
  if (task.operation === 'listDocuments') return {operation: task.operation, method: 'GET', parent, collectionId: task.collectionId, query: {pageSize: documentPageSize, showMissing: true, readTime: config.readTime, ...(pageToken ? {pageToken} : {})}};
  return {operation: task.operation, method: 'POST', parent, body: {pageSize: config.collectionPageSize, readTime: config.readTime, ...(pageToken ? {pageToken} : {})}};
}
function decodeResponse(value, operation) {
  requireValue(object(value), 'INVALID_REST_RESPONSE');
  const listKey = operation === 'listDocuments' ? 'documents' : 'collectionIds';
  requireValue(Object.keys(value).every(key => [listKey, 'nextPageToken'].includes(key)) && (!own(value, listKey) || Array.isArray(value[listKey])) && (!own(value, 'nextPageToken') || typeof value.nextPageToken === 'string'), 'INVALID_REST_RESPONSE');
  return {items: value[listKey] || [], nextPageToken: value.nextPageToken || ''};
}
function decodeDocument(document, config, task) {
  requireValue(object(document) && Object.keys(document).every(key => ['name', 'fields', 'createTime', 'updateTime'].includes(key)) && typeof document.name === 'string', 'INVALID_REST_DOCUMENT');
  const resourcePrefix = `projects/${config.projectId}/databases/${config.databaseId}/documents/`;
  const collectionPath = task.parentPath ? `${task.parentPath}/${task.collectionId}` : task.collectionId;
  requireValue(document.name.startsWith(resourcePrefix + collectionPath + '/'), 'DOCUMENT_OUTSIDE_REQUESTED_COLLECTION');
  const path = document.name.slice(resourcePrefix.length), childId = path.slice(collectionPath.length + 1);
  requireValue(pathPart(childId), 'DOCUMENT_OUTSIDE_REQUESTED_COLLECTION');
  const missing = !own(document, 'fields') && !own(document, 'createTime') && !own(document, 'updateTime');
  if (missing) return {path, missing: true};
  requireValue(own(document, 'createTime') && own(document, 'updateTime') && (!own(document, 'fields') || object(document.fields)), 'INCOMPLETE_DOCUMENT_METADATA');
  const normalized = {path, fields: document.fields || {}, createTime: document.createTime, updateTime: document.updateTime};
  try { validateSplitSnapshot({schemaVersion: 1, projectId: config.projectId, databaseId: config.databaseId, readTime: config.readTime, coverage: {complete: true, consistent: true, rootCollections: config.rootCollections}, documents: [normalized]}); }
  catch { fail('INVALID_TYPED_DOCUMENT_OR_TIMES'); }
  return {path, missing: false, document: normalized};
}
async function boundedAdapter(invoke, timeoutMs, failureCode, timeoutCode) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CaptureFailure(timeoutCode)); }, timeoutMs); });
  try { return await Promise.race([Promise.resolve().then(() => invoke(controller.signal)), timeout]); }
  catch (error) { if (error instanceof CaptureFailure) throw error; fail(failureCode); }
  finally { clearTimeout(timer); }
}

/** Captures complete selected collection trees at one historical readTime.
 * transport(request, {signal}) returns decoded REST JSON. reserveReads receives
 * a maximum per attempt and must return true or {allowed:true}; reservations are
 * never refunded here. clock returns epoch milliseconds. checkpoint receives a
 * private cloned state; it must durably save it without printing its contents.
 * Invalid configuration rejects before any adapter is called. Operational errors
 * return INCOMPLETE with snapshot:null; partial state must not enter the planner.
 * No retries or resume are implicit: each failed capture keeps its own readTime.
 */
export async function captureFirestoreSnapshot(options) {
  const config = configuration(options);
  const previousState = config.resumeState === undefined ? null : resumeState(config);
  let lastClock = previousState ? timeMs(previousState.lastObservedAt) : null;
  const now = () => {
    let value;
    try { value = config.clock(); } catch { fail('CLOCK_FAILED'); }
    requireValue(Number.isSafeInteger(value) && value >= 0, 'INVALID_CLOCK');
    requireValue(lastClock === null || value >= lastClock, 'CLOCK_MOVED_BACKWARDS');
    lastClock = value;
    return value;
  };
  const started = now();
  const state = previousState || {schemaVersion: 1, mode: 'READ_ONLY_FIRESTORE_CAPTURE', projectId: config.projectId, databaseId: config.databaseId, readTime: config.readTime, rootCollections: config.rootCollections, scopeSha256: snapshotDigest({projectId: config.projectId, databaseId: config.databaseId, rootCollections: config.rootCollections}), startedAt: iso(started), status: 'IN_PROGRESS', queue: config.rootCollections.map(collectionId => ({operation: 'listDocuments', parentPath: '', collectionId, depth: 1})), active: null, documents: [], missingDocumentPaths: [], completedCollections: [], completedDiscoveryParents: [], pages: [], totalReservedReads: 0, totalResponseBytes: 0};
  if (config.batchEnabled) {
    if (!previousState) {
      state.captureConfigSha256=configPin(config);state.batchHistory=[];state.knownCollections=[...config.rootCollections];
    } else {delete state.finishedAt;state.status='IN_PROGRESS';}
    state.batch={number:previousState ? previousState.batch.number+1 : 1,maxDocuments:config.maxBatchDocuments,maxBatches:config.maxBatches,
      documentEntriesAtStart:entriesCaptured(state),startedAt:iso(started),reviewId:previousState ? config.resumeReviewId : null};
    state.lastObservedAt=iso(started);
  }
  const seenPaths = new Set([...state.documents.map(row=>row.path),...state.missingDocumentPaths]);
  const batchEntries = () => config.batchEnabled ? entriesCaptured(state)-state.batch.documentEntriesAtStart : 0;
  const batchReached = () => config.batchEnabled && batchEntries()>=config.maxBatchDocuments;
  function checkTime() {
    const current = now(), currentMicros = BigInt(current) * 1000n;
    if (config.batchEnabled) state.lastObservedAt=iso(current);
    requireValue(config.readMicros <= currentMicros, 'READ_TIME_IN_FUTURE');
    requireValue(currentMicros - config.readMicros < 60n * 60n * 1000000n, 'READ_TIME_EXPIRED');
    requireValue(current - started < config.limits.maxDurationMs, 'CAPTURE_TIME_LIMIT');
    return current;
  }
  function adapterTimeout() {
    const current = checkTime();
    const ageMs = Number((BigInt(current) * 1000n - config.readMicros) / 1000n);
    return Math.max(1, Math.min(config.limits.requestTimeoutMs, config.limits.maxDurationMs - (current - started), 60 * 60 * 1000 - ageMs));
  }
  async function persist() {
    requireValue(byteLength(state) <= config.limits.maxBytes, 'CHECKPOINT_BYTE_LIMIT');
    const saved = clone(state);
    await boundedAdapter(signal => config.checkpoint(saved, {signal}), adapterTimeout(), 'CHECKPOINT_FAILED', 'CHECKPOINT_TIMEOUT');
  }
  function receipt(complete) {
    const result = {schemaVersion: 1, mode: state.mode, projectId: state.projectId, databaseId: state.databaseId, readTime: state.readTime, scopeSha256: state.scopeSha256, rootCollections: state.rootCollections, complete, consistent: complete, startedAt: state.startedAt, finishedAt: state.finishedAt || null, limits: config.limits, requestParameters: {documentPageSize: config.pageSize, collectionPageSize: config.collectionPageSize, showMissing: true, mask: null, orderBy: null}, counts: {documents: state.documents.length, missingParents: state.missingDocumentPaths.length, collectionsCompleted: state.completedCollections.length, discoveryParentsCompleted: state.completedDiscoveryParents.length, attempts: state.pages.length, totalReservedReads: state.totalReservedReads, totalResponseBytes: state.totalResponseBytes}, completedCollections: state.completedCollections, completedDiscoveryParents: state.completedDiscoveryParents, missingDocumentPaths: state.missingDocumentPaths, pages: state.pages, errorCode: state.errorCode || null};
    if (config.batchEnabled) result.batch={number:state.batch.number,maxDocuments:config.maxBatchDocuments,maxBatches:config.maxBatches,
      documentEntriesAtStart:state.batch.documentEntriesAtStart,documentEntriesCaptured:batchEntries(),
      planExhausted:!complete && state.batch.number>=config.maxBatches,captureConfigSha256:state.captureConfigSha256};
    return {...clone(result), receiptSha256: snapshotDigest(result)};
  }
  async function finishBatch() {
    state.finishedAt=iso(checkTime());state.status='PARTIAL_REVIEW';
    state.batchHistory.push({number:state.batch.number,startedAt:state.batch.startedAt,finishedAt:state.finishedAt,
      documentEntries:batchEntries(),reviewId:state.batch.reviewId,status:'PARTIAL_REVIEW'});
    await persist();
    checkTime();
    return {status:'PARTIAL_REVIEW',snapshot:null,receipt:receipt(false),state:clone(state),checkpointSaved:true,
      requiresHumanReview:true,batchPlanExhausted:state.batch.number>=config.maxBatches};
  }
  try {
    checkTime();
    await persist();
    while (state.queue.length || state.active) {
      if(batchReached())return await finishBatch();
      const resumedActive=state.active;
      const task=resumedActive ? {operation:resumedActive.operation,parentPath:resumedActive.parentPath,depth:resumedActive.depth,
        ...(resumedActive.operation==='listDocuments'?{collectionId:resumedActive.collectionId}:{})} : state.queue.shift();
      requireValue(task.depth <= config.limits.maxDepth, 'CAPTURE_DEPTH_LIMIT');
      let pageToken=resumedActive?.pageToken || '';
      const tokens=new Set(resumedActive?.consumedTokenHashes || []);
      if(!resumedActive)state.active={...task,pageToken,consumedTokenHashes:[]};
      while (true) {
        checkTime();
        if(batchReached())return await finishBatch();
        requireValue(state.pages.length < config.limits.maxPages, 'CAPTURE_PAGE_LIMIT');
        const documentPageSize=config.batchEnabled ? Math.min(config.pageSize,config.maxBatchDocuments-batchEntries()) : config.pageSize;
        const request = makeRequest(config, task, pageToken,documentPageSize), maximumReads = task.operation === 'listDocuments' ? documentPageSize : 1;
        const proof = {attempt: state.pages.length + 1, operation: task.operation, parentPath: task.parentPath, ...(task.collectionId ? {collectionId: task.collectionId} : {}), readTime: config.readTime, requestSha256: snapshotDigest(request), pageTokenSha256: pageToken ? digest(pageToken) : null, maximumReads, status: 'RESERVATION_PENDING'};
        state.pages.push(proof);
        let reservation;
        try { reservation = await boundedAdapter(signal => config.reserveReads({projectId: config.projectId, databaseId: config.databaseId, readTime: config.readTime, operation: task.operation, attempt: proof.attempt, requestSha256: proof.requestSha256, maximumReads}, {signal}), adapterTimeout(), 'READ_RESERVATION_FAILED', 'READ_RESERVATION_TIMEOUT'); }
        catch (error) { proof.status = 'RESERVATION_FAILED'; throw error; }
        if (!(reservation === true || object(reservation) && reservation.allowed === true)) { proof.status = 'RESERVATION_DENIED'; fail('READ_RESERVATION_DENIED'); }
        state.totalReservedReads += maximumReads;
        proof.status = 'RESERVED';
        await persist();
        // Credential acquisition, network dispatch and budget checks remain in
        // injected adapters. A reservation must precede every transport attempt.
        const timeoutMs = adapterTimeout();
        proof.status = 'SENT';
        const response = await boundedAdapter(signal => config.transport(clone(request), {signal}), timeoutMs, 'TRANSPORT_FAILED', 'TRANSPORT_TIMEOUT');
        checkTime();
        let serialized;
        try { serialized = JSON.stringify(response); } catch { fail('INVALID_REST_RESPONSE'); }
        requireValue(typeof serialized === 'string', 'INVALID_REST_RESPONSE');
        const responseBytes=Buffer.byteLength(serialized,'utf8');
        state.totalResponseBytes += responseBytes;
        if(config.batchEnabled)proof.responseBytes=responseBytes;
        requireValue(state.totalResponseBytes <= config.limits.maxBytes, 'CAPTURE_BYTE_LIMIT');
        const stableResponse = JSON.parse(serialized), decoded = decodeResponse(stableResponse, task.operation);
        proof.responseSha256 = digest(serialized);
        proof.returnedCount = decoded.items.length;
        proof.nextPageTokenSha256 = decoded.nextPageToken ? digest(decoded.nextPageToken) : null;
        requireValue(decoded.items.length <= (task.operation === 'listDocuments' ? documentPageSize : config.collectionPageSize), 'PAGE_EXCEEDS_REQUEST_SIZE');
        if (decoded.nextPageToken) requireValue(decoded.nextPageToken !== pageToken && !tokens.has(digest(decoded.nextPageToken)), 'REPEATED_PAGE_TOKEN');
        if (task.operation === 'listDocuments') {
          const decodedDocuments = decoded.items.map(document => decodeDocument(document, config, task));
          const localPaths = new Set();
          for (const item of decodedDocuments) { requireValue(!seenPaths.has(item.path) && !localPaths.has(item.path), 'DUPLICATE_DOCUMENT_PATH'); localPaths.add(item.path); }
          const existingCount = decodedDocuments.filter(item => !item.missing).length;
          requireValue(state.documents.length + existingCount <= config.limits.maxDocuments, 'CAPTURE_DOCUMENT_LIMIT');
          proof.existingCount = existingCount;
          proof.missingCount = decodedDocuments.length - existingCount;
          for (const item of decodedDocuments) {
            seenPaths.add(item.path);
            if (item.missing) state.missingDocumentPaths.push(item.path); else state.documents.push(item.document);
            state.queue.push({operation: 'listCollectionIds', parentPath: item.path, depth: task.depth});
          }
        } else {
          const existingCollections = new Set(state.active.discoveredCollectionIds || []);
          for (const collectionId of decoded.items) {
            requireValue(pathPart(collectionId) && !existingCollections.has(collectionId), 'INVALID_OR_DUPLICATE_COLLECTION_ID');
            existingCollections.add(collectionId);
          }
          requireValue(decoded.items.length === 0 || task.depth < config.limits.maxDepth, 'CAPTURE_DEPTH_LIMIT');
          state.active.discoveredCollectionIds = [...existingCollections].sort();
          for (const collectionId of decoded.items) {
            state.queue.push({operation:'listDocuments',parentPath:task.parentPath,collectionId,depth:task.depth+1});
            if(config.batchEnabled)state.knownCollections.push(task.parentPath+'/'+collectionId);
          }
        }
        proof.status = 'COMPLETE';
        if (!decoded.nextPageToken) {
          if (task.operation === 'listDocuments') state.completedCollections.push(task.parentPath ? `${task.parentPath}/${task.collectionId}` : task.collectionId);
          else state.completedDiscoveryParents.push(task.parentPath);
          state.active = null;
          await persist();
          break;
        }
        tokens.add(digest(decoded.nextPageToken));
        pageToken = decoded.nextPageToken;
        state.active.pageToken = pageToken;
        state.active.consumedTokenHashes = [...tokens];
        await persist();
      }
    }
    checkTime();
    state.documents.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    state.missingDocumentPaths.sort();
    state.completedCollections.sort();
    state.completedDiscoveryParents.sort();
    const snapshot = {schemaVersion: 1, projectId: config.projectId, databaseId: config.databaseId, readTime: config.readTime, coverage: {complete: true, consistent: true, rootCollections: config.rootCollections, scope: 'SELECTED_ROOT_COLLECTION_TREES', scopeSha256: state.scopeSha256}, documents: clone(state.documents)};
    try { validateSplitSnapshot(snapshot); } catch { fail('FINAL_SNAPSHOT_VALIDATION_FAILED'); }
    state.snapshotSha256 = snapshotDigest(snapshot);
    state.finishedAt = iso(checkTime());
    const captureReceipt = {...receipt(true), snapshotSha256: state.snapshotSha256};
    delete captureReceipt.receiptSha256;
    captureReceipt.receiptSha256 = snapshotDigest(captureReceipt);
    requireValue(byteLength({snapshot, receipt: captureReceipt}) <= config.limits.maxBytes, 'FINAL_PACKAGE_BYTE_LIMIT');
    // No checkpoint is labelled COMPLETE until the whole output package passes.
    state.status = 'COMPLETE';
    if(config.batchEnabled)state.batchHistory.push({number:state.batch.number,startedAt:state.batch.startedAt,finishedAt:state.finishedAt,
      documentEntries:batchEntries(),reviewId:state.batch.reviewId,status:'COMPLETE'});
    await persist();
    if(config.batchEnabled)checkTime();
    return {status: 'COMPLETE', snapshot, receipt: captureReceipt, state: clone(state)};
  } catch (error) {
    state.status = 'INCOMPLETE';
    state.errorCode = error instanceof CaptureFailure ? error.code : 'CAPTURE_FAILED';
    delete state.snapshotSha256;
    const activePage = state.pages.at(-1);
    if (activePage && ['RESERVED', 'SENT'].includes(activePage.status)) activePage.status = 'UNCERTAIN';
    try { state.finishedAt = iso(now()); } catch { state.finishedAt = null; }
    let checkpointSaved = false;
    try { await boundedAdapter(signal => config.checkpoint(clone(state), {signal}), config.limits.requestTimeoutMs, 'CHECKPOINT_FAILED', 'CHECKPOINT_TIMEOUT'); checkpointSaved = true; } catch { /* No further network call is permitted after persistence failure. */ }
    return {status: 'INCOMPLETE', snapshot: null, errorCode: state.errorCode, checkpointSaved, receipt: receipt(false), state: clone(state)};
  }
}
