import test from 'node:test';
import assert from 'node:assert/strict';
import {localDateKey, shiftDateKey} from '../src/schedule-date.js';

test('usa a data local de São Paulo mesmo quando o navegador está em UTC', () => {
  assert.equal(localDateKey(new Date('2026-09-24T02:30:00.000Z')), '2026-09-23');
});

test('navega dias incluindo virada de mês e ano sem erro de horário de verão', () => {
  assert.equal(shiftDateKey('2026-09-30', 1), '2026-10-01');
  assert.equal(shiftDateKey('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDateKey('2024-02-28', 1), '2024-02-29');
});

test('recusa datas impossíveis e deslocamentos fracionários', () => {
  assert.throws(() => shiftDateKey('2026-02-30', 1), TypeError);
  assert.throws(() => shiftDateKey('2026-09-24', 0.5), TypeError);
});
