import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, lstat, unlink, rmdir} from 'node:fs/promises';
import {resolve, dirname, join, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createManagementMigrationPrivateStore} from '../scripts/lib/management-migration-private-store.js';
import {openPrivateJson} from '../scripts/lib/windows-protected-json.js';
import {createFbMigrationDestinationBudget, assessFbMigrationDestinationBudget,
  acknowledgeFbMigrationDestinationReservation, pauseFbMigrationDestinationBudget,
  finishFbMigrationDestinationBudget} from '../scripts/lib/management-migration-destination-budget.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FB = 'sahmt-gestao-5ae66', windows = process.platform === 'win32';
const names = ['planSha256', 'sourceSnapshotSha256', 'manifestSha256', 'destinationSnapshotSha256', 'aclSha256', 'identitySha256'];
const pins = Object.fromEntries(names.map((name, i) => [name, String(i + 1).repeat(64)]));
const clone = value => structuredClone(value);

async function fixture() {
  const directory = await mkdtemp(join(root, '.local-preview', 'migration-store-test-'));
  const nowMs = Date.now(), time = new Date(nowMs).toISOString();
  const scope = {schemaVersion:1, projectId:FB, databaseId:'(default)', runId:'a'.repeat(64),
    pins:clone(pins), unitPaths:['managementAreas/demo']};
  const initialBudget = createFbMigrationDestinationBudget({projectId:FB, scope, nowMs,
    authorization:{schemaVersion:1, authorized:true, projectId:FB, databaseId:'(default)',
      purpose:'MANAGEMENT_MIGRATION_CREATE_ONLY', authorizationSource:'EXPLICIT_HUMAN_CONTINUE_FB',
      authorizationId:'synthetic-local-store', approvedAt:time,
      expiresAt:new Date(nowMs + 600000).toISOString(), maximumDurationMs:300000,
      readPairMaximumReads:2, commitPairMaximumReads:2, maximumPostcheckReads:2, maximumReservedReads:6}});
  let store;
  const input = {root, directory, runId:scope.runId, pins:scope.pins, scope, initialBudget, now:()=>nowMs};
  const openStore = async () => (store = await createManagementMigrationPrivateStore(input));
  const reserve = async stage => {
    const reservation = {projectId:FB, databaseId:'(default)', runId:scope.runId,
      pins:scope.pins, path:scope.unitPaths[0], stage, maximumReads:2, reservationId:'reservation-' + stage};
    const pending = assessFbMigrationDestinationBudget({projectId:FB, scope, policy:store.read().budget, nowMs, reservation});
    await store.update(state => ({...state, budget:pending.nextPolicy}));
    const confirmed = acknowledgeFbMigrationDestinationReservation({projectId:FB, scope, policy:store.read().budget, nowMs,
      acknowledgement:{persisted:true, reservationId:reservation.reservationId, policySha256:pending.policySha256}});
    await store.update(state => ({...state, budget:confirmed.nextPolicy}));
    return confirmed.proof;
  };
  const cleanup = async () => {
    if (store) await store.close();
    const relationship = relative(resolve(root, '.local-preview'), resolve(directory));
    assert.ok(!isAbsolute(relationship) && relationship.startsWith('migration-store-test-')
      && !relationship.includes('/') && !relationship.includes('\\'));
    // Only direct files in this fixture's exact directory; never recursive removal.
    for (const name of await readdir(directory)) {
      const file = resolve(directory, name);
      assert.equal(dirname(file), resolve(directory));
      assert.equal((await lstat(file)).isDirectory(), false);
      await unlink(file);
    }
    await rmdir(directory);
  };
  return {input, directory, scope, nowMs, openStore, reserve, cleanup, get store(){return store;}};
}

test('store real Windows DPAPI confirma duas reservas antes do transporte e mantém dados privados cifrados',
  {skip:!windows}, async () => {
    const f = await fixture();
    try {
      await f.openStore();
      const first = await f.reserve('READ_PAIR');
      assert.equal(first.reservationPersisted, true); assert.equal(f.store.read().budget.reservedReads, 2);
      await f.reserve('COMMIT_PAIR'); await f.reserve('POSTCHECK');
      const marker = 'PRIVATE_SYNTHETIC_DATA_ONLY';
      await f.store.update(state => ({...state, verification:{status:'DRAFT', marker}}));
      const bytes = await readFile(resolve(root, f.store.filename), 'utf8');
      assert.equal(bytes.includes(marker), false);
      assert.equal(bytes.includes('managementAreas/demo'), false);
      const decrypted = await openPrivateJson(JSON.parse(bytes));
      assert.equal(decrypted.verification.marker, marker);
      assert.equal(decrypted.budget.reservedReads, 6);
      assert.equal(decrypted.revision, f.store.read().revision);
      assert.deepEqual(f.store.read().budget.reservations.map(row => row.persisted), [true,true,true]);
      assert.equal((await readdir(f.directory)).some(name => name.endsWith('.tmp')), false);
      await f.store.checkpoint({schemaVersion:1, runId:f.scope.runId, pins:f.scope.pins, state:'COMPLETE',
        sourceProjectId:'sahmt-17a16', destinationProjectId:FB, databaseId:'(default)'});
      const terminal = finishFbMigrationDestinationBudget({
        projectId:FB, policy:f.store.read().budget, nowMs:f.nowMs, status:'COMPLETE'});
      await f.store.update(state => ({...state, budget:terminal,
        verification:{status:'COMPLETE', verifiedPairs:1}}));
      assert.deepEqual(await f.store.close(), {lockRetainedRequiresReview:false});
      assert.deepEqual(await f.store.close(), {lockRetainedRequiresReview:false});
      assert.equal((await readdir(f.directory)).includes('management-migration.lock'), false);
    } finally {await f.cleanup();}
  });

