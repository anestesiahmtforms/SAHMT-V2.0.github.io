import {createHash} from 'node:crypto';
import {snapshotDigest} from './management-split-plan.js';
import {validateFirestoreCaptureResume} from './firestore-snapshot-capture.js';

const FA='sahmt-17a16', KIND='MANAGEMENT_QUARTER_CAPTURE_HEAD';
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const filename=value=>typeof value==='string'&&/^capture-FA-[0-9]{1,32}-latest\.dpapi\.json$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;
const exact=(value,keys)=>value&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const stable=value=>snapshotDigest(value);
function data(value,depth=0,budget={nodes:0},seen=new Set()) {
  demand(++budget.nodes<=1500000&&depth<=100,'QUARTER_HEAD_DATA_INVALID');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){demand(Number.isFinite(value),'QUARTER_HEAD_DATA_INVALID');return;}
  demand(typeof value==='object'&&!seen.has(value),'QUARTER_HEAD_DATA_INVALID');
  seen.add(value);
  const array=Array.isArray(value), proto=Object.getPrototypeOf(value);
  demand(array?proto===Array.prototype:proto===Object.prototype||proto===null,'QUARTER_HEAD_DATA_INVALID');
  const keys=Reflect.ownKeys(value);
  if(array)demand(keys.length===value.length+1&&keys.at(-1)==='length','QUARTER_HEAD_DATA_INVALID');
  for(const key of keys) {
    if(array&&key==='length')continue;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    demand(typeof key==='string'&&descriptor.enumerable&&Object.hasOwn(descriptor,'value'),'QUARTER_HEAD_DATA_INVALID');
    data(descriptor.value,depth+1,budget,seen);
  }
  seen.delete(value);
}
function clone(value){data(value);return JSON.parse(JSON.stringify(value));}
function planOf(input) {
  const plan=clone(input);
  demand(plan.schemaVersion===1&&plan.kind==='MANAGEMENT_FOUR_MANUAL_CAPTURE_BATCHES'
    &&plan.sourceProjectId===FA&&plan.databaseId==='(default)'&&hash(plan.planSha256)
    &&hash(plan.scopeSha256)&&hash(plan.baselineSnapshotSha256)
    &&integer(plan.baselineDocumentCount)&&plan.baselineDocumentCount>0&&plan.baselineDocumentCount<=6000
    &&plan.maxBatchDocuments===Math.ceil(plan.baselineDocumentCount/4)&&plan.maxBatches===4
    &&plan.documentPageSize===Math.min(25,plan.maxBatchDocuments)
    &&plan.maxReservedReadsPerBatch===1500&&plan.maxDurationMs===180000&&plan.readTimeMaxAgeMs===3600000
    &&plan.automaticNextBatch===false&&plan.partialSnapshotEligibleForMigration===false
    &&plan.currentDocumentCountKnown===false&&plan.fourBatchesGuaranteeCompleteCapture===false
    &&plan.firestoreReadsIssued===0&&plan.firestoreWritesIssued===0,'QUARTER_HEAD_PLAN_INVALID');
  const {planSha256,...body}=plan;
  demand(stable(body)===planSha256,'QUARTER_HEAD_PLAN_INVALID');
  return plan;
}
const countsOf=state=>({documents:state.documents.length,missingParents:state.missingDocumentPaths.length,
  attempts:state.pages.length,reservedReads:state.totalReservedReads,responseBytes:state.totalResponseBytes});
const countKeys=['documents','missingParents','attempts','reservedReads','responseBytes'];
const headKeys=['schemaVersion','kind','projectId','databaseId','planSha256','scopeSha256','baselineSnapshotSha256',
  'sequenceId','revision','previousHeadSha256','createdAt','updatedAt','readTime','captureConfigSha256',
  'status','batchNumber','activeRunId','activeCheckpointFile','checkpointSha256','checkpointFinishedAt',
  'checkpointObservedAt','checkpointContentSha256','counters','runHistory','headSha256'];
