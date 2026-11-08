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
test('FA no longer exposes an installer or executable scoring job',()=>{
 const {context,triggers,documents}=harness();
 for(const name of ['instalarDesempenhoFaV1','iniciarDesempenhoFaV1','executarDesempenhoFaV1'])
  assert.equal(typeof context[name],'undefined',name);
 assert.equal(triggers.length,1);
 assert.equal(documents.size,0);
});
test('preserved helpers cannot write to profiles or FB awards',()=>{
 const {context}=harness();
 assert.throws(()=>context.faPerformanceWrite_('users','a',{}),/SCOPE/);
 assert.throws(()=>context.faPerformanceWrite_('fbPerformanceAwards','a',{}),/SCOPE/);
});
test('FA own lease excludes concurrent FA cycles without acquiring central script or read-budget locks',()=>{
 const h=harness(),c=h.context;c.LockService.getUserLock=()=>{throw Error('CENTRAL_READ_LOCK_MUST_NOT_BE_USED');};
 const lease=c.faPerformanceAcquire_();assert.throws(()=>c.faPerformanceAcquire_(),/FA_BUSY/);c.faPerformanceRelease_(lease);assert.ok(c.faPerformanceAcquire_());assert.doesNotMatch(source(),/LockService\./);
});
