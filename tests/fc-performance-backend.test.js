import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {adaptFcPerformanceDeclaration} from '../scripts/lib/fc-performance-source.js';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../apps-script-fc/Performance.gs',import.meta.url),'utf8');
const project='indicadores---sahmt',start=new Date('2026-11-01T20:00:00Z');
function setup({enabled=true,executor='anestesiahmtforms3@gmail.com',runtime={}}={}){
 const properties=new Map([['FC_PERFORMANCE_ENABLED',String(enabled)],['SAHMT_V2_OCCURRENCE_SCORING_ENABLED','true'],['SAHMT_V2_EVALUATION_ALLOWED_EMAILS','anestesiahmtforms3@gmail.com'],['SAHMT_V2_MANAGEMENT_FB_RELEASE','fb-independent-20261022-v1']]);
 const state={schemaVersion:1,release:'fc-performance-exclusive-v1',mode:'FC_ONLY',projectId:project,enabled:true,
  effectiveFrom:start,automaticFbSync:false,legacyCentralStopped:true,occurrenceScoringApproved:true,performanceRevision:0,...runtime};
 const reads=[];const context={Date,Map,Set,SAHMT_FC_EXECUTOR_EMAIL:'anestesiahmtforms3@gmail.com',
  sahmtV2Properties_:()=>({getProperty:k=>properties.get(k)||null}),Session:{getEffectiveUser:()=>({getEmail:()=>executor})},
  evaluationGet_:(collection,id,transaction)=>{reads.push({collection,id,transaction});return state;},SAHMT_EVALUATION_TRANSACTIONS:new Map()};
 vm.createContext(context);vm.runInContext(source,context);return{context,properties,state,reads};
}
test('FC performance fixes every logical ledger collection and every project route to FC',()=>{
 const f=setup();assert.equal(f.context.evaluationProject_(),project);
 for(const [logical,physical]of Object.entries({evaluationAwards:'fcPerformanceAwards',evaluationLedger:'fcPerformanceLedger',evaluationSummaries:'fcPerformanceSummaries',
  evaluationReference:'fcPerformanceReference',evaluationRuntime:'fcPerformanceRuntime',evaluationSourceReceipts:'fcPerformanceSourceReceipts'})){
  assert.equal(f.context.fcPerformanceCollection_(logical),physical);assert.equal(f.context.fcPerformanceCollection_(physical),physical);
  assert.equal(f.context.evaluationDocumentName_(logical,'same-uid'),`projects/${project}/databases/(default)/documents/${physical}/same-uid`);
 }
 for(const name of ['users','occurrenceReports','occurrenceAudit','occurrenceScoreClaims','occurrenceRuntime','qmentumParticipations','qmentumParticipationReviews'])assert.equal(f.context.evaluationCollectionProject_(name),project);
 assert.throws(()=>f.context.fcPerformanceCollection_('activities'),/FC_PERFORMANCE_COLLECTION_DENIED/);
 assert.throws(()=>f.context.fcPerformanceCollection_('qmentumScoreOutbox'),/FC_PERFORMANCE_FB_DELIVERY_DISABLED/);
});
test('FC performance refuses all Firestore HTTP targets outside its fixed project and database',()=>{
 const f=setup();const base=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
 assert.equal(f.context.fcAssertFirestoreDestination_(base+':commit'),true);
 assert.equal(f.context.fcAssertFirestoreDestination_(base+'/users/same-uid'),true);
 for(const bad of [base.replace(project,'sahmt-gestao-5ae66'),base.replace(project,'sahmt-17a16'),base.replace('(default)','other'),base.replace('https:','http:'),base+'/../users/x'])assert.throws(()=>f.context.fcAssertFirestoreDestination_(bad),/FC_PERFORMANCE_PROJECT_DENIED/);
 assert.throws(()=>f.context.evaluationDocumentsUrl_(':commit','sahmt-gestao-5ae66'),/FC_PERFORMANCE_PROJECT_DENIED/);
 for(const outside of ['sahmt-17a16','sahmt-gestao-5ae66'])assert.throws(()=>f.context.fcAssertFirestoreDestination_(base+':commit',{method:'post',payload:JSON.stringify({writes:[{update:{name:`projects/${outside}/databases/(default)/documents/evaluationAwards/id`}}]})}),/FC_PERFORMANCE_PROJECT_DENIED/);
});
test('FC performance refuses other-station award modalities even in trusted shared kernel',()=>{
 const f=setup();for(const input of [{category:'GOVERNANCE'},{category:'PERFORMANCE',sourceType:'CHECKLIST',modality:'CHECKLIST'},{category:'PERFORMANCE',sourceType:'FA_OCCURRENCE_VERIFIED',modality:'OCCURRENCE'}])assert.throws(()=>f.context.fcPerformanceAssertAward_(input),/SOURCE_DENIED/);
 assert.equal(f.context.fcPerformanceAssertAward_({category:'PERFORMANCE',sourceType:'FC_OCCURRENCE_VERIFIED',modality:'OCCURRENCE',evidence:{sourceProjectId:project}}),undefined);
});
test('FC performance cannot enable FB delivery even with a legacy release property',()=>{
 const f=setup();assert.equal(f.context.managementIndependentFbEnabled_(),false);assert.equal(f.context.qmParticipationUsesIndependentFb_(),false);
 assert.throws(()=>f.context.managementIndependentFbAssert_(),/FC_PERFORMANCE_FB_DELIVERY_DISABLED/);
});
test('FC performance requires an enabled FC-only runtime and the correct owner',()=>{
 const active=setup();assert.equal(active.context.evaluationAssertOperator_(true),'anestesiahmtforms3@gmail.com');
 for(const options of [{enabled:false},{executor:'anestesiahmtforms@gmail.com'},{runtime:{automaticFbSync:true}},{runtime:{legacyCentralStopped:false}},{runtime:{mode:'FB'}},{runtime:{projectId:'sahmt-gestao-5ae66'}},{runtime:{effectiveFrom:null}}]){
  const f=setup(options);assert.throws(()=>f.context.evaluationAssertOperator_(true),/FC_PERFORMANCE_/);
 }
});
test('FC performance accepts only sources created at or after the activation boundary',()=>{
 const f=setup();assert.equal(f.context.fcPerformanceAssertNewSource_({createdAt:start}),true);
 assert.equal(f.context.fcPerformanceAssertNewSource_({createdAt:new Date(start.getTime()+1)}),true);
 for(const createdAt of [new Date(start.getTime()-1),null,'2026-11-01'])assert.throws(()=>f.context.fcPerformanceAssertNewSource_({createdAt}),/FC_PERFORMANCE_SOURCE_BEFORE_ACTIVATION/);
});
test('FC performance validates its runtime within the same FC transaction and rejects cross-project transactions',()=>{
 const f=setup();f.context.SAHMT_EVALUATION_TRANSACTIONS.set('fc-transaction',{projectId:project});
 assert.equal(f.context.evaluationReadTransaction_('fc-transaction',project),'fc-transaction');
 f.context.fcPerformanceAssertRuntimeTransaction_('fc-transaction');assert.equal(f.reads.at(-1).transaction,'fc-transaction');
 assert.throws(()=>f.context.evaluationReadTransaction_('fc-transaction','sahmt-gestao-5ae66'),/FC_PERFORMANCE_CROSS_PROJECT_TRANSACTION/);
});

