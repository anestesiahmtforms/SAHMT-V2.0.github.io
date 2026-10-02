import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildChecklistReportQueries, checklistReportScope, createChecklistReportListener} from '../src/checklist-report-listener.js';
import {resolveChecklistDayRecord, summarizeChecklistMonth} from '../src/checklist-date.js';

const day = '2026-10-01';
const options = {uid: 'reader-fixture', day, stationIds: ['B', 'A']};
const flush = () => new Promise((resolve) => setImmediate(resolve));
function record(id, stationId = 'A', condition = 'SIM', date = day, createdAt = 20) {
  return {id, stationId, condition, date, createdAt, occurrence: condition === 'NAO' ? 'Ocorrência fictícia' : ''};
}
function document(value, pending = false) {
  return {id: value.id, data: () => ({...value}), metadata: {hasPendingWrites: pending}};
}
function snapshot(values = [], {fromCache = false, pending = false, changes, pendingIds = []} = {}) {
  const docs = values.map((value) => document(value, pendingIds.includes(value.id)));
  return {docs, metadata: {fromCache, hasPendingWrites: pending},
    docChanges: () => changes ?? docs.map((doc) => ({type: 'added', doc}))};
}
function harness(input = options) {
  const subscriptions = [], updates = [], failures = [], cacheWrites = [];
  let unsubscribed = 0;
  const sdk = {
    collection: (_db, name) => ({name}), query: (base, ...constraints) => ({base, constraints}),
    where: (field, operator, value) => ({type: 'where', field, operator, value}),
    orderBy: (field, direction) => ({type: 'order', field, direction}), limit: (count) => ({type: 'limit', count}),
    onSnapshot(query, metadata, next, error) {
      assert.deepEqual(metadata, {includeMetadataChanges: true});
      const subscription = {query, next, error, active: true}; subscriptions.push(subscription);
      return () => {assert.equal(subscription.active, true); subscription.active = false; unsubscribed++;};
    }
  };
  const stop = createChecklistReportListener(input, (value) => updates.push(value), (error) => failures.push(error),
    {sdk, db: {}, writeSafeCache: async (...args) => cacheWrites.push(args)});
  const prior = (id) => subscriptions.find((subscription) => subscription.query.constraints.some((constraint) => constraint.field === 'stationId' && constraint.value === id));
  return {sdk, subscriptions, updates, failures, cacheWrites, stop, prior, current: subscriptions[0], last: () => updates.at(-1), unsubscribed: () => unsubscribed};
}
function confirmEmptyHistory(h) {h.prior('A')?.next(snapshot()); h.prior('B')?.next(snapshot());}

test('queries limitadas usam os índices atuais, N+1 no período e um antecessor por arsenal', () => {
  const h = harness({...options, stationIds: ['A', 'B', 'A'], pageSize: 10});
  assert.equal(h.subscriptions.length, 3);
  assert.deepEqual(h.current.query.constraints, [
    {type: 'where', field: 'date', operator: '==', value: day},
    {type: 'order', field: 'createdAt', direction: 'desc'}, {type: 'limit', count: 11}
  ]);
  assert.deepEqual(h.prior('A').query.constraints, [
    {type: 'where', field: 'stationId', operator: '==', value: 'A'},
    {type: 'where', field: 'date', operator: '<', value: day},
    {type: 'order', field: 'date', direction: 'desc'},
    {type: 'order', field: 'createdAt', direction: 'desc'}, {type: 'limit', count: 1}
  ]);
  const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes;
  assert.ok(indexes.some((index) => index.collectionGroup === 'checklists' && index.fields.map((field) => field.fieldPath).join(',') === 'stationId,date,createdAt'));
  h.stop();
});

