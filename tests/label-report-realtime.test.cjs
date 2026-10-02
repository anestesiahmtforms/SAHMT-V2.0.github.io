const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const original = readFileSync(join(__dirname, '../src/label-report-reader.js'), 'utf8');
const source = original.split('\n').filter(line => !line.startsWith('import ')).join('\n').replaceAll('export ', '')
  .replaceAll("import('./firebase.js')", 'Promise.resolve({db: mockedRealtimeDb})')
  .replaceAll("import('firebase/firestore')", 'Promise.resolve(realtimeSdk)');
const scope = {from: '2026-10-01', to: '2026-10-31', uid: 'reader-A', sigla: 'FA', pageSize: 2};
const doc = (id, fields = {}, pending = false) => ({id, metadata: {hasPendingWrites: pending}, data: () => ({id, active: true, date: '2026-10-01', createdByUid: 'reader-A', staffSiglas: ['FA'], version: 1, createdAt: '2026-10-01T12:00:00.000Z', ...fields})});
const snapshot = (docs, {fromCache = false, hasPendingWrites = false} = {}) => ({docs, metadata: {fromCache, hasPendingWrites}});
function setup({nullDb = false, throwAt = null, syncError = false} = {}) {
  const listeners = [], reports = [], errors = [], queryArgs = [];
  const realtimeSdk = {
    collection: (_db, name) => ({collection: name}), where: (...args) => ({where: args}), orderBy: (...args) => ({order: args}), limit: size => ({limit: size}),
    query: (...args) => {queryArgs.push(args); return args;},
    onSnapshot: (query, options, next, error) => {
      const index = listeners.length;
      if (throwAt === index) throw new Error('Setup recusado');
      const listener = {query, options, next, error, stopped: false, stopCount: 0}; listeners.push(listener);
      if (syncError) error(new Error('Erro imediato'));
      return () => {listener.stopped = true; listener.stopCount++;};
    }
  };
  const context = vm.createContext({mockedRealtimeDb: nullDb ? null : {}, realtimeSdk, console});
  vm.runInContext(source, context);
  return {context, listeners, reports, errors, queryArgs,
    watch: options => context.watchLabelRecords({...scope, ...options}, report => reports.push(report), error => errors.push(error)),
    emit: (index, docs, metadata) => listeners[index].next(snapshot(docs, metadata)),
    last: () => reports.at(-1)};
}

const ids = report => Array.from(report.records, record => record.id);
const changes = report => Array.from(report.changes, change => `${change.type}:${change.id}`);

test('usuário comum mantém duas consultas autorizadas, período limitado, sentinel e metadados', async () => {
  const h = setup(), stop = await h.watch();
  assert.equal(h.listeners.length, 2);
  const [own, staff] = h.queryArgs;
  for (const query of h.queryArgs) {
    assert.equal(query[0].collection, 'labels');
    assert.ok(query.some(value => value.where?.join('|') === 'active|==|true'));
    assert.ok(query.some(value => value.where?.join('|') === 'date|>=|2026-10-01'));
    assert.ok(query.some(value => value.where?.join('|') === 'date|<=|2026-10-31'));
    assert.ok(query.some(value => value.order?.join('|') === 'date|desc'));
    assert.equal(query.find(value => value.limit)?.limit, 3);
  }
  assert.ok(own.some(value => value.where?.join('|') === 'createdByUid|==|reader-A'));
  assert.ok(staff.some(value => value.where?.join('|') === 'staffSiglas|array-contains|FA'));
  assert.ok(h.listeners.every(listener => listener.options.includeMetadataChanges === true));
  h.emit(0, [doc('A')], {fromCache: true}); assert.equal(h.reports.length, 0);
  h.emit(1, [doc('A'), doc('B')]);
  assert.deepEqual(ids(h.last()), ['A', 'B']); assert.equal(h.last().fromCache, true); assert.equal(h.last().serverConfirmed, false);
  h.emit(0, [doc('A')]);
  assert.equal(h.last().fromCache, false); assert.equal(h.last().serverConfirmed, true); assert.deepEqual(changes(h.last()), []);
  stop(); assert.ok(h.listeners.every(listener => listener.stopped));
});

test('administrador usa uma consulta e sigla vazia limita comum à autoria', async () => {
  for (const [options, expected, isAdmin] of [[{canManage: true}, 1, true], [{sigla: ''}, 1, false]]) {
    const h = setup(), stop = await h.watch(options); assert.equal(h.listeners.length, expected);
    const hasActor = h.queryArgs[0].some(value => value.where?.[0] === 'createdByUid' || value.where?.[0] === 'staffSiglas');
    assert.equal(hasActor, !isAdmin); stop();
  }
});

