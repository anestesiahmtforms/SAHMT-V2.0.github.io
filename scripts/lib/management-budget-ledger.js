import {createHash, randomUUID} from 'node:crypto';

const PROJECTS = ['sahmt-17a16', 'sahmt-gestao-5ae66'];
const ZONE = 'America/Los_Angeles', ALLOWED_LIMITS = [35000,45000];
const METRICS = ['read_ops_count', 'read_count'];
const OPERATIONS = {readFaAuthorization: PROJECTS[0], readFaSourceContext: PROJECTS[0],
  readFbLease: PROJECTS[1], writeFbLease: PROJECTS[1], invalidateFbLease: PROJECTS[1]};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const copy = value => JSON.parse(JSON.stringify(value));
const inputSnapshot = (value, code) => {
  const visit = (entry, depth = 0) => {
    check(depth <= 64, code);
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {check(Number.isFinite(entry),code);return;}
    check(Array.isArray(entry) || object(entry) && (Object.getPrototypeOf(entry)===Object.prototype || Object.getPrototypeOf(entry)===null),code);
    const descriptors=Object.getOwnPropertyDescriptors(entry);
    check(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'),code);
    if(Array.isArray(entry))check(Object.keys(entry).length===entry.length
      && Object.keys(entry).every(key=>/^(?:0|[1-9][0-9]*)$/.test(key) && Number(key)<entry.length),code);
    for(const [key,descriptor] of Object.entries(descriptors)) {
      if(Array.isArray(entry) && key==='length')continue;
      check(Object.hasOwn(descriptor,'value') && descriptor.enumerable===true,code);visit(descriptor.value,depth+1);
    }
  };
  visit(value);return copy(value);
};
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const dayFormatter = new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
const quotaDay = time => dayFormatter.format(new Date(time));
const dayString = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
class LedgerDenial extends Error { constructor(code) { super(code); this.code = code; } }
const check = (value, code) => { if (!value) throw new LedgerDenial(code); };
const unique = values => new Set(values).size === values.length;
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const projectId = value => check(PROJECTS.includes(value), 'LEDGER_PROJECT_INVALID');
const dayEnd = time => {
  let low = time, high = time + 30 * 60 * 60 * 1000;
  const day = quotaDay(time);
  while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (quotaDay(middle) === day) low = middle; else high = middle; }
  return high;
};

function policyValue(supplied) {
  const value=inputSnapshot(supplied,'LEDGER_POLICY_INVALID');
  check(keys(value,['schemaVersion','version','dailyLimits','quotaTimezone','maxMeasurementAgeMs','applicationReserveReads',
    'metricLagReserveReads','reservationTtlMs','transactionTimeoutMs','maxApprovalAgeMs','maxReservationRecords','maxDayRecords',
    'maxApprovalRecords','maxSettlementRecords','maxObservationRecords','operationReadBounds'])
    && value.schemaVersion === 1 && id(value.version) && keys(value.dailyLimits,PROJECTS)
    && PROJECTS.every(project=>ALLOWED_LIMITS.includes(value.dailyLimits[project]))
    && value.quotaTimezone === ZONE, 'LEDGER_POLICY_REQUIRED');
  for (const name of ['maxMeasurementAgeMs', 'applicationReserveReads', 'metricLagReserveReads',
    'reservationTtlMs', 'transactionTimeoutMs', 'maxApprovalAgeMs', 'maxReservationRecords',
    'maxDayRecords', 'maxApprovalRecords', 'maxSettlementRecords', 'maxObservationRecords'])
    check(integer(value[name], 1), 'LEDGER_POLICY_INVALID');
  check(value.maxMeasurementAgeMs <= 300000 && value.reservationTtlMs <= 120000 && value.transactionTimeoutMs <= 120000
    && value.maxReservationRecords <= 1000000 && value.maxDayRecords <= 10000
    && value.maxApprovalRecords <= 1000000 && value.maxSettlementRecords <= 2000000 && value.maxObservationRecords <= 1000000
    && PROJECTS.every(project=>value.applicationReserveReads + value.metricLagReserveReads < value.dailyLimits[project])
    && object(value.operationReadBounds) && Object.keys(value.operationReadBounds).length > 0, 'LEDGER_POLICY_INVALID');
  for (const [name, maximum] of Object.entries(value.operationReadBounds))
    check(OPERATIONS[name] && integer(maximum, 1)
      && maximum + value.applicationReserveReads + value.metricLagReserveReads < value.dailyLimits[OPERATIONS[name]], 'LEDGER_OPERATION_BOUND_INVALID');
  return Object.freeze(copy(value));
}
const scopedPolicy = (policy, project) => {
  const {dailyLimits,operationReadBounds,...shared}=policy;
  return {...shared,projectId:project,dailyLimit:dailyLimits[project],
    operationReadBounds:Object.fromEntries(Object.entries(operationReadBounds).filter(([operation])=>OPERATIONS[operation]===project))};
};
const dayRecord = day => ({quotaDay: day, measurement: null, maximumObservedReadCount: 0, approvalId: null});
const freshState = (project, day, time, policyHash, dailyLimit) => ({schemaVersion: 1, projectId: project,
  dailyLimit, quotaTimezone: ZONE, policyHash, revision: 0, createdAtMs: time, updatedAtMs: time,
  currentQuotaDay: day, pausedRequiresReview: true, pauseEpoch: 1, pauseReason: 'LEDGER_HUMAN_REVIEW_REQUIRED',
  days: [dayRecord(day)], reservations: [], approvals: [], settlements: [], observations: []});

