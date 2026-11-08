import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {prepareEvaluationReadCache} from '../scripts/lib/prepare-evaluation-read-cache.js';
const source=readFileSync(new URL('../apps-script-v2/EvaluationLedger.gs',import.meta.url),'utf8');
function fixture(){
  const ctx=vm.createContext({console});vm.runInContext(source,ctx);
  let reads=0,commits=0,retry=false,fail=false,project='fa',generation=0;
  ctx.evaluationProject_=()=>project;ctx.evaluationCollectionProject_=()=>project;
  ctx.evaluationIndependentFaSource_=()=>true;ctx.evaluationDocumentsUrl_=(path,p)=>p+path;
  ctx.evaluationReadTransaction_=t=>t;ctx.evaluationGetProjected_=()=>{reads++;return {value:reads}};
  ctx.evaluationDocument_=d=>({value:d.fields.value.integerValue,nested:{value:1},date:new Date('2026-11-08T00:00:00Z')});
  ctx.firestoreRequest_=(url,options)=>{
    if(url.endsWith(':beginTransaction'))return {transaction:'tx'+(++generation)};
    if(url.endsWith(':rollback'))return {};
    if(url.endsWith(':commit')){commits++;if(retry&&commits===1)throw Object.assign(Error('conflict'),{status:409});return {}};
    reads++;if(fail){fail=false;throw Error('network')};
    const body=JSON.parse(options.payload);
    return body.documents[0].endsWith('/missing')?[{missing:body.documents[0]}]:[{found:{name:body.documents[0],fields:{value:{integerValue:generation}}}}];
  };
  const run=fn=>ctx.evaluationRunTransaction_(t=>({writes:[],result:fn(t)}));
  return {ctx,run,get reads(){return reads},set retry(x){retry=x},set fail(x){fail=x},set project(x){project=x},contexts:()=>vm.runInContext('SAHMT_EVALUATION_TRANSACTIONS.size',ctx)};
}
test('repeated reads share one transaction snapshot without sharing mutable values',()=>{
 const f=fixture();f.run(t=>{const a=f.ctx.evaluationGet_('users','one',t);a.nested.value=9;a.date.setFullYear(2000);const b=f.ctx.evaluationGet_('users','one',t);assert.equal(b.nested.value,1);assert.equal(b.date.getFullYear(),2026)});assert.equal(f.reads,1);assert.equal(f.contexts(),0);
});
test('field masks, projects, and documents remain distinct',()=>{
 const f=fixture();f.run(t=>{f.ctx.evaluationGet_('users','one',t,['active']);f.ctx.evaluationGet_('users','one',t,['access']);f.ctx.evaluationGet_('users','two',t,['access']);f.project='fb';f.ctx.evaluationGet_('users','one',t,['active'])});assert.equal(f.reads,4);
});
test('missing documents are cached only within the transaction',()=>{
 const f=fixture();for(let i=0;i<2;i++)f.run(t=>{assert.equal(f.ctx.evaluationGet_('users','missing',t),null);assert.equal(f.ctx.evaluationGet_('users','missing',t),null)});assert.equal(f.reads,2);
});
test('transaction retries discard prior cached snapshots',()=>{
 const f=fixture();f.retry=true;const values=[];f.run(t=>{values.push(f.ctx.evaluationGet_('users','one',t).value);f.ctx.evaluationGet_('users','one',t)});assert.deepEqual(values,[1,2]);assert.equal(f.reads,2);assert.equal(f.contexts(),0);
});
test('errors are never cached and cleanup survives callback failures',()=>{
 const f=fixture();f.fail=true;f.run(t=>{assert.throws(()=>f.ctx.evaluationGet_('users','one',t),/network/);f.ctx.evaluationGet_('users','one',t)});assert.equal(f.reads,2);assert.throws(()=>f.run(()=>{throw Error('callback')}),/callback/);assert.equal(f.contexts(),0);
});
test('reads outside managed transactions always reach the underlying reader',()=>{
 const f=fixture();f.ctx.evaluationGet_('users','one');f.ctx.evaluationGet_('users','one');f.ctx.evaluationGet_('users','one','unknown');f.ctx.evaluationGet_('users','one','unknown');assert.equal(f.reads,4);
});
test('patch is idempotent and refuses an unrecognized source',()=>{
 assert.equal(prepareEvaluationReadCache(source),source);assert.throws(()=>prepareEvaluationReadCache('unrecognized'),/SOURCE_DRIFT/);
});