test('escopo mensal usa somente o mês selecionado, inclusive fevereiro bissexto', () => {
  const h = harness({uid: options.uid, month: '2028-02', stationIds: ['A']});
  assert.deepEqual(h.current.query.constraints, [
    {type: 'where', field: 'date', operator: '>=', value: '2028-02-01'},
    {type: 'where', field: 'date', operator: '<=', value: '2028-02-29'},
    {type: 'order', field: 'date', direction: 'asc'},
    {type: 'order', field: 'createdAt', direction: 'desc'}, {type: 'limit', count: 2001}
  ]);
  assert.equal(h.prior('A').query.constraints[1].value, '2028-02-01');
  assert.equal(checklistReportScope({uid: options.uid, day}).pageSize, 1000);
  h.stop();
});

test('recusa sessão, período, catálogo ou limites inválidos antes de criar listeners', () => {
  for (const value of [{day}, {...options, month: '2026-10'}, {...options, day: '2026-02-30'}, {...options, day: '0000-01-01'},
    {uid: options.uid, month: '2026-13'}, {...options, stationIds: ['bad/id']}, {...options, pageSize: 0}, {...options, pageSize: 1.5}]) {
    assert.throws(() => checklistReportScope(value));
  }
  assert.throws(() => checklistReportScope({...options, stationIds: Array.from({length: 201}, (_, index) => `A${index}`)}), /limite/);
});

test('inclui, edita e remove por id, mantendo a ordem real e apenas os arsenais alterados', () => {
  const h = harness(); confirmEmptyHistory(h);
  const first = record('first'), second = record('second', 'B');
  h.current.next(snapshot([first]));
  assert.deepEqual(h.last().records.map((item) => item.id), ['first']);
  assert.deepEqual(h.last().changedStationIds, ['A']);
  h.current.next(snapshot([second, first], {changes: [{type: 'added', doc: document(second)}]}));
  assert.deepEqual(h.last().records.map((item) => item.id), ['second', 'first']);
  assert.deepEqual(h.last().changedStationIds, ['B']);
  const modified = {...first, condition: 'NAO', stationId: 'B'};
  h.current.next(snapshot([second, modified], {changes: [{type: 'modified', doc: document(modified)}]}));
  assert.deepEqual(h.last().changedStationIds, ['A', 'B']);
  assert.equal(h.last().records.find((item) => item.id === 'first').condition, 'NAO');
  h.current.next(snapshot([second], {changes: [{type: 'removed', doc: document(modified)}]}));
  assert.deepEqual(h.last().records.map((item) => item.id), ['second']);
  assert.deepEqual(h.last().changedStationIds, ['B']);
  h.stop();
});

test('último NÃO anterior é herdado, nova resposta substitui e exclusão revela o antecessor', () => {
  const h = harness({...options, stationIds: ['A']});
  const station = {id: 'A', active: true}, previous = record('prior-failure', 'A', 'NAO', '2026-09-30');
  h.prior('A').next(snapshot([previous])); h.current.next(snapshot());
  const resolved = () => resolveChecklistDayRecord(station, h.last().records[0], h.last().priorRecords[0], day, day);
  assert.equal(resolved().inherited, true);
  const current = record('current'); h.current.next(snapshot([current], {changes: [{type: 'added', doc: document(current)}]}));
  assert.equal(resolved().id, 'current');
  h.current.next(snapshot([], {changes: [{type: 'removed', doc: document(current)}]}));
  assert.equal(resolved().id, 'prior-failure');
  h.prior('A').next(snapshot([record('older-ok', 'A', 'SIM', '2026-09-29')]));
  assert.equal(resolved(), null);
  h.stop();
});

test('verde exige metadata servidor de TODAS as fontes, sem pendência nem falha histórica', () => {
  const h = harness();
  h.current.next(snapshot([record('first')])); h.prior('A').next(snapshot());
  assert.equal(h.last().ready, false); assert.equal(h.last().confirmed, false); assert.equal(h.last().historyIncomplete, true);
  h.prior('B').next(snapshot([], {fromCache: true}));
  assert.equal(h.last().ready, true); assert.equal(h.last().confirmed, false); assert.equal(h.last().fromCache, true);
  h.prior('B').next(snapshot()); assert.equal(h.last().confirmed, true); assert.equal(h.last().stale, false);
  const error = new Error('Histórico indisponível'); h.prior('A').error(error);
  assert.equal(h.last().confirmed, false); assert.equal(h.last().historyIncomplete, true); assert.deepEqual(h.failures, [error]);
  h.prior('A').next(snapshot()); assert.equal(h.last().confirmed, true);
  h.stop();
});

