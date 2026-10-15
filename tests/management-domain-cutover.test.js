import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import 'fake-indexeddb/auto';
const data=readFileSync(new URL('../src/data.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
function fn(name){const m=data.match(new RegExp('(?:export )?(?:async )?function '+name+'\\('));assert.ok(m);const start=m.index;return data.slice(start,data.indexOf('\n}',start)+2).replace(/^export /,'');}
function harness(){
 const fa={project:'FA'},fb={project:'FB'},writes=[],queued=[];
 const ctx={db:fa,identityDb:fa,managementDataProject:'FA',managementDataGeneration:'FA_CONSOLIDATED_V1',navigator:{onLine:true},crypto:{randomUUID:()=> 'r'},
 managementDatabase:async()=>fa,writeBatch:db=>({db,set(ref,value){writes.push({project:db.project,ref,value});},async commit(){}}),
 buildRecordBatch:(batch,input,db)=>batch.set({project:db.project},input),
 enqueueOperation:async op=>queued.push(op),mayQueueOffline:()=>true,
 listQueuedOperations:async()=>queued,listUnsettledOperations:async()=>queued,pendingOperationCount:async()=>queued.length,
 updateQueuedOperation:async(uid,id,patch)=>Object.assign(queued.find(x=>x.requestId===id),patch),
 removeQueuedOperation:async(uid,id)=>{queued.splice(queued.findIndex(x=>x.requestId===id),1);},
 runKeyedTask:async(map,key,action)=>action(),flushPromises:new Map(),
 confirmOperationalSheetDelivery:async()=>{},flushOperationalSheetDelivery:async()=>{},
 window:{dispatchEvent(){}},CustomEvent:class{},Date};
 vm.createContext(ctx);vm.runInContext([fn('createOperationalRecordInFirestore'),fn('assertQueuedOperationShape'),fn('flushOutbox')].join('\n'),ctx);
 return {ctx,writes,queued};
}
test('nova atividade e eventos usam FA preservando IDs de mutação',async()=>{
 const h=harness();await h.ctx.createOperationalRecordInFirestore('activities',{title:'Sintético'},{uid:'u',requestId:'a'});
 await h.ctx.createOperationalRecordInFirestore('events',{title:'Sintético'},{uid:'u',requestId:'b'});
 assert.deepEqual(h.writes.map(x=>x.project),['FA','FA']);
});
test('nova fila FA conserva a geração da migração e sincroniza somente em FA',async()=>{
 const h=harness();h.ctx.navigator.onLine=false;
 await h.ctx.createOperationalRecordInFirestore('activities',{title:'Sintético'},{uid:'u',requestId:'a'});
 assert.equal(h.queued[0].payload.dataProject,'FA');assert.equal(h.queued[0].payload.dataGeneration,'FA_CONSOLIDATED_V1');h.queued[0].attempts=0;
 h.ctx.navigator.onLine=true;await h.ctx.flushOutbox('u');assert.equal(h.writes[0].project,'FA');assert.equal(h.queued.length,0);
});
test('fila FA antiga fica preservada e bloqueada depois da mudança',async()=>{
 const h=harness();h.queued.push({uid:'u',type:'activities',requestId:'a',resourceId:'a',attempts:0,payload:{collectionName:'activities',data:{title:'Sintético'}}});
 await h.ctx.flushOutbox('u');assert.equal(h.writes.length,0);assert.equal(h.queued.length,1);
 assert.equal(h.queued[0].lastErrorCode,'domain-cutover-review');assert.equal(h.queued[0].status,'failed');
});
test('old environment targets cannot restore FB cache routing after consolidation',async()=>{
 const source=readFileSync(new URL('../src/outbox.js',import.meta.url),'utf8');
 const moduleFor=project=>import('data:text/javascript;base64,'+Buffer.from(source.replace('import.meta.env',JSON.stringify({VITE_MANAGEMENT_DATA_PROJECT:project}))).toString('base64'));
 const fa=await moduleFor('FA'),fb=await moduleFor('FB');
 await fa.writeSafeCache('synthetic','trainingProgress','mine',{records:[{id:'old',trainingId:'t',syncPending:true,lastPosition:12}]});
 await fa.writeSafeCache('synthetic','scores','total',{total:9});
 assert.equal((await fb.readSafeCache('synthetic','scores','total')).data.total,9);
 assert.equal((await fb.readSafeCache('synthetic','trainingProgress','mine')).data.records[0].id,'old');
 const pending=await fb.listPendingTrainingProgress('synthetic');assert.equal(pending.length,1);assert.equal(pending[0].destinationChanged,undefined);
 await fb.writeSafeCache('synthetic','trainingProgress','mine',{records:[{id:'new',trainingId:'t',syncPending:true,lastPosition:3}]});
 await fb.updateCachedTrainingProgress('synthetic','t',{lastPosition:4});
 assert.equal((await fa.readSafeCache('synthetic','trainingProgress','mine')).data.records[0].lastPosition,4);
 assert.equal((await fb.readSafeCache('synthetic','trainingProgress','mine')).data.records[0].lastPosition,4);
 assert.equal((await fb.listPendingTrainingProgress('synthetic')).length,1);
 await fa.writeSafeCache('synthetic','stations','all',[{id:'s'}]);assert.equal((await fb.readSafeCache('synthetic','stations','all')).data[0].id,'s');
});
