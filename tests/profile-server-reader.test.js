import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileServerReader} from '../src/profile-server-reader.js';
import {createOperationalBackend} from '../src/operational-backend.js';
const user={uid:'synthetic-user',getIdToken:async()=> 'synthetic-token'};
const body=projectId=>({name:`projects/${projectId}/databases/(default)/documents/users/${user.uid}`,fields:{uid:{stringValue:user.uid},active:{booleanValue:true},permissions:{mapValue:{fields:{admin:{booleanValue:false}}}},roles:{arrayValue:{values:[{stringValue:'user'}]}}}});
const response=project=>({ok:true,status:200,json:async()=>body(project)});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('FA and FB profile reads keep credentials in the fixed project and current identity',async()=>{
 for(const projectId of ['sahmt-17a16','sahmt-gestao-5ae66']){
  let request;const read=createProfileServerReader({projectId,getCurrentUser:()=>user,getAppCheckToken:async()=> 'synthetic-attestation',fetchImpl:async(...args)=>{request=args;return response(projectId);}});
  const snapshot=await read(user);assert.deepEqual(snapshot.data(),{uid:user.uid,active:true,permissions:{admin:false},roles:['user']});
  assert.equal(request[0],`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.uid}`);
  assert.equal(request[1].headers.Authorization,'Bearer synthetic-token');assert.equal(request[1].headers['X-Firebase-AppCheck'],'synthetic-attestation');
  assert.equal(request[1].redirect,'error');assert.equal(request[1].cache,'no-store');assert.equal(request[1].credentials,'omit');
  await assert.rejects(read(user,{collection:'trainings'}),{code:'invalid-argument'});
 }
});
test('token, attestation, fetch and response-body stalls all release the pending profile read',async()=>{
 for(const stage of ['token','attestation','fetch','body']){
  let stalled=true,signal;const identity={...user,getIdToken:()=>stalled&&stage==='token'?new Promise(()=>{}):Promise.resolve('synthetic')};
  const backend=createOperationalBackend({timeoutMs:200});
  const read=createProfileServerReader({projectId:'sahmt-17a16',getCurrentUser:()=>identity,timeoutMs:20,
   getAppCheckToken:()=>stalled&&stage==='attestation'?new Promise(()=>{}):Promise.resolve(null),
   fetchImpl:async(_url,options)=>{signal=options.signal;if(stalled&&stage==='fetch')return new Promise(()=>{});return {...response('sahmt-17a16'),json:()=>stalled&&stage==='body'?new Promise(()=>{}):Promise.resolve(body('sahmt-17a16'))};}});
  await assert.rejects(backend.run('profile:'+user.uid,()=>read(user)),{code:'deadline-exceeded'});await tick();
  assert.equal(backend.snapshot().inFlight,0,stage);if(signal)assert.equal(signal.aborted,true);
  stalled=false;backend.reset();assert.equal((await backend.run('profile:'+user.uid,()=>read(user))).data().uid,user.uid);
 }
});
test('identity changes during token restoration cannot send the old token or accept an old response',async()=>{
 let current=user,resolveToken,requests=0;
 const first={...user,getIdToken:()=>new Promise(resolve=>resolveToken=resolve)};current=first;
 const read=createProfileServerReader({projectId:'sahmt-17a16',getCurrentUser:()=>current,fetchImpl:async()=>{requests++;return response('sahmt-17a16');}});
 const pending=read(first);await tick();current={uid:'another-user'};resolveToken('old-token');await assert.rejects(pending,{code:'cancelled'});assert.equal(requests,0);
 let finish;current=user;const slow=createProfileServerReader({projectId:'sahmt-17a16',getCurrentUser:()=>current,fetchImpl:()=>new Promise(resolve=>finish=resolve)});
 const pendingResponse=slow(user);await tick();current={uid:'another-user'};finish(response('sahmt-17a16'));await assert.rejects(pendingResponse,{code:'cancelled'});
});
test('server denial and quota stay distinct from temporary failures; missing profiles stay missing',async()=>{
 for(const [status,code] of [[401,'unauthenticated'],[403,'permission-denied'],[429,'resource-exhausted'],[503,'unavailable']]){
  const read=createProfileServerReader({projectId:'sahmt-17a16',getCurrentUser:()=>user,fetchImpl:async()=>({status,ok:false})});
  await assert.rejects(read(user),{code});
 }
 const missing=createProfileServerReader({projectId:'sahmt-17a16',getCurrentUser:()=>user,fetchImpl:async()=>({status:404,ok:false})});assert.equal((await missing(user)).exists(),false);
 const wrong=createProfileServerReader({projectId:'sahmt-17a16',getCurrentUser:()=>user,fetchImpl:async()=>response('sahmt-gestao-5ae66')});await assert.rejects(wrong(user),{code:'data-loss'});
});
test('unavailable attestation ends the attempt without sending an unattested request',async()=>{
 let reads=0;
 for(const code of ['app-check/network-unavailable','app-check/token-request-timeout']){
  const read=createProfileServerReader({projectId:'sahmt-17a16',getCurrentUser:()=>user,getAppCheckToken:async()=>{throw Object.assign(new Error('attestation unavailable'),{code});},fetchImpl:async()=>{reads++;return response('sahmt-17a16');}});
  await assert.rejects(read(user),{code:'unavailable'});
 }
 assert.equal(reads,0);
});