test('reconcilia pendência SDK e confirmação posterior sem duplicar registros', () => {
  const h = harness({...options, stationIds: ['A']}); h.prior('A').next(snapshot());
  const pending = record('stable-request');
  h.current.next(snapshot([pending], {pending: true, pendingIds: [pending.id]}));
  assert.equal(h.last().records[0].pendingSync, true); assert.equal(h.last().confirmed, false); assert.equal(h.last().hasPendingWrites, true);
  h.current.next(snapshot([pending], {changes: [{type: 'modified', doc: document(pending)}]}));
  assert.equal(h.last().records.length, 1); assert.equal(h.last().records[0].pendingSync, undefined);
  assert.equal(h.last().confirmed, true); assert.equal(h.last().hasPendingWrites, false);
  h.stop();
});

test('dados pré-carregados são provisórios e nunca sobrescrevem snapshot mais recente', () => {
  const h = harness({...options, stationIds: ['A'], initial: {records: [record('old')], priorRecords: [], stale: false}});
  assert.equal(h.last().records[0].id, 'old'); assert.equal(h.last().confirmed, false);
  h.current.next(snapshot([record('new')])); h.prior('A').next(snapshot());
  assert.equal(h.last().records[0].id, 'new'); assert.equal(h.last().confirmed, true);
  h.stop();
});

test('snapshot somente de metadata mantém registros e marca perda de confirmação/reconexão', () => {
  const h = harness(); confirmEmptyHistory(h); const current = record('first');
  h.current.next(snapshot([current])); const accepted = h.last().records[0];
  h.current.next(snapshot([current], {fromCache: true, changes: []}));
  assert.equal(h.last().records[0], accepted); assert.equal(h.last().confirmed, false); assert.deepEqual(h.last().changedStationIds, []);
  h.current.next(snapshot([current], {changes: []})); assert.equal(h.last().confirmed, true);
  h.stop();
});

test('N+1 informa truncamento e impede confirmação de escopo incompleto', () => {
  const h = harness({...options, pageSize: 1}); confirmEmptyHistory(h);
  h.current.next(snapshot([record('first'), record('second', 'B')]));
  assert.equal(h.last().records.length, 1); assert.equal(h.last().truncated, true); assert.equal(h.last().confirmed, false);
  h.current.next(snapshot([record('first')], {changes: [{type: 'removed', doc: document(record('second', 'B'))}]}));
  assert.equal(h.last().truncated, false); assert.equal(h.last().confirmed, true);
  h.stop();
});

test('fecha cada listener uma vez e descarta callbacks tardios do período anterior', () => {
  const a = harness(), b = harness({...options, day: '2026-09-30'});
  a.current.next(snapshot([record('day-a')])); const length = a.updates.length;
  a.stop(); a.stop(); assert.equal(a.unsubscribed(), 3);
  a.current.next(snapshot([record('late-a')])); a.prior('A').next(snapshot([record('late-prior')])); a.current.error(new Error('Late failure'));
  assert.equal(a.updates.length, length); assert.equal(a.failures.length, 0);
  b.current.next(snapshot([record('day-b', 'A', 'SIM', '2026-09-30')])); confirmEmptyHistory(b);
  assert.equal(b.last().records[0].id, 'day-b'); b.stop();
});

test('28 históricos iniciam uma vez; resposta alterada não refaz queries nem históricos', () => {
  const ids = Array.from({length: 28}, (_, index) => `station-${index}`);
  const h = harness({...options, stationIds: ids});
  assert.equal(h.subscriptions.length, 29);
  for (const id of ids) h.prior(id).next(snapshot());
  const value = record('current', ids[0]); h.current.next(snapshot([value]));
  const changed = {...value, condition: 'NAO'};
  h.current.next(snapshot([changed], {changes: [{type: 'modified', doc: document(changed)}]}));
  assert.equal(h.subscriptions.length, 29); assert.equal(h.last().confirmed, true);
  assert.deepEqual(h.last().changedStationIds, [ids[0]]); h.stop(); assert.equal(h.unsubscribed(), 29);
});

