import {createHash} from 'node:crypto';
import {snapshotDigest, validateSplitSnapshot} from './management-split-plan.js';
import {firestoreQuotaDayStart} from './management-read-budget.js';
import {validateManagementCaptureQuarterHead} from './management-capture-quarter-head.js';

const FA='sahmt-17a16', NS='FA-rec1', KIND='MANAGEMENT_FRESH_CONSISTENT_RECOVERY_CAPTURE';
const decisionAt='2026-10-09T15:12:31.000Z';
const message='VEJO QUE ESTÁ BEM TRANQUILO , VAMOS FINALIZAR TODAS A S LEITURAS PARA PASSARMOS PARA PROXIMA ETAPA. VAMOS!';
const evidenceId='USER_COMPLETE_REMAINING_CAPTURE_QUARTERS_2026_10_09T15_12_31Z';
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const equal=(a,b)=>snapshotDigest(a)===snapshotDigest(b);
function json(input) {
  const seen=new Set();let nodes=0;
  const visit=(v,depth=0)=>{
    demand(++nodes<=1500000&&depth<=100,'RECOVERY_DATA_INVALID');
    if(v===null||typeof v==='string'||typeof v==='boolean')return;
    if(typeof v==='number'){demand(Number.isFinite(v)&&!Object.is(v,-0),'RECOVERY_DATA_INVALID');return;}
    demand((Array.isArray(v)||plain(v))&&!seen.has(v),'RECOVERY_DATA_INVALID');seen.add(v);
    const keys=Reflect.ownKeys(v);
    if(Array.isArray(v))demand(keys.length===v.length+1&&keys.at(-1)==='length','RECOVERY_DATA_INVALID');
    for(const k of keys){
      if(Array.isArray(v)&&k==='length')continue;
      const d=Object.getOwnPropertyDescriptor(v,k);
      demand(typeof k==='string'&&d.enumerable&&Object.hasOwn(d,'value'),'RECOVERY_DATA_INVALID');
      visit(d.value,depth+1);
    }
    seen.delete(v);
  };
  visit(input);
  demand(Buffer.byteLength(JSON.stringify(input),'utf8')<=16*1024*1024,'RECOVERY_DATA_LIMIT');
  return JSON.parse(JSON.stringify(input));
}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const limits=()=>({maxPages:3000,maxDocuments:6000,maxDepth:30,maxBytes:12*1024*1024,maxDurationMs:240000,requestTimeoutMs:20000});
const authorityBody=()=>({schemaVersion:1,kind:'HUMAN_AUTHORIZED_FRESH_RECOVERY_CAPTURE',projectId:FA,
  authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',namespace:NS,sourceHumanDecisionAt:decisionAt,
  sourceMessage:{evidenceId,authority:'CURRENT_HUMAN_MESSAGE',text:message,
    textSha256:createHash('sha256').update(message,'utf8').digest('hex')}});
/** Literal evidence of the actual broad instruction. This is not a usage report
 * or a factory that grants permission. Callers must supply and pin this evidence. */
export const MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION=freeze(authorityBody());
function clock(nowMs){demand(integer(nowMs),'RECOVERY_CLOCK_INVALID');return nowMs;}
function authority(input,nowMs,quotaDayStart){
  const value=json(input);
  demand(equal(value,authorityBody()),'RECOVERY_SOURCE_AUTHORIZATION_INVALID');
  demand(Date.parse(decisionAt)<=nowMs&&Date.parse(decisionAt)>=Date.parse(quotaDayStart),
    'RECOVERY_SOURCE_AUTHORIZATION_STALE_OR_FUTURE');
  return value;
}
function scopeOf(input){
  const scope=json(input);
  demand(exact(scope,['schemaVersion','projectId','databaseId','scope','rootCollections'])&&scope.schemaVersion===1
    &&scope.projectId===FA&&scope.databaseId==='(default)'&&scope.scope==='SELECTED_COLLECTION_TREES_WITH_IDENTITY_DEPENDENCIES'
    &&Array.isArray(scope.rootCollections)
    &&scope.rootCollections.length===43&&new Set(scope.rootCollections).size===43
    &&scope.rootCollections.every(v=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(v)),
    'RECOVERY_SCOPE_INVALID');
  return scope;
}
const pinKeys=['headSha256','checkpointSha256','quarterPlanSha256','scopeSha256','policySha256',
  'originalReadTime','checkpointFinishedAt','reservedReads'];
