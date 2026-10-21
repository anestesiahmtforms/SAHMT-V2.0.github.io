import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/auth.js',import.meta.url),'utf8');
const slice=source.slice(source.indexOf('async function showCachedSession('),source.indexOf('export function watchSession(')).replace(/import\((['"][^'"]+['"])\)/g,'fakeImport($1)');
function harness({denied=false,current=()=>true}={}){
 const states=[];const profile={uid:'member',active:true,access:true,permissions:{checklistRead:true}};
 const ctx=vm.createContext({navigator:{onLine:true},readCachedProfile:async()=>null,profileForPresentation:value=>value,
 fakeImport:async()=>({recoverRemoteContinuity:async()=>{if(denied)throw Object.assign(Error('denied'),{code:'CONTINUITY_ACCESS_DENIED'});return {profile};}})});
 vm.runInContext(slice,ctx);
 return {states,run:()=>ctx.showCachedSession({uid:'member'},state=>states.push(state),current)};
}
test('sem cache local e com quota esgotada recupera perfil remoto autenticado',async()=>{
 const h=harness();await h.run();assert.equal(h.states.at(-1).status,'signed-in');assert.equal(h.states.at(-1).continuity,true);assert.equal(h.states.at(-1).offline,true);
});
test('revogação remota mantém a sessão restrita',async()=>{
 const h=harness({denied:true});await h.run();assert.equal(h.states.at(-1).status,'auth-limited');assert.equal(h.states.at(-1).profileFailureCode,'CONTINUITY_ACCESS_DENIED');
});
test('troca de conta não permite reabrir a sessão antiga',async()=>{
 const h=harness({current:()=>false});await h.run();assert.equal(h.states.length,0);
});
