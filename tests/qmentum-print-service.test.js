import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyInputs,initialDefinitions} from '../src/qmentum-catalog.js';
import {PRINT_PARSER_VERSION,planPrintScan,preparePrintMutation,validatePrintPeriod} from '../src/qmentum-print-service.js';
const now=new Date('2026-11-01T12:00:00Z'),uid='manager',unitId='synthetic',period='2026-07',root='qmentumUnits/'+unitId;
function fixture(){
 const documents=new Map([['users/'+uid,{uid,active:true,access:true}],['qmentumAccess/'+uid,{uid,active:true,role:'manager',units:[unitId]}],['qmentumConfig/current',{enabled:true,definitionVersion:1}],[root,{unitId,active:true}],['qmentumDefinitions/1',initialDefinitions()]]);
 const preview={id:'a'.repeat(64),createdBy:uid,unitId,period,baseVersion:0,createdAt:now,expiresAt:now.getTime()+1800000,sourceHash:'b'.repeat(64),parserVersion:PRINT_PARSER_VERSION,counts:{anestheticProcedures:40,surgical:20,general:10,sedation:25,regional:12,spinal:5,epidural:0,local:0,support:0,diabetes:3,toxicity:0},sources:[{kind:'TECHNIQUES',id:'tech-file',sha256:'c'.repeat(64),version:'1'},{kind:'INDICATORS',id:'event-file',sha256:'d'.repeat(64),version:'1'}]};
 return{documents,preview,uid,unitId,period,baseVersion:0,corrections:{},resolutions:{},requestHash:'e'.repeat(64),now};
}
test('print scope excludes January through June 2026, and accepts explicit future years',()=>{
 assert.throws(()=>validatePrintPeriod('2026-06'),/SCOPE/);assert.throws(()=>validatePrintPeriod('2027-13'),/PERIOD/);assert.deepEqual(validatePrintPeriod('2027-01'),{year:2027,month:1});
});
test('scan binds legacy filenames to their configured source year and exposes missing/duplicate pairs',()=>{
 const files=[{kind:'TECHNIQUES',id:'t1',name:'07.png',version:'1'},{kind:'INDICATORS',id:'i1',name:'07.png',version:'1'},{kind:'TECHNIQUES',id:'t2',name:'08.png',version:'1'},{kind:'TECHNIQUES',id:'old',name:'01.png'},{kind:'TECHNIQUES',id:'future',name:'2027-01.png'},{kind:'INDICATORS',id:'futuri',name:'2027-01.png'}];
 const scan=planPrintScan({files,baselines:{},year:2026,sourceYear:2026});assert.deepEqual(scan.candidates.map(x=>[x.period,x.status]),[['2026-07','NEW'],['2026-08','MISSING_PAIR']]);
 assert.deepEqual(planPrintScan({files,baselines:{},year:2027,sourceYear:2026}).candidates.map(x=>x.period),['2027-01']);
 assert.equal(planPrintScan({files:[...files,{kind:'TECHNIQUES',id:'duplicate',name:'07.jpg'}],baselines:{},year:2026,sourceYear:2026}).candidates[0].status,'DUPLICATE');
 const pair=scan.candidates[0].sources;assert.equal(planPrintScan({files,baselines:{'2026-07':{sources:pair,parserVersion:PRINT_PARSER_VERSION}},year:2026,sourceYear:2026}).candidates[0].status,'UNCHANGED');
 assert.equal(planPrintScan({files,baselines:{'2026-07':{sources:pair,parserVersion:'retired-parser'}},year:2026,sourceYear:2026}).candidates[0].status,'CHANGED');
});
test('new print import preserves independent source totals and creates atomic month/history/provenance',()=>{
 const f=fixture(),p=preparePrintMutation(f),month=p.writes.find(w=>w.path===root+'/months/'+period).data;
 assert.equal(month.inputs.counts.anestheticProcedures,40);assert.equal(month.inputs.counts.surgical,20);assert.equal(month.inputs.counts.headache,null);assert.equal(month.inputs.counts.effectiveGlucose,null);assert.equal(month.status,'DRAFT');assert.equal(month.version,1);
 assert.ok(p.writes.some(w=>w.path===root+'/months/'+period+'/history/1'));assert.ok(p.writes.some(w=>w.path===root+'/printSources/'+period));assert.ok(p.writes.some(w=>w.path===root+'/printReceipts/'+f.preview.id));assert.ok(p.checks.includes('qmentumAccess/'+uid));
});
test('authorization is checked before an idempotent receipt and wrong actor/scope/expired previews fail',()=>{
 const f=fixture();f.documents.set(root+'/printReceipts/'+f.preview.id,{requestHash:f.requestHash,version:1,status:'CONFIRMED'});assert.equal(preparePrintMutation(f).status,'CONFIRMED');
 f.documents.get('qmentumAccess/'+uid).active=false;assert.throws(()=>preparePrintMutation(f),/PERMISSION/);
 for(const change of [{createdBy:'other'},{period:'2026-08'},{expiresAt:now.getTime()-1}]){const x=fixture();Object.assign(x.preview,change);assert.throws(()=>preparePrintMutation(x),/PREVIEW/);}
});
test('concurrent edits, different duplicate confirmation payloads, and closed months cannot overwrite data',()=>{
 const f=fixture();f.documents.set(root+'/months/'+period,{version:2,status:'DRAFT',inputs:emptyInputs(),definitionVersion:1});assert.throws(()=>preparePrintMutation(f),/VERSION_CONFLICT/);
 f.baseVersion=2;f.preview.baseVersion=2;f.documents.get(root+'/months/'+period).status='CLOSED';assert.throws(()=>preparePrintMutation(f),/MONTH_CLOSED/);
 const g=fixture();g.documents.set(root+'/printReceipts/'+g.preview.id,{requestHash:'f'.repeat(64),version:1});assert.throws(()=>preparePrintMutation(g),/REQUEST_CONFLICT/);
});
test('baseline merge preserves manual edits and missing fields; a source-only no-op adds no month revision',()=>{
 const f=fixture(),inputs=emptyInputs();Object.assign(inputs.counts,f.preview.counts,{sedation:29,headache:2});for(const k of Object.keys(f.preview.counts))inputs.origins[k]='IMPORTED';inputs.origins.headache='MANUAL';inputs.origins.sedation='MANUAL';
 f.documents.set(root+'/months/'+period,{version:3,status:'DRAFT',inputs,definitionVersion:1});f.documents.set(root+'/printSources/'+period,{sourceCounts:{...f.preview.counts},appliedCounts:{...f.preview.counts},sources:f.preview.sources});f.baseVersion=3;f.preview.baseVersion=3;
 const p=preparePrintMutation(f);assert.equal(p.status,'UNCHANGED');assert.equal(p.version,3);assert.ok(!p.writes.some(w=>w.path.includes('/months/')));assert.ok(p.writes.some(w=>w.path===root+'/printSources/'+period));
 f.preview.counts.sedation=30;assert.throws(()=>preparePrintMutation(f),/CONFLICTS/);f.resolutions={sedation:'KEEP_MANUAL'};const q=preparePrintMutation(f);assert.equal(q.status,'UNCHANGED');assert.equal(q.baseline.appliedCounts.sedation,29);assert.equal(q.baseline.sourceCounts.sedation,30);
});
test('manual extraction corrections are marked manual and never manufacture unsupported outcomes',()=>{
 const f=fixture();f.corrections={anestheticProcedures:41};const p=preparePrintMutation(f),m=p.writes.find(w=>w.path===root+'/months/'+period).data;assert.equal(m.inputs.counts.anestheticProcedures,41);assert.equal(m.inputs.origins.anestheticProcedures,'MANUAL');assert.equal(m.inputs.counts.effectiveToxicity,null);
 f.corrections={effectiveGlucose:3};assert.throws(()=>preparePrintMutation(f),/CORRECTION/);
});
