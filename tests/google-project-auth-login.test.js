import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const auth=readFileSync(new URL('../src/auth.js',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

const start=auth.indexOf('export async function signInGoogle()'),end=auth.indexOf('export async function signOutGlobal()',start);
function fixture({enabled=true,fail=false,target='FA'}={}){
 const calls=[],user={uid:'fixture'},credential={idToken:'ephemeral-google-credential'},result={user};
 class Provider{setCustomParameters(){} static credentialFromResult(value){assert.equal(value,result);return credential;}}
 const ctx=vm.createContext({deployment:{target,faBase:'/FA/',fbBase:'/FB/'},googleProjectAuthEnabled:enabled,managementFaFirstLoginConfig:{enabled:false},
  loadAuthApi:async()=>({auth:{},GoogleAuthProvider:Provider,browserPopupRedirectResolver:{},signInWithPopup:async()=>{calls.push('popup');return result;}}),
  directRuntime:async()=>({assertCanStartPrimarySignIn(){},connectGoogleProjectsFromSignIn:async(c,u)=>{assert.equal(c,credential);assert.equal(u,user);calls.push('connect-existing');if(fail)throw Error('transient');return {targets:{FB:{status:'ready'}}};}}),
  rememberManagementReturn:()=>calls.push('remember-route'),consumeManagementReturn:()=>null,rememberModuleNavigation(){},location:{assign:u=>calls.push(u)}});
 vm.runInContext(auth.slice(start,end).replace('export async function','async function'),ctx);return {run:()=>ctx.signInGoogle(),calls,result};
}
test('one normal Google login reuses its credential for existing project accounts',async()=>{
 const f=fixture();assert.equal(await f.run(),f.result);assert.deepEqual(f.calls,['popup','connect-existing']);
});
test('a destination failure preserves the successful primary login',async()=>{
 const f=fixture({fail:true});assert.equal(await f.run(),f.result);assert.deepEqual(f.calls,['popup','connect-existing']);
});
test('disabled coordination keeps the ordinary primary login',async()=>{
 const f=fixture({enabled:false});await f.run();assert.deepEqual(f.calls,['popup']);
});
test('missing FB session uses explicit Synchronization recovery and retains its return path',async()=>{
 const f=fixture({target:'FB'});await f.run();assert.deepEqual(f.calls,['remember-route','/FA/#/offline']);
});

test('conexão secundária fica atrás da confirmação explícita do painel',()=>{
  assert.match(main,/createGoogleButton/);
  assert.match(main,/runtime\.confirmGoogleProjectAccess\(credential\)/);
  assert.match(main,/isVisible:\(\)=>currentRoute\(\)==='offline'/);
  assert.match(main,/if \(googleProjectAuthEnabled\)/);
});
