import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {gatewayCanonicalJson} from './management-gateway-protocol.js';

// Server-only, disabled preparation. The caller never receives OAuth and this
// module discovers no credentials, endpoint, source writer or production host.
export const MANAGEMENT_BROKER_FIRESTORE_GATEWAY_PROTOCOL = 'SAHMT_BROKER_FIRESTORE_GATEWAY_V1';
export const MANAGEMENT_BROKER_FIRESTORE_GATEWAY_AUDIENCE = 'sahmt-private-broker-firestore-v1';
const FA='sahmt-17a16', FB='sahmt-gestao-5ae66', ZONE='America/Los_Angeles';
const projects=Object.freeze({readFaAuthorization:FA,readFbLease:FB,writeFbLease:FB,invalidateFbLease:FB});
const minima={readFaAuthorization:1,readFbLease:1,writeFbLease:2,invalidateFbLease:2};
const ops=Object.keys(projects), mutates=op=>['writeFbLease','invalidateFbLease'].includes(op);
const permissionKeys=['admin','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead',
  'managementIndicatorsWrite','managementPlansManage','documentsManage','equipmentManage','qualityManage','trainingsRead','trainingsManage','financeRead','financeWrite','financeManage','notificationsRead','notificationsManage'];
const leaseKeys=['schemaVersion','sourceProjectId','destinationProjectId','faUid','fbUid','memberId','leaseVersion','grantId',
  'sourceVersion','policyVersion','sourceHash','active','revoked','managementAllowed','role','permissions','memberAreaIds','managerAreaIds',
  'documentGroups','sourceAuthValidAfterTimeMs','confirmedAtMs','validUntilMs'];
const envelopeKeys=['schemaVersion','protocolVersion','audience','keyId','policyVersion','policySha256','direction',
  'sourceProjectId','destinationProjectId','operation','requestId','nonce','issuedAtMs','expiresAtMs','body','bodySha256','signature'];
const metaKeys=['schemaVersion','namespace','direction','requestHash','envelopeHash','requestId','nonce','operation','projectId','uid',
  'issuedAtMs','expiresAtMs','keyId','policyVersion','policySha256'];
const admissionKeys=['kind','allowed','currentProtectedStateVerified','durable','pausedRequiresReview','authorityRevision','reservationId',
  'reservationExpiresAtMs','maximumReads','quotaTimezone','quotaDay','dailyReadLimit','metricsComplete','measurementTimeMs','measurementEvidenceSha256',
  'totalReadCount','outstandingReservedReads','unreportedConsumedReads','applicationReserveReads','metricLagReserveReads'];
const denialCodes=['FIRESTORE_GATEWAY_DISABLED','FIRESTORE_GATEWAY_ADMISSION_DENIED','FIRESTORE_GATEWAY_REPLAY_DENIED',
  'FIRESTORE_GATEWAY_OPERATION_FAILED','FIRESTORE_GATEWAY_RESULT_INVALID'];
