import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCommunicationPushDirectory} from '../src/communication-push-directory.js';

test('all user and device pages form one sorted list, including users without an installation',async()=>{
 const calls=[];
 const pages={
  DIRECTORY:{
   '':{items:[{uid:'b',displayName:'Bruno',email:'bruno@example.test'},{uid:'a',displayName:'Álvaro'}],cursor:'users-2'},
   'users-2':{items:[{uid:'c',displayName:'Carla'},{uid:'b',displayName:'Bruno'}],cursor:null}
  },
  PUSH_DEVICE_DIRECTORY:{
   '':{items:[{uid:'b',sigla:'BR',devices:[{deviceId:'b-phone',pushStatus:'ACTIVE'}]}],cursor:'devices-2'},
   'devices-2':{items:[],cursor:'devices-3'},
   'devices-3':{items:[{uid:'a',devices:[{deviceId:'a-phone',pushStatus:'NOT_REGISTERED'},{deviceId:'a-tablet',pushStatus:'ACTIVE'}]},{uid:'stale',devices:[]}],cursor:null}
  }
 };
 const items=await loadCommunicationPushDirectory({request:async(action,{cursor})=>{calls.push([action,cursor]);return pages[action][cursor];}});
 assert.deepEqual(items.map(user=>user.uid),['a','b','c']);
 assert.equal(items[0].devices.length,2);
 assert.equal(items[0].devices[0].pushStatus,'ACTIVE');
 assert.equal(items[1].email,'bruno@example.test');
 assert.equal(items[1].sigla,'BR');
 assert.deepEqual(items[2].devices,[]);
 assert.equal(calls.length,5);
});

test('active Push users precede inactive users with alphabetical ordering inside each group',async()=>{
 const directory=[{uid:'a',displayName:'Ana'},{uid:'d',displayName:'Daniel'},{uid:'c',displayName:'Carla'},{uid:'b',displayName:'Bruno'},{uid:'e',displayName:'Eva'}];
 const devices=[{uid:'a',devices:[{pushStatus:'NOT_REGISTERED'}]},{uid:'d',devices:[{pushStatus:'ACTIVE'}]},{uid:'c',devices:[{pushStatus:'UNLINKED'}]},{uid:'b',devices:[{pushStatus:'ACTIVE'}]}];
 const items=await loadCommunicationPushDirectory({request:async action=>({items:action==='DIRECTORY'?directory:devices,cursor:null})});
 assert.deepEqual(items.map(user=>user.uid),['b','c','d','a','e']);
});

test('an empty active directory makes no device-directory requests',async()=>{
 const calls=[];
 const items=await loadCommunicationPushDirectory({request:async action=>{calls.push(action);return {items:[],cursor:null};}});
 assert.deepEqual(items,[]);assert.deepEqual(calls,['DIRECTORY']);
});

test('repeated cursors cannot loop or present a truncated list as complete',async()=>{
 let requests=0;
 await assert.rejects(loadCommunicationPushDirectory({request:async action=>{if(action==='PUSH_DEVICE_DIRECTORY')return {items:[],cursor:null};requests++;return {items:[{uid:'a'}],cursor:'same'};}}),{code:'COMM_DIRECTORY_INCOMPLETE'});
 assert.equal(requests,2);
});

test('leaving the view during a response stops subsequent reads',async()=>{
 let active=true,requests=0;
 const result=await loadCommunicationPushDirectory({isCurrent:()=>active,request:async()=>{requests++;active=false;return {items:[{uid:'a'}],cursor:'more'};}});
 assert.equal(result,null);assert.equal(requests,1);
});

test('the existing per-minute limit waits for its window before continuing the same page',async()=>{
 let attempts=0;const delays=[],progress=[];
 const items=await loadCommunicationPushDirectory({now:()=>59000,wait:async delay=>delays.push(delay),onProgress:value=>progress.push(value),request:async action=>{
  if(action==='DIRECTORY'&&attempts++===0)throw Object.assign(Error('rate'),{code:'COMM_RATE_LIMIT'});
  return {items:action==='DIRECTORY'?[{uid:'a'}]:[],cursor:null};
 }});
 assert.equal(items.length,1);assert.deepEqual(delays,[1250]);assert.equal(progress.some(value=>value.waiting),true);
});

test('a cancelled wait stops before another API request',async()=>{
 const controller=new AbortController();let requests=0;
 const result=await loadCommunicationPushDirectory({signal:controller.signal,request:async()=>{requests++;throw Object.assign(Error('rate'),{code:'COMM_RATE_LIMIT'});},onProgress:({waiting})=>{if(waiting)controller.abort();}});
 assert.equal(result,null);assert.equal(requests,1);
});

test('daily quota and failed pages never return an incomplete list as complete',async()=>{
 let calls=0;
 await assert.rejects(loadCommunicationPushDirectory({request:async action=>{
  calls++;if(action==='DIRECTORY')return {items:[{uid:'a'}],cursor:null};
  throw Object.assign(Error('quota'),{code:'COMM_FREE_QUOTA_EXHAUSTED'});
 }}),{code:'COMM_FREE_QUOTA_EXHAUSTED'});
 assert.equal(calls,2);
});
