const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const helpers = readFileSync(join(__dirname, '../src/checklist-maintenance.js'), 'utf8').replaceAll('export ', '') + '\n' + readFileSync(join(__dirname, '../src/checklist-checker.js'), 'utf8').replaceAll('export ', '');
const start = source.indexOf('function showChecklistStationBanner('), end = source.indexOf('async function openChecklistQrScanner(', start);
assert.ok(start >= 0 && end > start);
const banner = source.slice(start, end).replaceAll("await import('./data.js')", 'await loadDataModule()');
const canSource = source.slice(source.indexOf('function can(permission)'), source.indexOf('function vacationRankMarkup('));
const answerStart = source.indexOf('async function saveChecklistAnswer(');
const answerWrapper = source.slice(answerStart, source.indexOf('async function loadEventReport(', answerStart)).replaceAll("await import('./data.js')", 'await loadDataModule()');
const fields = ['preventiveAnnual', 'electricalAnnual', 'calibrationSemiannual'];
const dates = (preventiveAnnual = '2027-01-01', electricalAnnual = '2027-02-02', calibrationSemiannual = '2027-03-03') => ({preventiveAnnual, electricalAnnual, calibrationSemiannual});
const station = id => ({id, name: `Arsenal fictício ${id}`, active: true, maintenance: dates()});
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
class Element {
  constructor() {
    this.listeners = new Map(); this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = '';
    const classes = new Set(); this.classList = {contains: value => classes.has(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value)};
  }
  addEventListener(name, listener) {this.listeners.set(name, listener);}
  fire(name) {return this.listeners.get(name)?.();}
  focus() {}
}
function harness({importGate, manage = true, write = false, admin = true, realAnswer = false} = {}) {
  const dialog = new Element(); dialog.open = false; dialog.showModal = () => {dialog.open = true;}; dialog.close = () => {dialog.open = false;};
  const title = new Element(), result = new Element(), actions = new Element(), responses = new Element(), controls = new Element(), checker = new Element(), status = new Element(), close = new Element();
  let children = {}, resultChildren = {};
  Object.defineProperty(result, 'innerHTML', {set(markup) {
    result.html = markup; const alert = new Element(); alert.hidden = /data-checklist-maintenance-alert\s+hidden/.test(markup);
    resultChildren = {'[data-checklist-maintenance-alert]': alert};
    if (markup.includes('data-checklist-station-manual')) resultChildren['[data-checklist-station-manual]'] = new Element();
  }});
  result.querySelector = selector => resultChildren[selector] || null;
  let checkerChildren = {};
  Object.defineProperty(checker, 'innerHTML', {set(markup) {
    checker.html = markup; checkerChildren = {};
    const commitment = new Element(); commitment.hidden = /class="checklist-station-commitment" hidden/.test(markup);
    checkerChildren['.checklist-station-commitment'] = commitment;
    if (markup.includes('data-checklist-checker-name')) {const name = new Element(); name.textContent = markup.match(/data-checklist-checker-name>([^<]*)</)[1]; checkerChildren['[data-checklist-checker-name]'] = name;}
  }});
  checker.querySelector = selector => checkerChildren[selector] || null;
  Object.defineProperty(responses, 'innerHTML', {set(markup) {responses.html = markup;}});
  Object.defineProperty(controls, 'innerHTML', {set(markup) {
    controls.html = markup; actions.html = responses.html + markup; children = {};
    for (const key of fields) {
      const input = new Element(); input.type = 'date'; input.disabled = true;
      input.value = markup.match(new RegExp(`data-checklist-maintenance-date="${key}" value="([^"]*)"`))[1];
      children[`[data-checklist-maintenance-date="${key}"]`] = input;
      const row = new Element(); row.classList.toggle('is-overdue', new RegExp(`class="checklist-maintenance-date is-overdue" data-checklist-maintenance-row="${key}"`).test(markup));
      children[`[data-checklist-maintenance-row="${key}"]`] = row;
    }
    if (markup.includes('data-checklist-maintenance-save')) {const save = new Element(); save.hidden = true; children['[data-checklist-maintenance-save]'] = save;}
    if (markup.includes('data-checklist-maintenance-edit')) children['[data-checklist-maintenance-edit]'] = new Element();
    if (responses.html.includes('checklist-station-response')) {
      const response = new Element(); response.hidden = /class="checklist-station-response" hidden/.test(responses.html);
      children['.checklist-station-response'] = response;
      for (const condition of ['SIM', 'NAO']) {const button = new Element(); button.dataset.checklistBannerAnswer = condition; children[`[data-checklist-banner-answer="${condition}"]`] = button;}
      children['#checklist-station-occurrence'] = new Element();
      const justification = new Element(); justification.hidden = true; children['[data-checklist-justification]'] = justification;
      const save = new Element(); save.hidden = true; children['[data-checklist-banner-save]'] = save;
    }
    for (const active of ['true', 'false']) if (markup.includes(`data-checklist-station-active="${active}"`)) {
      const toggle = new Element(); toggle.dataset.checklistStationActive = active;
      children[`[data-checklist-station-active="${active}"]`] = toggle;
    }
  }});
  actions.querySelector = selector => children[selector] || null;
  actions.querySelectorAll = selector => Object.entries(children).filter(([key]) => (selector === '[data-checklist-station-active]' && key.startsWith('[data-checklist-station-active=')) || (selector === '[data-checklist-banner-answer]' && key.startsWith('[data-checklist-banner-answer='))).map(([, value]) => value);
  const nodes = {'#checklist-station-dialog': dialog, '#checklist-station-title': title, '#checklist-station-result': result, '#checklist-station-actions': actions, '#checklist-station-responses': responses, '#checklist-station-controls': controls, '#checklist-station-checker': checker, '#checklist-station-status': status, '#checklist-station-close': close};
  const response = deferred(), started = deferred(), calls = [];
  const toggleResponse = deferred(), toggleStarted = deferred(), toggleCalls = [], reportCalls = [], reloadCalls = [];
  const answerResponse = deferred(), answerStarted = deferred(), answerCalls = [];
  const creatorResponse = deferred(), creatorStarted = deferred(), creatorCalls = [];
  const dataModule = {
    getChecklistCreatorName: (uid) => {creatorCalls.push(uid); creatorStarted.resolve(); return creatorResponse.promise;},
    saveChecklistStationMaintenance: (id, value, uid) => {calls.push({id, value: structuredClone(value), uid}); started.resolve(); return response.promise;},
    saveChecklistStation: (value, uid) => {toggleCalls.push({value: structuredClone(value), uid}); toggleStarted.resolve(); return toggleResponse.promise;},
    createOperationalRecord: (module, value, options) => {answerCalls.push({module, value: structuredClone(value), uid: options.uid}); answerStarted.resolve(); return answerResponse.promise;}
  };
  const context = {
    document: {querySelector: selector => nodes[selector] || null}, window: {confirm: () => true},
    session: {user: {uid: 'manager-A'}, profile: {role: admin ? 'administrador_app' : 'anestesiologista', displayName: 'Carlos Pereira Santos', permissions: {checklistManage: manage, checklistWrite: write}}},
    currentRoute: () => 'checklist', selectedManagementAreaId: '',
    todayInputValue: () => '2026-10-01', checklistDayMode: (day, today) => day === today ? 'today' : 'history', stationIsValidOn: () => true,
    escapeHtml: value => String(value || ''), formatRecordDate: value => value, interactionDateTime: value => value,
    loadDataModule: () => importGate ? importGate.promise : Promise.resolve(dataModule),
    saveChecklistAnswer: (id, condition, day, occurrence, options) => {answerCalls.push({id, condition, day, occurrence, uid: options.uid}); answerStarted.resolve(); return answerResponse.promise;},
    ensureChecklistDailyReportOpen: day => reportCalls.push(day),
    loadDailyChecklist: async (_stations, day) => {reloadCalls.push(day);}
  };
  Object.defineProperty(context, 'admin', {get: () => context.session.profile.role === 'administrador_app' || context.session.profile.permissions.admin === true, set: value => {context.session.profile.role = value ? 'administrador_app' : 'anestesiologista'; context.session.profile.permissions.admin = false;}});
  Object.defineProperty(context, 'manage', {get: () => context.session.profile.permissions.checklistManage, set: value => {context.session.profile.permissions.checklistManage = value;}});
  vm.createContext(context);
  vm.runInContext(`${helpers}\n${canSource}\n${realAnswer ? answerWrapper : ''}\n${banner}`, context);
  const show = (item, day = '2026-10-01', options = {}, record = {condition: 'SIM'}) => context.showChecklistStationBanner(item, record, day, [item], options);
  const input = (key = fields[0]) => children[`[data-checklist-maintenance-date="${key}"]`];
  return {context, dialog, title, result, actions, responses, controls, checker, status, calls, response, started, dataModule, show, input,
    answerResponse, answerStarted, answerCalls, creatorResponse, creatorStarted, creatorCalls,
    answer: (condition = 'SIM') => children[`[data-checklist-banner-answer="${condition}"]`]?.fire('click'),
    justification: () => children['[data-checklist-justification]'],
    answers: () => children['.checklist-station-response'], commitment: () => checkerChildren['.checklist-station-commitment'], checkerName: () => checkerChildren['[data-checklist-checker-name]'],
    toggleResponse, toggleStarted, toggleCalls, reportCalls, reloadCalls,
    toggleButton: (active = 'false') => children[`[data-checklist-station-active="${active}"]`],
    toggle: (active = 'false') => children[`[data-checklist-station-active="${active}"]`]?.fire('click'),
    dates: () => Object.fromEntries(fields.map(key => [key, input(key).value])), alert: () => resultChildren['[data-checklist-maintenance-alert]'],
    overdue: key => children[`[data-checklist-maintenance-row="${key}"]`].classList.contains('is-overdue'),
    save: () => children['[data-checklist-maintenance-save]'], edit: () => children['[data-checklist-maintenance-edit]']?.fire('click')};
}

