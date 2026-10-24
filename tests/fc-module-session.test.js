import test from 'node:test';import assert from 'node:assert/strict';
import {createFcModuleSession,waitForFcModuleSession} from '../src/fc-module-session.js';
function fixture(){let listener,unsubscribes=0,popups=0,tokens=0;const auth={currentUser:null,authStateReady:async()=>{}};
 const user={uid:'one',getIdToken:async force=>{assert.equal(force,false);tokens++;return 'not-a-real-token';}};
 const authApi={GoogleAuthProvider:class{},signOut:async()=>{auth.currentUser=null;},signInWithPopup:async()=>{popups++;auth.currentUser=user;return {user};},onAuthStateChanged:(_auth,fn)=>{listener=fn;return()=>unsubscribes++;}};
 class Host extends EventTarget{isConnected=true;innerHTML='';button=new EventTarget();status={textContent:''};querySelector(selector){return selector==='[data-fc-module-login]'?this.button:this.status;}}
 return {auth,user,authApi,host:new Host(),emit:value=>{auth.currentUser=value;listener(value);},get unsubscribes(){return unsubscribes;},get popups(){return popups;},get tokens(){return tokens;}};
}
test('restored FC user refreshes the SDK token without opening another Google login',async()=>{
 const h=fixture();h.auth.currentUser=h.user;const session=createFcModuleSession({auth:h.auth,sourceUid:'one',authApi:h.authApi});
 assert.equal(await session.connect(),h.user);assert.equal(h.tokens,1);assert.equal(h.popups,0);
});
test('slow SDK restoration shows recovery controls and later resumes automatically',async()=>{
 const h=fixture();h.auth.authStateReady=()=>new Promise(()=>{});
 const result=waitForFcModuleSession(h.host,{auth:h.auth,sourceUid:'one',title:'Registros',authApi:h.authApi,timeoutMs:5});
 await new Promise(resolve=>setTimeout(resolve,15));assert.match(h.host.innerHTML,/data-fc-module-login/);
 h.emit(h.user);assert.equal(await result,h.auth);assert.equal(h.popups,0);assert.equal(h.unsubscribes,1);
});
test('a later FC identity cannot release a module whose source has changed',async()=>{
 const h=fixture();let current=true;const result=waitForFcModuleSession(h.host,{auth:h.auth,sourceUid:'one',title:'Registros',authApi:h.authApi,isCurrent:()=>current});
 await new Promise(resolve=>setImmediate(resolve));current=false;h.emit(h.user);assert.equal(await result,null);assert.equal(h.unsubscribes,1);
});
test('UID change during token refresh is rejected',async()=>{
 const h=fixture();h.auth.currentUser=h.user;h.user.getIdToken=async()=>{h.auth.currentUser={uid:'other'};};
 const session=createFcModuleSession({auth:h.auth,sourceUid:'one',authApi:h.authApi});await assert.rejects(session.connect(),/FC_MODULE_UID_MISMATCH/);
});

test('coordinated FC entry waits for automatic login before showing manual recovery',async()=>{
 const h=fixture();let finish;const ready=new Promise(resolve=>finish=resolve);
 const result=waitForFcModuleSession(h.host,{auth:h.auth,sourceUid:'one',title:'Registros',authApi:h.authApi,restoreSession:()=>ready});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.host.innerHTML,'');h.auth.currentUser=h.user;finish(true);
 assert.equal(await result,h.auth);assert.equal(h.popups,0);assert.equal(h.tokens,0);
});

test('coordinated FC result is discarded after navigating away',async()=>{
 const h=fixture();let finish,current=true;const ready=new Promise(resolve=>finish=resolve);
 const result=waitForFcModuleSession(h.host,{auth:h.auth,sourceUid:'one',title:'Registros',authApi:h.authApi,isCurrent:()=>current,restoreSession:()=>ready});
 await new Promise(resolve=>setImmediate(resolve));current=false;h.auth.currentUser=h.user;finish(true);
 assert.equal(await result,null);assert.equal(h.popups,0);
});