const plain=v=>v!==null && typeof v==='object' && Object.getPrototypeOf(v)===Object.prototype;
const integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&!Object.is(v,-0)&&v>=min&&v<=max;
const id=(v,max=128)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\s/\x00-\x1f]/.test(v)&&!['.','..'].includes(v);
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const freeze=v=>{if(v && typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const canonical=(v,maxBytes=65536)=>gatewayCanonicalJson(v,{maxBytes,maxNodes:4096,maxDepth:16});
const copy=(v,maxBytes=65536)=>JSON.parse(canonical(v,maxBytes));
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const quotaDay=time=>new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
class FirestoreGatewayError extends Error {
  constructor(code,requiresReconciliation=false){super(code);this.name='ManagementBrokerFirestoreGatewayError';this.code=code;this.requiresReconciliation=requiresReconciliation;}
}
const need=(value,code)=>{if(!value)throw new FirestoreGatewayError(code);};
const timestamp=v=>{
  need(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3}(?:\d{3})?(?:\d{3})?)?Z$/.test(v),'FIRESTORE_GATEWAY_REVISION_INVALID');
  const time=Date.parse(v);need(integer(time,1)&&new Date(time).toISOString().slice(0,19)===v.slice(0,19),'FIRESTORE_GATEWAY_REVISION_INVALID');return time;
};
function policyCopy(value){
  const p=copy(value);const keys=['schemaVersion','keyId','policyVersion','policySha256','maximumTtlMs','operationTimeoutMs','maxFutureSkewMs',
    'maxEnvelopeBytes','maxReservationRecords','maxMeasurementAgeMs','maxSnapshotAgeMs','leaseMaxDurationMs','dailyLimits','operationReadBounds','enabledOperations'];
  need(plain(p)&&keys.every(k=>Object.hasOwn(p,k))&&Object.keys(p).every(k=>keys.includes(k)||k==='limitApprovalEvidence'),'FIRESTORE_GATEWAY_POLICY_INVALID');
  need(p.schemaVersion===1&&id(p.keyId,100)&&id(p.policyVersion,100)&&hex(p.policySha256,64)
    &&integer(p.maximumTtlMs,1,120000)&&integer(p.operationTimeoutMs,1,120000)&&integer(p.maxFutureSkewMs,0,60000)
    &&integer(p.maxEnvelopeBytes,1024,65536)&&integer(p.maxReservationRecords,1,100000)
    &&integer(p.maxMeasurementAgeMs,1,300000)&&integer(p.maxSnapshotAgeMs,1,300000)&&integer(p.leaseMaxDurationMs,1,86400000)
    &&exact(p.dailyLimits,[FA,FB])&&[35000,45000].includes(p.dailyLimits[FA])&&p.dailyLimits[FB]===35000
    &&exact(p.operationReadBounds,ops)&&exact(p.enabledOperations,ops),'FIRESTORE_GATEWAY_POLICY_INVALID');
  if(p.dailyLimits[FA]===45000)need(p.limitApprovalEvidence==='USER_FA_DAILY_LIMIT_45000_2026_10_08','FIRESTORE_GATEWAY_FA_LIMIT_NOT_AUTHORIZED');
  for(const op of ops)need(integer(p.operationReadBounds[op],minima[op])&&p.operationReadBounds[op]+7000<p.dailyLimits[projects[op]]
    &&typeof p.enabledOperations[op]==='boolean','FIRESTORE_GATEWAY_POLICY_INVALID');
  return freeze(p);
}

