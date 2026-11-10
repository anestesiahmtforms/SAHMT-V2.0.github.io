import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFolderReadable, folderReadable, createFolderReadGuard} from '../server/folder-read-policy.js';

const policy = (disabled = [], revision = 1) => ({schemaVersion: 1, revision, disabled});
const code = expected => error => error.code === expected;

test('disabled ancestors block every depth without blocking similarly named siblings', () => {
  const state = policy(['FA/gestao', 'FB/treinamentos/aula%20especial']);
  for (const id of ['FA/gestao', 'FA/gestao/a', 'FA/gestao/a/b/c/d']) {
    assert.equal(folderReadable(state, id), false);
    assert.throws(() => assertFolderReadable(state, id), code('FOLDER_DISABLED'));
  }
  for (const id of ['FA', 'FA/gestao2', 'FB/treinamentos/outra']) {
    assert.equal(folderReadable(state, id), true);
    assert.doesNotThrow(() => assertFolderReadable(state, id));
  }
  assert.equal(folderReadable(state, 'FB/treinamentos/aula%20especial/prova'), false);
});

test('reenabling a parent preserves an independently disabled child and never mutates policy', () => {
  const child = 'FA/gestao/documentos/privados';
  const disabled = Object.freeze(['FA/gestao', child]);
  const state = Object.freeze({...policy(), disabled});
  assert.equal(folderReadable(state, child), false);
  const reenabled = policy(state.disabled.filter(id => id !== 'FA/gestao'), 2);
  assert.equal(folderReadable(reenabled, 'FA/gestao/documentos'), true);
  assert.equal(folderReadable(reenabled, child + '/anexo'), false);
  assert.deepEqual(state.disabled, ['FA/gestao', child]);
});

test('missing or malformed policies fail closed, including malformed unrelated entries', () => {
  const invalid = [null, undefined, [], {}, policy([], 0), policy([], 1.5), policy([], Infinity),
    {...policy(), schemaVersion: 2}, {...policy(), disabled: {}}, policy(['FA//x']),
    policy([12]), policy(new Array(1)), policy(['FB/bad%encoding'])];
  for (const state of invalid) {
    assert.equal(folderReadable(state, 'FA/content'), false);
    assert.throws(() => assertFolderReadable(state, 'FA/content'), code('FOLDER_POLICY_INVALID'));
  }
});

test('folder IDs must use canonical URI-encoded, nonempty path segments', () => {
  for (const id of ['', '/', '/FA', 'FA/', 'FA//child', 'FA/raw space', 'FA/%61',
    'FA/%2f', 'FA/%', 'FA/..', 'FA/.', 'FA/%00', null, 4]) {
    assert.equal(folderReadable(policy(), id), false);
    assert.throws(() => assertFolderReadable(policy(), id), code('FOLDER_ID_INVALID'));
  }
  assert.equal(folderReadable(policy(), 'FA/' + encodeURIComponent('Gestão / versão 2')), true);
});

test('guard checks control metadata first and never invokes blocked ordinary-user content', async () => {
  const events = [];
  const guard = createFolderReadGuard({readPolicy: async () => {events.push('policy'); return policy(['FA']);}});
  await assert.rejects(guard('FA/content', async () => {events.push('content');}), code('FOLDER_DISABLED'));
  assert.deepEqual(events, ['policy']);
});

test('folder access requires activation even when policy metadata claims administrator status', async () => {
  let state = {...policy(['FA']), administrator: true};
  const guard = createFolderReadGuard({readPolicy: () => state});
  await assert.rejects(guard('FA/content', () => assert.fail('Disabled content read')), code('FOLDER_DISABLED'));
  state = policy([], 2);
  assert.equal(await guard('FA/content', () => 'available'), 'available');
});
test('guard reads policy before content and again before delivering the result without positive caching', async () => {
  const events = [], result = {content: 'private'};
  const guard = createFolderReadGuard({readPolicy: async () => {events.push('policy'); return policy();}});
  const read = async () => {events.push('content'); return result;};
  assert.equal(await guard('FA/content', read), result);
  assert.equal(await guard('FA/content', read), result);
  assert.deepEqual(events, ['policy', 'content', 'policy', 'policy', 'content', 'policy']);
});

test('revocation while an asynchronous content read runs prevents delivery', async () => {
  let state = policy(), reads = 0;
  const guard = createFolderReadGuard({readPolicy: async () => state});
  await assert.rejects(guard('FA/content', async () => {
    reads++;
    await Promise.resolve();
    state = policy(['FA'], 2);
    return {private: 'must not be delivered'};
  }), code('FOLDER_DISABLED'));
  assert.equal(reads, 1);
});

test('policy read failures and malformed policy prevent content reads and delivery', async () => {
  for (const broken of [async () => {throw Error('private provider details');}, async () => null]) {
    let contentReads = 0;
    const guard = createFolderReadGuard({readPolicy: broken});
    await assert.rejects(guard('FA/content', async () => contentReads++), error =>
      ['FOLDER_POLICY_INVALID', 'FOLDER_POLICY_UNAVAILABLE'].includes(error.code));
    assert.equal(contentReads, 0);
    let controlReads = 0;
    const afterRead = createFolderReadGuard({readPolicy: () => ++controlReads === 1 ? policy() : broken()});
    await assert.rejects(afterRead('FA/content', async () => 'private'), error =>
      ['FOLDER_POLICY_INVALID', 'FOLDER_POLICY_UNAVAILABLE'].includes(error.code));
    assert.equal(controlReads, 2);
  }
});

test('guard validates arguments before reading control metadata', async () => {
  assert.throws(() => createFolderReadGuard({}), code('FOLDER_READ_GUARD_INVALID'));
  let reads = 0;
  const guard = createFolderReadGuard({readPolicy: () => {reads++; return policy();}});
  await assert.rejects(guard('/FA', () => 1), code('FOLDER_ID_INVALID'));
  await assert.rejects(guard('FA', null), code('FOLDER_READ_GUARD_INVALID'));
  assert.equal(reads, 0);
});
