import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCatalogValues, validateEventCatalog} from '../src/event-catalog.js';

test('normaliza linhas e remove opções duplicadas sem diferenciar caixa ou acentos', () => {
  assert.deepEqual(parseCatalogValues('CAIXA\n caixa \nPlantão\nPLANTAO\n', 'Pagadores'), ['CAIXA', 'Plantão']);
});

test('valida campos, limites e quantidade dos catálogos operacionais', () => {
  assert.deepEqual(validateEventCatalog({payers: ['Equipe'], creditors: ['Caixa']}), {payers: ['Equipe'], creditors: ['Caixa']});
  assert.throws(() => parseCatalogValues(['x'.repeat(121)], 'Pagadores'), /120 caracteres/);
  assert.throws(() => parseCatalogValues(Array.from({length: 101}, (_, index) => `P${index}`), 'Pagadores'), /100 opções/);
  assert.throws(() => validateEventCatalog({payers: 'Equipe', creditors: []}), /Pagadores/);
});
