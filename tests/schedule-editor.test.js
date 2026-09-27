import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSchedulePositions} from '../src/schedule-editor.js';

test('normaliza as siglas na ordem das posições da escala', () => {
  assert.deepEqual(normalizeSchedulePositions(['ab', 'DC', 'ab/cd', 'L2']), [
    {position: 1, sigla: 'AB'}, {position: 2, sigla: 'DC'},
    {position: 3, sigla: 'AB/CD'}, {position: 4, sigla: 'L2'}
  ]);
  assert.throws(() => normalizeSchedulePositions(['AB', 'ERRADO']), /posição 2/);
  assert.throws(() => normalizeSchedulePositions([]), /1 a 30/);
});