test('resposta da manutenção A não substitui datas ou status do banner B', async () => {
  const h = harness(), a = station('A'), b = station('B'); h.show(a); h.edit(); h.input().value = '2028-01-01';
  const pending = h.save().fire('click'); await h.started.promise;
  h.dialog.close(); h.show(b); h.edit(); h.input().value = '2029-01-01'; h.status.textContent = 'Mensagem do banner B';
  h.response.resolve({maintenance: dates('2028-01-01')}); await pending;
  assert.equal(h.input().value, '2029-01-01'); assert.equal(h.input().disabled, false); assert.equal(h.save().hidden, false);
  assert.equal(h.status.textContent, 'Mensagem do banner B'); assert.deepEqual(a.maintenance, dates()); assert.deepEqual(b.maintenance, dates());
  assert.equal(h.dialog.open, true); assert.deepEqual(h.calls, [{id: 'A', value: dates('2028-01-01'), uid: 'manager-A'}]);
});
test('resposta antiga não atualiza manutenção após troca de sessão', async () => {
  const h = harness(), a = station('A'); h.show(a); h.edit(); h.input().value = '2028-01-01';
  const pending = h.save().fire('click'); await h.started.promise;
  h.context.session.user = {uid: 'manager-B'}; h.status.textContent = 'Sessão atualizada'; h.response.resolve({maintenance: dates('2029-01-01')}); await pending;
  assert.equal(h.status.textContent, 'Sessão atualizada'); assert.equal(h.input().value, '2028-01-01'); assert.deepEqual(a.maintenance, dates()); assert.equal(h.calls[0].uid, 'manager-A');
});
test('revogar gestão durante o salvamento impede resposta de alterar a interface', async () => {
  const h = harness(), a = station('A'); h.show(a); h.edit(); h.input().value = '2028-01-01';
  const pending = h.save().fire('click'); await h.started.promise;
  h.context.admin = false; h.status.textContent = 'Acesso revogado'; h.response.resolve({maintenance: dates('2029-01-01')}); await pending;
  assert.equal(h.status.textContent, 'Acesso revogado'); assert.equal(h.input().value, '2028-01-01'); assert.deepEqual(a.maintenance, dates());
  await h.save().fire('click'); assert.equal(h.calls.length, 1);
});
test('erro de manutenção antiga não substitui o estado de acesso revogado', async () => {
  const h = harness(), a = station('A'); h.show(a); h.edit(); const pending = h.save().fire('click'); await h.started.promise;
  h.context.admin = false; h.status.textContent = 'Acesso revogado'; h.response.reject(Object.assign(new Error('Resposta antiga recusada'), {code: 'permission-denied'})); await pending;
  assert.equal(h.status.textContent, 'Acesso revogado'); assert.deepEqual(a.maintenance, dates());
});
test('salvamento normal usa UID e três datas capturados e confirma o banner atual', async () => {
  const h = harness(), a = station('A'); h.show(a); h.edit(); h.input().value = '2028-01-01';
  const pending = h.save().fire('click'); await h.started.promise; h.input().value = '2029-01-01'; assert.equal(h.save().disabled, true);
  h.response.resolve({maintenance: dates('2028-01-01')}); await pending;
  assert.deepEqual(h.calls, [{id: 'A', value: dates('2028-01-01'), uid: 'manager-A'}]); assert.deepEqual(a.maintenance, dates('2028-01-01'));
  assert.deepEqual(h.dates(), dates('2028-01-01')); assert.ok(fields.every(key => h.input(key).disabled));
  assert.equal(h.save().hidden, true); assert.equal(h.save().disabled, false); assert.equal(h.status.textContent, 'Manutenção salva.');
});
test('datas enviadas são capturadas antes da importação assíncrona dos dados', async () => {
  const gate = deferred(), h = harness({importGate: gate}); h.show(station('A')); h.edit(); h.input().value = '2028-01-01';
  const pending = h.save().fire('click'); h.input().value = '2029-01-01'; gate.resolve(h.dataModule); await h.started.promise;
  assert.deepEqual(h.calls, [{id: 'A', value: dates('2028-01-01'), uid: 'manager-A'}]); h.response.resolve({maintenance: dates('2028-01-01')}); await pending; assert.equal(h.input().value, '2028-01-01');
});
for (const changed of ['session', 'permission', 'banner']) test(`mudança de ${changed} enquanto importa dados bloqueia a escrita`, async () => {
  const gate = deferred(), h = harness({importGate: gate}); h.show(station('A')); h.edit(); const pending = h.save().fire('click');
  if (changed === 'session') h.context.session.user = {uid: 'manager-B'};
  if (changed === 'permission') h.context.admin = false;
  if (changed === 'banner') {h.dialog.close(); h.show(station('B'));}
  gate.resolve(h.dataModule); await pending; assert.equal(h.calls.length, 0);
});
test('leitor comum vê os três calendários desativados e não tem controles administrativos', async () => {
  const h = harness({manage: false, admin: false}); h.show(station('A'));
  assert.deepEqual(h.dates(), dates()); assert.ok(fields.every(key => h.input(key).type === 'date' && h.input(key).disabled));
  assert.ok(!h.actions.html.includes('data-checklist-maintenance-edit')); assert.ok(!h.actions.html.includes('data-checklist-station-active'));
  assert.equal(h.save(), undefined); assert.equal(h.calls.length, 0);
});
test('vencimento usa hoje e não a data histórica, com alerta apenas no item vencido', () => {
  const h = harness(), a = station('A'); a.maintenance = dates('2026-09-30', '2026-10-01', ''); h.show(a, '2026-01-01');
  assert.equal(h.alert().hidden, false); assert.equal(h.overdue('preventiveAnnual'), true); assert.equal(h.overdue('electricalAnnual'), false); assert.equal(h.overdue('calibrationSemiannual'), false);
  assert.match(h.result.html, /MANUTENÇÃO EM ATRASO/); assert.ok(!h.result.html.includes('Arsenal fictício A')); assert.equal(h.title.textContent, 'Arsenal fictício A');
});
test('datas salvas e alerta persistem ao reabrir e datas futuras não são incrementadas', async () => {
  const h = harness(), a = station('A'); h.show(a); h.edit(); h.input().value = '2026-09-30'; const pending = h.save().fire('click'); await h.started.promise;
  h.response.resolve({maintenance: dates('2026-09-30')}); await pending; assert.equal(h.alert().hidden, false); assert.equal(h.overdue('preventiveAnnual'), true);
  h.dialog.close(); h.show(a); assert.deepEqual(h.dates(), dates('2026-09-30')); assert.equal(h.alert().hidden, false); assert.ok(fields.every(key => h.input(key).disabled)); assert.equal(h.input('electricalAnnual').value, '2027-02-02');
});
test('limpar as datas remove o alerta sem alterar a situação do Checklist', async () => {
  const h = harness(), a = station('A'); a.maintenance = dates('2026-09-30'); h.show(a); h.edit(); fields.forEach(key => {h.input(key).value = '';});
  const pending = h.save().fire('click'); await h.started.promise; h.response.resolve({maintenance: dates('', '', '')}); await pending;
  assert.equal(h.alert().hidden, true); assert.ok(fields.every(key => !h.overdue(key))); assert.match(h.result.html, /<strong>Conforme<\/strong>/);
});
test('ordem mantém respostas após situação, Editar após datas e ativação no final', () => {
  const h = harness({write: true}); h.show(station('A'));
  assert.match(h.result.html, /<\/span><\/div>$/); assert.match(h.responses.html, /class="checklist-station-response-options"/); assert.match(h.responses.html, /Conforme/); assert.ok(!h.result.html.includes('data-checklist-station-manual'));
  assert.ok(h.actions.html.indexOf('data-checklist-maintenance-edit') > h.actions.html.lastIndexOf('data-checklist-maintenance-date'));
  assert.ok(h.actions.html.indexOf('data-checklist-station-active') > h.actions.html.indexOf('data-checklist-maintenance-save'));
  assert.match(h.actions.html, /Ativar Arsenal/); assert.match(h.actions.html, /Desativar Arsenal/);
});