function validateState(value, project, policy, policyHash) {
  const invalid = 'LEDGER_SNAPSHOT_INVALID';
  check(keys(value, ['schemaVersion','projectId','dailyLimit','quotaTimezone','policyHash','revision','createdAtMs','updatedAtMs',
    'currentQuotaDay','pausedRequiresReview','pauseEpoch','pauseReason','days','reservations','approvals','settlements','observations'])
    && value.schemaVersion === 1 && value.projectId === project && value.dailyLimit === policy.dailyLimits[project]
    && value.quotaTimezone === ZONE && value.policyHash === policyHash && integer(value.revision, 1)
    && integer(value.createdAtMs) && integer(value.updatedAtMs) && value.updatedAtMs >= value.createdAtMs
    && dayString(value.currentQuotaDay) && typeof value.pausedRequiresReview === 'boolean'
    && integer(value.pauseEpoch, 1) && id(value.pauseReason), invalid);
  for (const [name, maximum] of [['days',policy.maxDayRecords],['reservations',policy.maxReservationRecords],
    ['approvals',policy.maxApprovalRecords],['settlements',policy.maxSettlementRecords],['observations',policy.maxObservationRecords]])
    check(Array.isArray(value[name]) && value[name].length <= maximum, invalid);
  check(value.days.length > 0 && unique(value.days.map(day => day.quotaDay))
    && value.days.some(day => day.quotaDay === value.currentQuotaDay), invalid);
  for (const day of value.days) {
    check(keys(day,['quotaDay','measurement','maximumObservedReadCount','approvalId']) && dayString(day.quotaDay)
      && day.quotaDay <= value.currentQuotaDay && integer(day.maximumObservedReadCount)
      && (day.approvalId === null || id(day.approvalId)), invalid);
    const measurement = day.measurement;
    if (measurement === null) check(day.maximumObservedReadCount === 0, invalid);
    else check(keys(measurement,['metric','totalReadCount','measurementTimeMs','pointTimeMs','observationId','observationHash']) && METRICS.includes(measurement.metric)
      && integer(measurement.totalReadCount) && measurement.totalReadCount === day.maximumObservedReadCount
      && integer(measurement.measurementTimeMs) && measurement.measurementTimeMs <= value.updatedAtMs
      && quotaDay(measurement.measurementTimeMs) === day.quotaDay && measurement.pointTimeMs === measurement.measurementTimeMs
      && id(measurement.observationId) && /^[a-f0-9]{64}$/.test(measurement.observationHash)
      && value.observations.some(observation => observation.observationId === measurement.observationId
        && observation.observationHash===measurement.observationHash && observation.pointTimeMs===measurement.pointTimeMs
        && observation.quotaDay===day.quotaDay && observation.requestHash===hash({projectId:project,quotaDay:day.quotaDay,
          ...measurement,metricsComplete:true})), invalid);
  }
  check(unique(value.approvals.map(approval => approval.approvalId)), invalid);
  for (const approval of value.approvals) check(keys(approval,['approvalId','quotaDay','pauseEpoch','approvedAtMs','policyHash'])
    && id(approval.approvalId) && dayString(approval.quotaDay) && integer(approval.pauseEpoch,1)
    && approval.pauseEpoch <= value.pauseEpoch && integer(approval.approvedAtMs)
    && quotaDay(approval.approvedAtMs) === approval.quotaDay && approval.approvedAtMs <= value.updatedAtMs
    && approval.policyHash === policyHash && value.days.some(day=>day.quotaDay===approval.quotaDay), invalid);
  for (const day of value.days) if (day.approvalId !== null)
    check(value.approvals.some(approval => approval.approvalId === day.approvalId && approval.quotaDay === day.quotaDay), invalid);
  if (!value.pausedRequiresReview) check(value.days.find(day => day.quotaDay === value.currentQuotaDay).measurement !== null && value.approvals.some(approval =>
    approval.approvalId === value.days.find(day => day.quotaDay === value.currentQuotaDay).approvalId
    && approval.quotaDay === value.currentQuotaDay && approval.pauseEpoch === value.pauseEpoch), invalid);
  check(unique(value.reservations.map(reservation => reservation.reservationId)), invalid);
  for (const reservation of value.reservations) {
    check(keys(reservation,['reservationId','requestHash','operation','maximumReads','quotaDay','createdAtMs','expiresAtMs','state','completedAtMs'])
      && id(reservation.reservationId) && /^[a-f0-9]{64}$/.test(reservation.requestHash)
      && OPERATIONS[reservation.operation] === project
      && integer(reservation.maximumReads,1) && reservation.maximumReads === policy.operationReadBounds[reservation.operation]
      && dayString(reservation.quotaDay) && reservation.quotaDay <= value.currentQuotaDay
      && value.days.some(day=>day.quotaDay===reservation.quotaDay)
      && integer(reservation.createdAtMs) && reservation.createdAtMs <= value.updatedAtMs && quotaDay(reservation.createdAtMs) === reservation.quotaDay
      && integer(reservation.expiresAtMs) && reservation.expiresAtMs > reservation.createdAtMs
      && reservation.expiresAtMs - reservation.createdAtMs <= policy.reservationTtlMs
      && quotaDay(reservation.expiresAtMs - 1) === reservation.quotaDay
      && ['reserved','unknown','consumed'].includes(reservation.state), invalid);
    if (reservation.state === 'consumed') check(integer(reservation.completedAtMs)
      && reservation.completedAtMs >= reservation.createdAtMs && reservation.completedAtMs <= value.updatedAtMs, invalid);
    else check(reservation.completedAtMs === null, invalid);
  }
  check(unique(value.settlements.map(settlement => settlement.settlementId)), invalid);
  for (const settlement of value.settlements) check(keys(settlement,['settlementId','reservationId','requestHash','recordedAtMs','outcome','completedAtMs'])
    && id(settlement.settlementId) && id(settlement.reservationId) && /^[a-f0-9]{64}$/.test(settlement.requestHash)
    && integer(settlement.recordedAtMs) && settlement.recordedAtMs <= value.updatedAtMs
    && ['unknown','consumed'].includes(settlement.outcome)
    && (settlement.outcome==='consumed' ? integer(settlement.completedAtMs) && settlement.completedAtMs<=settlement.recordedAtMs : settlement.completedAtMs===null)
    && settlement.requestHash===hash({projectId:project,reservationId:settlement.reservationId,settlementId:settlement.settlementId,
      outcome:settlement.outcome,completedAtMs:settlement.completedAtMs})
    && value.reservations.some(reservation => reservation.reservationId === settlement.reservationId
      && settlement.recordedAtMs>=reservation.createdAtMs
      && (settlement.outcome!=='consumed' || settlement.completedAtMs>=reservation.createdAtMs)), invalid);
  for(const reservation of value.reservations) {
    const history=value.settlements.filter(settlement=>settlement.reservationId===reservation.reservationId);
    if(history.length===0)check(reservation.state==='reserved',invalid);
    else check(reservation.state===history.at(-1).outcome && reservation.completedAtMs===history.at(-1).completedAtMs
      && history.every((entry,index)=>index===0 || entry.recordedAtMs>=history[index-1].recordedAtMs)
      && history.filter(entry=>entry.outcome==='consumed').length===(reservation.state==='consumed'?1:0),invalid);
  }
  check(unique(value.observations.map(observation => observation.observationId)), invalid);
  for (const observation of value.observations) check(keys(observation,['observationId','requestHash','observationHash','pointTimeMs','quotaDay'])
    && id(observation.observationId) && /^[a-f0-9]{64}$/.test(observation.requestHash) && /^[a-f0-9]{64}$/.test(observation.observationHash)
    && integer(observation.pointTimeMs) && observation.pointTimeMs <= value.updatedAtMs
    && dayString(observation.quotaDay) && quotaDay(observation.pointTimeMs) === observation.quotaDay
    && value.days.some(day=>day.quotaDay===observation.quotaDay), invalid);
  return copy(value);
}
const pause = (state, code) => {
  if (!state.pausedRequiresReview) state.pauseEpoch++;
  state.pausedRequiresReview = true; state.pauseReason = code;
};
const ensureDay = (state, day, policy) => {
  if (state.currentQuotaDay === day) return true;
  check(day > state.currentQuotaDay, 'LEDGER_CLOCK_REGRESSED');
  if (state.days.length >= policy.maxDayRecords) { pause(state,'LEDGER_DAY_CAPACITY_EXCEEDED'); return false; }
  pause(state,'LEDGER_NEW_DAY_REVIEW_REQUIRED'); state.days.push(dayRecord(day)); state.currentQuotaDay = day;
  return true;
};
function accounting(state, day) {
  let outstandingReservedReads = 0, unreportedConsumedReads = 0;
  for (const reservation of state.reservations) {
    if (reservation.quotaDay > day) continue;
    if (reservation.state !== 'consumed') outstandingReservedReads += reservation.maximumReads;
    else if (quotaDay(reservation.completedAtMs) >= day) unreportedConsumedReads += reservation.maximumReads;
  }
  check(integer(outstandingReservedReads) && integer(unreportedConsumedReads), 'LEDGER_ACCOUNTING_INVALID');
  return {outstandingReservedReads, unreportedConsumedReads};
}
const statusValue = (state, policy) => {
  const day = state.days.find(value => value.quotaDay === state.currentQuotaDay), counters = accounting(state,state.currentQuotaDay);
  return {schemaVersion:1, projectId:state.projectId, revision:state.revision, policyHash:state.policyHash,
    quotaDay:state.currentQuotaDay, dailyLimit:state.dailyLimit, quotaTimezone:ZONE, pausedRequiresReview:state.pausedRequiresReview,
    pauseEpoch:state.pauseEpoch, pauseReason:state.pauseReason, measurement:copy(day.measurement),
    ...counters, applicationReserveReads:policy.applicationReserveReads, metricLagReserveReads:policy.metricLagReserveReads,
    reservationRecords:state.reservations.length, approvalRecords:state.approvals.length, settlementRecords:state.settlements.length,
    observationRecords:state.observations.length};
};
const measurementIssue = (day, time, policy) => !day.measurement ? 'LEDGER_MEASUREMENT_REQUIRED'
  : quotaDay(day.measurement.measurementTimeMs) !== quotaDay(time) || time - day.measurement.measurementTimeMs > policy.maxMeasurementAgeMs
    ? 'LEDGER_MEASUREMENT_STALE' : null;

