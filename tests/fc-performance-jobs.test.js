import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../apps-script-fc/PerformanceJobs.gs',import.meta.url),'utf8');
function fixture(rows){const queries=[],writes=[],state={effectiveFrom:new Date('2026-11-01T21:00:00Z')},project='indicadores---sahmt';
 const c=vm.createContext({Date,FC_PERFORMANCE_PROJECT_:project,fcPerformanceRuntime_:()=>state,evaluationGet_:()=>({enabled:true}),evaluationAssertOperator_:()=>{},
  firestoreFilter_:(field,op,value)=>({field,op,value}),evaluationDocumentName_:(col,id)=>`projects/${project}/databases/(default)/documents/${col}/${id}`,
  evaluationQuery_:(...args)=>{queries.push(args);return rows;},evaluationRunTransaction_:fn=>{const p=fn('transaction');writes.push(...p.writes);Object.assign(state,p.writes[0].changes);},evaluationWrite_:(collection,id,changes)=>({collection,id,changes})});
 vm.runInContext(source,c);return{c,state,queries,writes};}
test('FC recovery queries only pending sources after cutoff and rotates a bounded page after failures',()=>{
 const rows=Array.from({length:5},(_,i)=>({id:'row-'+i,createdAt:new Date('2026-11-02T00:00:00Z')})),f=fixture(rows);
 const result=f.c.fcPerformancePendingPage_('occurrenceScoreClaims','PENDING_VALIDATION','occurrenceScanCursor',()=>{throw Error('TEMPORARY');});
 assert.equal(result.pending,5);const q=f.queries[0];assert.equal(q[3],5);assert.equal(q[1][0].value.stringValue,'PENDING_VALIDATION');assert.equal(q[1][1].op,'GREATER_THAN_OR_EQUAL');assert.equal(q[1][1].value.timestampValue,f.state.effectiveFrom.toISOString());
 assert.equal(f.state.occurrenceScanCursor.values[1].referenceValue.endsWith('/row-4'),true);assert.equal(f.state.occurrenceScanCursor.before,false);
 const next=f.state.occurrenceScanCursor;f.c.fcPerformancePendingPage_('occurrenceScoreClaims','PENDING_VALIDATION','occurrenceScanCursor',()=>{});assert.equal(f.queries[1][6],next);
});
test('FC scan resets an exhausted page and does not rewrite an excluded historical source',()=>{
 const f=fixture([{id:'review',createdAt:new Date()}]);f.state.reviewScanCursor={values:[{timestampValue:new Date().toISOString()},{referenceValue:'projects/indicadores---sahmt/databases/(default)/documents/qmentumParticipationReviews/prior'}],before:false};
 const result=f.c.fcPerformancePendingPage_('qmentumParticipationReviews','PENDING','reviewScanCursor',()=>{throw Error('FC_PERFORMANCE_SOURCE_BEFORE_ACTIVATION');});
 assert.equal(result.excluded,1);assert.equal(f.state.reviewScanCursor,null);assert.equal(f.writes.length,1);assert.equal(f.writes[0].collection,'evaluationRuntime');
});
