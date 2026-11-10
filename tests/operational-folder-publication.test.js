import test from 'node:test';
import assert from 'node:assert/strict';
import {publishFolderAvailability,inspectFolderPublication} from '../worker-folder-policy/publication.js';
import {operationalFolderAllowed} from '../src/operational-folders.js';
import {createFolderPolicyWorker,createFolderPolicyStore} from '../worker-folder-policy/worker.js';
import {encodeFields} from '../worker-training/firestore.js';

const run = (store, data, actor='admin') => publishFolderAvailability({store,actor,data});
const id='operacao/escala';
const state=(revision,disabled)=>({schemaVersion:1,revision,disabled});

function memory() {
 const records=new Map(), writes=[];
 let serial=0,broken=null;
 return {
  writes, records,
  fail(target){broken=target;},
  async profile(uid){return {uid,active:true,access:true,role:uid==='admin'?'administrador_app':'usuario'};},
  async read(target){return structuredClone(records.get(target)||null);},
  async write(target,value,expected) {
   if(target===broken)throw Error('unavailable');
   if((records.get(target)?.version??null)!==expected)throw Object.assign(Error(),{code:'FOLDER_POLICY_CONFLICT'});
   records.set(target,{value:structuredClone(value),version:String(++serial)});
   writes.push(target);
   return records.get(target);
  }
 };
}

test('only an active FA administrator can publish registered folder changes',async()=>{
 const store=memory();
 await assert.rejects(run(store,{id,enabled:false,revision:0},'member'),{code:'FOLDER_POLICY_FORBIDDEN'});
 await assert.rejects(run(store,{id:'operacao/unknown',enabled:false,revision:0}),{code:'FOLDER_POLICY_INPUT'});
 assert.deepEqual(store.writes,[]);
});

test('a partially propagated deactivation blocks the UI and keeps the same pending intent until retry',async()=>{
 const store=memory();
 store.fail('FJ');
 const blocked=await run(store,{id,enabled:false,revision:0});
 assert.equal(blocked.pending,true);
 assert.equal(operationalFolderAllowed((await store.read('FA')).value,id),false);
 await assert.rejects(run(store,{id,enabled:true,revision:1}),{code:'FOLDER_POLICY_CONFLICT'});
 store.fail(null);
 const recovered=await run(store,{resume:true,revision:1});
 assert.equal(recovered.pending,false);
 assert.deepEqual((await store.read('FJ')).value,state(1,[id]));
});

test('reactivation keeps the parent blocked in FA until each target acknowledges and preserves children',async()=>{
 const store=memory(),child=id+'/ferias';
 await run(store,{id:child,enabled:false,revision:0});
 await run(store,{id,enabled:false,revision:1});
 store.fail('FJ');
 assert.equal((await run(store,{id,enabled:true,revision:2})).pending,true);
 assert.equal(operationalFolderAllowed((await store.read('FA')).value,id),false);
 store.fail(null);
 await run(store,{resume:true,revision:3});
 const policy=(await store.read('FA')).value;
 assert.equal(operationalFolderAllowed(policy,id),true);
 assert.equal(operationalFolderAllowed(policy,child),false);
 assert.deepEqual(policy,state(3,[child]));
});

test('concurrent changes cannot overwrite the same policy revision',async()=>{
 const store=memory();
 const results=await Promise.allSettled([
  run(store,{id,enabled:false,revision:0}),
  run(store,{id:'operacao/etiquetas',enabled:false,revision:0})
 ]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'FOLDER_POLICY_CONFLICT');
 assert.equal((await store.read('FA')).value.disabled.length,1);
});

test('the Worker ignores client-supplied administrator fields and requires a verified FA identity',async()=>{
 const store=memory();
 const worker=createFolderPolicyWorker({verify:async token=>({uid:token==='member'?'member':'admin',emailVerified:token!=='invalid'}),storeFor:()=>store});
 const request=(authorization,origin='https://anestesiahmtforms.github.io')=>new Request('https://test.invalid/v1/operational-folders',{
  method:'POST',headers:{authorization,origin,'Content-Type':'application/json'},body:JSON.stringify({id,enabled:false,revision:0})
 });
 const env={FOLDER_POLICY_ENABLED:'true'};
 assert.equal((await worker.fetch(request('member'),env)).status,403);
 assert.equal((await worker.fetch(request('invalid'),env)).status,403);
 assert.equal((await worker.fetch(request('admin','https://untrusted.invalid'),env)).status,403);
 assert.equal(store.writes.length,0);
 assert.equal((await worker.fetch(request('admin'),env)).status,200);
});

