import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/router.js',import.meta.url),'utf8');
function fixture(){
 let finish;const checking=new Promise(resolve=>finish=resolve),assignments=[],returns=[];
 const ctx=vm.createContext({deployment:{target:'FA',externalManagementEnabled:true,fbBase:'/gestao/'},
  location:{hash:'#/home',assign:url=>assignments.push(url)},
  rememberModuleNavigation(){},rememberManagementReturn:hash=>returns.push(hash),repairAppFiles:()=>false,staleModuleFailure:()=>false,
  loadSession:async()=>({ensureManagementSession:()=>checking})});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export ','').replace("import('./management-entry-session.js')",'loadSession()'),ctx);
 return {navigate:(...args)=>ctx.navigate(...args),ctx,finish,assignments,returns};
}

test('an older FB entry cannot redirect after a newer local navigation',async()=>{
 const h=fixture(),old=h.navigate('management');await Promise.resolve();await h.navigate('events');h.finish(true);await old;
 assert.equal(h.ctx.location.hash,'#/events');assert.deepEqual(h.assignments,[]);
});

test('an older failed FB entry cannot replace a newer page with Synchronization',async()=>{
 const h=fixture(),old=h.navigate('training');await Promise.resolve();await h.navigate('checklist');h.finish(false);await old;
 assert.equal(h.ctx.location.hash,'#/checklist');assert.deepEqual(h.returns,[]);
});

test('only the most recent management selection redirects to FB',async()=>{
 const h=fixture(),first=h.navigate('management'),second=h.navigate('training');h.finish(true);await Promise.all([first,second]);
 assert.deepEqual(h.assignments,['/gestao/#/training']);
});
