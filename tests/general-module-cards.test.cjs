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

function harness({session = approved(), appFeatures = {}, route = 'home', hasContent = true, secondaryDomainProjects = {}} = {}) {
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
    session, appFeatures, secondaryDomainProjects, selectedManagementAreaId: '', route, evaluationModuleGeneration:0, cleanupCurrentModule:null,
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
    extractFunction('can'), extractFunction('canOpenRestrictedModule'), extractFunction('hasOccurrencePermission'), extractFunction('moduleCards'), extractFunction('managementUtilityCards'),
    extractFunction('actionForm'), loadModule,
    'globalThis.realModuleUi = {can, moduleCards, managementUtilityCards, actionForm, loadModule};'
  ].join('\n'), context);
  return {context, ui: context.realModuleUi, content, imports, queries, navigations};
}

function visibleRoutes(h) {
  return [...h.ui.moduleCards().matchAll(/data-route="([^"]+)"/g)].map((match) => match[1]);
}
function cardMarkup(h, route) {
  return h.ui.moduleCards().match(new RegExp(`<button\\b(?=[^>]*data-route="${route}")[^>]*>[\\s\\S]*?<\\/button>`))?.[0] || '';
}

const legacyManagementPermissions = ['managementManage', 'managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage', 'equipmentManage', 'qualityManage', 'financeRead', 'financeWrite', 'financeManage', 'peopleManage', 'usersManage'];

for (const role of ['gestor', 'coordenador', 'anestesiologista', 'temporario']) {
  test(`menu Gestão aparece para ${role}, mas grupos continuam protegidos sem liberação`, async () => {
    for (const permission of legacyManagementPermissions) {
      const session = approved({[permission]: true}, role);
      const before = structuredClone(session);
      const h = harness({session, route: 'management'});
      assert.equal(visibleRoutes(h).includes('management-hub'), true, permission);
      assert.doesNotMatch(cardMarkup(h, 'management-hub'), /disabled/);
      assert.equal(h.context.canOpenRestrictedModule('management'), false);
      await h.ui.loadModule('management');
      assert.deepEqual(h.navigations, ['home'], permission);
      assert.deepEqual(h.imports, [], permission);
      assert.deepEqual(h.queries, [], permission);
      assert.deepEqual(session, before);
    }
  });
}

function renderHarness(session) {
  const navigations = [], loads = [], shells = [];
  const context = vm.createContext({
    deployment:{target:'FA',externalManagementEnabled:false},
    operationalDrafts:{flush:async()=>{},restore:async()=>{}},deniedOperationalModules:new Set(),
    session, appFeatures: {}, secondaryDomainProjects: {}, selectedManagementAreaId: '', evaluationModuleGeneration: 0,
    liveReports: new Map(), reportStates: new Map(), reportPayloads: new Map(),
    labelReportLoad: 0, labelReportLoadingMore: false, labelReportState: 'idle',
    scheduleGridObserver:null, cleanupLabelMedia: null, cleanupCurrentModule: null, cleanupDocumentTraining:null, cleanupUserInspection:null, startupBannerActive: false,
    stopChecklistQrScanner() {}, currentRoute: () => 'management',
    app: {innerHTML: '', querySelectorAll: () => []}, notice: '', labels: {management: ['Gestão']},
    navigate: target => navigations.push(target), shellView: () => { shells.push('shell'); return ''; },
    featureEnabledForRoute: () => true, preloadOperationalDataWhenIdle() {}, renderOfflineOperationalView: async () => {},
    document: {querySelectorAll: () => [], querySelector: () => null},
    loadModule: async route => loads.push(route), bindModuleForm: async () => {},
    updateInformationBanner() {}, updateOutboxStatus: async () => {}, syncOutbox: async () => {}, navigator: {onLine: true}
  });
  vm.runInContext(features.replace(/^export /gm, '') + `\n${extractFunction('can')}\n${extractFunction('canOpenRestrictedModule')}\n${extractFunction('render', {async: true})}\nglobalThis.runRender = render;`, context);
  return {context, navigations, loads, shells};
}

