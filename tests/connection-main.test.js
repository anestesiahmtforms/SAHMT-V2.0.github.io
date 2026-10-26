import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {createConnectionLifecycle} from '../src/connection-lifecycle.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const connectionRecovery=createConnectionLifecycle('),source.indexOf('function refreshLivePending()')).replace("await import('./google-project-auth-runtime.js')",'fakeRuntime');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const events=new Map(),scopes=new Map(['events','labels','checklist'].map(kind=>[kind,{kind,key:kind+'-today',uid:'one',warm:false}])),closed=[],opened=[],refreshes=[],calls=[];
 let forced=false;const ctx=vm.createContext({createConnectionLifecycle,session:{status:'signed-in',user:{uid:'one'},offline:false},
  operationalBackend:{snapshot:()=>({code:'',nextRetryAt:0}),noteFailure(){},interruptReads(){}},isOfflineRuntimeForced:()=>forced,setOfflineRuntimeMode:value=>forced=value,onlineValidationRequired:false,
  document:{hidden:false,addEventListener:(name,fn)=>events.set(name,fn)},window:{addEventListener:(name,fn)=>events.set(name,fn)},navigator:{onLine:true},
  fakeRuntime:{maintainGoogleProjectSessions:async()=>{calls.push('auth');return {status:'ready'};}},
  revalidateOnlineSession:async()=>{calls.push('profile');forced=false;ctx.onlineValidationRequired=false;ctx.session.offline=false;},
  cleanupCurrentModule:{suspend:()=>calls.push('suspend'),resume:()=>calls.push('resume'),setOnline:()=>{}},suspendedReportScopes:[],reportStates:new Map(),
  liveReports:{get:kind=>scopes.has(kind)?{snapshot:()=>({scope:scopes.get(kind),state:'server'})}:null,setOnline:()=>{},close:(kind,reason)=>{closed.push([kind,reason]);scopes.delete(kind);},open:(kind,scope)=>{opened.push(kind);scopes.set(kind,scope);},refresh:kind=>refreshes.push(kind)},
  closeReportLive:(kind,reason)=>{closed.push([kind,reason]);scopes.delete(kind);},reportScopeCurrent:scope=>scope.uid===ctx.session.user.uid,
  syncOutbox(){},updateOutboxStatus(){},currentRoute:()=> 'checklist',shouldRenderHashChange:()=>true,render(){},updateReportSync(){},startupReports:{clear(){}},invalidateChecklistSignature(){}
 });vm.runInContext(code,ctx);
 return {ctx,events,closed,opened,refreshes,calls,show:async()=>{ctx.document.hidden=false;events.get('visibilitychange')();await tick();await tick();},hide:()=>{ctx.document.hidden=true;events.get('visibilitychange')();}};
}
test('all three open operational reports survive suspend/resume with a single replacement each',async()=>{
 const h=fixture();h.hide();assert.deepEqual(h.closed.map(([kind])=>kind),['events','labels','checklist']);await h.show();
 assert.deepEqual(h.opened,['events','labels','checklist']);assert.deepEqual(h.refreshes,[]);
 h.events.get('pageshow')();await tick();assert.equal(h.opened.length,3);assert.equal(h.calls.filter(value=>value==='profile').length,0);
});
test('real offline/online cycle restores Checklist even if its cached profile did not change',async()=>{
 const h=fixture();h.events.get('offline')();assert.deepEqual(h.closed,[['checklist','offline']]);
 h.events.get('online')();await tick();await tick();
 assert.deepEqual(h.opened,['checklist']);assert.equal(h.calls.filter(value=>value==='profile').length,1);assert.equal(h.ctx.onlineValidationRequired,false);
});
test('repeated suspension and pagehide preserve the reports needed on return from FB',async()=>{
 const h=fixture();h.hide();h.hide();h.events.get('pagehide')?.({persisted:true});await h.show();
 assert.deepEqual(h.opened,['events','labels','checklist']);assert.equal(h.closed.length,3);
 assert.equal(h.calls.filter(value=>value==='suspend').length,1);
});
test('returning after the route or identity changed never reopens the old reports',async()=>{
 const h=fixture();h.hide();h.ctx.session.user.uid='two';await h.show();assert.deepEqual(h.opened,[]);
});
test('profile confirmation does not wait for an interrupted outbox flush to resume navigation',async()=>{
 const code=source.slice(source.indexOf('async function revalidateOnlineSession()'),source.indexOf('function bindLogin()')).replace("import('./operational-sheet-delivery.js')",'Promise.resolve({flushOperationalSheetDelivery(){}})');
 const calls=[],ctx=vm.createContext({navigator:{onLine:true},session:{status:'signed-in',offline:false,user:{uid:'one'},profile:{active:true,access:true}},
  operationalBackend:{snapshot:()=>({code:'',nextRetryAt:0}),reset(){}},deniedOperationalModules:new Set(),retryAuthenticatedProfile:async()=>true,
  onlineValidationRequired:true,backendFailureDisplayed:true,setOfflineRuntimeMode:value=>calls.push(['offline',value]),liveReports:{get(){}},refreshAppFeatures(){},
  syncOutbox:()=>{calls.push(['outbox']);return new Promise(()=>{});}});
 vm.runInContext(code,ctx);assert.equal(await Promise.race([ctx.revalidateOnlineSession(),tick().then(()=> 'blocked')]),true);
 assert.equal(ctx.onlineValidationRequired,false);assert.deepEqual(calls,[['offline',false],['outbox']]);
});
test('a cached page return also reconnects when visibilitychange was not delivered',async()=>{
 const h=fixture();h.events.get('pagehide')?.({persisted:true});h.events.get('pageshow')({persisted:true});await tick();await tick();
 assert.deepEqual(h.opened,['events','labels','checklist']);assert.equal(h.closed.length,3);
});
