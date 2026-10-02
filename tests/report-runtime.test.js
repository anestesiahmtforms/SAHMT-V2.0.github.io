import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportRuntime} from '../src/report-runtime.js';
import {createStartupReportCache} from '../src/startup-report-cache.js';
import {mergeReportPendingRecords} from '../src/report-pending.js';
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
const settle = () => new Promise(resolve => setImmediate(resolve));
const scope = (period = '2026-10-01', extra = {}) => ({key: `A:events:${period}:read`, uid: 'A', module: 'events', from: period, to: period, sigla: 'FA', permissionKey: 'read', ...extra});
const record = (id, fields = {}) => ({id, active: true, date: '2026-10-01', createdByUid: 'A', version: 1, createdAt: '2026-10-01T12:00:00Z', ...fields});
const payload = records => ({records, nextCursor: null});
const operation = (id, extra = {}) => ({uid: 'A', type: 'events', requestId: id, status: 'queued', createdAt: Date.parse('2026-10-01T13:00:00Z'), payload: {collectionName: 'events', data: {date: '2026-10-01', memberSigla: 'FA'}}, ...extra});
function mergePayload(kind, value, operations, currentScope) {
  const collection = kind === 'checklist' ? 'checklists' : kind;
  if (value.report) return {...value, report: {...value.report, records: mergeReportPendingRecords(collection, value.report.records, operations, currentScope)}};
  return {...value, records: mergeReportPendingRecords(collection, value.records, operations, currentScope)};
}
function harness(options = {}) {
  const subscriptions = [], stopped = [], data = [], states = [], reads = [], order = [];
  const runtime = createReportRuntime({
    subscribe: (kind, currentScope, hooks) => {
      const index = subscriptions.length; subscriptions.push({kind, scope: currentScope, hooks}); order.push(`start:${index}`);
      return () => {stopped.push(index); order.push(`stop:${index}`);};
    },
    onData: (kind, value, currentScope) => data.push({kind, value, scope: currentScope}),
    onState: (kind, state) => states.push({kind, ...state}),
    readPending: async uid => {reads.push(uid); return [];},
    mergePending: mergePayload,
    ...options
  });
  const next = (value, {index = subscriptions.length - 1, source = 'report', ...metadata} = {}) => subscriptions[index].hooks.next(source, {data: value, fromCache: false, hasPendingWrites: false, complete: true, ...metadata});
  return {runtime, subscriptions, stopped, data, states, reads, order, next, last: () => data.at(-1), state: () => states.at(-1)};
}

test('warm e open do mesmo escopo usam um listener e republicam dados com owner aberto', async () => {
  const h = harness(), lease = h.runtime.warm('events', scope()); await settle(); h.next(payload([record('A')]));
  const controller = h.runtime.open('events', scope());
  assert.equal(controller, lease.controller); assert.equal(h.subscriptions.length, 1); assert.equal(h.reads.length, 1);
  assert.equal(h.last().scope.warm, false); assert.equal(controller.snapshot().scope.warm, false); assert.equal(h.runtime.get('events'), controller);
  lease.close(); assert.deepEqual(h.stopped, []); h.next(payload([record('B')])); assert.equal(h.last().value.records[0].id, 'B'); h.runtime.clear();
});

test('handoff usa guard do escopo atual em vez do antigo warm', async () => {
  let warmCurrent = true, opened = false;
  const h = harness({isCurrent: value => value.warm ? warmCurrent : opened}), lease = h.runtime.warm('events', scope()); await settle();
  opened = true; h.runtime.open('events', scope()); warmCurrent = false; lease.close(); h.next(payload([record('A')]));
  assert.equal(h.state().state, 'server'); assert.equal(h.last().scope.warm, false); assert.deepEqual(h.stopped, []); h.runtime.clear();
});

test('lease de warm é estável e expiração fecha somente o owner ainda pré-carregado', () => {
  const h = harness(), old = h.runtime.warm('events', scope()); assert.equal(h.runtime.warm('events', scope()), old);
  const newer = h.runtime.warm('events', scope('2026-10-02')); old.close(); assert.equal(h.runtime.get('events'), newer.controller);
  newer.close(); newer.close(); assert.equal(h.runtime.get('events'), null); assert.deepEqual(h.stopped, [0, 1]);
});

