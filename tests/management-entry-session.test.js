import test from 'node:test';import assert from 'node:assert/strict';
import {waitForManagementSession} from '../src/management-entry-session.js';
const user=(uid='same')=>({uid,providerData:[{providerId:'google.com',uid:'google-'+uid}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(){let source=user(),busy=true;const listeners=new Set(),auth={currentUser:null,authStateReady:async()=>{}};
 const controller={snapshot:()=>({busy}),subscribe:fn=>{listeners.add(fn);fn({busy});return()=>listeners.delete(fn);}};
 return {auth,controller,listeners,getSourceUser:()=>source,replaceSource:()=>{source=user('another');},emit:next=>{busy=next;for(const fn of [...listeners])fn({busy});}};}
test('matching persisted FB session opens without waiting for unrelated project restoration',async()=>{
 const f=fixture();f.auth.currentUser=user();assert.equal(await waitForManagementSession(f),true);assert.equal(f.listeners.size,0);
});
test('entry waits for initial credential exchange instead of treating FB as signed out',async()=>{
 const f=fixture(),result=waitForManagementSession(f);await new Promise(r=>setImmediate(r));assert.equal(f.listeners.size,1);
 f.auth.currentUser=user();f.emit(true);assert.equal(await result,true);assert.equal(f.listeners.size,0);
});
test('deadline removes listeners and does not create a late subscription',async()=>{
 const f=fixture();assert.equal(await waitForManagementSession({...f,timeoutMs:10}),false);assert.equal(f.listeners.size,0);
 const pending=deferred();f.auth.authStateReady=()=>pending.promise;
 assert.equal(await waitForManagementSession({...f,timeoutMs:10}),false);pending.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.listeners.size,0);
});
test('a changed primary identity never receives the old FB session',async()=>{
 const f=fixture(),result=waitForManagementSession(f);await new Promise(r=>setImmediate(r));f.auth.currentUser=user();f.replaceSource();f.emit(false);assert.equal(await result,false);
});