function seal(body){return {...body,headSha256:stable(body)};}
function demandNow(nowMs) {demand(integer(nowMs),'QUARTER_HEAD_CLOCK_INVALID');return nowMs;}
function freshReadTime(readTime,nowMs) {
  demand(iso(readTime)&&Date.parse(readTime)<=nowMs&&nowMs-Date.parse(readTime)<3600000,
    'QUARTER_HEAD_READ_TIME_EXPIRED_OR_INVALID');
}
export function validateManagementCaptureQuarterHead({head,expectedHeadSha256,plan}={}) {
  const value=clone(head), basis=planOf(plan);
  demand(hash(expectedHeadSha256)&&value?.headSha256===expectedHeadSha256,'QUARTER_HEAD_CAS_MISMATCH');
  demand(exact(value,headKeys)&&value.schemaVersion===1&&value.kind===KIND&&value.projectId===FA
    &&value.databaseId==='(default)'&&value.planSha256===basis.planSha256&&value.scopeSha256===basis.scopeSha256
    &&value.baselineSnapshotSha256===basis.baselineSnapshotSha256,'QUARTER_HEAD_PLAN_MISMATCH');
  const {headSha256,...body}=value;
  demand(stable(body)===headSha256,'QUARTER_HEAD_HASH_MISMATCH');
  demand(id(value.sequenceId)&&id(value.activeRunId)&&filename(value.activeCheckpointFile)
    &&integer(value.revision)&&value.revision>=1&&(value.previousHeadSha256===null||hash(value.previousHeadSha256))
    &&iso(value.createdAt)&&iso(value.updatedAt)&&Date.parse(value.updatedAt)>=Date.parse(value.createdAt)
    &&iso(value.readTime)&&Date.parse(value.readTime)<=Date.parse(value.createdAt)
    &&(value.captureConfigSha256===null||hash(value.captureConfigSha256))
    &&['IN_PROGRESS','PARTIAL_REVIEW','COMPLETE','INCOMPLETE'].includes(value.status)
    &&integer(value.batchNumber)&&value.batchNumber>=1&&value.batchNumber<=basis.maxBatches,
    'QUARTER_HEAD_INVALID');
  demand(exact(value.counters,countKeys)&&countKeys.every(key=>integer(value.counters[key]))
    &&Array.isArray(value.runHistory)&&value.runHistory.length===value.batchNumber,'QUARTER_HEAD_INVALID');
  const runs=new Set(),files=new Set(),reviews=new Set();
  for(const [index,row]of value.runHistory.entries()) {
    const baseKeys=['runId','checkpointFile','batchNumber','reviewId','documentEntriesAtStart'];
    demand((exact(row,baseKeys)||exact(row,[...baseKeys,'remainingAuthorizationSha256'])
      &&[3,4].includes(row.batchNumber)&&hash(row.remainingAuthorizationSha256))&&id(row.runId)&&filename(row.checkpointFile)
      &&row.batchNumber===index+1&&integer(row.documentEntriesAtStart)
      &&(index===0?row.documentEntriesAtStart===0:row.documentEntriesAtStart>=value.runHistory[index-1].documentEntriesAtStart)
      &&row.documentEntriesAtStart<=value.counters.documents+value.counters.missingParents
      &&!runs.has(row.runId)&&!files.has(row.checkpointFile)
      &&(index===0?row.reviewId===null:id(row.reviewId)&&!reviews.has(row.reviewId)),'QUARTER_HEAD_HISTORY_INVALID');
    runs.add(row.runId);files.add(row.checkpointFile);if(row.reviewId!==null)reviews.add(row.reviewId);
  }
  const last=value.runHistory.at(-1);
  demand(last.runId===value.activeRunId&&last.checkpointFile===value.activeCheckpointFile,
    'QUARTER_HEAD_HISTORY_INVALID');
  demand((value.checkpointSha256===null&&value.checkpointContentSha256===null&&value.checkpointFinishedAt===null&&value.checkpointObservedAt===null
      &&value.status==='IN_PROGRESS')
    ||(hash(value.checkpointSha256)&&hash(value.checkpointContentSha256)&&iso(value.checkpointObservedAt)
      &&Date.parse(value.checkpointObservedAt)<=Date.parse(value.updatedAt)
      &&(value.status==='IN_PROGRESS'?value.checkpointFinishedAt===null
        :value.checkpointFinishedAt===null&&value.status==='INCOMPLETE'||iso(value.checkpointFinishedAt)
          &&Date.parse(value.checkpointFinishedAt)<=Date.parse(value.checkpointObservedAt))),
    'QUARTER_HEAD_CHECKPOINT_INVALID');
  return value;
}
function contentHash(state){const {lastObservedAt,...body}=state;return stable(body);}
function coreOf(coreState,plan) {
  const state=clone(coreState);
  demand(state?.schemaVersion===1&&state.mode==='READ_ONLY_FIRESTORE_CAPTURE'&&state.projectId===FA
    &&state.databaseId==='(default)'&&iso(state.readTime)&&iso(state.startedAt)
    &&iso(state.lastObservedAt)&&Date.parse(state.lastObservedAt)>=Date.parse(state.startedAt)
    &&hash(state.captureConfigSha256)&&hash(state.scopeSha256)
    &&Array.isArray(state.documents)&&Array.isArray(state.missingDocumentPaths)&&Array.isArray(state.pages)
    &&Array.isArray(state.rootCollections)&&state.rootCollections.length>0
    &&state.scopeSha256===stable({projectId:FA,databaseId:'(default)',rootCollections:state.rootCollections})
    &&integer(state.totalReservedReads)&&integer(state.totalResponseBytes)
    &&state.batch&&state.batch.maxDocuments===plan.maxBatchDocuments&&state.batch.maxBatches===plan.maxBatches
    &&integer(state.batch.number)&&state.batch.number>=1&&state.batch.number<=plan.maxBatches
    &&integer(state.batch.documentEntriesAtStart)&&iso(state.batch.startedAt)
    &&Array.isArray(state.batchHistory)
    &&['IN_PROGRESS','PARTIAL_REVIEW','COMPLETE','INCOMPLETE'].includes(state.status),'QUARTER_HEAD_CORE_INVALID');
  demand(state.documents.length+state.missingDocumentPaths.length>=state.batch.documentEntriesAtStart
    &&state.documents.length+state.missingDocumentPaths.length-state.batch.documentEntriesAtStart<=plan.maxBatchDocuments,
    'QUARTER_HEAD_BATCH_LIMIT');
  demand(state.status==='IN_PROGRESS'?state.finishedAt===undefined
    :state.finishedAt===null&&state.status==='INCOMPLETE'||iso(state.finishedAt)
      &&Date.parse(state.finishedAt)>=Date.parse(state.startedAt)
      &&(state.status==='INCOMPLETE'||Date.parse(state.finishedAt)<=Date.parse(state.lastObservedAt)),
    'QUARTER_HEAD_CORE_INVALID');
  return state;
}
const REMAINING_KIND='HUMAN_AUTHORIZED_REMAINING_QUARTERS';
const REMAINING_DECISION_AT='2026-10-09T15:12:31.000Z';
const REMAINING_MESSAGE='VEJO QUE ESTÁ BEM TRANQUILO , VAMOS FINALIZAR TODAS A S LEITURAS PARA PASSARMOS PARA PROXIMA ETAPA. VAMOS!';
const remainingEvidenceId='USER_COMPLETE_REMAINING_CAPTURE_QUARTERS_2026_10_09T15_12_31Z';
export function requiresManagementRemainingQuarterAuthorization({authorizationEvidence,humanDecisionAt}={}) {
  return Date.parse(humanDecisionAt)===Date.parse(REMAINING_DECISION_AT)
    ||authorizationEvidence?.kind===REMAINING_KIND
    ||authorizationEvidence&&typeof authorizationEvidence==='object'
      &&['sourceHumanDecisionAt','anchor','firstBatch','lastBatch'].some(key=>Object.hasOwn(authorizationEvidence,key));
}
/** Closed, one-sequence authorization. This only changes the per-lot review
 * ordering gate. It never supplies a budget observation or clears a pause. */
