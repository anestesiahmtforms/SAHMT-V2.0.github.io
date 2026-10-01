import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveChecklistResponsibility} from '../src/checklist-responsible.js';

const contacts = [
  {sigla: 'AD', name: 'Ana Dias', email: 'ana@example.invalid'},
  {sigla: 'CR', name: 'Caio Ramos', email: 'caio@example.invalid'},
  {sigla: 'LH', name: 'Lia Horta', email: 'lia@example.invalid'}
];

test('seleciona a primeira posição e a primeira sigla disponível na ordem V1', () => {
  const result = resolveChecklistResponsibility({
    day: '2026-09-22',
    schedule: {assignments: ['AD/CR', 'LH']},
    vacations: [{start: '2026-09-22', end: '2026-09-25', siglas: ['AD']}],
    contacts,
    profiles: [{uid: 'uid-cr', sigla: 'CR', displayName: 'Caio R.', email: 'caio@example.invalid'}]
  });
  assert.equal(result.sigla, 'CR');
  assert.equal(result.sourceSigla, 'AD/CR');
  assert.equal(result.position, 1);
  assert.equal(result.responsibleUid, 'uid-cr');
  assert.equal(result.name, 'Caio Ramos');
});

test('remove o membro substituído e ignora ATRASO e SUPORTE', () => {
  const result = resolveChecklistResponsibility({
    day: '2026-09-22',
    schedule: {assignments: ['AD', 'CR', 'LH']},
    contacts,
    events: [
      {date: '2026-09-22', memberStatus: 'Ana Dias', eventType: 'Pessoal', substitute: 'Caio Ramos', active: true},
      {date: '2026-09-22', memberStatus: 'Caio Ramos', eventType: 'ATRASO', substitute: '', active: true},
      {date: '2026-09-22', memberStatus: 'SUPORTE', eventType: 'Suporte', substitute: 'Lia Horta', active: true}
    ]
  });
  assert.equal(result.sigla, 'CR');
  assert.equal(result.position, 2);
});

test('bloqueia a identificação se o membro de uma substituição não puder ser resolvido', () => {
  const result = resolveChecklistResponsibility({
    day: '2026-09-22', schedule: {assignments: ['AD', 'CR']}, contacts,
    events: [{date: '2026-09-22', memberStatus: 'Nome não cadastrado', eventType: 'Pessoal', substitute: 'Caio Ramos', active: true}]
  });
  assert.equal(result.responsibleUid, null);
  assert.match(result.reason, /membro identificável/);
});

test('não inventa UID quando o perfil V2 da sigla não é único ou não existe', () => {
  const input = {day: '2026-09-22', schedule: {assignments: ['AD']}, contacts};
  assert.equal(resolveChecklistResponsibility(input).responsibleUid, null);
  assert.equal(resolveChecklistResponsibility({...input, profiles: [{uid: 'one', sigla: 'AD'}, {uid: 'two', sigla: 'AD'}]}).responsibleUid, null);
});

test('calcula responsabilidade sem usar acesso ao app como critério de escala', () => {
  const result = resolveChecklistResponsibility({
    day: '2026-09-22', schedule: {assignments: ['AD']}, contacts,
    profiles: [{uid: 'uid-ad', sigla: 'AD', active: false, access: false}]
  });
  assert.equal(result.responsibleUid, 'uid-ad');
});

test('recusa data inexistente', () => {
  assert.equal(resolveChecklistResponsibility({day: '2026-02-30', schedule: {assignments: ['AD']}}).sigla, null);
});

test('aplica férias pelo rótulo quando a lista de siglas da fonte está vazia', () => {
  const result = resolveChecklistResponsibility({
    day: '2026-09-22', schedule: {assignments: ['AD', 'CR']}, contacts,
    vacations: [{start: '2026-09-22', end: '2026-09-22', siglas: [], label: 'AD (período de férias)'}]
  });
  assert.equal(result.sigla, 'CR');
  assert.equal(result.position, 2);
});

test('avança até a terceira ou quarta posição após férias e substituições sucessivas', () => {
  const base = {day: '2026-09-22', schedule: {positions: ['AD', 'CR', 'LH', 'LA']}, contacts,
    vacations: [{active: true, start: '2026-09-22', end: '2026-09-22', siglas: ['AD']}],
    events: [{date: '2026-09-22', active: true, memberStatus: 'CR', eventType: 'Pessoal', substitute: 'Outro membro'}]};
  assert.equal(resolveChecklistResponsibility(base).position, 3);
  assert.equal(resolveChecklistResponsibility(base).sigla, 'LH');
  const next = resolveChecklistResponsibility({...base, vacations: [...base.vacations, {active: true, siglas: ['LH']}]});
  assert.equal(next.position, 4);
  assert.equal(next.sigla, 'LA');
});

test('validador do Apps Script mantém a mesma sequência de responsáveis', async () => {
  const {readFileSync} = await import('node:fs');
  const {runInNewContext} = await import('node:vm');
  const source = readFileSync(new URL('../apps-script-v2/ChecklistValidation.gs', import.meta.url), 'utf8');
  const context = {};
  runInNewContext(source, context);
  const input = {day: '2026-09-22', schedule: {positions: ['AD', 'CR', 'LH', 'LA']}, contacts,
    vacations: [{active: true, siglas: ['AD']}],
    events: [{date: '2026-09-22', active: true, memberStatus: 'CR', eventType: 'Pessoal', substitute: 'Outro membro'}]};
  assert.equal(context.selectChecklistResponsible_(input).position, 3);
  assert.equal(context.selectChecklistResponsible_(input).sigla, 'LH');
  assert.equal(context.selectChecklistResponsible_({...input, vacations: [{siglas: ['AD', 'LH']}]}).position, 4);
});
