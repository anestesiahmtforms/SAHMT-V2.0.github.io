const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(new URL('../src/data.js', `file:///${__filename.replace(/\\/g, '/')}`), 'utf8');
function harness(initial = {}, options = {}) {
  let stored = structuredClone(initial);
  let writes = 0;
  const context = {
    navigator: {onLine: options.online !== false}, crypto: {randomUUID: () => 'new-station'}, db: {},
    serverTimestamp: () => 'SERVER_TIMESTAMP', doc: (_db, collection, id) => ({collection, id}),
    collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}),
    getDocsFromServer: async () => ({docs: []}),
    runTransaction: async (_db, task) => task({
      get: async () => ({exists: () => options.exists !== false, data: () => structuredClone(stored)}),
      update: (_ref, update) => {stored = {...stored, ...update}; writes++;},
      set: (_ref, record) => {stored = {...record}; writes++;}
    })
  };
  const maintenanceSource = readFileSync(new URL('../src/checklist-maintenance.js', `file:///${__filename.replace(/\\/g, '/')}`), 'utf8');
  vm.runInNewContext(maintenanceSource.replace(/export /g, ''), context);
  for (const name of ['saveChecklistStationMaintenance', 'saveChecklistStation']) {
    const start = source.indexOf(`export async function ${name}(`);
    assert.notEqual(start, -1);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInNewContext(source.slice(start, end).replace('export ', '') + `\nthis.${name} = ${name};`, context);
  }
  return {context, record: () => structuredClone(stored), writes: () => writes};
}
const station = {id: 'station-fixture', name: 'Arsenal fictício', qrCode: 'QR-FIXTURE', order: 1, active: true,
  maintenance: 'Revisão fictícia', createdByUid: 'creator', createdAt: 'CREATED', updatedByUid: 'creator', updatedAt: 'CREATED', version: 5};

test('salvar e apagar manutenção preserva os outros campos e incrementa a versão', async () => {
  const h = harness(station);
  await h.context.saveChecklistStationMaintenance(station.id, '  Texto atualizado  ', 'manager-fixture');
  assert.deepEqual(h.record(), {...station, maintenance: 'Texto atualizado', updatedByUid: 'manager-fixture', updatedAt: 'SERVER_TIMESTAMP', version: 6});
  await h.context.saveChecklistStationMaintenance(station.id, '', 'manager-fixture');
  assert.equal(h.record().maintenance, '');
  assert.equal(h.record().version, 7);
  assert.equal(h.record().active, true);
  assert.equal(h.record().createdAt, 'CREATED');
});

test('ativar, desativar e editar arsenal conserva a manutenção armazenada', async () => {
  const h = harness(station);
  for (const active of [false, true]) {
    await h.context.saveChecklistStation({...station, stationId: station.id, name: 'Nome atualizado', active, maintenance: 'Valor obsoleto ignorado'}, 'manager-fixture');
    assert.equal(h.record().maintenance, station.maintenance);
    assert.equal(h.record().active, active);
    assert.equal(h.record().name, 'Nome atualizado');
    assert.equal(h.record().createdByUid, 'creator');
  }
  assert.equal(h.record().version, 7);
});

test('catálogo legado sem manutenção continua sem o campo ao ser editado', async () => {
  const legacy = {...station}; delete legacy.maintenance;
  const h = harness(legacy);
  await h.context.saveChecklistStation({...legacy, stationId: station.id}, 'manager-fixture');
  assert.equal(Object.hasOwn(h.record(), 'maintenance'), false);
});

test('manutenção aceita 1000 caracteres e rejeita excesso, sessão ausente, offline e arsenal inexistente', async () => {
  const h = harness(station);
  await h.context.saveChecklistStationMaintenance(station.id, 'x'.repeat(1000), 'manager-fixture');
  assert.equal(h.record().maintenance.length, 1000);
  await assert.rejects(h.context.saveChecklistStationMaintenance(station.id, 'x'.repeat(1001), 'manager-fixture'), /1000/);
  await assert.rejects(h.context.saveChecklistStationMaintenance(station.id, 'text', ''), /sessão/);
  await assert.rejects(h.context.saveChecklistStationMaintenance('invalid/id', 'text', 'manager-fixture'), /arsenal/);
  const offline = harness(station, {online: false});
  await assert.rejects(offline.context.saveChecklistStationMaintenance(station.id, 'text', 'manager-fixture'), /Conecte-se/);
  assert.equal(offline.writes(), 0);
  const missing = harness({}, {exists: false});
  await assert.rejects(missing.context.saveChecklistStationMaintenance(station.id, 'text', 'manager-fixture'), /não encontrado/);
  assert.equal(missing.writes(), 0);
});
test('calendários de manutenção persistem e permanecem após editar ou ativar/desativar', async () => {
  const dates = {preventiveAnnual: '2027-01-15', electricalAnnual: '2027-02-20', calibrationSemiannual: '2027-03-10'};
  const h = harness(station);
  await h.context.saveChecklistStationMaintenance(station.id, dates, 'manager-fixture');
  assert.deepEqual(h.record().maintenance, dates);
  for (const active of [false, true]) {
    await h.context.saveChecklistStation({...station, stationId: station.id, active, name: 'Arsenal atualizado'}, 'manager-fixture');
    assert.deepEqual(h.record().maintenance, dates);
    assert.equal(h.record().active, active);
  }
  const reopened = harness(h.record());
  assert.deepEqual(reopened.record().maintenance, dates);
  await reopened.context.saveChecklistStationMaintenance(station.id, {preventiveAnnual: '', electricalAnnual: '', calibrationSemiannual: ''}, 'manager-fixture');
  assert.deepEqual(reopened.record().maintenance, {preventiveAnnual: '', electricalAnnual: '', calibrationSemiannual: ''});
});