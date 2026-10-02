const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const original = readFileSync(join(__dirname, '../src/report-live-data.js'), 'utf8');
const source = original.replaceAll('export ', '')
  .replaceAll("import('./firebase.js')", 'Promise.resolve({db: mockedRealtimeDb})')
  .replaceAll("import('firebase/firestore')", 'Promise.resolve(realtimeSdk)');
const scope = {from: '2026-10-01', to: '2026-10-31', uid: 'reader-A', sigla: 'FA', pageSize: 2};
const doc = (id, fields = {}, pending = false) => ({id, metadata: {hasPendingWrites: pending}, data: () => ({active: true, date: '2026-10-01', createdByUid: 'reader-A', version: 1, createdAt: '2026-10-01T12:00:00.000Z', ...fields})});
function setup({nullDb = false, throwSetup = false, syncError = false} = {}) {
  const listeners = [], reports = [], errors = [], queryArgs = [];
  const realtimeSdk = {
    collection: (_db, name) => ({collection: name}), where: (...args) => ({where: args}), or: (...clauses) => ({or: clauses}), and: (...clauses) => ({and: clauses}), orderBy: (...args) => ({order: args}), limit: size => ({limit: size}),
    query: (...args) => {queryArgs.push(args); return args;},
    onSnapshot: (query, options, next, error) => {
      if (throwSetup) throw new Error('Setup recusado');
      const listener = {query, options, next, error, stopped: false, stopCount: 0}; listeners.push(listener);
      if (syncError) error(new Error('Erro imediato'));
      return () => {listener.stopped = true; listener.stopCount++;};
    }
  };
  const context = vm.createContext({mockedRealtimeDb: nullDb ? null : {}, realtimeSdk, console}); vm.runInContext(source, context);
  return {context, listeners, reports, errors, queryArgs,
    events: options => context.watchEventRecords({...scope, ...options}, result => reports.push(result), error => errors.push(error)),
    stations: () => context.watchChecklistStations(result => reports.push(result), error => errors.push(error)),
    emit: (docs, metadata = {}, index = 0) => listeners[index].next({docs, metadata: {fromCache: false, hasPendingWrites: false, ...metadata}}),
    last: () => reports.at(-1)};
}
const ids = report => Array.from(report.records, record => record.id);
const changes = report => Array.from(report.changes, change => `${change.type}:${change.id}`);

test('Eventos comuns usam uma consulta OR autorizada, período ativo e prefixo com sentinel', async () => {
  const h = setup(), stop = await h.events({sigla: ' fa '});
  assert.equal(h.listeners.length, 1);
  const args = h.queryArgs[0]; assert.equal(args[0].collection, 'events');
  const composite = args.find(item => item.and); assert.ok(composite);
  assert.equal(args.filter(item => item.and || item.or || item.where).length, 1);
  for (const expected of ['active|==|true', 'date|>=|2026-10-01', 'date|<=|2026-10-31']) assert.ok(composite.and.some(item => item.where?.join('|') === expected));
  assert.deepEqual(Array.from(composite.and.find(item => item.or).or, item => item.where.join('|')), ['createdByUid|==|reader-A', 'memberSigla|==|FA', 'scheduleSigla|==|FA']);
  assert.ok(args.some(item => item.order?.join('|') === 'date|desc')); assert.equal(args.find(item => item.limit).limit, 3);
  assert.equal(h.listeners[0].options.includeMetadataChanges, true); stop();
});

test('admin consulta período completo e comum sem sigla fica somente na autoria', async () => {
  for (const [options, admin] of [[{isAdmin: true}, true], [{sigla: ''}, false]]) {
    const h = setup(), stop = await h.events(options), args = h.queryArgs[0];
    assert.equal(args.some(item => item.or), false); assert.equal(args.some(item => item.where?.[0] === 'createdByUid'), !admin); stop();
  }
});

