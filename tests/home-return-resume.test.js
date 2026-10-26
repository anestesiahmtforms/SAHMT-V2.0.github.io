import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function loadHome()'),source.indexOf('function showScheduleContacts(')).replace("import('./data-lite.js')",'Promise.resolve(data)');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 let reads=0;const content={innerHTML:'',isConnected:true,querySelectorAll:()=>[]},date={value:'',isConnected:true,addEventListener(){}},buttons={addEventListener(){}};
 const ctx=vm.createContext({session:{user:{uid:'one'}},cleanupCurrentModule:null,Date,Map,Promise,globalThis:{},
  navigator:{onLine:true},isOfflineRuntimeForced:()=>false,document:{querySelector:id=>id==='#schedule-content'?content:id==='#schedule-date'?date:buttons},localDateKey:()=> '2026-10-26',
  readCachedSchedule:async()=>null,can:()=>true,buildScheduleView:()=>({positions:[]}),fitSchedulePositionGrid(){},
  data:{readSchedule:()=>++reads===1?new Promise(()=>{}):Promise.resolve({id:'2026-10-26'}),listActiveContacts:async()=>[],listVacationsForDate:async()=>[]}});
 vm.runInContext(code,ctx);return {ctx,content,date,reads:()=>reads};
}
test('Home restarts a suspended schedule read on return from FB without restarting the app',async()=>{
 const h=fixture();await h.ctx.loadHome();await tick();assert.equal(h.reads(),1);assert.match(h.content.innerHTML,/Carregando/);
 assert.equal(typeof h.ctx.cleanupCurrentModule?.resume,'function');
 h.date.value='2026-10-25';h.ctx.cleanupCurrentModule.suspend();h.ctx.cleanupCurrentModule.resume();await tick();await tick();
 assert.equal(h.reads(),2);assert.doesNotMatch(h.content.innerHTML,/Carregando/);assert.equal(h.date.value,'2026-10-25');
 h.ctx.cleanupCurrentModule.resume();await tick();assert.equal(h.reads(),2);
});
test('a disposed Home cannot restart reads after navigation to another module',async()=>{
 const h=fixture();await h.ctx.loadHome();await tick();const lifecycle=h.ctx.cleanupCurrentModule;
 assert.equal(typeof lifecycle,'function');lifecycle.suspend();lifecycle();lifecycle.resume();await tick();assert.equal(h.reads(),1);
});

test('Home remains navigable from cache on offline return and refreshes again when online',async()=>{
 const h=fixture();await h.ctx.loadHome();await tick();const lifecycle=h.ctx.cleanupCurrentModule;
 assert.equal(typeof lifecycle?.resumeLocal,'function');lifecycle.suspend();h.ctx.navigator.onLine=false;h.ctx.readCachedSchedule=async()=>({id:'cached'});
 lifecycle.resumeLocal();await tick();await tick();assert.equal(h.reads(),1);assert.doesNotMatch(h.content.innerHTML,/Carregando/);
 h.ctx.navigator.onLine=true;lifecycle.resume();await tick();assert.equal(h.reads(),2);
});

test('online local resume renders cache without waiting for server recovery or starting server reads',async()=>{
 const h=fixture();await h.ctx.loadHome();await tick();h.ctx.readCachedSchedule=async()=>({id:'cached'});
 const lifecycle=h.ctx.cleanupCurrentModule;lifecycle.suspend();lifecycle.resumeLocal();await tick();
 assert.equal(h.reads(),1);assert.doesNotMatch(h.content.innerHTML,/Carregando/);
});
