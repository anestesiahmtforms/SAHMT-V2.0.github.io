import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPendingSchedule} from '../src/offline-schedule-overlay.js';
import {resolveChecklistRotation} from '../src/checklist-rotation.js';
const day = '2026-10-19';
const schedule = {id: day, date: day, positions: [{position: 1, sigla: 'AA'}, {position: 2, sigla: 'BB'}], highlights: {events: []}};
const pending = {uid: 'actor', requestId: 'pending-event', type: 'events', status: 'awaiting-confirmation', payload: {collectionName: 'events', data: {date: day, scheduleSigla: 'AA', memberSigla: 'AA'}}};
test('evento local afeta a visão da escala e o escalado do Checklist sem alterar a base confirmada', () => {
  const projected = projectPendingSchedule(schedule, [pending], {uid: 'actor', day});
  const rotation = resolveChecklistRotation({day, schedule: projected, directory: [{id: 'BB', sigla: 'BB', name: 'Pessoa substituta', active: true}]});
  assert.equal(rotation.sigla, 'BB'); assert.equal(projected.localPendingSchedule, true); assert.deepEqual(schedule.highlights.events, []);
  assert.equal(projectPendingSchedule(projected, [pending], {uid: 'actor', day}).highlights.events.length, 1);
});
test('pendência de outra identidade, data, falha e conflito não alteram a escala', () => {
  for (const change of [{uid: 'other'}, {status: 'failed'}, {status: 'conflict'}, {payload: {...pending.payload, data: {...pending.payload.data, date: '2026-10-18'}}}]) {
    assert.equal(projectPendingSchedule(schedule, [{...pending, ...change}], {uid: 'actor', day}), schedule);
  }
});
