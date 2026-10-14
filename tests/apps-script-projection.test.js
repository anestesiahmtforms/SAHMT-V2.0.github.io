import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script-v2/Config.gs', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../apps-script-v2/SparkReportSync.gs', import.meta.url), 'utf8');
const context = vm.createContext({encodeURIComponent});
vm.runInContext(source, context);
vm.runInContext(readFileSync(new URL('../apps-script-v2/EvaluationLedger.gs',import.meta.url),'utf8'),context);
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

test('manual recovery routes domain to FB while retaining operational FA and isolated cursors',()=>{
 const props=new Map([['SAHMT_V2_EVALUATION_PROJECT_ID','sahmt-gestao-5ae66']]);
 const c=vm.createContext({encodeURIComponent});
 for(const f of ['Config.gs','EvaluationLedger.gs','SparkReportSync.gs'])vm.runInContext(readFileSync(new URL('../apps-script-v2/'+f,import.meta.url),'utf8'),c);
 c.sahmtV2Properties_=()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)});
 c.firestoreFieldsToJs_=f=>f;const urls=[];c.firestoreRequest_=(url)=>{urls.push(url);return [];};
 for(const type of ['events','trainings'])c.listSparkReportChanges_({type,changedAt:'updatedAt'},1);
 assert.ok(urls[0].includes("/projects/sahmt-17a16/"));assert.ok(urls[1].includes("/projects/sahmt-gestao-5ae66/"));
 c.saveSparkReportCursor_({type:'trainings'},{_cursorTimestamp:'2026-01-01T00:00:00Z',_cursorName:'projects/sahmt-gestao-5ae66\/databases/(default)/documents/trainings/synthetic'});
 assert.ok(props.has('SAHMT_V2_SPARK_REPORT_CURSOR_FB_trainings'));assert.ok(!props.has('SAHMT_V2_SPARK_REPORT_CURSOR_trainings'));
});
