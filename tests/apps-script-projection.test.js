import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script-v2/Config.gs', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../apps-script-v2/SparkReportSync.gs', import.meta.url), 'utf8');
const context = vm.createContext({encodeURIComponent});
vm.runInContext(source, context);
vm.runInContext(syncSource, context);

test('scanner Spark seleciona somente os campos da projeção de relatório', () => {
  const scans = Array.from(vm.runInContext('SAHMT_V2_SPARK_REPORT_SCAN.resources', context));
  const projections = {};
  context.sahmtV2Properties_ = () => ({getProperty: () => null});
  context.firestoreDocumentsUrl_ = (path) => path;
  context.firestoreFieldsToJs_ = (fields) => fields;
  context.firestoreRequest_ = (_url, options) => {
    const request = JSON.parse(options.payload);
    const query = request.structuredQuery;
    projections[query.from[0].collectionId] = query.select.fields.map(({fieldPath}) => fieldPath).sort();
    return [];
  };

  for (const scan of scans) {
    context.listSparkReportChanges_(scan, 1);
    const tab = vm.runInContext(`SAHMT_V2_RESOURCE_TABS[${JSON.stringify(scan.type)}]`, context);
    const reportFields = Array.from(vm.runInContext(`SAHMT_V2_REPORT_TABS[${JSON.stringify(tab)}].fields`, context));
    const synthetic = new Set(['syncKey', 'resourceType', 'idRegistro']);
    const expected = Array.from(new Set(['id', 'version', scan.changedAt, ...reportFields.filter((field) => !synthetic.has(field))])).sort();
    assert.deepEqual(projections[scan.type], expected, scan.type);
  }

  assert.equal(Object.hasOwn(projections, 'users'), false);
  assert.equal(Object.hasOwn(projections, 'labels'), false);
});
