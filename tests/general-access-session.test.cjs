const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const start = source.indexOf('function sessionChanged(next) {');
const end = source.indexOf('async function refreshAppFeatures(', start);
assert.ok(start >= 0 && end > start, 'O teste deve executar a função sessionChanged real do app.');
const sessionSource = source.slice(start, end);
const clone = (value) => JSON.parse(JSON.stringify(value));

function harness({route = 'labels', permissions = {}, status = 'signed-in', active = true, access = true} = {}) {
  const photo = {name: 'etiqueta-ficticia.jpg', type: 'image/jpeg', fixture: true};
  const draft = {value: 'Rascunho fictício preservado', isConnected: true};
  const imageInput = {files: [photo], isConnected: true};
  const dialog = {open: true, isConnected: true};
  const document = {activeElement: draft};
  const renders = [], syncs = [], refreshes = [], liveClears = [];
  const session = {
    status,
    user: {uid: 'fictional-user-a'},
    profile: {
      uid: 'fictional-user-a', displayName: 'Pessoa Fictícia A', sigla: 'AA',
      role: 'anestesiologista', active, access,
      permissions: {labelsRead: true, labelsWrite: true, eventsRead: true, checklistRead: true, managementRead: true, ...permissions}
    },
    offline: false
  };
  const ctx = vm.createContext({
    session, currentRoute: () => route, document, navigator: {onLine: false},
    appFeatures: {labels: true, trainings: true, notifications: true}, appFeaturesUid: session.user.uid,
    appFeaturesLoadSequence: 0, DEFAULT_APP_FEATURES: {labels: true, trainings: true, notifications: true},
    startupReports: {clear() {}}, liveReports: {clear: (reason) => liveClears.push(reason)},
    reportPayloads: new Map(), reportPaintKeys: new Map(), reportStates: new Map(), reportWaiters: new Map(),
    suspendedReportScopes: [], checklistCatalogLive: {}, checklistModuleStations: [], checklistResponsibilityLive: {},
    loadedLabelRecords: [], loadedEventReportRecords: [], eventReportSourceRecords: [], checklistReportContext: {},
    startupBannerActive: false, labelManualConfirmation: {uid: session.user.uid, status: 'Rascunho'}, notice: '',
    scheduleOutboxRetry() {}, preloadStartupReports() {}, preloadOperationalDataWhenIdle() {}, syncOutbox() {},
    settleReportWaiter() {},
    render: async () => {
      renders.push(route);
      draft.value = '';
      draft.isConnected = false;
      imageInput.files = [];
      imageInput.isConnected = false;
      dialog.open = false;
      dialog.isConnected = false;
      document.activeElement = null;
    },
    updateReportSync: (kind) => syncs.push(kind),
    refreshAppFeatures: async (uid) => refreshes.push(uid)
  });
  vm.runInContext(sessionSource, ctx, {filename: 'src/main.js:sessionChanged'});
  return {ctx, draft, imageInput, photo, dialog, document, renders, syncs, refreshes, liveClears,
    next: () => clone(ctx.session)};
}

function grantReads(next, keys = ['trainingsRead', 'notificationsRead']) {
  for (const key of keys) next.profile.permissions[key] = true;
  return next;
}

function assertPreserved(h) {
  assert.equal(h.renders.length, 0);
  assert.equal(h.draft.value, 'Rascunho fictício preservado');
  assert.equal(h.draft.isConnected, true);
  assert.equal(h.imageInput.files.length, 1);
  assert.strictEqual(h.imageInput.files[0], h.photo);
  assert.strictEqual(h.document.activeElement, h.draft);
  assert.equal(h.dialog.open, true);
  assert.equal(h.dialog.isConnected, true);
  assert.deepEqual(h.liveClears, []);
}

for (const route of ['labels', 'events', 'checklist', 'management']) {
  test(`sessionChanged: concessão das duas consultas gerais preserva rascunho, foto, foco e diálogo em ${route}`, () => {
    const h = harness({route});
    const next = grantReads(h.next());
    h.ctx.sessionChanged(next);
    assertPreserved(h);
    assert.strictEqual(h.ctx.session, next);
    assert.equal(h.ctx.session.profile.permissions.trainingsRead, true);
    assert.equal(h.ctx.session.profile.permissions.notificationsRead, true);
    assert.deepEqual(h.syncs, ['events', 'labels', 'checklist']);
    assert.deepEqual(h.refreshes, []);
  });
}

for (const key of ['trainingsRead', 'notificationsRead']) {
  test(`sessionChanged: conceder somente ${key} preserva a tela operacional`, () => {
    const h = harness({permissions: {[key]: false}});
    h.ctx.sessionChanged(grantReads(h.next(), [key]));
    assertPreserved(h);
  });
}

