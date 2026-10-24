import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/auth.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function onAuthChangedProfile('),source.indexOf('function deferProfileListener(')).replaceAll('import(','fakeImport(');
function fixture(active=true){const states=[],profile={uid:'fixture',active,access:active,permissions:{managementRead:true}},user={uid:'fixture'};
 const context=vm.createContext({fakeImport:async name=>name==='firebase/firestore/lite'?{doc:()=>({}),getDoc:async()=>({exists:()=>true,data:()=>profile})}:{db:{}},operationalBackend:{run:(_key,call)=>call()},
  cacheProfile:async()=>{throw Error('local storage unavailable');},profileForPresentation:p=>p,deferProfileListener(){},isFirestoreCacheFallbackError:()=>false,profileReadFailureCode:()=> 'FAILED',showAuthLimitedSession:()=>states.push({status:'auth-limited'})});
 vm.runInContext(fn,context);return {states,run:()=>context.onAuthChangedProfile(user,s=>states.push(s),1,()=>1,()=>{})};}
test('server-confirmed profile opens despite a rejected local cache write',async()=>{const f=fixture();await f.run();assert.equal(f.states.at(-1).status,'signed-in');assert.equal(f.states.at(-1).offline,false);});
test('server revocation takes effect despite a rejected local cache write',async()=>{const f=fixture(false);await f.run();assert.equal(f.states.at(-1).status,'blocked');});
