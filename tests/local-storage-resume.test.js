import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/outbox.js',import.meta.url),'utf8');
function fixture(){
 const timers=new Map();let id=0,opens=0,closed=0,aborted=0,stalledOpen=false,stalledTx=false;
 const db={objectStoreNames:{contains:()=>true},close(){closed++;},transaction(){
  const tx={objectStore:()=>({get:()=>({result:'saved'})}),abort(){aborted++;tx.onabort?.();}};
  if(!stalledTx)queueMicrotask(()=>tx.oncomplete?.());return tx;
 }};
 const ctx=vm.createContext({deployment:{target:'FA',generation:'FA',localDatabase:'test'},Set,Promise,Error,
  setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),
  indexedDB:{open(){opens++;const request={result:db};if(!stalledOpen)queueMicrotask(()=>request.onsuccess?.());return request;}}});
 vm.runInContext(source.slice(source.indexOf('const LOCAL_MANAGEMENT_PROJECT'),source.indexOf('export async function cacheProfile')).replaceAll('export ',''),ctx);
 return {ctx,db,timers,stallOpen:v=>stalledOpen=v,stallTx:v=>stalledTx=v,opens:()=>opens,closed:()=>closed,aborted:()=>aborted,expire(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('an IndexedDB open stranded by WebKit releases callers and the next read opens a new connection',async()=>{
 const h=fixture();h.stallOpen(true);const pending=h.ctx.transact('cache','readonly',s=>s.get('one'));
 const result=assert.rejects(pending,{code:'storage-timeout'});await tick();assert.ok(h.timers.size,'storage open must have a deadline');h.expire();await result;
 h.stallOpen(false);assert.equal(await h.ctx.transact('cache','readonly',s=>s.get('one')),'saved');assert.equal(h.opens(),2);
});
test('an interrupted transaction is aborted and a later read reconnects without deleting records',async()=>{
 const h=fixture();h.stallTx(true);const pending=h.ctx.transact('cache','readonly',s=>s.get('one'));
 const result=assert.rejects(pending,{code:'storage-timeout'});await tick();assert.ok(h.timers.size,'transaction must have a deadline');h.expire();await result;
 assert.equal(h.aborted(),1);assert.equal(h.closed(),1);h.stallTx(false);
 assert.equal(await h.ctx.transact('cache','readonly',s=>s.get('one')),'saved');assert.equal(h.opens(),2);
});
test('an unexpectedly closed IndexedDB connection is reopened on return',async()=>{
 const h=fixture();await h.ctx.transact('cache','readonly',s=>s.get('one'));h.db.onclose?.();
 await h.ctx.transact('cache','readonly',s=>s.get('one'));assert.equal(h.opens(),2);
});
