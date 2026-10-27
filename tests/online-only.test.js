import test from 'node:test';
import assert from 'node:assert/strict';
import {persistOperationalMutation} from '../src/offline-mutation.js';
import {enqueueOperation,saveOperationalDraft,readSafeCache,writeSafeCache} from '../src/outbox.js';

test('confirmed online mutation never persists a draft or outbox item',async()=>{
 let saved=0,cleared=0,sent=0;
 const result=await persistOperationalMutation({id:'id',online:true,saveLocal:async()=>saved++,clearLocal:async()=>cleared++,sendRemote:async()=>{sent++;return {id:'id',pendingFirestore:false};},recoverable:()=>true});
 assert.equal(saved,0);assert.equal(cleared,0);assert.equal(sent,1);assert.equal(result.pendingFirestore,false);
});
test('offline mutation fails without local persistence or remote sending',async()=>{
 let saved=0,sent=0;
 await assert.rejects(persistOperationalMutation({id:'id',online:false,saveLocal:async()=>saved++,sendRemote:async()=>sent++}),{code:'online-required'});
 assert.equal(saved,0);assert.equal(sent,0);
});
test('lost response is uncertain, never a queued success',async()=>{
 const error=Object.assign(Error('Lost response'),{code:'unavailable'});
 await assert.rejects(persistOperationalMutation({id:'id',online:true,saveLocal:async()=>{},sendRemote:async()=>{throw error;},recoverable:()=>true}),e=>e.code==='write-unconfirmed'&&e.requestId==='id');
});
test('public durable queue boundary rejects even if called directly',async()=>{
 await assert.rejects(enqueueOperation({uid:'u',type:'events',requestId:'id',payload:{}}),{code:'offline-storage-disabled'});
});
test('operational cache and drafts no longer access device storage',async()=>{
 await saveOperationalDraft('u','events','entry',{field:'value'});
 await writeSafeCache('u','events','today',{records:[{id:'x'}]});
 assert.equal(await readSafeCache('u','events','today'),null);
});

import {IDBFactory} from 'fake-indexeddb';
import {discardLegacyOfflineData,LEGACY_OPERATIONAL_DATABASES} from '../src/discard-legacy-offline-data.js';
const seed=(idb,name)=>new Promise((resolve,reject)=>{const r=idb.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('data','readwrite');tx.objectStore('data').put({record:'kept'},'record');tx.oncomplete=()=>{db.close();resolve();};};});
test('migration deletes only known local operational stores and keeps Firebase Auth',async()=>{
 const idb=new IDBFactory();for(const name of [...LEGACY_OPERATIONAL_DATABASES,'firebaseLocalStorageDb','other-app'])await seed(idb,name);
 const values=new Map([['sahmt:qmentum:FC:u:unit:2026-10','draft'],['sahmt-fb-html-content-v1','content'],['firebase:authUser:app','auth'],['sahmt-navigation','route']]);
 const storage={get length(){return values.size;},key:i=>[...values.keys()][i],removeItem:key=>values.delete(key)};
 const deleted=[];
 for(let i=0;i<2;i++)await discardLegacyOfflineData({indexedDB:idb,storages:[storage],caches:{delete:async name=>deleted.push(name)}});
 assert.deepEqual((await idb.databases()).map(d=>d.name).sort(),['firebaseLocalStorageDb','other-app']);
 assert.deepEqual([...values.keys()],['firebase:authUser:app','sahmt-navigation']);
 assert.deepEqual(deleted,['sahmt-v2-offline-schedule-v1','sahmt-v2-offline-schedule-v1']);
});
test('blocked legacy deletion stops startup rather than silently retaining a queue',async()=>{
 const idb={deleteDatabase:()=>({})};
 await assert.rejects(discardLegacyOfflineData({indexedDB:idb,storages:[],timeoutMs:5}),{code:'legacy-cleanup-blocked'});
});
test('a late response after the display deadline neither saves locally nor reports queued success',async()=>{
 let resolve,saved=0,clear=0;const remote=new Promise(r=>resolve=r);
 const result=persistOperationalMutation({id:'stable-id',online:true,timeoutMs:5,sendRemote:()=>remote,saveLocal:()=>saved++,clearLocal:()=>clear++});
 await assert.rejects(result,error=>error.code==='write-unconfirmed'&&error.requestId==='stable-id');
 resolve({id:'stable-id',pendingFirestore:false});await Promise.resolve();
 assert.equal(saved,0);assert.equal(clear,0);
});
