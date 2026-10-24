import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createOperationalBackend} from '../src/operational-backend.js';
import {isFirestoreCacheFallbackError} from '../src/offline-cache.js';
const source=readFileSync(new URL('../src/auth.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('async function showCachedSession('),source.indexOf('export function watchSession('));
const profileCode=source.slice(source.indexOf('async function onAuthChangedProfile('),source.indexOf('export async function signInGoogle(')).replaceAll('import(','fakeImport(');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({slow=true}={}){
 let finish,fail,generation=1,calls=0,watches=0,watchError;const states=[];
 const profile={uid:'fixture',active:true,access:true,permissions:{managementRead:true,trainingsRead:true}};
 const snapshot=(changes={})=>({exists:()=>true,data:()=>({...profile,...changes})});
 const ctx=vm.createContext({navigator:{onLine:false},isFirestoreCacheFallbackError,profileForPresentation:p=>p,
  cacheProfile:async()=>{},readCachedProfile:async()=>profile,operationalBackend:createOperationalBackend({timeoutMs:5}),
  window:{setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}},
  fakeImport:async name=>name==='firebase/firestore/lite'?{doc:()=>({}),getDoc:async()=>{calls++;if(slow&&calls===1)return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});return snapshot();}}:name==='firebase/firestore'?{doc:()=>({}),onSnapshot:(_ref,_next,error)=>{watches++;watchError=error;return()=>{};}}:{db:{}}});
 vm.runInContext(helpers+profileCode,ctx);
 return {ctx,states,snapshot,get calls(){return calls;},get watches(){return watches;},
  changeUser:()=>generation++,finish:value=>finish(value),fail:error=>fail(error),watchError:error=>watchError(error),
  run:options=>ctx.onAuthChangedProfile({uid:'fixture'},state=>states.push(state),generation,()=>generation,()=>{},options)};
}
test('one delayed profile read restores online access without polling or another read',async()=>{
 const f=fixture();await f.run();assert.equal(f.states.at(-1).offline,true);
 f.finish(f.snapshot());await tick();await tick();
 assert.equal(f.calls,1);assert.equal(f.states.at(-1).offline,false);assert.equal(f.states.at(-1).status,'signed-in');
 assert.equal(f.ctx.operationalBackend.snapshot().code,'');
});
test('late revocation, missing profile and invalid UID never preserve cached authorization',async()=>{
 for(const kind of ['revoked','missing','mismatch','denied']){
  const f=fixture();await f.run();
  if(kind==='denied')f.fail({code:'permission-denied'});
  else f.finish(kind==='missing'?{exists:()=>false}:f.snapshot(kind==='mismatch'?{uid:'another'}:{active:false}));
  await tick();await tick();
  assert.notEqual(f.states.at(-1).status,'signed-in');
 }
});
test('a delayed profile from the previous identity is discarded',async()=>{
 const f=fixture();await f.run();const count=f.states.length;f.changeUser();f.finish(f.snapshot());await tick();await tick();
 assert.equal(f.states.length,count);
});
test('terminal Watch failure confirms REST once and never reattaches a failing listener',async()=>{
 const f=fixture({slow:false});await f.run();await tick();assert.equal(f.watches,1);
 f.watchError({code:'unavailable'});await tick();await tick();
 assert.equal(f.calls,2);assert.equal(f.watches,1);assert.equal(f.states.at(-1).offline,false);
});
test('quota failure does not create a REST retry',async()=>{
 const f=fixture({slow:false});await f.run();await tick();f.watchError({code:'resource-exhausted'});await tick();await tick();
 assert.equal(f.calls,1);assert.equal(f.states.at(-1).offline,true);
});
