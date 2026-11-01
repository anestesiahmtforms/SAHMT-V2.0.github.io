import test from 'node:test';
import assert from 'node:assert/strict';
import {COUNT_KEYS,emptyInputs,initialDefinitions} from '../src/qmentum-catalog.js';
import {calculateMonth,productionTotals,validateInputs} from '../src/qmentum-engine.js';
import {hasMonthlyInformation,monthlyOverviewRows,renderMonthlyOverview} from '../src/qmentum-overview.js';
import {prepareQmentumWrite} from '../src/qmentum-write.js';

const techniques={general:1,sedation:2,regional:3,spinal:4,epidural:5,local:6,support:7};
const legacyInputs=()=>{const input=emptyInputs();delete input.counts.anestheticProcedures;delete input.origins.anestheticProcedures;return input;};
const save=input=>prepareQmentumWrite({uid:'synthetic-user',operation:'SAVE_MONTH',profile:{uid:'synthetic-user',active:true,access:true},grant:{uid:'synthetic-user',active:true,role:'manager',units:['unit-a']},config:{enabled:true,definitionVersion:1},unit:{unitId:'unit-a',active:true},definitions:initialDefinitions(),now:new Date('2026-11-01T12:00:00Z'),payload:{unitId:'unit-a',year:2026,month:7,inputs:input,baseVersion:0,definitionVersion:1,referenceDate:'2026-07-15',action:'SAVE',reason:'',importHash:null}});

test('new inputs can save an explicit anesthetic total and its origin',()=>{
 const input=emptyInputs();
 assert.ok(COUNT_KEYS.includes('anestheticProcedures'));
 assert.equal(input.counts.anestheticProcedures,null);
 assert.equal(input.origins.anestheticProcedures,'UNINFORMED');
 Object.assign(input.counts,{...techniques,anestheticProcedures:9,surgical:40});
 input.origins.anestheticProcedures='IMPORTED';
 const saved=save(input).data;
 assert.equal(saved.inputs.counts.anestheticProcedures,9);
 assert.equal(saved.inputs.origins.anestheticProcedures,'IMPORTED');
 assert.equal(saved.inputs.counts.surgical,40);
});

test('legacy input shapes remain valid and save without gaining optional fields',()=>{
 const input=legacyInputs();Object.assign(input.counts,{...techniques,surgical:40});
 const before=structuredClone(input);
 assert.equal(validateInputs(input),input);
 const saved=save(input).data;
 assert.deepEqual(input,before);
 assert.deepEqual(saved.inputs,before);
 assert.equal(Object.hasOwn(saved.inputs.counts,'anestheticProcedures'),false);
 assert.equal(Object.hasOwn(saved.inputs.origins,'anestheticProcedures'),false);
 assert.deepEqual(productionTotals(saved.inputs.counts),{anestheticTotal:28,legacyBlocks:14});
});

test('the independent total overrides technique multiplicity without adding surgical procedures',()=>{
 assert.deepEqual(productionTotals({...techniques,anestheticProcedures:9,surgical:40}),{anestheticTotal:9,legacyBlocks:14});
 assert.deepEqual(productionTotals({...techniques,anestheticProcedures:0,surgical:40}),{anestheticTotal:0,legacyBlocks:14});
 const input=emptyInputs();input.counts.anestheticProcedures=9;input.counts.surgical=40;
 assert.deepEqual(productionTotals(input.counts),{anestheticTotal:9,legacyBlocks:null});
});

test('missing explicit totals retain the exact complete seven-technique fallback',()=>{
 assert.deepEqual(productionTotals({...techniques,surgical:40}),{anestheticTotal:28,legacyBlocks:14});
 assert.deepEqual(productionTotals({...techniques,anestheticProcedures:null,surgical:40}),{anestheticTotal:28,legacyBlocks:14});
 assert.deepEqual(productionTotals({...techniques,general:null,surgical:40}),{anestheticTotal:null,legacyBlocks:14});
 assert.deepEqual(productionTotals({...techniques,regional:null,surgical:40}),{anestheticTotal:null,legacyBlocks:null});
});

