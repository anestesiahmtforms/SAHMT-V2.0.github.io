import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileStatePublisher} from '../src/profile-state.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}

const user = {uid: 'fictional-user'};
const active = {uid: user.uid, active: true, access: true, permissions: {eventsWrite: true}};

test('revogação chega imediatamente mesmo com cache anterior ainda lento', async () => {
  const pendingCache = deferred();
  const states = [];
  const cached = [];
  const publisher = createProfileStatePublisher({
    user, isCurrent: () => true, onState: (state) => states.push(state),
    cacheProfile: async (_, profile) => {
      cached.push(profile);
      if (profile === active) await pendingCache.promise;
    }
  });
  const initialWrite = publisher.publish(active);
  await Promise.resolve();
  const blocked = {...active, access: false};
  const blockedWrite = publisher.publish(blocked);
  assert.deepEqual(states.map((state) => state.status), ['signed-in', 'blocked']);
  assert.strictEqual(states.at(-1).profile, blocked);
  assert.deepEqual(cached, [active]);
  pendingCache.resolve();
  await Promise.all([initialWrite, blockedWrite]);
  assert.deepEqual(cached, [active, blocked]);
  assert.equal(states.length, 2);
});

test('falha do cache não impede bloqueio nem rejeita entrega do perfil', async () => {
  const states = [];
  const failures = [];
  const storageError = new Error('Fictitious storage quota failure');
  const publisher = createProfileStatePublisher({
    user, isCurrent: () => true, onState: (state) => states.push(state),
    cacheProfile: async () => { throw storageError; },
    onCacheError: (error) => failures.push(error)
  });
  const result = publisher.publish({...active, active: false});
  assert.equal(states[0].status, 'blocked');
  assert.equal(await result, false);
  assert.deepEqual(failures, [storageError]);
  assert.equal(states.length, 1);
});

test('logout durante cache não restaura sessão e descarta snapshots enfileirados', async () => {
  const pendingCache = deferred();
  let currentGeneration = 1;
  const states = [];
  const cached = [];
  const publisher = createProfileStatePublisher({
    user, isCurrent: () => currentGeneration === 1, onState: (state) => states.push(state),
    cacheProfile: async (_, profile) => { cached.push(profile); await pendingCache.promise; }
  });
  const initialWrite = publisher.publish(active);
  await Promise.resolve();
  const queuedWrite = publisher.publish({...active, access: false});
  currentGeneration = 2;
  const deliveredBeforeLogout = states.length;
  pendingCache.resolve();
  await Promise.all([initialWrite, queuedWrite]);
  assert.equal(await publisher.publish(active), false);
  assert.equal(states.length, deliveredBeforeLogout);
  assert.deepEqual(cached, [active]);
});

test('último snapshot vence no cache sem restaurar permissões removidas', async () => {
  const states = [];
  const cached = [];
  const publisher = createProfileStatePublisher({
    user, isCurrent: () => true, onState: (state) => states.push(state),
    cacheProfile: async (_, profile) => cached.push(profile)
  });
  const revoked = {...active, permissions: {eventsWrite: false}};
  const [oldResult, latestResult] = await Promise.all([publisher.publish(active), publisher.publish(revoked)]);
  assert.equal(oldResult, false);
  assert.equal(latestResult, true);
  assert.deepEqual(cached, [revoked]);
  assert.strictEqual(states.at(-1).profile, revoked);
});
