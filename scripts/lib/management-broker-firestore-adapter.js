import {createHash} from 'node:crypto';

// Server-only preparation: injected transport/identity/budget; no global fetch,
// credential discovery, source writer, endpoint, deployment or default activation.
const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', ZONE = 'America/Los_Angeles';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
const operations = Object.freeze({readFaAuthorization: FA, readFbLease: FB, writeFbLease: FB, invalidateFbLease: FB});
const minimumReads = Object.freeze({readFaAuthorization: 1, readFbLease: 1, writeFbLease: 2, invalidateFbLease: 2});
const permissions = ['admin','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead',
  'managementIndicatorsWrite','managementPlansManage','documentsManage','equipmentManage','qualityManage','trainingsManage',
  'financeRead','financeWrite','financeManage'];
const leaseKeys = ['schemaVersion','sourceProjectId','destinationProjectId','faUid','fbUid','memberId','leaseVersion','grantId',
  'sourceVersion','policyVersion','sourceHash','active','revoked','managementAllowed','role','permissions','memberAreaIds',
  'managerAreaIds','documentGroups','sourceAuthValidAfterTimeMs','confirmedAtMs','validUntilMs'];
const sourceKeys = ['schemaVersion','sourceProjectId','destinationProjectId','productionAuthorized','coverageComplete',
  'authorizationVersion','sourceVersion','sourceHash','policyVersion','confirmedAtMs','validUntilMs','profile','binding',
  'areas','documentAccess','managementAllowed','sourceAuthValidAfterTimeMs'];
