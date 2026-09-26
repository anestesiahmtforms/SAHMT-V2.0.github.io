import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, describe, it} from 'node:test';
import {deleteApp, initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-sahmt-v2';
const app = initializeApp({projectId}, 'report-sync-queue-emulator-tests');
const db = getFirestore(app);

after(async () => deleteApp(app));

async function waitForJob(resourceId, operation) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await db.collection('syncQueue')
      .where('resourceId', '==', resourceId)
      .where('operation', '==', operation)
      .get();
    if (!result.empty) return result.docs[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Cloud Function did not enqueue ${operation} for ${resourceId}.`);
}

describe('Firestore report sync queue trigger', () => {
  it('creates metadata-only idempotent jobs for source creation and deletion', async () => {
    const resourceId = `sync-test-${randomUUID()}`;
    const resourceRef = db.collection('events').doc(resourceId);
    await resourceRef.set({id: resourceId, version: 1, amountToPay: 25});

    const createJob = await waitForJob(resourceId, 'upsert');
    assert.equal(createJob.get('resourceType'), 'events');
    assert.equal(createJob.get('version'), 1);
    assert.equal(createJob.get('status'), 'pending');
    assert.equal(createJob.get('attempts'), 0);
    assert.equal(createJob.get('amountToPay'), undefined);
    assert.equal(createJob.get('payload'), undefined);
    assert.equal(createJob.get('uid'), undefined);

    await resourceRef.delete();
    const deleteJob = await waitForJob(resourceId, 'delete');
    assert.equal(deleteJob.get('resourceType'), 'events');
    assert.equal(deleteJob.get('resourceId'), resourceId);
    assert.equal(deleteJob.get('status'), 'pending');

    const jobs = await db.collection('syncQueue').where('resourceId', '==', resourceId).get();
    assert.equal(jobs.size, 2);
    await Promise.all(jobs.docs.map((job) => job.ref.delete()));
  });
});
