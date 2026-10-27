import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const statusCode=main.slice(main.indexOf('async function updateOutboxStatus()'),main.indexOf('function bindProfileRetryControl('));
const reportCode=main.slice(main.indexOf('function updateReportSync(kind)'),main.indexOf('function closeReportLive('));

test('local storage failure leaves a visible, clickable sync status without claiming confirmation',async()=>{
  const actions=new Map(),target={innerHTML:'',isConnected:true,querySelector:()=>({addEventListener:(name,fn)=>actions.set(name,fn)})};
  const routes=[],updates=[],error=Object.assign(new Error('synthetic private detail'),{code:'storage-timeout'});
  const ctx=vm.createContext({document:{querySelector:()=>target},syncNoticeSequence:0,
    session:{status:'signed-in',user:{uid:'fixture'}},pendingSyncBanner:{update:value=>updates.push(value)},
    listPendingTrainingProgress:async()=>{throw error;},retryableFailedOperationCount:async()=>0,listOperationalDrafts:async()=>[],listUnsettledOperations:async()=>[],
    navigate:route=>routes.push(route)});
  vm.runInContext(statusCode,ctx);await ctx.updateOutboxStatus();
  assert.match(target.innerHTML,/storage-timeout/);assert.match(target.innerHTML,/outbox-open/);
  assert.doesNotMatch(target.innerHTML,/synthetic private detail|Sincronizado|sync-status-button--synced/);
  assert.equal(updates[0].unavailable,true);actions.get('click')();assert.deepEqual(routes,['offline']);
});

test('failed report identifies the safe error code without displaying raw error messages',()=>{
  const node={classList:{toggle(){}},textContent:''};
  const ctx=vm.createContext({reportStates:new Map([['labels',{scope:{},state:'error',confirmed:false,error:{code:'deadline-exceeded',message:'private response'}}]]),
    reportScopeCurrent:()=>true,reportPayloads:new Map(),isOfflineRuntimeForced:()=>false,document:{querySelector:()=>node}});
  vm.runInContext(reportCode,ctx);ctx.updateReportSync('labels');
  assert.equal(node.textContent,'Falha de atualização · deadline-exceeded');
  assert.doesNotMatch(node.textContent,/private response/);
});

test('a cached profile being checked online is presented as verifying rather than offline or synced',async()=>{
 const target={innerHTML:'',isConnected:true,querySelector:()=>null};
 const ctx=vm.createContext({document:{querySelector:()=>target},syncNoticeSequence:0,
  session:{status:'signed-in',user:{uid:'fixture'},offline:true,validatingProfile:true},pendingSyncBanner:{update(){}},
  listPendingTrainingProgress:async()=>[],retryableFailedOperationCount:async()=>0,listOperationalDrafts:async()=>[],listUnsettledOperations:async()=>[],
  operationalBackend:{snapshot:()=>({code:''})},navigator:{onLine:true},isOfflineRuntimeForced:()=>true,
  escapeHtml:String,updateLabelReportSync(){},bindProfileRetryControl(){}});
 vm.runInContext(statusCode,ctx);await ctx.updateOutboxStatus();
 assert.match(target.innerHTML,/VERIFICANDO CONEXÃO/);
 assert.doesNotMatch(target.innerHTML,/OFFLINE|ONLINE — SINCRONIZADO|sync-status-button--synced/);
});