const fenceKeys = ['schemaVersion','sourceProjectId','destinationProjectId','uid','grantId','leaseVersion','fencedAtMs','reasonCode'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum;
const id = (value, maximum = 200) => typeof value === 'string' && value.length > 0 && value.length <= maximum
  && !/[\s/\x00-\x1f]/.test(value) && !['.','..'].includes(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : plain(value)
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const quotaDay = time => new Intl.DateTimeFormat('en-CA',{timeZone: ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
class FirestoreAdapterError extends Error {
  constructor(code, requiresReconciliation = false) { super(code); this.code = code; this.requiresReconciliation = requiresReconciliation; }
}
const need = (condition, code) => { if (!condition) throw new FirestoreAdapterError(code); };
const timestamp = value => {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3}(?:\d{3})?(?:\d{3})?)?Z$/.test(value), 'FIRESTORE_TIMESTAMP_INVALID');
  const time = Date.parse(value); need(integer(time) && new Date(time).toISOString().slice(0,19) === value.slice(0,19), 'FIRESTORE_TIMESTAMP_INVALID'); return time;
};
const fineTimestamp = value => { const time=timestamp(value); const fraction=(value.split('.')[1]?.slice(0,-1) ?? '').padEnd(9,'0'); return BigInt(time)*1000000n + BigInt(fraction.slice(3)); };
function snapshot(value, maximumBytes) {
  const state = {nodes:0};
  const inspect = (item,depth) => {
    need(depth <= 16 && ++state.nodes <= 32768,'FIRESTORE_DATA_INVALID');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') { need(integer(item),'FIRESTORE_DATA_INVALID'); return; }
    need(Array.isArray(item) || plain(item),'FIRESTORE_DATA_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    need(Reflect.ownKeys(descriptors).every(key => typeof key === 'string'),'FIRESTORE_DATA_INVALID');
    if (Array.isArray(item)) need(Object.keys(item).length === item.length
      && Object.getOwnPropertyNames(item).length === item.length+1,'FIRESTORE_DATA_INVALID');
    for (const [key,descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      need(descriptor.enumerable && Object.hasOwn(descriptor,'value') && !['__proto__','prototype','constructor'].includes(key),'FIRESTORE_DATA_INVALID');
      inspect(descriptor.value,depth+1);
    }
  };
  inspect(value,0); const json = JSON.stringify(value);
  need(typeof json === 'string' && Buffer.byteLength(json) <= maximumBytes,'FIRESTORE_DATA_TOO_LARGE'); return JSON.parse(json);
}
function fieldsDecode(fields) {
  need(plain(fields),'FIRESTORE_FIELDS_INVALID');
  const decode = (value,depth) => {
    need(depth <= 16 && plain(value) && Object.keys(value).length === 1,'FIRESTORE_VALUE_INVALID');
    if (Object.hasOwn(value,'nullValue')) { need(value.nullValue === null,'FIRESTORE_VALUE_INVALID'); return null; }
    if (Object.hasOwn(value,'booleanValue')) { need(typeof value.booleanValue === 'boolean','FIRESTORE_VALUE_INVALID'); return value.booleanValue; }
    if (Object.hasOwn(value,'stringValue')) { need(typeof value.stringValue === 'string','FIRESTORE_VALUE_INVALID'); return value.stringValue; }
    if (Object.hasOwn(value,'integerValue')) {
      need(typeof value.integerValue === 'string' && /^(0|[1-9]\d*)$/.test(value.integerValue),'FIRESTORE_VALUE_INVALID');
      const number = Number(value.integerValue); need(integer(number),'FIRESTORE_VALUE_INVALID'); return number;
    }
    if (Object.hasOwn(value,'arrayValue')) {
      need(plain(value.arrayValue) && Object.keys(value.arrayValue).every(key => key === 'values'),'FIRESTORE_VALUE_INVALID');
      const values = value.arrayValue.values ?? []; need(Array.isArray(values),'FIRESTORE_VALUE_INVALID');
      return values.map(item => decode(item,depth+1));
    }
    if (Object.hasOwn(value,'mapValue')) {
      need(plain(value.mapValue) && Object.keys(value.mapValue).every(key => key === 'fields'),'FIRESTORE_VALUE_INVALID');
      return map(value.mapValue.fields ?? {},depth+1);
    }
    throw new FirestoreAdapterError('FIRESTORE_VALUE_INVALID');
  };
  const map = (value,depth) => {
    need(plain(value) && depth <= 16,'FIRESTORE_VALUE_INVALID');
    return Object.fromEntries(Object.entries(value).map(([key,item]) => {
      need(!['__proto__','prototype','constructor'].includes(key),'FIRESTORE_VALUE_INVALID'); return [key,decode(item,depth+1)];
    }));
  };
  return map(fields,0);
}
function fieldsEncode(value) {
  const encode = item => item === null ? {nullValue:null} : typeof item === 'boolean' ? {booleanValue:item}
    : typeof item === 'string' ? {stringValue:item} : typeof item === 'number' ? {integerValue:String(item)}
    : Array.isArray(item) ? {arrayValue:{values:item.map(encode)}} : {mapValue:{fields:fieldsEncode(item)}};
  return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,encode(item)]));
}
function policySnapshot(supplied) {
  const policy = snapshot(supplied,16384), budget = policy.readBudget;
  need(policy.schemaVersion === 1 && id(policy.policyVersion,100)
    && integer(policy.operationTimeoutMs,1) && policy.operationTimeoutMs <= 120000
    && integer(policy.maxResponseBytes,1024) && policy.maxResponseBytes <= 1048576
    && integer(policy.maxResponseChunks,1) && policy.maxResponseChunks <= 1024
    && integer(policy.maxSnapshotAgeMs,1) && policy.maxSnapshotAgeMs <= 300000
    && integer(policy.maxFutureSkewMs) && policy.maxFutureSkewMs <= 60000
    && integer(policy.sourceMaxAgeMs,1) && policy.sourceMaxAgeMs <= 300000
    && integer(policy.sourceMaxLeaseMs,1) && policy.sourceMaxLeaseMs <= 86400000
    && integer(policy.leaseMaxDurationMs,1) && policy.leaseMaxDurationMs <= 86400000
    && integer(policy.maxReservationRecords,1) && policy.maxReservationRecords <= 100000
    && integer(policy.maxSourceVersions,1) && policy.maxSourceVersions <= 100000,'FIRESTORE_POLICY_REQUIRED');
  need(plain(budget) && exact(budget.dailyLimits,[FA,FB]) && [35000,45000].includes(budget.dailyLimits[FA])
    && budget.dailyLimits[FB] === 35000 && budget.quotaTimezone === ZONE
    && integer(budget.maxMeasurementAgeMs,1) && budget.maxMeasurementAgeMs <= 300000
    && integer(budget.applicationReserveReads,1) && integer(budget.metricLagReserveReads,1)
    && exact(budget.operationReadBounds,Object.keys(operations)),'FIRESTORE_BUDGET_POLICY_INVALID');
  if (budget.dailyLimits[FA] === 45000) need(budget.limitApprovalEvidence === 'USER_FA_DAILY_LIMIT_45000_2026_10_08','FIRESTORE_FA_LIMIT_NOT_AUTHORIZED');
  for (const operation of Object.keys(operations)) need(integer(budget.operationReadBounds[operation],minimumReads[operation])
    && budget.operationReadBounds[operation]+budget.applicationReserveReads+budget.metricLagReserveReads < budget.dailyLimits[operations[operation]],'FIRESTORE_READ_BOUND_INVALID');
  return policy;
}
function validateLease(data,uid,policy,live = false,time = 0) {
  need(exact(data,leaseKeys) && data.schemaVersion === 1 && data.sourceProjectId === FA && data.destinationProjectId === FB
    && data.faUid === uid && data.fbUid === uid && id(data.memberId) && integer(data.leaseVersion,1)
    && id(data.grantId,100) && integer(data.sourceVersion,1) && id(data.policyVersion,100) && hash(data.sourceHash)
    && typeof data.active === 'boolean' && typeof data.revoked === 'boolean' && typeof data.managementAllowed === 'boolean'
    && typeof data.role === 'string' && data.role.length <= 100 && exact(data.permissions,permissions)
    && permissions.every(key => typeof data.permissions[key] === 'boolean')
    && integer(data.sourceAuthValidAfterTimeMs) && integer(data.confirmedAtMs,1) && integer(data.validUntilMs,1)
    && data.validUntilMs >= data.confirmedAtMs && data.validUntilMs-data.confirmedAtMs <= policy.leaseMaxDurationMs,'FIRESTORE_LEASE_INVALID');
  for (const key of ['memberAreaIds','managerAreaIds']) need(Array.isArray(data[key]) && data[key].length <= 1000
    && data[key].every(value => id(value)) && new Set(data[key]).size === data[key].length,'FIRESTORE_LEASE_INVALID');
  need(Array.isArray(data.documentGroups) && data.documentGroups.length <= 2 && new Set(data.documentGroups).size === data.documentGroups.length
    && data.documentGroups.every(value => ['GENERAL','RESTRICTED'].includes(value)),'FIRESTORE_LEASE_INVALID');
  if (live) need(data.policyVersion === policy.policyVersion && data.active === true && data.revoked === false
    && data.managementAllowed === true && data.confirmedAtMs <= time && data.validUntilMs > time,'FIRESTORE_LEASE_NOT_LIVE');
  return data;
}
function validateFence(data,uid,grantId,leaseVersion) {
  need(exact(data,fenceKeys) && data.schemaVersion === 1 && data.sourceProjectId === FA && data.destinationProjectId === FB
    && data.uid === uid && data.grantId === grantId && data.leaseVersion === leaseVersion && integer(data.fencedAtMs,1)
    && typeof data.reasonCode === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(data.reasonCode),'FIRESTORE_FENCE_INVALID');
}

