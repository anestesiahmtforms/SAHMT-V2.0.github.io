import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateScheduleReleaseState} from '../src/schedule-release.js';

test('posição agregada só fica liberada quando todos os membros do grupo foram liberados', () => {
  const first = updateScheduleReleaseState([], {sigla: 'CR', marked: true, groupSiglas: ['CR', 'LH'], tokenSigla: 'DC'});
  assert.deepEqual(first, {siglas: ['CR'], changed: true});
  const second = updateScheduleReleaseState(first.siglas, {sigla: 'LH', marked: true, groupSiglas: ['CR', 'LH'], tokenSigla: 'DC'});
  assert.deepEqual(second, {siglas: ['CR', 'LH', 'DC'], changed: true});
});

test('retirar um membro limpa o agregado e preserva outras liberações da data', () => {
  const result = updateScheduleReleaseState(['CR', 'LH', 'DC', 'AB', 'XY'], {
    sigla: 'CR', marked: false, groupSiglas: ['CR', 'LH'], tokenSigla: 'DC'
  });
  assert.deepEqual(result, {siglas: ['LH', 'AB', 'XY'], changed: true});
});

test('sigla simples não duplica o próprio marcador ao alternar liberação', () => {
  const result = updateScheduleReleaseState(['AB'], {sigla: 'AB', marked: false, groupSiglas: ['AB'], tokenSigla: 'AB'});
  assert.deepEqual(result, {siglas: [], changed: true});
  assert.throws(() => updateScheduleReleaseState([], {sigla: 'A1', marked: true}), /inválida/);
});
