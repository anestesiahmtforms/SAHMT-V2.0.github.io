import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriteSessionGuard} from '../src/write-session.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
}

const signedIn = (uid = 'fictional-user', write = true) => ({
  status: 'signed-in', user: {uid}, profile: {permissions: {write}}
});

for (const module of ['Eventos', 'Etiquetas', 'Checklist']) {
  test(`${module}: revogação durante importação impede persistir ou enfileirar`, async () => {
    let session = signedIn();
    const loading = deferred();
    const effects = [];
    const guard = createWriteSessionGuard({
      uid: session.user.uid, getSession: () => session,
      isAllowed: (current) => current.profile.permissions.write
    });
    const submitAfterImport = async () => {
      guard.assertCurrent();
      await loading.promise;
      guard.assertCurrent();
      effects.push({uid: guard.uid, action: 'persist-or-queue'});
    };
    const submission = submitAfterImport();
    session = signedIn('fictional-user', false);
    loading.resolve();
    await assert.rejects(submission, {code: 'session-changed'});
    assert.deepEqual(effects, []);
  });
}

test('troca de conta, logout ou bloqueio não transfere gravação pendente para outra sessão', () => {
  let session = signedIn();
  const guard = createWriteSessionGuard({uid: session.user.uid, getSession: () => session, isAllowed: () => true});
  for (const next of [signedIn('another-fictional-user'), {status: 'signed-out'}, {...signedIn(), status: 'blocked'}]) {
    session = next;
    assert.throws(() => guard.assertCurrent(), {code: 'session-changed'});
  }
});

test('formulário removido ou módulo desativado impede retomar a operação', () => {
  let connected = true;
  let enabled = true;
  const guard = createWriteSessionGuard({
    uid: 'fictional-user', getSession: () => signedIn(),
    isAllowed: () => enabled, isContextCurrent: () => connected
  });
  connected = false;
  assert.throws(() => guard.assertCurrent(), {code: 'session-changed'});
  connected = true;
  enabled = false;
  assert.throws(() => guard.assertCurrent(), {code: 'session-changed'});
});

test('perfil repetido e nome atualizado preservam a gravação com UID original', async () => {
  let session = signedIn();
  const guard = createWriteSessionGuard({
    uid: session.user.uid, getSession: () => session,
    isAllowed: (current) => current.profile.permissions.write
  });
  const loading = deferred();
  const effects = [];
  const submission = (async () => {
    guard.assertCurrent();
    await loading.promise;
    effects.push(guard.assertCurrent());
  })();
  session = {...signedIn(), profile: {...signedIn().profile, displayName: 'Fictitious updated name'}};
  loading.resolve();
  await submission;
  assert.deepEqual(effects, ['fictional-user']);
});

test('conclusão antiga não oferece atualização visual na sessão nova', async () => {
  let session = signedIn();
  const guard = createWriteSessionGuard({uid: session.user.uid, getSession: () => session, isAllowed: () => true});
  const request = deferred();
  const effects = [];
  const complete = (async () => {
    await request.promise;
    if (guard.isCurrent()) effects.push('show-success');
  })();
  session = signedIn('another-fictional-user');
  request.resolve();
  await complete;
  assert.deepEqual(effects, []);
});