test('the optional count uses the same integer bounds and origin validation as existing counts',()=>{
 for(const value of [0,10000000]){
  const input=emptyInputs();input.counts.anestheticProcedures=value;input.origins.anestheticProcedures='MANUAL';
  assert.equal(validateInputs(input),input);
 }
 for(const value of [-1,.5,NaN,10000001,undefined,'9']){
  const input=emptyInputs();input.counts.anestheticProcedures=value;
  assert.throws(()=>validateInputs(input),/QMENTUM_COUNT_INVALID/);
 }
 const input=emptyInputs();input.origins.anestheticProcedures='DERIVED';
 assert.throws(()=>validateInputs(input),/QMENTUM_ORIGIN_INVALID/);
});

test('only matched legacy or new field shapes are accepted',()=>{
 for(const map of ['counts','origins']){
  const input=legacyInputs();input[map].anestheticProcedures=map==='counts'?9:'IMPORTED';
  assert.throws(()=>validateInputs(input),/QMENTUM_FIELDS_INVALID/);
 }
 for(const make of [legacyInputs,emptyInputs])for(const map of ['counts','origins']){
  const missing=make();delete missing[map].general;
  assert.throws(()=>validateInputs(missing),/QMENTUM_FIELDS_INVALID/);
  const extra=make();extra[map].unexpected=map==='counts'?1:'MANUAL';
  assert.throws(()=>validateInputs(extra),/QMENTUM_FIELDS_INVALID/);
 }
});

test('the explicit total preserves null, zero, and declared nonapplicability states',()=>{
 const input=emptyInputs();input.notApplicable=['anestheticProcedures'];
 assert.equal(validateInputs(input),input);
 input.counts.anestheticProcedures=0;
 assert.throws(()=>validateInputs(input),/QMENTUM_STATE_INVALID/);
 const legacy=legacyInputs();legacy.notApplicable=['anestheticProcedures'];
 assert.throws(()=>validateInputs(legacy),/QMENTUM_STATE_INVALID/);
});

test('the explicit total leaves all eighteen indicator calculations unchanged',()=>{
 const input=legacyInputs();Object.assign(input.counts,{general:10,surgical:40,spinal:4,techniqueChanges:2,difficultAirway:1,headache:1,eventProcedures:3});input.uniqueEventProceduresConfirmed=true;
 const defs=initialDefinitions(),previous=calculateMonth(input,defs);
 assert.equal(Object.keys(previous).length,18);
 assert.equal(previous.QM01.ratio,.05);
 assert.equal(previous.QM02.ratio,.1);
 assert.equal(previous.QM11.ratio,.75);
 const explicit=structuredClone(input);explicit.counts.anestheticProcedures=0;explicit.origins.anestheticProcedures='IMPORTED';
 assert.deepEqual(calculateMonth(explicit,defs),previous);
});

test('the existing anesthetic overview card reports the explicit origin and retains thirteen cards',()=>{
 for(const origin of ['MANUAL','IMPORTED','UNINFORMED']){
  const input=emptyInputs();Object.assign(input.counts,{...techniques,anestheticProcedures:9,surgical:40});input.origins.anestheticProcedures=origin;
  const rows=monthlyOverviewRows(input);
  assert.equal(rows.length,13);
  assert.deepEqual(rows.find(row=>row.key==='anestheticTotal'),{key:'anestheticTotal',label:'Procedimentos anestésicos',value:9,state:'value',origin});
  assert.equal(rows.find(row=>row.key==='surgical').value,40);
  assert.equal(rows.find(row=>row.key==='legacyBlocks').origin,'DERIVED');
 }
 const input=legacyInputs();Object.assign(input.counts,techniques);
 assert.deepEqual(monthlyOverviewRows(input).find(row=>row.key==='anestheticTotal'),{key:'anestheticTotal',label:'Procedimentos anestésicos',value:28,state:'value',origin:'DERIVED'});
});

test('an explicit zero records a month and renders the source origin even with missing technique counts',()=>{
 const input=emptyInputs();input.counts.anestheticProcedures=0;input.origins.anestheticProcedures='IMPORTED';
 assert.equal(hasMonthlyInformation({inputs:input}),true);
 const html=renderMonthlyOverview({inputs:input},{year:2026,month:7});
 const card=html.match(/<div data-qm-overview-field="anestheticTotal"[\s\S]*?<\/div>/)?.[0];
 assert.ok(card);
 assert.match(card,/data-overview-value="anestheticTotal">0<\/dd>/);
 assert.match(card,/Importado da referência/);
 assert.doesNotMatch(card,/Total conforme a planilha/);
 assert.equal((html.match(/data-qm-overview-field=/g)||[]).length,13);
});