test('resposta da desativação A não fecha nem altera o banner B', async () => {
  const h = harness(), a = station('A'), b = station('B'); h.show(a);
  const pending = h.toggle(); await h.toggleStarted.promise;
  h.dialog.close(); h.show(b); h.status.textContent = 'Banner B atual'; h.edit(); h.input().value = '2029-01-01';
  h.toggleResponse.resolve(); await pending;
  assert.equal(h.dialog.open, true); assert.equal(h.title.textContent, 'Arsenal fictício B'); assert.equal(h.status.textContent, 'Banner B atual');
  assert.equal(h.input().value, '2029-01-01'); assert.equal(a.active, true); assert.equal(b.active, true);
  assert.equal(h.toggleButton().disabled, false); assert.deepEqual(h.reportCalls, []); assert.deepEqual(h.reloadCalls, []);
});

for (const changed of ['session', 'permission', 'banner']) test(`mudança de ${changed} durante import da ativação bloqueia a escrita`, async () => {
  const gate = deferred(), h = harness({importGate: gate}); h.show(station('A'));
  const pending = h.toggle();
  if (changed === 'session') h.context.session.user = {uid: 'manager-B'};
  if (changed === 'permission') h.context.admin = false;
  if (changed === 'banner') {h.dialog.close(); h.show(station('B'));}
  gate.resolve(h.dataModule); await pending;
  assert.deepEqual(h.toggleCalls, []); assert.deepEqual(h.reloadCalls, []);
});

