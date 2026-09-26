import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {buildReportSyncJob} from '../report-sync-queue.js';

const common = {
  collectionName: 'events',
  resourceId: 'event-123',
  eventId: 'cloud-event-1',
  beforeExists: false,
  afterExists: true,
  version: 1,
  now: new Date('2026-09-25T12:00:00.000Z')
};

describe('report sync queue job builder', () => {
  it('builds a deterministic metadata-only upsert job', () => {
    const first = buildReportSyncJob(common);
    const retried = buildReportSyncJob({...common, now: new Date('2026-09-25T12:05:00.000Z')});

    assert.equal(first.id, retried.id);
    assert.match(first.id, /^[a-f0-9]{64}$/);
    assert.equal(first.resourceType, 'events');
    assert.equal(first.resourceId, 'event-123');
    assert.equal(first.operation, 'upsert');
    assert.equal(first.version, 1);
    assert.equal(first.status, 'pending');
    assert.equal(first.attempts, 0);
    assert.equal('payload' in first, false);
    assert.equal('uid' in first, false);
  });

  it('gives distinct jobs to distinct source events and records deletions', () => {
    const nextVersion = buildReportSyncJob({...common, eventId: 'cloud-event-2', version: 2});
    const deletion = buildReportSyncJob({...common, beforeExists: true, afterExists: false, eventId: 'cloud-event-3'});

    assert.notEqual(nextVersion.id, buildReportSyncJob(common).id);
    assert.equal(deletion.operation, 'delete');
  });

  it('rejects non-report collections and invalid event metadata', () => {
    assert.throws(() => buildReportSyncJob({...common, collectionName: 'users'}), /fora da integração/);
    assert.throws(() => buildReportSyncJob({...common, resourceId: ''}), /inválidos/);
    assert.throws(() => buildReportSyncJob({...common, version: 0}), /inválidos/);
    assert.throws(() => buildReportSyncJob({...common, beforeExists: false, afterExists: false}), /não contém registro/);
  });
});