test('cache startup transfere lease sem novo subscribe e clear não fecha relatório aberto', async () => {
  const h = harness(), cache = createStartupReportCache(), value = scope();
  cache.holdLive(value.key, h.runtime.warm('events', value)); await settle(); h.next(payload([record('A')]));
  const lease = cache.takeLive(value.key), controller = h.runtime.open('events', value); assert.equal(controller, lease.controller); cache.clear(); lease.close();
  assert.equal(h.subscriptions.length, 1); assert.deepEqual(h.stopped, []); h.runtime.clear();
});

test('warm posterior não substitui período já aberto', () => {
  const h = harness(), controller = h.runtime.open('events', scope()); const lease = h.runtime.warm('events', scope('2026-10-02'));
  assert.equal(lease.controller, controller); assert.equal(h.subscriptions.length, 1); lease.close(); assert.equal(h.runtime.get('events'), controller); h.runtime.clear();
});

test('mudança de período troca somente controller daquele kind e fecha antes de assinar novo', async () => {
  const h = harness(), old = h.runtime.open('events', scope()); const labels = h.runtime.open('labels', scope(undefined, {key: 'A:labels', module: 'labels'})); await settle();
  h.next(payload([record('old')]), {index: 0}); const current = h.runtime.open('events', scope('2026-10-02'));
  assert.notEqual(current, old); assert.equal(h.runtime.get('labels'), labels); assert.deepEqual(h.order, ['start:0', 'start:1', 'stop:0', 'start:2']);
  assert.equal(current.snapshot().data, null); const count = h.data.length; h.next(payload([record('late')]), {index: 0}); assert.equal(h.data.length, count); h.runtime.clear();
});

test('mesmo key não reaproveita UID, permissão, período, limite ou catálogo diferentes', () => {
  for (const changed of [{uid: 'B'}, {permissionKey: 'manage'}, {from: '2026-10-02'}, {loadedLimit: 200}, {stationIds: ['station']}, {sigla: 'FB'}]) {
    const h = harness(), first = h.runtime.open('events', scope()), second = h.runtime.open('events', scope(undefined, changed));
    assert.notEqual(first, second); assert.equal(h.subscriptions.length, 2); assert.deepEqual(h.stopped, [0]); h.runtime.clear();
  }
});

test('primeira leitura pending bloqueia green até resolução inclusive snapshot síncrono', async () => {
  const read = deferred(); const subscriptions = [];
  const h = harness({readPending: () => read.promise, subscribe: (kind, value, hooks) => {
    subscriptions.push(hooks); hooks.next({data: payload([record('A')]), fromCache: false, hasPendingWrites: false, complete: true}); return () => {};
  }});
  const controller = h.runtime.open('events', scope()); assert.equal(controller.snapshot().state, 'pending'); assert.ok(h.states.every(state => !state.confirmed));
  read.resolve([]); await settle(); assert.equal(controller.snapshot().state, 'server'); assert.equal(h.state().confirmed, true); assert.equal(h.last().value.records[0].id, 'A'); h.runtime.clear();
});

test('readPending é compartilhado por UID e snapshots não iniciam novas leituras', async () => {
  const read = deferred(), calls = [];
  const h = harness({readPending: uid => {calls.push(uid); return read.promise;}});
  h.runtime.open('events', scope()); h.runtime.open('labels', scope(undefined, {key: 'A:labels', module: 'labels'})); await settle(); assert.deepEqual(calls, ['A']);
  h.next(payload([record('event')]), {index: 0}); h.next(payload([record('label')]), {index: 1}); read.resolve([]); await settle();
  for (let index = 0; index < 5; index++) h.next(payload([record(`event-${index}`)]), {index: 0});
  assert.deepEqual(calls, ['A']); assert.equal(h.runtime.get('events').snapshot().confirmed, true); assert.equal(h.runtime.get('labels').snapshot().confirmed, true); h.runtime.clear();
});

