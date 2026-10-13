import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, basename} from 'node:path';
import {readFile, writeFile, lstat, open, rename, unlink} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {captureFirestoreSnapshot, validateFirestoreCaptureResume} from './lib/firestore-snapshot-capture.js';
import {prepareManagementCaptureQuarterPlan, validateManagementCaptureQuarterPlan, parseManagementCaptureCommand} from './lib/management-capture-quarter-plan.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {beginManagementCaptureQuarterHead, advanceManagementCaptureQuarterHead, validateManagementRemainingQuarterAuthorization, requiresManagementRemainingQuarterAuthorization} from './lib/management-capture-quarter-head.js';
import {readManagementCaptureQuarterHead, persistManagementCaptureQuarterHead, listManagementCaptureQuarterCheckpoints} from './lib/management-capture-quarter-head-store.js';
import {assessManagementReadBudget, firestoreQuotaDayStart, describeManagementReadObservation} from './lib/management-read-budget.js';
import {createPrivateJsonProtector, openPrivateJson} from './lib/windows-protected-json.js';
import {assessFbBootstrapReadBudget, fbBootstrapCaptureConfiguration, finishFbBootstrapReadBudget} from './lib/management-fb-bootstrap-budget.js';
const projects = {FA: {id: 'sahmt-17a16', principal: process.env.SAHMT_FA_CAPTURE_PRINCIPAL || 'fa-owner@example.invalid'}, FB: {id: 'sahmt-gestao-5ae66', principal: process.env.SAHMT_FB_CAPTURE_PRINCIPAL || 'fb-owner@example.invalid'}};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), directory = resolve(root, '.local-preview/management-split');
const parse = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe = error => /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'CAPTURE_PREPARATION_OR_IO_FAILED';
const legacyPath = 'C:/Users/SAHMTIA/.codex/worktrees/training-activities-groups/FIRESTORE/.local-preview/release-catalog/daily-read-policy.json';
let bootstrapActive = false, descriptor = null, lockPath = null, activePolicyPath = null, activeProjectId = null, budgetFailureCode = null, policyTail = Promise.resolve(), checkpointTail = Promise.resolve(), retainLock = false, captureEntered = false;
const pauseCodes = new Set(['MANUAL_SOURCE_USAGE_HUMAN_REPORT_INVALID_OR_EXPIRED', 'MANUAL_SOURCE_USAGE_REVIEW_INVALID_OR_EXPIRED', 'MANAGEMENT_READ_METRIC_STALE_OR_INCOMPLETE', 'MANAGEMENT_DAILY_LIMIT_OR_MARGIN', 'MANAGEMENT_CAPTURE_RESERVE_LIMIT', 'MANAGEMENT_READ_OBSERVATION_UNAVAILABLE', 'MANAGEMENT_READ_RESERVATION_DAY_REVIEW_REQUIRED', 'BACKUP_DECISION_NOT_FOR_CURRENT_DAY']);
const serializePolicy = operation => {
  const result = policyTail.then(operation); policyTail = result.catch(() => {}); return result;
};
async function storePolicy(value, signal) {
  if (signal?.aborted) throw Error('READ_RESERVATION_ABORTED');
  const temporary = activePolicyPath + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600, ...(signal ? {signal} : {})});
    if (signal?.aborted) throw Error('READ_RESERVATION_ABORTED');
    await rename(temporary, activePolicyPath);
  } finally { try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
async function persistPause(reason) {
  if (!activePolicyPath || !activeProjectId || !descriptor) return false;
  const persisted = await serializePolicy(async () => {
    try {
      const value = await parse(activePolicyPath);
      if (bootstrapActive) {
        const closed = finishFbBootstrapReadBudget({projectId: activeProjectId, policy: value, nowMs: Date.now(), status: 'INCOMPLETE'});
        closed.failureCode = reason; await storePolicy(closed); return true;
      }
      if (value.schemaVersion !== 1 || value.projectId !== activeProjectId || (value.dailyReadLimit !== 35000 && !(activeProjectId === 'sahmt-17a16' && value.dailyReadLimit === 45000 && value.limitApprovalEvidence === 'USER_FA_DAILY_LIMIT_45000_2026_10_08'))) return false;
      value.pausedRequiresReview = true; value.pauseReason = reason;
      await storePolicy(value);
      return true;
    } catch { return false; }
  });
  if (!persisted) retainLock = true;
  return persisted;
}
try {
  const {reference, mode, quarterCapture, resumeCheckpointName} = parseManagementCaptureCommand(process.argv.slice(2));
  const target = projects[reference];
  bootstrapActive = mode === '--capture-initial-fb';
  if (bootstrapActive && reference !== 'FB') throw Error('BOOTSTRAP_ALLOWED_ONLY_FOR_FB');
  for (const path of [resolve(root, '.local-preview'), directory]) if ((await lstat(path)).isSymbolicLink()) throw Error('PRIVATE_OUTPUT_LINK_FORBIDDEN');
  if (!(await readFile(resolve(root, '.gitignore'), 'utf8')).split(/\r?\n/).includes('.local-preview/')) throw Error('PRIVATE_OUTPUT_NOT_IGNORED');
  lockPath = resolve(directory, 'backup-read-' + reference + '.lock');
  try { descriptor = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw Error('MANAGEMENT_CAPTURE_LOCK_PRESENT_REQUIRES_REVIEW'); throw error; }
  const policyPath = resolve(directory, bootstrapActive ? 'bootstrap-read-policy-FB.json' : 'backup-read-policy-' + reference + '.json');
  activePolicyPath = policyPath; activeProjectId = target.id;
  const scope = await parse(resolve(directory, 'backup-scope-' + reference + '.json'));
  if (scope.schemaVersion !== 1 || scope.projectId !== target.id || scope.databaseId !== '(default)' || !Array.isArray(scope.rootCollections) || !scope.rootCollections.length) throw Error('BACKUP_SCOPE_INVALID');
  const policy = await parse(policyPath);
  const observationPath = resolve(directory, reference === 'FA' ? 'daily-read-observation.json' : 'daily-read-observation-FB.json');
  const readObservation = async () => { try { return await parse(observationPath); } catch { throw Error('MANAGEMENT_READ_OBSERVATION_UNAVAILABLE'); } };
  const legacyReserve = async nowMs => {
    if (reference !== 'FA') return 0;
    const legacy = await parse(legacyPath);
    if (legacy.schemaVersion !== 1 || legacy.project !== target.id || legacy.dailyReadLimit !== 35000) throw Error('LEGACY_RESERVATION_POLICY_INVALID');
    const reserved = legacy.reservationQuotaDayStart === firestoreQuotaDayStart(nowMs) ? legacy.reservedCheckReads : 0;
    if (!Number.isSafeInteger(reserved) || reserved < 0) throw Error('LEGACY_RESERVATION_POLICY_INVALID');
    return reserved;
  };
  // This first check occurs before credential lookup, protection and any API call.
  const initial = bootstrapActive
    ? assessFbBootstrapReadBudget({projectId: target.id, scope, policy, nowMs: Date.now()})
    : assessManagementReadBudget({projectId: target.id, nowMs: Date.now(), observation: await readObservation(), policy, maximumReads: reference === 'FA' ? 25 : 100, legacyReservedReads: await legacyReserve(Date.now())});
  if (mode === '--preflight') {
    console.log(JSON.stringify({mode: 'LOCAL_CAPTURE_PREFLIGHT', projectId: target.id, scopeRootCount: scope.rootCollections.length, captureMode: reference === 'FA' ? 'ONE_MANUAL_QUARTER' : mode, eligibleForCapture: true, budget: initial, firestoreDocumentReadsIssued: 0}));
  } else {
    captureEntered = true;
    const protector = await createPrivateJsonProtector();
    const probe = protector.seal({purpose: 'FIRESTORE_BACKUP_PROTECTION_PROBE'});
    if ((await openPrivateJson(probe)).purpose !== 'FIRESTORE_BACKUP_PROTECTION_PROBE') throw Error('PROTECTION_PROBE_FAILED');
    const captureStamp = new Date().toISOString().replace(/[^0-9]/g, '');
    const checkpointPath = resolve(directory, 'capture-' + reference + '-' + captureStamp + '-latest.dpapi.json');
    let quarterPlan=null, resumeCoreState=null, resumeOptions={}, quarterHead=null, remainingAuthorization=null;
    const runId='capture-'+captureStamp+'-'+randomBytes(8).toString('hex');
    if (quarterCapture) {
      const receipt=await parse(resolve(directory,'management-split-receipt-v2.json'));
      const baselinePath=resolve(directory,'capture-FA-20261009010412736-reviewed.dpapi.json');
      if ((await lstat(baselinePath)).isSymbolicLink()) throw Error('QUARTER_BASELINE_LINK_FORBIDDEN');
      const baselinePacket=await openPrivateJson(await parse(baselinePath));
      quarterPlan=prepareManagementCaptureQuarterPlan({sourceSnapshot:baselinePacket.snapshot,scope});
      if (quarterPlan.baselineSnapshotSha256!==receipt.sourceSnapshotSha256) throw Error('QUARTER_BASELINE_REVIEW_PIN_MISMATCH');
      if(!resumeCheckpointName&&requiresManagementRemainingQuarterAuthorization(policy))
        throw Error('QUARTER_REMAINING_REQUIRES_EXISTING_SEQUENCE_RESUME');
      quarterHead=await readManagementCaptureQuarterHead({directory});
      if (!resumeCheckpointName && quarterHead===null) {
        const inventory=await listManagementCaptureQuarterCheckpoints({directory,openPrivateJson});
        if(inventory.length)throw Error('QUARTER_HEAD_MISSING_REQUIRES_ADOPTION');
      }
      if (resumeCheckpointName) {
        if(quarterHead===null)throw Error('QUARTER_HEAD_MISSING_REQUIRES_ADOPTION');
        const savedPath=resolve(directory,resumeCheckpointName);
        if (basename(savedPath)!==resumeCheckpointName || (await lstat(savedPath)).isSymbolicLink()) throw Error('QUARTER_CHECKPOINT_LINK_FORBIDDEN');
        const saved=await openPrivateJson(await parse(savedPath));
        if (saved.schemaVersion!==1 || saved.kind!=='FIRESTORE_QUARTER_CHECKPOINT' || saved.projectId!==target.id
          || Object.keys(saved).length!==5 || !saved.coreState) throw Error('QUARTER_CHECKPOINT_INVALID');
        validateManagementCaptureQuarterPlan({plan:saved.quarterPlan,sourceSnapshot:baselinePacket.snapshot,scope});
        const reviewAt=Date.parse(policy.humanDecisionAt), stoppedAt=Date.parse(saved.coreState.finishedAt);
        if (!Number.isFinite(reviewAt) || !Number.isFinite(stoppedAt)
          || policy.pausedRequiresReview!==false || !policy.authorizationEvidence) throw Error('QUARTER_NEW_HUMAN_REVIEW_REQUIRED');
        if(requiresManagementRemainingQuarterAuthorization(policy)) {
          if(policy.dailyReadLimit!==45000||policy.authorizedPurpose!=='MANAGEMENT_BACKUP_ONLY'||policy.maximumCaptureReserve!==6000)
            throw Error('QUARTER_REMAINING_BUDGET_POLICY_CHANGED');
          remainingAuthorization=validateManagementRemainingQuarterAuthorization({authorizationEvidence:policy.authorizationEvidence,
            humanDecisionAt:policy.humanDecisionAt,head:quarterHead,plan:quarterPlan,nowMs:Date.now()});
        } else if(reviewAt<=stoppedAt)throw Error('QUARTER_NEW_HUMAN_REVIEW_REQUIRED');
        resumeCoreState=saved.coreState;
        const resumeStateSha256=snapshotDigest(resumeCoreState);
        resumeOptions={resumeState:resumeCoreState,resumeStateSha256,
          resumeReviewId:'human-review-'+snapshotDigest({humanDecisionAt:policy.humanDecisionAt,authorizationEvidence:policy.authorizationEvidence,resumeStateSha256})};
      }
    }
    const captureConfiguration = bootstrapActive
      ? fbBootstrapCaptureConfiguration({projectId: target.id, scope, policy, nowMs: Date.now()})
      : {projectId: target.id, databaseId: '(default)', rootCollections: scope.rootCollections,
          readTime: resumeCoreState?.readTime || new Date(Date.now() - 5000).toISOString(),
          pageSize: quarterCapture ? quarterPlan.documentPageSize : 100, collectionPageSize: 100,
          ...(quarterCapture ? {maxBatchDocuments:quarterPlan.maxBatchDocuments,maxBatches:quarterPlan.maxBatches,...resumeOptions} : {}),
          limits: {maxPages: 3000, maxDocuments: 6000, maxDepth: 30, maxBytes: 12 * 1024 * 1024, maxDurationMs: 180000, requestTimeoutMs: 20000}};
    if (resumeCoreState) validateFirestoreCaptureResume({...captureConfiguration,nowMs:Date.now()});
    if(quarterCapture) {
      const expectedHeadSha256=quarterHead?.headSha256 ?? null;
      const resumeCheckpoint=resumeCoreState ? {schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:target.id,quarterPlan,coreState:resumeCoreState,checkpointFile:resumeCheckpointName} : null;
      const {resumeState:ignoredResumeState,resumeStateSha256:ignoredResumeSha,resumeReviewId:ignoredReviewId,...headConfiguration}=captureConfiguration;
      const nextHead=beginManagementCaptureQuarterHead({head:quarterHead,expectedHeadSha256,plan:quarterPlan,runId,
        checkpointFile:basename(checkpointPath),readTime:captureConfiguration.readTime,nowMs:Date.now(),
        resumeCheckpoint,review:resumeCoreState ? {humanDecisionAt:policy.humanDecisionAt,authorizationEvidence:policy.authorizationEvidence} : null,
        captureConfiguration:resumeCoreState ? headConfiguration : null});
      try{await persistManagementCaptureQuarterHead({directory,lockDescriptor:descriptor,head:nextHead,expectedHeadSha256,plan:quarterPlan});}
      catch(error){retainLock=true;throw error;}
      quarterHead=nextHead;
    }
    const auth = createRequire(resolve(root, 'package.json'))('firebase-tools/lib/auth');
    const account = auth.getAllAccounts().find(value => value.user?.email === target.principal);
    if (!account?.tokens?.refresh_token) throw Error('EXPECTED_ACCOUNT_LOGIN_REQUIRED');
    const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
    if (!token.access_token || token.refresh_token !== account.tokens.refresh_token) throw Error('REFRESH_IDENTITY_NOT_PROVEN');
    let issuedAttempts = 0, batchReservedReads = 0;
    const checkpointAdapter = async (state, {signal}) => {
      const persist = async () => {
        if (signal.aborted) throw Error('CHECKPOINT_ABORTED');
        const checkpointValue = quarterCapture ? {schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:target.id,quarterPlan,coreState:state} : state;
        const bytes = JSON.stringify(protector.seal(checkpointValue)) + '\n';
        if (Buffer.byteLength(bytes) > 20 * 1024 * 1024) throw Error('CHECKPOINT_DISK_LIMIT');
        const temporary = checkpointPath + '.' + randomBytes(8).toString('hex') + '.tmp';
        try {
          await writeFile(temporary, bytes, {flag: 'wx', mode: 0o600, signal});
          if (signal.aborted) throw Error('CHECKPOINT_ABORTED');
          await rename(temporary, checkpointPath);
          if(quarterCapture) {
            const nextHead=advanceManagementCaptureQuarterHead({head:quarterHead,expectedHeadSha256:quarterHead.headSha256,
              plan:quarterPlan,checkpointFile:basename(checkpointPath),coreState:state,nowMs:Date.now()});
            await persistManagementCaptureQuarterHead({directory,lockDescriptor:descriptor,head:nextHead,
              expectedHeadSha256:quarterHead.headSha256,plan:quarterPlan,signal});
            quarterHead=nextHead;
          }
        } finally { try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      };
      const operation = checkpointTail.then(async()=>{try{await persist();}catch(error){if(quarterCapture)retainLock=true;throw error;}}); checkpointTail = operation.catch(() => {}); await operation;
    };
    const capture = await captureFirestoreSnapshot({
      ...captureConfiguration, clock: Date.now,
      reserveReads: async (reservation, {signal}) => {
        try {
          if(remainingAuthorization && ((resumeCoreState?.totalReservedReads||0)+batchReservedReads+reservation.maximumReads
            >remainingAuthorization.cumulativeReadReservationLimit||Date.now()>=Date.parse(remainingAuthorization.deadlineAt)))
            throw Error('QUARTER_REMAINING_RESERVE_OR_DEADLINE_REQUIRES_REVIEW');
          if (quarterCapture && batchReservedReads + reservation.maximumReads > quarterPlan.maxReservedReadsPerBatch)
            throw Error('QUARTER_READ_RESERVE_LIMIT_REQUIRES_REVIEW');
          return await serializePolicy(async () => {
            if (signal.aborted) throw Error('READ_RESERVATION_ABORTED');
            const value = await parse(policyPath), nowMs = Date.now();
            if(remainingAuthorization&&nowMs>=Date.parse(remainingAuthorization.deadlineAt))
              throw Error('QUARTER_REMAINING_RESERVE_OR_DEADLINE_REQUIRES_REVIEW');
            if(remainingAuthorization&&(value.dailyReadLimit!==45000||value.authorizedPurpose!=='MANAGEMENT_BACKUP_ONLY'
              ||value.maximumCaptureReserve!==6000||value.humanDecisionAt!==remainingAuthorization.sourceHumanDecisionAt
              ||snapshotDigest(value.authorizationEvidence)!==remainingAuthorization.authorizationSha256))
              throw Error('QUARTER_REMAINING_BUDGET_POLICY_CHANGED');
            if (bootstrapActive) {
              const decision = assessFbBootstrapReadBudget({projectId: target.id, scope, policy: value, nowMs, reservation});
              if (signal.aborted) throw Error('READ_RESERVATION_ABORTED');
              await storePolicy(decision.nextPolicy, signal); return {allowed: true};
            }
            const decision = assessManagementReadBudget({projectId: target.id, nowMs, observation: await readObservation(), policy: value, maximumReads: reservation.maximumReads, legacyReservedReads: await legacyReserve(nowMs)});
            if (signal.aborted) throw Error('READ_RESERVATION_ABORTED');
            value.reservedReads = decision.reservedReads;
            await storePolicy(value, signal);
            if (quarterCapture) batchReservedReads += reservation.maximumReads;
            return {allowed: true};
          });
        } catch (error) {
          budgetFailureCode = safe(error);
          await persistPause(budgetFailureCode);
          throw Error(budgetFailureCode);
        }
      },      transport: async (request, {signal}) => {
        const encodedParent = request.parent.split('/').map(encodeURIComponent).join('/');
        const uri = 'https://firestore.googleapis.com/v1/' + encodedParent;
        const url = request.operation === 'listDocuments' ? uri + '/' + encodeURIComponent(request.collectionId) + '?' + new URLSearchParams(request.query) : uri + ':listCollectionIds';
        const grantRemainingMs=remainingAuthorization?Date.parse(remainingAuthorization.deadlineAt)-Date.now():null;
        if(grantRemainingMs!==null&&grantRemainingMs<=0)throw Error('QUARTER_REMAINING_RESERVE_OR_DEADLINE_REQUIRES_REVIEW');
        const transportSignal=grantRemainingMs===null?signal:AbortSignal.any([signal,AbortSignal.timeout(grantRemainingMs)]);
        issuedAttempts++;
        const response = await fetch(url, {method: request.method, headers: {Authorization: 'Bearer ' + token.access_token, ...(request.body ? {'Content-Type': 'application/json'} : {})}, ...(request.body ? {body: JSON.stringify(request.body)} : {}), signal:transportSignal});
        if (!response.ok) throw Error('FIRESTORE_CAPTURE_HTTP_' + response.status);
        return response.json();
      },
      checkpoint: checkpointAdapter
    });
    if (bootstrapActive) {
      await serializePolicy(async () => {
        const value = await parse(policyPath);
        if (['AUTHORIZED','IN_PROGRESS'].includes(value.status))
          await storePolicy(finishFbBootstrapReadBudget({projectId: target.id, policy: value, nowMs: Date.now(), status: capture.status}));
      });
    } else if (quarterCapture) {
      const reason=capture.status==='PARTIAL_REVIEW' ? 'MANUAL_QUARTER_REVIEW_REQUIRED'
        : capture.status==='COMPLETE' ? 'MANUAL_QUARTER_COMPLETE_REVIEW_REQUIRED'
        : budgetFailureCode || capture.errorCode || 'CAPTURE_INCOMPLETE_REQUIRES_REVIEW';
      if (!(await persistPause(reason))) throw Error('QUARTER_REVIEW_PAUSE_NOT_PERSISTED');
    } else if (capture.status !== 'COMPLETE') await persistPause(budgetFailureCode || capture.errorCode || 'CAPTURE_INCOMPLETE_REQUIRES_REVIEW');
    await checkpointTail;
    // Publish the final core state after all timed-out adapter writes have drained.
    await checkpointAdapter(capture.state, {signal: AbortSignal.timeout(20000)});
    const readBudgetObservation = bootstrapActive ? {observationSource: 'EXPLICIT_BOUNDED_FB_INITIAL_BACKUP', totalUsageKnown: false, measuredTotalReads: null, exactGlobalCutoff: false} : describeManagementReadObservation(await readObservation());
    const packet = {readBudgetObservation, schemaVersion: 1, kind: 'FIRESTORE_SELECTED_SCOPE_CAPTURE', ...(bootstrapActive ? {bootstrapAuthorizationId: policy.authorizationId, bootstrapScopeSha256: policy.scopeSha256, totalUsageKnown: false, measuredTotalReads: null} : {}), projectId: target.id, status: capture.status, ...(quarterCapture ? {quarterPlan,checkpointFile:basename(checkpointPath)} : {}), snapshot: capture.snapshot, receipt: capture.receipt};
    const sealed = protector.seal(packet), bytes = JSON.stringify(sealed) + '\n';
    const filename = 'capture-' + reference + '-' + captureStamp + '.dpapi.json';
    await writeFile(resolve(directory, filename), bytes, {flag: 'wx', mode: 0o600});
    if (hash(await openPrivateJson(JSON.parse(await readFile(resolve(directory, filename), 'utf8')))) !== hash(packet)) throw Error('FIRESTORE_BACKUP_ROUNDTRIP_MISMATCH');
    const summary = {schemaVersion: 1, projectId: target.id, status: capture.status, errorCode: budgetFailureCode || capture.errorCode || null, file: filename,
      ciphertextSha256: createHash('sha256').update(bytes).digest('hex'), scopeRootCount: scope.rootCollections.length,
      ...(quarterCapture ? {manualQuarterCapture:true,maxBatchDocuments:quarterPlan.maxBatchDocuments,maxBatches:quarterPlan.maxBatches,
        capturedThisBatch: capture.state.documents.length-(resumeCoreState?.documents.length || 0),
        capturedCumulative:capture.state.documents.length,batchReservedReads,maxReservedReadsPerBatch:quarterPlan.maxReservedReadsPerBatch,checkpointFile:basename(checkpointPath),
        quarterPlanSha256:quarterPlan.planSha256,quarterHeadSha256:quarterHead.headSha256,quarterHeadRevision:quarterHead.revision,automaticNextBatch:false,requiresHumanReview:true,
        partialSnapshotEligibleForMigration:false} : {}),
      boundedInitialFbBackup: bootstrapActive, ...(bootstrapActive ? {bootstrapAuthorizationId: policy.authorizationId, bootstrapScopeSha256: policy.scopeSha256} : {}), ...readBudgetObservation,
      receiptSha256: capture.receipt.receiptSha256, snapshotSha256: capture.receipt.snapshotSha256 || null,
      counts: capture.receipt.counts, issuedAttempts, decryptAndHashVerified: true, lockRetainedRequiresReview: retainLock, firestoreWritesIssued: 0};
    await writeFile(resolve(directory, 'capture-' + reference + '-' + captureStamp + '-receipt.json'), JSON.stringify(summary, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify(summary));
    if (capture.status !== 'COMPLETE') process.exitCode = 2;
  }
} catch (error) {
  const errorCode = safe(error);
  const pausePersisted = pauseCodes.has(errorCode) || captureEntered ? await persistPause(errorCode) : false;
  console.error(JSON.stringify({errorCode, pausePersisted, lockRetainedRequiresReview: retainLock, firestoreWritesIssued: 0, productionMigrationExecuted: false})); process.exitCode = 1;
} finally {
  if (descriptor) {
    let previousPolicy, previousCheckpoint;
    do { previousPolicy = policyTail; previousCheckpoint = checkpointTail; await Promise.all([previousPolicy, previousCheckpoint]); } while (previousPolicy !== policyTail || previousCheckpoint !== checkpointTail);
    await descriptor.close();
    if (!retainLock) await unlink(lockPath);
  }
}