test('modo offline preserva a tela normal e troca somente o painel salvo ao redesenhar', async () => {
  const {mountOfflineOperationalDashboard} = await import('../src/offline-operational-snapshot.js');
  assert.match(main, /const routeKind = \{home: 'schedule', checklist: 'checklist', events: 'events', labels: 'labels'\}\[route\]/);
  assert.match(main, /route === 'home' \? document\.querySelector\('#schedule-content'\) : document\.querySelector\('\.module-view\.panel'\)/);
  const host = fakeOfflineHost('<nav data-route="events">Eventos</nav><section id="schedule-content">Escala</section>');
  mountOfflineOperationalDashboard(host, '<section class="offline-operational-dashboard">Cópia inicial</section>');
  assert.match(host.innerHTML, /data-route="events"/);
  assert.match(host.innerHTML, /Escala/);
  mountOfflineOperationalDashboard(host, '<section class="offline-operational-dashboard">Cópia atualizada</section>');
  assert.match(host.innerHTML, /data-route="events"/);
  assert.match(host.innerHTML, /Cópia atualizada/);
  assert.doesNotMatch(host.innerHTML, /Cópia inicial/);
});


test('painel offline fica na área do módulo e preserva os contêineres visuais do app', async () => {
  const {offlineOperationalDashboardMarkup} = await import('../src/offline-operational-snapshot.js');
  const markup = offlineOperationalDashboardMarkup({
    route: 'home',
    day: '2026-10-19',
    snapshots: {schedule: {schedule: {positions: ['A']}, cachedAt: Date.now()}},
    permissions: {schedule: true}
  });
  assert.match(markup, /class="offline-operational-dashboard"/);
  assert.match(markup, /class="offline-operational-sections content-grid"/);
  assert.match(markup, /class="offline-operational-section panel"/);
  assert.match(markup, /class="offline-readonly-notice sync-state"/);
  assert.match(markup, /class="siglas-grid"/);
  assert.doesNotMatch(markup, /Última cópia deste aparelho/);
});

test('painel offline mostra apenas a rota aberta', async () => {
  const {offlineOperationalDashboardMarkup} = await import('../src/offline-operational-snapshot.js');
  const markup = offlineOperationalDashboardMarkup({
    route: 'events',
    day: '2026-10-19',
    snapshots: {events: {records: [{eventType: 'Evento'}]}, labels: {records: [{patientName: 'Outro'}]}},
    permissions: {events: true, labels: true}
  });
  assert.match(markup, /<h3>Eventos<\/h3>/);
  assert.doesNotMatch(markup, /<h3>Etiquetas<\/h3>/);
});

function fakeOfflineHost(initial) {
  return {
    innerHTML: initial,
    querySelector(selector) {
      if (selector !== '.offline-operational-dashboard') return null;
      const match = this.innerHTML.match(/<section class="offline-operational-dashboard">[\s\S]*?<\/section>/);
      return match ? {remove: () => { this.innerHTML = this.innerHTML.replace(match[0], ''); }} : null;
    },
    insertAdjacentHTML(position, markup) {
      assert.equal(position, 'beforeend');
      this.innerHTML += markup;
    }
  };
}

test('link direto de Gestão bloqueia antes de renderizar e carregar; revogação também bloqueia', async () => {
  for (const session of [approved({managementRead: true}, 'gestor'), approved({admin: 'true'})]) {
    const h = renderHarness(session);
    await h.context.runRender();
    assert.deepEqual(h.navigations, ['home']);
    assert.deepEqual(h.shells, []);
    assert.deepEqual(h.loads, []);
  }
  for (const session of [approved({}, 'administrador_app'), approved({admin: true})]) {
    const h = renderHarness(session);
    await h.context.runRender();
    assert.deepEqual(h.navigations, []);
    assert.deepEqual(h.loads, ['management']);
    session.profile.role = 'gestor';
    session.profile.permissions = {managementRead: true};
    await h.context.runRender();
    assert.deepEqual(h.navigations, ['home']);
    assert.deepEqual(h.shells, ['shell']);
    assert.deepEqual(h.loads, ['management']);
  }
});