test('cache seguro grava somente escopo completo do servidor e é cancelado após stop', async () => {
  const h = harness({...options, stationIds: ['A']}); h.prior('A').next(snapshot()); h.current.next(snapshot([record('first')], {fromCache: true}));
  await flush(); assert.equal(h.cacheWrites.length, 0);
  h.current.next(snapshot([record('first')], {changes: []})); await flush();
  assert.equal(h.cacheWrites.length, 1); assert.deepEqual(h.cacheWrites[0].slice(0, 3), [options.uid, 'checklists', day]);
  h.current.next(snapshot([record('first')], {changes: []})); await flush(); assert.equal(h.cacheWrites.length, 1);
  const next = record('next'); h.current.next(snapshot([next], {changes: [{type: 'added', doc: document(next)}, {type: 'removed', doc: document(record('first'))}]}));
  h.stop(); await flush(); assert.equal(h.cacheWrites.length, 1);
});

test('resumo mensal mantém herança até a próxima resposta após inclusão e exclusão', () => {
  const h = harness({uid: options.uid, month: '2026-10', stationIds: ['A']});
  const station = {id: 'A', active: true}; h.prior('A').next(snapshot([record('prior', 'A', 'NAO', '2026-09-30')]));
  const current = record('recovered', 'A', 'SIM', '2026-10-03'); h.current.next(snapshot([current]));
  let days = summarizeChecklistMonth('2026-10', '2026-10-04', [station], h.last().records, h.last().priorRecords);
  assert.equal(days[0].inherited, 1); assert.equal(days[2].conforming, 1); assert.equal(days[3].inherited, 0);
  h.current.next(snapshot([], {changes: [{type: 'removed', doc: document(current)}]}));
  days = summarizeChecklistMonth('2026-10', '2026-10-04', [station], h.last().records, h.last().priorRecords);
  assert.equal(days[3].inherited, 1); h.stop();
});


test('id de arsenal chamado current não confunde metadata do histórico com a query principal', () => {
  const h = harness({...options, stationIds: ['current']});
  h.prior('current').next(snapshot());
  assert.equal(h.last().ready, false); assert.equal(h.last().confirmed, false);
  h.current.next(snapshot()); assert.equal(h.last().ready, true); assert.equal(h.last().confirmed, true);
  h.stop();
});

test('consumidor pode montar overlay local sem contaminar arrays nem cache do listener', async () => {
  const h = harness({...options, stationIds: ['A']}); h.prior('A').next(snapshot());
  h.current.next(snapshot([record('server')]));
  h.last().records.push({...record('local'), pendingSync: true});
  h.last().stationIds.push('LOCAL');
  await flush();
  assert.equal(h.cacheWrites[0][3].records.length, 1); assert.deepEqual(h.cacheWrites[0][3].stationIds, ['A']);
  h.current.next(snapshot([record('server')], {changes: []}));
  assert.deepEqual(h.last().records.map((item) => item.id), ['server']); h.stop();
});

test('erro de permissão na query do dia nunca indica confirmação e não limpa outros escopos', () => {
  const h = harness(); confirmEmptyHistory(h);
  const error = Object.assign(new Error('Acesso recusado'), {code: 'permission-denied'});
  h.current.error(error);
  assert.equal(h.last().confirmed, false); assert.equal(h.last().stale, true); assert.equal(h.last().error, error);
  assert.deepEqual(h.failures, [error]); h.stop();
});

