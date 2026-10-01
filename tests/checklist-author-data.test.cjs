const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(new URL('../src/data.js', `file:///${__filename.replace(/\\/g, '/')}`), 'utf8');

function extract(name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1);
  const end = source.indexOf('\n}', start) + 2;
  return source.slice(start, end).replace('export ', '') + `\nthis.${name} = ${name};`;
}

function creatorHarness({exists = true, data = {}, error} = {}) {
  const reads = [];
  const context = {
    db: {},
    doc: (_db, collection, id) => ({collection, id}),
    getDocFromServer: async (ref) => {
      reads.push(ref);
      if (error) throw error;
      return {exists: () => exists, data: () => data};
    }
  };
  vm.runInNewContext(extract('getChecklistCreatorName'), context);
  return {context, reads};
}

test('autoria legada consulta exclusivamente o displayName no perfil do criador', async () => {
  const h = creatorHarness({data: {uid: 'checker-fixture', displayName: 'Pessoa Fictícia Teste', email: 'ficticio@example.invalid', phone: '000', permissions: {admin: true}}});
  assert.equal(await h.context.getChecklistCreatorName('checker-fixture'), 'Pessoa Fictícia Teste');
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].collection, 'users');
  assert.equal(h.reads[0].id, 'checker-fixture');
});

test('autoria legada ausente ou sem nome retorna texto vazio e UID inválido não faz consulta', async () => {
  assert.equal(await creatorHarness({exists: false}).context.getChecklistCreatorName('missing-fixture'), '');
  assert.equal(await creatorHarness({data: {displayName: 42}}).context.getChecklistCreatorName('malformed-fixture'), '');
  const h = creatorHarness();
  for (const uid of ['', null, undefined, 42, 'invalid/path', 'x'.repeat(129)]) {
    assert.equal(await h.context.getChecklistCreatorName(uid), '');
  }
  assert.equal(h.reads.length, 0);
});

test('autoria legada conserva a recusa do servidor em vez de usar leitura privilegiada ou cache', async () => {
  const error = Object.assign(new Error('Acesso negado'), {code: 'permission-denied'});
  const h = creatorHarness({error});
  await assert.rejects(h.context.getChecklistCreatorName('other-fixture'), (actual) => actual === error);
  assert.equal(h.reads.length, 1);
});

function recordsHarness({pending = [], stored = [], offline = false} = {}) {
  const uidReads = [];
  const pendingBefore = structuredClone(pending);
  const context = {
    db: {}, Date,
    collection: () => ({}), query: () => ({}), where: () => ({}), orderBy: () => ({}), limit: () => ({}),
    getDocsFromServer: async () => {
      if (offline) throw Object.assign(new Error('Offline'), {code: 'unavailable'});
      return {docs: stored.map((item) => ({id: item.id, data: () => structuredClone(item)}))};
    },
    writeSafeCache: async () => undefined,
    readSafeCache: async () => ({data: {records: structuredClone(stored), priorRecords: [], stationIds: []}}),
    mayUseOfflineCache: (error) => error.code === 'unavailable',
    listUnsettledOperations: async (uid) => {uidReads.push(uid); return pending;},
    dateSortValue: (value) => new Date(value).getTime()
  };
  vm.runInNewContext(extract('listChecklistRecords'), context);
  vm.runInNewContext(extract('listMonthlyChecklistRecords'), context);
  return {context, uidReads, pendingBefore};
}

const pendingOperations = () => [
  {requestId: 'pending-legacy', status: 'queued', createdAt: 1000, payload: {collectionName: 'checklists', data: {stationId: 'station-fixture', date: '2026-10-01', condition: 'SIM'}}},
  {requestId: 'pending-named', status: 'failed', createdAt: 2000, lastError: 'Acesso revogado', payload: {collectionName: 'checklists', data: {stationId: 'station-fixture', date: '2026-10-01', condition: 'NAO', createdByName: 'Pessoa Fictícia Teste', createdByUid: 'untrusted-payload'}}},
  {requestId: 'other-day', status: 'queued', createdAt: 3000, payload: {collectionName: 'checklists', data: {stationId: 'station-fixture', date: '2026-11-01', condition: 'SIM'}}},
  {requestId: 'other-module', status: 'queued', createdAt: 4000, payload: {collectionName: 'events', data: {date: '2026-10-01'}}}
];

for (const offline of [false, true]) {
  for (const [name, date] of [['listChecklistRecords', '2026-10-01'], ['listMonthlyChecklistRecords', '2026-10']]) {
    test(`${name} identifica autoria pendente pela partição sem alterar fila (${offline ? 'offline' : 'online'})`, async () => {
      const pending = pendingOperations();
      const h = recordsHarness({pending, offline});
      const result = await h.context[name](date, 'partition-fixture');
      assert.equal(result.records.length, 2);
      for (const record of result.records) assert.equal(record.createdByUid, 'partition-fixture');
      assert.deepEqual([...h.uidReads], ['partition-fixture']);
      assert.deepEqual(pending, h.pendingBefore);
      const named = result.records.find((record) => record.id === 'pending-named');
      const legacy = result.records.find((record) => record.id === 'pending-legacy');
      assert.equal(named.createdByName, 'Pessoa Fictícia Teste');
      assert.equal(named.syncFailed, true);
      assert.equal(named.syncError, 'Acesso revogado');
      assert.equal(named.createdAt.getTime(), 2000);
      assert.equal(legacy.pendingSync, true);
      assert.equal(Object.hasOwn(legacy, 'createdByName'), false);
      assert.equal(result.stale, offline);
    });
  }
}

test('registro confirmado prevalece sobre pendente com o mesmo ID e conserva o autor armazenado', async () => {
  const pending = pendingOperations();
  const stored = [{id: 'pending-legacy', date: '2026-10-01', stationId: 'station-fixture', createdByUid: 'server-fixture', createdByName: 'Autor no Servidor', createdAt: new Date(5000)}];
  const h = recordsHarness({pending, stored});
  const result = await h.context.listChecklistRecords('2026-10-01', 'partition-fixture');
  const confirmed = result.records.filter((record) => record.id === 'pending-legacy');
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].createdByUid, 'server-fixture');
  assert.equal(confirmed[0].createdByName, 'Autor no Servidor');
  assert.equal(Object.hasOwn(confirmed[0], 'pendingSync'), false);
  assert.deepEqual(pending, h.pendingBefore);
});