export const MANAGEMENT_BROKER_FIRESTORE_PATHS = Object.freeze({
  source: 'managementSourceContexts', leases: 'managementAuthorizationLeases', fences: 'managementAuthorizationFences'
});
export function createManagementBrokerFirestoreAdapter({enabled = false,fetchImpl,getAdminAccessToken,
  readFaAuthUser,reserveFirestoreReads,policy:suppliedPolicy,clock = Date.now,monotonicNow = () => performance.now()} = {}) {
  let disposed = false; const active = new Map(), usedReservations = new Set(), floors = new Map(), sourceVersions = new Map();
  let policy;
  const execute = (operation,work) => async (request,external = {}) => {
    let controller,timer,onAbort,ctx;
    try {
      need(enabled === true && !disposed,'FIRESTORE_ADAPTER_DISABLED');
      need(typeof fetchImpl === 'function' && typeof getAdminAccessToken === 'function' && typeof readFaAuthUser === 'function'
        && typeof reserveFirestoreReads === 'function' && typeof clock === 'function' && typeof monotonicNow === 'function','FIRESTORE_ADAPTER_NOT_CONFIGURED');
      policy ??= policySnapshot(suppliedPolicy); request = snapshot(request,policy.maxResponseBytes);
      need(plain(external) && (external.signal === undefined || external.signal && typeof external.signal.aborted === 'boolean'
        && typeof external.signal.addEventListener === 'function' && typeof external.signal.removeEventListener === 'function'),'FIRESTORE_CONTEXT_INVALID');
      const start = clock(), wallStart = monotonicNow(); need(integer(start,1) && Number.isFinite(wallStart),'FIRESTORE_CLOCK_INVALID');
      need(external.deadlineMs === undefined || integer(external.deadlineMs,1),'FIRESTORE_CONTEXT_INVALID');
      let deadline = Math.min(start+policy.operationTimeoutMs,external.deadlineMs ?? Infinity), wallDeadline = wallStart+deadline-start;
      need(integer(deadline,1) && deadline > start,'FIRESTORE_DEADLINE_EXCEEDED');
      controller = new AbortController(); let rejectCancelled;
      const cancelled = new Promise((_,reject) => {rejectCancelled = reject;});
      const cancel = code => {controller.abort(); rejectCancelled(new FirestoreAdapterError(code,ctx?.commitIssued === true));};
      timer = setTimeout(() => cancel('FIRESTORE_DEADLINE_EXCEEDED'),Math.max(1,deadline-start));
      onAbort = () => cancel('FIRESTORE_CANCELLED'); external.signal?.addEventListener('abort',onAbort,{once:true});
      active.set(controller,cancel); let greatestTime = start,greatestWall = wallStart;
      const assertLive = () => {
        need(!disposed && !controller.signal.aborted && external.signal?.aborted !== true,'FIRESTORE_CANCELLED');
        const time = clock(),wall = monotonicNow();
        need(integer(time,1) && time >= greatestTime && Number.isFinite(wall) && wall >= greatestWall,'FIRESTORE_CLOCK_INVALID');
        greatestTime=time; greatestWall=wall;
        need(time < deadline && wall < wallDeadline,'FIRESTORE_DEADLINE_EXCEEDED');
        if (ctx?.reservation) need(ctx.reservation.quotaDay === quotaDay(time) && time < ctx.reservation.expiresAtMs,'FIRESTORE_RESERVATION_EXPIRED');
        return time;
      };
      ctx = {operation,projectId:operations[operation],assertLive,signal:controller.signal,commitIssued:false,reservation:null,
        context: () => Object.freeze({signal:controller.signal,deadlineMs:deadline}),
        limit: time => {assertLive(); deadline=Math.min(deadline,time); wallDeadline=Math.min(wallDeadline,monotonicNow()+deadline-clock()); assertLive();}};
      const result = await Promise.race([Promise.resolve().then(async () => {
        assertLive(); await reserve(ctx,external); assertLive(); return work(request,ctx);
      }),cancelled]);
      assertLive(); return result;
    } catch (error) {
      if (error instanceof FirestoreAdapterError) throw new FirestoreAdapterError(error.code,error.requiresReconciliation || ctx?.commitIssued === true);
      throw new FirestoreAdapterError('FIRESTORE_ADAPTER_UNAVAILABLE',ctx?.commitIssued === true);
    } finally {
      controller?.abort();clearTimeout(timer);if(controller)active.delete(controller);
      try {external.signal?.removeEventListener('abort',onAbort);} catch {}
    }
  };
  async function reserve(ctx,external) {
    const time=ctx.assertLive(),budget=policy.readBudget,maximumReads=budget.operationReadBounds[ctx.operation];
    const request=Object.freeze({projectId:ctx.projectId,operation:ctx.operation,maximumReads,dailyLimit:budget.dailyLimits[ctx.projectId],
      quotaTimezone:ZONE,quotaDay:quotaDay(time),applicationReserveReads:budget.applicationReserveReads,metricLagReserveReads:budget.metricLagReserveReads});
    // A trusted host may validate/adopt the upstream reservation here. Otherwise
    // its ledger creates another conservative reservation; never fabricate a receipt.
    const receipt=await reserveFirestoreReads(request,Object.freeze({...ctx.context(),upstreamReservation:external.firestoreReservation}));
    const now=ctx.assertLive(); need(plain(receipt) && receipt.schemaVersion === 1 && receipt.projectId === request.projectId
      && receipt.operation === request.operation && id(receipt.reservationId) && receipt.quotaTimezone === ZONE
      && receipt.quotaDay === quotaDay(now) && receipt.dailyLimit === request.dailyLimit && receipt.pausedRequiresReview === false
      && receipt.metricsComplete === true && integer(receipt.measurementTimeMs) && receipt.measurementTimeMs <= now
      && quotaDay(receipt.measurementTimeMs) === receipt.quotaDay && now-receipt.measurementTimeMs <= budget.maxMeasurementAgeMs
      && integer(receipt.expiresAtMs) && receipt.expiresAtMs > now && receipt.reservedReads === maximumReads
      && integer(receipt.totalReadCount) && integer(receipt.outstandingReservedReads,maximumReads) && integer(receipt.unreportedConsumedReads)
      && integer(receipt.applicationReserveReads,budget.applicationReserveReads) && integer(receipt.metricLagReserveReads,budget.metricLagReserveReads)
      && receipt.totalReadCount+receipt.outstandingReservedReads+receipt.unreportedConsumedReads+receipt.applicationReserveReads
        +receipt.metricLagReserveReads < request.dailyLimit,'FIRESTORE_RESERVATION_DENIED');
    const key=ctx.projectId+':'+receipt.reservationId; need(usedReservations.size < policy.maxReservationRecords
      && !usedReservations.has(key),'FIRESTORE_RESERVATION_REUSED');
    const prior=floors.get(ctx.projectId),sameDay=prior?.quotaDay === receipt.quotaDay;
    need(!sameDay || receipt.totalReadCount >= prior.observed,'FIRESTORE_MEASUREMENT_REGRESSED');
    const floor=Math.max(sameDay ? prior.floor : 0,receipt.totalReadCount)+maximumReads;
    need(receipt.totalReadCount+receipt.outstandingReservedReads+receipt.unreportedConsumedReads >= floor,'FIRESTORE_RESERVATION_ACCOUNTING_INCOMPLETE');
    usedReservations.add(key); floors.set(ctx.projectId,{quotaDay:receipt.quotaDay,observed:receipt.totalReadCount,floor});
    ctx.reservation=Object.freeze({reservationId:receipt.reservationId,quotaDay:receipt.quotaDay,expiresAtMs:receipt.expiresAtMs,remainingReads:maximumReads});
    ctx.limit(receipt.expiresAtMs); ctx.remainingReads=maximumReads;
  }
  async function credential(ctx) {
    ctx.assertLive(); const value=await getAdminAccessToken(Object.freeze({projectId:ctx.projectId,purpose:'management-firestore-'+ctx.operation,scopes:Object.freeze([SCOPE])}),ctx.context());
    const time=ctx.assertLive(); need(plain(value) && value.credentialType === 'google-oauth2' && integer(value.expiresAtMs)
      && value.expiresAtMs > time && Array.isArray(value.scopes) && (value.scopes.includes(SCOPE)
        || value.scopes.includes('https://www.googleapis.com/auth/cloud-platform'))
      && typeof value.accessToken === 'string' && value.accessToken.length > 0 && value.accessToken.length <= 16000
      && !/[\s\x00-\x1f]/.test(value.accessToken) && value.accessToken.split('.').length !== 3,'FIRESTORE_CREDENTIAL_INVALID');
    ctx.limit(value.expiresAtMs); return value.accessToken;
  }
  const database=projectId => 'projects/'+projectId+'/databases/(default)';
  const document=(projectId,collection,uid) => database(projectId)+'/documents/'+collection+'/'+uid;
  const fenceName=(uid,grantId) => document(FB,MANAGEMENT_BROKER_FIRESTORE_PATHS.fences,digest([uid,grantId]));
  async function rpc(method,body,ctx,{commit=false}={}) {
    need(['batchGet','beginTransaction','commit','rollback'].includes(method),'FIRESTORE_METHOD_DENIED');
    const url='https://firestore.googleapis.com/v1/'+database(ctx.projectId)+'/documents:'+method;
    let token=null,reader;
    try {
      token=await credential(ctx);ctx.assertLive();
      if(commit)ctx.commitIssued=true;
      const response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify(body),redirect:'error',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:ctx.signal});
      token=null;ctx.assertLive();
      need(response && response.redirected === false && response.url === url && /^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') ?? '')
        && (response.headers.get('age') === null || /^0+$/.test(response.headers.get('age'))),'FIRESTORE_RESPONSE_INVALID');
      const length=response.headers.get('content-length'); need(length === null || /^\d+$/.test(length) && Number(length) <= policy.maxResponseBytes,'FIRESTORE_RESPONSE_TOO_LARGE');
      reader=response.body?.getReader?.();need(reader && typeof reader.read === 'function','FIRESTORE_RESPONSE_INVALID');
      const chunks=[];let size=0;
      while(true){ctx.assertLive();const part=await reader.read();ctx.assertLive();if(part.done)break;
        need(part.value instanceof Uint8Array && part.value.byteLength > 0 && chunks.length < policy.maxResponseChunks,'FIRESTORE_RESPONSE_INVALID');
        size+=part.value.byteLength;need(size <= policy.maxResponseBytes,'FIRESTORE_RESPONSE_TOO_LARGE');chunks.push(part.value);}
      let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new FirestoreAdapterError('FIRESTORE_RESPONSE_INVALID');}
      data=snapshot(data,policy.maxResponseBytes);ctx.assertLive();
      if(response.status !== 200){
        if(commit && [409,412].includes(response.status) && ['ABORTED','FAILED_PRECONDITION'].includes(data?.error?.status))return {conflict:true};
        throw new FirestoreAdapterError(commit ? 'FIRESTORE_COMMIT_UNCONFIRMED' : 'FIRESTORE_HTTP_DENIED',commit);
      }
      return {data};
    }finally{token=null;try{void Promise.resolve(reader?.cancel?.()).catch(()=>{});}catch{}try{reader?.releaseLock?.();}catch{}}
  }
  async function batch(names,ctx,transaction) {
    need(names.length > 0 && names.length <= 2 && names.every(name => name.startsWith(database(ctx.projectId)+'/documents/'))
      && new Set(names).size === names.length && ctx.remainingReads >= names.length,'FIRESTORE_READ_BOUND_EXCEEDED');
    ctx.assertLive();ctx.remainingReads-=names.length;
    const {data}=await rpc('batchGet',{documents:names,...(transaction ? {transaction} : {})},ctx);
    need(Array.isArray(data) && data.length === names.length,'FIRESTORE_BATCH_INVALID');const result=new Map();let latestRead=-1n;
    for(const item of data){
      need(plain(item) && Object.keys(item).every(key=>['found','missing','readTime'].includes(key))
        && (Object.hasOwn(item,'found') !== Object.hasOwn(item,'missing')),'FIRESTORE_BATCH_INVALID');
      const time=timestamp(item.readTime),fineRead=fineTimestamp(item.readTime),name=item.found?.name ?? item.missing;
      need(names.includes(name) && !result.has(name) && fineRead >= latestRead
        && time <= ctx.assertLive()+policy.maxFutureSkewMs && ctx.assertLive()-time <= policy.maxSnapshotAgeMs,'FIRESTORE_BATCH_INVALID');latestRead=fineRead;
      if(item.found){const doc=item.found;need(exact(doc,['name','fields','createTime','updateTime']) && fineTimestamp(doc.createTime) <= fineTimestamp(doc.updateTime)
          && fineTimestamp(doc.updateTime) <= fineRead,'FIRESTORE_DOCUMENT_INVALID');
        result.set(name,{exists:true,revision:doc.updateTime,readTimeMs:time,data:fieldsDecode(doc.fields)});
      }else result.set(name,{exists:false,revision:null,readTimeMs:time,data:null});
    }
    return result;
  }
  function validateRead(request,projectId) {need(exact(request,['uid','projectId']) && request.projectId === projectId && id(request.uid,128),'FIRESTORE_REQUEST_INVALID');}
  async function transaction(ctx,work) {
    let transactionId=null,commitSent=false;
    try {
      const {data}=await rpc('beginTransaction',{options:{readWrite:{}}},ctx);
      need(exact(data,['transaction']) && typeof data.transaction === 'string' && /^[A-Za-z0-9+/]{4,2048}={0,2}$/.test(data.transaction),'FIRESTORE_TRANSACTION_INVALID');
      transactionId=data.transaction;
      const output=await work(transactionId,async writes => {
        need(Array.isArray(writes) && writes.length > 0 && writes.length <= 2,'FIRESTORE_WRITE_DENIED');
        ctx.assertLive();commitSent=true;const result=await rpc('commit',{transaction:transactionId,writes},ctx,{commit:true});
        if(result.conflict){ctx.commitIssued=false;return {conflict:true};}
        const value=result.data;need(exact(value,['writeResults','commitTime']) && Array.isArray(value.writeResults)
          && value.writeResults.length === writes.length,'FIRESTORE_COMMIT_RESPONSE_INVALID');
        const commitTime=timestamp(value.commitTime);
        need(commitTime <= ctx.assertLive()+policy.maxFutureSkewMs,'FIRESTORE_COMMIT_RESPONSE_INVALID');
        for(const write of value.writeResults)need(exact(write,['updateTime']) && fineTimestamp(write.updateTime) <= fineTimestamp(value.commitTime),'FIRESTORE_COMMIT_RESPONSE_INVALID');
        return {revisions:value.writeResults.map(write=>write.updateTime)};
      });
      return output;
    }finally{
      // Rollback is best effort only before a commit was sent, on the original
      // deadline/reservation. It never authorizes retry or a new grant.
      if(transactionId && !commitSent){try{ctx.assertLive();await rpc('rollback',{transaction:transactionId},ctx);}catch{}}
    }
  }
  const readFaAuthorization=execute('readFaAuthorization',async(request,ctx)=>{
    validateRead(request,FA);const name=document(FA,MANAGEMENT_BROKER_FIRESTORE_PATHS.source,request.uid);
    const record=(await batch([name],ctx)).get(name),time=ctx.assertLive();need(record.exists,'FA_SOURCE_CONTEXT_MISSING');const data=record.data;
    need(exact(data,sourceKeys) && data.schemaVersion === 1 && data.sourceProjectId === FA && data.destinationProjectId === FB
      && data.productionAuthorized === true && data.coverageComplete === true && data.policyVersion === policy.policyVersion
      && integer(data.authorizationVersion,1) && data.sourceVersion === data.authorizationVersion && hash(data.sourceHash)
      && integer(data.confirmedAtMs,1) && data.confirmedAtMs <= time && time-data.confirmedAtMs <= policy.sourceMaxAgeMs
      && integer(data.validUntilMs,1) && data.validUntilMs > time && data.validUntilMs > data.confirmedAtMs
      && data.validUntilMs-data.confirmedAtMs <= policy.sourceMaxLeaseMs && integer(data.sourceAuthValidAfterTimeMs),'FA_SOURCE_CONTEXT_INVALID');
    const profile=data.profile;need(exact(profile,['uid','memberId','active','access','role','permissions']) && profile.uid === request.uid
      && id(profile.memberId) && profile.active === true && profile.access === true && typeof profile.role === 'string' && profile.role.length <= 100
      && exact(profile.permissions,permissions) && permissions.every(key=>typeof profile.permissions[key] === 'boolean'),'FA_SOURCE_PROFILE_INVALID');
    need(exact(data.binding,['sourceProjectId','destinationProjectId','faUid','fbUid','memberId']) && data.binding.sourceProjectId === FA
      && data.binding.destinationProjectId === FB && data.binding.faUid === request.uid && data.binding.fbUid === request.uid
      && data.binding.memberId === profile.memberId,'FA_SOURCE_BINDING_INVALID');
    const members=[],managers=[],seen=new Set();need(Array.isArray(data.areas) && data.areas.length <= 1000,'FA_SOURCE_AREAS_INVALID');
    for(const area of data.areas){need(exact(area,['id','active','version','memberUids','managerUids']) && id(area.id) && !seen.has(area.id)
        && typeof area.active === 'boolean' && integer(area.version,1),'FA_SOURCE_AREAS_INVALID');seen.add(area.id);
      for(const key of ['memberUids','managerUids'])need(Array.isArray(area[key]) && area[key].length <= 100 && area[key].every(uid=>id(uid,128))
        && new Set(area[key]).size === area[key].length,'FA_SOURCE_AREAS_INVALID');
      if(area.active){if(area.memberUids.includes(request.uid))members.push(area.id);if(area.managerUids.includes(request.uid))managers.push(area.id);}}
    const access=data.documentAccess;need(plain(access) && Object.keys(access).every(key=>['active','groups','googleUid'].includes(key))
      && typeof access.active === 'boolean' && Array.isArray(access.groups) && access.groups.length <= 2
      && new Set(access.groups).size === access.groups.length && access.groups.every(group=>['GENERAL','RESTRICTED'].includes(group)),'FA_SOURCE_GROUPS_INVALID');
    const auth=await readFaAuthUser(Object.freeze({uid:request.uid,projectId:FA}),ctx.context());const now=ctx.assertLive();
    need(plain(auth) && auth.schemaVersion === 1 && auth.projectId === FA && auth.fromCache === false && auth.hasPendingWrites === false
      && integer(auth.readTimeMs) && auth.readTimeMs <= now+policy.maxFutureSkewMs && now-auth.readTimeMs <= policy.maxSnapshotAgeMs
      && auth.user?.uid === request.uid && auth.user.disabled === false && auth.user.emailVerified === true && id(auth.user.googleUid,128)
      && auth.user.tokensValidAfterTimeMs === data.sourceAuthValidAfterTimeMs && Array.isArray(auth.user.providerData)
      && auth.user.providerData.filter(value=>value.providerId === 'google.com').length === 1
      && auth.user.providerData.find(value=>value.providerId === 'google.com').uid === auth.user.googleUid,'FA_SOURCE_AUTH_CHANGED');
    need(now < data.validUntilMs && now-data.confirmedAtMs <= policy.sourceMaxAgeMs,'FA_SOURCE_CONTEXT_EXPIRED');
    if(access.active)need(access.googleUid === auth.user.googleUid,'FA_SOURCE_GROUP_IDENTITY_INVALID');
    const effectivePermissions={...profile.permissions,admin:profile.role === 'administrador_app' || profile.permissions.admin};
    const groups=access.active ? [...access.groups].sort() : [],allowed=Object.values(effectivePermissions).some(Boolean) || members.length>0 || managers.length>0 || groups.length>0;
    const normalized={sourceProjectId:FA,destinationProjectId:FB,faUid:request.uid,fbUid:request.uid,memberId:profile.memberId,
      authorizationVersion:data.authorizationVersion,active:true,managementAllowed:allowed,role:profile.role,permissions:effectivePermissions,
      memberAreaIds:members.sort(),managerAreaIds:managers.sort(),documentGroups:groups,sourceAuthValidAfterTimeMs:data.sourceAuthValidAfterTimeMs,googleUid:auth.user.googleUid};
    need(data.managementAllowed === allowed && allowed && data.sourceHash === digest(normalized),'FA_SOURCE_HASH_INVALID');
    const previous=sourceVersions.get(request.uid);need(!previous || data.sourceVersion > previous.version
      || data.sourceVersion === previous.version && data.sourceHash === previous.hash,'FA_SOURCE_VERSION_REGRESSED');
    need(previous || sourceVersions.size < policy.maxSourceVersions,'FA_SOURCE_VERSION_CAPACITY_EXCEEDED');sourceVersions.set(request.uid,{version:data.sourceVersion,hash:data.sourceHash});
    return {schemaVersion:1,projectId:FA,fromCache:false,hasPendingWrites:false,readTimeMs:record.readTimeMs,consistentRead:true,coverageComplete:true,
      productionAuthorized:true,authorizationVersion:data.authorizationVersion,sourceRevision:record.revision,
      authUser:{uid:request.uid,disabled:false,emailVerified:true,googleUid:auth.user.googleUid,tokensValidAfterTimeMs:auth.user.tokensValidAfterTimeMs},
      profile,binding:data.binding,areas:data.areas,documentAccess:access};
  });
  const readFbLease=execute('readFbLease',async(request,ctx)=>{
    validateRead(request,FB);const name=document(FB,MANAGEMENT_BROKER_FIRESTORE_PATHS.leases,request.uid),record=(await batch([name],ctx)).get(name);
    if(record.exists)validateLease(record.data,request.uid,policy);
    return {schemaVersion:1,projectId:FB,fromCache:false,hasPendingWrites:false,readTimeMs:record.readTimeMs,exists:record.exists,revision:record.revision,lease:record.data};
  });
  const writeFbLease=execute('writeFbLease',async(request,ctx)=>{
    need(exact(request,['uid','projectId','expectedRevision','lease']) && request.projectId === FB && id(request.uid,128),'FIRESTORE_REQUEST_INVALID');
    if(request.expectedRevision !== null)timestamp(request.expectedRevision);const lease=validateLease(request.lease,request.uid,policy,true,ctx.assertLive());
    const name=document(FB,MANAGEMENT_BROKER_FIRESTORE_PATHS.leases,request.uid),fence=fenceName(request.uid,lease.grantId);
    return transaction(ctx,async(transactionId,commit)=>{
      const records=await batch([name,fence],ctx,transactionId),prior=records.get(name),cancelled=records.get(fence);
      if(cancelled.exists){validateFence(cancelled.data,request.uid,lease.grantId,lease.leaseVersion);return {applied:false,projectId:FB,fenced:true};}
      if(prior.revision !== request.expectedRevision)return {applied:false,projectId:FB};
      if(prior.exists){validateLease(prior.data,request.uid,policy);need(prior.data.memberId === lease.memberId
          && prior.data.leaseVersion+1 === lease.leaseVersion && lease.sourceVersion >= prior.data.sourceVersion
          && (lease.sourceVersion > prior.data.sourceVersion || prior.data.sourceHash === lease.sourceHash && prior.data.revoked === false),'FIRESTORE_LEASE_VERSION_DENIED');}
      else need(lease.leaseVersion === 1,'FIRESTORE_LEASE_VERSION_DENIED');
      validateLease(lease,request.uid,policy,true,ctx.assertLive());
      const result=await commit([{update:{name,fields:fieldsEncode(lease)},currentDocument:prior.exists ? {updateTime:prior.revision} : {exists:false}}]);
      if(result.conflict)return {applied:false,projectId:FB};
      return {applied:true,projectId:FB,revision:result.revisions[0]};
    });
  });
  const invalidateFbLease=execute('invalidateFbLease',async(request,ctx)=>{
    need(exact(request,['uid','projectId','expectedGrantId','expectedLeaseVersion','reasonCode']) && request.projectId === FB
      && id(request.uid,128) && id(request.expectedGrantId,100) && integer(request.expectedLeaseVersion,1)
      && typeof request.reasonCode === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(request.reasonCode),'FIRESTORE_REQUEST_INVALID');
    const name=document(FB,MANAGEMENT_BROKER_FIRESTORE_PATHS.leases,request.uid),fence=fenceName(request.uid,request.expectedGrantId);
    return transaction(ctx,async(transactionId,commit)=>{
      const records=await batch([name,fence],ctx,transactionId),prior=records.get(name),existingFence=records.get(fence),writes=[];
      if(prior.exists)validateLease(prior.data,request.uid,policy);
      if(existingFence.exists)validateFence(existingFence.data,request.uid,request.expectedGrantId,request.expectedLeaseVersion);
      else writes.push({update:{name:fence,fields:fieldsEncode({schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,uid:request.uid,
        grantId:request.expectedGrantId,leaseVersion:request.expectedLeaseVersion,fencedAtMs:ctx.assertLive(),reasonCode:request.reasonCode})},currentDocument:{exists:false}});
      const matched=prior.exists && prior.data.grantId === request.expectedGrantId && prior.data.leaseVersion === request.expectedLeaseVersion;
      if(matched){const revoked={...prior.data,active:false,revoked:true,managementAllowed:false,validUntilMs:Math.min(prior.data.validUntilMs,ctx.assertLive())};
        need(revoked.validUntilMs >= revoked.confirmedAtMs,'FIRESTORE_LEASE_TIME_INVALID');
        writes.push({update:{name,fields:fieldsEncode(revoked)},currentDocument:{updateTime:prior.revision}});}
      if(!writes.length)return {applied:false,matched:false,fenced:true,projectId:FB};
      const result=await commit(writes);
      if(result.conflict)return {applied:false,matched:false,fenced:false,projectId:FB};
      return {applied:matched,matched,fenced:true,projectId:FB};
    });
  });
  return Object.freeze({readFaAuthorization,readFbLease,writeFbLease,invalidateFbLease,
    dispose:()=>{disposed=true;for(const cancel of active.values())cancel('FIRESTORE_CANCELLED');active.clear();}});
}