test('janela mensal cresce somente por loadedLimit explícito, mantendo sentinela e cursor consistente', () => {
  const input = {uid: options.uid, month: '2026-10', stationIds: ['A'], pageSize: 2};
  const first = harness(input); first.prior('A').next(snapshot());
  const values = [record('A'), record('B'), record('C'), record('D'), record('E')];
  first.current.next(snapshot(values.slice(0, 3)));
  assert.deepEqual(first.last().records.map((item) => item.id), ['A', 'B']); assert.equal(first.last().hasMore, true);
  assert.equal(first.last().truncated, true); assert.equal(first.last().confirmed, false);
  assert.deepEqual(first.last().nextCursor, {live: true, loadedLimit: 2, nextLimit: 4}); assert.equal(first.last().nextLimit, 4);
  const nextLimit = first.last().nextCursor.nextLimit; first.stop();
  const next = harness({...input, loadedLimit: nextLimit}); next.prior('A').next(snapshot());
  assert.deepEqual(next.current.query.constraints.at(-1), {type: 'limit', count: 5});
  next.current.next(snapshot(values.slice(0, 4)));
  assert.deepEqual(next.last().records.map((item) => item.id), ['A', 'B', 'C', 'D']); assert.equal(next.last().hasMore, false);
  assert.equal(next.last().nextCursor, null); assert.equal(next.last().confirmed, true); next.stop();
  const larger = checklistReportScope({...input, pageSize: 2000, loadedLimit: 4000}); assert.equal(larger.loadedLimit, 4000);
});

test('inclusão no início substitui prefixo mensal e marca arsenal que saiu para a sentinela', () => {
  const h = harness({uid: options.uid, month: '2026-10', stationIds: ['A', 'B'], pageSize: 2}); confirmEmptyHistory(h);
  const first = record('first', 'A'), second = record('second', 'B'), sentinel = record('sentinel', 'A');
  h.current.next(snapshot([first, second, sentinel])); const incoming = record('incoming', 'A');
  h.current.next(snapshot([incoming, first, second], {changes: [{type: 'added', doc: document(incoming)}, {type: 'removed', doc: document(sentinel)}]}));
  assert.deepEqual(h.last().records.map((item) => item.id), ['incoming', 'first']);
  assert.deepEqual(h.last().changedStationIds, ['A', 'B']); assert.equal(h.last().hasMore, true);
  h.current.next(snapshot([first, second, sentinel], {changes: [{type: 'removed', doc: document(incoming)}, {type: 'added', doc: document(sentinel)}]}));
  assert.deepEqual(h.last().records.map((item) => item.id), ['first', 'second']); assert.deepEqual(h.last().changedStationIds, ['A', 'B']); h.stop();
});

test('limites de janela inválidos não criam queries, diário permanece até mil e sem carregar mais', () => {
  const monthly = {uid: options.uid, month: '2026-10', pageSize: 2};
  for (const loadedLimit of [0, 1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER - 1]) {
    assert.throws(() => checklistReportScope({...monthly, loadedLimit}), /limite/);
  }
  assert.throws(() => checklistReportScope({...options, loadedLimit: 1001}), /limite/);
  const h = harness({...options, pageSize: 1}); confirmEmptyHistory(h); h.current.next(snapshot([record('first'), record('second')]));
  assert.equal(h.last().truncated, true); assert.equal(h.last().hasMore, false); assert.equal(h.last().nextCursor, null); h.stop();
});


test('cache vazio inicial do SDK preserva dia e antecessores offline até a primeira confirmação real', () => {
  const current = record('cached-day'), previous = record('cached-prior', 'A', 'NAO', '2026-09-30');
  const h = harness({...options, stationIds: ['A'], initial: {records: [current], priorRecords: [previous]}});
  h.current.next(snapshot([], {fromCache: true})); h.prior('A').next(snapshot([], {fromCache: true}));
  assert.deepEqual(h.last().records.map(item => item.id), ['cached-day']);
  assert.deepEqual(h.last().priorRecords.map(item => item.id), ['cached-prior']);
  assert.equal(h.last().ready, true); assert.equal(h.last().confirmed, false); assert.equal(h.last().fromCache, true);
  h.current.next(snapshot());
  assert.equal(h.last().records.length, 0); assert.equal(h.last().priorRecords[0].id, 'cached-prior'); assert.equal(h.last().confirmed, false);
  h.prior('A').next(snapshot());
  assert.equal(h.last().priorRecords.length, 0); assert.equal(h.last().confirmed, true); h.stop();
});

