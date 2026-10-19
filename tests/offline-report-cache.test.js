import test from 'node:test';
import assert from 'node:assert/strict';
import {checklistCacheId, checklistCachedCatalogMatches, operationalReportCacheId} from '../src/offline-report-cache.js';

test('report snapshots are keyed by scope and visibility, with matching reader limits', () => {
  const base = {uid: 'u1', from: '2026-10-01', to: '2026-10-19', sigla: 'AB', pageSize: 50};
  assert.equal(operationalReportCacheId('events', base), 'report:2026-10-01:2026-10-19:AB:50');
  assert.equal(operationalReportCacheId('events', {...base, isAdmin: true}), 'report:2026-10-01:2026-10-19:admin:50');
  assert.equal(operationalReportCacheId('labels', base), 'report:2026-10-01:2026-10-19:AB:50');
  assert.equal(operationalReportCacheId('labels', {...base, canManage: true}), 'report:2026-10-01:2026-10-19:admin:50');
  assert.equal(operationalReportCacheId('labels', {...base, sigla: '', pageSize: 200}), 'report:2026-10-01:2026-10-19:uid:u1:100');
  assert.equal(operationalReportCacheId('training', base), '');
});

test('checklist snapshot keys are valid only for the requested daily or monthly period', () => {
  assert.equal(checklistCacheId({mode: 'daily', day: '2026-10-19'}), '2026-10-19');
  assert.equal(checklistCacheId({mode: 'monthly', month: '2026-10'}), 'month:2026-10');
  assert.equal(checklistCacheId({mode: 'daily', day: '2026-13-40'}), '');
});

test('offline checklist history requires an identical authorized station catalog', () => {
  assert.equal(checklistCachedCatalogMatches(['b', 'a'], ['a', 'b']), true);
  assert.equal(checklistCachedCatalogMatches(['a'], ['a', 'b']), false);
  assert.equal(checklistCachedCatalogMatches(null, ['a']), false);
});