function pinsOf(input){
  const pins=json(input);
  demand(exact(pins,pinKeys)&&pinKeys.slice(0,5).every(k=>sha(pins[k]))
    &&iso(pins.originalReadTime)&&iso(pins.checkpointFinishedAt)&&pins.reservedReads===1342
    &&Date.parse(pins.checkpointFinishedAt)>=Date.parse(pins.originalReadTime)+3600000,
    'RECOVERY_PREDECESSOR_PINS_INVALID');
  return pins;
}
function policyOf(input,pins,quotaDayStart){
  const policy=json(input);
  demand(snapshotDigest(policy)===pins.policySha256,'RECOVERY_PREDECESSOR_POLICY_CHANGED');
  demand(policy.schemaVersion===1&&policy.projectId===FA&&policy.dailyReadLimit===45000
    &&policy.limitApprovalEvidence==='USER_FA_DAILY_LIMIT_45000_2026_10_08'
    &&policy.quotaTimeZone==='America/Los_Angeles'&&policy.reservationQuotaDayStart===quotaDayStart
    &&policy.renewalClearsPause===false&&policy.pausedRequiresReview===true&&policy.pauseReason==='CHECKPOINT_TIMEOUT'
    &&policy.authorizedPurpose==='MANAGEMENT_BACKUP_ONLY'&&policy.humanDecisionAt===decisionAt
    &&policy.maximumCaptureReserve===6000&&policy.reservedReads===1342
    &&integer(policy.appTrafficReserve)&&policy.appTrafficReserve>=5000
    &&integer(policy.metricLagReserve)&&policy.metricLagReserve>=2000,
    'RECOVERY_PREDECESSOR_POLICY_INVALID');
  return policy;
}
const predecessorKeys=[...pinKeys,'sequenceId','batchNumber','status','errorCode','documents','completedCollections',
  'completedDiscoveryParents','pendingDiscoveryParents','attempts'];
const planKeys=['schemaVersion','kind','namespace','sourceProjectId','databaseId','createdAt','predecessor',
  'authority','quota','captureConfiguration','automaticRetry','implicitResume','oldArtifactsMutable',
  'oldDocumentsUsedInNewSnapshot','productionActivation','planSha256'];