test('sessionChanged: conceder a consulta restante preserva a tela e a outra consulta existente', () => {
  const h = harness({permissions: {trainingsRead: true, notificationsRead: false}});
  h.ctx.sessionChanged(grantReads(h.next(), ['notificationsRead']));
  assertPreserved(h);
  assert.equal(h.ctx.session.profile.permissions.trainingsRead, true);
});

test('sessionChanged: ordem das permissões não transforma a concessão em reconstrução da tela', () => {
  const h = harness();
  const next = grantReads(h.next());
  next.profile.permissions = Object.fromEntries(Object.entries(next.profile.permissions).reverse());
  h.ctx.sessionChanged(next);
  assertPreserved(h);
});

for (const route of ['home', 'training', 'notifications']) {
  test(`sessionChanged: concessão das consultas reconstrói ${route} para disponibilizar o novo acesso`, () => {
    const h = harness({route});
    h.ctx.sessionChanged(grantReads(h.next()));
    assert.deepEqual(h.renders, [route]);
    assert.equal(h.dialog.open, false);
    assert.equal(h.document.activeElement, null);
  });
}

for (const key of ['trainingsRead', 'notificationsRead']) {
  for (const revoke of ['false', 'remove']) {
    test(`sessionChanged: revogação de ${key} por ${revoke} continua reconstruindo imediatamente a tela`, () => {
      const h = harness({permissions: {trainingsRead: true, notificationsRead: true}});
      const next = h.next();
      if (revoke === 'remove') delete next.profile.permissions[key];
      else next.profile.permissions[key] = false;
      h.ctx.sessionChanged(next);
      assert.deepEqual(h.renders, ['labels']);
    });
  }
}

const protectedChanges = [
  ['função', (next) => {next.profile.role = 'gestor';}],
  ['nome exibido', (next) => {next.profile.displayName = 'Pessoa Fictícia B';}],
  ['sigla', (next) => {next.profile.sigla = 'BB';}],
  ['perfil inativo', (next) => {next.profile.active = false;}],
  ['acesso bloqueado', (next) => {next.profile.access = false;}],
  ['UID da sessão', (next) => {next.user.uid = 'fictional-user-b'; next.profile.uid = 'fictional-user-b';}],
  ['status bloqueado', (next) => {next.status = 'blocked';}],
  ['status pendente', (next) => {next.status = 'access-pending';}],
  ['revogação de outra permissão', (next) => {next.profile.permissions.labelsWrite = false;}],
  ['concessão de outra permissão', (next) => {next.profile.permissions.trainingsManage = true;}],
  ['concessão administrativa', (next) => {next.profile.permissions.admin = true;}]
];
for (const [title, change] of protectedChanges) {
  test(`sessionChanged: concessão geral junto de mudança de ${title} continua reconstruindo a tela`, () => {
    const h = harness();
    const next = grantReads(h.next());
    change(next);
    h.ctx.sessionChanged(next);
    assert.deepEqual(h.renders, ['labels']);
    assert.strictEqual(h.ctx.session, next);
    if (next.user.uid !== 'fictional-user-a' || next.status !== 'signed-in') {
      assert.deepEqual(h.liveClears, ['session-changed']);
    }
  });
}

for (const [grantKey, revokeKey] of [['trainingsRead', 'notificationsRead'], ['notificationsRead', 'trainingsRead']]) {
  test(`sessionChanged: conceder ${grantKey} junto de revogar ${revokeKey} não preserva a tela`, () => {
    const h = harness({permissions: {[revokeKey]: true}});
    const next = grantReads(h.next(), [grantKey]);
    next.profile.permissions[revokeKey] = false;
    h.ctx.sessionChanged(next);
    assert.deepEqual(h.renders, ['labels']);
  });
}

for (const initial of [{status: 'access-pending'}, {active: false}, {access: false}]) {
  test(`sessionChanged: sessão sem aprovação anterior não usa a exceção de concessão (${JSON.stringify(initial)})`, () => {
    const h = harness(initial);
    const next = grantReads(h.next());
    next.status = 'signed-in';
    next.profile.active = true;
    next.profile.access = true;
    h.ctx.sessionChanged(next);
    assert.deepEqual(h.renders, ['labels']);
  });
}

test('sessionChanged: snapshot idêntico após a concessão permanece sem reconstrução', () => {
  const h = harness({permissions: {trainingsRead: true, notificationsRead: true}});
  const next = h.next();
  next.profile.permissions = Object.fromEntries(Object.entries(next.profile.permissions).reverse());
  h.ctx.sessionChanged(next);
  assertPreserved(h);
  assert.deepEqual(h.syncs, ['events', 'labels', 'checklist']);
});
