import assert from 'node:assert/strict';
import {test} from 'node:test';
import {eventAmountToPay, eventFieldRules, normalizeEventType, validateEventForm} from '../src/event-form.js';

const blankEvent = {
  eventDate: '2026-09-24', memberStatus: '', eventType: '', description: '', delayMultiple: '',
  substitute: '', shift: '', payer: 'Pagador', creditor: 'Credor', amountToPay: '0'
};

test('normaliza acentos para aplicar as condições de tipo da V1', () => {
  assert.equal(normalizeEventType('Férias'), 'ferias');
  assert.deepEqual(eventFieldRules('ATRASO'), {memberStatus: true, description: false, delayMultiple: true, substitute: false, shift: false, disableSubstitute: true, payerMode: 'member', creditorMode: 'team', amountMode: 'delay'});
  assert.deepEqual(eventFieldRules('Suporte'), {memberStatus: false, description: false, delayMultiple: false, substitute: true, shift: true, disableSubstitute: false, payerMode: 'team', creditorMode: 'substitute', amountMode: 'shift'});
  assert.deepEqual(eventFieldRules('Gestão'), {memberStatus: true, description: false, delayMultiple: false, substitute: true, shift: true, disableSubstitute: false, payerMode: 'team', creditorMode: 'substitute', amountMode: 'shift'});
  assert.deepEqual(eventFieldRules('Outros'), {memberStatus: true, description: true, delayMultiple: true, substitute: true, shift: true, disableSubstitute: false, payerMode: 'manual', creditorMode: 'substitute', amountMode: 'manual'});
});

test('calcula atraso a R$ 200 por múltiplo e turnos pelo valor definido', () => {
  for (let multiple = 0; multiple <= 6; multiple++) {
    assert.equal(eventAmountToPay('ATRASO', String(multiple), ''), multiple * 200);
  }
  assert.equal(eventAmountToPay('ATRASO', '2', ''), 400);
  assert.equal(eventAmountToPay('ATRASO', '', ''), null);
  assert.equal(eventAmountToPay('ATRASO', '7', ''), null);
  assert.equal(eventAmountToPay('Suporte', '', 'Manhã'), 1000);
  assert.equal(eventAmountToPay('Congresso', '', 'Tarde'), 1000);
  assert.equal(eventAmountToPay('Gestão', '', 'Integral'), 2000);
  assert.equal(eventAmountToPay('Ausência', '', 'Integral'), null);
  assert.equal(eventAmountToPay('Outros', '3', 'Integral'), null);
});

test('ATRASO exige membro e múltiplo e não aceita substituto ou turno', () => {
  assert.throws(() => validateEventForm({...blankEvent, eventType: 'ATRASO', delayMultiple: '2'}), /membro/);
  assert.throws(() => validateEventForm({...blankEvent, eventType: 'ATRASO', memberStatus: 'AB — Atrasado'}), /múltiplo/);
  assert.equal(validateEventForm({...blankEvent, eventType: 'ATRASO', memberStatus: 'AB — Atrasado', delayMultiple: '0'}), true);
});

test('Suporte fixa a identificação SUPORTE e exige substituto e turno', () => {
  assert.throws(() => validateEventForm({...blankEvent, eventType: 'Suporte', memberStatus: 'SUPORTE'}), /substituto/);
  assert.throws(() => validateEventForm({...blankEvent, eventType: 'Suporte', substitute: 'Pessoa'}), /turno/);
  assert.equal(validateEventForm({...blankEvent, eventType: 'Suporte', memberStatus: 'SUPORTE', substitute: 'Pessoa', shift: 'Tarde'}), true);
});

test('categorias regulares exigem membro, substituto e turno', () => {
  for (const eventType of ['Pessoal', 'Férias', 'Gestão', 'Congresso', 'Saúde', 'Ausência']) {
    assert.throws(() => validateEventForm({...blankEvent, eventType}), /membro/);
    assert.throws(() => validateEventForm({...blankEvent, eventType, memberStatus: 'AB — Ausente'}), /substituto/);
    assert.throws(() => validateEventForm({...blankEvent, eventType, memberStatus: 'AB — Ausente', substitute: 'Pessoa'}), /turno/);
    assert.equal(validateEventForm({...blankEvent, eventType, memberStatus: 'AB — Ausente', substitute: 'Pessoa', shift: 'Manhã'}), true);
  }
});

test('Outros exige membro, descrição, múltiplo, substituto e turno', () => {
  assert.throws(() => validateEventForm({...blankEvent, eventType: 'Outros'}), /membro/);
  const partial = {...blankEvent, eventType: 'Outros', memberStatus: 'AB — Ausente', description: 'Evento', delayMultiple: '3', substitute: 'Pessoa', shift: 'Integral'};
  assert.equal(validateEventForm(partial), true);
  assert.throws(() => validateEventForm({...partial, description: ''}), /Descreva/);
});

test('todas as categorias exigem data, pagador, credor e valor não negativo', () => {
  const valid = {...blankEvent, eventType: 'Outros', memberStatus: 'AB — Ausente', description: 'Evento', delayMultiple: '3', substitute: 'Pessoa', shift: 'Integral'};
  assert.throws(() => validateEventForm({...valid, eventDate: ''}), /data/);
  assert.throws(() => validateEventForm({...valid, payer: ''}), /pagador/);
  assert.throws(() => validateEventForm({...valid, creditor: ''}), /credor/);
  assert.throws(() => validateEventForm({...valid, amountToPay: '-1'}), /valor/);
  assert.throws(() => validateEventForm({...valid, amountToPay: ''}), /valor/);
});

test('recusa datas impossíveis e aceita 29 de fevereiro somente em ano bissexto', () => {
  const valid = {...blankEvent, eventType: 'ATRASO', memberStatus: 'AB — Atrasado', delayMultiple: '1', eventDate: '2024-02-29'};
  assert.equal(validateEventForm(valid), true);
  for (const eventDate of ['2026-02-29', '2026-02-31', '2026-13-01', '0000-01-01']) {
    assert.throws(() => validateEventForm({...valid, eventDate}), /data válida/);
  }
});

test('cálculo de atraso no app corresponde ao multiplicador exigido pelo Firestore', async () => {
  const {readFile} = await import('node:fs/promises');
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const match = rules.match(/data\.eventType == 'ATRASO'[^\n]*data\.amountToPay == data\.delayMultiple \* (\d+)/);
  assert.ok(match, 'Validação financeira de ATRASO não encontrada nas regras.');
  for (let multiple = 0; multiple <= 6; multiple++) {
    assert.equal(eventAmountToPay('ATRASO', String(multiple), ''), multiple * Number(match[1]), `Múltiplo ${multiple} deve ser aceito pelo servidor.`);
  }
});