test('Firestore transport limits the destination and uses a compare-and-swap precondition',async()=>{
 const requests=[];
 const path='projects/sahmt-escala-fj/databases/(default)/documents/runtimePolicy/folders';
 const store=createFolderPolicyStore({getAccessToken:async()=> 'service-token',fetchImpl:async(url,options)=>{
  requests.push({url,options});
  return Response.json({name:path,updateTime:'2026-11-09T00:00:00Z',fields:encodeFields(state(1,[id]))});
 }});
 await store.write('FJ',state(1,[id]),null);
 await store.write('FJ',state(1,[id]),'2026-11-09T00:00:00Z');
 await assert.rejects(store.read('unknown'),{code:'FOLDER_POLICY_CONFIG'});
 assert.equal(requests.length,2);
 assert.equal(requests[0].url.searchParams.get('currentDocument.exists'),'false');
 assert.equal(requests[1].url.searchParams.get('currentDocument.updateTime'),'2026-11-09T00:00:00Z');
 assert.equal(requests[0].options.headers.Authorization,'Bearer service-token');
});

test('a failed preparation keeps every healthy replica closed and field order does not prevent resuming',async()=>{
 const store=memory();
 await run(store,{id,enabled:false,revision:0});
 store.fail('FJ');
 assert.deepEqual(await run(store,{id,enabled:true,revision:1}),{revision:2,pending:true});
 for(const station of ['FA','FB','FC','FD','FE','FF','FG','FH','FI','FJ']){
  const record=await store.read(station);
  assert.equal(operationalFolderAllowed(record.value,id),false,station);
 }
 const fb=store.records.get('FB');
 fb.value={disabled:[id],revision:2,schemaVersion:1};
 store.fail(null);
 assert.deepEqual(await run(store,{resume:true,revision:2}),{revision:2,pending:false});
 assert.equal(operationalFolderAllowed((await store.read('FB')).value,id),true);
});

test('admin inspection is read only and reports missing, stale, invalid and unavailable replicas',async()=>{
 const store=memory();
 await assert.rejects(inspectFolderPublication({store,actor:'member'}),{code:'FOLDER_POLICY_FORBIDDEN'});
 assert.equal((await inspectFolderPublication({store,actor:'admin'})).initialized,false);
 await run(store,{id,enabled:false,revision:0});
 store.records.delete('FG');
 store.records.get('FE').value={invalid:true};
 store.records.get('FB').value={schemaVersion:1,revision:1,disabled:[]};
 const read=store.read;
 store.read=async station=>{if(station==='FJ')throw Error('unavailable');return read(station);};
 const writes=store.writes.length;
 const result=await inspectFolderPublication({store,actor:'admin'});
 assert.equal(result.revision,1);
 assert.equal(result.pending,false);
 const states=Object.fromEntries(result.stations.map(row=>[row.station,row.state]));
 assert.equal(states.FG,'missing');assert.equal(states.FB,'different');assert.equal(states.FE,'invalid');assert.equal(states.FJ,'unavailable');assert.equal(states.FF,'current');
 assert.equal(store.writes.length,writes);
});
test('initialization establishes an empty revision and rejects preexisting replicas',async()=>{
 const dirty=memory();
 await dirty.write('FB',state(1,[id]),null);
 await assert.rejects(run(dirty,{initialize:true,revision:0}),{code:'FOLDER_POLICY_CONFLICT'});
 assert.equal(await dirty.read('FA'),null);
 const store=memory();
 store.fail('FJ');
 assert.deepEqual(await run(store,{initialize:true,revision:0}),{revision:1,pending:true});
 store.fail(null);
 assert.deepEqual(await run(store,{resume:true,revision:1}),{revision:1,pending:false});
 const result=await inspectFolderPublication({store,actor:'admin'});
 assert.equal(result.initialized,true);
 assert.ok(result.stations.every(row=>row.state==='current'));
 assert.deepEqual((await store.read('FA')).value,state(1,[]));
});

test('inspection is available through the authenticated administrator endpoint',async()=>{
 const store=memory();
 const worker=createFolderPolicyWorker({
  verify:async token=>({uid:token==='admin'?'admin':'member',emailVerified:true}),
  storeFor:()=>store
 });
 const request=authorization=>new Request('https://test.invalid/v1/operational-folders',{
  method:'POST',headers:{authorization,origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},
  body:JSON.stringify({inspect:true})
 });
 const env={FOLDER_POLICY_ENABLED:'true'};
 assert.equal((await worker.fetch(request('member'),env)).status,403);
 const response=await worker.fetch(request('admin'),env);
 assert.equal(response.status,200);
 const report=await response.json();
 assert.equal(report.stations.length,9);
 assert.ok(report.stations.every(row=>row.state==='missing'));
 assert.equal(store.writes.length,0);
});
