import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirebaseProjectAuthOptIn} from '../src/firebase-project-auth-optin.js';

test('disabled opt-in does not load runtime, initialize auth, or make network calls', async () => {
  let loads = 0;
  const optin = createFirebaseProjectAuthOptIn({loadRuntime: async () => { loads++; throw new Error('should not load'); }});
  assert.deepEqual(await optin.connect(), {status: 'disabled'});
  assert.equal(loads, 0);
});

test('enabled opt-in initializes once only after explicit connect', async () => {
  let loads = 0, connects = 0;
  const optin = createFirebaseProjectAuthOptIn({enabled: true, loadRuntime: async () => {
    loads++; return {connect: async () => { connects++; return {status: 'partial', targets: {FB: {status: 'ready'}, FC: {status: 'unavailable'}}}; }};
  }});
  assert.equal(loads, 0);
  const results = await Promise.all([optin.connect(), optin.connect()]);
  assert.equal(loads, 1);
  assert.equal(connects, 2);
  assert.equal(results[0].targets.FB.status, 'ready');
  assert.equal(results[0].targets.FC.status, 'unavailable');
});

test('opt-in keeps separate lazy runtimes for destination subsets',async()=>{
  const loaded=[],connected=[];const optin=createFirebaseProjectAuthOptIn({enabled:true,loadRuntime:async names=>{
    loaded.push(names);return {connect:async()=>{connected.push(names);return {status:'ready'};}};
  }});
  await optin.connect(['FB']);await optin.connect(['FC']);await optin.connect(['FB']);
  assert.deepEqual(loaded,[['FB'],['FC']]);assert.deepEqual(connected,[['FB'],['FC'],['FB']]);
});

test('shared runtime reuses an in-flight full connection for a destination subset',async()=>{
  let loads=0,connects=0,release;
  const optin=createFirebaseProjectAuthOptIn({enabled:true,runtimeKey:()=> 'all',loadRuntime:async()=>{
    loads++;
    let pending;
    return {connect:async names=>{
      if(!pending){connects++;pending=new Promise(resolve=>{release=()=>resolve({status:'ready',targets:{FB:{status:'ready'},FC:{status:'ready'}}});});}
      const result=await pending;
      return names?.length===1?{status:'ready',targets:{[names[0]]:result.targets[names[0]]}}:result;
    }};
  }});
  const both=optin.connect(['FB','FC']),fc=optin.connect(['FC']);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(loads,1);
  assert.equal(connects,1);
  release();
  assert.equal((await both).targets.FB.status,'ready');
  assert.deepEqual(Object.keys((await fc).targets),['FC']);
});

test('disabled runtime failure is sanitized and disposal blocks later loads', async () => {
  let loads = 0;
  const optin = createFirebaseProjectAuthOptIn({enabled: true, loadRuntime: async () => {
    loads++; throw new Error('private token detail');
  }});
  assert.deepEqual(await optin.connect(), {status: 'unavailable', code: 'OPTIN_UNAVAILABLE'});
  assert.equal(loads, 1);
  optin.dispose();
  assert.deepEqual(await optin.connect(), {status: 'unavailable', code: 'OPTIN_DISPOSED'});
  assert.equal(loads, 1);
});

test('dispose during load never connects the resulting runtime', async () => {
  let release, connects = 0, disposed = 0;
  const optin = createFirebaseProjectAuthOptIn({enabled: true, loadRuntime: () => new Promise(resolve => {
    release = () => resolve({connect: async () => { connects++; return {status: 'ready'}; }, dispose: () => { disposed++; }});
  })});
  const pending = optin.connect();
  await new Promise(resolve => setImmediate(resolve));
  optin.dispose(); release();
  assert.deepEqual(await pending, {status: 'unavailable', code: 'OPTIN_DISPOSED'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connects, 0);
  assert.equal(disposed, 1);
});