test('snapshot vazio com escrita pendente não apaga a base segura antes de confirmação', () => {
  const h = harness({...options, stationIds: ['A'], initial: {records: [record('cached')], priorRecords: [record('prior', 'A', 'NAO', '2026-09-30')]}});
  h.current.next(snapshot([], {pending: true})); h.prior('A').next(snapshot([], {pending: true}));
  assert.equal(h.last().records[0].id, 'cached'); assert.equal(h.last().priorRecords[0].id, 'prior'); assert.equal(h.last().hasPendingWrites, true);
  h.current.next(snapshot()); h.prior('A').next(snapshot());
  assert.equal(h.last().records.length, 0); assert.equal(h.last().priorRecords.length, 0); assert.equal(h.last().confirmed, true); h.stop();
});


test('cache SDK parcial mantém todos os IDs da base segura até confirmação autoritativa', () => {
  const safeA = record('safe-A', 'A', 'SIM'), safeB = record('safe-B', 'B', 'NAO');
  const h = harness({...options, initial: {records: [safeA, safeB], priorRecords: []}});
  h.current.next(snapshot([safeA], {fromCache: true})); h.prior('A').next(snapshot([], {fromCache: true})); h.prior('B').next(snapshot([], {fromCache: true}));
  assert.deepEqual(h.last().records.map(item => item.id).sort(), ['safe-A', 'safe-B']); assert.equal(h.last().confirmed, false);
  h.current.next(snapshot([safeA]));
  assert.deepEqual(h.last().records.map(item => item.id), ['safe-A']); assert.equal(h.last().confirmed, false);
  h.prior('A').next(snapshot()); h.prior('B').next(snapshot()); assert.equal(h.last().confirmed, true); h.stop();
});

test('cache SDK histórico mais antigo não perde NÃO recente; servidor pode revelar antecessor após exclusão', () => {
  const safeFailure = record('safe-NAO', 'A', 'NAO', '2026-09-30', 30), oldOkay = record('older-SIM', 'A', 'SIM', '2026-09-28', 28);
  const h = harness({...options, stationIds: ['A'], initial: {records: [], priorRecords: [safeFailure]}});
  h.current.next(snapshot([], {fromCache: true})); h.prior('A').next(snapshot([oldOkay], {fromCache: true}));
  assert.equal(h.last().priorRecords[0].id, 'safe-NAO');
  assert.equal(resolveChecklistDayRecord({id:'A',active:true}, null, h.last().priorRecords[0], day, day).condition, 'NAO');
  h.prior('A').next(snapshot([record('older-same-day', 'A', 'SIM', '2026-09-30', 10)], {fromCache: true}));
  assert.equal(h.last().priorRecords[0].id, 'safe-NAO');
  h.prior('A').next(snapshot([oldOkay])); h.current.next(snapshot());
  assert.equal(h.last().priorRecords[0].id, 'older-SIM'); assert.equal(h.last().confirmed, true);
  assert.equal(resolveChecklistDayRecord({id:'A',active:true}, null, h.last().priorRecords[0], day, day), null); h.stop();
});

test('cache parcial combina novas respostas sem apagar IDs, sem confirmar ou gravar cache antes do servidor', async () => {
  const older = record('retained', 'A', 'SIM', day, 10), newer = record('incoming', 'B', 'NAO', day, 30);
  const h = harness({...options, initial: {records: [older], priorRecords: []}});
  h.current.next(snapshot([newer], {fromCache: true})); h.prior('A').next(snapshot([], {fromCache: true})); h.prior('B').next(snapshot([], {fromCache: true}));
  assert.deepEqual(h.last().records.map(item => item.id), ['incoming', 'retained']); assert.equal(h.last().confirmed, false);
  await flush(); assert.equal(h.cacheWrites.length, 0);
  h.current.next(snapshot([newer])); h.prior('A').next(snapshot()); h.prior('B').next(snapshot());
  await flush(); assert.deepEqual(h.last().records.map(item => item.id), ['incoming']); assert.equal(h.cacheWrites.length, 1); h.stop();
});
