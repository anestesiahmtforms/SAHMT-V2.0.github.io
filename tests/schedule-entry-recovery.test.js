import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createOperationalBackend,operationalBackend} from '../src/operational-backend.js';
import {readThroughSafeCache} from '../src/offline-cache.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const turn=()=>new Promise(r=>setImmediate(r));
const source=readFileSync(new URL('../src/data-lite.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
function fixture({prepare=async()=>({project:'FJ'}),read=async()=>({exists:()=>true,id:'2026-11-13',data:()=>({positions:['AA']})}),catalog=async()=>({docs:[]}),policy=()=>{}}={}){
 const backend=createOperationalBackend({timeoutMs:8,random:()=>0});
 const context=vm.createContext({assertOnlineOperation(){},assertOperationalContentAllowed:policy,scheduleReadBackend:backend,
  operationalModuleEnabled:()=>true,getOperationalModuleDatabase:prepare,readThroughSafeCache,db:{project:'FA'},
  readSafeCache(){},writeSafeCache(){},readFreshSafeCache(){},listUnsettledOperations:async()=>[],projectPendingSchedule:v=>v,
  doc:(database,...path)=>({database,path}),collection:(database,...path)=>({database,path}),query:r=>r,where(){},orderBy(){},limit(){},getDoc:read,getDocs:catalog});
 vm.runInContext(source,context);return {context,backend};
}

test('slow FJ authentication is outside the Firestore read deadline and cannot trip FA connectivity',async()=>{
 const ready=deferred(),f=fixture({prepare:()=>ready.promise});
 const reading=f.context.readSchedule('2026-11-13','one',{independent:true});
 await new Promise(r=>setTimeout(r,20));assert.equal(f.backend.snapshot().calls,0);assert.equal(f.backend.snapshot().code,'');
 ready.resolve({project:'FJ'});const result=await reading;assert.equal(result.positions[0],'AA');assert.equal(operationalBackend.snapshot().code,'');
});

test('a failed FJ contacts catalog neither changes FA connectivity nor cancels a pending schedule',async()=>{
 const schedule=deferred(),f=fixture({read:()=>schedule.promise,catalog:async()=>{throw {code:'unavailable'};}});
 const reading=f.context.readSchedule('2026-11-13','one',{independent:true});
 await assert.rejects(f.context.listActiveContacts({uid:'one',independent:true}),{code:'unavailable'});
 schedule.resolve({exists:()=>true,id:'2026-11-13',data:()=>({positions:['AA']})});
 assert.equal((await reading).positions[0],'AA');assert.equal(operationalBackend.snapshot().code,'');
});

test('a late FJ server response updates the mounted schedule without a duplicate request',async()=>{
 const response=deferred(),updates=[];let calls=0;
 const f=fixture({read:()=>{calls++;return response.promise;}});
 await assert.rejects(f.context.readSchedule('2026-11-13','one',{independent:true,onRefresh:v=>updates.push(v)}),{code:'deadline-exceeded'});
 response.resolve({exists:()=>true,id:'2026-11-13',data:()=>({positions:['AA']})});await turn();
 assert.equal(calls,1);assert.equal(updates.length,1);assert.equal(updates[0].positions[0],'AA');assert.equal(operationalBackend.snapshot().code,'');
});

test('disabling event entry or vacations does not disable the published daily schedule',async()=>{
 const f=fixture({policy:folder=>{if(folder!=='operacao/escala')throw Error('FOLDER_DISABLED');}});
 assert.equal((await f.context.readSchedule('2026-11-13','one',{independent:true})).positions[0],'AA');
 await assert.rejects(f.context.listVacationsForDate('2026-11-13',{uid:'one',independent:true}),/FOLDER_DISABLED/);
});

test('FJ quota metadata stays separate from the FA quota metadata',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const fj=createOperationalBackend({storage,storageKey:'sahmt-fj-firestore-read-backoff-v1'});
 fj.noteFailure({code:'resource-exhausted'},'schedule');
 assert.equal(createOperationalBackend({storage}).snapshot().code,'');
 assert.equal(createOperationalBackend({storage,storageKey:'sahmt-fj-firestore-read-backoff-v1'}).snapshot().code,'resource-exhausted');
});

test('suspension marks FJ reads as interrupted so timed-out SDK requests can be replaced on return',()=>{
 const listeners=new Map();let interrupted=0;
 const code=readFileSync(new URL('../src/schedule-read-backend.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export const','const');
 const context=vm.createContext({createOperationalBackend:()=>({interruptReads:()=>interrupted++}),
  addEventListener:(name,fn)=>listeners.set(name,fn),document:{hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn)}});
 vm.runInContext(code,context);listeners.get('visibilitychange')();assert.equal(interrupted,0);
 context.document.hidden=true;listeners.get('visibilitychange')();listeners.get('pagehide')();assert.equal(interrupted,2);
});
