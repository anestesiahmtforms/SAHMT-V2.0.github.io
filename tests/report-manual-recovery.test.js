import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const begin=source.indexOf('function retryLiveReport(');
function fixture(kind='checklist'){
 let scope={kind,key:kind+'-2026-10-26',uid:'one',localOnly:true},recoverResult=true,forced=true;
 const calls=[];
 const ctx=vm.createContext({Map,Promise,navigator:{onLine:true},reportRefreshFlights:new Map(),
  reportScopeCurrent:value=>value.uid==='one',
  liveReports:{get:()=>({snapshot:()=>({scope,state:'error'})}),setOnline:value=>calls.push(['online',value]),
   open:(kind,value,options)=>{calls.push(['open',kind,value.localOnly,options.force]);scope=value;}},
  connectionRecovery:{recover:async reason=>{calls.push(['recover',reason]);if(recoverResult)forced=false;return recoverResult;}},
 });
 if(begin>=0)vm.runInContext(source.slice(begin,source.indexOf('function settleReportWaiter(',begin)),ctx);
 return {ctx,calls,scope:()=>scope,deny:()=>recoverResult=false,changeUser:()=>scope={...scope,uid:'two'}};
}
for(const kind of ['events','labels','checklist'])test(kind+': manual refresh restores the connection before a server subscription',async()=>{
 const h=fixture(kind);assert.equal(typeof h.ctx.retryLiveReport,'function');
 assert.equal(await h.ctx.retryLiveReport(kind),true);
 assert.deepEqual(h.calls,[['recover','manual'],['online',true],['open',kind,false,true]]);
});
test('failed recovery or quota backoff does not launch another server query',async()=>{
 const h=fixture();assert.equal(typeof h.ctx.retryLiveReport,'function');h.deny();
 assert.equal(await h.ctx.retryLiveReport('checklist'),false);assert.deepEqual(h.calls,[['recover','manual']]);
});
test('offline refresh reads local data without attempting online recovery',async()=>{
 const h=fixture();assert.equal(typeof h.ctx.retryLiveReport,'function');h.ctx.navigator.onLine=false;
 assert.equal(await h.ctx.retryLiveReport('checklist'),true);assert.deepEqual(h.calls,[['open','checklist',true,true]]);
});
test('both checklist refresh controls use the connection recovery action',()=>{
 assert.match(source,/retry\.onclick = \(\) => retryLiveReport\(kind\)/);
 const start=source.indexOf('reportRefresh.onclick =');
 assert.match(source.slice(start,source.indexOf("document.querySelector('.checklist-report-periods')",start)),/retryLiveReport\('checklist'\)/);
});
test('repeated taps share one connection recovery and one remote subscription',async()=>{
 const h=fixture();let release;
 h.ctx.connectionRecovery.recover=()=>new Promise(resolve=>release=resolve);
 const first=h.ctx.retryLiveReport('checklist'),second=h.ctx.retryLiveReport('checklist');assert.equal(first,second);
 release(true);assert.equal(await first,true);assert.deepEqual(h.calls,[['online',true],['open','checklist',false,true]]);
});
test('a user change during recovery cannot reopen the previous report',async()=>{
 const h=fixture();let release;h.ctx.connectionRecovery.recover=()=>new Promise(resolve=>release=resolve);
 const pending=h.ctx.retryLiveReport('checklist');h.changeUser();release(true);
 assert.equal(await pending,false);assert.deepEqual(h.calls,[]);
});
test('a report already reopened by recovery is not queried twice',async()=>{
 const h=fixture();const original=h.scope();
 h.ctx.liveReports.get=()=>({snapshot:()=>({scope:original})});
 h.ctx.connectionRecovery.recover=async()=>{h.ctx.liveReports.get=()=>({snapshot:()=>({scope:{...original,localOnly:false}})});return true;};
 assert.equal(await h.ctx.retryLiveReport('checklist'),true);assert.deepEqual(h.calls,[]);
});
