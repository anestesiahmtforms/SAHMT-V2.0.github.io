import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeReportPendingRecords as merge} from '../src/report-pending.js';
import {confirmedLiveReportRecords} from '../src/live-report-session.js';
const scope = {from: '2026-10-01', to: '2026-10-31', uid: 'reader-A', sigla: 'FA'};
const record = (id, fields = {}) => ({id, date: '2026-10-01', active: true, createdByUid: 'reader-A', createdAt: new Date('2026-10-01T10:00:00Z'), version: 1, ...fields});
const operation = (requestId, kind = 'events', fields = {}, overrides = {}) => ({requestId, uid: 'reader-A', type: kind, status: 'queued', createdAt: Date.parse('2026-10-01T11:00:00Z'), payload: {collectionName: kind, data: {date: '2026-10-01', memberSigla: 'FA', description: 'Dados fictícios', ...fields}}, ...overrides});
const edit = (requestId, eventId = 'A', fields = {}, overrides = {}) => ({...operation(requestId, 'events', fields, {type: 'eventEdits'}), payload: {collectionName: 'events', eventId, expectedVersion: 1, data: {date: '2026-10-01', description: 'Edição fictícia', ...fields}}, ...overrides});
const ids = records => records.map(item => item.id);

test('criação local usa requestId estável e não duplica registro confirmado', () => {
  const local = operation('request-A');
  const pending = merge('events', [], [local], scope);
  assert.deepEqual(ids(pending), ['request-A']); assert.equal(pending[0].clientMutationId, 'request-A'); assert.equal(pending[0].pendingFirestore, true); assert.equal(pending[0].createdByUid, scope.uid);
  const confirmed = merge('events', [record('request-A', {clientMutationId: 'request-A'})], [local], scope);
  assert.deepEqual(ids(confirmed), ['request-A']); assert.equal(confirmed[0].pendingFirestore, undefined);
});

test('clientMutationId confirmado também reconhece requestId quando o ID difere', () => {
  const result = merge('events', [record('legacy', {clientMutationId: 'request-A'})], [operation('request-A')], scope);
  assert.deepEqual(ids(result), ['legacy']);
});

test('mesmo requestId repetido na lista de operações produz somente uma linha', () => {
  const op = operation('A'); assert.deepEqual(ids(merge('events', [], [op, structuredClone(op)], scope)), ['A']);
});

test('local só entra no período selecionado, UID atual, tipo e estado reconhecidos', () => {
  const invalid = [operation('before', 'events', {date: '2026-09-30'}), operation('after', 'events', {date: '2026-11-01'}), operation('date', 'events', {date: null}),
    operation('uid', 'events', {}, {uid: 'other'}), operation('done', 'events', {}, {status: 'sent'}), operation('type', 'events', {}, {type: 'activities'}),
    operation('collection', 'checklists'), operation('inactive', 'events', {active: false})];
  assert.deepEqual(merge('events', [], invalid, scope), []); assert.deepEqual(merge('events', [], [operation('A')], {...scope, uid: ''}), []);
});

test('visibilidade remota comum aceita autoria/member/schedule e elimina registros não autorizados', () => {
  const rows = [record('own'), record('member', {createdByUid: 'other', memberSigla: 'FA'}), record('schedule', {createdByUid: 'other', scheduleSigla: 'FA'}),
    record('foreign', {createdByUid: 'other', memberSigla: 'FB'}), record('inactive', {active: false}), record('outside', {date: '2026-11-01'})];
  assert.deepEqual(ids(merge('events', rows, [], {...scope, sigla: ' fa '})), ['member', 'own', 'schedule']);
  assert.deepEqual(ids(merge('events', rows, [], {...scope, sigla: ''})), ['own']);
  assert.deepEqual(ids(merge('events', rows, [], {...scope, isAdmin: true})), ['foreign', 'member', 'own', 'schedule']);
});

test('falhas e conflitos locais nunca se tornam documentos confirmados para PDF', () => {
  const result = merge('events', [], [operation('failed', 'events', {}, {status: 'failed', lastError: 'Falha fictícia'}), operation('conflict', 'events', {}, {status: 'conflict'})], scope);
  assert.equal(result.find(item => item.id === 'failed').syncFailed, true); assert.equal(result.find(item => item.id === 'failed').syncError, 'Falha fictícia');
  assert.equal(result.find(item => item.id === 'conflict').syncConflict, true); assert.deepEqual(confirmedLiveReportRecords(result), []);
});

