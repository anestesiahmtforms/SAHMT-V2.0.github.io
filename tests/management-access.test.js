import test from 'node:test';
import assert from 'node:assert/strict';
import {parseManagementUids} from '../src/management-access.js';

test('normaliza UIDs por linha, remove duplicados e preserva a ordem', () => {
  assert.deepEqual(parseManagementUids('uid-a\n uid-b,uid-a;uid-c'), ['uid-a', 'uid-b', 'uid-c']);
  assert.deepEqual(parseManagementUids(''), []);
});

test('recusa UID com espaço interno, tamanho excessivo ou lista acima do limite', () => {
  assert.throws(() => parseManagementUids('uid com espaço'), /não pode conter espaços/);
  assert.throws(() => parseManagementUids('x'.repeat(129)), /até 128 caracteres/);
  assert.throws(() => parseManagementUids('a\nb\nc', {maxItems: 2}), /no máximo 2 UIDs/);
});