/**
 * Privileged local core only. The store must atomically commit a synchronous
 * transform and return its cloned result after commit. No network or defaults.
 */
export function createManagementBudgetLedger({enabled=false, store, policy:suppliedPolicy, clock=Date.now,
  newReservationId=randomUUID, authorizeHumanReview, authorizeMeasurement}={}) {
  if (enabled !== true) return Object.freeze({enabled:false});
  const policy = policyValue(suppliedPolicy), policyHashes = Object.freeze(Object.fromEntries(PROJECTS.map(project=>[project,hash(scopedPolicy(policy,project))])));
  check(typeof store?.transact === 'function' && typeof clock === 'function' && typeof newReservationId === 'function', 'LEDGER_STORE_REQUIRED');
  check(typeof authorizeMeasurement==='function','LEDGER_MEASUREMENT_AUTHORITY_REQUIRED');
  const now = () => { const time = clock(); check(integer(time) && Number.isFinite(new Date(time).getTime()),'LEDGER_CLOCK_INVALID'); return time; };
  async function boundedCall(work, context={}) {
    const start=now(), deadline=Math.min(start+policy.transactionTimeoutMs, context.deadlineMs ?? Infinity);
    check(integer(deadline) && deadline>start && context.signal?.aborted!==true,'LEDGER_OPERATION_CANCELLED');
    const wallDeadline=performance.now()+deadline-start, controller=new AbortController();
    let timer, abort;
    const assertLive=()=>check(!controller.signal.aborted && now()<deadline && performance.now()<wallDeadline,'LEDGER_OPERATION_CANCELLED');
    try {
      const cancelled=new Promise((_,reject)=>{
        abort=()=>{controller.abort();reject(new LedgerDenial('LEDGER_OPERATION_CANCELLED'));};
        context.signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(abort,Math.max(1,Math.ceil(deadline-start)));
      });
      const result=await Promise.race([Promise.resolve().then(()=>{assertLive();return work({signal:controller.signal,deadlineMs:deadline},assertLive);}),cancelled]);
      assertLive(); return result;
    } catch(error) { if(error instanceof LedgerDenial) throw error; throw new LedgerDenial('LEDGER_STORAGE_UNAVAILABLE'); }
    finally {clearTimeout(timer);context.signal?.removeEventListener('abort',abort);}
  }
  async function transaction(project, transition, context={}) {
    projectId(project);
    const policyHash=policyHashes[project];
    let expected;
    const result=await boundedCall((storeContext,assertLive)=>store.transact(project,current=>{
      assertLive();
      const time=now(), day=quotaDay(time), original=current===null ? null : validateState(current,project,policy,policyHash);
      const state=original===null ? freshState(project,day,time,policyHash,policy.dailyLimits[project]) : copy(original);
      check(time>=state.updatedAtMs,'LEDGER_CLOCK_REGRESSED');
      const usableDay=ensureDay(state,day,policy);
      const result=transition(state,time,usableDay);
      const changed=original===null || canonical(state)!==canonical(original);
      if(changed){state.revision++;state.updatedAtMs=time;}
      validateState(state,project,policy,policyHash);
      expected=copy(typeof result==='function' ? result(state) : result);
      return {state:copy(state),result:copy(expected)};
    },storeContext),context);
    check(expected!==undefined && canonical(result)===canonical(expected),'LEDGER_COMMIT_UNCONFIRMED');
    return Object.freeze(copy(result));
  }
  const failed = code => ({ok:false,code});
  const status = async ({projectId:project},context={}) => transaction(project,(state,time,usableDay)=>{
    if(usableDay){const issue=measurementIssue(state.days.find(day=>day.quotaDay===state.currentQuotaDay),time,policy);if(issue)pause(state,issue);}
    return committed=>statusValue(committed,policy);
  },context);
  const recordMeasurement = async (supplied,{measurementContext,...context}={}) => {
    const measurement=inputSnapshot(supplied,'LEDGER_MEASUREMENT_INCOMPLETE');
    projectId(measurement?.projectId);
    let authorized;
    try {authorized=await boundedCall(ctx=>authorizeMeasurement(copy(measurement),measurementContext,ctx),context);}
    catch {
      // Failure-only cleanup: a fresh bounded storage call may persist the stop;
      // it never admits reads or extends measurement/review authorization.
      return transaction(measurement.projectId,state=>{pause(state,'LEDGER_MEASUREMENT_UNAVAILABLE');
        return failed('LEDGER_MEASUREMENT_UNAVAILABLE');});
    }
    return transaction(measurement.projectId,(state,time,usableDay)=>{
      if(!usableDay)return failed('LEDGER_DAY_CAPACITY_EXCEEDED');
      const day=state.days.find(day=>day.quotaDay===state.currentQuotaDay);
      let issue;
      if(authorized!==true) issue='LEDGER_MEASUREMENT_AUTHORITY_INVALID';
      else if(!keys(measurement,['projectId','quotaDay','metric','totalReadCount','measurementTimeMs','metricsComplete','pointTimeMs','observationId','observationHash'])
        || measurement.quotaDay!==quotaDay(time) || !METRICS.includes(measurement.metric)
        || !integer(measurement.totalReadCount) || !integer(measurement.measurementTimeMs)
        || measurement.metricsComplete!==true || measurement.pointTimeMs!==measurement.measurementTimeMs
        || !id(measurement.observationId) || !/^[a-f0-9]{64}$/.test(measurement.observationHash)) issue='LEDGER_MEASUREMENT_INCOMPLETE';
      else if(measurement.measurementTimeMs>time || quotaDay(measurement.measurementTimeMs)!==measurement.quotaDay
        || time-measurement.measurementTimeMs>policy.maxMeasurementAgeMs) issue='LEDGER_MEASUREMENT_STALE';
      else if(day.measurement && measurement.metric!==day.measurement.metric) issue='LEDGER_METRIC_CHANGED';
      else if(measurement.totalReadCount<day.maximumObservedReadCount || day.measurement && measurement.measurementTimeMs<day.measurement.measurementTimeMs)
        issue='LEDGER_MEASUREMENT_REGRESSED';
      const observation=state.observations.find(value=>value.observationId===measurement.observationId);
      if(!issue && observation && observation.requestHash!==hash(measurement))issue='LEDGER_OBSERVATION_REPLAY_CONFLICT';
      if(!issue && !observation && state.observations.length>=policy.maxObservationRecords)issue='LEDGER_OBSERVATION_CAPACITY_EXCEEDED';
      if(issue){pause(state,issue);return failed(issue);}
      if(!observation)state.observations.push({observationId:measurement.observationId,requestHash:hash(measurement),observationHash:measurement.observationHash,
        pointTimeMs:measurement.pointTimeMs,quotaDay:measurement.quotaDay});
      day.measurement={metric:measurement.metric,totalReadCount:measurement.totalReadCount,measurementTimeMs:measurement.measurementTimeMs,
        pointTimeMs:measurement.pointTimeMs,observationId:measurement.observationId,observationHash:measurement.observationHash};
      day.maximumObservedReadCount=measurement.totalReadCount;
      const counters=accounting(state,state.currentQuotaDay);
      if(measurement.totalReadCount+counters.outstandingReservedReads+counters.unreportedConsumedReads
        +policy.applicationReserveReads+policy.metricLagReserveReads>=state.dailyLimit) pause(state,'LEDGER_MARGIN_EXHAUSTED');
      return committed=>({ok:true,...statusValue(committed,policy)});
    },context);
  };
  const reviewPause = async (supplied,{approvalContext,...context}={}) => {
    const review=inputSnapshot(supplied,'LEDGER_REVIEW_INVALID');
    projectId(review?.projectId);
    check(keys(review,['projectId','quotaDay','dailyLimit','expectedPolicyHash','expectedPauseEpoch','expectedRevision','approvalId','approvedAtMs','decision'])
      && review.decision==='continue' && dayString(review.quotaDay) && review.dailyLimit===policy.dailyLimits[review.projectId]
      && review.expectedPolicyHash===policyHashes[review.projectId] && integer(review.expectedPauseEpoch,1)
      && integer(review.expectedRevision,1) && id(review.approvalId) && integer(review.approvedAtMs),'LEDGER_REVIEW_INVALID');
    check(typeof authorizeHumanReview==='function','LEDGER_HUMAN_AUTHORIZER_REQUIRED');
    const authorized=await boundedCall(ctx=>authorizeHumanReview(copy(review),approvalContext,ctx),context);
    check(authorized===true,'LEDGER_HUMAN_APPROVAL_REQUIRED');
    return transaction(review.projectId,(state,time,usableDay)=>{
      if(!usableDay)return failed('LEDGER_DAY_CAPACITY_EXCEEDED');
      if(state.approvals.some(approval=>approval.approvalId===review.approvalId))return failed('LEDGER_APPROVAL_REUSED');
      if(review.quotaDay!==state.currentQuotaDay || review.expectedPauseEpoch!==state.pauseEpoch
        || review.expectedRevision!==state.revision || review.approvedAtMs>time
        || quotaDay(review.approvedAtMs)!==review.quotaDay || time-review.approvedAtMs>policy.maxApprovalAgeMs)
        return failed('LEDGER_REVIEW_CONTEXT_CHANGED');
      const day=state.days.find(day=>day.quotaDay===state.currentQuotaDay),issue=measurementIssue(day,time,policy),counters=accounting(state,state.currentQuotaDay);
      if(issue){pause(state,issue);return failed(issue);}
      if(state.approvals.length>=policy.maxApprovalRecords){pause(state,'LEDGER_APPROVAL_CAPACITY_EXCEEDED');return failed(state.pauseReason);}
      if(day.measurement.totalReadCount+counters.outstandingReservedReads+counters.unreportedConsumedReads
        +policy.applicationReserveReads+policy.metricLagReserveReads>=state.dailyLimit){pause(state,'LEDGER_MARGIN_EXHAUSTED');return failed(state.pauseReason);}
      state.approvals.push({approvalId:review.approvalId,quotaDay:review.quotaDay,pauseEpoch:state.pauseEpoch,approvedAtMs:review.approvedAtMs,policyHash:policyHashes[review.projectId]});
      day.approvalId=review.approvalId;state.pausedRequiresReview=false;state.pauseReason='LEDGER_HUMAN_APPROVED';
      return committed=>({ok:true,...statusValue(committed,policy)});
    },context);
  };
  const reserveFirestoreReads = async (supplied,context={}) => {
    const request=inputSnapshot(supplied,'LEDGER_RESERVATION_REQUEST_INVALID');
    projectId(request?.projectId);
    check(keys(request,['projectId','operation','maximumReads','dailyLimit','quotaTimezone','quotaDay','applicationReserveReads','metricLagReserveReads'])
      && OPERATIONS[request.operation]===request.projectId && integer(request.maximumReads,1) && request.maximumReads===policy.operationReadBounds[request.operation]
      && request.dailyLimit===policy.dailyLimits[request.projectId] && request.quotaTimezone===ZONE && dayString(request.quotaDay)
      && integer(request.applicationReserveReads,policy.applicationReserveReads)
      && integer(request.metricLagReserveReads,policy.metricLagReserveReads),'LEDGER_RESERVATION_REQUEST_INVALID');
    const reservationId=newReservationId();check(id(reservationId),'LEDGER_RESERVATION_ID_INVALID');
    let reservationWallDeadline;
    const result=await transaction(request.projectId,(state,time,usableDay)=>{
      if(!usableDay)return failed('LEDGER_DAY_CAPACITY_EXCEEDED');
      if(request.quotaDay!==state.currentQuotaDay)return failed('LEDGER_REQUEST_DAY_CHANGED');
      const day=state.days.find(day=>day.quotaDay===state.currentQuotaDay),issue=measurementIssue(day,time,policy);
      if(issue){pause(state,issue);return failed(issue);}
      if(state.pausedRequiresReview)return failed('LEDGER_HUMAN_REVIEW_REQUIRED');
      if(state.reservations.some(reservation=>reservation.reservationId===reservationId)){
        pause(state,'LEDGER_RESERVATION_REUSED');return failed(state.pauseReason);
      }
      if(state.reservations.length>=policy.maxReservationRecords){pause(state,'LEDGER_RESERVATION_CAPACITY_EXCEEDED');return failed(state.pauseReason);}
      const counters=accounting(state,state.currentQuotaDay);
      if(day.measurement.totalReadCount+counters.outstandingReservedReads+counters.unreportedConsumedReads+request.maximumReads
        +request.applicationReserveReads+request.metricLagReserveReads>=state.dailyLimit){pause(state,'LEDGER_MARGIN_EXHAUSTED');return failed(state.pauseReason);}
      const expiresAtMs=Math.min(time+policy.reservationTtlMs,context.deadlineMs ?? Infinity,dayEnd(time));
      if(!(expiresAtMs>time))return failed('LEDGER_OPERATION_CANCELLED');
      reservationWallDeadline=performance.now()+expiresAtMs-time;
      state.reservations.push({reservationId,requestHash:hash(request),operation:request.operation,maximumReads:request.maximumReads,
        quotaDay:state.currentQuotaDay,createdAtMs:time,expiresAtMs,state:'reserved',completedAtMs:null});
      const after=accounting(state,state.currentQuotaDay);
      return committed=>({schemaVersion:1,projectId:request.projectId,operation:request.operation,reservationId,
        quotaDay:committed.currentQuotaDay,quotaTimezone:ZONE,dailyLimit:committed.dailyLimit,pausedRequiresReview:false,metricsComplete:true,
        measurementTimeMs:day.measurement.measurementTimeMs,expiresAtMs,reservedReads:request.maximumReads,
        totalReadCount:day.measurement.totalReadCount,...after,applicationReserveReads:request.applicationReserveReads,
        metricLagReserveReads:request.metricLagReserveReads});
    },context);
    if(result.ok===false)throw new LedgerDenial(result.code);
    check(result.expiresAtMs>now() && result.quotaDay===quotaDay(now()) && performance.now()<reservationWallDeadline,'LEDGER_RECEIPT_EXPIRED');
    return result;
  };
  const settleReservation = async (supplied,context={}) => {
    const settlement=inputSnapshot(supplied,'LEDGER_SETTLEMENT_INVALID');
    projectId(settlement?.projectId);
    check(keys(settlement,['projectId','reservationId','settlementId','outcome','completedAtMs']) && id(settlement.reservationId)
      && id(settlement.settlementId) && ['unknown','consumed'].includes(settlement.outcome)
      && (settlement.outcome==='consumed' ? integer(settlement.completedAtMs) : settlement.completedAtMs===null),'LEDGER_SETTLEMENT_INVALID');
    return transaction(settlement.projectId,(state,time)=>{
      const requestHash=hash(settlement),prior=state.settlements.find(value=>value.settlementId===settlement.settlementId);
      if(prior)return prior.requestHash===requestHash ? {ok:true,alreadySettled:true} : failed('LEDGER_SETTLEMENT_REPLAY_CONFLICT');
      const reservation=state.reservations.find(value=>value.reservationId===settlement.reservationId);
      if(!reservation)return failed('LEDGER_RESERVATION_UNKNOWN');
      if(state.settlements.length>=policy.maxSettlementRecords){pause(state,'LEDGER_SETTLEMENT_CAPACITY_EXCEEDED');return failed(state.pauseReason);}
      if(reservation.state==='consumed' || settlement.outcome==='consumed'
        && (settlement.completedAtMs<reservation.createdAtMs || settlement.completedAtMs>time))
        return failed('LEDGER_SETTLEMENT_CONFLICT');
      reservation.state=settlement.outcome;reservation.completedAtMs=settlement.completedAtMs;
      state.settlements.push({settlementId:settlement.settlementId,reservationId:settlement.reservationId,
        requestHash,recordedAtMs:time,outcome:settlement.outcome,completedAtMs:settlement.completedAtMs});
      return committed=>({ok:true,alreadySettled:false,...statusValue(committed,policy)});
    },context);
  };
  return Object.freeze({enabled:true,policyHashes,status,recordMeasurement,reviewPause,reserveFirestoreReads,settleReservation});
}
