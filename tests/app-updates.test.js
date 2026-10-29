import test from 'node:test';
import assert from 'node:assert/strict';
import {watchAppUpdates} from '../src/app-updates.js';

function fixture({firstInstall=false,offline=false}={}) {
 const worker=Object.assign(new EventTarget(),{state:'installed'});
 const registration=Object.assign(new EventTarget(),{waiting:null,installing:null,updates:0,async update(){this.updates++;}});
 const serviceWorker={controller:firstInstall?null:{state:'activated'},calls:[],async register(...args){this.calls.push(args);return registration;}};
 const appWindow=Object.assign(new EventTarget(),{timers:new Set(),setInterval(fn){this.timers.add(fn);return fn;},clearInterval(fn){this.timers.delete(fn);}});
 const document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const offers=[],dismissals=[];let clock=0,online=!offline;
 const options={base:'/SAHMT-V2.0.github.io/gestao/',serviceWorker,appWindow,document,isOnline:()=>online,now:()=>clock,onAvailable:o=>offers.push(o),onDismiss:()=>dismissals.push(true)};
 return {worker,registration,serviceWorker,appWindow,document,offers,dismissals,options,advance(){clock+=31000;},online(value){online=value;}};
}

test('waiting release is offered once with the correct scope and without activating it',async t=>{
 const f=fixture();f.registration.waiting=f.worker;
 const watcher=await watchAppUpdates(f.options);t.after(()=>watcher.stop());
 assert.deepEqual(f.serviceWorker.calls,[['/SAHMT-V2.0.github.io/gestao/service-worker.js',{scope:'/SAHMT-V2.0.github.io/gestao/',updateViaCache:'none'}]]);
 assert.equal(f.offers.length,1);
 assert.equal(f.offers[0].worker,f.worker);
 await watcher.check({force:true});assert.equal(f.offers.length,1);
 // No postMessage/skipWaiting/reload methods exist on these fakes: announcing must not invoke them.
 watcher.dismiss();assert.equal(f.dismissals.length,1);
 await watcher.check({force:true});assert.equal(f.offers.length,1);
 f.document.visibilityState='hidden';f.document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(f.offers.length,1);
 f.document.visibilityState='visible';f.document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(f.offers.length,2,'a deferred release is offered when the user returns');
});

test('a new installing worker is offered only after its shell finishes installing',async t=>{
 const f=fixture(),watcher=await watchAppUpdates(f.options);t.after(()=>watcher.stop());
 f.worker.state='installing';f.registration.installing=f.worker;
 f.registration.dispatchEvent(new Event('updatefound'));assert.equal(f.offers.length,0);
 f.worker.state='installed';f.registration.waiting=f.worker;f.worker.dispatchEvent(new Event('statechange'));
 assert.equal(f.offers.length,1);
 f.worker.dispatchEvent(new Event('statechange'));assert.equal(f.offers.length,1);
});

test('the first installation never tells a new user to update',async t=>{
 const f=fixture({firstInstall:true});f.registration.waiting=f.worker;
 const watcher=await watchAppUpdates(f.options);t.after(()=>watcher.stop());
 assert.equal(f.offers.length,0);
});

test('checks resume on connection and foreground, and stop removes all listeners and timers',async()=>{
 const f=fixture({offline:true}),watcher=await watchAppUpdates(f.options);
 assert.equal(f.registration.updates,0);
 f.online(true);f.appWindow.dispatchEvent(new Event('online'));
 await Promise.resolve();assert.equal(f.registration.updates,1);
 f.advance();f.document.visibilityState='hidden';for(const tick of f.appWindow.timers)tick();
 assert.equal(f.registration.updates,1);
 f.document.visibilityState='visible';f.document.dispatchEvent(new Event('visibilitychange'));
 await Promise.resolve();assert.equal(f.registration.updates,2);
 f.registration.update=async()=>{throw Error('Offline');};f.advance();
 assert.equal(await watcher.check(),false,'a failed connection remains recoverable');
 watcher.stop();assert.equal(f.appWindow.timers.size,0);
 f.registration.waiting=f.worker;f.registration.dispatchEvent(new Event('updatefound'));
 f.appWindow.dispatchEvent(new Event('pageshow'));assert.equal(f.offers.length,0);
 assert.equal(await watcher.check({force:true}),false);
});
