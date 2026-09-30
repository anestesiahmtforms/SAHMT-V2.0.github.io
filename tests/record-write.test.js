import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOperationalWrite, mayQueueOffline, runGuardedOperationalWrite, stageOperationalWrite} from '../src/record-write.js';
import {createWriteSessionGuard} from '../src/write-session.js';

test('registros operacionais Firestore usam mutation ID estável sem fila de Sheets', () => {
  const now = {serverTimestamp: true};
  for (const collectionName of ['events', 'labels', 'checklists', 'activities']) {
    const {record} = buildOperationalWrite({collectionName, data: {active: true, title: 'registro'}, uid: 'uid-1', requestId: 'mutation-1', now});
    assert.equal(record.id, 'mutation-1');
    assert.equal(record.clientMutationId, 'mutation-1');
    assert.equal(record.createdAt, now);
  }
});

test('batch grava somente o recurso Firestore', () => {
  const operations = [];
  const batch = {set: (ref, value) => operations.push({ref, value})};
  stageOperationalWrite(batch, {collectionName: 'events', data: {title: 'Evento'}, uid: 'uid-1', requestId: 'event-1', now: {}, recordRef: 'events/event-1'});
  assert.deepEqual(operations.map((item) => item.ref), ['events/event-1']);
});

test('outbox local preserva políticas próprias e rejeita coleções desconhecidas', () => {
  assert.equal(mayQueueOffline('labels'), false);
  assert.equal(mayQueueOffline('events'), true);
  assert.equal(mayQueueOffline('checklists'), true);
  assert.equal(mayQueueOffline('activities'), true);
  for (const collectionName of ['trainingProgress', 'indicatorMeasurements', 'actionPlans', 'equipment']) {
    assert.equal(mayQueueOffline(collectionName), false, collectionName);
  }
  assert.throws(() => buildOperationalWrite({collectionName: 'vacations', data: {}, uid: 'u', requestId: 'r', now: {}}), /não permitida/);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}

function fictionalWriteSession() {
  let allowed = true;
  const guard = createWriteSessionGuard({
    uid: 'fictional-user', getSession: () => ({status: 'signed-in', user: {uid: 'fictional-user'}}),
    isAllowed: () => allowed
  });
  return {guard, revoke: () => { allowed = false; }};
}

test('revogação durante espera do servidor bloqueia confirmação e fallback offline', async () => {
  const session = fictionalWriteSession();
  const server = deferred();
  const effects = [];
  const write = runGuardedOperationalWrite({
    assertCurrent: session.guard.assertCurrent,
    write: () => server.promise,
    confirmCommitted: async () => { effects.push('confirm'); return null; },
    canQueue: () => true,
    queue: async () => effects.push('queue')
  });
  session.revoke();
  server.reject(Object.assign(new Error('Fictitious network timeout'), {code: 'deadline-exceeded'}));
  await assert.rejects(write, {code: 'session-changed'});
  assert.deepEqual(effects, []);
});

test('revogação durante reconciliação impede enfileirar depois da resposta tardia', async () => {
  const session = fictionalWriteSession();
  const confirmation = deferred();
  const confirmationStarted = deferred();
  const queued = [];
  const write = runGuardedOperationalWrite({
    assertCurrent: session.guard.assertCurrent,
    write: async () => { throw Object.assign(new Error('Fictitious connection loss'), {code: 'unavailable'}); },
    confirmCommitted: () => { confirmationStarted.resolve(); return confirmation.promise; },
    canQueue: () => true,
    queue: async () => queued.push('new-operation')
  });
  await confirmationStarted.promise;
  session.revoke();
  confirmation.resolve(null);
  await assert.rejects(write, {code: 'session-changed'});
  assert.deepEqual(queued, []);
});

test('leitura tardia da transação não agenda set após revogação', async () => {
  const session = fictionalWriteSession();
  const snapshot = deferred();
  const mutations = [];
  const transaction = {set: (ref, record) => mutations.push({ref, record})};
  const write = runGuardedOperationalWrite({
    assertCurrent: session.guard.assertCurrent,
    write: async () => {
      await snapshot.promise;
      stageOperationalWrite(transaction, {
        collectionName: 'events', data: {title: 'Fictitious event'}, uid: 'fictional-user',
        requestId: 'stable-fictional-request', now: {}, recordRef: 'events/stable-fictional-request',
        assertCurrent: session.guard.assertCurrent
      });
    },
    confirmCommitted: async () => null,
    canQueue: () => true,
    queue: async () => mutations.push('queue')
  });
  session.revoke();
  snapshot.resolve();
  await assert.rejects(write, {code: 'session-changed'});
  assert.deepEqual(mutations, []);
});

test('sincronização sem guard mantém ID estável e enfileira uma única intenção', async () => {
  const operation = {uid: 'fictional-user', requestId: 'stable-request', payload: {collectionName: 'events', data: {title: 'Fictitious event'}}};
  const queued = [];
  const result = await runGuardedOperationalWrite({
    write: async () => { throw Object.assign(new Error('Fictitious timeout'), {code: 'unavailable'}); },
    confirmCommitted: async () => null,
    canQueue: (error) => error.code === 'unavailable',
    queue: async () => { queued.push(operation); return {id: operation.requestId, pendingFirestore: true}; }
  });
  assert.deepEqual(queued, [operation]);
  assert.deepEqual(result, {id: 'stable-request', pendingFirestore: true});
});

test('reconciliação de gravação confirmada preserva ID e não cria duplicata offline', async () => {
  const confirmed = {id: 'stable-request', pendingFirestore: false, alreadyCommitted: true};
  let queues = 0;
  const result = await runGuardedOperationalWrite({
    write: async () => { throw Object.assign(new Error('Fictitious lost response'), {code: 'unavailable'}); },
    confirmCommitted: async () => confirmed,
    canQueue: () => true,
    queue: async () => { queues++; }
  });
  assert.strictEqual(result, confirmed);
  assert.equal(queues, 0);
});

test('conflito de versão continua terminal e não aciona reconciliação nem fila', async () => {
  const effects = [];
  const error = Object.assign(new Error('Fictitious version conflict'), {code: 'stale-version'});
  await assert.rejects(runGuardedOperationalWrite({
    write: async () => { throw error; },
    confirmCommitted: async () => { effects.push('confirm'); },
    canQueue: () => true,
    queue: async () => { effects.push('queue'); }
  }), {code: 'stale-version'});
  assert.deepEqual(effects, []);
});
