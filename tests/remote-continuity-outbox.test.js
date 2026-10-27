import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheProfile,readCachedProfile,enqueueOperation,listUnsettledOperations,writeSafeCache,readSafeCache} from '../src/outbox.js';
test('perfil e leituras locais permanecem desativados',async()=>{
 await cacheProfile('synthetic-member',{active:true,access:true,permissions:{}});
 assert.equal(await readCachedProfile('synthetic-member'),null);
 await writeSafeCache('synthetic-member','stations','all',[{id:'new'}]);
 await writeSafeCache('synthetic-member','stations','all',[{id:'old'}],{validatedAt:Date.now()-3600000});
 assert.equal(await readSafeCache('synthetic-member','stations','all'),null);
});
test('fila de operações rejeita armazenamento local e não assenta pendências',async()=>{
 await assert.rejects(enqueueOperation({uid:'synthetic-member',type:'labels',requestId:'original-id',resourceId:'original-id',payload:{data:{date:'2026-10-19'}}}),{code:'offline-storage-disabled'});
 assert.deepEqual(await listUnsettledOperations('synthetic-member'),[]);
});
