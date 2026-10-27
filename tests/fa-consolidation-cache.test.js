import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {writeSafeCache,readSafeCache,listPendingTrainingProgress,updateCachedTrainingProgress} from '../src/outbox.js';
import {discardLegacyOfflineData} from '../src/discard-legacy-offline-data.js';
async function legacy(entries){
 await new Promise((resolve,reject)=>{const open=indexedDB.open('sahmt-v2-local',1);open.onupgradeneeded=()=>open.result.createObjectStore('cache',{keyPath:'key'});open.onerror=()=>reject(open.error);open.onsuccess=()=>{
  const db=open.result,tx=db.transaction('cache','readwrite');for(const entry of entries)tx.objectStore('cache').put(entry);
  tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
 };});
}
test('old FA/FB caches and pending training progress are discarded at startup',async()=>{
 await legacy([
  {key:'member::scores::total',uid:'member',kind:'scores',id:'total',data:{total:99}},
  {key:'member::trainingProgress::mine',uid:'member',kind:'trainingProgress',id:'mine',data:{records:[{id:'old-fa',trainingId:'t',syncPending:true,lastPosition:8}]}},
  {key:'member::FB:trainingProgress::mine',uid:'member',kind:'trainingProgress',id:'mine',data:{records:[{id:'old-fb',trainingId:'t',syncPending:true,lastPosition:12}]}}
 ]);
 await discardLegacyOfflineData({indexedDB,storages:[],caches:null});
 assert.equal(await readSafeCache('member','scores','total'),null);
 assert.deepEqual(await listPendingTrainingProgress('member'),[]);assert.equal((await indexedDB.databases()).some(db=>db.name==='sahmt-v2-local'),false);
 await writeSafeCache('member','trainingProgress','mine',{records:[{id:'current',trainingId:'t',syncPending:true,lastPosition:3}]});
 await updateCachedTrainingProgress('member','t',{lastPosition:4});
 assert.equal(await readSafeCache('member','trainingProgress','mine'),null);
 assert.deepEqual(await listPendingTrainingProgress('member'),[]);
});
