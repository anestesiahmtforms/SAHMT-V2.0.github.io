import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildChecklistResponsibilityQueries, createChecklistResponsibilityListener, watchChecklistResponsibility} from '../src/checklist-responsibility-listener.js';
import {resolveChecklistResponsibility} from '../src/checklist-responsible.js';

const day = '2026-10-01', options = {day, uid: 'admin-fixture', isAdmin: true};
const contacts = [{id: 'AD', sigla: 'AD', name: 'Ana Dias', active: true}, {id: 'CR', sigla: 'CR', name: 'Caio Ramos', active: true},
  {id: 'LH', sigla: 'LH', name: 'Lia Horta', active: true}];
const schedule = {id: day, positions: ['AD', 'CR', 'LH']};
function document(value, pending = false) {
  return {id: value.id, data: () => ({...value}), exists: () => true, metadata: {fromCache: false, hasPendingWrites: pending}};
}
function docSnapshot(value = schedule, {fromCache = false, pending = false} = {}) {
  return {id: day, data: () => value && {...value}, exists: () => Boolean(value), metadata: {fromCache, hasPendingWrites: pending}};
}
function snapshot(values = [], {fromCache = false, pending = false, changes, pendingIds = []} = {}) {
  const docs = values.map((value) => document(value, pendingIds.includes(value.id)));
  return {docs, metadata: {fromCache, hasPendingWrites: pending}, docChanges: () => changes ?? docs.map((doc) => ({type: 'added', doc}))};
}
function harness(input = options, overrides = {}) {
  const subscriptions = [], updates = [], failures = [];
  let unsubscribed = 0, resolutions = 0;
  const sdk = {
    collection: (_db, name) => ({name}), doc: (_db, name, id) => ({name, id}),
    query: (base, ...constraints) => ({name: base.name, constraints}),
    where: (field, operator, value) => ({type: 'where', field, operator, value}),
    orderBy: (field, direction) => ({type: 'order', field, direction}), limit: (count) => ({type: 'limit', count}),
    onSnapshot(reference, metadata, next, error) {
      assert.deepEqual(metadata, {includeMetadataChanges: true});
      const subscription = {reference, next, error, active: true}; subscriptions.push(subscription);
      return () => {assert.equal(subscription.active, true); subscription.active = false; unsubscribed++;};
    }, ...overrides
  };
  const stop = createChecklistResponsibilityListener(input, (value) => updates.push(value), (error) => failures.push(error),
    {sdk, db: {}, resolve: (input) => {resolutions++; return resolveChecklistResponsibility(input);}});
  const source = (name) => subscriptions.find((item) => item.reference.name === name);
  return {sdk, subscriptions, updates, failures, stop, source, last: () => updates.at(-1), unsubscribed: () => unsubscribed, resolutions: () => resolutions};
}
function confirm(h, {vacations = [], events = [], contactValues = contacts} = {}) {
  h.source('scheduleDays').next(docSnapshot()); h.source('vacations').next(snapshot(vacations));
  h.source('contacts').next(snapshot(contactValues)); h.source('events').next(snapshot(events));
}

test('admin usa exatamente quatro fontes limitadas e preserva contatos inativos na consulta', () => {
  const h = harness(); assert.equal(h.subscriptions.length, 4);
  assert.deepEqual(h.source('scheduleDays').reference, {name: 'scheduleDays', id: day});
  assert.deepEqual(h.source('vacations').reference.constraints, [
    {type: 'where', field: 'active', operator: '==', value: true},
    {type: 'where', field: 'start', operator: '<=', value: day}, {type: 'where', field: 'end', operator: '>=', value: day},
    {type: 'order', field: 'start', direction: 'asc'}, {type: 'limit', count: 101}
  ]);
  assert.deepEqual(h.source('contacts').reference.constraints, [{type: 'order', field: 'sigla', direction: 'asc'}, {type: 'limit', count: 201}]);
  assert.deepEqual(h.source('events').reference.constraints, [
    {type: 'where', field: 'active', operator: '==', value: true}, {type: 'where', field: 'date', operator: '==', value: day},
    {type: 'order', field: 'date', direction: 'desc'}, {type: 'limit', count: 1001}
  ]);
  const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes;
  assert.ok(indexes.some((index) => index.collectionGroup === 'events' && index.fields.map((field) => field.fieldPath).join(',') === 'active,date'));
  assert.ok(indexes.some((index) => index.collectionGroup === 'vacations' && index.fields.map((field) => field.fieldPath).join(',') === 'active,start,end'));
  h.stop();
});