function bodyOf(value){const {planSha256,...body}=value;return body;}
function envelope({plan,predecessorPolicy,authorizationEvidence,nowMs}){
  clock(nowMs);const value=json(plan);
  demand(exact(value,planKeys)&&value.schemaVersion===1&&value.kind===KIND&&value.namespace===NS
    &&value.sourceProjectId===FA&&value.databaseId==='(default)'&&iso(value.createdAt)
    &&Date.parse(value.createdAt)<=nowMs&&sha(value.planSha256)&&snapshotDigest(bodyOf(value))===value.planSha256
    &&value.automaticRetry===false&&value.implicitResume===false&&value.oldArtifactsMutable===false
    &&value.oldDocumentsUsedInNewSnapshot===false&&value.productionActivation===false,
    'RECOVERY_PLAN_INVALID_OR_CHANGED');
  const p=value.predecessor;
  demand(exact(p,predecessorKeys),'RECOVERY_PREDECESSOR_PINS_INVALID');
  const pins=pinsOf(Object.fromEntries(pinKeys.map(k=>[k,p[k]])));
  demand(typeof p.sequenceId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(p.sequenceId)
    &&p.batchNumber===4&&p.status==='INCOMPLETE'&&p.errorCode==='CHECKPOINT_TIMEOUT'
    &&p.documents===365&&p.completedCollections===43&&p.completedDiscoveryParents===151
    &&p.pendingDiscoveryParents===214&&p.attempts===206&&Date.parse(p.checkpointFinishedAt)<=Date.parse(value.createdAt),
    'RECOVERY_PREDECESSOR_FACTS_INVALID');
  const quotaDayStart=firestoreQuotaDayStart(nowMs);
  demand(firestoreQuotaDayStart(Date.parse(value.createdAt))===quotaDayStart
    &&exact(value.quota,['quotaDayStart','dailyReadLimit','appTrafficReserve','metricLagReserve',
      'predecessorReservedReads','newCaptureReservationLimit','cumulativeReadReservationLimit'])
    &&value.quota.quotaDayStart===quotaDayStart&&value.quota.dailyReadLimit===45000
    &&value.quota.appTrafficReserve===5000&&value.quota.metricLagReserve===2000
    &&value.quota.predecessorReservedReads===1342&&value.quota.newCaptureReservationLimit===3000
    &&value.quota.cumulativeReadReservationLimit===6000,'RECOVERY_QUOTA_PLAN_CHANGED_OR_STALE');
  policyOf(predecessorPolicy,pins,quotaDayStart);
  const auth=authority(authorizationEvidence,nowMs,quotaDayStart);
  demand(equal(value.authority,auth),'RECOVERY_SOURCE_AUTHORIZATION_INVALID');
  const c=value.captureConfiguration;
  demand(exact(c,['projectId','databaseId','rootCollections','pageSize','collectionPageSize','limits'])
    &&c.projectId===FA&&c.databaseId==='(default)'&&c.pageSize===25&&c.collectionPageSize===100
    &&equal(c.limits,limits()),'RECOVERY_CAPTURE_CONFIGURATION_CHANGED');
  const scope=scopeOf({schemaVersion:1,projectId:FA,databaseId:'(default)',scope:'SELECTED_COLLECTION_TREES_WITH_IDENTITY_DEPENDENCIES',rootCollections:c.rootCollections});
  demand(snapshotDigest(scope)===pins.scopeSha256,'RECOVERY_SCOPE_CHANGED');
  return value;
}
/** Pure budget-time gate. It does not read a metric, clear a pause or validate a
 * current migration context. The CLI also checks the actual predecessor files. */
