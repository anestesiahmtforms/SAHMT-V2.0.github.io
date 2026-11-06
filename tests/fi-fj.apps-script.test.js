import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function load(station, names) {
  const directory = new URL('../apps-script-' + station.toLowerCase() + '/', import.meta.url);
  const sources = await Promise.all(['Config.gs', ...names].map(name => readFile(new URL(name, directory), 'utf8')));
  const context = vm.createContext({console});
  new vm.Script(sources.join('\n')).runInContext(context);
  return {context, sources, run: code => vm.runInContext(code, context)};
}

test('FI controls contain only operational events and target their own project and folder', async () => {
  const script = await load('FI', ['OperationalSheetControl.gs', 'Setup.gs']);
  assert.deepEqual(JSON.parse(script.run('JSON.stringify(OSC.tables.map(t=>t.collection))')), ['events']);
  assert.equal(script.run('SAHMT_V2_CONFIG.projectId'), 'sahmt-operacional-fi');
  assert.equal(script.run('SAHMT_V2_CONFIG.ownerEmail'), 'anestesiahmtforms9@gmail.com');
  assert.equal(script.run('SAHMT_V2_CONFIG.reportsFolderId'), '1ltCtUrtKCosmtYB3RapXvt12z8-jFIVM');
  assert.throws(() => script.run("oscDocKey_({name:'projects/sahmt-17a16/databases/(default)/documents/events/id'})"), /CONTROLE_DOCUMENTO_INVALIDO/);
  assert.throws(() => script.run("oscDocKey_({name:'projects/sahmt-operacional-fi/databases/(default)/documents/labels/id'})"), /CONTROLE_RECURSO_INVALIDO/);
});

test('FI sheet changes queue the cross-project projection instead of writing a local copy of Escala', async () => {
  const script = await load('FI', ['OperationalSheetControl.gs']);
  const writes = JSON.parse(script.run("JSON.stringify(oscScheduleWrites_('events/event-id',{date:'2026-11-06',scheduleSigla:'AA'},{version:2,date:'2026-11-07'},new Date('2026-11-06T14:00:00Z')))"));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].update.name, 'projects/sahmt-operacional-fi/databases/(default)/documents/eventProjectionOutbox/event-id-2');
  assert.equal(writes[0].update.fields.status.stringValue, 'PENDING');
  assert.deepEqual(writes[0].currentDocument, {exists: false});
});

test('FJ publication preserves release markings, times and event highlights when changing positions', async () => {
  const script = await load('FJ', ['ScheduleSourceSync.gs', 'Setup.gs']);
  assert.equal(script.run('SAHMT_V2_CONFIG.projectId'), 'sahmt-escala-fj');
  assert.equal(script.run('SAHMT_V2_CONFIG.ownerEmail'), 'anestesiahmtforms10@gmail.com');
  const plan = JSON.parse(script.run(`JSON.stringify(buildScheduleSourcePlan_({schedule:[{id:'2026-11-06',date:'2026-11-06',positions:[{position:1,sigla:'BB'}]}],vacations:[]},
    {scheduleDays:[{id:'2026-11-06',date:'2026-11-06',positions:[{position:1,sigla:'AA'}],version:4,_documentName:'projects/sahmt-escala-fj/databases/(default)/documents/scheduleDays/2026-11-06',_updateTime:'2026-11-06T14:00:00Z',highlights:{siglas:['AA'],releaseTimes:{AA:1000},events:['EVENTO:AA:BB:id']}}],vacations:[]}))`));
  assert.equal(plan.writes.length, 1);
  assert.ok(!('highlights' in plan.writes[0].update.fields));
  assert.equal(plan.writes[0].update.fields.version.integerValue, '5');
  assert.equal(plan.writes[0].currentDocument.updateTime, '2026-11-06T14:00:00Z');
});