test('troca A para B ignora pending e snapshots tardios da sessão A', async () => {
  const pendingA = deferred(), pendingB = deferred(), calls = [];
  const h = harness({readPending: uid => {calls.push(uid); return uid === 'A' ? pendingA.promise : pendingB.promise;}});
  const old = h.runtime.open('events', scope()); await settle(); h.next(payload([record('A')]));
  const controller = h.runtime.open('events', scope(undefined, {key: 'B:events', uid: 'B', sigla: 'FB'})); await settle(); h.next(payload([record('B', {createdByUid: 'B'})]));
  const count = h.data.length; pendingA.resolve([operation('secret-A')]); await settle(); h.next(payload([record('late-A')]), {index: 0});
  assert.equal(h.data.length, count); assert.equal(old.snapshot().data, null); assert.equal(controller.snapshot().state, 'pending');
  pendingB.resolve([]); await settle(); assert.deepEqual(h.last().value.records.map(item => item.id), ['B']); assert.deepEqual(calls, ['A', 'B']); h.runtime.clear();
});

test('fila local só aparece após leitura, mantém flag e não entra no escopo de etiquetas', async () => {
  const read = deferred(), h = harness({readPending: () => read.promise});
  const controller = h.runtime.open('events', scope()); h.runtime.open('labels', scope(undefined, {key: 'A:labels', module: 'labels'}));
  h.next(payload([record('remote')]), {index: 0}); h.next(payload([record('label')]), {index: 1}); read.resolve([operation('local')]); await settle();
  assert.equal(controller.snapshot().localPending, true); assert.equal(controller.snapshot().state, 'pending'); assert.ok(controller.snapshot().data.records.some(item => item.id === 'local' && item.pendingFirestore));
  assert.deepEqual(h.runtime.get('labels').snapshot().data.records.map(item => item.id), ['label']); assert.equal(h.runtime.get('labels').snapshot().confirmed, true); h.runtime.clear();
});

test('invalidation reaplica fila a todos controllers do UID sem consultar Firestore outra vez', async () => {
  let operations = [operation('local')]; let reads = 0;
  const h = harness({readPending: async () => {reads++; return operations;}}); const controller = h.runtime.open('events', scope());
  h.runtime.open('labels', scope(undefined, {key: 'A:labels', module: 'labels'})); await settle(); h.next(payload([record('remote')]), {index: 0}); h.next(payload([record('label')]), {index: 1});
  assert.equal(controller.snapshot().state, 'pending'); operations = []; const count = h.subscriptions.length;
  const invalidation = h.runtime.invalidatePending('A'); assert.equal(controller.snapshot().confirmed, false); await invalidation;
  assert.deepEqual(controller.snapshot().data.records.map(item => item.id), ['remote']); assert.equal(controller.snapshot().confirmed, true); assert.equal(h.subscriptions.length, count); assert.equal(reads, 2); h.runtime.clear();
});

test('aceitação por requestId não reinsere fila antiga e invalidation não abre listener', async () => {
  let operations = [operation('local')]; const h = harness({readPending: async () => operations}); const controller = h.runtime.open('events', scope()); await settle(); h.next(payload([]));
  assert.equal(controller.snapshot().state, 'pending'); h.next(payload([record('local', {clientMutationId: 'local'})]));
  assert.equal(controller.snapshot().confirmed, true); assert.equal(controller.snapshot().data.records.length, 1); assert.equal(controller.snapshot().data.records[0].pendingFirestore, undefined);
  operations = []; await h.runtime.invalidatePending('A'); assert.equal(controller.snapshot().data.records.length, 1); assert.equal(h.subscriptions.length, 1); h.runtime.clear();
});

test('invalidations concorrentes durante leitura coalescem e pedem só uma reconciliação seguinte', async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  const h = harness({readPending: () => (++reads === 1 ? first.promise : second.promise)}), controller = h.runtime.open('events', scope()); await settle(); h.next(payload([record('A')]));
  const one = h.runtime.invalidatePending('A'), two = h.runtime.invalidatePending('A'); assert.equal(one, two); assert.equal(reads, 1);
  first.resolve([operation('old')]); await settle(); assert.equal(reads, 2); assert.equal(controller.snapshot().confirmed, false);
  second.resolve([]); assert.equal(await one, true); assert.deepEqual(controller.snapshot().data.records.map(item => item.id), ['A']); assert.equal(controller.snapshot().confirmed, true); h.runtime.clear();
});

test('falha de leitura pending mantém erro, bloqueia green e retry sem query recupera', async () => {
  let fail = true; const error = new Error('Fila indisponível');
  const h = harness({readPending: async () => {if (fail) throw error; return [];}}), controller = h.runtime.open('events', scope()); h.next(payload([record('A')])); await settle();
  assert.equal(controller.snapshot().state, 'error'); assert.equal(controller.snapshot().error, error); assert.equal(controller.snapshot().confirmed, false); assert.equal(controller.snapshot().data.records[0].id, 'A');
  fail = false; assert.equal(await h.runtime.invalidatePending('A'), true); assert.equal(controller.snapshot().confirmed, true); assert.equal(h.subscriptions.length, 1); h.runtime.clear();
});