test('dia único usa igualdade e limite carregado cresce além de 100 sem cursor instável', async () => {
  const h = setup(), stop = await h.watch({from: scope.from, to: scope.from, canManage: true, pageSize: 500, loadedLimit: 150});
  assert.ok(h.queryArgs[0].some(value => value.where?.join('|') === 'date|==|2026-10-01'));
  assert.ok(!h.queryArgs[0].some(value => value.where?.[1] === '>=' || value.where?.[1] === '<='));
  assert.equal(h.queryArgs[0].find(value => value.limit)?.limit, 151);
  h.emit(0, Array.from({length: 151}, (_, index) => doc(String(index))));
  assert.equal(h.last().records.length, 150); assert.equal(h.last().hasMore, true);
  assert.equal(h.last().nextCursor.live, true); assert.equal(h.last().nextCursor.nextLimit, 250);
  assert.doesNotMatch(original.slice(original.indexOf('export async function watchLabelRecords(')), /startAfter\(/); stop();
});

test('inclusões, edições e exclusões atualizam a união sem manter contribuições removidas', async () => {
  const h = setup(), stop = await h.watch(); h.emit(0, [doc('A')]); h.emit(1, [doc('A'), doc('B', {createdByUid: 'other'})]);
  assert.deepEqual(changes(h.last()), ['added:A', 'added:B']);
  h.emit(0, [doc('A', {version: 2, patientName: 'Pessoa Fictícia'})]);
  assert.deepEqual(changes(h.last()), ['modified:A']); assert.equal(h.last().records.find(record => record.id === 'A').version, 2);
  h.emit(1, [doc('A', {version: 2, patientName: 'Pessoa Fictícia'}), doc('C', {createdByUid: 'other'})]);
  assert.deepEqual(ids(h.last()), ['A', 'C']); assert.deepEqual(changes(h.last()), ['added:C', 'removed:B']);
  h.emit(0, []); assert.deepEqual(ids(h.last()), ['A', 'C']); assert.deepEqual(changes(h.last()), []);
  h.emit(1, [doc('C', {createdByUid: 'other'})]); assert.deepEqual(ids(h.last()), ['C']); assert.deepEqual(changes(h.last()), ['removed:A']); stop();
});

test('versão e updatedAt prevalecem sobre cópia antiga do mesmo ID em outro filtro', async () => {
  const h = setup(), stop = await h.watch();
  h.emit(0, [doc('A', {version: 3, updatedAt: '2026-10-01T13:00:00.000Z', patientName: 'Novo Fictício'})]);
  h.emit(1, [doc('A', {version: 2, updatedAt: '2026-10-01T14:00:00.000Z', patientName: 'Antigo Fictício'})]);
  assert.equal(h.last().records[0].patientName, 'Novo Fictício');
  h.emit(1, [doc('A', {version: 3, updatedAt: '2026-10-01T14:00:00.000Z', patientName: 'Mais Novo Fictício'})]);
  assert.equal(h.last().records[0].patientName, 'Mais Novo Fictício'); assert.equal(h.last().records.length, 1); stop();
});

test('alteração para fora do período, inativação ou participação não autorizada sai do relatório', async () => {
  const h = setup(), stop = await h.watch(); h.emit(0, [doc('A')]); h.emit(1, []);
  for (const fields of [{date: '2026-11-01'}, {active: false}, {createdByUid: 'other', staffSiglas: ['FB']}, {date: undefined}]) {
    h.emit(0, [doc('A', fields)]); assert.deepEqual(ids(h.last()), []);
    h.emit(0, [doc('A')]); assert.deepEqual(ids(h.last()), ['A']);
  }
  stop();
});

test('metadados de cada consulta e documento impedem confirmação prematura; reconciliação não duplica', async () => {
  const h = setup(), stop = await h.watch(); h.emit(0, [doc('A', {}, true)]); h.emit(1, [doc('A')]);
  assert.equal(h.last().hasPendingWrites, true); assert.equal(h.last().serverConfirmed, false); assert.equal(h.last().records.length, 1);
  h.emit(0, [doc('A')], {hasPendingWrites: true}); assert.equal(h.last().hasPendingWrites, true);
  h.emit(0, [doc('A')]); assert.equal(h.last().hasPendingWrites, false); assert.equal(h.last().serverConfirmed, true);
  h.emit(1, [doc('A')], {fromCache: true}); assert.equal(h.last().serverConfirmed, false);
  h.emit(1, [doc('A')]); assert.equal(h.last().serverConfirmed, true); assert.equal(h.last().records.length, 1); stop();
});

test('snapshot vazio confirmado também confirma o escopo e distingue cache', async () => {
  const h = setup(), stop = await h.watch({canManage: true}); h.emit(0, [], {fromCache: true});
  assert.equal(h.last().serverConfirmed, false); h.emit(0, []); assert.equal(h.last().serverConfirmed, true); assert.deepEqual(ids(h.last()), []); stop();
});

test('sentinel não vira registro, sumiço limpa hasMore e próximo listener substitui o prefixo', async () => {
  const h = setup(), stop = await h.watch({canManage: true}); h.emit(0, [doc('A'), doc('B'), doc('C')]);
  assert.deepEqual(ids(h.last()), ['A', 'B']); assert.equal(h.last().hasMore, true); const nextLimit = h.last().nextCursor.nextLimit;
  stop(); const nextStop = await h.watch({canManage: true, loadedLimit: nextLimit});
  h.emit(1, [doc('A'), doc('B'), doc('C')]); assert.deepEqual(ids(h.last()), ['A', 'B', 'C']); assert.equal(h.last().hasMore, false); assert.equal(h.last().nextCursor, null);
  assert.equal(h.listeners[0].stopped, true); assert.equal(h.queryArgs[1].find(value => value.limit)?.limit, 5); nextStop();
});

test('unsubscribe é idempotente e descarta snapshots e erros tardios', async () => {
  const h = setup(), stop = await h.watch(); h.emit(0, [doc('A')]); h.emit(1, []); const count = h.reports.length;
  stop(); stop(); h.emit(0, [doc('late')]); h.listeners[1].error(new Error('Erro antigo'));
  assert.equal(h.reports.length, count); assert.equal(h.errors.length, 0); assert.ok(h.listeners.every(listener => listener.stopCount === 1));
});

test('erro em uma fonte encerra todas; callback tardio não reativa e retry cria apenas novas fontes', async () => {
  const h = setup(), stop = await h.watch(); h.emit(0, [doc('A')]); h.emit(1, []); const before = h.reports.length;
  const error = Object.assign(new Error('Acesso revogado'), {code: 'permission-denied'}); h.listeners[0].error(error);
  assert.equal(h.errors[0], error); assert.ok(h.listeners.every(listener => listener.stopped));
  h.emit(1, [doc('late')]); assert.equal(h.reports.length, before); stop();
  const retryStop = await h.watch(); assert.equal(h.listeners.filter(listener => !listener.stopped).length, 2); retryStop();
});

test('erro síncrono durante setup libera a fonte já criada; erro imediato libera unsubscribe tardio', async () => {
  const failed = setup({throwAt: 1}); await assert.rejects(failed.watch(), /Setup recusado/); assert.equal(failed.listeners[0].stopped, true);
  const immediate = setup({syncError: true}), stop = await immediate.watch();
  assert.equal(immediate.listeners.length, 1); assert.equal(immediate.listeners[0].stopped, true); assert.equal(immediate.errors.length, 1); stop();
});

test('validadores recusam escopo, sessão e janela inválidos antes de criar listeners', async () => {
  for (const options of [{from: '2026-11-01'}, {uid: ''}, {loadedLimit: 0}, {loadedLimit: Infinity}, {pageSize: NaN}]) {
    const h = setup(); await assert.rejects(h.watch(options)); assert.equal(h.listeners.length, 0);
  }
  const h = setup({nullDb: true}); await assert.rejects(h.watch(), /Firestore/); assert.equal(h.listeners.length, 0);
});

test('leitor realtime reutiliza configuração com cache em memória e mantém o leitor Lite pontual', () => {
  const firebase = readFileSync(join(__dirname, '../src/firebase.js'), 'utf8');
  assert.match(original, /from 'firebase\/firestore\/lite'/); assert.match(original, /export async function listLabelRecords/);
  assert.match(original, /import\('\.\/firebase\.js'\)/); assert.match(original, /import\('firebase\/firestore'\)/);
  assert.match(firebase, /localCache:\s*memoryLocalCache\(\)/); assert.doesNotMatch(original, /localStorage|indexedDB|writeSafeCache|persistentLocalCache/);
});
