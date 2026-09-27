import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScheduleView, extractScheduleSiglas, resolveScheduleSiglas, weekdayForDate} from '../src/schedule-view.js';

test('calcula dia da semana e normaliza rótulos com ou sem acento', () => {
  assert.equal(weekdayForDate('2026-09-22'), 'terca');
  assert.equal(weekdayForDate('2026-09-24', 'Quinta-feira'), 'quinta');
  assert.deepEqual(extractScheduleSiglas('CR/AD (férias)'), ['CR/AD']);
});

test('expande DC conforme o mapeamento por dia observado na V1', () => {
  assert.deepEqual(resolveScheduleSiglas('DC', 'segunda'), ['CR', 'LH']);
  assert.deepEqual(resolveScheduleSiglas('DC', 'terca'), ['CR', 'LH', 'AD']);
  assert.deepEqual(resolveScheduleSiglas('DC', 'quarta'), ['CR', 'LH', 'AD']);
  assert.deepEqual(resolveScheduleSiglas('DC', 'sexta'), ['CR', 'LA']);
  assert.deepEqual(resolveScheduleSiglas('DC', 'domingo'), ['AD', 'CR', 'LA', 'LH']);
  assert.deepEqual(resolveScheduleSiglas('AD/DC', 'terca'), ['AD', 'CR', 'LH']);
});

test('mantém posições, associa contatos por sigla e destaca férias em ordem', () => {
  const view = buildScheduleView({
    siglas: ['AD/CR', 'DC', 'LH'],
    vacationLabel: 'CR, AD (período de férias)'
  }, '2026-09-22', [
    {siglas: ['LH'], label: 'LH'}
  ], [
    {sigla: 'AD', name: 'Ana'}, {sigla: 'CR', name: 'Carlos'}, {sigla: 'LH', name: 'Lia'}
  ]);
  assert.equal(view.positions.length, 3);
  assert.deepEqual(view.positions[0].contacts.map((item) => item.sigla), ['AD', 'CR']);
  assert.deepEqual(view.positions[1].siglas, ['CR', 'LH', 'AD']);
  assert.equal(view.positions[0].onVacation, true);
  assert.equal(view.positions[2].vacationPosition, 1);
  assert.equal(view.vacationLabel, 'CR, AD (período de férias)');
});

test('aceita os formatos de atribuição e posições sem achatar metadados', () => {
  const view = buildScheduleView({positions: [{sigla: 'AB', role: 'Anestesista'}]}, '2026-09-24');
  assert.equal(view.positions[0].sigla, 'AB');
  assert.equal(view.positions[0].role, 'Anestesista');
});

test('usa o rótulo da férias quando a lista explícita de siglas está vazia', () => {
  const view = buildScheduleView({siglas: ['AD', 'CR']}, '2026-09-22', [
    {siglas: [], label: 'AD (período de férias)'}
  ]);
  assert.equal(view.positions[0].onVacation, true);
  assert.equal(view.positions[1].onVacation, false);
});