test('hasPendingWrites do SDK vira flag operacional sem alterar original e limpa ao confirmar', () => {
  for (const [kind, flag] of [['events', 'pendingFirestore'], ['labels', 'pendingFirestore'], ['checklists', 'pendingSync']]) {
    const input = record('A', {hasPendingWrites: true}), result = merge(kind, [input], [], scope);
    assert.equal(result[0][flag], true); assert.equal(input[flag], undefined); assert.deepEqual(confirmedLiveReportRecords(result), []);
    const confirmed = merge(kind, [record('A', {hasPendingWrites: false})], [], scope); assert.equal(confirmed[0][flag], undefined); assert.equal(confirmedLiveReportRecords(confirmed).length, 1);
  }
});

test('metadata de documento pendente também impede PDF', () => {
  const result = merge('events', [record('A', {metadata: {hasPendingWrites: true}})], [], scope);
  assert.equal(result[0].pendingFirestore, true); assert.deepEqual(confirmedLiveReportRecords(result), []);
});

test('checklist diário e mensal usam período e flags existentes; outra fila não entra', () => {
  const ops = [operation('today', 'checklists', {stationId: 'arsenal-1'}), operation('otherday', 'checklists', {date: '2026-10-02'}), operation('failed', 'checklists', {}, {status: 'failed'}), operation('events')];
  const daily = merge('checklists', [], ops, {uid: scope.uid, day: '2026-10-01'});
  assert.deepEqual(ids(daily), ['failed', 'today']); assert.equal(daily.find(item => item.id === 'today').pendingSync, true); assert.equal(daily.find(item => item.id === 'failed').syncFailed, true);
  assert.deepEqual(ids(merge('checklists', [], ops, scope)), ['otherday', 'failed', 'today']);
});

test('checklist aceito por requestId prevalece e mantém autoria e estado do servidor', () => {
  const remote = record('A', {createdByUid: 'other', stationId: 'arsenal-1', condition: 'SIM', clientMutationId: 'A'});
  const result = merge('checklists', [remote], [operation('A', 'checklists', {condition: 'NAO'})], scope);
  assert.equal(result.length, 1); assert.equal(result[0].condition, 'SIM'); assert.equal(result[0].createdByUid, 'other'); assert.equal(result[0].pendingSync, undefined);
});

test('Etiquetas não recebem nenhuma fila local nem dados de outra coleção', () => {
  const result = merge('labels', [record('A')], [operation('local', 'labels'), operation('events')], scope); assert.deepEqual(ids(result), ['A']);
});

test('edição é restrita ao administrador e nunca é exposta para usuário comum', () => {
  assert.equal(merge('events', [record('A')], [edit('E')], scope)[0].description, undefined);
  assert.deepEqual(merge('events', [], [edit('E')], scope), []);
});

test('edição pendente da versão atual conserva identidade e autoria remotas', () => {
  const remote = record('A', {createdByUid: 'other', description: 'Antigo'}), result = merge('events', [remote], [edit('E')], {...scope, isAdmin: true});
  assert.equal(result.length, 1); assert.equal(result[0].id, 'A'); assert.equal(result[0].sourceEventId, 'A'); assert.equal(result[0].localRequestId, 'E');
  assert.equal(result[0].version, 2); assert.equal(result[0].description, 'Edição fictícia'); assert.equal(result[0].createdByUid, 'other');
  assert.equal(result[0].pendingEdit, true); assert.equal(result[0].pendingFirestore, true); assert.deepEqual(confirmedLiveReportRecords(result), []);
});

test('lastRequestId remoto reconhece edição já aceita sem voltar à versão de fila', () => {
  const remote = record('A', {version: 3, description: 'Confirmado', lastRequestId: 'E'}), result = merge('events', [remote], [edit('E')], {...scope, isAdmin: true});
  assert.equal(result.length, 1); assert.equal(result[0].version, 3); assert.equal(result[0].description, 'Confirmado'); assert.equal(result[0].pendingEdit, undefined);
});