test('erro de desativação após revogação não substitui o estado de acesso', async () => {
  const h = harness(), a = station('A'); h.show(a);
  const pending = h.toggle(); await h.toggleStarted.promise;
  h.context.admin = false; h.status.textContent = 'Acesso revogado';
  h.toggleResponse.reject(Object.assign(new Error('Erro antigo'), {code: 'permission-denied'})); await pending;
  assert.equal(h.status.textContent, 'Acesso revogado'); assert.equal(a.active, true); assert.equal(h.toggleButton().disabled, true);
});

test('erro da ativação A depois de abrir B e revogar gestão não altera B', async () => {
  const h = harness(), a = station('A'), b = station('B'); a.active = false; h.show(a);
  const pending = h.toggle('true'); await h.toggleStarted.promise;
  h.dialog.close(); h.show(b); h.context.admin = false; h.status.textContent = 'Estado B';
  h.toggleResponse.reject(new Error('Erro da solicitação A')); await pending;
  assert.equal(h.dialog.open, true); assert.equal(h.status.textContent, 'Estado B'); assert.equal(h.title.textContent, 'Arsenal fictício B');
  assert.equal(b.active, true); assert.deepEqual(h.reportCalls, []);
});

test('troca de sessão durante a gravação da desativação bloqueia resposta visual', async () => {
  const h = harness(), a = station('A'); h.show(a);
  const pending = h.toggle(); await h.toggleStarted.promise;
  h.context.session.user = {uid: 'manager-B'}; h.status.textContent = 'Nova sessão'; h.toggleResponse.resolve(); await pending;
  assert.equal(h.toggleCalls[0].uid, 'manager-A'); assert.equal(a.active, true); assert.equal(h.dialog.open, true);
  assert.equal(h.status.textContent, 'Nova sessão'); assert.deepEqual(h.reloadCalls, []);
});

