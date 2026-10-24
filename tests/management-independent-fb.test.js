import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {prepareIndependentFbRules} from '../scripts/lib/management-independent-rules.js';
import {prepareIndependentFbMigration} from '../scripts/lib/management-independent-fb-plan.js';
const source=readFileSync(new URL('../apps-script-v2/EvaluationLedger.gs',import.meta.url),'utf8');
const release=readFileSync(new URL('../apps-script-v2/ManagementIndependentFb.gs',import.meta.url),'utf8');
function harness(active){const properties=new Map(active?[['SAHMT_V2_MANAGEMENT_FB_RELEASE','fb-independent-20261022-v1']]:[]);
 const requests=[];const c=vm.createContext({SAHMT_V2_CONFIG:{projectId:'sahmt-17a16'},sahmtV2Properties_:()=>({getProperty:k=>properties.get(k)}),firestoreFieldsToJs_:x=>x,
  firestoreRequest_:(url,opts)=>{requests.push({url,opts});if(url.endsWith(':beginTransaction'))return {transaction:'read-only-source'};if(url.endsWith(':batchGet'))return [];return {};}});
 vm.runInContext(source+'\n'+release,c);return {c,requests};}
test('FB routing requires the explicit release property; old project properties do not activate it',()=>{
 const a=harness(false),b=harness(true);assert.equal(a.c.evaluationProject_(),'sahmt-17a16');assert.equal(b.c.evaluationProject_(),'sahmt-gestao-5ae66');
 for(const root of ['qmentumAccess','qmentumConfig','qmentumDefinitions','qmentumUnits','qmentumUnits/unit/months','qmentumParticipations','qmentumParticipationReviews','qmentumScoreOutbox','qmentumAnalysisJobs','qmentumAnalysisReviewRequests','qmentumQuarterlyJobs','qmentumQuarterlyQuota','qmentumEvidence','qmentumImprovementActions','qmentumWriteRequests'])assert.equal(b.c.evaluationCollectionProject_(root),'indicadores---sahmt');
 assert.equal(b.c.evaluationCollectionProject_('checklists'),'sahmt-17a16');assert.equal(b.c.evaluationCollectionProject_('scopedDocuments'),'sahmt-gestao-5ae66');
 assert.match(b.c.evaluationCursorProperty_('CURSOR'),/_FB_INDEPENDENT_V1$/);
 assert.equal(b.c.evaluationCollectionProject_('documentAccessEmails'),'sahmt-gestao-5ae66');
 assert.equal(b.c.evaluationCollectionProject_('documentReadingReceipts'),'sahmt-gestao-5ae66');
 assert.equal(b.c.evaluationCollectionProject_('documentReadingGrants'),'sahmt-gestao-5ae66');
  assert.equal(b.c.evaluationCollectionProject_('trainingTemplateMigrations'),'sahmt-gestao-5ae66');
  assert.equal(a.c.evaluationCollectionProject_('trainingTemplateMigrations'),'sahmt-17a16');
});

test('live training template receipts migrate to FB while old integration provenance remains excluded',()=>{
 const result=prepareIndependentFbMigration({projectId:'sahmt-17a16',documents:[
  {path:'trainingTemplateMigrations/form-fixture',updateTime:'2026-10-22T00:00:00Z',fields:{status:{stringValue:'CONFIRMED'}}},
  {path:'migrationOrigins/old-fixture',updateTime:'2026-10-22T00:00:00Z',fields:{}}
 ]},{projectId:'sahmt-gestao-5ae66',documents:[]});
 assert.equal(result.ready,true);assert.deepEqual(result.operations.map(x=>x.path),['trainingTemplateMigrations/form-fixture']);
 assert.deepEqual(result.excluded,['migrationOrigins/old-fixture']);
});

