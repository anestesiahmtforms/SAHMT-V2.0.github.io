import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const quota=readFileSync(new URL('../apps-script-v2/ServiceQuota.gs',import.meta.url),'utf8');
const safety=readFileSync(new URL('../apps-script-v2/ReadSafety.gs',import.meta.url),'utf8');
function fixture(){
 let now=100000000,fetches=0,propertyReads=0,owner=true;
 const props=new Map(),cache=new Map(),logs=[];
 const c=vm.createContext({Date:{now:()=>now},console:{warn:x=>logs.push(JSON.parse(x)),log:x=>logs.push(JSON.parse(x))},
  PropertiesService:{getUserProperties:()=>({getProperty:k=>{propertyReads++;return props.get(k)||null;},setProperty:(k,v)=>props.set(k,v)})},
  CacheService:{getUserCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
  UrlFetchApp:{fetch:()=>{fetches++;return {getResponseCode:()=>200};}}
 });
 vm.runInContext(quota+'\n'+safety,c);
 return {c,props,cache,logs,setNow:v=>{now=v;},denyOwner:()=>{owner=false;},counts:()=>({fetches,propertyReads})};
}
test('one daily quota failure pauses subsequent FB requests before network and resumes on demand after one hour',()=>{
 const f=fixture();let calls=0;
 const request=()=>f.c.faBackgroundReadFetchV1_('https://firestore.googleapis.com/v1/projects/sahmt-gestao-5ae66/databases/(default)/documents:batchGet',{method:'post'},()=>{calls++;throw Error('Service invoked too many times for one day: urlfetch.');});
 assert.throws(request,e=>e.code==='SAHMT_URLFETCH_DAILY_QUOTA'&&e.service==='urlfetch'&&e.status===429);
 for(let n=0;n<10;n++)assert.throws(request,e=>e.code==='SAHMT_URLFETCH_DAILY_QUOTA');
 assert.equal(calls,1);assert.equal(f.logs.length,1);assert.deepEqual(Object.keys(f.logs[0]).sort(),['code','retryAfter']);
 f.setNow(103600001);
 const result=f.c.faBackgroundReadFetchV1_('https://firestore.googleapis.com/v1/projects/sahmt-gestao-5ae66/databases/(default)/documents:batchGet',{method:'post'},()=>{calls++;return 'OK';});
 assert.equal(result,'OK');assert.equal(calls,2);
});
test('permission and transient errors preserve the original error and never create a daily pause',()=>{
 const f=fixture();
 for(const original of [Object.assign(Error('forbidden'),{status:403}),Error('Service invoked too many times in a short time: urlfetch.'),Error('Service invoked too many times for one day: properties.'),Object.assign(Error('quota'),{status:429})]){
  assert.throws(()=>f.c.sahmtUrlFetchRun_(()=>{throw original;}),e=>e===original);
 }
 assert.equal(f.props.size,0);assert.equal(f.logs.length,0);
});
test('healthy requests share a short cache sentinel instead of spending a Properties read per request',()=>{
 const f=fixture();for(let n=0;n<100;n++)assert.equal(f.c.sahmtUrlFetchRun_(()=>n),n);
 assert.equal(f.counts().propertyReads,1);assert.equal(f.props.size,0);
});
test('native background wrapper preserves work as pending when the executor quota is exhausted',()=>{
 const f=fixture();const result=f.c.faBackgroundReadRunV1_('job',()=>f.c.sahmtUrlFetchRun_(()=>{throw Error('Serviço chamado muitas vezes no mesmo dia: urlfetch.');}));
 assert.equal(result.pending,true);assert.equal(result.code,'SAHMT_URLFETCH_DAILY_QUOTA');assert.equal(result.handler,'job');
 assert.equal(f.c.SAHMT_BACKGROUND_READ_CONTEXT_V1,null);
});
