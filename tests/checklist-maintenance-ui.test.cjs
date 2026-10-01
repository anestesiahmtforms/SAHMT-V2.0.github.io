const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const helpers = readFileSync(join(__dirname, '../src/checklist-maintenance.js'), 'utf8').replaceAll('export ', '');
const start = source.indexOf('function showChecklistStationBanner('), end = source.indexOf('async function openChecklistQrScanner(', start);
assert.ok(start >= 0 && end > start);
const banner = source.slice(start, end).replaceAll("await import('./data.js')", 'await loadDataModule()');
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
function harness({importGate, manage = true, write = false} = {}) {
  const dialog = new Element(); dialog.open = false; dialog.showModal = () => {dialog.open = true;}; dialog.close = () => {dialog.open = false;};
  const title = new Element(), result = new Element(), actions = new Element(), status = new Element(), close = new Element();
  let children = {}, resultChildren = {};
  Object.defineProperty(result, 'innerHTML', {set(markup) {
    result.html = markup; const alert = new Element(); alert.hidden = /data-checklist-maintenance-alert\s+hidden/.test(markup);
    resultChildren = {'[data-checklist-maintenance-alert]': alert};
    if (markup.includes('data-checklist-station-manual')) resultChildren['[data-checklist-station-manual]'] = new Element();
  }});
  result.querySelector = selector => resultChildren[selector] || null;
  Object.defineProperty(actions, 'innerHTML', {set(markup) {
    actions.html = markup; children = {};
    for (const key of fields) {
      const input = new Element(); input.type = 'date'; input.disabled = true;
      input.value = markup.match(new RegExp(`data-checklist-maintenance-date="${key}" value="([^"]*)"`))[1];
      children[`[data-checklist-maintenance-date="${key}"]`] = input;
      const row = new Element(); row.classList.toggle('is-overdue', new RegExp(`class="checklist-maintenance-date is-overdue" data-checklist-maintenance-row="${key}"`).test(markup));
      children[`[data-checklist-maintenance-row="${key}"]`] = row;
    }
    const save = new Element(); save.hidden = true; children['[data-checklist-maintenance-save]'] = save;
    if (markup.includes('data-checklist-maintenance-edit')) children['[data-checklist-maintenance-edit]'] = new Element();
    if (markup.includes('checklist-station-response')) children['.checklist-station-response'] = new Element();
    for (const active of ['true', 'false']) if (markup.includes(`data-checklist-station-active="${active}"`)) {
      const toggle = new Element(); toggle.dataset.checklistStationActive = active;
      children[`[data-checklist-station-active="${active}"]`] = toggle;
    }
  }});
  actions.querySelector = selector => children[selector] || null;
  actions.querySelectorAll = selector => selector === '[data-checklist-station-active]' ? Object.entries(children).filter(([key]) => key.startsWith('[data-checklist-station-active=')).map(([, value]) => value) : [];
  const nodes = {'#checklist-station-dialog': dialog, '#checklist-station-title': title, '#checklist-station-result': result, '#checklist-station-actions': actions, '#checklist-station-status': status, '#checklist-station-close': close};
  const response = deferred(), started = deferred(), calls = [];
  const toggleResponse = deferred(), toggleStarted = deferred(), toggleCalls = [], reportCalls = [], reloadCalls = [];
  const dataModule = {
    saveChecklistStationMaintenance: (id, value, uid) => {calls.push({id, value: structuredClone(value), uid}); started.resolve(); return response.promise;},
    saveChecklistStation: (value, uid) => {toggleCalls.push({value: structuredClone(value), uid}); toggleStarted.resolve(); return toggleResponse.promise;}
  };
  const context = {
    document: {querySelector: selector => nodes[selector] || null}, window: {confirm: () => true}, session: {user: {uid: 'manager-A'}}, manage, write,
    todayInputValue: () => '2026-10-01', checklistDayMode: (day, today) => day === today ? 'today' : 'history', stationIsValidOn: () => true,
    escapeHtml: value => String(value || ''), formatRecordDate: value => value, interactionDateTime: value => value,
    loadDataModule: () => importGate ? importGate.promise : Promise.resolve(dataModule),
    ensureChecklistDailyReportOpen: day => reportCalls.push(day),
    loadDailyChecklist: async (_stations, day) => {reloadCalls.push(day);}
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}\nfunction can(permission) {return permission === 'checklistManage' ? manage : permission === 'checklistWrite' && write;}\n${banner}`, context);
  const show = (item, day = '2026-10-01') => context.showChecklistStationBanner(item, {condition: 'SIM'}, day, [item]);
  const input = (key = fields[0]) => children[`[data-checklist-maintenance-date="${key}"]`];
  return {context, dialog, title, result, actions, status, calls, response, started, dataModule, show, input,
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
  h.context.manage = false; h.status.textContent = 'Acesso revogado'; h.response.resolve({maintenance: dates('2029-01-01')}); await pending;
  assert.equal(h.status.textContent, 'Acesso revogado'); assert.equal(h.input().value, '2028-01-01'); assert.deepEqual(a.maintenance, dates());
  await h.save().fire('click'); assert.equal(h.calls.length, 1);
});
test('erro de manutenção antiga não substitui o estado de acesso revogado', async () => {
  const h = harness(), a = station('A'); h.show(a); h.edit(); const pending = h.save().fire('click'); await h.started.promise;
  h.context.manage = false; h.status.textContent = 'Acesso revogado'; h.response.reject(Object.assign(new Error('Resposta antiga recusada'), {code: 'permission-denied'})); await pending;
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
  if (changed === 'permission') h.context.manage = false;
  if (changed === 'banner') {h.dialog.close(); h.show(station('B'));}
  gate.resolve(h.dataModule); await pending; assert.equal(h.calls.length, 0);
});
test('leitor comum vê os três calendários desativados e não tem controles administrativos', async () => {
  const h = harness({manage: false}); h.show(station('A'));
  assert.deepEqual(h.dates(), dates()); assert.ok(fields.every(key => h.input(key).type === 'date' && h.input(key).disabled));
  assert.ok(!h.actions.html.includes('data-checklist-maintenance-edit')); assert.ok(!h.actions.html.includes('data-checklist-station-active'));
  await h.save().fire('click'); assert.equal(h.calls.length, 0);
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
test('ordem mantém manual após situação, Editar após datas e ativação no final', () => {
  const h = harness({write: true}); h.show(station('A'));
  assert.match(h.result.html, /<\/span><\/div><button[^>]*data-checklist-station-manual/);
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
  if (changed === 'permission') h.context.manage = false;
  if (changed === 'banner') {h.dialog.close(); h.show(station('B'));}
  gate.resolve(h.dataModule); await pending;
  assert.deepEqual(h.toggleCalls, []); assert.deepEqual(h.reloadCalls, []);
});

test('erro de desativação após revogação não substitui o estado de acesso', async () => {
  const h = harness(), a = station('A'); h.show(a);
  const pending = h.toggle(); await h.toggleStarted.promise;
  h.context.manage = false; h.status.textContent = 'Acesso revogado';
  h.toggleResponse.reject(Object.assign(new Error('Erro antigo'), {code: 'permission-denied'})); await pending;
  assert.equal(h.status.textContent, 'Acesso revogado'); assert.equal(a.active, true); assert.equal(h.toggleButton().disabled, true);
});

test('erro da ativação A depois de abrir B e revogar gestão não altera B', async () => {
  const h = harness(), a = station('A'), b = station('B'); a.active = false; h.show(a);
  const pending = h.toggle('true'); await h.toggleStarted.promise;
  h.dialog.close(); h.show(b); h.context.manage = false; h.status.textContent = 'Estado B';
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