export function validateManagementRemainingQuarterAuthorization({authorizationEvidence,humanDecisionAt,
  head,plan,nowMs}={}) {
  const evidence=clone(authorizationEvidence),basis=planOf(plan);
  const current=validateManagementCaptureQuarterHead({head,expectedHeadSha256:head?.headSha256,plan:basis});
  demandNow(nowMs);
  demand(exact(evidence,['schemaVersion','kind','projectId','authorizedPurpose','dailyReadLimit',
    'sourceHumanDecisionAt','sourceMessage','anchor','firstBatch','lastBatch','maxBatchDocuments',
    'maxReservedReadsPerBatch','cumulativeReadReservationLimit','deadlineAt','automaticNextBatch'])
    &&evidence.schemaVersion===1&&evidence.kind===REMAINING_KIND&&evidence.projectId===FA
    &&evidence.authorizedPurpose==='MANAGEMENT_BACKUP_ONLY'&&evidence.dailyReadLimit===45000
    &&humanDecisionAt===REMAINING_DECISION_AT&&evidence.sourceHumanDecisionAt===humanDecisionAt
    &&evidence.firstBatch===3&&evidence.lastBatch===4&&evidence.maxBatchDocuments===92
    &&basis.maxBatchDocuments===92&&basis.maxBatches===4
    &&evidence.maxReservedReadsPerBatch===1500&&basis.maxReservedReadsPerBatch===1500
    &&evidence.cumulativeReadReservationLimit===6000&&evidence.automaticNextBatch===false,
    'QUARTER_REMAINING_AUTHORIZATION_INVALID');
  const source=evidence.sourceMessage,anchor=evidence.anchor;
  demand(exact(source,['evidenceId','authority','text','textSha256'])
    &&source.evidenceId===remainingEvidenceId&&source.authority==='CURRENT_HUMAN_MESSAGE'
    &&source.text===REMAINING_MESSAGE&&source.textSha256===createHash('sha256').update(source.text,'utf8').digest('hex'),
    'QUARTER_REMAINING_SOURCE_EVIDENCE_INVALID');
  demand(exact(anchor,['headSha256','checkpointSha256','checkpointFinishedAt','batchNumber','sequenceId',
    'runHistorySha256','planSha256','readTime'])&&hash(anchor.headSha256)&&hash(anchor.checkpointSha256)
    &&iso(anchor.checkpointFinishedAt)&&anchor.batchNumber===2&&id(anchor.sequenceId)
    &&hash(anchor.runHistorySha256)&&anchor.sequenceId===current.sequenceId
    &&anchor.planSha256===basis.planSha256&&anchor.readTime===current.readTime
    &&Date.parse(humanDecisionAt)>Date.parse(anchor.checkpointFinishedAt)
    &&current.runHistory.length>=2&&stable(current.runHistory.slice(0,2))===anchor.runHistorySha256,
    'QUARTER_REMAINING_ANCHOR_MISMATCH');
  demand(iso(evidence.deadlineAt)&&Date.parse(evidence.deadlineAt)<=Date.parse(current.readTime)+3600000
    &&Date.parse(evidence.deadlineAt)>Date.parse(humanDecisionAt)&&Date.parse(humanDecisionAt)<=nowMs
    &&nowMs<Date.parse(evidence.deadlineAt)&&nowMs>=Date.parse(current.updatedAt),
    'QUARTER_REMAINING_AUTHORIZATION_EXPIRED');
  freshReadTime(current.readTime,nowMs);
  demand(current.status==='PARTIAL_REVIEW'&&[2,3].includes(current.batchNumber)
    &&current.batchNumber+1>=evidence.firstBatch&&current.batchNumber+1<=evidence.lastBatch
    &&current.counters.reservedReads<=evidence.cumulativeReadReservationLimit,
    'QUARTER_REMAINING_BATCH_NOT_AUTHORIZED');
  const authorizationSha256=stable(evidence);
  if(current.batchNumber===2) {
    demand(current.headSha256===anchor.headSha256&&current.checkpointSha256===anchor.checkpointSha256
      &&current.checkpointFinishedAt===anchor.checkpointFinishedAt,'QUARTER_REMAINING_ANCHOR_MISMATCH');
  } else {
    demand(current.runHistory[2].remainingAuthorizationSha256===authorizationSha256,
      'QUARTER_REMAINING_GRANT_NOT_PINNED');
  }
  return {authorizationSha256,nextBatchNumber:current.batchNumber+1,sourceHumanDecisionAt:humanDecisionAt,
    deadlineAt:evidence.deadlineAt,cumulativeReadReservationLimit:evidence.cumulativeReadReservationLimit};
}