export function validateManagementCaptureRecoveryPlanEnvelope(options={}){
  return freeze(envelope(options));
}
function auditPredecessor({predecessorHead,predecessorCheckpoint,predecessorPolicy,sourceScope,
  predecessorPins,authorizationEvidence,quotaDay,nowMs}){
  clock(nowMs);
  const scope=scopeOf(sourceScope),pins=pinsOf(predecessorPins),saved=json(predecessorCheckpoint);
  const quotaDayStart=firestoreQuotaDayStart(nowMs);
  demand(quotaDay===quotaDayStart,'RECOVERY_QUOTA_DAY_INVALID');
  const auth=authority(authorizationEvidence,nowMs,quotaDayStart);
  policyOf(predecessorPolicy,pins,quotaDayStart);
  demand(exact(saved,['schemaVersion','kind','projectId','quarterPlan','coreState'])&&saved.schemaVersion===1
    &&saved.kind==='FIRESTORE_QUARTER_CHECKPOINT'&&saved.projectId===FA,'RECOVERY_PREDECESSOR_CHECKPOINT_INVALID');
  const oldPlan=saved.quarterPlan;
  const head=validateManagementCaptureQuarterHead({head:json(predecessorHead),
    expectedHeadSha256:pins.headSha256,plan:oldPlan});
  const s=saved.coreState;
  demand(snapshotDigest(oldPlan)===snapshotDigest({...oldPlan,planSha256:pins.quarterPlanSha256})
    &&oldPlan.planSha256===pins.quarterPlanSha256&&oldPlan.scopeSha256===pins.scopeSha256
    &&snapshotDigest(scope)===pins.scopeSha256&&head.scopeSha256===pins.scopeSha256,
    'RECOVERY_PREDECESSOR_SCOPE_OR_PLAN_CHANGED');
  demand(snapshotDigest(s)===pins.checkpointSha256&&head.checkpointSha256===pins.checkpointSha256
    &&head.status==='INCOMPLETE'&&head.batchNumber===4&&head.checkpointFinishedAt===pins.checkpointFinishedAt
    &&head.readTime===pins.originalReadTime&&head.counters.reservedReads===1342,
    'RECOVERY_PREDECESSOR_HEAD_OR_CHECKPOINT_CHANGED');
  demand(s.schemaVersion===1&&s.mode==='READ_ONLY_FIRESTORE_CAPTURE'&&s.projectId===FA&&s.databaseId==='(default)'
    &&s.status==='INCOMPLETE'&&s.errorCode==='CHECKPOINT_TIMEOUT'&&s.readTime===pins.originalReadTime
    &&s.finishedAt===pins.checkpointFinishedAt&&Date.parse(s.finishedAt)<=nowMs
    &&iso(s.startedAt)&&iso(s.lastObservedAt)&&Date.parse(s.startedAt)>=Date.parse(s.readTime)
    &&Date.parse(s.lastObservedAt)>=Date.parse(s.startedAt)&&Date.parse(s.finishedAt)>=Date.parse(s.lastObservedAt)
    &&s.captureConfigSha256===head.captureConfigSha256
    &&equal(s.rootCollections,[...scope.rootCollections].sort())
    &&s.scopeSha256===snapshotDigest({projectId:FA,databaseId:'(default)',rootCollections:s.rootCollections})
    &&s.batch?.number===4&&s.batch.maxDocuments===92&&s.batch.maxBatches===4&&s.batch.documentEntriesAtStart===276
    &&Array.isArray(s.batchHistory)&&s.batchHistory.length===3,
    'RECOVERY_PREDECESSOR_STATE_INVALID');
  let previousFinish=Date.parse(s.startedAt);
  for(const [index,row]of s.batchHistory.entries()){
    demand(exact(row,['number','startedAt','finishedAt','documentEntries','reviewId','status'])
      &&row.number===index+1&&row.documentEntries===92&&row.status==='PARTIAL_REVIEW'
      &&iso(row.startedAt)&&iso(row.finishedAt)&&Date.parse(row.startedAt)>=previousFinish
      &&Date.parse(row.finishedAt)>=Date.parse(row.startedAt)&&Date.parse(row.finishedAt)-Date.parse(row.startedAt)<=180000
      &&row.reviewId===head.runHistory[index].reviewId,'RECOVERY_PREDECESSOR_STATE_INVALID');
    previousFinish=Date.parse(row.finishedAt);
  }
  demand(iso(s.batch.startedAt)&&Date.parse(s.batch.startedAt)>=previousFinish
    &&s.batch.reviewId===head.runHistory[3].reviewId&&s.batch.startedAt<=s.finishedAt,
    'RECOVERY_PREDECESSOR_STATE_INVALID');
  demand(Array.isArray(s.documents)&&s.documents.length===365&&Array.isArray(s.missingDocumentPaths)
    &&s.missingDocumentPaths.length===0&&Array.isArray(s.completedCollections)&&s.completedCollections.length===43
    &&equal([...s.completedCollections].sort(),[...scope.rootCollections].sort())
    &&Array.isArray(s.knownCollections)&&equal([...s.knownCollections].sort(),[...scope.rootCollections].sort())
    &&Array.isArray(s.completedDiscoveryParents)&&s.completedDiscoveryParents.length===151
    &&new Set(s.completedDiscoveryParents).size===151&&s.active===null&&Array.isArray(s.queue)&&s.queue.length===214,
    'RECOVERY_PREDECESSOR_COVERAGE_INVALID');
  // This checks typed private rows only, never labels the incomplete input a complete capture.
  validateSplitSnapshot({schemaVersion:1,projectId:FA,databaseId:'(default)',readTime:s.readTime,
    coverage:{complete:true,consistent:true,rootCollections:s.rootCollections},documents:s.documents});
  const paths=new Set(s.documents.map(d=>d.path)),done=new Set(s.completedDiscoveryParents),pending=new Set();
  demand([...paths].every(p=>p.split('/').length===2)&&[...done].every(p=>paths.has(p)),
    'RECOVERY_PREDECESSOR_COVERAGE_INVALID');
  for(const task of s.queue){
    demand(exact(task,['operation','parentPath','depth'])&&task.operation==='listCollectionIds'
      &&task.depth===1&&paths.has(task.parentPath)&&!done.has(task.parentPath)&&!pending.has(task.parentPath),
      'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS');pending.add(task.parentPath);
  }
  demand([...paths].every(p=>done.has(p)||pending.has(p)),'RECOVERY_PREDECESSOR_COVERAGE_INVALID');
  demand(Array.isArray(s.pages)&&s.pages.length===206,'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS');
  const chains=new Map(),tokens=new Map();let reserved=0,bytes=0,docs=0,discoveryCount=0;
  for(const [i,p]of s.pages.entries()){
    const doc=p.operation==='listDocuments';
    const keys=['attempt','operation','parentPath',...(doc?['collectionId']:[]),'readTime','requestSha256',
      'pageTokenSha256','maximumReads','status','responseSha256','responseBytes','returnedCount','nextPageTokenSha256',
      ...(doc?['existingCount','missingCount']:[])];
    demand(exact(p,keys)&&p.attempt===i+1&&p.status==='COMPLETE'&&p.readTime===s.readTime
      &&sha(p.requestSha256)&&sha(p.responseSha256)&&integer(p.responseBytes)&&p.responseBytes>0
      &&integer(p.maximumReads)&&p.maximumReads>0&&integer(p.returnedCount)
      &&[p.pageTokenSha256,p.nextPageTokenSha256].every(v=>v===null||sha(v)),
      'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS');
    const key=doc?'D:'+p.collectionId:'I:'+p.parentPath,previous=chains.get(key);
    demand(previous?previous.nextPageTokenSha256!==null&&p.pageTokenSha256===previous.nextPageTokenSha256
      :p.pageTokenSha256===null,'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS');
    const seenTokens=tokens.get(key)||new Set();
    demand(p.nextPageTokenSha256===null||p.nextPageTokenSha256!==p.pageTokenSha256
      &&!seenTokens.has(p.nextPageTokenSha256),'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS');
    if(p.nextPageTokenSha256!==null)seenTokens.add(p.nextPageTokenSha256);tokens.set(key,seenTokens);
    if(doc){
      demand(p.parentPath===''&&scope.rootCollections.includes(p.collectionId)&&p.maximumReads<=25
        &&p.returnedCount<=p.maximumReads&&integer(p.existingCount)&&p.existingCount===p.returnedCount
        &&p.missingCount===0,'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS');docs+=p.existingCount;
    }else{
      demand(p.operation==='listCollectionIds'&&done.has(p.parentPath)&&p.maximumReads===1&&p.returnedCount===0
        &&p.nextPageTokenSha256===null,'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS');discoveryCount++;
    }
    chains.set(key,p);reserved+=p.maximumReads;bytes+=p.responseBytes;
  }
  demand(reserved===1342&&reserved===s.totalReservedReads&&bytes===s.totalResponseBytes&&docs===365&&discoveryCount===151
    &&chains.size===43+151&&[...chains.values()].every(p=>p.nextPageTokenSha256===null)
    &&equal(head.counters,{documents:365,missingParents:0,attempts:206,reservedReads:1342,responseBytes:bytes}),
    'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS');
  const predecessor={...pins,sequenceId:head.sequenceId,batchNumber:4,status:'INCOMPLETE',errorCode:'CHECKPOINT_TIMEOUT',
    documents:365,completedCollections:43,completedDiscoveryParents:151,pendingDiscoveryParents:214,attempts:206};
  return {scope,predecessor,auth,quotaDayStart};
}
/** A separate plan for the broad, already approved completion request. No old
 * checkpoint is resumed; no old readTime, source document or budget is reset. */