test('FC Apps Script pauses performance queries before content and preserves the missing policy bootstrap',()=>{
 const reads=[],ctx=vm.createContext({firestoreFieldsToJs_:fields=>fields,firestoreRequest_:url=>{reads.push(url);return {fields:{schemaVersion:1,revision:2,disabled:['desempenho']}};}});
 vm.runInContext(source,ctx);
 const root='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents';
 assert.throws(()=>ctx.fcAssertPerformanceFolder_(root+':runQuery',{payload:JSON.stringify({structuredQuery:{from:[{collectionId:'fcPerformanceAwards'}]}})}),/FC_PERFORMANCE_FOLDER_DISABLED/);
 assert.deepEqual(reads,[root+'/runtimePolicy/folders']);
 ctx.firestoreRequest_=()=>{throw Object.assign(Error('missing'),{status:404});};
 assert.doesNotThrow(()=>ctx.fcAssertPerformanceFolder_(root+'/fcPerformanceRuntime/state'));
});

test('FC transport adapter inserts the folder check before fetching performance content',()=>{
 const calls=[];
 const ctx=vm.createContext({
  fcAssertFirestoreDestination_:()=>calls.push('destination'),
  fcAssertPerformanceFolder_:()=>{calls.push('policy');throw Error('FC_PERFORMANCE_FOLDER_DISABLED');},
  contentRead:()=>calls.push('content')
 });
 const declaration='function firestoreRequest_(url, options) { return contentRead(url, options); }';
 vm.runInContext(adaptFcPerformanceDeclaration('firestoreRequest_',declaration),ctx);
 assert.throws(()=>ctx.firestoreRequest_('synthetic'),/FC_PERFORMANCE_FOLDER_DISABLED/);
 assert.deepEqual(calls,['destination','policy']);
});