test('readPending inválido e merge quebrado nunca são confirmação de servidor', async () => {
  const invalid = harness({readPending: async () => null}), first = invalid.runtime.open('events', scope()); invalid.next(payload([])); await settle(); assert.equal(first.snapshot().state, 'error'); invalid.runtime.clear();
  const broken = harness({mergePending: () => {throw new Error('Falha ao reconciliar');}}), second = broken.runtime.open('events', scope()); await settle(); broken.next(payload([record('A')]));
  assert.equal(second.snapshot().state, 'error'); assert.equal(second.snapshot().confirmed, false); assert.equal(second.snapshot().data, null); assert.equal(broken.data.length, 0); broken.runtime.clear();
});

test('composite Checklist só reconcilia report.records e mantém catálogo e herança', async () => {
  const op = operation('local', {type: 'checklists', payload: {collectionName: 'checklists', data: {date: '2026-10-01', stationId: 'station-A'}}});
  const h = harness({readPending: async () => [op]}), controller = h.runtime.open('checklist', scope(undefined, {key: 'A:checklist', module: 'checklist', sourceKeys: ['report', 'catalog']})); await settle();
  const catalog = {records: [{id: 'station-A', active: false}], truncated: false}, priorRecords = [record('prior', {date: '2026-09-30'})];
  h.next({records: [record('checklist')], priorRecords, historyIncomplete: false}); assert.equal(h.data.length, 0);
  h.next(catalog, {source: 'catalog', fromCache: true}); const result = h.last().value;
  assert.equal(result.catalog, catalog); assert.equal(result.report.priorRecords, priorRecords); assert.ok(result.report.records.some(item => item.id === 'local' && item.pendingSync));
  assert.equal(controller.snapshot().confirmed, false); assert.equal(h.last().scope.sourceKeys.length, 2); h.runtime.clear();
});

test('metadata por snapshot é emitida mesmo com conteúdo idêntico; cache e SDK pending não ficam verdes', async () => {
  const h = harness(), controller = h.runtime.open('events', scope()); await settle(); const value = payload([record('A')]);
  h.next(value, {fromCache: true}); assert.equal(controller.snapshot().state, 'awaiting'); const count = h.data.length;
  h.next(value, {hasPendingWrites: true}); assert.equal(controller.snapshot().state, 'pending'); assert.equal(h.data.length, count + 1);
  h.next(value); assert.equal(controller.snapshot().state, 'server'); assert.equal(h.data.length, count + 2); h.runtime.clear();
});

test('setOnline não cria nova consulta e usa preferência também para controllers futuros', async () => {
  const h = harness(); h.runtime.setOnline(false); const controller = h.runtime.open('events', scope()); await settle(); h.next(payload([record('A')])); assert.equal(controller.snapshot().state, 'offline');
  h.runtime.setOnline(true); assert.equal(controller.snapshot().confirmed, true); assert.equal(h.subscriptions.length, 1); h.runtime.clear();
});

test('refresh e force preservam controller mas reiniciam fonte sem reutilizar metadata antiga', async () => {
  const h = harness(), controller = h.runtime.open('events', scope()); await settle(); h.next(payload([record('A')])); assert.equal(controller.snapshot().confirmed, true);
  assert.equal(h.runtime.refresh('events', 'resume'), true); assert.equal(h.runtime.get('events'), controller); assert.equal(controller.snapshot().confirmed, false); assert.deepEqual(h.stopped, [0]);
  h.next(payload([record('late')]), {index: 0}); assert.equal(controller.snapshot().data.records[0].id, 'A'); h.next(payload([record('B')]));
  assert.equal(h.runtime.open('events', scope(), {force: true}), controller); assert.equal(h.subscriptions.length, 3); assert.equal(controller.snapshot().confirmed, false); h.runtime.clear();
});