for (const active of ['true', 'false']) test(`${active === 'true' ? 'ativação' : 'desativação'} normal usa UID capturado e fecha somente o banner atual`, async () => {
  const h = harness(), a = station('A'); a.active = active !== 'true'; h.show(a);
  const pending = h.toggle(active); await h.toggleStarted.promise;
  assert.equal(h.toggleCalls.length, 1); assert.equal(h.toggleCalls[0].uid, 'manager-A'); assert.equal(h.toggleCalls[0].value.stationId, 'A');
  assert.equal(h.toggleCalls[0].value.active, active === 'true'); h.toggleResponse.resolve(); await pending;
  assert.equal(a.active, active === 'true'); assert.equal(h.dialog.open, false);
  assert.deepEqual(h.reportCalls, ['2026-10-01']); assert.deepEqual(h.reloadCalls, ['2026-10-01']);
});

test('delegado checklistManage sem admin não vê controles administrativos, mas pode responder via QR', async () => {
  const h = harness({admin: false, manage: true, write: true}); h.show(station('A'), '2026-10-01', {fromQr: true});
  assert.equal(h.context.manage, true); assert.ok(!h.result.html.includes('data-checklist-station-manual'));
  assert.ok(!h.controls.html.includes('data-checklist-maintenance-edit')); assert.ok(!h.controls.html.includes('data-checklist-station-active'));
  assert.ok(fields.every(key => h.input(key).disabled)); assert.equal(h.answers().hidden, false);
  assert.match(h.responses.html, /Conforme/); assert.match(h.responses.html, /Não Conforme/);
  assert.equal(h.save(), undefined); assert.ok(!h.controls.html.includes('data-checklist-maintenance-save')); assert.deepEqual(h.calls, []);
});

