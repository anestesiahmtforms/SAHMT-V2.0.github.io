import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {participationId,validateParticipation} from '../src/qmentum-participation.js';
import {initialDefinitions,emptyInputs} from '../src/qmentum-catalog.js';
import {calculateMonth} from '../src/qmentum-engine.js';
import {quarterFacts,analysisInputSignature} from '../src/qmentum-quarterly.js';
const hash=x=>createHash('sha256').update(x).digest('hex'),analysisId=hash('synthetic-analysis');
const source=readFileSync(new URL('../apps-script-v2/QmentumParticipation.gs',import.meta.url),'utf8');
const ledger=readFileSync(new URL('../apps-script-v2/EvaluationLedger.gs',import.meta.url),'utf8');
test('1 + 2 accumulate to 3; missing approval and rejection give zero suggestion credit',()=>{
 const c=vm.createContext({});vm.runInContext(source,c);
 assert.equal(c.qmParticipationPlan_({modality:'ACKNOWLEDGEMENT'}).points,1);
 const p={actorUid:'person-a',modality:'SUGGESTION'};
 assert.equal(c.qmParticipationPlan_(p,null).points,0);assert.equal(c.qmParticipationPlan_(p,{actorUid:'manager',decision:'REJECT'}).points,0);
 assert.equal(c.qmParticipationPlan_(p,{actorUid:'manager',decision:'APPROVE'}).points+1,3);
 assert.throws(()=>c.qmParticipationPlan_(p,{actorUid:'person-a',decision:'APPROVE'}),/REVIEW_DENIED/);
});
test('participation keys are stable, separated by modality, identity and analysis',()=>{
 const key=participationId(analysisId,'person-a','ACKNOWLEDGEMENT');assert.equal(key,participationId(analysisId,'person-a','ACKNOWLEDGEMENT'));
 assert.notEqual(key,participationId(analysisId,'person-a','SUGGESTION'));assert.notEqual(key,participationId(analysisId,'person-b','ACKNOWLEDGEMENT'));
 assert.throws(()=>participationId('invalid','person-a','ACKNOWLEDGEMENT'));assert.throws(()=>participationId(analysisId,'person/a','ACKNOWLEDGEMENT'));
 assert.throws(()=>validateParticipation({analysisId,uid:'person-a',modality:'SUGGESTION',suggestion:'short'}));
});
test('existing trusted performance ledger produces separate credits and repeated confirmation is duplicate',()=>{
 const c=vm.createContext({sha256Hex_:hash});vm.runInContext(ledger,c);
 const base={category:'PERFORMANCE',uid:'person-a',creditScopeId:'qmentum-'+analysisId,version:1,sourceFingerprint:analysisId};
 const ack=c.evaluationPlanAward_(null,{...base,modality:'ACKNOWLEDGEMENT',points:1}),suggestion=c.evaluationPlanAward_(null,{...base,modality:'SUGGESTION',points:2});
 assert.notEqual(ack.awardId,suggestion.awardId);assert.equal(ack.ledger.points+suggestion.ledger.points,3);
 assert.equal(c.evaluationPlanAward_(ack.award,ack.award).changed,false);assert.equal(c.evaluationPlanAward_(suggestion.award,suggestion.award).changed,false);
 assert.throws(()=>c.evaluationPlanAward_(null,{...base,modality:'ACKNOWLEDGEMENT',points:2}));
});
test('backend has no trigger or external call at loading and rejects wrong project',()=>{
 const c=vm.createContext({SAHMT_V2_CONFIG:{projectId:'other',databaseId:'(default)'}});vm.runInContext(source,c);assert.throws(()=>c.processarParticipacoesQmentumV1(),/FA_REQUIRED/);
 assert.doesNotMatch(source,/Logger\.|console\.|UrlFetchApp|ScriptApp|newTrigger/);
});
function harness(){
 const store=new Map(),writes=[];let abort=false;
 const c=vm.createContext({sha256Hex_:hash,SAHMT_V2_CONFIG:{projectId:'sahmt-17a16',databaseId:'(default)'},QmentumCore:{calculateMonth,quarterFacts,analysisInputSignature}});vm.runInContext(ledger+'\n'+source,c);
 c.evaluationAssertOperator_=()=>{};c.evaluationGet_=(collection,id)=>structuredClone(store.get(collection+'/'+id)||null);
 c.evaluationWrite_=(collection,id,data)=>({key:collection+'/'+id,data:structuredClone(data)});
 c.evaluationApplyAwards_=(changes)=>{const result=changes.map(a=>{const id=c.evaluationAwardId_(a),plan=c.evaluationPlanAward_(store.get('evaluationAwards/'+id),a);return plan.changed?[{key:'evaluationAwards/'+id,data:plan.award},{key:'evaluationLedger/'+plan.ledger.id,data:plan.ledger}]:[];}).flat();return {status:'APPLIED',writes:result};};
 c.evaluationRunTransaction_=callback=>{const p=callback('synthetic-transaction');if(abort){abort=false;throw Error('COMMIT_ABORTED');}for(const w of p.writes){store.set(w.key,{...store.get(w.key),...structuredClone(w.data)});writes.push(w);}return p.result;};
 const seed=(path,data)=>store.set(path,structuredClone(data));
 const defs=initialDefinitions(),inputs=emptyInputs();inputs.counts.surgical=100;inputs.counts.techniqueChanges=2;
 const rows=[1,2,3].map(month=>({year:2026,month,version:1,definitionVersion:1,inputs,results:calculateMonth(inputs,defs,{inputVersion:1,calculatedAt:null})}));
 const facts=quarterFacts({rows,indicatorId:'QM01',year:2026,quarter:1}),signature=analysisInputSignature(facts,hash);
 seed('qmentumConfig/current',{enabled:true});seed('qmentumUnits/unit-a',{active:true});seed('qmentumDefinitions/1',defs);
 for(const row of rows)seed('qmentumUnits/unit-a/months/2026-0'+row.month,row);
 seed('qmentumUnits/unit-a/quarterlyAnalyses/'+analysisId,{id:analysisId,unitId:'unit-a',indicatorId:'QM01',year:2026,quarter:1,status:'REVIEWED',reviewed:true,signature});
 for(const uid of ['person-a','manager']){seed('users/'+uid,{uid,active:true,access:true});seed('qmentumAccess/'+uid,{uid,active:true,role:uid==='manager'?'manager':'collector',units:['unit-a']});}
 const add=(modality)=>{const id=participationId(analysisId,'person-a',modality);seed('qmentumParticipations/'+id,{unitId:'unit-a',analysisId,signature,actorUid:'person-a',modality,suggestion:modality==='SUGGESTION'?'Sugestão sintética de melhoria':'',status:'PENDING'});return id;};
 return {c,store,seed,add,writes,abort:()=>{abort=true;}};
}
test('complete trusted path: acknowledgement, approval, total 3, replay and interrupted commit',()=>{
 const h=harness(),ack=h.add('ACKNOWLEDGEMENT'),suggestion=h.add('SUGGESTION');h.abort();assert.throws(()=>h.c.qmProcessParticipation_(ack,false),/COMMIT_ABORTED/);assert.equal(h.writes.length,0);
 assert.equal(h.c.qmProcessParticipation_(ack,false).points,1);assert.equal(h.c.qmProcessParticipation_(ack,false).code,'QMENTUM_PARTICIPATION_DUPLICATE');
 assert.equal(h.c.qmProcessParticipation_(suggestion,false).points,0);h.seed('qmentumParticipationReviews/'+suggestion,{participationId:suggestion,unitId:'unit-a',actorUid:'manager',decision:'APPROVE',reason:'Sugestão pertinente aprovada',status:'PENDING'});
 assert.equal(h.c.qmProcessParticipation_(suggestion,true).points,2);assert.equal(h.c.qmProcessParticipation_(suggestion,true).code,'QMENTUM_PARTICIPATION_DUPLICATE');
 assert.equal([...h.store.entries()].filter(([k])=>k.startsWith('evaluationAwards/')).reduce((n,[,a])=>n+a.points,0),3);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('evaluationLedger/')).length,2);
});
test('revoked account, obsolete analysis, disabled module and self-approval produce no credit',()=>{
 for(const change of [h=>h.seed('users/person-a',{uid:'person-a',active:false,access:true}),h=>h.seed('qmentumConfig/current',{enabled:false}),h=>{const a=h.store.get('qmentumUnits/unit-a/quarterlyAnalyses/'+analysisId);h.seed('qmentumUnits/unit-a/quarterlyAnalyses/'+analysisId,{...a,signature:'c'.repeat(64)});},h=>{const r=h.store.get('qmentumUnits/unit-a/months/2026-01');r.inputs.counts.techniqueChanges=7;h.seed('qmentumUnits/unit-a/months/2026-01',r);}]){
  const h=harness(),id=h.add('ACKNOWLEDGEMENT');change(h);assert.throws(()=>h.c.qmProcessParticipation_(id,false));assert.equal(h.writes.length,0);
 }
 const h=harness(),id=h.add('SUGGESTION');h.c.qmProcessParticipation_(id,false);h.seed('qmentumParticipationReviews/'+id,{participationId:id,unitId:'unit-a',actorUid:'person-a',decision:'APPROVE',reason:'Tentativa de aprovação própria',status:'PENDING'});assert.throws(()=>h.c.qmProcessParticipation_(id,true));assert.equal([...h.store.keys()].filter(k=>k.startsWith('evaluationAwards/')).length,0);
});
test('regenerating the analysis in the same indicator and quarter does not add points',()=>{
 const h=harness(),id=h.add('ACKNOWLEDGEMENT');h.c.qmProcessParticipation_(id,false);
 const next='c'.repeat(64),analysis=h.store.get('qmentumUnits/unit-a/quarterlyAnalyses/'+analysisId),p=h.store.get('qmentumParticipations/'+id);
 h.seed('qmentumUnits/unit-a/quarterlyAnalyses/'+next,{...analysis,id:next});const requestId=participationId(next,'person-a','ACKNOWLEDGEMENT');h.seed('qmentumParticipations/'+requestId,{...p,analysisId:next,status:'PENDING'});h.c.qmProcessParticipation_(requestId,false);
 assert.equal([...h.store.entries()].filter(([k])=>k.startsWith('evaluationAwards/')).reduce((n,[,a])=>n+a.points,0),1);
 assert.equal([...h.store.keys()].filter(k=>k.startsWith('evaluationLedger/')).length,1);
});