test('initial scripts block activation/publication until the cutover is explicitly enabled', async () => {
  const fi = await load('FI', ['OperationalSheetControl.gs']);
  const fj = await load('FJ', ['ScheduleSourceSync.gs']);
  for (const script of [fi, fj]) script.context.PropertiesService = {getScriptProperties: () => ({getProperty: () => null})};
  assert.throws(() => fi.run('ativarControleOperacionalV1()'), /CONTROLE_AGUARDANDO_MIGRACAO/);
  assert.throws(() => fj.run('publishScheduleSourceToFirestore()'), /Publicação aguardando/);
});

for (const station of ['FI', 'FJ']) {
  async function privacyFixture(options = {}) {
    const script = await load(station, []);
    const expectedOwner = script.run('SAHMT_V2_CONFIG.ownerEmail');
    const expectedId = script.run('SAHMT_V2_CONFIG.reportsFolderId');
    const grants = [{email: 'collaborator@example.com', role: 'writer'}];
    let access = options.access || 'ANYONE_WITH_LINK', writes = 0, reads = 0;
    const folder = {
      getId: () => options.folderId || expectedId,
      getOwner: () => ({getEmail: () => options.owner || expectedOwner}),
      getSharingAccess: () => access,
      setSharing: (nextAccess, permission) => {
        writes++;
        assert.equal(nextAccess, 'PRIVATE');
        assert.equal(permission, 'VIEW');
        if (options.failWrite) throw Error('WRITE_FAILED');
        if (!options.failReadback) access = nextAccess;
      },
    };
    script.context.Session = {getEffectiveUser: () => ({getEmail: () => options.executor || expectedOwner})};
    script.context.PropertiesService = {getScriptProperties: () => ({getProperty: () => options.prepared ? 'existing-sheet' : null})};
    script.context.DriveApp = {
      Access: {PRIVATE: 'PRIVATE'}, Permission: {VIEW: 'VIEW'},
      getFolderById: id => {assert.equal(id, expectedId); reads++; return folder;},
    };
    return {...script, grants, writes: () => writes, reads: () => reads};
  }

  test(station + ' initial privacy repair is idempotent and preserves explicit grants', async () => {
    const script = await privacyFixture();
    script.run('sahmtPreparePrivateFolder_()');
    script.run('sahmtPreparePrivateFolder_()');
    assert.equal(script.writes(), 1);
    assert.equal(script.reads(), 4);
    assert.deepEqual(script.grants, [{email: 'collaborator@example.com', role: 'writer'}]);
  });

  test(station + ' rejects wrong executor, owner or folder before changing sharing', async () => {
    for (const options of [{executor: 'other@example.com'}, {owner: 'anestesiahmtforms@gmail.com'}, {folderId: 'wrong-folder'}]) {
      const script = await privacyFixture(options);
      assert.throws(() => script.run('sahmtPreparePrivateFolder_()'), /EXECUTOR_PASTA_INVALIDO|PROPRIETARIO_PASTA_INVALIDO/);
      assert.equal(script.writes(), 0);
    }
  });

  test(station + ' privacy repair fails closed and never repairs an established sheet', async () => {
    for (const options of [{failWrite: true}, {failReadback: true}, {prepared: true}]) {
      const script = await privacyFixture(options);
      assert.throws(() => script.run('sahmtPreparePrivateFolder_()'), /WRITE_FAILED|não está privada/);
      assert.equal(script.writes(), options.prepared ? 0 : 1);
    }
    const script = await privacyFixture();
    assert.throws(() => script.run('sahmtV2RequirePrivateFolder_()'), /não está privada/);
    assert.equal(script.writes(), 0);
  });
}

test('FJ seed values cannot become spreadsheet formulas', async () => {
  const script = await load('FJ', ['Setup.gs']);
  assert.deepEqual(JSON.parse(script.run(`JSON.stringify(sahmtSafeSeedRow_(['=IMPORTXML("https://example.com")','+1','-2','@x','AA','2026-11-06',17]))`)),
    ['\'=IMPORTXML("https://example.com")', "'+1", "'-2", "'@x", 'AA', '2026-11-06', 17]);
});
