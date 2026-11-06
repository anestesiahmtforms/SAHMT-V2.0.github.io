import test from 'node:test';
import assert from 'node:assert/strict';
import {planEventProjection} from '../worker-operational-domain/projection-plan.js';

const event = {eventId: 'event', version: 2, date: '2026-11-06', active: true, scheduleSigla: 'AA/BB', memberSigla: 'CC', actorUid: 'member'};
const schedule = (date, events = []) => ({id: date, date, positions: [{position: 1, sigla: 'AA/BB'}], version: 4,
  highlights: {siglas: ['AA'], releaseTimes: {AA: 1800000000000}, events}});

test('projection preserves release marks, times and positions while adding exactly one event marker', () => {
  const original = schedule(event.date), plan = planEventProjection({event, previous: null, schedules: {[event.date]: original}});
  assert.equal(plan.status, 'APPLIED'); assert.equal(plan.receipt.version, 2);
  assert.equal(plan.scheduleUpdates.length, 1);
  assert.deepEqual(plan.scheduleUpdates[0], {date: event.date, events: ['EVENTO:AA/BB:CC:event'], version: 5, actorUid: 'member'});
  assert.deepEqual(original.highlights.siglas, ['AA']); assert.deepEqual(original.highlights.releaseTimes, {AA: 1800000000000});
  assert.equal(original.positions[0].sigla, 'AA/BB');
});

test('moving an event removes its old marker and preserves unrelated events on both days', () => {
  const previous = {...event, version: 1, date: '2026-11-05', status: 'APPLIED'};
  const plan = planEventProjection({event, previous, schedules: {
    [previous.date]: schedule(previous.date, ['EVENTO:AA:CC:event', 'EVENTO:DD:EE:other']),
    [event.date]: schedule(event.date, ['EVENTO:FF:GG:another'])
  }});
  assert.deepEqual(plan.scheduleUpdates.map(update => update.events), [['EVENTO:DD:EE:other'], ['EVENTO:FF:GG:another', 'EVENTO:AA/BB:CC:event']]);
});

test('duplicates and out-of-order deliveries cannot overwrite a newer projection', () => {
  for (const version of [2, 3]) {
    const plan = planEventProjection({event, previous: {...event, version, status: 'APPLIED'}, schedules: {}});
    assert.equal(plan.status, 'ALREADY_APPLIED'); assert.equal(plan.scheduleUpdates.length, 0);
  }
  assert.throws(() => planEventProjection({event, previous: {...event, memberSigla: 'ZZ', status: 'APPLIED'}, schedules: {}}), /DOMAIN_PROJECTION_CONFLICT/);
});

test('an unpublished schedule stays absent and its pending marker is applied after publication', () => {
  const waiting = planEventProjection({event, previous: null, schedules: {}});
  assert.equal(waiting.status, 'WAITING_SCHEDULE'); assert.equal(waiting.scheduleUpdates.length, 0);
  const ready = planEventProjection({event, previous: waiting.receipt, schedules: {[event.date]: schedule(event.date)}});
  assert.equal(ready.status, 'APPLIED'); assert.equal(ready.scheduleUpdates.length, 1);
});

test('archiving removes only the event marker and refuses invalid identifiers or dates', () => {
  const plan = planEventProjection({event: {...event, active: false}, previous: {...event, version: 1, status: 'APPLIED'},
    schedules: {[event.date]: schedule(event.date, ['EVENTO:AA:CC:event', 'EVENTO:DD:EE:other'])}});
  assert.deepEqual(plan.scheduleUpdates[0].events, ['EVENTO:DD:EE:other']);
  for (const override of [{eventId: '../other'}, {date: '2026-02-30'}, {version: 1.5}, {scheduleSigla: 'AA:forged'}])
    assert.throws(() => planEventProjection({event: {...event, ...override}, previous: null, schedules: {}}), /DOMAIN_PROJECTION_INVALID/);
});