test('recusa usuário comum e contexto inválido antes de importar Firebase ou criar consultas', async () => {
  for (const input of [{...options, isAdmin: false}, {...options, isAdmin: 'true'}, {...options, uid: ''}, {...options, day: '2026-02-30'}]) {
    assert.throws(() => buildChecklistResponsibilityQueries(input, {}, {}));
    await assert.rejects(watchChecklistResponsibility(input, () => {}));
  }
});

test('aguarda todas as dependências e somente servidor pode confirmar o nome', () => {
  const h = harness(); h.source('scheduleDays').next(docSnapshot()); h.source('contacts').next(snapshot(contacts));
  h.source('vacations').next(snapshot()); assert.equal(h.last().ready, false); assert.equal(h.last().confirmed, false);
  assert.equal(h.last().responsible, null); h.source('events').next(snapshot([], {fromCache: true}));
  assert.equal(h.last().ready, true); assert.equal(h.last().responsible.name, 'Ana Dias'); assert.equal(h.last().fromCache, true);
  assert.equal(h.last().confirmed, false); h.source('events').next(snapshot([], {changes: []}));
  assert.equal(h.last().confirmed, true); assert.equal(h.last().stale, false); assert.equal(h.last().responsible.position, 1);
  assert.equal(h.last().responsible.responsibleUid, null); h.stop();
});

test('férias e substituições mantêm posição ascendente e remoção restaura anterior', () => {
  const h = harness(); confirm(h);
  const vacation = {id: 'vacation', active: true, start: day, end: day, siglas: ['AD']};
  h.source('vacations').next(snapshot([vacation])); assert.equal(h.last().responsible.name, 'Caio Ramos');
  const event = {id: 'event', date: day, active: true, eventType: 'Pessoal', memberStatus: 'Caio Ramos', substitute: 'Lia Horta'};
  h.source('events').next(snapshot([event])); assert.equal(h.last().responsible.name, 'Lia Horta'); assert.equal(h.last().responsible.position, 3);
  h.source('events').next(snapshot([], {changes: [{type: 'removed', doc: document(event)}]})); assert.equal(h.last().responsible.name, 'Caio Ramos');
  h.source('vacations').next(snapshot([], {changes: [{type: 'removed', doc: document(vacation)}]})); assert.equal(h.last().responsible.name, 'Ana Dias');
  assert.equal(h.subscriptions.length, 4); h.stop();
});

test('contato inativo com nome duplicado preserva bloqueio de substituição ambígua', () => {
  const h = harness(); const inactive = {id: 'inactive', sigla: 'ZZ', name: 'Ana Dias', active: false};
  const event = {id: 'event', date: day, active: true, eventType: 'Pessoal', memberStatus: 'Ana Dias', substitute: 'Caio Ramos'};
  confirm(h, {contactValues: [...contacts, inactive], events: [event]});
  assert.equal(h.last().responsible.name, null); assert.equal(h.last().confirmed, false); assert.match(h.last().reason, /sem membro identificável/);
  const modified = {...inactive, name: 'Outra pessoa fictícia'};
  h.source('contacts').next(snapshot([...contacts, modified], {changes: [{type: 'modified', doc: document(modified)}]}));
  assert.equal(h.last().responsible.name, 'Caio Ramos'); assert.equal(h.last().confirmed, true); h.stop();
});

