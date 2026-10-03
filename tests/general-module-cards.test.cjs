const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const features = readFileSync(join(__dirname, '../src/feature-flags.js'), 'utf8').replace(/\r\n/g, '\n');

function extractFunction(name, {async = false} = {}) {
  const prefix = `${async ? 'async ' : ''}function ${name}(`;
  const start = main.indexOf(prefix);
  assert.notEqual(start, -1, `${name} deve existir no código real`);
  const end = main.indexOf('\n}', start);
  assert.notEqual(end, -1, `${name} deve terminar no código real`);
  return main.slice(start, end + 2).replaceAll('import.meta.env.BASE_URL', "'/'");
}

function approved(permissions = {}, role = 'anestesiologista') {
  return {status: 'signed-in', user: {uid: 'pessoa-ficticia'}, profile: {active: true, access: true, role, permissions}};
}

function harness({session = approved(), appFeatures = {}, route = 'home', hasContent = true} = {}) {
  const imports = [];
  const queries = [];
  const navigations = [];
  const content = {isConnected: true, innerHTML: '', querySelectorAll: () => []};
  const data = {
    listModuleRecords: async (...args) => { queries.push({name: 'listModuleRecords', args}); return []; },
    listNotifications: async (...args) => { queries.push({name: 'listNotifications', args}); return []; },
    listLearningActivities: async (...args) => { queries.push({name: 'listLearningActivities', args}); return []; },
    listLearningActivityReceipts: async (...args) => { queries.push({name: 'listLearningActivityReceipts', args}); return []; }
  };
  const context = vm.createContext({
    session, appFeatures, selectedManagementAreaId: '', route, evaluationModuleGeneration:0, cleanupCurrentModule:null,
    currentRoute: () => context.route,
    document: {querySelector: (selector) => selector === '#module-content' && hasContent ? content : null},
    navigate: (target) => navigations.push(target),
    escapeHtml: String,
    hasFinanceOnlyManagementAccess: () => false,
    todayInputValue: () => '2026-10-02',
    fakeImport: async (path) => {
      imports.push(path);
      if (path === './data.js') return data;
      if (path === './performance-ui.js') return {mountPerformanceModule: () => {queries.push({name:'mountPerformanceModule'}); return () => {};}};
      throw new Error(`Importação inesperada no teste: ${path}`);
    }
  });
  const labelStart = main.indexOf('const labels = {');
  const labelEnd = main.indexOf('\n};', labelStart) + 3;
  assert.ok(labelStart !== -1 && labelEnd > labelStart);
  vm.runInContext(features.replace(/^export /gm, '') + '\n' + main.slice(labelStart, labelEnd), context);
  const loadModule = extractFunction('loadModule', {async: true}).replace(/import\((['"])([^'"]+)\1\)/g, 'fakeImport("$2")');
  vm.runInContext([
    extractFunction('can'), extractFunction('moduleCards'), extractFunction('managementUtilityCards'),
    extractFunction('actionForm'), loadModule,
    'globalThis.realModuleUi = {can, moduleCards, managementUtilityCards, actionForm, loadModule};'
  ].join('\n'), context);
  return {context, ui: context.realModuleUi, content, imports, queries, navigations};
}

function visibleRoutes(h) {
  return [...h.ui.moduleCards().matchAll(/data-route="([^"]+)"/g)].map((match) => match[1]);
}

test('Escala mostra Treinamentos e Notificações para um perfil comum aprovado sem conceder permissões', () => {
  const session = approved();
  const before = structuredClone(session);
  const h = harness({session});
  assert.deepEqual(visibleRoutes(h), ['training', 'notifications']);
  assert.match(h.ui.moduleCards(), /<strong>Desempenho<\/strong>/);
  assert.match(h.ui.moduleCards(), /<strong>Notificações<\/strong>/);
  for (const permission of ['trainingsRead', 'trainingsManage', 'notificationsRead', 'notificationsManage', 'usersManage', 'admin']) {
    assert.equal(h.ui.can(permission), false, `${permission} continua sem concessão`);
  }
  assert.equal(h.ui.managementUtilityCards(), '');
  assert.equal(h.ui.actionForm('training'), '');
  assert.equal(h.ui.actionForm('notifications'), '');
  assert.deepEqual(session, before);
});

test('flags false nas permissões não ocultam os cartões comuns nem alteram o mapa do perfil', () => {
  const session = approved({trainingsRead: false, notificationsRead: false, labelsWrite: true});
  const before = structuredClone(session);
  const h = harness({session});
  assert.deepEqual(visibleRoutes(h), ['labels', 'training', 'notifications']);
  assert.equal(h.ui.can('trainingsRead'), false);
  assert.equal(h.ui.can('notificationsRead'), false);
  assert.deepEqual(session, before);
});

test('administradores preservam os cartões e os controles administrativos existentes', () => {
  for (const session of [approved({}, 'administrador_app'), approved({admin: true})]) {
    const h = harness({session});
    assert.deepEqual(visibleRoutes(h), ['events', 'labels', 'management', 'checklist', 'training', 'notifications']);
    assert.match(h.ui.managementUtilityCards(), /data-route="admin"/);
    assert.match(h.ui.actionForm('training'), /id="training-catalog-form"/);
    assert.match(h.ui.actionForm('notifications'), /data-module-form="notifications"/);
  }
});

test('o acesso comum aos cartões exige sessão aprovada e ambos os indicadores booleanos true', () => {
  const sessions = [
    {status: 'access-pending', user: {uid: 'pessoa-ficticia'}, profile: approved().profile},
    {status: 'blocked', user: {uid: 'pessoa-ficticia'}, profile: approved().profile},
    {status: 'signed-out'},
    {status: 'signed-in', user: {uid: 'pessoa-ficticia'}},
    {status: 'signed-in', profile: {...approved().profile, active: false}},
    {status: 'signed-in', profile: {...approved().profile, access: false}},
    {status: 'signed-in', profile: {access: true, permissions: {}}},
    {status: 'signed-in', profile: {active: true, permissions: {}}},
    {status: 'signed-in', profile: {...approved().profile, active: 'true'}},
    {status: 'signed-in', profile: {...approved().profile, access: 1}}
  ];
  for (const session of sessions) assert.deepEqual(visibleRoutes(harness({session})), [], JSON.stringify(session));
});

test('desativar módulos globalmente continua ocultando os cartões para comuns e administradores', () => {
  for (const session of [approved(), approved({}, 'administrador_app')]) {
    const h = harness({session, appFeatures: {trainings: false, notifications: false}});
    const routes = visibleRoutes(h);
    assert.equal(routes.includes('training'), false);
    assert.equal(routes.includes('notifications'), false);
  }
  assert.deepEqual(visibleRoutes(harness({appFeatures: {trainings: false}})), ['notifications']);
  assert.deepEqual(visibleRoutes(harness({appFeatures: {notifications: false}})), ['training']);
});

test('permissões de leitura existentes permitem consultar sem mostrar formulários de gestão', () => {
  const h = harness({session: approved({trainingsRead: true, notificationsRead: true})});
  assert.deepEqual(visibleRoutes(h), ['training', 'notifications']);
  assert.equal(h.ui.can('trainingsRead'), true);
  assert.equal(h.ui.can('notificationsRead'), true);
  assert.equal(h.ui.can('trainingsManage'), false);
  assert.equal(h.ui.can('notificationsManage'), false);
  assert.equal(h.ui.actionForm('training'), '');
  assert.equal(h.ui.actionForm('notifications'), '');
});

for (const route of ['training', 'notifications']) {
  test(`${route}: sem permissão mostra aviso de acesso e encerra antes de importar ou consultar dados`, async () => {
    for (const permissions of [{}, {trainingsRead: false, trainingsManage: false, notificationsRead: false, notificationsManage: false}]) {
      const h = harness({session: approved(permissions), route});
      await h.ui.loadModule(route);
      assert.match(h.content.innerHTML, /Seu perfil ainda não tem acesso ao conteúdo desta área/);
      assert.match(h.content.innerHTML, /role="status"/);
      assert.deepEqual(h.imports, []);
      assert.deepEqual(h.queries, []);
      assert.deepEqual(h.navigations, []);
    }
  });

  test(`${route}: módulo globalmente inativo retorna à Home antes de importar ou consultar`, async () => {
    const h = harness({session: approved(), route, appFeatures: {[route === 'training' ? 'trainings' : route]: false}});
    await h.ui.loadModule(route);
    assert.deepEqual(h.navigations, ['home']);
    assert.equal(h.content.innerHTML, '');
    assert.deepEqual(h.imports, []);
    assert.deepEqual(h.queries, []);
  });

  test(`${route}: leitura previamente autorizada conserva a consulta do fluxo existente`, async () => {
    const h = harness({session: approved({[route === 'training' ? 'trainingsRead' : 'notificationsRead']: true}), route});
    await h.ui.loadModule(route);
    assert.ok(h.imports.includes(route === 'training' ? './performance-ui.js' : './data.js'));
    if(route === 'training') {assert.equal(h.imports.includes('./training.js'),false); assert.equal(h.queries.some(query=>query.name==='listModuleRecords'),false);}
    assert.ok(h.queries.length > 0);
    assert.doesNotMatch(h.content.innerHTML, /ainda não tem acesso/);
    assert.deepEqual(h.navigations, []);
    assert.equal(h.ui.actionForm(route), '');
  });
}