test('Gestão reúne a navegação sem liberar o conteúdo dos grupos ou de Desempenho', () => {
  const session = approved();
  const before = structuredClone(session);
  const h = harness({session});
  assert.deepEqual(visibleRoutes(h), ['management-hub']);
  assert.doesNotMatch(cardMarkup(h, 'management-hub'), /disabled/);
  assert.equal(h.context.canOpenRestrictedModule('management'), false);
  assert.equal(h.context.canOpenRestrictedModule('training'), false);
  assert.match(h.ui.moduleCards(), /<strong>Gestão<\/strong>/);
  assert.doesNotMatch(h.ui.moduleCards(), /data-route="training"/);
  assert.doesNotMatch(h.ui.moduleCards(), /NOTIFICAÇÕES DE EVENTOS|data-route="occurrences"/);
  for (const permission of ['trainingsRead', 'trainingsManage', 'notificationsRead', 'notificationsManage', 'usersManage', 'admin']) {
    assert.equal(h.ui.can(permission), false, `${permission} continua sem concessão`);
  }
  assert.equal(h.ui.managementUtilityCards(), '');
  assert.equal(h.ui.actionForm('training'), '');
  assert.equal(h.ui.actionForm('notifications'), '');
  assert.deepEqual(session, before);
});

test('Ocorrências fica dentro de Gestão sem conceder novas permissões ao usuário', () => {
  for (const session of [approved(), approved({notificationsRead: false, occurrencesWrite: false}, 'gestor')]) {
    const before = structuredClone(session);
    const h = harness({session, appFeatures: {occurrences: true, notifications: false}});
    const cards = h.ui.moduleCards();
    assert.equal((cards.match(/data-route="occurrences"/g) || []).length, 0);
    assert.match(cards, /data-route="management-hub"/);
    assert.equal(h.context.hasOccurrencePermission(), true);
    assert.doesNotMatch(cards, /NOTIFICAÇÕES DE EVENTOS|data-route="notifications"/);
    assert.deepEqual(session, before);
  }
});

test('flags false nas permissões não ocultam os cartões comuns nem alteram o mapa do perfil', () => {
  const session = approved({trainingsRead: false, notificationsRead: false, labelsWrite: true});
  const before = structuredClone(session);
  const h = harness({session});
  assert.deepEqual(visibleRoutes(h), ['labels', 'management-hub']);
  assert.equal(h.ui.can('trainingsRead'), false);
  assert.equal(h.ui.can('notificationsRead'), false);
  assert.deepEqual(session, before);
});