test('store impede concorrência, alteração de escopo, refunds, unconfirm e limpeza de pausas',
  {skip:!windows}, async () => {
    const f = await fixture();
    try {
      await f.openStore();
      await assert.rejects(createManagementMigrationPrivateStore(f.input), /LOCK_REQUIRES_REVIEW/);
      await f.reserve('READ_PAIR');
      const mutations = [
        state => {state.pins = {}; return state;},
        state => {state.budget.projectId = 'sahmt-17a16'; return state;},
        state => {state.budget.deadlineAt = new Date(f.nowMs + 600000).toISOString(); return state;},
        state => {state.budget.reservedReads = 0; return state;},
        state => {state.budget.reservations = []; state.budget.reservationAttempts = 0; return state;},
        state => {state.budget.reservations[0].path = 'managementAreas/changed'; return state;},
        state => {state.budget.reservations[0].persisted = false; state.budget.confirmedReservations = 0; return state;}
      ];
      for (const mutation of mutations) {
        const before = clone(f.store.read());
        await assert.rejects(f.store.update(mutation), /MIGRATION_STORE_/);
        assert.deepEqual(f.store.read(), before);
      }
      const paused = pauseFbMigrationDestinationBudget({
        projectId:FB, policy:f.store.read().budget, nowMs:f.nowMs, reason:'SYNTHETIC_REVIEW_REQUIRED'});
      await f.store.update(state => ({...state, budget:paused}));
      await assert.rejects(f.store.update(state => {
        state.budget.pausedRequiresReview = false; state.budget.pauseReason = ''; return state;
      }), /PAUSE_CANNOT_CLEAR/);
      await assert.rejects(f.store.update(async state => state), /SYNCHRONOUS_TRANSFORM_REQUIRED/);
      assert.equal(f.store.read().budget.pausedRequiresReview, true);
      assert.equal(f.store.read().budget.reservedReads, 2);
      assert.deepEqual(await f.store.close(), {lockRetainedRequiresReview:true});
      assert.equal((await readdir(f.directory)).includes('management-migration.lock'), true);
    } finally {await f.cleanup();}
  });

test('store exige prova FB e seis pins completos antes de gravar qualquer arquivo', async () => {
  const f = await fixture();
  try {
    await assert.rejects(createManagementMigrationPrivateStore({...f.input, pins:{}}), /BINDING_INVALID/);
    const wrongBudget = clone(f.input.initialBudget); wrongBudget.projectId = 'sahmt-17a16';
    await assert.rejects(createManagementMigrationPrivateStore({...f.input, initialBudget:wrongBudget}), /MIGRATION_BUDGET_/);
    const paused = clone(f.input.initialBudget); paused.pausedRequiresReview = true; paused.status = 'PAUSED';
    await assert.rejects(createManagementMigrationPrivateStore({...f.input, initialBudget:paused}), /PAUSED_REQUIRES_REVIEW/);
    assert.deepEqual(await readdir(f.directory), []);
  } finally {await f.cleanup();}
});

test('store abortado não altera estado nem remove lock de revisão', {skip:!windows}, async () => {
  const f = await fixture();
  try {
    await f.openStore(); const before = clone(f.store.read()), controller = new AbortController(); controller.abort();
    await assert.rejects(f.store.update(state => ({...state, verification:{status:'UNEXPECTED'}}),
      {signal:controller.signal}), /STORE_ABORTED/);
    assert.deepEqual(f.store.read(), before);
    assert.deepEqual(await f.store.close(), {lockRetainedRequiresReview:true});
  } finally {await f.cleanup();}
});

test('store não libera lock antes da conferência ou em autorização já existente',
  {skip:!windows}, async () => {
    const f = await fixture();
    try {
      await f.openStore();
      const terminal = finishFbMigrationDestinationBudget({
        projectId:FB, policy:f.store.read().budget, nowMs:f.nowMs, status:'COMPLETE'});
      await f.store.update(state => ({...state, budget:terminal, verification:{status:'COMPLETE', verifiedPairs:0}}));
      assert.deepEqual(await f.store.close(), {lockRetainedRequiresReview:true});
      // A new capsule never overwrites the existing run, even if its shared lock were released by an operator.
      await unlink(resolve(f.directory, 'management-migration.lock'));
      await assert.rejects(createManagementMigrationPrivateStore(f.input), /RUN_ALREADY_EXISTS/);
      assert.equal((await readdir(f.directory)).includes('management-migration.lock'), true);
    } finally {await f.cleanup();}
  });
