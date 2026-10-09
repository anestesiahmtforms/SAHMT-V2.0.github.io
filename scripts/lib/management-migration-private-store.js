import {open, readFile, lstat, realpath, rename, unlink} from 'node:fs/promises';
import {resolve, relative, isAbsolute, dirname} from 'node:path';
import {randomBytes, createHash} from 'node:crypto';
import {createPrivateJsonProtector, openPrivateJson} from './windows-protected-json.js';
import {snapshotDigest} from './management-split-plan.js';
import {assessFbMigrationDestinationBudget} from './management-migration-destination-budget.js';

const FB = 'sahmt-gestao-5ae66', PURPOSE = 'MANAGEMENT_MIGRATION_CREATE_ONLY';
const SHA = /^[a-f0-9]{64}$/;
const PINS = ['planSha256', 'sourceSnapshotSha256', 'manifestSha256', 'destinationSnapshotSha256', 'aclSha256', 'identitySha256'];
const IMMUTABLE_BUDGET = ['schemaVersion', 'mode', 'projectId', 'databaseId', 'authorizedPurpose', 'authorizationSource',
  'authorizationId', 'runId', 'pins', 'scopeSha256', 'maximumUnits', 'humanDecisionAt', 'authorizedUntil', 'startedAt',
  'maximumDurationMs', 'deadlineAt', 'quotaDayStart', 'quotaTimeZone', 'readPairMaximumReads',
  'commitPairMaximumReads', 'maximumPostcheckReads', 'maximumReservedReads', 'totalUsageKnown',
  'measuredTotalReads', 'dailyReadLimit', 'exactGlobalCutoff', 'localReservationOnly', 'renewalClearsPause'];
