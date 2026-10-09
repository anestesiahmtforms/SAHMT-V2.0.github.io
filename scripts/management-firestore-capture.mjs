import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {readFile, writeFile, lstat, open, rename, unlink} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {captureFirestoreSnapshot} from './lib/firestore-snapshot-capture.js';
import {assessManagementReadBudget, firestoreQuotaDayStart, describeManagementReadObservation} from './lib/management-read-budget.js';
import {createPrivateJsonProtector, openPrivateJson} from './lib/windows-protected-json.js';
import {assessFbBootstrapReadBudget, fbBootstrapCaptureConfiguration, finishFbBootstrapReadBudget} from './lib/management-fb-bootstrap-budget.js';
const projects = {FA: {id: 'sahmt-17a16', principal: 'anestesiahmtforms@gmail.com'}, FB: {id: 'sahmt-gestao-5ae66', principal: 'anestesiahmtforms2@gmail.com'}};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), directory = resolve(root, '.local-preview/management-split');
const parse = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe = error => /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'CAPTURE_PREPARATION_OR_IO_FAILED';
const legacyPath = 'C:/Users/SAHMTIA/.codex/worktrees/training-activities-groups/FIRESTORE/.local-preview/release-catalog/daily-read-policy.json';
let bootstrapActive = false, descriptor = null, lockPath = null, activePolicyPath = null, activeProjectId = null, budgetFailureCode = null, policyTail = Promise.resolve(), checkpointTail = Promise.resolve(), retainLock = false, captureEntered = false;
const pauseCodes = new Set(['MANUAL_SOURCE_USAGE_REVIEW_INVALID_OR_EXPIRED', 'MANAGEMENT_READ_METRIC_STALE_OR_INCOMPLETE', 'MANAGEMENT_DAILY_LIMIT_OR_MARGIN', 'MANAGEMENT_CAPTURE_RESERVE_LIMIT', 'MANAGEMENT_READ_OBSERVATION_UNAVAILABLE', 'MANAGEMENT_READ_RESERVATION_DAY_REVIEW_REQUIRED', 'BACKUP_DECISION_NOT_FOR_CURRENT_DAY']);
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
  const reference = process.argv[2], mode = process.argv[3], target = projects[reference];
  if (!target || !['--preflight', '--capture', '--capture-initial-fb'].includes(mode) || process.argv.length !== 4) throw Error('USE_FA_OR_FB_AND_PREFLIGHT_OR_CAPTURE');
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
    : assessManagementReadBudget({projectId: target.id, nowMs: Date.now(), observation: await readObservation(), policy, maximumReads: 100, legacyReservedReads: await legacyReserve(Date.now())});
  if (mode === '--preflight') {
    console.log(JSON.stringify({mode: 'LOCAL_CAPTURE_PREFLIGHT', projectId: target.id, scopeRootCount: scope.rootCollections.length, eligibleForCapture: true, budget: initial, firestoreDocumentReadsIssued: 0}));
  } else {
    captureEntered = true;
    const protector = await createPrivateJsonProtector();
    const probe = protector.seal({purpose: 'FIRESTORE_BACKUP_PROTECTION_PROBE'});
    if ((await openPrivateJson(probe)).purpose !== 'FIRESTORE_BACKUP_PROTECTION_PROBE') throw Error('PROTECTION_PROBE_FAILED');
    const auth = createRequire(resolve(root, 'package.json'))('firebase-tools/lib/auth');
    const account = auth.getAllAccounts().find(value => value.user?.email === target.principal);
    if (!account?.tokens?.refresh_token) throw Error('EXPECTED_ACCOUNT_LOGIN_REQUIRED');
    const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
    if (!token.access_token || token.refresh_token !== account.tokens.refresh_token) throw Error('REFRESH_IDENTITY_NOT_PROVEN');
    const captureStamp = new Date().toISOString().replace(/[^0-9]/g, '');
    let issuedAttempts = 0;
    const checkpointPath = resolve(directory, 'capture-' + reference + '-' + captureStamp + '-latest.dpapi.json');
    const checkpointAdapter = async (state, {signal}) => {
      const persist = async () => {
        if (signal.aborted) throw Error('CHECKPOINT_ABORTED');
        const bytes = JSON.stringify(protector.seal(state)) + '\n';
        if (Buffer.byteLength(bytes) > 20 * 1024 * 1024) throw Error('CHECKPOINT_DISK_LIMIT');
        const temporary = checkpointPath + '.' + randomBytes(8).toString('hex') + '.tmp';
        try {
          await writeFile(temporary, bytes, {flag: 'wx', mode: 0o600, signal});
          if (signal.aborted) throw Error('CHECKPOINT_ABORTED');
          await rename(temporary, checkpointPath);
        } finally { try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      };
      const operation = checkpointTail.then(persist); checkpointTail = operation.catch(() => {}); await operation;
    };
    const captureConfiguration = bootstrapActive
      ? fbBootstrapCaptureConfiguration({projectId: target.id, scope, policy, nowMs: Date.now()})
      : {projectId: target.id, databaseId: '(default)', rootCollections: scope.rootCollections,
          readTime: new Date(Date.now() - 5000).toISOString(), pageSize: 100, collectionPageSize: 100,
          limits: {maxPages: 3000, maxDocuments: 6000, maxDepth: 30, maxBytes: 12 * 1024 * 1024, maxDurationMs: 180000, requestTimeoutMs: 20000}};
    const capture = await captureFirestoreSnapshot({
      ...captureConfiguration, clock: Date.now,
      reserveReads: async (reservation, {signal}) => {
        try {
          return await serializePolicy(async () => {
            if (signal.aborted) throw Error('READ_RESERVATION_ABORTED');
            const value = await parse(policyPath), nowMs = Date.now();
            if (bootstrapActive) {
              const decision = assessFbBootstrapReadBudget({projectId: target.id, scope, policy: value, nowMs, reservation});
              if (signal.aborted) throw Error('READ_RESERVATION_ABORTED');
              await storePolicy(decision.nextPolicy, signal); return {allowed: true};
            }
            const decision = assessManagementReadBudget({projectId: target.id, nowMs, observation: await readObservation(), policy: value, maximumReads: reservation.maximumReads, legacyReservedReads: await legacyReserve(nowMs)});
            if (signal.aborted) throw Error('READ_RESERVATION_ABORTED');
            value.reservedReads = decision.reservedReads;
            await storePolicy(value, signal);
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
        issuedAttempts++;
        const response = await fetch(url, {method: request.method, headers: {Authorization: 'Bearer ' + token.access_token, ...(request.body ? {'Content-Type': 'application/json'} : {})}, ...(request.body ? {body: JSON.stringify(request.body)} : {}), signal});
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
    } else if (capture.status !== 'COMPLETE') await persistPause(budgetFailureCode || capture.errorCode || 'CAPTURE_INCOMPLETE_REQUIRES_REVIEW');
    await checkpointTail;
    // Publish the final core state after all timed-out adapter writes have drained.
    await checkpointAdapter(capture.state, {signal: AbortSignal.timeout(20000)});
    const readBudgetObservation = bootstrapActive ? {observationSource: 'EXPLICIT_BOUNDED_FB_INITIAL_BACKUP', totalUsageKnown: false, measuredTotalReads: null, exactGlobalCutoff: false} : describeManagementReadObservation(await readObservation());
    const packet = {readBudgetObservation, schemaVersion: 1, kind: 'FIRESTORE_SELECTED_SCOPE_CAPTURE', ...(bootstrapActive ? {bootstrapAuthorizationId: policy.authorizationId, bootstrapScopeSha256: policy.scopeSha256, totalUsageKnown: false, measuredTotalReads: null} : {}), projectId: target.id, status: capture.status, snapshot: capture.snapshot, receipt: capture.receipt};
    const sealed = protector.seal(packet), bytes = JSON.stringify(sealed) + '\n';
    const filename = 'capture-' + reference + '-' + captureStamp + '.dpapi.json';
    await writeFile(resolve(directory, filename), bytes, {flag: 'wx', mode: 0o600});
    if (hash(await openPrivateJson(JSON.parse(await readFile(resolve(directory, filename), 'utf8')))) !== hash(packet)) throw Error('FIRESTORE_BACKUP_ROUNDTRIP_MISMATCH');
    const summary = {schemaVersion: 1, projectId: target.id, status: capture.status, errorCode: budgetFailureCode || capture.errorCode || null, file: filename,
      ciphertextSha256: createHash('sha256').update(bytes).digest('hex'), scopeRootCount: scope.rootCollections.length,
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