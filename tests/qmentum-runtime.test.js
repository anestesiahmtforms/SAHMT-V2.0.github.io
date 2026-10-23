import test from 'node:test';
import assert from 'node:assert/strict';
import {createQmentumRepository} from '../src/qmentum-data.js';
import {emptyInputs,initialDefinitions} from '../src/qmentum-catalog.js';

function fixture() {
 const app={options:{projectId:'indicadores---sahmt'}},uid='runtime-user',reads=[],transactionReads=[];
 const definitions=initialDefinitions(),docs=new Map([
  ['users/'+uid,{uid,active:true,access:true}],
  ['qmentumAccess/'+uid,{uid,active:true,role:'manager',units:['unit-a']}],
  ['qmentumConfig/current',{enabled:true,definitionVersion:1}],
  ['qmentumUnits/unit-a',{unitId:'unit-a',name:'Synthetic unit',active:true}],
  ['qmentumDefinitions/1',definitions]
 ]);
 const auth={app,currentUser:{uid,getIdTokenResult:async()=>({claims:{aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt',sub:uid}})}};
 const state={beforeRead:null,rows:[],current:true,commands:[]};
 const snapshot=path=>({exists:()=>docs.has(path),data:()=>structuredClone(docs.get(path))});
 const firestore={
  doc:(_db,...path)=>path.join('/'),collection:(_db,...path)=>path.join('/'),query:(path,...filters)=>({path,filters}),where:(...args)=>args,orderBy:(...args)=>args,limit:n=>n,
  getDocFromServer:async path=>{reads.push(path);await state.beforeRead?.(path);return snapshot(path);},
  getDocsFromServer:async()=>({docs:state.rows.map(row=>({id:row.period,data:()=>structuredClone(row)}))}),
  serverTimestamp:()=>({syntheticTimestamp:true}),
  runTransaction:async(_db,callback)=>callback({get:async path=>{transactionReads.push(path);return snapshot(path);},set:()=>{},update:()=>{}})
 };
 const repo=createQmentumRepository({db:{app},auth,uid,isCurrent:()=>state.current,firestore,writeCommand:async(operation,payload)=>{state.commands.push({operation,payload});return{version:1};}});
 return {repo,auth,uid,docs,reads,transactionReads,state,definitions};
}

test('immutable definitions are read once across open, years and explicit definition requests',async()=>{
 const f=fixture();
 f.state.rows=[{period:'2026-01',year:2026,month:1,version:1,definitionVersion:1,inputs:emptyInputs()}];
 await f.repo.open();await f.repo.year('unit-a',2026);await f.repo.definition(1);await f.repo.year('unit-a',2026);
 assert.equal(f.reads.filter(path=>path==='qmentumDefinitions/1').length,1);
 assert.equal(f.reads.filter(path=>path==='users/'+f.uid).length,4);
 assert.equal(f.reads.filter(path=>path==='qmentumAccess/'+f.uid).length,4);
});

test('simultaneous definition requests share the server read but return independent values',async()=>{
 const f=fixture();
 const [first,second]=await Promise.all([f.repo.definition(1),f.repo.definition(1)]);
 first.items.QM01.criterion='Caller changed this object';
 assert.equal(second.items.QM01.criterion,f.definitions.items.QM01.criterion);
 assert.equal((await f.repo.definition(1)).items.QM01.criterion,f.definitions.items.QM01.criterion);
 assert.equal(f.reads.filter(path=>path==='qmentumDefinitions/1').length,1);
});

test('a cached definition never bypasses revoked profile, grant or module enablement',async()=>{
 for(const [path,property] of [['users/runtime-user','active'],['qmentumAccess/runtime-user','active'],['qmentumConfig/current','enabled']]){
  const f=fixture();await f.repo.definition(1);f.docs.get(path)[property]=false;
  await assert.rejects(f.repo.definition(1),/QMENTUM_(PERMISSION_DENIED|CONFIG_REQUIRED)/);
 }
});

test('failed definition loads are retryable and are not cached as successful definitions',async()=>{
 const f=fixture();f.state.beforeRead=path=>{if(path==='qmentumDefinitions/1')throw Error('synthetic offline');};
 await assert.rejects(f.repo.definition(1),/synthetic offline/);f.state.beforeRead=null;
 assert.equal((await f.repo.definition(1)).version,1);
 assert.equal(f.reads.filter(path=>path==='qmentumDefinitions/1').length,2);
});

test('invalid definition data is rejected before entering the immutable cache',async()=>{
 const f=fixture();f.docs.set('qmentumDefinitions/1',{version:1});
 await assert.rejects(f.repo.definition(1),/QMENTUM_DEFINITION_INVALID/);
 f.docs.set('qmentumDefinitions/1',f.definitions);
 assert.equal((await f.repo.definition(1)).version,1);
});

test('session invalidation clears cached definitions and rejects in-flight data',async()=>{
 const f=fixture();await f.repo.definition(1);f.state.current=false;
 await assert.rejects(f.repo.definition(1),/QMENTUM_SESSION_CHANGED/);
 f.state.current=true;await f.repo.definition(1);
 assert.equal(f.reads.filter(path=>path==='qmentumDefinitions/1').length,2);
 const pending=fixture();pending.state.beforeRead=path=>{if(path==='qmentumDefinitions/1')pending.auth.currentUser=null;};
 await assert.rejects(pending.repo.definition(1),/QMENTUM_SESSION_CHANGED/);
});

test('saving sends only source inputs for fresh trusted validation, never cached definitions or calculated results',async()=>{
 const f=fixture();await f.repo.definition(1);
 await f.repo.save({unitId:'unit-a',year:2026,month:1,referenceDate:'2026-01-01',inputs:emptyInputs()});
 assert.equal(f.state.commands[0].operation,'SAVE_MONTH');
 assert.equal('results' in f.state.commands[0].payload,false);assert.equal('definitions' in f.state.commands[0].payload,false);
 assert.equal('uid' in f.state.commands[0].payload,false);assert.equal(f.reads.filter(path=>path==='users/'+f.uid).length,2);
});