test('prefixo crescente permite mais de 100 registros sem cursor startAfter e pagina por 100', async () => {
  const h = setup(), stop = await h.events({isAdmin: true, loadedLimit: 150, pageSize: 999});
  assert.equal(h.queryArgs[0].find(item => item.limit).limit, 151);
  h.emit(Array.from({length: 151}, (_, index) => doc(String(index))));
  assert.equal(h.last().records.length, 150); assert.equal(h.last().hasMore, true);
  assert.equal(h.last().nextCursor.live, true); assert.equal(h.last().nextCursor.loadedLimit, 150); assert.equal(h.last().nextCursor.nextLimit, 250);
  assert.doesNotMatch(original, /startAfter\(/); stop();
});

test('inclusão, edição, remoção e metadados são reconciliados sem linhas duplicadas', async () => {
  const h = setup(), stop = await h.events(); h.emit([doc('A')], {fromCache: true});
  assert.deepEqual(changes(h.last()), ['added:A']); assert.equal(h.last().serverConfirmed, false);
  h.emit([doc('A', {version: 2, description: 'Teste fictício'}), doc('B')]);
  assert.deepEqual(changes(h.last()), ['modified:A', 'added:B']); assert.equal(h.last().serverConfirmed, true);
  h.emit([doc('B')]); assert.deepEqual(changes(h.last()), ['removed:A']); assert.deepEqual(ids(h.last()), ['B']);
  h.emit([doc('B')]); assert.deepEqual(changes(h.last()), []); stop();
});

test('entrada e saída de autoria, plantonista, sigla e data respeitam o mesmo escopo', async () => {
  const h = setup(), stop = await h.events();
  h.emit([doc('own'), doc('member', {createdByUid: 'other', memberSigla: 'FA'})]); assert.deepEqual(ids(h.last()), ['member', 'own']);
  h.emit([doc('schedule', {createdByUid: 'other', scheduleSigla: 'FA'})]); assert.deepEqual(ids(h.last()), ['schedule']);
  for (const fields of [{createdByUid: 'other', memberSigla: 'FB'}, {active: false}, {date: '2026-11-01'}, {date: '2026-09-30'}, {date: null}]) {
    h.emit([doc('outside', fields)]); assert.deepEqual(ids(h.last()), []);
  }
  stop();
});

test('metadata de documento e sentinel bloqueiam confirmação até o servidor limpar pending', async () => {
  const h = setup(), stop = await h.events(); h.emit([doc('A', {}, true)]);
  assert.equal(h.last().records[0].hasPendingWrites, true); assert.equal(h.last().hasPendingWrites, true); assert.equal(h.last().serverConfirmed, false);
  h.emit([doc('A'), doc('B'), doc('sentinel', {}, true)]); assert.equal(h.last().records.length, 2); assert.equal(h.last().serverConfirmed, false);
  h.emit([doc('A')], {hasPendingWrites: true}); assert.equal(h.last().serverConfirmed, false);
  h.emit([doc('A')]); assert.equal(h.last().serverConfirmed, true); assert.equal(h.last().records[0].hasPendingWrites, false); stop();
});

test('vazio de servidor confirma período; cache vazio e metadata desconhecida não confirmam', async () => {
  const h = setup(), stop = await h.events(); h.emit([], {fromCache: true}); assert.equal(h.last().serverConfirmed, false);
  h.emit([]); assert.equal(h.last().serverConfirmed, true); assert.deepEqual(ids(h.last()), []);
  h.listeners[0].next({docs: []}); assert.equal(h.last().serverConfirmed, false); stop();
});

test('sentinel sai após redução e reabertura usa próximo prefixo sem manter listener antigo', async () => {
  const h = setup(), stop = await h.events(); h.emit([doc('A'), doc('B'), doc('C')]);
  const loadedLimit = h.last().nextCursor.nextLimit; stop(); const nextStop = await h.events({loadedLimit});
  h.emit([doc('A'), doc('B'), doc('C')], {}, 1); assert.deepEqual(ids(h.last()), ['A', 'B', 'C']); assert.equal(h.last().nextCursor, null);
  assert.equal(h.listeners[0].stopped, true); assert.equal(h.queryArgs[1].find(item => item.limit).limit, 5); nextStop();
});

test('unsubscribe idempotente ignora callbacks e erros da sessão anterior', async () => {
  for (const kind of ['events', 'stations']) {
    const h = setup(), stop = await h[kind](); h.emit([doc('A')]); const count = h.reports.length;
    stop(); stop(); h.emit([doc('late')]); h.listeners[0].error(new Error('Erro anterior'));
    assert.equal(h.reports.length, count); assert.equal(h.errors.length, 0); assert.equal(h.listeners[0].stopCount, 1);
  }
});

test('erro de permissão encerra o listener e retry cria uma nova inscrição', async () => {
  const h = setup(), stop = await h.events(); const error = Object.assign(new Error('Acesso revogado'), {code: 'permission-denied'});
  h.listeners[0].error(error); assert.equal(h.errors[0], error); assert.equal(h.listeners[0].stopped, true);
  h.emit([doc('late')]); assert.equal(h.reports.length, 0); stop(); const retry = await h.events(); assert.equal(h.listeners.filter(item => !item.stopped).length, 1); retry();
});

test('setup rejeitado e erro imediato não deixam inscrições órfãs', async () => {
  const h = setup({throwSetup: true}); await assert.rejects(h.events(), /Setup recusado/); assert.equal(h.listeners.length, 0);
  const immediate = setup({syncError: true}), stop = await immediate.events(); assert.equal(immediate.errors.length, 1); assert.equal(immediate.listeners[0].stopCount, 1); stop();
});

test('scope e limites inválidos são recusados antes de onSnapshot', async () => {
  for (const options of [{uid: ''}, {from: '2026-11-01'}, {pageSize: NaN}, {loadedLimit: 0}, {loadedLimit: Infinity}, {loadedLimit: Number.MAX_SAFE_INTEGER - 1}]) {
    const h = setup(); await assert.rejects(h.events(options)); assert.equal(h.listeners.length, 0);
  }
  const h = setup({nullDb: true}); await assert.rejects(h.events(), /Firestore/); assert.equal(h.listeners.length, 0);
});

test('arsenais incluem inativos, limitam 200 com sentinel e sinalizam cadastro incompleto', async () => {
  const h = setup(), stop = await h.stations(), args = h.queryArgs[0];
  assert.equal(args[0].collection, 'stations'); assert.equal(args.find(item => item.limit).limit, 201);
  assert.ok(args.some(item => item.order?.join('|') === 'order|asc')); assert.ok(!args.some(item => item.where));
  h.emit([doc('active'), doc('inactive', {active: false})]); assert.deepEqual(ids(h.last()), ['active', 'inactive']); assert.equal(h.last().truncated, false);
  h.emit(Array.from({length: 201}, (_, index) => doc(String(index), {order: index, active: index % 2 === 0})));
  assert.equal(h.last().records.length, 200); assert.equal(h.last().truncated, true); assert.equal(h.last().records.some(item => item.id === '200'), false);
  h.emit([doc('active')]); assert.equal(h.last().truncated, false); assert.deepEqual(ids(h.last()), ['active']); stop();
});

test('arsenais preservam mudanças de manutenção e confirmação por metadata', async () => {
  const h = setup(), stop = await h.stations(); h.emit([doc('A', {maintenance: {active: false}})], {fromCache: true}); assert.equal(h.last().serverConfirmed, false);
  h.emit([doc('A', {maintenance: {active: true, endDate: '2026-10-10'}}, true)]); assert.equal(h.last().hasPendingWrites, true); assert.deepEqual(changes(h.last()), ['modified:A']);
  h.emit([doc('A', {maintenance: {active: true, endDate: '2026-10-10'}})]); assert.equal(h.last().serverConfirmed, true); stop();
});

test('adaptadores reutilizam cache Firestore em memória sem persistir registros nem polling', () => {
  assert.match(original, /import\('\.\/firebase\.js'\)/); assert.match(original, /import\('firebase\/firestore'\)/);
  assert.doesNotMatch(original, /localStorage|indexedDB|writeSafeCache|persistentLocalCache|setInterval|getDocs/);
});

test('flag admin inválida não transforma consulta comum em consulta ampla', async () => {
  const h = setup(), stop = await h.events({isAdmin: 'false'});
  assert.ok(h.queryArgs[0].some(item => item.and?.some(filter => filter.or))); h.emit([doc('foreign', {createdByUid: 'other'})]); assert.deepEqual(ids(h.last()), []); stop();
});
