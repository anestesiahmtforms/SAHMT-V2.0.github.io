import test from 'node:test';import assert from 'node:assert/strict';
import {createFcPerformanceRepository,fcPerformancePresentation} from '../src/fc-performance-data.js';
const uid='same-existing-uid',projectId='indicadores---sahmt';
function fixture({authProject=projectId,profile={uid,active:true,access:true}}={}){
 const app={options:{projectId}},auth={app:{options:{projectId:authProject}},currentUser:{uid}},db={app};
 const callbacks=new Map(),released=[],reads=[],queries=[];
 const sdk={doc:(_db,...parts)=>({path:parts.join('/')}),collection:(_db,name)=>({path:name}),where:(...args)=>({where:args}),limit:value=>({limit:value}),orderBy:(...args)=>({order:args}),
  query:(collection,...constraints)=>{queries.push({path:collection.path,constraints});return collection;},
  getDocFromServer:async ref=>{reads.push(ref.path);return{exists:()=>!!profile,data:()=>profile};},
  onSnapshot:(ref,_options,next,error)=>{callbacks.set(ref.path,{next,error});return()=>released.push(ref.path);}};
 const data=[],errors=[];const repository=createFcPerformanceRepository({db,auth,uid,firestore:sdk,isCurrent:()=>true});
 const stop=()=>repository.watch({onData:value=>data.push(value),onError:error=>errors.push(error)});
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 function emit(path,value,{list=false,cache=false,pending=false}={}){callbacks.get(path).next(list?{docs:value.map((item,i)=>({id:'row-'+i,data:()=>item})),metadata:{fromCache:cache,hasPendingWrites:pending}}:{exists:()=>value!=null,data:()=>value,metadata:{fromCache:cache,hasPendingWrites:pending}});}
 return{repository,auth,db,callbacks,released,reads,queries,data,errors,stop,tick,emit};
}
test('FC performance uses only the existing FC session and its own prefixed collections',async()=>{
 const f=fixture(),stop=f.stop();await f.tick();
 assert.deepEqual(f.reads,['users/'+uid]);
 assert.deepEqual([...f.callbacks.keys()].sort(),['users/'+uid,'fcPerformanceRuntime/state','fcPerformanceReference/team','fcPerformanceSummaries/'+uid,'fcPerformanceAwards','fcPerformanceLedger'].sort());
 for(const query of f.queries){assert.ok(query.constraints.some(c=>c.where?.[0]==='uid'&&c.where[2]===uid));assert.ok(query.constraints.some(c=>c.where?.[0]==='category'&&c.where[2]==='PERFORMANCE'));assert.ok(query.constraints.some(c=>c.limit===200));}
 stop();assert.equal(f.released.length,6);
});
test('same UID with another project cannot read FC performance',async()=>{
 const f=fixture({authProject:'sahmt-gestao-5ae66'});f.stop();await f.tick();assert.equal(f.reads.length,0);assert.equal(f.errors[0]?.message,'FC_PERFORMANCE_SESSION_INVALID');
});
test('FC performance stops every listener when local access is revoked or UID changes',async()=>{
 for(const change of ['access','uid']){const f=fixture(),stop=f.stop();await f.tick();
  if(change==='access')f.emit('users/'+uid,{uid,active:true,access:false});else{f.auth.currentUser={uid:'different'};f.emit('fcPerformanceSummaries/'+uid,{uid,performanceTotal:2});}
  assert.equal(f.released.length,6);assert.equal(f.errors.length,1);stop();assert.equal(f.released.length,6);
 }
});
test('FC performance rejects another UID or category in a returned ledger page',async()=>{
 const f=fixture();f.stop();await f.tick();f.emit('fcPerformanceLedger',[{uid:'another',category:'PERFORMANCE',points:2}],{list:true});
 assert.equal(f.errors[0]?.message,'FC_PERFORMANCE_RECORD_SCOPE_INVALID');assert.equal(f.released.length,6);
});
test('FC performance presents only a matching server-confirmed balance and FC-relative reference',()=>{
 const snapshot={uid,fromCache:false,pendingWrites:false,runtime:{enabled:true,mode:'FC_ONLY',release:'fc-performance-exclusive-v1',performanceRevision:2,performanceDirty:false},
  summary:{uid,status:'CONFIRMED',performanceTotal:3,performanceRevision:2},reference:{performanceStatus:'CONFIRMED',performanceRevision:2,maxPerformance:6,eligibleCount:2,allZero:false},awards:[],ledger:[]};
 assert.deepEqual(fcPerformancePresentation(snapshot),{state:'ready',total:3,percentage:50});
 assert.equal(fcPerformancePresentation({...snapshot,fromCache:true}).state,'offline');
 assert.equal(fcPerformancePresentation({...snapshot,pendingWrites:true}).state,'pending');
 assert.equal(fcPerformancePresentation({...snapshot,summary:{...snapshot.summary,performanceRevision:1}}).state,'pending');
 assert.equal(fcPerformancePresentation({...snapshot,runtime:{...snapshot.runtime,performanceRevision:3}}).state,'pending');
 assert.equal(fcPerformancePresentation({...snapshot,runtime:{...snapshot.runtime,performanceDirty:true}}).state,'pending');
 assert.equal(fcPerformancePresentation({...snapshot,reference:{...snapshot.reference,eligibleCount:0}}).state,'pending');
 assert.equal(fcPerformancePresentation({...snapshot,summary:{...snapshot.summary,performanceTotal:0},reference:{...snapshot.reference,maxPerformance:0,allZero:true}}).percentage,0);
 assert.equal(fcPerformancePresentation({...snapshot,runtime:{enabled:false}}).state,'preparing');
 assert.equal(fcPerformancePresentation({...snapshot,summary:{...snapshot.summary,uid:'another'}}).state,'blocked');
});