function reviewOf(review,head,nowMs,checkpointHash,plan) {
  const value=clone(review);
  demand(exact(value,['humanDecisionAt','authorizationEvidence'])&&iso(value.humanDecisionAt)
    &&Date.parse(value.humanDecisionAt)<=nowMs&&value.authorizationEvidence!==null
    &&(typeof value.authorizationEvidence==='string'?value.authorizationEvidence.length>0
      :typeof value.authorizationEvidence==='object'&&Object.keys(value.authorizationEvidence).length>0),
    'QUARTER_NEW_HUMAN_REVIEW_REQUIRED');
  let remainingAuthorizationSha256=null;
  if(requiresManagementRemainingQuarterAuthorization(value)) {
    remainingAuthorizationSha256=validateManagementRemainingQuarterAuthorization({authorizationEvidence:value.authorizationEvidence,
      humanDecisionAt:value.humanDecisionAt,head,plan,nowMs}).authorizationSha256;
  } else demand(Date.parse(value.humanDecisionAt)>Date.parse(head.checkpointFinishedAt),'QUARTER_NEW_HUMAN_REVIEW_REQUIRED');
  return {reviewId:'human-review-'+stable({...value,resumeStateSha256:checkpointHash}),remainingAuthorizationSha256};
}
// Keep the hash input exact: seal never incorporates the prior digest.
function next(head,updates,nowMs) {
  const {headSha256,...body}=head;
  return seal({...body,...updates,revision:head.revision+1,previousHeadSha256:headSha256,
    updatedAt:new Date(nowMs).toISOString()});
}