export function prepareManagementCaptureRecoveryPlan(options={}){
  const {scope,predecessor,auth,quotaDayStart}=auditPredecessor(options);
  const body={schemaVersion:1,kind:KIND,namespace:NS,sourceProjectId:FA,databaseId:'(default)',
    createdAt:new Date(options.nowMs).toISOString(),predecessor,authority:auth,
    quota:{quotaDayStart,dailyReadLimit:45000,appTrafficReserve:5000,metricLagReserve:2000,
      predecessorReservedReads:1342,newCaptureReservationLimit:3000,cumulativeReadReservationLimit:6000},
    captureConfiguration:{projectId:FA,databaseId:'(default)',rootCollections:scope.rootCollections,
      pageSize:25,collectionPageSize:100,limits:limits()},
    automaticRetry:false,implicitResume:false,oldArtifactsMutable:false,oldDocumentsUsedInNewSnapshot:false,
    productionActivation:false};
  return freeze({...body,planSha256:snapshotDigest(body)});
}
export function validateManagementCaptureRecoveryPlan({plan,...options}={}){
  const value=envelope({plan,...options}),audited=auditPredecessor(options);
  demand(equal(value.predecessor,audited.predecessor)&&equal(value.authority,audited.auth)
    &&equal(value.captureConfiguration.rootCollections,audited.scope.rootCollections),'RECOVERY_PLAN_PREDECESSOR_CHANGED');
  return freeze(value);
}
function planForBinding(input,nowMs){
  const value=json(input);clock(nowMs);
  demand(exact(value,planKeys)&&value.schemaVersion===1&&value.kind===KIND&&value.namespace===NS
    &&value.sourceProjectId===FA&&value.databaseId==='(default)'&&iso(value.createdAt)&&Date.parse(value.createdAt)<=nowMs
    &&sha(value.planSha256)&&snapshotDigest(bodyOf(value))===value.planSha256
    &&value.automaticRetry===false&&value.implicitResume===false&&value.oldArtifactsMutable===false
    &&value.oldDocumentsUsedInNewSnapshot===false&&value.productionActivation===false,
    'RECOVERY_PLAN_INVALID_OR_CHANGED');
  const p=value.predecessor;
  demand(exact(p,predecessorKeys),'RECOVERY_PREDECESSOR_PINS_INVALID');
  pinsOf(Object.fromEntries(pinKeys.map(k=>[k,p[k]])));
  demand(p.status==='INCOMPLETE'&&p.errorCode==='CHECKPOINT_TIMEOUT'&&p.batchNumber===4
    &&p.documents===365&&p.completedCollections===43&&p.completedDiscoveryParents===151
    &&p.pendingDiscoveryParents===214&&p.attempts===206&&typeof p.sequenceId==='string'
    &&/^[A-Za-z0-9_-]{1,128}$/.test(p.sequenceId)&&Date.parse(p.checkpointFinishedAt)<=Date.parse(value.createdAt),
    'RECOVERY_PREDECESSOR_FACTS_INVALID');
  const quotaDay=firestoreQuotaDayStart(nowMs);
  demand(exact(value.quota,['quotaDayStart','dailyReadLimit','appTrafficReserve','metricLagReserve',
      'predecessorReservedReads','newCaptureReservationLimit','cumulativeReadReservationLimit'])
    &&value.quota.quotaDayStart===quotaDay&&firestoreQuotaDayStart(Date.parse(value.createdAt))===quotaDay
    &&value.quota.dailyReadLimit===45000&&value.quota.appTrafficReserve===5000&&value.quota.metricLagReserve===2000
    &&value.quota.predecessorReservedReads===1342&&value.quota.newCaptureReservationLimit===3000
    &&value.quota.cumulativeReadReservationLimit===6000,'RECOVERY_QUOTA_PLAN_CHANGED_OR_STALE');
  authority(value.authority,nowMs,quotaDay);
  const c=value.captureConfiguration;
  demand(exact(c,['projectId','databaseId','rootCollections','pageSize','collectionPageSize','limits'])
    &&c.projectId===FA&&c.databaseId==='(default)'&&c.pageSize===25&&c.collectionPageSize===100
    &&equal(c.limits,limits()),'RECOVERY_CAPTURE_CONFIGURATION_CHANGED');
  const scope=scopeOf({schemaVersion:1,projectId:FA,databaseId:'(default)',scope:'SELECTED_COLLECTION_TREES_WITH_IDENTITY_DEPENDENCIES',rootCollections:c.rootCollections});
  demand(snapshotDigest(scope)===p.scopeSha256,'RECOVERY_SCOPE_CHANGED');
  return value;
}
function bindingOf({plan,readTime,nowMs}){
  clock(nowMs);
  demand(iso(readTime)&&Date.parse(readTime)<=nowMs&&nowMs-Date.parse(readTime)<=5000
    &&Date.parse(readTime)>Date.parse(plan.predecessor.checkpointFinishedAt)&&nowMs>=Date.parse(plan.createdAt),
    'RECOVERY_READ_TIME_NOT_FRESH_OR_NEW');
  const body={schemaVersion:1,kind:'MANAGEMENT_RECOVERY_READ_TIME_BINDING',namespace:NS,planSha256:plan.planSha256,
    readTime,startedAt:new Date(nowMs).toISOString(),deadlineAt:new Date(nowMs+240000).toISOString(),
    coreConfiguration:{...json(plan.captureConfiguration),readTime}};
  return freeze({...body,bindingSha256:snapshotDigest(body)});
}
/** The journal must CAS/persist this once before the first reservation/transport.
 * Calling this pure helper is not itself proof that the journal is single-use. */
