import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementProjectAuthAutoConnector, managementProjectAuthTargets} from '../src/management-project-auth-auto-connect.js';

const profile = (permissions = {}, extra = {}) => ({active:true, access:true, role:'anestesiologista', permissions, ...extra});

test('automatic targets are independently derived from the FA profile as request hints', () => {
  assert.deepEqual(managementProjectAuthTargets(profile({trainingsRead:true})), ['FB','FC']);
  assert.deepEqual(managementProjectAuthTargets(profile({managementIndicatorsRead:true})), ['FC']);
  assert.deepEqual(managementProjectAuthTargets(profile({trainingsManage:true,managementIndicatorsWrite:true})), ['FB','FC']);
  assert.deepEqual(managementProjectAuthTargets(profile({admin:true})), ['FC']);
  assert.deepEqual(managementProjectAuthTargets(profile({}, {role:'administrador_app'})), ['FC']);
  assert.deepEqual(managementProjectAuthTargets(profile({trainingsRead:true}, {role:'administrador_app'})), ['FB','FC']);
  assert.deepEqual(managementProjectAuthTargets(profile({trainingsRead:true,managementIndicatorsRead:true}, {active:false})), []);
  assert.deepEqual(managementProjectAuthTargets(profile({trainingsRead:true}, {access:false})), []);
  assert.deepEqual(managementProjectAuthTargets(profile({})), ['FC']);
});

test('disabled-by-default connector performs no lazy load or broker request', async () => {
  let loads = 0, calls = 0;
  const connector = createManagementProjectAuthAutoConnector({enabled:false,
    loadConnect:async()=>{loads++;return async()=>{calls++;}}, isCurrent:()=>true});
  assert.deepEqual(await connector.update({uid:'uid-a',profile:profile({trainingsRead:true})}), {status:'disabled'});
  assert.equal(loads,0); assert.equal(calls,0);
});

test('active user requests FC and authorized FB once in background; duplicate profile events deduplicate', async () => {
  let calls = 0, currentUid = 'uid-a'; const requested = [];
  const connector = createManagementProjectAuthAutoConnector({enabled:true,
    loadConnect:async()=>async targets=>{calls++;requested.push([...targets]);return {status:'partial'};},
    isCurrent:uid=>uid===currentUid});
  const ctx={uid:'uid-a',profile:profile({trainingsRead:true})};
  const first=connector.update(ctx), duplicate=connector.update(ctx);
  assert.strictEqual(first,duplicate);
  assert.deepEqual(await first,{status:'partial'});
  assert.equal(calls,1); assert.deepEqual(requested,[['FB','FC']]);
});

test('occurrence-only active user requests FC and never FB', async () => {
  let requested;
  const connector = createManagementProjectAuthAutoConnector({enabled:true,
    loadConnect:async()=>async targets=>{requested=[...targets];return {status:'ready'};}, isCurrent:()=>true});
  await connector.update({uid:'uid-fc',profile:profile({})});
  assert.deepEqual(requested,['FC']);
});

test('source user switch drops a late result from the prior connection attempt', async () => {
  let currentUid='uid-a', resolveConnect;
  const connector=createManagementProjectAuthAutoConnector({enabled:true,
    loadConnect:async()=>async targets=>targets[0] === 'FB'
      ? new Promise(resolve=>{resolveConnect=resolve;}) : {status:'ready'},isCurrent:uid=>uid===currentUid});
  const pending=connector.update({uid:'uid-a',profile:profile({trainingsRead:true})});
  await new Promise(resolve=>setImmediate(resolve));
  currentUid='uid-b';
  await connector.update({uid:'uid-b',profile:profile({managementIndicatorsRead:true})});
  resolveConnect({status:'ready',uid:'uid-a'});
  assert.deepEqual(await pending,{status:'stale'});
});

test('revoked FA access invalidates a pending request without blocking FA', async () => {
  let allowed=true, resolveConnect;
  const connector=createManagementProjectAuthAutoConnector({enabled:true,
    loadConnect:async()=>async()=>new Promise(resolve=>{resolveConnect=resolve;}),isCurrent:()=>allowed});
  const pending=connector.update({uid:'uid-a',profile:profile({trainingsRead:true})});
  await new Promise(resolve=>setImmediate(resolve));
  allowed=false;
  await connector.update({uid:'uid-a',profile:profile({trainingsRead:true},{access:false})});
  resolveConnect({status:'ready'});
  assert.deepEqual(await pending,{status:'stale'});
});

test('network retry is explicit, and broker failure remains a non-blocking result', async () => {
  let attempts=0;
  const connector=createManagementProjectAuthAutoConnector({enabled:true,
    loadConnect:async()=>async()=>{attempts++;throw new Error('private failure');},isCurrent:()=>true});
  const ctx={uid:'uid-a',profile:profile({trainingsRead:true})};
  assert.deepEqual(await connector.update(ctx),{status:'unavailable'});
  assert.deepEqual(await connector.retry(),{status:'unavailable'});
  assert.equal(attempts,2);
});
