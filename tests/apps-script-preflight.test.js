import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../apps-script-v2/Config.gs', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../apps-script-v2/SparkReportSync.gs', import.meta.url), 'utf8');
const preflightSource = readFileSync(new URL('../apps-script-v2/Preflight.gs', import.meta.url), 'utf8');

test('preflight consulta apenas um documento projetando id e retorna status sem dados', () => {
  const context = vm.createContext({encodeURIComponent});
  vm.runInContext(configSource, context);
  vm.runInContext(syncSource, context);
  vm.runInContext(preflightSource, context);

  const calls = {folder: 0, spreadsheet: 0, validatedSpreadsheet: '', request: null};
  context.sahmtV2RequirePrivateFolder_ = () => { calls.folder++; return {}; };
  context.sahmtV2Properties_ = () => ({getProperty: () => 'spreadsheet-id-for-test'});
  context.sahmtV2RequirePrivateSpreadsheet_ = (id) => { calls.validatedSpreadsheet = id; };
  context.SpreadsheetApp = {openById(id) { calls.spreadsheet++; assert.equal(id, 'spreadsheet-id-for-test'); return {}; }};
  context.requireSparkReportTabs_ = () => {};
  context.firestoreDocumentsUrl_ = (path) => path;
  context.firestoreRequest_ = (_url, options) => {
    calls.request = JSON.parse(options.payload);
    return [{document: {name: 'private-document-id', fields: {id: {stringValue: 'private-id'}}}}];
  };

  const result = context.verifySahmtV2ExecutorReadOnly();
  const query = calls.request.structuredQuery;
  assert.equal(calls.folder, 1);
  assert.equal(calls.validatedSpreadsheet, 'spreadsheet-id-for-test');
  assert.equal(calls.spreadsheet, 1);
  assert.deepEqual(Array.from(query.from, ({collectionId}) => collectionId), ['stations']);
  assert.deepEqual(Array.from(query.select.fields, ({fieldPath}) => fieldPath), ['id']);
  assert.equal(query.limit, 1);
  assert.equal(result.readOnly, true);
  assert.equal(result.firestoreQuery, 'ok');
  assert.equal(result.stationCatalogHasDocument, true);
  assert.deepEqual(Object.keys(result).sort(), ['firestoreQuery', 'privateReportsFolder', 'privateSpreadsheet', 'readOnly', 'reportTabs', 'stationCatalogHasDocument'].sort());
});

test('preflight não contém operações de escrita nem instala gatilhos', () => {
  assert.doesNotMatch(preflightSource, /\.set(?:Property|Values|Value)\s*\(|\.deleteProperty\s*\(|\.create\s*\(|newTrigger\s*\(/);
});
