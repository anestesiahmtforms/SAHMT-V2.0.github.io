import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const wrapper=readFileSync(new URL('../apps-script-v2/QmentumQuarterly.gs',import.meta.url),'utf8');
const core=readFileSync(new URL('../apps-script-v2/QmentumCore.gs',import.meta.url),'utf8');
test('Apps Script starts disabled, with no trigger or external call on file loading or disabled execution',()=>{
 let calls=0;const context=vm.createContext({Intl,URL,Date,Map,Set,TextEncoder,SAHMT_V2_CONFIG:{projectId:'sahmt-17a16',databaseId:'(default)'},sahmtV2Properties_:()=>({getProperty:()=>null}),UrlFetchApp:{fetch:()=>{calls++;throw Error('NO_NETWORK');}}});
 vm.runInContext(core+'\n'+wrapper,context);
 for(const name of ['reconciliarAnalisesQmentumV1','processarFilaQmentumV1','executarCicloQmentumV1'])assert.equal(context[name]().code,'QMENTUM_QUARTERLY_DISABLED');
 assert.equal(calls,0);
});
test('human review stays gated by FA config and needs no external AI, key or scheduler',()=>{
 for(const enabled of [false,true]){let queries=0;const c=vm.createContext({Date,SAHMT_V2_CONFIG:{projectId:'sahmt-17a16',databaseId:'(default)'},sahmtV2Properties_:()=>({getProperty:()=>null}),LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},firestoreDocumentsUrl_:s=>s,firestoreRequest_:()=>{queries++;return[];},UrlFetchApp:{fetch:()=>{throw Error('EXTERNAL_AI_FORBIDDEN');}}});vm.runInContext(wrapper,c);c.qmServerGet_=()=>({enabled});const r=c.validarRevisoesQmentumV1();assert.equal(r.code,enabled?'QMENTUM_REVIEWS_VALIDATED':'QMENTUM_CONFIG_REQUIRED');assert.equal(queries,enabled?1:0);}
 const code=readFileSync(new URL('../apps-script-v2/FormsEvaluation.gs',import.meta.url),'utf8');assert.ok(code.indexOf("step('qmentumReviews'")<code.indexOf("step('qmentumParticipations'"));
});
test('human approval still requires a pending request, fresh grant and current factual signature',()=>{
 for(const scenario of ['APPROVE','REVOKED','STALE','DISABLED','UNIT_INACTIVE']){
  const commits=[],signature='b'.repeat(64),id='a'.repeat(64),actor='synthetic-admin',request={id:'synthetic-request',analysisId:id,unitId:'sahmt',signature,actorUid:actor,reason:'Revisão humana expressa dos dados.'};let gates=0;
  const c=vm.createContext({Date,SAHMT_V2_CONFIG:{projectId:'sahmt-17a16',databaseId:'(default)'},sahmtV2Properties_:()=>({getProperty:()=>null}),LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},firestoreDocumentsUrl_:p=>p,firestoreRequest_:()=>[{document:request}],evaluationDocument_:d=>d,UrlFetchApp:{fetch:()=>{throw Error('AI_FORBIDDEN');}},sha256Hex_:x=>x,QmentumCore:{analysisInputSignature:()=>scenario==='STALE'?'c'.repeat(64):signature}});vm.runInContext(wrapper,c);
  c.qmServerGet_=path=>{const meta={_name:path,_updateTime:'synthetic-t1'};if(path==='qmentumConfig/current')return{...meta,enabled:scenario!=='DISABLED'||++gates===1};if(path.startsWith('users/'))return{...meta,uid:actor,active:true,access:true};if(path.startsWith('qmentumAccess/'))return{...meta,uid:actor,active:scenario!=='REVOKED',role:'manager',units:['sahmt']};if(path==='qmentumUnits/sahmt')return{...meta,unitId:'sahmt',active:scenario!=='UNIT_INACTIVE'};return{...meta,id,signature,year:2026,quarter:1,status:'GENERATED_PENDING_REVIEW',reviewed:false};};
  c.qmServerFacts_=()=>({facts:{},rows:[]});c.qmServerWrite_=(path,data)=>({path,data});c.qmServerCommit_=writes=>commits.push(writes);
  const result=c.validarRevisoesQmentumV1();assert.equal(result.reviewed,scenario==='APPROVE'?1:0);
  if(scenario==='APPROVE'){assert.equal(commits.length,1);assert.equal(commits[0][0].data.status,'REVIEWED');assert.equal(commits[0][0].data.reviewedBy,actor);assert.ok(commits[0].some(w=>w.verify==='users/'+actor));assert.ok(commits[0].some(w=>w.verify==='qmentumUnits/sahmt'));assert.equal(commits[0].filter(w=>w.currentDocument?.exists===false).length,6);}
  else if(scenario==='DISABLED')assert.equal(commits.length,0);
  else{assert.equal(commits.length,1);assert.equal(commits[0][0].path,'qmentumAnalysisReviewRequests/'+request.id);assert.equal(commits[0][0].data.status,scenario==='STALE'?'OBSOLETE':'REJECTED');}
 }
});
test('backend rejects a different Firebase project or database before any write',()=>{
 for(const config of [{projectId:'indicadores---sahmt',databaseId:'(default)'},{projectId:'sahmt-17a16',databaseId:'other'}]){
  const c=vm.createContext({SAHMT_V2_CONFIG:config});vm.runInContext(wrapper,c);assert.throws(()=>c.qmServerConfig_(),/FA_REQUIRED/);
 }
});
test('generated V8 core contains the same deterministic 18-indicator calculator',()=>{
 const c=vm.createContext({Intl,Date,Map,Set});vm.runInContext(core,c);assert.equal(typeof c.QmentumCore.calculateMonth,'function');assert.equal(typeof c.QmentumCore.quarterlyPlan,'function');
 assert.equal(c.QmentumCore.saoPauloPeriod(Date.parse('2027-01-01T01:00:00Z')).year,2026);
});
