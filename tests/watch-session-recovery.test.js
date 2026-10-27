import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {withinDeadline} from '../src/async-deadline.js';
const source=readFileSync(new URL('../src/auth.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('export function watchSession('),source.indexOf('export function retryAuthenticatedProfile(')).replace('export function','function');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({deadlineMs=18000,cacheGate,waitInitial=true,serverActive=true}={}){
 let observe,reads=0,finish;const states=[],events=new Map(),user={uid:'one'},profile={uid:'one',active:serverActive,access:serverActive,permissions:{managementRead:true}};
 const ctx=vm.createContext({withinDeadline:(action,options)=>withinDeadline(action,{...options,timeoutMs:options.timeoutMs===18000?deadlineMs:options.timeoutMs}),AbortController,firebaseConfigured:true,retryCurrentProfile:null,profileForPresentation:x=>x,
  window:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},navigator:{onLine:true},
  readCachedProfile:async()=>cacheGate?await cacheGate:profile,operationalBackend:{reset(){},noteFailure(){}},showAuthLimitedSession:(user,emit)=>emit({status:'auth-limited',user}),
  isFirestoreCacheFallbackError:()=>false,profileReadFailureCode:()=> 'FAILED',isManagementFaFirstLoginPending:()=>false,
  subscribeManagementFaFirstLoginPending:()=>()=>{},observeManagementFaFirstLoginAuthUid(){},reconcileFirebaseSecondarySessions:async()=>{},
  loadAuthApi:async()=>({auth:{currentUser:user},onAuthStateChanged:(_auth,fn)=>{observe=fn;return()=>{};}}),
  onAuthChangedProfile:async(current,emit,generation,getGeneration)=>{reads++;if(reads>1)await new Promise(resolve=>finish=resolve);if(generation===getGeneration())emit({status:profile.active?'signed-in':'blocked',offline:false,user:current,profile});}});
 vm.runInContext(code,ctx);const dispose=ctx.watchSession(state=>states.push(state));await tick();const initial=observe(user);if(waitInitial)await initial;
 return {ctx,states,events,initial,get reads(){return reads;},finish:()=>finish(),dispose};
}
test('quiet profile recovery preserves the authorized screen and merges simultaneous requests',async()=>{
 const h=await fixture();assert.equal(h.events.has('online'),false);const count=h.states.length;
 const first=h.ctx.retryCurrentProfile(),second=h.ctx.retryCurrentProfile();assert.equal(first,second);await tick();
 assert.equal(h.states.length,count);assert.equal(h.reads,2);h.finish();await first;
 assert.equal(h.states.at(-1).status,'signed-in');assert.equal(h.states.at(-1).offline,false);h.dispose();
});
test('unconfigured startup has no session observer temporal-dead-zone error',()=>{
 const states=[],ctx=vm.createContext({firebaseConfigured:false});vm.runInContext(code,ctx);ctx.watchSession(state=>states.push(state));assert.equal(states[0].status,'unconfigured');
});

test('an overall profile deadline retires the hung load and the next attempt reaches the server',async()=>{
 const h=await fixture({deadlineMs:30});await h.ctx.retryCurrentProfile();
 assert.equal(h.states.at(-1).offline,true);assert.equal(h.states.at(-1).validatingProfile,false);
 const retry=h.ctx.retryCurrentProfile();await tick();assert.equal(h.reads,3);h.finish();await retry;
 assert.equal(h.states.at(-1).offline,false);h.dispose();
});

test('FB profile validation starts before a slow optional local profile read completes',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const h=await fixture({cacheGate:gate,waitInitial:false});
 try{
  await tick();assert.equal(h.reads,1,'the server read must not queue behind the local cache');
  assert.equal(h.states.at(-1).offline,false);
  release({uid:'one',active:true,access:true,role:'old-cached-role'});await h.initial;await tick();
  assert.equal(h.states.at(-1).offline,false,'late cache must not downgrade confirmed access');
  assert.notEqual(h.states.at(-1).profile.role,'old-cached-role');
 }finally{release(null);await h.initial;h.dispose();}
});

test('late authorized cache cannot restore access after the server blocks the profile',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const h=await fixture({cacheGate:gate,waitInitial:false,serverActive:false});
 try{
  await tick();assert.equal(h.states.at(-1).status,'blocked');
  release({uid:'one',active:true,access:true,permissions:{admin:true}});await h.initial;await tick();
  assert.equal(h.states.at(-1).status,'blocked');assert.equal(h.states.at(-1).profile.active,false);
 }finally{release(null);await h.initial;h.dispose();}
});
