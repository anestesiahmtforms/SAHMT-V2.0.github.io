import test from 'node:test';
import assert from 'node:assert/strict';
import {readThroughSafeCache} from '../src/offline-cache.js';
const storageError=()=>Object.assign(new Error('local storage interrupted'),{code:'storage-timeout'});
const backend={assertCacheAllowed(){},run:async(key,action)=>action()};
const options={uid:'one',kind:'scheduleDays',id:'2026-10-26',localFirst:true,backend,mayFallback:()=>false};
test('an interrupted local cache read cannot prevent a confirmed server read',async()=>{
 let reads=0;const value=await readThroughSafeCache({...options,readCache:async()=>{throw storageError();},writeCache:async()=>{},fetchOnline:async()=>{reads++;return {id:'server'};}});
 assert.deepEqual(value,{id:'server'});assert.equal(reads,1);
});
test('a confirmed server result is returned even if saving its optional cache is interrupted',async()=>{
 const value=await readThroughSafeCache({...options,readCache:async()=>null,writeCache:async()=>{throw storageError();},fetchOnline:async()=>({id:'server'})});
 assert.deepEqual(value,{id:'server'});
});
test('authorization errors remain failures and are not mistaken for local storage interruption',async()=>{
 await assert.rejects(readThroughSafeCache({...options,readCache:async()=>null,writeCache:async()=>{},fetchOnline:async()=>{throw Object.assign(new Error('denied'),{code:'permission-denied'});}}),{code:'permission-denied'});
});