for (const variant of ['role', 'permission']) test(`admin por ${variant} possui os três blocos e ações administrativas`, () => {
  const h = harness({admin: false, manage: false, write: false});
  h.context.session.profile = variant === 'role' ? {role: 'administrador_app', permissions: {}} : {role: 'anestesiologista', permissions: {admin: true}};
  h.show(station('A'));
  assert.match(h.responses.html, /data-checklist-banner-answer/); assert.match(h.controls.html, /data-checklist-maintenance-edit/); assert.match(h.controls.html, /data-checklist-station-active/);
  assert.equal((h.controls.html.match(/class="checklist-station-block/g) || []).length, 2);
  h.edit(); assert.ok(fields.every(key => !h.input(key).disabled));
});

test('revogação somente de admin bloqueia Editar e respostas manuais mesmo mantendo gestão e escrita', async () => {
  const h = harness({manage: true, write: true}); h.show(station('A'));
  assert.equal(h.answers().hidden, false); h.context.admin = false; assert.equal(h.context.manage, true);
  h.edit(); h.answer('SIM'); h.answer('NAO'); await settle(); assert.ok(fields.every(key => h.input(key).disabled)); assert.equal(h.save().hidden, true); assert.deepEqual(h.answerCalls, []); assert.equal(h.justification().hidden, true);
});

test('respostas manuais imediatas permanecem no primeiro bloco ao pedir justificativa', () => {
  const h = harness(); h.show(station('A')); assert.equal(h.answers().hidden, false);
  const input = h.input(), title = h.title, result = h.result;
  h.answer('NAO'); assert.equal(h.answers().hidden, false); assert.equal(h.input(), input); assert.equal(h.title, title); assert.equal(h.result, result);
  assert.ok(!h.controls.html.includes('checklist-station-response')); assert.ok(h.responses.html.includes('checklist-station-response'));
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test('admin revogado após abrir banner não salva resposta manual nem abre justificativa', async () => {
  const h = harness({write: true}); h.show(station('A')); assert.equal(h.answers().hidden, false);
  h.context.admin = false; assert.equal(h.context.manage, true); assert.equal(h.context.session.profile.permissions.checklistWrite, true);
  h.answer('SIM'); h.answer('NAO'); await settle();
  assert.deepEqual(h.answerCalls, []); assert.equal(h.justification().hidden, true); assert.equal(h.status.textContent, '');
});

test('resposta antiga do Checklist A não fecha nem altera banner B', async () => {
  const h = harness(), a = station('A'), b = station('B'); h.show(a); h.answer(); await h.answerStarted.promise;
  h.dialog.close(); h.show(b); h.status.textContent = 'Banner B atual';
  h.answerResponse.resolve({ok: true}); await settle();
  assert.equal(h.dialog.open, true); assert.equal(h.title.textContent, 'Arsenal fictício B'); assert.equal(h.status.textContent, 'Banner B atual');
  assert.deepEqual(h.reloadCalls, []); assert.deepEqual(h.reportCalls, []);
});

test('QR de usuário comum continua salvando Checklist sem administração', async () => {
  const h = harness({admin: false, manage: false, write: true}); h.show(station('A'), '2026-10-01', {fromQr: true}); h.answer(); await h.answerStarted.promise;
  assert.equal(h.answerCalls[0].uid, 'manager-A'); assert.equal(h.answerCalls[0].condition, 'SIM');
  h.answerResponse.resolve({ok: true}); await settle();
  assert.equal(h.dialog.open, false); assert.deepEqual(h.reportCalls, ['2026-10-01']); assert.deepEqual(h.reloadCalls, ['2026-10-01']);
});

for (const changed of ['session', 'admin', 'day', 'route', 'removed-dialog']) test(`wrapper real bloqueia escrita se ${changed} mudar durante import interno`, async () => {
  const gate = deferred(), h = harness({importGate: gate, realAnswer: true, write: true}); h.show(station('A')); h.answer();
  if (changed === 'session') h.context.session.user = {uid: 'manager-B'};
  if (changed === 'admin') {h.context.admin = false; assert.equal(h.context.manage, true); assert.equal(h.context.session.profile.permissions.checklistWrite, true);}
  if (changed === 'day') h.context.todayInputValue = () => '2026-10-02';
  if (changed === 'route') h.context.currentRoute = () => 'home';
  if (changed === 'removed-dialog') {const query = h.context.document.querySelector; h.context.document.querySelector = selector => selector === '#checklist-station-dialog' ? null : query(selector);}
  gate.resolve(h.dataModule); await settle(); assert.deepEqual(h.answerCalls, []); assert.deepEqual(h.reloadCalls, []);
});

test('wrapper real usa UID capturado e mantém payload, condição e fila do Checklist', async () => {
  const gate = deferred(), h = harness({importGate: gate, realAnswer: true, admin: false, manage: false, write: true});
  h.show(station('A'), '2026-10-01', {fromQr: true}); h.answer(); gate.resolve(h.dataModule); await h.answerStarted.promise;
  assert.deepEqual(h.answerCalls, [{module: 'checklists', value: {createdByName: 'Carlos Pereira Santos', stationId: 'A', date: '2026-10-01', condition: 'SIM', status: 'COMPLETED', occurrence: '', responsibleUid: null, responsibleName: null, responsibleEmail: null}, uid: 'manager-A'}]);
  h.answerResponse.resolve({pendingFirestore: true}); await settle();
  assert.equal(h.dialog.open, false); assert.deepEqual(h.reloadCalls, ['2026-10-01']);
});


test('admin manual mostra as duas respostas imediatamente abaixo da situação', () => {
  const h = harness(); h.show(station('A'));
  assert.equal(h.answers().hidden, false); assert.equal(h.dialog.dataset.manualChecklist, 'true');
  assert.ok(!h.result.html.includes('data-checklist-station-manual')); assert.ok(!h.responses.html.includes('Registrar checklist'));
  assert.match(h.responses.html, /class="checklist-station-response-options"[\s\S]*Conforme[\s\S]*Não Conforme/);
});

test('comum sem QR não recebe botões para responder ou gravar manualmente', async () => {
  const h = harness({admin: false, manage: true, write: true}); h.show(station('A'));
  assert.equal(h.answers(), undefined); assert.equal(h.responses.html, ''); assert.equal(h.dialog.dataset.manualChecklist, 'false');
  h.answer(); await settle(); assert.deepEqual(h.answerCalls, []);
});

test('resumo usa autor do registro, data e compromisso acima do nome no Não Conforme', () => {
  const h = harness(); h.show(station('A'), '2026-10-01', {}, {condition: 'NAO', createdByUid: 'checker-C', createdByName: 'Mariana Pereira Costa', createdAt: '2026-10-01T15:25:00Z', occurrence: 'Equipamento fictício requer revisão.'});
  assert.equal(h.checkerName().textContent, 'Mariana Costa'); assert.match(h.checker.html, /01\/10\/2026.*12:25/);
  assert.equal(h.commitment().hidden, false);
  assert.ok(h.checker.html.indexOf('Me comprometo') < h.checker.html.indexOf('data-checklist-checker-name'));
  assert.ok(!h.result.html.includes('Mariana')); assert.ok(!h.result.html.includes('Último registro'));
});

test('Conforme oculta compromisso e selecionar Não Conforme mostra compromisso e justificativa', () => {
  const h = harness(); h.show(station('A')); assert.equal(h.commitment().hidden, true);
  h.answer('NAO'); assert.equal(h.commitment().hidden, false); assert.equal(h.justification().hidden, false);
});

test('registro pendente mostra horário local e aguarda sincronização', () => {
  const h = harness(); h.show(station('A'), '2026-10-01', {}, {condition: 'SIM', createdByUid: 'manager-A', createdAt: '2026-10-01T15:25:00Z', pendingSync: true});
  assert.equal(h.checkerName().textContent, 'Carlos Santos'); assert.match(h.checker.html, /Checagem local/);
  assert.match(h.checker.html, /Horário local:/); assert.match(h.checker.html, /Aguardando sincronização/); assert.ok(!h.checker.html.includes('Última checagem'));
});

test('resposta antiga da autoria não troca o resumo do banner B', async () => {
  const h = harness(); h.show(station('A'), '2026-10-01', {}, {condition: 'SIM', createdByUid: 'legacy-A'}); await h.creatorStarted.promise;
  h.dialog.close(); h.show(station('B'), '2026-10-01', {}, {condition: 'SIM', createdByUid: 'checker-B', createdByName: 'Rita de Lima'});
  h.creatorResponse.resolve('Autor Antigo'); await settle();
  assert.equal(h.checkerName().textContent, 'Rita Lima'); assert.deepEqual(h.creatorCalls, ['legacy-A']);
});

test('perder permissão para consultar perfis bloqueia resposta de autoria antiga', async () => {
  const h = harness({manage: true, write: true}); h.show(station('A'), '2026-10-01', {}, {condition: 'SIM', createdByUid: 'legacy-A'}); await h.creatorStarted.promise;
  h.context.admin = false; h.creatorResponse.resolve('Autor Antigo'); await settle();
  assert.equal(h.checkerName().textContent, 'Nome não disponível');
});

test('leitor comum não consulta perfil de outro checker nem confunde responsável de assinatura', async () => {
  const h = harness({admin: false, manage: false, write: true}); h.show(station('A'), '2026-10-01', {fromQr: true}, {condition: 'SIM', createdByUid: 'legacy-A', responsibleName: 'Nome de assinatura'}); await settle();
  assert.equal(h.checkerName().textContent, 'Nome não disponível'); assert.deepEqual(h.creatorCalls, []);
});