const fail = code => {throw Error(code);};
const demand = (ok, code) => {if (!ok) fail(code);};
const clone = value => JSON.parse(JSON.stringify(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const count = value => Number.isSafeInteger(value) && value >= 0;
const pinValue = pins => pins && typeof pins === 'object' && !Array.isArray(pins)
  && Object.keys(pins).length === PINS.length && PINS.every(key => typeof pins[key] === 'string' && SHA.test(pins[key]));
const same = (left, right) => snapshotDigest(left) === snapshotDigest(right);
const budgetConfiguration = budget => Object.fromEntries(IMMUTABLE_BUDGET.map(key => [key, budget[key]]));

async function noLinks(path) {
  let target = resolve(path);
  while (true) {
    const stat = await lstat(target); demand(!stat.isSymbolicLink(), 'MIGRATION_STORE_LINK_FORBIDDEN');
    const parent = dirname(target); if (parent === target) break; target = parent;
  }
}

function validateReplacement(replacement, previous, runId, pins, scope) {
  demand(replacement && replacement.schemaVersion === 1 && replacement.kind === 'PROTECTED_MANAGEMENT_MIGRATION_STATE'
    && replacement.runId === runId && pinValue(replacement.pins) && same(replacement.pins, pins),
  'MIGRATION_STORE_BINDING_CHANGED');
  const before = previous.budget, after = replacement.budget;
  demand(after && same(budgetConfiguration(after), budgetConfiguration(before))
    && after.projectId === FB && after.authorizedPurpose === PURPOSE && after.runId === runId
    && pinValue(after.pins) && same(after.pins, pins), 'MIGRATION_STORE_BUDGET_BINDING_CHANGED');
  demand(count(after.reservedReads) && after.reservedReads >= before.reservedReads
    && after.reservedReads <= after.maximumReservedReads && count(after.reservationAttempts)
    && after.reservationAttempts >= before.reservationAttempts && count(after.confirmedReservations)
    && after.confirmedReservations >= before.confirmedReservations
    && Array.isArray(after.reservations) && after.reservations.length === after.reservationAttempts
    && after.reservations.length >= before.reservations.length
    && after.reservations.length <= before.reservations.length + 1,
  'MIGRATION_STORE_BUDGET_DEBIT_CHANGED');
  demand(typeof after.pausedRequiresReview === 'boolean' && (!before.pausedRequiresReview || after.pausedRequiresReview)
    && typeof after.pauseReason === 'string' && (!before.pauseReason || before.pauseReason === after.pauseReason)
    && after.renewalClearsPause === false && ['AUTHORIZED', 'IN_PROGRESS', 'RESERVATION_PENDING', 'PAUSED', 'COMPLETE', 'INCOMPLETE'].includes(after.status)
    && (!['PAUSED', 'COMPLETE', 'INCOMPLETE'].includes(after.status) || after.pausedRequiresReview),
  'MIGRATION_STORE_PAUSE_CANNOT_CLEAR');
  const ids = new Set(), stages = new Set(), posts = new Map();
  let reserved = 0, confirmed = 0;
  for (const [index, entry] of after.reservations.entries()) {
    demand(entry && typeof entry.reservationId === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(entry.reservationId) && !ids.has(entry.reservationId)
      && entry.attempt === index + 1 && scope.unitPaths.includes(entry.path)
      && ['READ_PAIR', 'COMMIT_PAIR', 'POSTCHECK'].includes(entry.stage)
      && count(entry.maximumReads) && entry.maximumReads > 0 && typeof entry.persisted === 'boolean'
      && Number.isFinite(Date.parse(entry.reservedAt)), 'MIGRATION_STORE_RESERVATION_INVALID');
    ids.add(entry.reservationId); reserved += entry.maximumReads; if (entry.persisted) confirmed++;
    if (index < before.reservations.length) {
      const prior = before.reservations[index];
      demand(same({...entry, persisted:prior.persisted}, prior)
        && (!prior.persisted || entry.persisted), 'MIGRATION_STORE_RESERVATION_CHANGED');
    }
    if (entry.stage === 'POSTCHECK') {
      posts.set(entry.path, (posts.get(entry.path) || 0) + entry.maximumReads);
      demand(posts.get(entry.path) <= 4, 'MIGRATION_STORE_RESERVATION_INVALID');
    } else {
      const key = entry.path + '\u0000' + entry.stage;
      demand(!stages.has(key) && entry.maximumReads === (entry.stage === 'READ_PAIR'
        ? after.readPairMaximumReads : after.commitPairMaximumReads), 'MIGRATION_STORE_RESERVATION_INVALID');
      if (entry.stage === 'COMMIT_PAIR') demand(stages.has(entry.path + '\u0000READ_PAIR'),
        'MIGRATION_STORE_RESERVATION_INVALID');
      stages.add(key);
    }
  }
  demand(reserved === after.reservedReads && confirmed === after.confirmedReservations
    && [...posts.values()].reduce((sum, value) => sum + value, 0) <= after.maximumPostcheckReads,
  'MIGRATION_STORE_BUDGET_DEBIT_CHANGED');
  const appended = after.reservations.length > before.reservations.length;
  const acknowledged = confirmed > before.confirmedReservations;
  if (appended) demand(!before.pausedRequiresReview && ['AUTHORIZED', 'IN_PROGRESS'].includes(before.status)
    && after.status === 'RESERVATION_PENDING' && !after.reservations.at(-1).persisted && !acknowledged,
  'MIGRATION_STORE_RESERVATION_TRANSITION_INVALID');
  if (acknowledged) demand(!appended && !before.pausedRequiresReview && before.status === 'RESERVATION_PENDING'
    && after.status === 'IN_PROGRESS' && confirmed === before.confirmedReservations + 1
    && before.pendingReservationId === after.reservations.at(-1)?.reservationId,
  'MIGRATION_STORE_RESERVATION_TRANSITION_INVALID');
  if (after.status === 'RESERVATION_PENDING') demand(after.reservations.length > 0
    && confirmed === after.reservations.length - 1 && !after.reservations.at(-1).persisted
    && after.pendingReservationId === after.reservations.at(-1).reservationId,
  'MIGRATION_STORE_RESERVATION_TRANSITION_INVALID');
  else demand(confirmed === after.reservations.length && after.pendingReservationId === null,
    'MIGRATION_STORE_RESERVATION_TRANSITION_INVALID');
}

/** Local CLI only. All data stays protected; this store cannot clear a pause,
 * refund a reservation, change a run's scope, or load production credentials.
 */
export async function createManagementMigrationPrivateStore({root, directory, runId, pins, scope, initialBudget, now = Date.now}) {
  demand(typeof runId === 'string' && SHA.test(runId) && pinValue(pins)
    && scope?.runId === runId && pinValue(scope.pins) && same(scope.pins, pins)
    && typeof now === 'function', 'MIGRATION_STORE_BINDING_INVALID');
  const clock = () => {
    const value = now(); demand(count(value) && Number.isFinite(new Date(value).getTime()), 'MIGRATION_STORE_CLOCK_INVALID'); return value;
  };
  // Full pure budget admission before filesystem work or protected persistence.
  const fixedBudget = clone(initialBudget), fixedScope = clone(scope), fixedPins = clone(pins);
  assessFbMigrationDestinationBudget({projectId:FB, scope:fixedScope, policy:fixedBudget, nowMs:clock()});
  root = resolve(root); directory = resolve(directory);
  await noLinks(root); await noLinks(directory);
  const actualRoot = await realpath(root), actualDir = await realpath(directory), relation = relative(actualRoot, actualDir);
  demand(!isAbsolute(relation) && relation.replaceAll('\\', '/').startsWith('.local-preview/')
    && !relation.startsWith('..'), 'MIGRATION_STORE_PRIVATE_PATH_REQUIRED');
  demand((await readFile(resolve(root, '.gitignore'), 'utf8')).split(/\r?\n/).includes('.local-preview/'),
    'MIGRATION_STORE_NOT_IGNORED');
  const lockPath = resolve(directory, 'management-migration.lock'), file = resolve(directory, 'migration-' + runId + '.dpapi.json');
  let descriptor;
  try {descriptor = await open(lockPath, 'wx', 0o600);}
  catch (error) {if (error.code === 'EEXIST') fail('MIGRATION_STORE_LOCK_REQUIRES_REVIEW'); throw error;}
  let closed = false, retain = false, tail = Promise.resolve(), state, protector, lastClock = clock();
  const persist = async (value, signal) => {
    demand(!closed && !signal?.aborted, 'MIGRATION_STORE_ABORTED'); await noLinks(directory);
    try {const existing = await lstat(file); demand(!existing.isSymbolicLink(), 'MIGRATION_STORE_LINK_FORBIDDEN');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    const envelope = protector.seal(value), bytes = JSON.stringify(envelope) + '\n';
    demand(Buffer.byteLength(bytes) <= 20 * 1024 * 1024, 'MIGRATION_STORE_SIZE_LIMIT');
    const temporary = file + '.' + randomBytes(12).toString('hex') + '.tmp'; let handle;
    try {
      handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes, 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      demand(!signal?.aborted, 'MIGRATION_STORE_ABORTED'); await rename(temporary, file);
      state = value; return {persisted:true, revision:value.revision, ciphertextSha256:hash(bytes)};
    } finally {
      if (handle) await handle.close();
      try {await unlink(temporary);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
  };
  try {
    protector = await createPrivateJsonProtector();
    const probe = protector.seal({purpose:'MIGRATION_STORE_PROTECTION_PROBE'});
    demand((await openPrivateJson(probe)).purpose === 'MIGRATION_STORE_PROTECTION_PROBE', 'MIGRATION_STORE_PROTECTION_FAILED');
    try {await lstat(file); fail('MIGRATION_STORE_RUN_ALREADY_EXISTS');} catch (error) {if (error.code !== 'ENOENT') throw error;}
    state = {schemaVersion:1, kind:'PROTECTED_MANAGEMENT_MIGRATION_STATE', runId, pins:fixedPins,
      revision:0, updatedAt:new Date(lastClock).toISOString(), budget:fixedBudget, checkpoint:null};
    await persist(state);
    await descriptor.writeFile(JSON.stringify({runId, pins:fixedPins, createdAt:state.updatedAt, checkpoint:relative(root, file)}) + '\n');
    await descriptor.sync();
  } catch (error) {
    await descriptor.close();
    // If any protected run file exists, preserve the lock for explicit review.
    let recordExists = false;
    try {await lstat(file); recordExists = true;} catch (checkError) {if (checkError.code !== 'ENOENT') recordExists = true;}
    if (!recordExists) await unlink(lockPath);
    throw error;
  }
  const update = (mutate, {signal} = {}) => {
    const next = tail.then(async () => {
      demand(!closed && !signal?.aborted && typeof mutate === 'function', 'MIGRATION_STORE_ABORTED');
      const supplied = mutate(clone(state));
      demand(!supplied?.then, 'MIGRATION_STORE_SYNCHRONOUS_TRANSFORM_REQUIRED');
      const replacement = clone(supplied);
      validateReplacement(replacement, state, runId, fixedPins, fixedScope);
      const current = clock(); demand(current >= lastClock, 'MIGRATION_STORE_CLOCK_REGRESSED'); lastClock = current;
      replacement.revision = state.revision + 1; replacement.updatedAt = new Date(current).toISOString();
      return persist(replacement, signal);
    });
    tail = next.catch(() => {retain = true;}); return next;
  };
  return Object.freeze({
    filename:relative(root, file), read:() => clone(state), update,
    checkpoint:async (payload, options = {}) => {
      demand(payload?.runId === runId && pinValue(payload.pins) && same(payload.pins, fixedPins)
        && ['STARTED', 'PROGRESS', 'BEFORE_COMMIT', 'COMPLETE', 'INCOMPLETE'].includes(payload.state)
        && payload.sourceProjectId === 'sahmt-17a16' && payload.destinationProjectId === FB
        && payload.databaseId === '(default)', 'MIGRATION_STORE_CHECKPOINT_SCOPE_INVALID');
      const ack = await update(value => ({...value, checkpoint:clone(payload)}), options);
      return {...ack, runId, state:payload.state};
    },
    retainForReview:() => {retain = true;},
    close:async () => {
      await tail; if (closed) return {lockRetainedRequiresReview:retain};
      if (state.budget.status !== 'COMPLETE' || state.budget.pausedRequiresReview !== true
        || state.verification?.status !== 'COMPLETE' || state.verification.verifiedPairs !== fixedScope.unitPaths.length) retain = true;
      closed = true;
      await descriptor.close(); if (!retain) await unlink(lockPath);
      return {lockRetainedRequiresReview:retain};
    }
  });
}
