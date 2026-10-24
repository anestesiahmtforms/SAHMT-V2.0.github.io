import test from 'node:test';import assert from 'node:assert/strict';
import {waitForManagementSession} from '../src/management-entry-session.js';
import {createGoogleProjectAuth} from '../src/google-project-auth-core.js';
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

test('a failed destination stops waiting while unrelated projects remain busy',async()=>{
 const f=fixture();f.controller.snapshot=()=>({busy:true,targets:{FB:{status:'pending',code:'AUTH_GOOGLE_SESSION_REQUIRED'}}});
 let finished=false;const result=waitForManagementSession({...f,timeoutMs:100}).then(value=>{finished=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,true);assert.equal(await result,false);assert.equal(f.listeners.size,0);
});

test('navigation cancelled during SDK restoration never releases the old module',async()=>{
 const f=fixture(),gate=deferred();let current=true;f.auth.currentUser=user();f.auth.authStateReady=()=>gate.promise;
 const result=waitForManagementSession({...f,isCurrent:()=>current});current=false;gate.resolve();assert.equal(await result,false);
});

test('a session being signed out cannot release a destination',async()=>{
 const f=fixture();f.auth.currentUser=user();f.controller.snapshot=()=>({busy:true,signingOut:true});
 assert.equal(await waitForManagementSession(f),false);
});

test('entry waits through a restoration error when automatic credential exchange can repair it',async()=>{
 const source=user(),gate=deferred(),auth={currentUser:null,authStateReady:async()=>{}};
 const controller=createGoogleProjectAuth({getPrimaryUser:()=>source,
  restoreTarget:async target=>{if(target==='FB'){await gate.promise;throw {code:'AUTH_GOOGLE_SESSION_REQUIRED'};}return null;},
  connectTarget:async target=>{if(target==='FB')auth.currentUser=user();return user();},signOutTarget:async()=>{}});
 const connecting=controller.connect({idToken:'isolated-credential'});
 const entering=waitForManagementSession({auth,getSourceUser:()=>source,controller});gate.resolve();
 assert.equal(await entering,true);await connecting;
});

test('a final connection failure releases entry while another project is still connecting',async()=>{
 const source=user(),gate=deferred(),auth={currentUser:null,authStateReady:async()=>{}};
 const controller=createGoogleProjectAuth({getPrimaryUser:()=>source,restoreTarget:async()=>null,
  connectTarget:async target=>{if(target==='FB')throw {code:'auth/user-disabled'};if(target==='FC')await gate.promise;return user();},signOutTarget:async()=>{}});
 const connecting=controller.connect({idToken:'isolated-credential'});let finished=false;
 const entering=waitForManagementSession({auth,getSourceUser:()=>source,controller}).then(result=>{finished=true;return result;});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,true);assert.equal(await entering,false);}
 finally{gate.resolve();await connecting;}
});
