import test from 'node:test';import assert from 'node:assert/strict';
import {createConnectionLifecycle} from '../src/connection-lifecycle.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let clock=1000,visible=true,online=true,forced=false,id=0;
 const state={status:'signed-in',user:{uid:'one'},offline:false},backend={code:'',nextRetryAt:0},calls=[],timers=new Map();
 const options={getSession:()=>state,getBackend:()=>backend,isOnline:()=>online,isVisible:()=>visible,isForcedOffline:()=>forced,now:()=>clock,
  setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:id=>timers.delete(id),restoreAuth:async()=>calls.push('auth'),
  revalidate:async()=>{calls.push('profile');state.status='signed-in';state.offline=false;forced=false;backend.code='';},resume:async()=>calls.push('resume')};
 const flow=createConnectionLifecycle(options);
 return {flow,state,backend,calls,timers,options,offline:()=>{state.offline=true;forced=true;},time:value=>clock=value,hide:()=>visible=false,noNetwork:()=>online=false,
  fire:async()=>{const [key,timer]=[...timers][0];timers.delete(key);clock+=timer.delay;timer.fn();await tick();await tick();}};
}
test('healthy foreground/navigation checks Auth with cooldown and never reads profiles',async()=>{
 const h=fixture();for(let i=0;i<20;i++)assert.equal(await h.flow.recover('navigation'),true);
 assert.equal(h.calls.filter(x=>x==='auth').length,1);assert.equal(h.calls.includes('profile'),false);assert.equal(h.timers.size,0);
});
test('foreground, online and pageshow share one recovery and confirm before resuming',async()=>{
 const h=fixture();h.offline();let finish;h.options.restoreAuth=()=>new Promise(resolve=>finish=resolve);
 const flow=createConnectionLifecycle(h.options),a=flow.recover('foreground'),b=flow.recover('online'),c=flow.recover('pageshow');
 assert.equal(a,b);assert.equal(b,c);assert.equal(h.calls.length,0);await tick();finish();await a;
 assert.deepEqual(h.calls,['profile','resume']);
});
test('restricted but authenticated profile can recover without cache or restart',async()=>{
 const h=fixture();h.state.status='auth-limited';h.offline();assert.equal(await h.flow.recover(),true);assert.deepEqual(h.calls,['auth','profile','resume']);
});
test('hidden, offline and signed-out states cause no work',async()=>{
 for(const mutate of [h=>h.hide(),h=>h.noNetwork(),h=>h.state.status='signed-out']){const h=fixture();mutate(h);assert.equal(await h.flow.recover(),false);assert.deepEqual(h.calls,[]);}
});
test('a transient failure gets only one delayed retry until confirmed recovery',async()=>{
 const h=fixture();h.offline();h.backend.code='unavailable';h.backend.nextRetryAt=6000;
 h.options.revalidate=async()=>h.calls.push('profile');const flow=createConnectionLifecycle(h.options);
 flow.failure(h.backend);flow.failure(h.backend);assert.equal(h.timers.size,1);
 await h.fire();assert.equal(h.calls.filter(x=>x==='profile').length,1);flow.failure(h.backend);assert.equal(h.timers.size,0);assert.equal(flow.snapshot().retrySpent,true);
});
test('quota, denial and long backoff never schedule automatic retries',async()=>{
 for(const code of ['resource-exhausted','permission-denied','unauthenticated']){const h=fixture();h.backend.code=code;h.backend.nextRetryAt=999999;h.offline();h.flow.failure(h.backend);await h.flow.recover();assert.equal(h.calls.includes('profile'),false);assert.equal(h.timers.size,0);}
});
test('new identity cannot receive a recovery or resume from the previous identity',async()=>{
 const h=fixture();let finish;h.options.restoreAuth=()=>new Promise(resolve=>finish=resolve);const flow=createConnectionLifecycle(h.options);
 const old=flow.recover();await tick();h.state.user.uid='two';flow.sessionChanged();finish();assert.equal(await old,false);assert.equal(h.calls.includes('resume'),false);
});
test('late server confirmation cancels a scheduled retry',()=>{
 const h=fixture();h.backend.code='unavailable';h.flow.failure(h.backend);assert.equal(h.timers.size,1);
 h.backend.code='';h.flow.sessionChanged();assert.equal(h.timers.size,0);
});

test('successful profile validation during an automatic retry cannot rearm a failing module loop',async()=>{
 const h=fixture();h.offline();h.backend.code='unavailable';h.flow.failure(h.backend);await h.fire();
 assert.equal(h.flow.snapshot().retrySpent,true);h.flow.sessionChanged();h.backend.code='unavailable';h.flow.failure(h.backend);
 assert.equal(h.timers.size,0);
});
test('no module resumes after the SDK reports a signed-out primary',async()=>{
 const h=fixture();h.options.restoreAuth=async()=>({status:'signed-out'});const flow=createConnectionLifecycle(h.options);assert.equal(await flow.recover(),false);assert.equal(h.calls.length,0);
});

test('an online event upgrades the coalesced foreground request during profile cooldown',async()=>{
 const h=fixture();h.offline();await h.flow.recover();h.time(2000);h.offline();
 const a=h.flow.recover('pageshow'),b=h.flow.recover('online');assert.equal(a,b);assert.equal(await a,true);
 assert.equal(h.calls.filter(value=>value==='profile').length,2);assert.equal(h.timers.size,0);
});
test('suspension retires an interrupted recovery and its late completion cannot resume the page',async()=>{
 const h=fixture();let finish;let count=0;h.options.restoreAuth=()=>++count===1?new Promise(resolve=>finish=resolve):Promise.resolve({status:'ready'});
 const flow=createConnectionLifecycle(h.options),old=flow.recover();await tick();flow.suspend();
 assert.equal(await flow.recover('pageshow'),true);finish({status:'ready'});assert.equal(await old,false);
 assert.equal(h.calls.filter(value=>value==='resume').length,1);
});
test('a recovery that becomes hidden cannot resume or consume suspended listeners',async()=>{
 const h=fixture();let finish;h.options.restoreAuth=()=>new Promise(resolve=>finish=resolve);const flow=createConnectionLifecycle(h.options);
 const work=flow.recover();await tick();h.hide();finish({status:'ready'});assert.equal(await work,false);assert.equal(h.calls.includes('resume'),false);
});
