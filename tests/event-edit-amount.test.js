import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {eventAmountToPay, eventFieldRules} from '../src/event-form.js';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const begin = source.slice(source.indexOf('function beginEventEdit(item)'), source.indexOf('function resetEventEditor()'));
const fields = source.slice(source.indexOf('function updateEventEntryFields(form)'), source.indexOf('async function render()'));

function fixture() {
  const wrapper = {classList: {toggle() {}}};
  const controls = Object.fromEntries(['eventDate', 'memberSigla', 'scheduleSigla', 'memberStatus', 'eventType', 'description', 'delayMultiple', 'substitute', 'shift', 'payer', 'creditor', 'amountToPay', 'editEventId', 'editEventVersion'].map(name =>
    [name, {name, value: '', dataset: {}, options: [], closest: () => wrapper, append() {}}]));
  const form = {elements: controls, dataset: {}, querySelector: () => ({hidden: false, textContent: ''})};
  const dialog = {open: false, classList: {add() {}}, showModal() {this.open = true;}};
  const title = {setAttribute() {}, focus() {}};
  const context = vm.createContext({
    eventReportMode: 'daily', can: () => true, eventAmountToPay, eventFieldRules,
    loadedEventCatalog: {payers: [], creditors: []}, setEventTypeContext() {},
    Event: class {}, document: {querySelector: selector => selector.startsWith('[data-module-form') ? form : selector === '#event-launch-dialog' ? dialog : selector === '#event-launch-title' ? title : null,
      createElement: () => ({})}
  });
  vm.runInContext(fields + '\n' + begin, context);
  controls.eventType.dispatchEvent = () => context.updateEventEntryFields(form);
  const edit = (overrides = {}) => context.beginEventEdit({id: 'fictional-event', version: 1, date: '2026-09-30', eventType: 'ATRASO', memberStatus: 'Membro fictício', delayMultiple: 2, amountToPay: 200, ...overrides});
  return {form, controls, edit, refresh: () => context.updateEventEntryFields(form)};
}

test('abrir atraso histórico e editar apenas membro preserva o valor gravado', () => {
  const value = fixture();
  value.edit();
  assert.equal(String(value.controls.amountToPay.value), '200');
  value.controls.memberStatus.value = 'Outro membro fictício';
  value.refresh();
  assert.equal(String(value.controls.amountToPay.value), '200');
  assert.equal(value.controls.amountToPay.disabled, true);
});

test('alterar múltiplo ou turno recalcula com a regra atual sem migrar outros registros', () => {
  const value = fixture();
  value.edit();
  value.controls.delayMultiple.value = '3';
  value.refresh();
  assert.equal(value.controls.amountToPay.value, '600');
  value.refresh();
  assert.equal(value.controls.amountToPay.value, '600');
  value.controls.eventType.value = 'Gestão';
  value.controls.shift.value = 'Manhã';
  value.refresh();
  assert.equal(value.controls.amountToPay.value, '1000');
});

test('valor histórico zero permanece zero e campo irrelevante não muda a base do atraso', () => {
  const value = fixture();
  value.edit({amountToPay: 0, shift: 'Integral'});
  value.refresh();
  assert.equal(String(value.controls.amountToPay.value), '0');
});

test('novo atraso calcula a R$200 e edição manual mantém o valor preenchido', () => {
  const value = fixture();
  value.controls.eventType.value = 'ATRASO';
  value.controls.delayMultiple.value = '2';
  value.refresh();
  assert.equal(value.controls.amountToPay.value, '400');
  value.edit({eventType: 'Ausência', shift: 'Integral', amountToPay: 750});
  value.refresh();
  assert.equal(String(value.controls.amountToPay.value), '750');
  assert.equal(value.controls.amountToPay.disabled, false);
});
