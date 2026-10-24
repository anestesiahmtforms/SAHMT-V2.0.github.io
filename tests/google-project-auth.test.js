import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleProjectAuth,createGoogleAuthProgressStore,GOOGLE_AUTH_START,googleIdentity} from '../src/google-project-auth-core.js';
const user=(uid='person-a',googleUid='google-a')=>({uid,providerData:[{providerId:'google.com',uid:googleUid}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('slow FB and FC restoration never hold back existing FD and FE sessions',async()=>{
 const gate=deferred(),f=fixture({restoreTarget:async target=>{if(['FB','FC'].includes(target))await gate.promise;return user();}});
 const work=f.api.restore();
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(f.api.snapshot().targets.FD.status,'ready');assert.equal(f.api.snapshot().targets.FE.status,'ready');}
 finally{gate.resolve();await work;}
});
test('background validation keeps verified destinations ready until a real failure',async()=>{
 const gate=deferred();let slow=false;
 const f=fixture({restoreTarget:async()=>{if(slow)await gate.promise;return user();}});
 await f.api.restore();slow=true;const work=f.api.restore();
 try{assert.equal(f.api.snapshot().targets.FB.status,'ready');assert.equal(f.api.snapshot().targets.FC.status,'ready');}
 finally{gate.resolve();await work;}
});
function fixture(overrides={}){let primary=user(),connected=0,max=0;const users={FA:primary,FB:null,FC:null,FD:null,FE:null},calls=[],saved=[];
 const api=createGoogleProjectAuth({getPrimaryUser:()=>primary,restoreTarget:async t=>users[t],
  connectTarget:async(t,credential,expected,isCurrent)=>{calls.push(t);connected++;max=Math.max(max,connected);await Promise.resolve();connected--;if(!isCurrent())throw {code:'AUTH_ACCOUNT_CHANGED'};return users[t]=user(expected.uid,expected.googleUid);},
  signOutTarget:async t=>{calls.push('out:'+t);users[t]=null;if(t==='FA')primary=null;},saveProgress:p=>saved.push(p),sleep:async()=>{},...overrides});
 return {api,users,calls,saved,setPrimary:u=>{primary=u;users.FA=u;},max:()=>max};}
test('data da chamada considera meia-noite de São Paulo',()=>assert.equal(new Date(GOOGLE_AUTH_START).toISOString(),'2026-10-22T03:00:00.000Z'));
test('restaura sessões SDK sem conectar novamente nem confiar no marcador local',async()=>{const f=fixture();for(const t of ['FB','FC','FD','FE'])f.users[t]=user();assert.equal((await f.api.restore()).complete,true);await f.api.connect({idToken:'only-memory'});assert.deepEqual(f.calls,[]);});
test('mesma credencial é usada apenas nos destinos pendentes com concorrência limitada',async()=>{const f=fixture();f.users.FB=user();await f.api.restore();await f.api.connect({idToken:'only-memory'});assert.deepEqual(f.calls.sort(),['FC','FD','FE']);assert.ok(f.max()<=2);assert.equal(f.api.snapshot().complete,true);assert.ok(f.saved.every(p=>!JSON.stringify(p).includes('only-memory')));});
test('chamadas concorrentes compartilham um único trabalho',async()=>{const f=fixture();await f.api.restore();const a=f.api.connect({idToken:'x'}),b=f.api.connect({idToken:'x'});assert.equal(a,b);await a;assert.equal(f.calls.length,4);});
test('falha definitiva de um destino não bloqueia demais nem encerra FA',async()=>{const f=fixture({connectTarget:async(t,c,e)=>{if(t==='FC')throw {code:'auth/user-disabled'};return user(e.uid,e.googleUid);}});await f.api.restore();await f.api.connect({});const s=f.api.snapshot();assert.equal(s.targets.FA.status,'ready');assert.equal(s.targets.FB.status,'ready');assert.equal(s.targets.FC.code,'auth/user-disabled');assert.equal(s.targets.FE.status,'ready');assert.equal(s.complete,false);});
test('rede indisponível não causa logout nem loop',async()=>{const f=fixture({isOnline:()=>false});f.users.FB=user();await f.api.restore();await f.api.connect({});assert.deepEqual(f.calls,[]);assert.equal(f.api.snapshot().targets.FB.status,'ready');assert.equal(f.api.snapshot().targets.FC.code,'AUTH_OFFLINE');});
test('erro transitório recebe somente uma repetição com espera',async()=>{const attempts={},waits=[];const f=fixture({connectTarget:async t=>{attempts[t]=(attempts[t]||0)+1;throw {code:'auth/network-request-failed'};},sleep:async ms=>waits.push(ms)});await f.api.restore();await f.api.connect({});assert.deepEqual(Object.values(attempts),[2,2,2,2]);assert.deepEqual(waits,[700,700,700,700]);});
test('UID ou conta Google divergente é encerrada e nunca confirmada',async()=>{const f=fixture();f.users.FB=user('other');f.users.FC=user('person-a','other-google');await f.api.restore();assert.deepEqual(f.calls.sort(),['out:FB','out:FC']);assert.equal(f.api.snapshot().complete,false);});
test('troca de usuário invalida resultado anterior',async()=>{const gate=deferred();const f=fixture({connectTarget:async(t,c,e,isCurrent)=>{await gate.promise;if(!isCurrent())throw {code:'AUTH_ACCOUNT_CHANGED'};return user(e.uid,e.googleUid);}});await f.api.restore();const work=f.api.connect({});f.setPrimary(user('person-b','google-b'));const restore=f.api.restore();gate.resolve();await Promise.all([work.catch(e=>assert.equal(e.code,'AUTH_ACCOUNT_CHANGED')),restore]);assert.equal(f.api.snapshot().uid,'person-b');assert.equal(f.api.snapshot().complete,false);});
test('logout encerra inclusive destinos que ainda não foram inicializados',async()=>{const f=fixture();await f.api.restore();await f.api.signOutAll();assert.deepEqual(f.calls.sort(),['out:FA','out:FB','out:FC','out:FD','out:FE']);assert.equal(f.api.snapshot().uid,null);});
test('logout durante conexão aguarda término e faz segunda limpeza',async()=>{const gate=deferred();const f=fixture({connectTarget:async(t,c,e,isCurrent)=>{await gate.promise;if(!isCurrent())throw {code:'AUTH_ACCOUNT_CHANGED'};return user(e.uid,e.googleUid);}});await f.api.restore();const work=f.api.connect({});const logout=f.api.signOutAll();gate.resolve();await Promise.all([work.catch(e=>assert.equal(e.code,'AUTH_ACCOUNT_CHANGED')),logout]);assert.equal(f.calls.filter(c=>c.startsWith('out:')).length,10);assert.equal(f.api.snapshot().complete,false);});
test('conta sem provedor Google não é vinculada por e-mail',async()=>{assert.equal(googleIdentity({uid:'person-a',email:'a@example.test',providerData:[]}),null);const f=fixture();f.setPrimary({uid:'person-a',providerData:[]});await assert.rejects(f.api.connect({}),{code:'AUTH_SOURCE_REQUIRED'});assert.equal(f.calls.length,0);});
test('metadados são por instalação release UID, sem gravar tokens nem permissões',()=>{const values=new Map(),store=createGoogleAuthProgressStore({getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},()=> 'installation-a');store.save({uid:'person-a',complete:false,readyTargets:['FA'],token:'secret',permissions:{admin:true}});assert.equal(values.size,2);assert.ok([...values.keys()].some(k=>k.endsWith(':installation-a:person-a')));assert.ok([...values.values()].every(v=>!v.includes('secret')&&!v.includes('permissions')));});