const noticePermissionKeys=['notificationsRead','notificationsManage'];
const permissionShape=value=>plain(value)&&Object.keys(value).every(k=>permissionKeys.includes(k)&&typeof value[k]==='boolean')&&permissionKeys.every(k=>noticePermissionKeys.includes(k)?value[k]===undefined||typeof value[k]==='boolean':typeof value[k]==='boolean');
function validateLease(v,uid,p,live,time){
  need(exact(v,leaseKeys)&&v.schemaVersion===1&&v.sourceProjectId===FA&&v.destinationProjectId===FB&&v.faUid===uid&&v.fbUid===uid
    &&id(v.memberId,200)&&integer(v.leaseVersion,1)&&id(v.grantId,100)&&integer(v.sourceVersion,1)&&id(v.policyVersion,100)&&hex(v.sourceHash,64)
    &&['active','revoked','managementAllowed'].every(k=>typeof v[k]==='boolean')&&typeof v.role==='string'&&v.role.length<=100
    &&permissionShape(v.permissions)
    &&integer(v.sourceAuthValidAfterTimeMs)&&integer(v.confirmedAtMs,1)&&integer(v.validUntilMs,1)&&v.validUntilMs>=v.confirmedAtMs
    &&v.validUntilMs-v.confirmedAtMs<=p.leaseMaxDurationMs,'FIRESTORE_GATEWAY_LEASE_INVALID');
  for(const k of ['memberAreaIds','managerAreaIds'])need(Array.isArray(v[k])&&v[k].length<=1000&&v[k].every(x=>id(x,200))&&new Set(v[k]).size===v[k].length,'FIRESTORE_GATEWAY_LEASE_INVALID');
  need(Array.isArray(v.documentGroups)&&v.documentGroups.length<=2&&new Set(v.documentGroups).size===v.documentGroups.length
    &&v.documentGroups.every(x=>['GENERAL','RESTRICTED'].includes(x)),'FIRESTORE_GATEWAY_LEASE_INVALID');
  if(live)need(v.policyVersion===p.policyVersion&&v.active===true&&v.revoked===false&&v.managementAllowed===true
    &&v.confirmedAtMs<=time&&v.validUntilMs>time,'FIRESTORE_GATEWAY_LEASE_NOT_LIVE');
}
function validateBody(body,op,p,time){
  const keys=op==='writeFbLease'?['uid','projectId','expectedRevision','lease']:op==='invalidateFbLease'
    ?['uid','projectId','expectedGrantId','expectedLeaseVersion','reasonCode']:['uid','projectId'];
  need(exact(body,keys)&&id(body.uid)&&body.projectId===projects[op],'FIRESTORE_GATEWAY_BODY_INVALID');
  if(op==='writeFbLease'){if(body.expectedRevision!==null)timestamp(body.expectedRevision);validateLease(body.lease,body.uid,p,true,time);}
  if(op==='invalidateFbLease')need(id(body.expectedGrantId,100)&&integer(body.expectedLeaseVersion,1)
    &&typeof body.reasonCode==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(body.reasonCode),'FIRESTORE_GATEWAY_BODY_INVALID');
}
function validateResult(body,request,p,time){
  const op=request.operation,uid=request.body.uid;
  if(op==='readFaAuthorization'){
    need(exact(body,['schemaVersion','projectId','fromCache','hasPendingWrites','readTimeMs','consistentRead','coverageComplete','productionAuthorized',
      'authorizationVersion','sourceRevision','authUser','profile','binding','areas','documentAccess'])&&body.schemaVersion===1&&body.projectId===FA
      &&body.fromCache===false&&body.hasPendingWrites===false&&body.consistentRead===true&&body.coverageComplete===true&&body.productionAuthorized===true
      &&integer(body.authorizationVersion,1),'FIRESTORE_GATEWAY_SOURCE_INVALID');timestamp(body.sourceRevision);
    need(exact(body.authUser,['uid','disabled','emailVerified','googleUid','tokensValidAfterTimeMs'])&&body.authUser.uid===uid
      &&body.authUser.disabled===false&&body.authUser.emailVerified===true&&id(body.authUser.googleUid)&&integer(body.authUser.tokensValidAfterTimeMs),'FIRESTORE_GATEWAY_SOURCE_INVALID');
    const profile=body.profile;need(exact(profile,['uid','memberId','active','access','role','permissions'])&&profile.uid===uid&&id(profile.memberId,200)
      &&profile.active===true&&profile.access===true&&typeof profile.role==='string'&&profile.role.length<=100
      &&plain(profile.permissions)&&permissionKeys.every(k=>noticePermissionKeys.includes(k)?profile.permissions[k]===undefined||typeof profile.permissions[k]==='boolean':typeof profile.permissions[k]==='boolean')
      &&Object.keys(profile.permissions).every(k=>[...permissionKeys,'occurrencesRead','occurrencesAuditRead'].includes(k)
        &&typeof profile.permissions[k]==='boolean'),'FIRESTORE_GATEWAY_SOURCE_INVALID');
    if(body.binding!==null)need(exact(body.binding,['sourceProjectId','destinationProjectId','faUid','fbUid','memberId'])&&body.binding.sourceProjectId===FA
      &&body.binding.destinationProjectId===FB&&body.binding.faUid===uid&&body.binding.fbUid===uid&&body.binding.memberId===profile.memberId,'FIRESTORE_GATEWAY_SOURCE_INVALID');
    need(Array.isArray(body.areas)&&body.areas.length<=1000&&new Set(body.areas.map(x=>x.id)).size===body.areas.length,'FIRESTORE_GATEWAY_SOURCE_INVALID');
    for(const a of body.areas){need(exact(a,['id','active','version','memberUids','managerUids'])&&id(a.id,200)&&typeof a.active==='boolean'&&integer(a.version,1),'FIRESTORE_GATEWAY_SOURCE_INVALID');
      for(const k of ['memberUids','managerUids'])need(Array.isArray(a[k])&&a[k].length<=100&&a[k].every(x=>id(x))&&new Set(a[k]).size===a[k].length,'FIRESTORE_GATEWAY_SOURCE_INVALID');}
    const access=body.documentAccess;need(plain(access)&&Object.keys(access).every(k=>['active','groups','googleUid'].includes(k))
      &&['active','groups'].every(k=>Object.hasOwn(access,k))&&typeof access.active==='boolean'&&Array.isArray(access.groups)&&access.groups.length<=2
      &&new Set(access.groups).size===access.groups.length&&access.groups.every(x=>['GENERAL','RESTRICTED'].includes(x))
      &&(access.googleUid===undefined||id(access.googleUid))&&(!access.active||access.googleUid===body.authUser.googleUid),'FIRESTORE_GATEWAY_SOURCE_INVALID');
  }else if(op==='readFbLease'){
    need(exact(body,['schemaVersion','projectId','fromCache','hasPendingWrites','readTimeMs','exists','revision','lease'])&&body.schemaVersion===1
      &&body.projectId===FB&&body.fromCache===false&&body.hasPendingWrites===false&&typeof body.exists==='boolean','FIRESTORE_GATEWAY_RESULT_INVALID');
    if(body.exists){timestamp(body.revision);validateLease(body.lease,uid,p,false,time);}else need(body.revision===null&&body.lease===null,'FIRESTORE_GATEWAY_RESULT_INVALID');
  }else if(op==='writeFbLease'){
    need(plain(body)&&body.projectId===FB&&typeof body.applied==='boolean','FIRESTORE_GATEWAY_RESULT_INVALID');
    if(body.applied){need(exact(body,['applied','projectId','revision']),'FIRESTORE_GATEWAY_RESULT_INVALID');timestamp(body.revision);}
    else need(exact(body,['applied','projectId'])||exact(body,['applied','projectId','fenced'])&&body.fenced===true,'FIRESTORE_GATEWAY_RESULT_INVALID');
  }else need(exact(body,['applied','matched','fenced','projectId'])&&body.projectId===FB&&['applied','matched','fenced'].every(k=>typeof body[k]==='boolean')
    &&(!body.applied||body.matched&&body.fenced)&&(!body.matched||body.applied),'FIRESTORE_GATEWAY_RESULT_INVALID');
  if(op.startsWith('read'))need(integer(body.readTimeMs,1)&&body.readTimeMs<=time+p.maxFutureSkewMs&&time-body.readTimeMs<=p.maxSnapshotAgeMs,'FIRESTORE_GATEWAY_SNAPSHOT_STALE');
}
export function createManagementBrokerFirestoreGatewayProtocol({policy,secret,now=Date.now,monotonicNow=()=>performance.now()}={}){
  const p=policyCopy(policy);need((typeof secret==='string'||Buffer.isBuffer(secret))&&Buffer.byteLength(secret)>=32&&Buffer.byteLength(secret)<=1024,'FIRESTORE_GATEWAY_SECRET_REQUIRED');
  const key=Buffer.from(secret),active=new Set();let disposed=false,wallFloor=0,monoFloor=-Infinity;
  const time=()=>{need(!disposed,'FIRESTORE_GATEWAY_DISABLED');const wall=now(),mono=monotonicNow();
    need(integer(wall,1)&&Number.isFinite(mono)&&wall>=wallFloor&&mono>=monoFloor,'FIRESTORE_GATEWAY_CLOCK_INVALID');wallFloor=wall;monoFloor=mono;return {wall,mono};};
  const sign=v=>createHmac('sha256',key).update(MANAGEMENT_BROKER_FIRESTORE_GATEWAY_PROTOCOL+'\n'+v.direction+'\n'+canonical(v,p.maxEnvelopeBytes)).digest('hex');
  const enabled=op=>{need(ops.includes(op)&&p.enabledOperations[op]===true,'FIRESTORE_GATEWAY_DISABLED');};
  const validate=(input,direction,request)=>{
    const v=copy(input,p.maxEnvelopeBytes),t=time().wall;
    need(exact(v,direction==='REQUEST'?envelopeKeys:[...envelopeKeys,'requestHash','status','code','dispatched','requiresReconciliation'])
      &&v.schemaVersion===1&&v.protocolVersion===MANAGEMENT_BROKER_FIRESTORE_GATEWAY_PROTOCOL&&v.audience===MANAGEMENT_BROKER_FIRESTORE_GATEWAY_AUDIENCE
      &&v.keyId===p.keyId&&v.policyVersion===p.policyVersion&&v.policySha256===p.policySha256&&v.direction===direction
      &&v.sourceProjectId===FA&&v.destinationProjectId===FB&&ops.includes(v.operation)&&hex(v.requestId,32)&&hex(v.nonce,32)
      &&integer(v.issuedAtMs,1)&&integer(v.expiresAtMs,1)&&v.expiresAtMs>v.issuedAtMs&&v.expiresAtMs-v.issuedAtMs<=p.maximumTtlMs
      &&v.issuedAtMs<=t+p.maxFutureSkewMs&&v.expiresAtMs>t&&hex(v.bodySha256,64)&&v.bodySha256===digest(v.body)&&hex(v.signature,64),'FIRESTORE_GATEWAY_ENVELOPE_INVALID');
    const unsigned={...v};delete unsigned.signature;need(timingSafeEqual(Buffer.from(v.signature,'hex'),Buffer.from(sign(unsigned),'hex')),'FIRESTORE_GATEWAY_SIGNATURE_INVALID');
    if(direction==='REQUEST')validateBody(v.body,v.operation,p,t);
    else{
      need(request&&v.requestHash===digest(request)&&['operation','requestId','nonce','issuedAtMs','expiresAtMs'].every(k=>v[k]===request[k])
        &&typeof v.dispatched==='boolean'&&typeof v.requiresReconciliation==='boolean','FIRESTORE_GATEWAY_RESPONSE_BINDING_INVALID');
      if(v.status==='OK'){need(v.code==='OK'&&v.dispatched===true&&v.requiresReconciliation===false,'FIRESTORE_GATEWAY_RESULT_INVALID');validateResult(v.body,request,p,t);}
      else need(v.status==='DENIED'&&denialCodes.includes(v.code)&&v.body===null&&(!v.requiresReconciliation||v.dispatched&&mutates(v.operation)),'FIRESTORE_GATEWAY_RESULT_INVALID');
    }
    return freeze(v);
  };
  const createRequest=({operation,requestId,nonce,issuedAtMs,expiresAtMs,body})=>{
    const v={schemaVersion:1,protocolVersion:MANAGEMENT_BROKER_FIRESTORE_GATEWAY_PROTOCOL,audience:MANAGEMENT_BROKER_FIRESTORE_GATEWAY_AUDIENCE,
      keyId:p.keyId,policyVersion:p.policyVersion,policySha256:p.policySha256,direction:'REQUEST',sourceProjectId:FA,destinationProjectId:FB,
      operation,requestId,nonce,issuedAtMs,expiresAtMs,body:copy(body,p.maxEnvelopeBytes),bodySha256:digest(body)};v.signature=sign(v);return validate(v,'REQUEST');
  };
  const verifyRequest=input=>validate(input,'REQUEST');
  const createResponse=(requestInput,{status,code,body,dispatched,requiresReconciliation})=>{
    const request=verifyRequest(requestInput),v={...request,direction:'RESPONSE',requestHash:digest(request),status,code,
      body:copy(body,p.maxEnvelopeBytes),bodySha256:digest(body),dispatched,requiresReconciliation};delete v.signature;v.signature=sign(v);return validate(v,'RESPONSE',request);
  };
  const verifyResponse=(response,requestInput)=>validate(response,'RESPONSE',verifyRequest(requestInput));
  const metadata=(envelope,requestInput=envelope)=>{
    const request=verifyRequest(requestInput),v=envelope.direction==='REQUEST'?verifyRequest(envelope):verifyResponse(envelope,request);
    return freeze({schemaVersion:1,namespace:MANAGEMENT_BROKER_FIRESTORE_GATEWAY_PROTOCOL+':'+MANAGEMENT_BROKER_FIRESTORE_GATEWAY_AUDIENCE,
      direction:v.direction,requestHash:digest(request),envelopeHash:digest(v),requestId:v.requestId,nonce:v.nonce,operation:v.operation,
      projectId:projects[v.operation],uid:request.body.uid,issuedAtMs:v.issuedAtMs,expiresAtMs:v.expiresAtMs,keyId:p.keyId,policyVersion:p.policyVersion,policySha256:p.policySha256});
  };
  const validateClaim=(receipt,meta)=>{
    const v=copy(receipt,p.maxEnvelopeBytes);need(exact(v,[...metaKeys,'status','durable','atomic','retained'])&&metaKeys.every(k=>v[k]===meta[k])
      &&v.status==='CLAIMED'&&v.durable===true&&v.atomic===true&&v.retained===true,'FIRESTORE_GATEWAY_REPLAY_DENIED');return freeze(v);
  };
  const validateAdmission=(receipt,meta,current=time().wall)=>{
    const v=copy(receipt,p.maxEnvelopeBytes),bound=p.operationReadBounds[meta.operation];
    need(exact(meta,metaKeys)&&meta.namespace===MANAGEMENT_BROKER_FIRESTORE_GATEWAY_PROTOCOL+':'+MANAGEMENT_BROKER_FIRESTORE_GATEWAY_AUDIENCE
      &&meta.direction==='REQUEST'&&meta.projectId===projects[meta.operation]&&p.enabledOperations[meta.operation]===true
      &&meta.policyVersion===p.policyVersion&&meta.policySha256===p.policySha256&&meta.expiresAtMs>current,'FIRESTORE_GATEWAY_ADMISSION_DENIED');
    need(exact(v,[...metaKeys,...admissionKeys])&&metaKeys.every(k=>v[k]===meta[k])&&v.kind==='PROTECTED_CURRENT_BROKER_ADMISSION'
      &&v.allowed===true&&v.currentProtectedStateVerified===true&&v.durable===true&&v.pausedRequiresReview===false&&integer(v.authorityRevision,1)
      &&id(v.reservationId,200)&&integer(v.reservationExpiresAtMs,1)&&v.reservationExpiresAtMs>current&&v.reservationExpiresAtMs<=meta.expiresAtMs
      &&v.maximumReads===bound&&v.quotaTimezone===ZONE&&v.quotaDay===quotaDay(current)&&v.dailyReadLimit===p.dailyLimits[meta.projectId]
      &&v.metricsComplete===true&&integer(v.measurementTimeMs,1)&&v.measurementTimeMs<=current&&quotaDay(v.measurementTimeMs)===v.quotaDay
      &&current-v.measurementTimeMs<=p.maxMeasurementAgeMs&&hex(v.measurementEvidenceSha256,64)&&integer(v.totalReadCount)
      &&integer(v.outstandingReservedReads,bound)&&integer(v.unreportedConsumedReads)&&integer(v.applicationReserveReads,5000)&&integer(v.metricLagReserveReads,2000)
      &&integer(v.totalReadCount+v.outstandingReservedReads+v.unreportedConsumedReads+v.applicationReserveReads+v.metricLagReserveReads)
      &&v.totalReadCount+v.outstandingReservedReads+v.unreportedConsumedReads+v.applicationReserveReads+v.metricLagReserveReads<v.dailyReadLimit,'FIRESTORE_GATEWAY_ADMISSION_DENIED');
    return freeze(v);
  };
  const guardOperation=async(external={},work,{expiresAtMs}={})=>{
    need(plain(external)&&typeof work==='function','FIRESTORE_GATEWAY_CONTEXT_INVALID');
    const signal=external.signal;need(signal===undefined||signal&&typeof signal.aborted==='boolean'&&typeof signal.addEventListener==='function'&&typeof signal.removeEventListener==='function','FIRESTORE_GATEWAY_CONTEXT_INVALID');
    need(external.deadlineMs===undefined||integer(external.deadlineMs,1),'FIRESTORE_GATEWAY_CONTEXT_INVALID');
    const start=time();let deadline=Math.min(expiresAtMs??start.wall+p.maximumTtlMs,external.deadlineMs??Infinity,start.wall+p.operationTimeoutMs);
    let monoDeadline=start.mono+deadline-start.wall;const controller=new AbortController();let rejectCancel,closed=false,timer;
    const cancelled=new Promise((_,reject)=>{rejectCancel=reject;});cancelled.catch(()=>{});
    const cancel=code=>{if(!closed){controller.abort();rejectCancel(new FirestoreGatewayError(code));}};
    const assertLive=()=>{need(!disposed&&!controller.signal.aborted&&signal?.aborted!==true,'FIRESTORE_GATEWAY_ABORTED');const t=time();
      need(t.wall<deadline&&t.mono<monoDeadline,'FIRESTORE_GATEWAY_DEADLINE_EXCEEDED');return t.wall;};
    const ctx={assertLive,context:()=>Object.freeze({signal:controller.signal,deadlineMs:deadline}),
      limit:value=>{need(integer(value,1),'FIRESTORE_GATEWAY_CONTEXT_INVALID');const t=time();deadline=Math.min(deadline,value);monoDeadline=Math.min(monoDeadline,t.mono+deadline-t.wall);assertLive();clearTimeout(timer);timer=setTimeout(()=>cancel('FIRESTORE_GATEWAY_DEADLINE_EXCEEDED'),Math.max(1,deadline-t.wall));}};
    const onAbort=()=>cancel('FIRESTORE_GATEWAY_ABORTED');active.add(cancel);
    try{signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>cancel('FIRESTORE_GATEWAY_DEADLINE_EXCEEDED'),Math.max(1,deadline-start.wall));
      assertLive();const value=await Promise.race([Promise.resolve().then(()=>{assertLive();return work(ctx);}),cancelled]);assertLive();return value;
    }catch(error){if(error instanceof FirestoreGatewayError)throw error;throw new FirestoreGatewayError('FIRESTORE_GATEWAY_OPERATION_FAILED',error?.requiresReconciliation===true);
    }finally{closed=true;controller.abort();clearTimeout(timer);active.delete(cancel);try{signal?.removeEventListener('abort',onAbort);}catch{}}
  };
  return Object.freeze({createRequest,verifyRequest,createResponse,verifyResponse,metadata,validateAdmission,validateClaim,guardOperation,
    enabled,policy:p,now:()=>time().wall,dispose:()=>{disposed=true;key.fill(0);for(const cancel of active)cancel('FIRESTORE_GATEWAY_ABORTED');active.clear();}});
}
function admissionGuard(protocol,admitCurrentRequest){
  const used=new Set(),floors=new Map();
  return async(request,ctx)=>{
    need(typeof admitCurrentRequest==='function','FIRESTORE_GATEWAY_ADMISSION_DENIED');const meta=protocol.metadata(request);
    // The receipt comes only from this private callback reading current protected
    // state. No admission/budget/reservation fields are accepted on the wire.
    const received=await admitCurrentRequest(meta,ctx.context());const time=ctx.assertLive(),v=protocol.validateAdmission(received,meta,time);
    const key=meta.projectId+':'+v.reservationId,prior=floors.get(meta.projectId),sameDay=prior?.quotaDay===v.quotaDay;
    need(used.size<protocol.policy.maxReservationRecords&&!used.has(key),'FIRESTORE_GATEWAY_ADMISSION_DENIED');
    need((!prior||v.authorityRevision>=prior.revision)&&(!sameDay||v.totalReadCount>=prior.observed),'FIRESTORE_GATEWAY_ADMISSION_DENIED');
    const floor=Math.max(sameDay?prior.floor:0,v.totalReadCount)+v.maximumReads;
    need(v.totalReadCount+v.outstandingReservedReads+v.unreportedConsumedReads>=floor,'FIRESTORE_GATEWAY_ADMISSION_DENIED');
    used.add(key);floors.set(meta.projectId,{quotaDay:v.quotaDay,floor,observed:v.totalReadCount,revision:v.authorityRevision});
    ctx.limit(v.reservationExpiresAtMs);ctx.assertLive();
  };
}
export function createManagementBrokerFirestoreGatewayServer({enabled=false,protocol,claimRequest,admitCurrentRequest,adapters}={}){
  let disposed=false;const admit=admissionGuard(protocol,admitCurrentRequest);
  const receive=async(input,external={})=>{
    need(enabled===true&&!disposed,'FIRESTORE_GATEWAY_DISABLED');need(protocol&&typeof claimRequest==='function','FIRESTORE_GATEWAY_NOT_CONFIGURED');
    const request=protocol.verifyRequest(input);protocol.enabled(request.operation);const meta=protocol.metadata(request);
    const dispatch=adapters && Object.getOwnPropertyDescriptor(adapters,request.operation);
    need(dispatch && Object.hasOwn(dispatch,'value') && typeof dispatch.value==='function','FIRESTORE_GATEWAY_NOT_CONFIGURED');
    let dispatched=false;
    try{return await protocol.guardOperation(external,async ctx=>{
      try{
        const receipt=await claimRequest(meta,ctx.context());ctx.assertLive();need(!disposed,'FIRESTORE_GATEWAY_DISABLED');protocol.validateClaim(receipt,meta);
        await admit(request,ctx);ctx.assertLive();need(!disposed,'FIRESTORE_GATEWAY_DISABLED');dispatched=true;
        // Context contains no upstream receipt or client proof. The privileged
        // REST adapter reserves independently before its own OAuth/network work.
        const result=await dispatch.value(request.body,ctx.context());ctx.assertLive();need(!disposed,'FIRESTORE_GATEWAY_DISABLED');
        return protocol.createResponse(request,{status:'OK',code:'OK',body:result,dispatched:true,requiresReconciliation:false});
      }catch(error){ctx.assertLive();const code=denialCodes.includes(error?.code)?error.code:'FIRESTORE_GATEWAY_OPERATION_FAILED';
        return protocol.createResponse(request,{status:'DENIED',code,body:null,dispatched,requiresReconciliation:dispatched&&mutates(request.operation)});}
    },{expiresAtMs:request.expiresAtMs});}catch(error){
      const code=error instanceof FirestoreGatewayError?error.code:'FIRESTORE_GATEWAY_OPERATION_FAILED';
      throw new FirestoreGatewayError(code,error?.requiresReconciliation===true||dispatched&&mutates(request.operation));
    }
  };
  return Object.freeze({receive,dispose:()=>{disposed=true;}});
}
export function createManagementBrokerFirestoreGatewayAdapters({enabled=false,protocol,requestPrivileged,claimResponse,admitCurrentRequest}={}){
  let disposed=false;const admit=admissionGuard(protocol,admitCurrentRequest);
  const execute=operation=>async(bodyInput,external={})=>{
    need(enabled===true&&!disposed,'FIRESTORE_GATEWAY_DISABLED');need(protocol&&typeof requestPrivileged==='function'&&typeof claimResponse==='function','FIRESTORE_GATEWAY_NOT_CONFIGURED');
    protocol.enabled(operation);const body=freeze(copy(bodyInput,protocol.policy.maxEnvelopeBytes));let sent=false,knownDenied=false;
    try{return await protocol.guardOperation(external,async ctx=>{
      const issuedAtMs=ctx.assertLive(),expiresAtMs=Math.min(issuedAtMs+protocol.policy.maximumTtlMs,ctx.context().deadlineMs);
      const request=protocol.createRequest({operation,requestId:randomBytes(16).toString('hex'),nonce:randomBytes(16).toString('hex'),issuedAtMs,expiresAtMs,body});
      await admit(request,ctx);ctx.assertLive();need(!disposed,'FIRESTORE_GATEWAY_DISABLED');sent=true;
      const input=await requestPrivileged(request,ctx.context());ctx.assertLive();need(!disposed,'FIRESTORE_GATEWAY_DISABLED');const response=protocol.verifyResponse(input,request),meta=protocol.metadata(response,request);
      const receipt=await claimResponse(meta,ctx.context());ctx.assertLive();need(!disposed,'FIRESTORE_GATEWAY_DISABLED');protocol.validateClaim(receipt,meta);
      if(response.status!=='OK'){knownDenied=response.dispatched===false;throw new FirestoreGatewayError(response.code,response.requiresReconciliation);}
      ctx.assertLive();return copy(response.body,protocol.policy.maxEnvelopeBytes);
    });}catch(error){const code=error instanceof FirestoreGatewayError?error.code:'FIRESTORE_GATEWAY_OPERATION_FAILED';
      throw new FirestoreGatewayError(code,error?.requiresReconciliation===true||sent&&mutates(operation)&&!knownDenied);}
  };
  return Object.freeze({...Object.fromEntries(ops.map(op=>[op,execute(op)])),dispose:()=>{disposed=true;}});
}
