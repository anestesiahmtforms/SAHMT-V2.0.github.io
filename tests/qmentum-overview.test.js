import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyInputs} from '../src/qmentum-catalog.js';
import {hasMonthlyInformation,latestRecordedMonth,monthlyOverviewRows,renderMonthlyOverview} from '../src/qmentum-overview.js';
const record=(period,counts={})=>{const [year,month]=period.split('-').map(Number);return {year,month,period,status:'DRAFT',inputs:{...emptyInputs(),counts:{...emptyInputs().counts,...counts}}};};

test('the last month with actual input wins across years; empty drafts do not replace it',()=>{
 const june=record('2026-06',{surgical:2}),rows=[record('2027-01'),record('2026-07'),june,record('2026-01',{surgical:1})],copy=[...rows];
 assert.equal(latestRecordedMonth(rows),june);assert.deepEqual(rows,copy);assert.equal(latestRecordedMonth([]),null);
 assert.equal(hasMonthlyInformation(record('2026-08',{surgical:0})),true);
 const explicitNa=record('2026-08');explicitNa.inputs.notApplicable=['surgical'];assert.equal(hasMonthlyInformation(explicitNa),true);
 const informed=record('2026-09');informed.inputs.informedRates.QM01=0;assert.equal(hasMonthlyInformation(informed),true);
 assert.equal(hasMonthlyInformation(record('2026-10')),false);assert.equal(hasMonthlyInformation({inputs:{counts:{madeUp:1}}}),false);
 assert.equal(latestRecordedMonth([record('2026-06',{surgical:1}),{...record('2026-07',{surgical:1}),period:'2025-07'}]).period,'2026-06');
});

test('the information block follows the thirteen source fields and derives only the source totals',()=>{
 const input=emptyInputs();Object.assign(input.counts,{general:1,sedation:2,regional:3,spinal:4,epidural:5,local:6,support:7,surgical:20,diabetes:0,toxicity:0,headache:1});input.origins.headache='IMPORTED';
 const rows=monthlyOverviewRows(input);assert.equal(rows.length,13);
 assert.equal(rows.find(row=>row.key==='anestheticTotal').value,28);assert.equal(rows.find(row=>row.key==='legacyBlocks').value,14);
 assert.equal(rows.find(row=>row.key==='surgical').value,20);assert.equal(rows.find(row=>row.key==='diabetes').value,0);
 assert.equal(rows.find(row=>row.key==='headache').origin,'IMPORTED');assert.equal(rows.find(row=>row.key==='anestheticTotal').origin,'DERIVED');
 assert.deepEqual(rows.map(row=>row.key),['general','sedation','regional','spinal','epidural','local','support','anestheticTotal','surgical','legacyBlocks','diabetes','toxicity','headache']);
});

test('missing information and declared nonapplicability never turn into a zero or a partial total',()=>{
 const input=emptyInputs();input.counts.general=0;input.notApplicable=['toxicity'];const rows=monthlyOverviewRows(input);
 assert.equal(rows.find(row=>row.key==='general').state,'value');assert.equal(rows.find(row=>row.key==='sedation').state,'missing');
 assert.equal(rows.find(row=>row.key==='toxicity').state,'not-applicable');assert.equal(rows.find(row=>row.key==='anestheticTotal').value,null);
 const empty=renderMonthlyOverview(null,{year:2026,month:7});assert.match(empty,/Julho de 2026/);assert.match(empty,/Sem informações registradas/);assert.doesNotMatch(empty,/>0</);
 const filled=renderMonthlyOverview(record('2026-06',{headache:0}),{year:2026,month:6});assert.match(filled,/Junho de 2026/);assert.match(filled,/data-overview-value="headache"[^>]*>0</);assert.match(filled,/Cefaleia pós-punção dural/);
});