test('active FB authorization never reads the removed FA consolidation marker',()=>{
 const {c,requests}=harness(true);let assertions=0;c.managementIndependentFbAssert_=()=>{assertions++;return {status:'ACTIVE'};};
 c.evaluationAssertConsolidationActive_();assert.equal(assertions,1);assert.equal(requests.length,0);
});
test('source Checklist uses FA users and FB evaluation uses FB users with matching batchGet names',()=>{
 const {c,requests}=harness(true);vm.runInContext("SAHMT_EVALUATION_TRANSACTIONS.set('fa-tx',{projectId:'sahmt-17a16',sourceTransactions:{}});SAHMT_EVALUATION_TRANSACTIONS.set('fb-tx',{projectId:'sahmt-gestao-5ae66',sourceTransactions:{}});",c);
 for(const tx of ['fa-tx','fb-tx'])c.evaluationGet_('users','synthetic',tx);
 assert.match(requests[0].url,/projects\/sahmt-17a16\//);assert.match(JSON.parse(requests[0].opts.payload).documents[0],/projects\/sahmt-17a16\//);
 assert.match(requests[1].url,/projects\/sahmt-gestao-5ae66\//);assert.match(JSON.parse(requests[1].opts.payload).documents[0],/projects\/sahmt-gestao-5ae66\//);
});
test('FB reads FA evidence through a separate transaction, never sending a foreign transaction id',()=>{
 const {c,requests}=harness(true);vm.runInContext("SAHMT_EVALUATION_TRANSACTIONS.set('fb-tx',{projectId:'sahmt-gestao-5ae66',sourceTransactions:{}});",c);
 assert.equal(c.evaluationReadTransaction_('fb-tx','sahmt-17a16'),'read-only-source');assert.equal(requests.length,1);
 assert.throws(()=>c.evaluationReadTransaction_('fb-tx','unapproved-project'),/CROSS_PROJECT/);
});
test('FB rules preserve profile policy and omit operational/QMENTUM collections',()=>{
 const rules=readFileSync(new URL('../firestore.independent-fb.rules',import.meta.url),'utf8');
 assert.match(rules,/function activeUser\(\)/);assert.match(rules,/match \/users\/\{uid\}/);assert.match(rules,/match \/scopedDocuments\/\{documentId\}/);assert.match(rules,/independentFbCutover/);
 assert.doesNotMatch(rules,/managementAuthorizationLeases|sign_in_provider == 'custom'|match \/qmentum|match \/checklists\//);
 assert.throws(()=>prepareIndependentFbRules('unrelated'),/SOURCE_INVALID/);
});
test('independent FB logout covers five sessions and new Google entry returns to FA',()=>{
 const auth=readFileSync(new URL('../src/auth.js',import.meta.url),'utf8');assert.match(auth,/googleProjectAuthEnabled \|\| deployment.target === 'FB'/);assert.match(auth,/location.assign\(deployment.faBase \+ '#\/offline'\)/);
});
test('QMENTUM stays in FC and retries a lost acknowledgement without awarding twice in FB',()=>{
 const {c}=harness(true),stores={FC:new Map(),FB:new Map()},commits=[];let project='FB',awards=0,loseAck=true;
 const rootProject=root=>root.startsWith('qmentum')?'FC':'FB';
 c.sha256Hex_=s=>createHash('sha256').update(s).digest('hex');c.evaluationDeliveryCanonical_=v=>JSON.stringify(v);
 vm.runInContext(readFileSync(new URL('../apps-script-v2/QmentumParticipation.gs',import.meta.url),'utf8'),c);
 c.managementIndependentFbAssert_=()=>true;c.evaluationAssertOperator_=()=>true;
 c.qmParticipationIdentity_=()=>true;c.qmParticipationAnalysis_=()=>({year:2026,quarter:1,indicatorId:'QM14'});
 c.evaluationGet_=(root,id)=>{const row=stores[rootProject(root)].get(root+'/'+id);return row?{...structuredClone(row),id}:null;};
 c.evaluationWrite_=(root,id,data)=>({project:rootProject(root),key:root+'/'+id,data:structuredClone(data)});
 c.evaluationRunTransaction_=(callback,options)=>{const prior=project;assert.notEqual(options?.projectId,'sahmt-17a16');project=options?.projectId==='indicadores---sahmt'?'FC':'FB';try{
   const result=callback('synthetic');for(const write of result.writes)assert.equal(write.project,project,'no mixed-project writes');
   if(project==='FC'&&result.writes.some(w=>w.data.status==='DELIVERED')&&loseAck){loseAck=false;throw Error('LOST_ACK');}
   for(const write of result.writes)stores[project].set(write.key,{...stores[project].get(write.key),...write.data});commits.push(project);return result.result;
 }finally{project=prior;}};
 c.checklistSourceTransaction_=callback=>c.evaluationRunTransaction_(callback,{projectId:'sahmt-17a16'});
 c.evaluationApplyAwards_=items=>{awards++;return {status:'APPLIED',writes:items.map((data,i)=>({project:'FB',key:'evaluationAwards/synthetic-'+i,data:structuredClone(data)}))};};
 c.evaluationPublishCategorySummary_=()=>({status:'CONFIRMED'});
 const analysis='a'.repeat(64),id=analysis+'_person_ACKNOWLEDGEMENT';
 stores.FC.set('qmentumParticipations/'+id,{analysisId:analysis,actorUid:'person',modality:'ACKNOWLEDGEMENT',unitId:'SAHMT',signature:'b'.repeat(64),suggestion:'',status:'PENDING'});
 c.qmProcessParticipation_(id,false);assert.equal(awards,0);assert.equal(stores.FC.get('qmentumParticipations/'+id).confirmedPoints,0);
 assert.throws(()=>c.qmDeliverFbParticipation_(id),/LOST_ACK/);assert.equal(awards,1);
 c.qmDeliverFbParticipation_(id);assert.equal(awards,1);assert.equal(stores.FC.get('qmentumParticipations/'+id).confirmedPoints,1);
 assert.equal(stores.FC.get('qmentumScoreOutbox/'+id).status,'DELIVERED');assert.ok(commits.includes('FC')&&commits.includes('FB'));
 const receiptKey='evaluationSourceReceipts/fa-qmentum-'+c.sha256Hex_(id);
 assert.equal(stores.FB.get(receiptKey).sourceProjectId,'indicadores---sahmt');
 stores.FB.set(receiptKey,{...stores.FB.get(receiptKey),sourceProjectId:'sahmt-17a16'});
 c.qmDeliverFbParticipation_(id);assert.equal(awards,1,'historical FA receipt is reused after migration');
});
