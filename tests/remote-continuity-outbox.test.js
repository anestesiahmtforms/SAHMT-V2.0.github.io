import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {cacheProfile,readCachedProfile,enqueueOperation,listUnsettledOperations,writeSafeCache,readSafeCache} from '../src/outbox.js';
test('recuperação preserva a verificação original sem renovar permissões antigas',async()=>{
 const verifiedAt=Date.now()-25*3600000;
 await cacheProfile('synthetic-member',{active:true,access:true,permissions:{}},{validatedAt:verifiedAt});
 assert.equal((await readCachedProfile('synthetic-member')).cachedAt,verifiedAt);
 await assert.rejects(()=>cacheProfile('synthetic-member',{}, {validatedAt:Date.now()+60000}),/timestamp/i);
});
test('snapshot remoto antigo não substitui dados locais mais recentes',async()=>{
 await writeSafeCache('synthetic-member','stations','all',[{id:'new'}]);
 await writeSafeCache('synthetic-member','stations','all',[{id:'old'}],{validatedAt:Date.now()-3600000});
 assert.equal((await readSafeCache('synthetic-member','stations','all')).data[0].id,'new');
});
test('recuperação preserva a criação original da operação',async()=>{
 const createdAt=Date.now()-86400000;
 await enqueueOperation({uid:'synthetic-member',type:'labels',requestId:'original-id',resourceId:'original-id',payload:{data:{date:'2026-10-19'}},createdAt});
 assert.equal((await listUnsettledOperations('synthetic-member'))[0].createdAt,createdAt);
});