/** Pure lifecycle guard. Persist returned head under the capture lock before
 * credentials. No existing sequence is silently reset, including terminal ones. */
export function beginManagementCaptureQuarterHead({head=null,expectedHeadSha256=null,plan,runId,
  checkpointFile,readTime,nowMs,resumeCheckpoint=null,review=null,captureConfiguration=null}={}) {
  const basis=planOf(plan);demandNow(nowMs);freshReadTime(readTime,nowMs);
  demand(id(runId)&&filename(checkpointFile),'QUARTER_HEAD_RUN_INVALID');
  if(head===null) {
    demand(expectedHeadSha256===null&&resumeCheckpoint===null&&review===null,
      'QUARTER_HEAD_FIRST_SEQUENCE_INVALID');
    return seal({schemaVersion:1,kind:KIND,projectId:FA,databaseId:'(default)',planSha256:basis.planSha256,
      scopeSha256:basis.scopeSha256,baselineSnapshotSha256:basis.baselineSnapshotSha256,sequenceId:runId,
      revision:1,previousHeadSha256:null,createdAt:new Date(nowMs).toISOString(),updatedAt:new Date(nowMs).toISOString(),
      readTime,captureConfigSha256:null,status:'IN_PROGRESS',batchNumber:1,activeRunId:runId,
      activeCheckpointFile:checkpointFile,checkpointSha256:null,checkpointFinishedAt:null,checkpointObservedAt:null,checkpointContentSha256:null,
      counters:{documents:0,missingParents:0,attempts:0,reservedReads:0,responseBytes:0},
      runHistory:[{runId,checkpointFile,batchNumber:1,reviewId:null,documentEntriesAtStart:0}]});
  }
  const current=validateManagementCaptureQuarterHead({head,expectedHeadSha256,plan:basis});
  demand(nowMs>=Date.parse(current.updatedAt),'QUARTER_HEAD_CLOCK_MOVED_BACKWARDS');
  demand(resumeCheckpoint!==null,'QUARTER_SEQUENCE_ALREADY_EXISTS_REQUIRES_REVIEW');
  demand(current.status==='PARTIAL_REVIEW'&&current.batchNumber<basis.maxBatches,
    'QUARTER_HEAD_NOT_RESUMABLE_REQUIRES_REVIEW');
  const saved=clone(resumeCheckpoint);
  demand(exact(saved,['schemaVersion','kind','projectId','quarterPlan','coreState','checkpointFile'])
    &&saved.schemaVersion===1&&saved.kind==='FIRESTORE_QUARTER_CHECKPOINT'&&saved.projectId===FA
    &&stable(saved.quarterPlan)===stable(basis)&&saved.checkpointFile===current.activeCheckpointFile,
    'QUARTER_HEAD_CHECKPOINT_NOT_CURRENT');
  const state=coreOf(saved.coreState,basis), digest=stable(state);
  demand(digest===current.checkpointSha256&&state.readTime===current.readTime&&readTime===current.readTime
    &&state.captureConfigSha256===current.captureConfigSha256&&state.batch.number===current.batchNumber
    &&state.status===current.status&&state.finishedAt===current.checkpointFinishedAt
    &&stable(countsOf(state))===stable(current.counters),'QUARTER_HEAD_CHECKPOINT_NOT_CURRENT');
  demand(!current.runHistory.some(row=>row.runId===runId||row.checkpointFile===checkpointFile),
    'QUARTER_HEAD_RUN_ALREADY_USED');
  const {reviewId,remainingAuthorizationSha256}=reviewOf(review,current,nowMs,digest,basis);
  demand(!current.runHistory.some(row=>row.reviewId===reviewId),'QUARTER_HEAD_REVIEW_ALREADY_USED');
  demand(captureConfiguration&&typeof captureConfiguration==='object','QUARTER_HEAD_CAPTURE_CONFIGURATION_REQUIRED');
  validateFirestoreCaptureResume({...clone(captureConfiguration),projectId:FA,databaseId:'(default)',
    readTime:current.readTime,maxBatchDocuments:basis.maxBatchDocuments,maxBatches:basis.maxBatches,
    resumeState:state,resumeStateSha256:digest,resumeReviewId:reviewId,nowMs});
  return next(current,{status:'IN_PROGRESS',batchNumber:current.batchNumber+1,activeRunId:runId,
    activeCheckpointFile:checkpointFile,checkpointSha256:null,checkpointFinishedAt:null,checkpointObservedAt:null,checkpointContentSha256:null,
    runHistory:[...current.runHistory,{runId,checkpointFile,batchNumber:current.batchNumber+1,reviewId,
      documentEntriesAtStart:current.counters.documents+current.counters.missingParents,
      ...(remainingAuthorizationSha256?{remainingAuthorizationSha256}:{})}]},nowMs);
}

