import test from 'node:test';
import assert from 'node:assert/strict';
import {stageChecklistSignatureRequest} from '../src/checklist-signature-write.js';
import {createWriteSessionGuard} from '../src/write-session.js';

const request = {id: '2026-09-30_fictional-revision_fictional-user', day: '2026-09-30', revision: 'fictional-revision', signerUid: 'fictional-user', declaration: true, justification: 'Revisão fictícia para teste'};

test('assinatura revalida sessão e contexto após leitura lenta antes de transaction.set', async () => {
  for (const changed of ['permission', 'dialog', 'session']) {
    let allowed = true;
    let dialogOpen = true;
    let uid = request.signerUid;
    let resolve;
    const read = new Promise((done) => { resolve = done; });
    const writes = [];
    const guard = createWriteSessionGuard({uid: request.signerUid, getSession: () => ({status: 'signed-in', user: {uid}}), isAllowed: () => allowed, isContextCurrent: () => dialogOpen});
    const pending = stageChecklistSignatureRequest({get: () => read, set: (...args) => writes.push(args)}, 'fictional-reference', request,
      {assertCurrent: guard.assertCurrent, requestedAt: () => 'timestamp'});
    if (changed === 'permission') allowed = false;
    if (changed === 'dialog') dialogOpen = false;
    if (changed === 'session') uid = 'fictional-other-user';
    resolve({exists: () => false});
    await assert.rejects(pending, {code: 'session-changed'});
    assert.deepEqual(writes, [], changed);
  }
});

test('pedido válido preserva ID estável, timestamp e estado de validação', async () => {
  const writes = [];
  const result = await stageChecklistSignatureRequest({get: async () => ({exists: () => false}), set: (...args) => writes.push(args)}, 'fictional-reference', request,
    {assertCurrent: () => {}, requestedAt: () => 'server-timestamp'});
  assert.deepEqual(result, {id: request.id, status: 'PENDING_VALIDATION', alreadyRequested: false});
  assert.deepEqual(writes, [['fictional-reference', {...request, status: 'PENDING_VALIDATION', requestedAt: 'server-timestamp'}]]);
});

test('pedido já confirmado é reconciliado sem segunda gravação', async () => {
  const writes = [];
  const result = await stageChecklistSignatureRequest({get: async () => ({exists: () => true, data: () => ({...request, status: 'VALIDATED'})}), set: (...args) => writes.push(args)}, 'fictional-reference', request,
    {requestedAt: () => 'server-timestamp'});
  assert.deepEqual(result, {id: request.id, status: 'VALIDATED', alreadyRequested: true});
  assert.deepEqual(writes, []);
});

test('reconciliação rejeita um pedido de outra sessão', async () => {
  await assert.rejects(stageChecklistSignatureRequest({get: async () => ({exists: () => true, data: () => ({...request, signerUid: 'fictional-other-user'})})}, 'fictional-reference', request,
    {requestedAt: () => 'server-timestamp'}), /não corresponde/);
});
