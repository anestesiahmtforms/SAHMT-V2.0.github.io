const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const day = '2026-09-22';
const contacts = [{sigla: 'AD', name: 'Ana'}, {sigla: 'CR', name: 'Carlos'}, {sigla: 'LH', name: 'Lia'}];
const vacations = [{siglas: ['LH', 'AD'], label: 'LH, AD'}];
const schedule = {
  positions: [{sigla: 'AD', function: '1 < 2 & 3'}, {sigla: 'CR/LH', position: 20}, {sigla: 'DC', function: 17}, {sigla: 'ZZ'}],
  highlights: {siglas: ['AD'], events: ['EVENTO:AD:2026-09-22:AD:registro-1']}
};
const domain = Promise.all([import('../src/schedule-view.js'), import('../src/feature-flags.js')]);

function sourceOf(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Função real ${name} deve existir`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/^(?:async )?function \w+\(/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function decodeText(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// A small fixture for the renderer's div/button/span markup and its click listeners.
// Browser geometry and native pointer hit testing are covered by the visual fixture.
class Element {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.isConnected = true;
    this.value = '';
  }
  get dataset() {
    return Object.fromEntries(Object.entries(this.attributes).filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
  }
  get disabled() { return Object.hasOwn(this.attributes, 'disabled'); }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasClass(name) { return (this.attributes.class || '').split(/\s+/).includes(name); }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? node.hasClass(selector.slice(1))
      : selector.startsWith('[') ? Object.hasOwn(node.attributes, selector.slice(1, -1))
        : node.tagName === selector;
    const found = [];
    const visit = node => {
      for (const child of node.children) if (typeof child !== 'string') {
        if (matches(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() {
    const ancestors = [];
    for (let node = this; node; node = node.parentElement) ancestors.push(node);
    if (ancestors.some(node => node.tagName === 'button' && node.disabled)) return;
    for (const currentTarget of ancestors) for (const listener of currentTarget.listeners.get('click') || []) listener({target: this, currentTarget});
  }
  set innerHTML(html) {
    this.children = [];
    const stack = [this];
    for (const [token] of html.matchAll(/<[^>]+>|[^<]+/g)) {
      if (token.startsWith('</')) {
        const closed = stack.pop();
        assert.equal(closed.tagName, token.slice(2, -1), 'HTML de teste deve fechar o elemento correspondente');
      } else if (token.startsWith('<')) {
        const [, tagName, rawAttributes] = token.match(/^<([\w-]+)([\s\S]*?)>$/);
        const attributes = {};
        for (const [, name, value] of rawAttributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attributes[name] = decodeText(value || '');
        const node = new Element(tagName, attributes);
        node.parentElement = stack.at(-1);
        node.parentElement.children.push(node);
        stack.push(node);
      } else stack.at(-1).children.push(decodeText(token));
    }
    assert.equal(stack.length, 1, 'HTML de teste deve estar balanceado');
  }
}

async function setup({mode = 'home', eventsWritable = false, activeContacts = contacts} = {}) {
  const [{buildScheduleView}, {featureEnabledForRoute, DEFAULT_APP_FEATURES}] = await domain;
  const content = new Element();
  const dateInput = new Element('input');
  const calls = [];
  const view = buildScheduleView(schedule, day, vacations, activeContacts);
  const ctx = vm.createContext({
    session: {user: {uid: 'user-1'}, profile: {sigla: 'AD', permissions: {eventsWrite: eventsWritable, scheduleWrite: true}}},
    appFeatures: DEFAULT_APP_FEATURES, currentRoute: () => mode, selectedManagementAreaId: '',
    featureEnabledForRoute, buildScheduleView, localDateKey: () => day,
    readCachedSchedule: async () => null,
    mockData: {readSchedule: async () => schedule, listActiveContacts: async () => activeContacts, listVacationsForDate: async () => vacations},
    document: {querySelector: selector => selector === (mode === 'home' ? '#schedule-date' : '#event-schedule-date') ? dateInput : selector === (mode === 'home' ? '#schedule-content' : '#event-schedule-content') ? content : null},
    showScheduleContacts: (records, context) => calls.push({kind: 'contact', records, context}),
    launchEventFromSchedule: (date, position) => calls.push({kind: 'event', date, position}),
    launchEventSupport: date => calls.push({kind: 'support', date})
  });
  vm.runInContext(['escapeHtml', 'can', 'vacationRankMarkup', 'renderScheduleSigla', 'renderScheduleAliases', 'renderSchedulePositionGrid', 'renderEventSupportTile', 'bindEventSupportButton'].map(sourceOf).join('\n'), ctx);
  return {
    ctx, content, dateInput, view, calls,
    render() {
      content.innerHTML = ctx.renderSchedulePositionGrid(view, {mode, schedule, eventsWritable});
      return content;
    },
    async bind() {
      const name = mode === 'home' ? 'loadHome' : 'bindEventSchedule';
      vm.runInContext(sourceOf(name).replaceAll("await import('./data-lite.js')", 'mockData'), ctx);
      await ctx[name]();
      await new Promise(resolve => setImmediate(resolve));
      return content;
    }
  };
}

function positions(content) { return content.querySelectorAll('[data-schedule-position-index]'); }
function assertCellButton(button, index) {
  assert.equal(button.tagName, 'button', 'A célula inteira deve ser o botão');
  assert.equal(button.getAttribute('type'), 'button');
  assert.equal(button.hasClass('sigla-item'), true);
  assert.equal(button.dataset.schedulePositionIndex, String(index));
  const token = button.querySelector('.sigla-token');
  const number = button.querySelector('.sigla-index');
  assert.ok(token, 'O rótulo deve permanecer dentro da célula');
  assert.ok(number, 'O número deve pertencer ao alvo de toque');
  assert.equal(token.tagName, 'span');
  assert.equal(number.tagName, 'span');
  assert.equal(token.parentElement, button);
  assert.equal(number.parentElement, button);
  assert.equal(button.querySelectorAll('button').length, 0, 'Não deve haver botões aninhados');
  assert.equal(token.getAttribute('data-schedule-position-index'), null, 'A ação deve estar no botão externo');
}

test('Escala mantém rótulos, índices, férias e DC dentro de uma única célula botão', async () => {
  const fixture = await setup();
  const content = fixture.render();
  const buttons = positions(content);
  assert.equal(buttons.length, fixture.view.positions.length);
  buttons.forEach(assertCellButton);
  assert.deepEqual(buttons.map(button => button.querySelector('.sigla-index').textContent), ['1 < 2 & 3', '20', '17', '4']);
  assert.equal(content.querySelector('[data-event-support]'), null);
  assert.equal(buttons[0].getAttribute('aria-label'), 'Abrir contato da sigla AD; em férias: AD, posição 2 na escala de férias');
  assert.equal(buttons[0].querySelector('.sigla-token').hasClass('sigla-token--vacation'), true);
  assert.equal(buttons[0].querySelector('.sigla-token').hasClass('sigla-token--checked'), true);
  assert.equal(buttons[0].querySelector('.sigla-token__vacation-number').textContent, '2');
  assert.equal(buttons[0].querySelector('.sigla-token__vacation-number').getAttribute('aria-label'), 'Posição 2 na escala de férias');
  assert.equal(buttons[2].querySelector('.sigla-token').hasClass('sigla-token--dc'), true);
  const aliases = buttons[2].querySelector('.sigla-token__aliases');
  assert.match(aliases.textContent, /CR.*LH.*AD/);
  assert.deepEqual(aliases.querySelectorAll('.sigla-token__vacation-number').map(node => node.textContent), ['1', '2']);
});

test('Eventos conserva ações acessíveis e oferece SUPORTE como botão independente', async () => {
  const fixture = await setup({mode: 'events', eventsWritable: true});
  const content = fixture.render();
  const buttons = positions(content);
  buttons.forEach(assertCellButton);
  assert.equal(buttons[0].getAttribute('aria-label'), 'Lançar evento pela sigla AD; em férias: AD, posição 2 na escala de férias');
  assert.equal(buttons[0].querySelector('.sigla-token').hasClass('sigla-token--event'), true);
  assert.equal(buttons[0].querySelector('.sigla-confirmation-check').getAttribute('aria-label'), 'Registro de evento confirmado no Firestore');
  const support = content.querySelector('[data-event-support]');
  assert.equal(support.tagName, 'button');
  assert.equal(support.hasClass('sigla-item'), true);
  assert.equal(support.getAttribute('type'), 'button');
  assert.equal(support.getAttribute('aria-label'), 'Lançar evento de Suporte');
  assert.equal(support.getAttribute('data-schedule-position-index'), null);
  assert.equal(support.querySelector('.sigla-token').tagName, 'span');
  assert.equal(support.querySelector('.sigla-token').hasClass('sigla-token--support'), true);
  assert.equal(support.querySelector('.sigla-index').getAttribute('aria-hidden'), 'true');
  assert.equal(support.querySelectorAll('button').length, 0);
});

test('disabled pertence à célula e respeita contatos e permissão de Eventos', async () => {
  const home = (await setup()).render();
  assert.deepEqual(positions(home).map(button => button.disabled), [false, false, false, true]);
  assert.equal(positions(home)[3].getAttribute('aria-label'), 'Contato não cadastrado para ZZ');
  const homeWriter = (await setup({eventsWritable: true})).render();
  assert.equal(positions(homeWriter).every(button => !button.disabled), true);
  const eventsReader = (await setup({mode: 'events'})).render();
  assert.equal(positions(eventsReader).every(button => button.disabled), true);
  assert.equal(eventsReader.querySelector('[data-event-support]').disabled, true);
  assert.match(positions(eventsReader)[0].getAttribute('aria-label'), /^Sigla AD;/);
  const eventsWriter = (await setup({mode: 'events', eventsWritable: true})).render();
  assert.equal(eventsWriter.querySelectorAll('.sigla-item').every(button => !button.disabled), true);
});

test('listener real da Home abre o contato da posição ao clicar no número, férias ou alias de DC', async () => {
  const fixture = await setup();
  const content = await fixture.bind();
  const buttons = positions(content);
  buttons[1].querySelector('.sigla-index').click();
  buttons[0].querySelector('.sigla-token__vacation-number').click();
  buttons[2].querySelector('.sigla-token__aliases').click();
  assert.deepEqual(fixture.calls.map(call => call.kind), ['contact', 'contact', 'contact']);
  assert.deepEqual(fixture.calls.map(call => call.context.sigla), ['CR/LH', 'AD', 'DC']);
  assert.deepEqual(fixture.calls.map(call => call.records.map(contact => contact.sigla)), [['CR', 'LH'], ['AD'], ['CR', 'LH', 'AD']]);
  assert.equal(fixture.calls.every(call => call.context.date === day && call.context.canRelease), true);
  buttons[3].querySelector('.sigla-index').click();
  assert.equal(fixture.calls.length, 3, 'Posição desabilitada não abre contato');
});

test('listener real de Eventos conserva posição e data nos cliques de descendentes e SUPORTE', async () => {
  const fixture = await setup({mode: 'events', eventsWritable: true});
  const content = await fixture.bind();
  const buttons = positions(content);
  buttons[1].querySelector('.sigla-index').click();
  buttons[0].querySelector('.sigla-token__vacation-number').click();
  buttons[2].querySelector('.sigla-token__aliases').click();
  content.querySelector('[data-event-support]').querySelector('strong').click();
  assert.deepEqual(fixture.calls.map(call => call.kind), ['event', 'event', 'event', 'support']);
  assert.deepEqual(fixture.calls.slice(0, 3).map(call => call.position.sigla), ['CR/LH', 'AD', 'DC']);
  assert.deepEqual(fixture.calls.slice(0, 3).map(call => call.position.index), [1, 0, 2]);
  assert.equal(fixture.calls.every(call => call.date === day), true);
});

test('Eventos em consulta bloqueia números, rótulos e SUPORTE no botão externo', async () => {
  const fixture = await setup({mode: 'events'});
  const content = await fixture.bind();
  for (const button of positions(content)) {
    button.querySelector('.sigla-index').click();
    button.querySelector('.sigla-token').click();
  }
  content.querySelector('[data-event-support]').querySelector('strong').click();
  assert.deepEqual(fixture.calls, []);
});
