import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const source=main.slice(main.indexOf('async function updateOutboxStatus()'),main.indexOf('function bindProfileRetryControl'));
function harness(patch={}) {
 const target={innerHTML:''};
 const ctx=vm.createContext({document:{querySelector:()=>target,hidden:false},navigator:{onLine:true},
  session:{status:'signed-in',offline:false},onlineValidationRequired:false,backendFailureDisplayed:false,
  isOfflineRuntimeForced:()=>false,operationalBackend:{snapshot:()=>({code:''})},connectionsSuspended:false,
  listUnsettledOperations(){assert.fail('queue read');},...patch});
 vm.runInContext(source,ctx);
 return {ctx,target};
}
test('online indicator confirms validated connection without reading old queues',async()=>{
 const {ctx,target}=harness();await ctx.updateOutboxStatus();
 assert.match(target.innerHTML,/✓/);assert.match(target.innerHTML,/sync-status-button--synced/);
 assert.match(target.innerHTML,/App online: perfil validado no servidor/);
 ctx.navigator.onLine=false;await ctx.updateOutboxStatus();assert.equal(target.innerHTML,'');
 ctx.navigator.onLine=true;await ctx.updateOutboxStatus();assert.match(target.innerHTML,/✓/);
});
for(const [name,patch] of [
 ['no network',{navigator:{onLine:false}}],
 ['signed out',{session:{status:'signed-out',offline:false}}],
 ['restricted session',{session:{status:'auth-limited',offline:false}}],
 ['local profile',{session:{status:'signed-in',offline:true}}],
 ['unconfirmed profile',{session:{status:'signed-in'}}],
 ['validating profile',{session:{status:'signed-in',offline:false,validatingProfile:true}}],
 ['validation required',{onlineValidationRequired:true}],
 ['backend failure',{backendFailureDisplayed:true}],
 ['blocked runtime',{isOfflineRuntimeForced:()=>true}],
 ['unavailable backend',{operationalBackend:{snapshot:()=>({code:'unavailable'})}}],
 ['quota exhausted',{operationalBackend:{snapshot:()=>({code:'resource-exhausted'})}}],
 ['suspended app',{connectionsSuspended:true}],
 ['hidden app',{document:{hidden:true}}]
])test(`online indicator clears stale confirmation: ${name}`,async()=>{
 const {ctx,target}=harness(patch);
 if(name==='hidden app')ctx.document.querySelector=()=>target;
 target.innerHTML='✓';await ctx.updateOutboxStatus();assert.equal(target.innerHTML,'');
});
test('online indicator tolerates an absent header',async()=>{
 const {ctx}=harness({document:{querySelector:()=>null}});await ctx.updateOutboxStatus();
});