export function bindManagementCaptureRecoveryReadTime({plan,readTime,nowMs}={}){
  const value=planForBinding(plan,nowMs);
  return bindingOf({plan:value,readTime,nowMs});
}
export function validateManagementCaptureRecoveryReadTimeBinding({plan,binding,nowMs,requireOpenDeadline=true}={}){
  clock(nowMs);demand(typeof requireOpenDeadline==='boolean','RECOVERY_DEADLINE_MODE_INVALID');
  const basis=planForBinding(plan,nowMs),value=json(binding);
  demand(exact(value,['schemaVersion','kind','namespace','planSha256','readTime','startedAt','deadlineAt','coreConfiguration','bindingSha256'])
    &&value.schemaVersion===1&&value.kind==='MANAGEMENT_RECOVERY_READ_TIME_BINDING'&&value.namespace===NS
    &&value.planSha256===plan?.planSha256&&iso(value.startedAt)&&iso(value.deadlineAt)&&sha(value.bindingSha256),
    'RECOVERY_READ_TIME_BINDING_INVALID');
  const expected=bindingOf({plan:basis,readTime:value.readTime,nowMs:Date.parse(value.startedAt)});
  demand(equal(value,expected)&&nowMs>=Date.parse(value.startedAt)
    &&firestoreQuotaDayStart(nowMs)===plan.quota.quotaDayStart,'RECOVERY_READ_TIME_BINDING_CHANGED');
  demand(!requireOpenDeadline||nowMs<Date.parse(value.deadlineAt),'RECOVERY_CAPTURE_DEADLINE_EXPIRED');
  return freeze(value);
}