test('nova versão de servidor não é demovida por edição antiga e rascunho fica separado', () => {
  const remote = record('A', {version: 4, description: 'Servidor atual'}), result = merge('events', [remote], [edit('E')], {...scope, isAdmin: true});
  assert.equal(result.find(item => item.id === 'A').version, 4); assert.equal(result.find(item => item.id === 'A').description, 'Servidor atual');
  const draft = result.find(item => item.id === 'A::draft::E'); assert.equal(draft.syncConflict, true); assert.equal(draft.sourceEventId, 'A'); assert.equal(draft.pendingEdit, true);
  assert.deepEqual(ids(confirmedLiveReportRecords(result)), ['A']);
});

test('conflito e falha de edição são cópias separadas e não apagam registro aceito', () => {
  for (const status of ['conflict', 'failed']) {
    const result = merge('events', [record('A')], [edit('E', 'A', {}, {status, lastError: 'Comparar versão'})], {...scope, isAdmin: true});
    assert.equal(result.length, 2); assert.equal(result.find(item => item.id === 'A').pendingEdit, undefined);
    const draft = result.find(item => item.id === 'A::draft::E'); assert.ok(draft.syncConflict || draft.syncFailed); assert.equal(draft.syncError, 'Comparar versão');
    assert.deepEqual(ids(confirmedLiveReportRecords(result)), ['A']);
  }
});

test('edição que mudou de período sai desta seleção, mesmo que origem ainda exista', () => {
  const result = merge('events', [record('A')], [edit('E', 'A', {date: '2026-11-01'})], {...scope, isAdmin: true});
  assert.equal(result.length, 1); assert.equal(result[0].pendingEdit, undefined);
});

test('edição com payload inválido, versão inválida ou registro inativo não é sobreposta', () => {
  const edits = [edit('no-id', ''), edit('invalid', 'A', {}, {payload: {collectionName: 'events', eventId: 'A', expectedVersion: 0, data: {date: scope.from}}}), edit('inactive', 'A', {active: false})];
  const result = merge('events', [record('A')], edits, {...scope, isAdmin: true}); assert.equal(result.length, 1); assert.equal(result[0].pendingEdit, undefined);
});

test('deduplicação remota prefere versão e timestamp recentes e não esconde SDK pending', () => {
  const result = merge('events', [record('A', {version: 2, description: 'Recente', updatedAt: '2026-10-01T12:00Z'}), record('A', {version: 1, description: 'Antigo', updatedAt: '2026-10-01T13:00Z'})], [], scope);
  assert.equal(result.length, 1); assert.equal(result[0].description, 'Recente');
  const pending = merge('events', [record('A'), record('A', {hasPendingWrites: true})], [], scope); assert.equal(pending[0].pendingFirestore, true);
});

test('ordenar e sobrepor não muta registros ou operações recebidos', () => {
  const remote = [record('A')], operations = [edit('E')], beforeRemote = structuredClone(remote), beforeOperations = structuredClone(operations);
  merge('events', remote, operations, {...scope, isAdmin: true}); assert.deepEqual(remote, beforeRemote); assert.deepEqual(operations, beforeOperations);
});

test('relatório desconhecido e período inválido são recusados', () => {
  assert.throws(() => merge('contacts', [], [], scope), /não permitido/); assert.throws(() => merge('events', [], [], {}), /período/);
});

test('payload local comum com autoria e participação de outro usuário não entra', () => {
  const ops = [operation('foreign', 'events', {createdByUid: 'other', memberSigla: 'FB', scheduleSigla: 'FB'}), operation('member', 'events', {createdByUid: 'other', memberSigla: 'FA'})];
  assert.deepEqual(ids(merge('events', [], ops, scope)), ['member']);
});

test('sessão ausente e flag admin inválida não revelam registros remotos nem edições', () => {
  assert.deepEqual(merge('events', [record('A')], [], {...scope, uid: '', isAdmin: true}), []);
  assert.deepEqual(merge('checklists', [record('A')], [], {...scope, uid: ''}), []);
  const result = merge('events', [record('A')], [edit('E')], {...scope, isAdmin: 'false'}); assert.equal(result[0].pendingEdit, undefined);
});

test('clientMutationId de documento ainda pending representa a fila sem duplicar', () => {
  const result = merge('events', [record('legacy', {clientMutationId: 'E', hasPendingWrites: true})], [operation('E')], scope);
  assert.deepEqual(ids(result), ['legacy']); assert.equal(result[0].pendingFirestore, true);
});

test('registro remoto inativo não recebe rascunho de edição na seleção', () => {
  assert.deepEqual(merge('events', [record('A', {active: false})], [edit('E')], {...scope, isAdmin: true}), []);
});