/** Pins the exact protected core after it is durably saved. Callers CAS and
 * persist this result before allowing the next transport operation. */
export function advanceManagementCaptureQuarterHead({head,expectedHeadSha256,plan,checkpointFile,
  coreState,nowMs}={}) {
  const basis=planOf(plan),current=validateManagementCaptureQuarterHead({head,expectedHeadSha256,plan:basis});
  demandNow(nowMs);demand(nowMs>=Date.parse(current.updatedAt),'QUARTER_HEAD_CLOCK_MOVED_BACKWARDS');
  const state=coreOf(coreState,basis),digest=stable(state),counts=countsOf(state);
  const observedAt=state.status==='INCOMPLETE'&&iso(state.finishedAt)
    &&Date.parse(state.finishedAt)>Date.parse(state.lastObservedAt)?state.finishedAt:state.lastObservedAt;
  demand(checkpointFile===current.activeCheckpointFile&&state.readTime===current.readTime
    &&state.batch.number===current.batchNumber&&Date.parse(state.startedAt)>=Date.parse(current.readTime)
    &&state.batch.reviewId===current.runHistory.at(-1).reviewId
    &&Date.parse(observedAt)<=nowMs
    &&(current.captureConfigSha256===null||state.captureConfigSha256===current.captureConfigSha256),
    'QUARTER_HEAD_CHECKPOINT_NOT_CURRENT');
  demand(state.batch.documentEntriesAtStart===current.runHistory.at(-1).documentEntriesAtStart,
    'QUARTER_HEAD_CORE_INVALID');
  demand(countKeys.every(key=>counts[key]>=current.counters[key])
    &&(current.checkpointObservedAt===null||Date.parse(observedAt)>=Date.parse(current.checkpointObservedAt)),
    'QUARTER_HEAD_CHECKPOINT_MOVED_BACKWARDS');
  if(current.checkpointSha256===digest)return current;
  demand(current.status==='IN_PROGRESS'||state.status==='INCOMPLETE'
    &&['PARTIAL_REVIEW','COMPLETE'].includes(current.status)
    ||state.status===current.status&&contentHash(state)===current.checkpointContentSha256,
    'QUARTER_HEAD_TERMINAL_CHECKPOINT_CHANGED');
  return next(current,{captureConfigSha256:state.captureConfigSha256,status:state.status,
    checkpointSha256:digest,checkpointFinishedAt:state.finishedAt??null,
    checkpointObservedAt:observedAt,checkpointContentSha256:contentHash(state),counters:counts},nowMs);
}

