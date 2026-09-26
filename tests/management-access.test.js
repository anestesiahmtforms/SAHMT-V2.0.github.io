import test from 'node:test';
import assert from 'node:assert/strict';
import {hasFinanceOnlyManagementAccess, parseManagementUids} from '../src/management-access.js';

test('normaliza UIDs por linha, remove duplicados e preserva a ordem', () => {
  assert.deepEqual(parseManagementUids('uid-a\n uid-b,uid-a;uid-c'), ['uid-a', 'uid-b', 'uid-c']);
  assert.deepEqual(parseManagementUids(''), []);
});

test('recusa UID com espaço interno, tamanho excessivo ou lista acima do limite', () => {
  assert.throws(() => parseManagementUids('uid com espaço'), /não pode conter espaços/);
  assert.throws(() => parseManagementUids('x'.repeat(129)), /até 128 caracteres/);
  assert.throws(() => parseManagementUids('a\nb\nc', {maxItems: 2}), /no máximo 2 UIDs/);
});

test('Financeiro isolado abre somente o estado restrito da área de Gestão', () => {
  assert.equal(hasFinanceOnlyManagementAccess({permissions: {financeRead: true}}), true);
  assert.equal(hasFinanceOnlyManagementAccess({permissions: {financeWrite: true}}), true);
  assert.equal(hasFinanceOnlyManagementAccess({permissions: {financeManage: true}}), true);
  assert.equal(hasFinanceOnlyManagementAccess({permissions: {financeRead: true, managementRead: true}}), false);
  assert.equal(hasFinanceOnlyManagementAccess({role: 'administrador_app', permissions: {financeRead: true}}), false);
  assert.equal(hasFinanceOnlyManagementAccess({permissions: {}}), false);
});