test('administradores preservam os cartões e os controles administrativos existentes', () => {
  for (const session of [approved({}, 'administrador_app'), approved({admin: true})]) {
    const h = harness({session});
    assert.deepEqual(visibleRoutes(h), ['events', 'labels', 'management-hub', 'checklist']);
    assert.doesNotMatch(cardMarkup(h, 'management-hub'), /disabled/);
    assert.equal(h.context.canOpenRestrictedModule('training'), true);
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

test('o menu Gestão permanece disponível quando os destinos estão desativados', () => {
  const common = harness({session: approved(), appFeatures: {management: false, trainings: false, notifications: false}});
  assert.deepEqual(visibleRoutes(common), ['management-hub']);
  assert.doesNotMatch(cardMarkup(common, 'management-hub'), /disabled/);
  assert.equal(common.context.canOpenRestrictedModule('management'), false);
  assert.equal(common.context.canOpenRestrictedModule('training'), false);
  assert.equal(visibleRoutes(common).includes('notifications'), false);
  const admin = harness({session: approved({}, 'administrador_app'), appFeatures: {management: false, trainings: false, notifications: false}});
  assert.equal(visibleRoutes(admin).includes('training'), false);
  assert.equal(visibleRoutes(admin).includes('notifications'), false);
  assert.deepEqual(visibleRoutes(harness({appFeatures: {trainings: false}})), ['management-hub']);
  assert.deepEqual(visibleRoutes(harness({appFeatures: {notifications: false}})), ['management-hub']);
});

test('permissões de leitura existentes permitem consultar sem mostrar formulários de gestão', () => {
  const h = harness({session: approved({trainingsRead: true, notificationsRead: true})});
  assert.deepEqual(visibleRoutes(h), ['management-hub']);
  assert.equal(h.ui.can('trainingsRead'), true);
  assert.equal(h.ui.can('notificationsRead'), true);
  assert.equal(h.ui.can('trainingsManage'), false);
  assert.equal(h.ui.can('notificationsManage'), false);
  assert.equal(h.ui.actionForm('training'), '');
  assert.equal(h.ui.actionForm('notifications'), '');
});

for (const route of ['training']) {
  test(`${route}: usuário comum retorna à Home antes de importar ou consultar dados`, async () => {
    for (const permissions of [{}, {trainingsRead: false, trainingsManage: false, notificationsRead: false, notificationsManage: false}]) {
      const h = harness({session: approved(permissions), route});
      await h.ui.loadModule(route);
      assert.equal(h.content.innerHTML, '');
      assert.deepEqual(h.imports, []);
      assert.deepEqual(h.queries, []);
      assert.deepEqual(h.navigations, ['home']);
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
    const h = harness({session: approved({trainingsRead:true}, 'administrador_app'), route});
    await h.ui.loadModule(route);
    assert.ok(h.imports.includes(route === 'training' ? './performance-ui.js' : './data.js'));
    if(route === 'training') {assert.equal(h.imports.includes('./training.js'),false); assert.equal(h.queries.some(query=>query.name==='listModuleRecords'),false);}
    assert.ok(h.queries.length > 0);
    assert.doesNotMatch(h.content.innerHTML, /ainda não tem acesso/);
    assert.deepEqual(h.navigations, []);
    if (route === 'training') assert.match(h.ui.actionForm(route), /Gerenciar catálogo de treinamentos/);
  });
}

for (const role of ['gestor', 'coordenador', 'anestesiologista']) {
  test(`Informações bloqueia ${role} mesmo com permissão antiga de notificações`, async () => {
    const h = harness({session: approved({notificationsRead:true, notificationsManage:true}, role), route:'notifications'});
    assert.doesNotMatch(h.ui.managementUtilityCards(), /data-route="notifications"/);
    assert.equal(h.ui.actionForm('notifications'), '');
    await h.ui.loadModule('notifications');
    assert.deepEqual(h.imports, []);
    assert.deepEqual(h.queries, []);
    assert.match(h.content.innerHTML, /ainda não tem acesso/);
  });
}
test('Informações fica somente em Gestão para administrador; o cartão de ocorrências depende da flag', () => {
  const h = harness({session:approved({}, 'administrador_app')});
  assert.match(h.ui.managementUtilityCards(), /data-route="notifications"/);
  assert.match(h.ui.managementUtilityCards(), /<strong>INFORMAÇÕES<\/strong>/);
  assert.doesNotMatch(h.ui.moduleCards(), /data-route="notifications"/);
  assert.doesNotMatch(h.ui.moduleCards(), /NOTIFICAÇÕES DE EVENTOS|data-route="occurrences"/);
});

test('pausa administrativa mantém os dois módulos inativos mesmo com permissões individuais', () => {
 const h=harness({session:approved({managementRead:true}),secondaryDomainProjects:{management:'FA',training:'FA'}});
 assert.doesNotMatch(cardMarkup(h,'management-hub'), /disabled/);
 assert.equal(h.context.canOpenRestrictedModule('management'),false);
 assert.equal(h.context.canOpenRestrictedModule('training'),false);
 const p=harness({session:approved({trainingsRead:true}),secondaryDomainProjects:{management:'FA',training:'FA'}});
 assert.doesNotMatch(cardMarkup(p,'management-hub'), /disabled/);
 assert.equal(p.context.canOpenRestrictedModule('management'),false);
 assert.equal(p.context.canOpenRestrictedModule('training'),false);
});
test('liberação de domínio exige perfil ativo e permissão booleana', () => {
 const h=harness();
 for(const profile of [null,{active:false,access:true,permissions:{managementRead:true}},
 {active:true,access:false,permissions:{managementRead:true}},
 {active:true,access:true,role:'administrador_app',permissions:{}},
 {active:true,access:true,permissions:{managementRead:'true'}}])
 assert.equal(h.context.secondaryDomainAccess('management',profile,{management:'FA'}),false);
});


function individuallyReleased(permissions = {}) {
  const session = approved({managementRead: true, trainingsRead: true, ...permissions});
  session.profile.uid = session.user.uid;
  return session;
}

test('liberação individual habilita apenas os dois módulos solicitados, sem poderes administrativos', async () => {
  const session = individuallyReleased({managementModuleEnabled: true, performanceModuleEnabled: true});
  const before = structuredClone(session);
  const h = harness({session, route: 'training'});
  for (const route of ['management', 'training']) assert.equal(h.context.canOpenRestrictedModule(route),true);
  for (const permission of ['admin', 'usersManage', 'managementManage', 'trainingsManage']) assert.equal(h.ui.can(permission), false);
  assert.equal(h.ui.managementUtilityCards(), '');
  await h.ui.loadModule('training');
  assert.deepEqual(h.navigations, []);
  assert.deepEqual(h.queries, [{name: 'mountPerformanceModule'}]);
  assert.deepEqual(session, before);
  const direct = renderHarness(session);
  await direct.context.runRender();
  assert.deepEqual(direct.navigations, []);
  assert.deepEqual(direct.loads, ['management']);
});

test('liberações de Gestão e Desempenho são independentes e não liberam QMENTUM', () => {
  for (const [flag, route, blocked] of [['managementModuleEnabled','management','training'], ['performanceModuleEnabled','training','management']]) {
    const h = harness({session: individuallyReleased({[flag]: true})});
    assert.equal(h.context.canOpenRestrictedModule(route),true);
    assert.equal(h.context.canOpenRestrictedModule(blocked),false);
    assert.equal(h.context.canOpenRestrictedModule('qmentum'), false);
  }
});

test('flag ausente, inválida, UID divergente, conta inativa ou sem leitura mantém bloqueio individual', async () => {
  const base = individuallyReleased({managementModuleEnabled: true, performanceModuleEnabled: true});
  const variants = [
    s => { delete s.profile.permissions.managementModuleEnabled; },
    s => { s.profile.permissions.managementModuleEnabled = 'true'; },
    s => { s.profile.uid = 'outra-pessoa'; },
    s => { delete s.profile.uid; },
    s => { s.profile.active = false; },
    s => { s.profile.access = false; },
    s => { s.profile.permissions.managementRead = false; }
  ];
  for (const mutate of variants) {
    const session = structuredClone(base); mutate(session);
    const h = harness({session, route: 'management'});
    assert.equal(h.context.canOpenRestrictedModule('management'), false);
    await h.ui.loadModule('management');
    assert.deepEqual(h.navigations, ['home']);
    assert.deepEqual(h.imports, []);
  }
});

test('troca de usuário e revogação não transportam a liberação para outra conta', async () => {
  const session = individuallyReleased({managementModuleEnabled: true, performanceModuleEnabled: true});
  const h = harness({session});
  assert.equal(h.context.canOpenRestrictedModule('management'), true);
  h.context.session = individuallyReleased();
  assert.equal(h.context.canOpenRestrictedModule('management'), false);
  h.context.session = session;
  session.profile.permissions.managementModuleEnabled = false;
  await h.ui.loadModule('management');
  assert.deepEqual(h.navigations, ['home']);
});

test('troca de tela encerra observação de treinamentos e consulta administrativa sem trocar a identidade',async()=>{
 const session=approved({},'administrador_app'),h=renderHarness(session);let documents=0,inspection=0;
 h.context.cleanupDocumentTraining=()=>documents++;h.context.cleanupUserInspection=()=>inspection++;
 await h.context.runRender();assert.equal(documents,1);assert.equal(inspection,1);assert.equal(h.context.cleanupDocumentTraining,null);assert.equal(h.context.cleanupUserInspection,null);assert.equal(session.user.uid,'pessoa-ficticia');
});
