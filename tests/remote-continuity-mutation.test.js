import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/data.js',import.meta.url),'utf8');
const start=source.indexOf('async function createOperationalRecordInFirestore('),end=source.indexOf('\n}',start)+2;
test('salvamento comum mantém a cópia local até receber o recibo remoto antes do commit',async()=>{
 const steps=[];const ctx=vm.createContext({crypto,navigator:{onLine:true},isOfflineRuntimeForced:()=>false,mayUseOfflineCache:()=>true,
  enqueueOperation:async()=>steps.push('local'),prepareProvisionalWrite:async()=>steps.push('remote-receipt'),
  sendOperationalRecordInFirestore:async()=>steps.push('firestore'),markProvisionalWriteCommitted:async()=>steps.push('committed'),removeQueuedOperation:async()=>steps.push('remove-local'),
  persistOperationalMutation:async options=>{await options.saveLocal();await options.sendRemote();await options.clearLocal();}
 });vm.runInContext(source.slice(start,end),ctx);
 await ctx.createOperationalRecordInFirestore('labels',{date:'2026-10-20'},{uid:'synthetic',requestId:'stable'});
 assert.deepEqual(steps,['local','remote-receipt','firestore','committed','remove-local']);
});
