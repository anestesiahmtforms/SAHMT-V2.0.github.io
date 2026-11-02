import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {projectFaPerformance} from '../fa-performance/domain.js';
const source=()=>readFileSync('apps-script-v2/FaPerformance.gs','utf8');
function harness(){
 const documents=new Map(),triggers=[{getHandlerFunction:()=> 'existingOperationalHandler'}],log=[];
 const context={console:{log:x=>log.push(JSON.parse(x))},Date,Session:{getEffectiveUser:()=>({getEmail:()=> 'anestesiahmtforms@gmail.com'})},ScriptApp:{getScriptId:()=> '1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD',getProjectTriggers:()=>triggers,newTrigger:name=>({timeBased:()=>({everyMinutes:n=>({create:()=>{assert.equal(n,15);triggers.push({getHandlerFunction:()=>name});}})})})},PropertiesService:{getScriptProperties:()=>({setProperty:()=>{}})},LockService:{getScriptLock:()=>({tryLock:()=>false,releaseLock:()=>{}}),getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})}};
 let sequence=0;context.Utilities={getUuid:()=> 'lease'+(++sequence)};
 vm.createContext(context);vm.runInContext(source(),context);
 context.faPerformanceHttp_=(suffix,body)=>{if(!body)return documents.get(suffix)||null;for(const w of body.writes){const path='/'+w.update.name.split('/documents/')[1];if(w.currentDocument?.exists===false&&documents.has(path))throw Error('ALREADY_EXISTS');if(w.currentDocument?.updateTime&&w.currentDocument.updateTime!==documents.get(path)?.updateTime)throw Error('FA_FIRESTORE_HTTP_409');documents.set(path,{...w.update,updateTime:'revision'+(++sequence)});}return {};};
 return {context,documents,triggers,log};
}
test('FA activation immutable and installs only own periodic trigger without moving central script',()=>{
 const h=harness();h.context.instalarDesempenhoFaV1();const first=JSON.stringify(h.documents.get('/faPerformanceRuntime/current'));h.context.instalarDesempenhoFaV1();assert.equal(JSON.stringify(h.documents.get('/faPerformanceRuntime/current')),first);assert.equal(h.triggers.length,2);assert.equal(h.triggers[0].getHandlerFunction(),'existingOperationalHandler');assert.doesNotMatch(source(),/DriveApp|moveTo|deleteTrigger/);
});
test('FA writes and queries are scoped, and publication is pending before batches',()=>{
 const h=harness();assert.throws(()=>h.context.faPerformanceWrite_('users','a',{}),/SCOPE/);assert.throws(()=>h.context.faPerformanceWrite_('fbPerformanceAwards','a',{}),/SCOPE/);
 const s=source();assert.match(s,/sahmtUrlFetchRun_/);assert.match(s,/readTime/);assert.match(s,/FA_INPUT_INCOMPLETE/);assert.ok(s.indexOf("status:'PENDING'")<s.indexOf('offset=0'));assert.ok(s.indexOf("status:'CONFIRMED'")>s.indexOf('offset=0'));
});
test('FA partial publication retries keep audit deltas atomic and do not duplicate deductions',()=>{
 const h=harness(),c=h.context,start=Date.parse('2026-11-02T10:00:00Z');c.instalarDesempenhoFaV1();
 h.documents.set('/faPerformanceRuntime/current',{fields:c.faPerformanceEncodeFields_({schemaVersion:1,projectId:'sahmt-17a16',mode:'FA_ONLY',enabled:true,effectiveFrom:new Date(start).toISOString(),automaticExternalSync:false})});
 c.FaPerformanceDomain={projectFaPerformance};
 c.faPerformanceRead_=(collection,max,snapshot)=>{snapshot.readTime='2026-11-02T11:00:00Z';
  if(collection==='users')return [{id:'a',uid:'a',sigla:'AA',displayName:'A',active:true,access:true}];
  if(collection==='events')return Array.from({length:152},(_,i)=>({id:'event'+i,eventType:'atraso',delayMultiple:0,memberSigla:'AA',date:'2026-11-02',active:true,createdAt:start+1,documentCreatedAt:start+1}));
  if(collection==='faPerformanceAwards')return [...h.documents.entries()].filter(([k])=>k.startsWith('/faPerformanceAwards/')).map(([,v])=>c.faPerformanceFields_(v.fields));return [];
 };
 const http=c.faPerformanceHttp_;let commits=0;
 c.faPerformanceHttp_=(path,body)=>{if(path===':commit'&&body.writes.some(w=>!w.update.name.endsWith('/lease'))&&++commits===3)throw Error('INTERRUPTED');return http(path,body);};
 assert.throws(()=>c.executarDesempenhoFaV1(),/INTERRUPTED/);assert.equal(c.faPerformanceFields_(h.documents.get('/faPerformanceReference/team').fields).status,'PENDING');
 c.faPerformanceHttp_=http;c.executarDesempenhoFaV1();
 assert.equal(c.faPerformanceFields_(h.documents.get('/faPerformanceSummaries/a').fields).total,-76);
 assert.equal([...h.documents.keys()].filter(k=>k.startsWith('/faPerformanceLedger/')).length,152);
 c.executarDesempenhoFaV1();assert.equal([...h.documents.keys()].filter(k=>k.startsWith('/faPerformanceLedger/')).length,152);
 assert.equal(c.faPerformanceFields_(h.documents.get('/faPerformanceReference/team').fields).status,'CONFIRMED');
});
test('FA own lease excludes concurrent FA cycles without acquiring central script or read-budget locks',()=>{
 const h=harness(),c=h.context;c.LockService.getUserLock=()=>{throw Error('CENTRAL_READ_LOCK_MUST_NOT_BE_USED');};
 const lease=c.faPerformanceAcquire_();assert.throws(()=>c.faPerformanceAcquire_(),/FA_BUSY/);c.faPerformanceRelease_(lease);assert.ok(c.faPerformanceAcquire_());assert.doesNotMatch(source(),/LockService\./);
});