test('refresh também repete leitura pending que falhou e não conserva erro após recuperação', async () => {
  let fail = true; const h = harness({readPending: async () => {if (fail) throw new Error('Fila'); return [];}}), controller = h.runtime.open('events', scope()); h.next(payload([])); await settle();
  assert.equal(controller.snapshot().state, 'error'); fail = false; h.runtime.refresh('events'); await settle(); h.next(payload([])); assert.equal(controller.snapshot().confirmed, true); assert.equal(controller.snapshot().error, null); h.runtime.clear();
});

test('close e clear descartam memória privada e callbacks pending tardios', async () => {
  const read = deferred(), h = harness({readPending: () => read.promise});
  const first = h.runtime.open('events', scope()), second = h.runtime.open('labels', scope(undefined, {key: 'A:labels', module: 'labels'})); await settle(); h.next(payload([record('private')]));
  h.runtime.close('events'); h.runtime.close('events'); h.runtime.clear(); const count = h.data.length; read.resolve([operation('late')]); await settle(); h.next(payload([record('late')]));
  assert.equal(h.data.length, count); assert.equal(first.snapshot().data, null); assert.equal(second.snapshot().data, null); assert.equal(h.runtime.get('events'), null); assert.deepEqual(h.stopped.sort(), [0, 1]); assert.equal(await h.runtime.invalidatePending('A'), false);
});

test('revogação externa durante pending read encerra listeners sem publicar dados resolvidos', async () => {
  let current = true; const read = deferred(), h = harness({readPending: () => read.promise, isCurrent: () => current}); const controller = h.runtime.open('events', scope()); await settle(); h.next(payload([record('private')]));
  current = false; const count = h.data.length; read.resolve([operation('private-local')]); await settle(); assert.equal(h.data.length, count); assert.equal(h.runtime.get('events'), null); assert.equal(controller.snapshot().data, null); assert.deepEqual(h.stopped, [0]);
});

test('get e snapshot descartam escopo revogado mesmo sem novo evento Firestore', async () => {
  let current = true; const h = harness({isCurrent: () => current}), controller = h.runtime.open('events', scope()); await settle(); h.next(payload([record('private')])); current = false;
  assert.equal(h.runtime.get('events'), null); assert.equal(controller.snapshot().data, null); assert.deepEqual(h.stopped, [0]);
});

test('setup async antigo é encerrado ao concluir e rejeição velha não falha controller novo', async () => {
  const setup = deferred(), releases = []; let calls = 0;
  const h = harness({subscribe: () => ++calls === 1 ? setup.promise : () => releases.push('new')});
  h.runtime.open('events', scope()); const controller = h.runtime.open('events', scope('2026-10-02')); setup.resolve(() => releases.push('old')); await settle(); assert.deepEqual(releases, ['old']); assert.equal(controller.snapshot().error, null); h.runtime.clear(); assert.deepEqual(releases, ['old', 'new']);
});

test('escopo inválido fecha owner e não assina consulta nova; factory inválida é recusada', () => {
  for (const invalid of [{}, scope(undefined, {uid: ''}), scope(undefined, {authorized: false})]) {
    const h = harness(), controller = h.runtime.open('events', scope()); assert.equal(h.runtime.open('events', invalid), null); assert.equal(controller.snapshot().data, null); assert.deepEqual(h.stopped, [0]); assert.equal(h.subscriptions.length, 1);
  }
  assert.throws(() => createReportRuntime({}), /adaptador/); assert.throws(() => harness().runtime.open('', scope()), /relatório/);
});

test('fechar último owner limpa snapshot pending compartilhado para nova sessão do mesmo UID', async () => {
  let reads = 0; const h = harness({readPending: async () => {reads++; return [];}}); h.runtime.open('events', scope()); await settle(); h.runtime.clear();
  h.runtime.open('events', scope()); await settle(); assert.equal(reads, 2); h.runtime.clear();
});

test('close antes do microtask inicial cancela a leitura pending sem owner', async () => {
  const h = harness(); h.runtime.open('events', scope()); h.runtime.clear(); await settle(); assert.deepEqual(h.reads, []); assert.deepEqual(h.stopped, [0]);
});

test('mergePending assíncrono é recusado em vez de confirmar payload não reconciliado', async () => {
  const h = harness({mergePending: async value => value}), controller = h.runtime.open('events', scope()); await settle(); h.next(payload([record('A')]));
  assert.equal(controller.snapshot().confirmed, false); assert.equal(controller.snapshot().state, 'error'); assert.match(controller.snapshot().error.message, /síncrona/); h.runtime.clear();
});
