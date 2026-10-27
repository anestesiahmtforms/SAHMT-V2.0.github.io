import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/data.js',import.meta.url),'utf8');
test('gravação operacional sem internet não cria operação pendente',async()=>{
 const steps=[];const ctx=vm.createContext({crypto,navigator:{onLine:false},assertOnlineOperation:({online=ctx.navigator.onLine}={})=>{if(!online)throw Object.assign(Error('online required'),{code:'online-required'});},
  persistOperationalMutation:()=>steps.push('persist'),sendOperationalRecordInFirestore:()=>steps.push('firestore')});
 const start=source.indexOf('export async function createOperationalRecord('),end=source.indexOf('async function sendOperationalRecordInFirestore(',start);
 vm.runInContext(source.slice(start,end).replace('export ',''),ctx);
 await assert.rejects(ctx.createOperationalRecord('labels',{date:'2026-10-20'},{uid:'synthetic',requestId:'stable'}),{code:'online-required'});
 assert.deepEqual(steps,[]);
});
