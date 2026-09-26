import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script-v2/Config.gs', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../apps-script-v2/FirestoreSync.gs', import.meta.url), 'utf8');
const context = vm.createContext({encodeURIComponent});
vm.runInContext(source, context);

const readUrl = (resourceType, resourceId) => vm.runInContext(
  `firestoreDocumentReadUrl_(${JSON.stringify(resourceType)}, ${JSON.stringify(resourceId)})`,
  context
);

test('Apps Script REST get masks reads to report headers plus id and version', () => {
  const resourceTypes = ['checklists', 'events', 'trainings', 'trainingReceipts', 'trainingCompletions', 'activities', 'activityInteractions', 'indicators', 'indicatorMeasurements', 'actionPlans', 'actionPlanItems', 'scores', 'auditLogs'];
  for (const resourceType of resourceTypes) {
    const tabName = vm.runInContext(`SAHMT_V2_RESOURCE_TABS[${JSON.stringify(resourceType)}]`, context);
    const reportFields = Array.from(vm.runInContext(`SAHMT_V2_REPORT_TABS[${JSON.stringify(tabName)}].fields`, context));
    const synthetic = new Set(['syncKey', 'resourceType', 'idRegistro']);
    const expected = Array.from(new Set(['id', 'version', ...reportFields.filter((field) => !synthetic.has(field))])).sort();
    const url = new URL(readUrl(resourceType, 'resource-id'));
    assert.deepEqual(url.searchParams.getAll('mask.fieldPaths').sort(), expected, resourceType);
  }
});

test('Apps Script REST get keeps resource IDs in the path and rejects unmapped collections', () => {
  const url = new URL(readUrl('events', 'event id'));
  assert.ok(url.pathname.endsWith('/events/event%20id'));
  assert.ok(url.searchParams.getAll('mask.fieldPaths').includes('id'));
  assert.ok(url.searchParams.getAll('mask.fieldPaths').includes('version'));
  assert.throws(() => readUrl('users', 'some-uid'), /não habilitado/);
});

test('o consumidor usa a URL mascarada ao reler o documento Firestore', () => {
  assert.match(syncSource, /firestoreRequest_\(firestoreDocumentReadUrl_\(job\.resourceType, job\.resourceId\)/);
  assert.doesNotMatch(syncSource, /firestoreDocumentsUrl_\(resourcePath\)/);
});
