import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const code=await readFile(new URL('../apps-script-v2/QmentumQuarterly.gs',import.meta.url),'utf8');
function fixture({stale=false,missing=false,fail=false}={}){
 const calls=[];
 const context={firestoreDocumentsUrl_:suffix=>suffix,firestoreRequest_:(suffix,options)=>{
  const body=JSON.parse(options.payload);calls.push({suffix,body});assert.equal(options.method,'post');
  if(suffix===':beginTransaction')return {transaction:'synthetic-transaction'};
  if(suffix===':batchGet'){assert.deepEqual(body.mask,{fieldPaths:['schemaVersion']});return missing?[{missing:'profile'}]:[{found:{name:'profile',updateTime:stale?'changed':'t1'}}];}
  if(suffix===':commit'){assert.ok(body.writes.every(w=>!('verify' in w)));if(fail)throw Error('synthetic transport error');return {writeResults:[]};}
  if(suffix===':rollback')return {};
  throw Error('unexpected endpoint');
 }};vm.createContext(context);vm.runInContext(code,context);return {calls,commit:context.qmServerCommit_};
}
test('REST adapter converts internal guards into transaction reads, never invalid verify writes',()=>{
 const f=fixture();f.commit([{verify:'profile',currentDocument:{updateTime:'t1'}},{update:{name:'month',fields:{}},currentDocument:{exists:false}}]);
 assert.deepEqual(f.calls.map(c=>c.suffix),[':beginTransaction',':batchGet',':commit']);
 assert.equal(f.calls[2].body.transaction,'synthetic-transaction');assert.equal(f.calls[2].body.writes.length,1);
});
test('stale guards roll back without sending writes',()=>{const f=fixture({stale:true});assert.throws(()=>f.commit([{verify:'profile',currentDocument:{updateTime:'t1'}}]),/QMENTUM_VERSION_CONFLICT/);assert.deepEqual(f.calls.map(c=>c.suffix),[':beginTransaction',':batchGet',':rollback']);});
test('verification-only transactions and absent-document guards use valid REST shapes',()=>{const f=fixture({missing:true});f.commit([{verify:'profile',currentDocument:{exists:false}}]);assert.deepEqual(f.calls[2].body.writes,[]);});
test('commit failure rolls back and is not retried',()=>{const f=fixture({fail:true});assert.throws(()=>f.commit([{verify:'profile',currentDocument:{exists:true}}]),/synthetic transport error/);assert.equal(f.calls.filter(c=>c.suffix===':commit').length,1);assert.equal(f.calls.at(-1).suffix,':rollback');});
test('unguarded writes use ordinary commit and malformed guards fail before network',()=>{const f=fixture();f.commit([{update:{name:'month',fields:{}}}]);assert.deepEqual(f.calls.map(c=>c.suffix),[':commit']);assert.throws(()=>f.commit([{verify:'profile'}]),/QMENTUM_PRECONDITION_INVALID/);assert.equal(f.calls.length,1);});
