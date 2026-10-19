import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {writeSafeCache,readSafeCache,listPendingTrainingProgress,updateCachedTrainingProgress} from '../src/outbox.js';
async function legacy(entries){
 await writeSafeCache('member','stations','initialize',[]);
 await new Promise((resolve,reject)=>{const open=indexedDB.open('sahmt-v2-local');open.onerror=()=>reject(open.error);open.onsuccess=()=>{
  const db=open.result,tx=db.transaction('cache','readwrite');for(const entry of entries)tx.objectStore('cache').put(entry);
  tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
 };});
}
test('old FA/FB caches do not surface as current data, and pending progress remains available for reconciliation',async()=>{
 await legacy([
  {key:'member::scores::total',uid:'member',kind:'scores',id:'total',data:{total:99}},
  {key:'member::trainingProgress::mine',uid:'member',kind:'trainingProgress',id:'mine',data:{records:[{id:'old-fa',trainingId:'t',syncPending:true,lastPosition:8}]}},
  {key:'member::FB:trainingProgress::mine',uid:'member',kind:'trainingProgress',id:'mine',data:{records:[{id:'old-fb',trainingId:'t',syncPending:true,lastPosition:12}]}}
 ]);
 assert.equal(await readSafeCache('member','scores','total'),undefined);
 const pending=await listPendingTrainingProgress('member');assert.equal(pending.length,2);assert.ok(pending.every(x=>x.destinationChanged&&x.syncConflict));
 assert.deepEqual(pending.map(x=>x.sourceProject).sort(),['FA','FB']);assert.equal((await listPendingTrainingProgress('other')).length,0);
 await writeSafeCache('member','trainingProgress','mine',{records:[{id:'current',trainingId:'t',syncPending:true,lastPosition:3}]});
 await updateCachedTrainingProgress('member','t',{lastPosition:4});
 assert.equal((await readSafeCache('member','trainingProgress','mine')).data.records[0].lastPosition,4);
 assert.deepEqual((await listPendingTrainingProgress('member')).filter(x=>x.destinationChanged).map(x=>x.lastPosition).sort((a,b)=>a-b),[8,12]);
});
