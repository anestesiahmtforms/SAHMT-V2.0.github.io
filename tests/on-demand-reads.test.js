import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('abrir a sessão não inicia listeners dos três módulos sem ação do usuário',()=>{
 const start=source.indexOf('function preloadStartupReports('),end=source.indexOf('\n}',start)+2;
 assert.ok(start>=0&&end>start);
 let reads=0;
 const ctx=vm.createContext({runtimeProject:{target:'FA'},navigator:{onLine:true},session:{status:'signed-in',offline:false},
  reportAllowed:()=>true,makeReportScope:kind=>({key:kind}),liveReports:{warm:()=>{reads++;return()=>{};}},
  startupReports:{holdLive:()=>{},clear:()=>{}},window:{setTimeout:()=>{}}});
 vm.runInContext(source.slice(start,end),ctx);ctx.preloadStartupReports({uid:'synthetic'});assert.equal(reads,0);
 ctx.preloadStartupReports({uid:'synthetic'},{explicit:true});assert.equal(reads,2);
});
test('entrada não agenda pré-carregamento ocioso dos módulos operacionais',()=>{
 assert.doesNotMatch(source,/preloadOperationalDataWhenIdle/);
 assert.match(source,/if\(currentRoute\(\)==='home'\)await loadHome\(\);else await loadSchedule\(\)/);
 assert.doesNotMatch(source,/prepareOfflineEssentials/);
});