test('metadata de qualquer fonte altera confirmação sem recalcular dados inalterados', () => {
  const h = harness(); confirm(h); const resolutions = h.resolutions();
  h.source('contacts').next(snapshot(contacts, {fromCache: true, changes: []}));
  assert.equal(h.last().confirmed, false); assert.equal(h.resolutions(), resolutions); assert.deepEqual(h.last().changedSources, []);
  h.source('contacts').next(snapshot(contacts, {changes: []})); assert.equal(h.last().confirmed, true); assert.equal(h.resolutions(), resolutions);
  h.source('scheduleDays').next(docSnapshot(schedule, {pending: true})); assert.equal(h.last().confirmed, false); assert.equal(h.last().hasPendingWrites, true);
  h.source('scheduleDays').next(docSnapshot()); assert.equal(h.last().confirmed, true); assert.equal(h.resolutions(), resolutions); h.stop();
});

test('pendência de documento impede confirmação mesmo quando metadata da query está limpa', () => {
  const h = harness(); confirm(h); h.source('contacts').next(snapshot(contacts, {pendingIds: ['AD'], changes: []}));
  assert.equal(h.last().hasPendingWrites, true); assert.equal(h.last().confirmed, false);
  h.source('contacts').next(snapshot(contacts, {changes: []})); assert.equal(h.last().confirmed, true); h.stop();
});

test('sentinela de férias, contatos ou eventos nunca confirma fonte truncada', () => {
  for (const [source, maximum] of [['vacations', 100], ['contacts', 200], ['events', 1000]]) {
    const h = harness(); confirm(h);
    const values = Array.from({length: maximum + 1}, (_, index) => ({id: `${source}-${index}`, active: false}));
    h.source(source).next(snapshot(values)); assert.equal(h.last().truncated, true); assert.equal(h.last().confirmed, false);
    const restored = source === 'contacts' ? contacts : [];
    h.source(source).next(snapshot(restored)); assert.equal(h.last().truncated, false); assert.equal(h.last().confirmed, true); h.stop();
  }
});

test('escala ausente ou nome sem contato nunca fica confirmado', () => {
  const h = harness(); confirm(h); h.source('scheduleDays').next(docSnapshot(null));
  assert.equal(h.last().ready, true); assert.equal(h.last().confirmed, false); assert.equal(h.last().responsible, null);
  assert.match(h.last().reason, /Escala não disponível/); h.source('scheduleDays').next(docSnapshot());
  h.source('contacts').next(snapshot([])); assert.equal(h.last().responsible.name, null); assert.equal(h.last().confirmed, false); h.stop();
});

test('erro da fonte bloqueia confirmação e é reportado sem abrir consultas extras', () => {
  const h = harness(); confirm(h); const error = Object.assign(new Error('Permissão negada na fonte.'), {code: 'permission-denied'});
  h.source('events').error(error); assert.equal(h.last().confirmed, false); assert.equal(h.last().error, error); assert.deepEqual(h.failures, [error]);
  assert.equal(h.subscriptions.length, 4); h.source('events').next(snapshot()); assert.equal(h.last().confirmed, true); h.stop();
});

test('desinscreve todas as fontes uma vez e ignora callbacks tardios do dia anterior', () => {
  const h = harness(); confirm(h); const count = h.updates.length; h.stop(); h.stop(); assert.equal(h.unsubscribed(), 4);
  h.source('scheduleDays').next(docSnapshot(null)); h.source('events').next(snapshot()); h.source('contacts').error(new Error('Tardio'));
  assert.equal(h.updates.length, count); assert.equal(h.failures.length, 0);
});

test('falha síncrona ao iniciar encerra os listeners já anexados', () => {
  let attached = 0, stopped = 0;
  const sdk = {collection: (_db, name) => ({name}), doc: (_db, name, id) => ({name, id}), query: (...args) => args,
    where: () => null, orderBy: () => null, limit: () => null, onSnapshot: () => {
      if (++attached === 3) throw new Error('Inicialização indisponível'); return () => stopped++;
    }};
  assert.throws(() => createChecklistResponsibilityListener(options, () => {}, () => {}, {sdk, db: {}}), /Inicialização/);
  assert.equal(stopped, 2);
});
