import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChecklistMaintenance, checklistMaintenanceOverdue, checklistMaintenanceForWrite} from '../src/checklist-maintenance.js';
const empty = {preventiveAnnual: '', electricalAnnual: '', calibrationSemiannual: ''};

test('calendários vazios e registros de texto legados não inventam datas de manutenção', () => {
  assert.deepEqual(normalizeChecklistMaintenance(undefined), empty);
  assert.deepEqual(normalizeChecklistMaintenance('Revisão legada'), empty);
  assert.deepEqual(checklistMaintenanceOverdue(empty, '2026-10-01'), {preventiveAnnual: false, electricalAnnual: false, calibrationSemiannual: false});
});

test('cada manutenção vence somente depois da data marcada e usa hoje como referência', () => {
  const dates = {preventiveAnnual: '2026-09-30', electricalAnnual: '2026-10-01', calibrationSemiannual: '2027-04-01'};
  assert.deepEqual(checklistMaintenanceOverdue(dates, '2026-10-01'), {preventiveAnnual: true, electricalAnnual: false, calibrationSemiannual: false});
  assert.deepEqual(checklistMaintenanceOverdue(dates, '2027-04-02'), {preventiveAnnual: true, electricalAnnual: true, calibrationSemiannual: true});
});

test('gravação aceita três datas ou campos vazios e conserva compatibilidade com texto legado', () => {
  assert.deepEqual(checklistMaintenanceForWrite(empty), empty);
  assert.deepEqual(checklistMaintenanceForWrite({...empty, preventiveAnnual: '2028-02-29'}), {...empty, preventiveAnnual: '2028-02-29'});
  assert.equal(checklistMaintenanceForWrite(' texto legado '), 'texto legado');
});

test('datas inexistentes, estrutura incompleta e campos desconhecidos são rejeitados', () => {
  for (const day of ['0000-01-01', '0000-02-29', '2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', 'amanhã']) {
    assert.throws(() => checklistMaintenanceForWrite({...empty, preventiveAnnual: day}), /datas válidas/);
  }
  for (const value of [null, [], {preventiveAnnual: ''}, {...empty, unknown: ''}, {...empty, electricalAnnual: 42}]) {
    assert.throws(() => checklistMaintenanceForWrite(value), /três campos/);
  }
});
test('calendários aceitam os anos positivos de quatro dígitos suportados pelo input date', () => {
  for (const day of ['0001-01-01', '0099-12-31', '9999-12-31']) {
    assert.equal(checklistMaintenanceForWrite({...empty, preventiveAnnual: day}).preventiveAnnual, day);
  }
});