/** One-time local adoption of the first already-finished protected quarter.
 * The caller verifies ciphertext/DPAPI and independently enumerates all final
 * quarter checkpoint files. Exactly one first run must exist. No API or budget
 * unlock is implied, and no existing head can be replaced through adoption. */
export function adoptInitialManagementCaptureQuarterHead({head=null,plan,runId,checkpointFile,coreState,
  checkpointInventory,nowMs}={}) {
  demand(head===null,'QUARTER_SEQUENCE_ALREADY_EXISTS_REQUIRES_REVIEW');
  const basis=planOf(plan),state=coreOf(coreState,basis);demandNow(nowMs);
  demand(id(runId)&&filename(checkpointFile)&&state.batch.number===1&&state.batch.reviewId===null
    &&['PARTIAL_REVIEW','COMPLETE'].includes(state.status)&&state.batchHistory.length===1
    &&state.batchHistory[0].number===1&&state.batchHistory[0].status===state.status
    &&state.batchHistory[0].finishedAt===state.finishedAt
    &&Date.parse(state.lastObservedAt)<=nowMs,'QUARTER_HEAD_ADOPTION_INVALID');
  const inventory=clone(checkpointInventory),digest=stable(state);
  demand(Array.isArray(inventory)&&inventory.length===1&&exact(inventory[0],
    ['checkpointFile','coreStateSha256','planSha256','readTime','batchNumber'])
    &&inventory[0].checkpointFile===checkpointFile&&inventory[0].coreStateSha256===digest
    &&inventory[0].planSha256===basis.planSha256&&inventory[0].readTime===state.readTime
    &&inventory[0].batchNumber===1,'QUARTER_HEAD_ADOPTION_INVENTORY_AMBIGUOUS');
  const created=Date.parse(state.startedAt);
  const initial=beginManagementCaptureQuarterHead({plan:basis,runId,checkpointFile,readTime:state.readTime,nowMs:created});
  const advanced=advanceManagementCaptureQuarterHead({head:initial,expectedHeadSha256:initial.headSha256,
    plan:basis,checkpointFile,coreState:state,nowMs});
  const {headSha256,...body}=advanced;
  return seal({...body,revision:1,previousHeadSha256:null});
}
