import test from 'node:test';
import assert from 'node:assert/strict';
import {localChecklistConferenceReady} from '../src/offline-checklist-conference.js';
const fixture = () => ({day: '2026-10-19', today: '2026-10-19', profile: {active: true, access: true, permissions: {checklistSign: true}},
  rotation: {name: 'Pessoa sintética', sigla: 'AA', position: 1, complete: true},
  stations: [{id: 'a', active: true}, {id: 'b', active: false}], records: [{id: 'pending', stationId: 'a', date: '2026-10-19', condition: 'NAO', occurrence: 'Exemplo sintético', pendingSync: true}]});
test('conferência local pode preservar a intenção após checagens locais, sem confirmar pontuação', () => {
  assert.equal(localChecklistConferenceReady(fixture()), true);
});
test('faltas, conflito, escala incompleta ou ausência da permissão bloqueiam a intenção local', () => {
  for (const mutate of [x => x.records = [], x => x.records[0].syncConflict = true, x => x.rotation.complete = false, x => x.profile.permissions.checklistSign = false, x => x.incomplete = true, x => x.today = '2026-10-20']) {
    const input = fixture(); mutate(input); assert.equal(localChecklistConferenceReady(input), false);
  }
});
