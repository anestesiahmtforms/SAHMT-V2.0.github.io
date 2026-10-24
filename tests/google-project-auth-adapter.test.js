import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleProjectAuthRuntime} from '../src/google-project-auth-adapter.js';
const person=(uid='same-uid')=>({uid,email:'fixture@example.test',providerData:[{providerId:'google.com',uid:'google-'+uid}]});
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:v=>resolve(v)};};
const idToken='header.'+Buffer.from(JSON.stringify({iss:'https://accounts.google.com',sub:'google-same-uid',aud:'source-client'})).toString('base64url')+'.signature';
const credential={providerId:'google.com',idToken};
const entries=Object.fromEntries(['FA','FB','FC','FD','FE'].map(t=>[t,{acceptedGoogleClientIds:['source-client'],appName:'app-'+t,config:{projectId:t,appId:'id-'+t}}]));
function fixture({persisted={},verify,signin,popupFailure,restoration,logoutFailure}={}){
  const auth={target:'FA',currentUser:person()},apps=[],instances={FA:auth},calls=[],saved=new Map();
  const sdk={
    indexedDBLocalPersistence:'indexeddb',browserLocalPersistence:'local',inMemoryPersistence:'memory',browserPopupRedirectResolver:{},
    getApps:()=>apps,
    initializeApp:(options,name)=>{const app={options,name};apps.push(app);return app;},
    initializeAuth:(app,options)=>{
      const target=app.options.projectId;calls.push({kind:'initialize',target,options});
      const instance={target,currentUser:persisted[target]||null,authStateReady:async()=>{await restoration?.(target);}};
      return instances[target]=instance;
    },
    getAuth:app=>instances[app.options.projectId],
    beforeAuthStateChanged:(instance,guard)=>{instance.guard=guard;},
    onAuthStateChanged:(instance,listener)=>{instance.listener=listener;queueMicrotask(()=>listener(instance.currentUser));},
    signOut:async instance=>{calls.push({kind:'out',target:instance.target});if(logoutFailure===instance.target)throw Error('mock-storage-error');instance.currentUser=null;instance.listener?.(null);},
    signInWithCredential:async(instance,credential)=>{
      calls.push({kind:'signin',target:instance.target,credential});
      const result=await (signin?.(instance)||{user:person(),additional:{isNewUser:false}});
      await instance.guard?.(result.user);instance.currentUser=result.user;instance.listener?.(result.user);return result;
    },
    getAdditionalUserInfo:result=>result.additional,
    reauthenticateWithCredential:(user,credential)=>{
      calls.push({kind:'reauth',credential});
      return popupFailure?Promise.reject({code:popupFailure}):Promise.resolve({user,credential});
    },
    GoogleAuthProvider:class{
      setCustomParameters(value){this.parameters=value;}
      static credential(idToken){return {providerId:'google.com',idToken};}
      static credentialFromResult(result){return result.credential;}
    }
  };
  const runtime=createGoogleProjectAuthRuntime({sdk,auth,entries,enabled:true,isOnline:()=>true,randomId:()=> 'installation',
    storage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},requestUri:()=> 'https://fixture.example/',
    restoreTimeoutMs:25,verifyDestination:async args=>{calls.push({kind:'preflight',target:args.entry.config.projectId});return verify?.(args);}});
  return {runtime,auth,instances,apps,calls,saved};
}
test('módulos FC reutilizam a sessão coordenada, incluindo bloqueio de outra identidade e saída global',async()=>{
  const h=fixture({persisted:{FC:person()}});
  const fc=h.runtime.getTargetAuth('FC');
  await h.runtime.reconcile(h.auth.currentUser);
  assert.equal(h.runtime.getTargetAuth('FC'),fc);
  assert.equal(h.calls.filter(c=>c.kind==='initialize'&&c.target==='FC').length,1);
  assert.throws(()=>fc.guard(person('different-uid')),/AUTH_UID_MISMATCH/);
  await h.runtime.controller.signOutAll();
  assert.equal(fc.currentUser,null);
});

test('uma confirmação Google conecta quatro destinos com SDK e mesma identidade',async()=>{
  const f=fixture();await f.runtime.reconcile(f.auth.currentUser);
  const first=f.runtime.confirm(credential),second=f.runtime.confirm(credential);assert.equal(first,second);await first;
  assert.equal(f.calls.filter(c=>c.kind==='reauth').length,1);
  assert.deepEqual(f.calls.filter(c=>c.kind==='signin').map(c=>c.target).sort(),['FB','FC','FD','FE']);
  assert.ok(f.calls.filter(c=>c.kind==='signin').every(c=>c.credential.idToken===idToken));
  assert.equal(f.runtime.controller.snapshot().complete,true);
  assert.ok([...f.saved.values()].every(v=>!v.includes(idToken)&&!v.includes('fixture@example')));
});

test('credencial do login primário conecta destinos existentes sem segunda reautenticação',async()=>{
 const f=fixture();await f.runtime.connectFromPrimarySignIn(credential,f.auth.currentUser);
 assert.equal(f.runtime.controller.snapshot().complete,true);
 assert.equal(f.calls.filter(c=>c.kind==='signin').length,4);
 assert.equal(f.calls.filter(c=>c.kind==='reauth').length,0);
});
test('credencial inicial de outra identidade nunca conecta os destinos',()=>{
 const f=fixture();assert.throws(()=>f.runtime.connectFromPrimarySignIn(credential,person('another-uid')),/AUTH_GOOGLE_IDENTITY_MISMATCH/);
 assert.equal(f.calls.length,0);
});
test('restauração SDK usa cadeia IndexedDB/local/memória sem preflight nem nova entrada',async()=>{
  const f=fixture({persisted:Object.fromEntries(['FB','FC','FD','FE'].map(t=>[t,person()]))});
  await f.runtime.reconcile(f.auth.currentUser);
  assert.equal(f.runtime.controller.snapshot().complete,true);
  assert.equal(f.calls.filter(c=>['reauth','signin','preflight'].includes(c.kind)).length,0);
  assert.ok(f.calls.filter(c=>c.kind==='initialize').every(c=>JSON.stringify(c.options.persistence)==='["indexeddb","local","memory"]'));
});
test('conta ausente em FC não chega ao SDK signIn e preserva demais sessões',async()=>{
  const f=fixture({verify:args=>{if(args.entry.config.projectId==='FC')throw {code:'AUTH_EXISTING_ACCOUNT_REQUIRED'};}});
  await f.runtime.confirm(credential);assert.equal(f.calls.some(c=>c.kind==='signin'&&c.target==='FC'),false);
  assert.equal(f.runtime.controller.snapshot().targets.FC.code,'AUTH_EXISTING_ACCOUNT_REQUIRED');
  assert.equal(f.auth.currentUser.uid,'same-uid');assert.equal(f.instances.FE.currentUser.uid,'same-uid');
});
test('guard do SDK impede sessão com UID divergente antes de ficar visível',async()=>{
  const f=fixture({signin:instance=>({user:person(instance.target==='FC'?'wrong-uid':'same-uid'),additional:{isNewUser:false}})});
  await f.runtime.confirm(credential);assert.equal(f.instances.FC.currentUser,null);assert.equal(f.auth.currentUser.uid,'same-uid');
  assert.equal(f.runtime.controller.snapshot().targets.FC.code,'AUTH_UID_MISMATCH');
});
test('SDK que retorna conta nova é recusado mesmo se retornar UID esperado',async()=>{
  const f=fixture({signin:()=>({user:person(),additional:{isNewUser:true}})});
  await f.runtime.confirm(credential);assert.equal(f.runtime.controller.snapshot().complete,false);
  for(const target of ['FB','FC','FD','FE'])assert.equal(f.instances[target].currentUser,null);
});
test('logout invalida preflight em andamento e encerra todas as instâncias',async()=>{
  const entered=deferred(),finish=deferred();const f=fixture({verify:async()=>{entered.resolve();await finish.promise;}});
  const connecting=f.runtime.confirm(credential);await entered.promise;
  const leaving=f.runtime.controller.signOutAll();finish.resolve();await Promise.allSettled([connecting,leaving]);
  assert.ok(Object.values(f.instances).every(instance=>instance.currentUser===null));
  assert.equal(f.calls.filter(c=>c.kind==='signin').length,0);
});
test('observação de FA deslogado não encerra um novo login na conta principal',async()=>{
  const f=fixture();f.auth.currentUser=null;
  const cleanup=f.runtime.reconcile(null);f.auth.currentUser=person('new-person');
  await f.runtime.reconcile(f.auth.currentUser);await cleanup;
  assert.equal(f.auth.currentUser.uid,'new-person');assert.equal(f.calls.some(c=>c.kind==='out'&&c.target==='FA'),false);
});
test('reauth rejeitada preserva sessões sem repetir a requisição',async()=>{
  const f=fixture({popupFailure:'auth/invalid-credential',persisted:{FB:person()}});await f.runtime.reconcile(f.auth.currentUser);
  await assert.rejects(f.runtime.confirm(credential),{code:'auth/invalid-credential'});
  assert.equal(f.calls.filter(c=>c.kind==='reauth').length,1);assert.equal(f.instances.FB.currentUser.uid,'same-uid');
  assert.equal(f.calls.filter(c=>c.kind==='signin'||c.kind==='out').length,0);
});
test('erro de armazenamento em um destino não evita saída dos demais',async()=>{
  const f=fixture({logoutFailure:'FC'});await f.runtime.reconcile(f.auth.currentUser);
  assert.equal((await f.runtime.controller.signOutAll()).status,'partial');
  assert.equal(f.auth.currentUser,null);assert.equal(f.instances.FE.currentUser,null);
});
test('restauração lenta recebe prazo sem consultas nem encerrar conta válida',async()=>{
  const f=fixture({restoration:target=>target==='FC'?new Promise(()=>{}):undefined});
  await f.runtime.reconcile(f.auth.currentUser);
  assert.equal(f.runtime.controller.snapshot().targets.FC.code,'AUTH_RESTORE_TIMEOUT');
  assert.equal(f.auth.currentUser.uid,'same-uid');assert.equal(f.calls.some(c=>c.kind==='preflight'),false);
});
test('app Firebase existente com configuração errada não é aproveitado',async()=>{
  const f=fixture();f.apps.push({name:entries.FC.appName,options:{projectId:'wrong-project',appId:'wrong-app'}});
  await f.runtime.reconcile(f.auth.currentUser);
  assert.equal(f.runtime.controller.snapshot().targets.FC.code,'AUTH_CONFIGURATION_REQUIRED');
});
test('selecionar outra conta Google na atualização não chama Firebase nem cria sessão',()=>{
  const f=fixture();const wrong={...credential,idToken:'header.'+Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:'source-client',sub:'other-google'})).toString('base64url')+'.signature'};
  assert.throws(()=>f.runtime.confirm(wrong),{code:'AUTH_GOOGLE_IDENTITY_MISMATCH'});
  assert.equal(f.calls.length,0);assert.equal(f.auth.currentUser.uid,'same-uid');
});
test('mudança do armazenamento em outra aba limpa o destino divergente',async()=>{
  const f=fixture({persisted:{FB:person()}});await f.runtime.reconcile(f.auth.currentUser);
  const changed=person('another-person');f.instances.FB.currentUser=changed;f.instances.FB.listener(changed);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.instances.FB.currentUser,null);assert.equal(f.runtime.controller.snapshot().targets.FB.status,'pending');
});
test('origem sem vínculo Google limpa sessões antigas e expõe pendência administrativa',async()=>{
  const f=fixture({persisted:{FB:person(),FC:person(),FD:person(),FE:person()}});await f.runtime.reconcile(f.auth.currentUser);
  f.auth.currentUser={uid:'unlinked-person',providerData:[]};await f.runtime.reconcile(f.auth.currentUser);
  for(const t of ['FB','FC','FD','FE'])assert.equal(f.instances[t].currentUser,null);
  assert.equal(f.runtime.controller.snapshot().uid,'unlinked-person');
  assert.equal(f.runtime.controller.snapshot().targets.FA.code,'AUTH_SOURCE_GOOGLE_LINK_REQUIRED');
});
test('logout antigo não encerra conta nova surgida enquanto uma conexão termina',async()=>{
  const entered=deferred(),finish=deferred();const f=fixture({verify:async()=>{entered.resolve();await finish.promise;}});
  const connecting=f.runtime.confirm(credential);await entered.promise;
  const leaving=f.runtime.controller.signOutAll();
  assert.throws(()=>f.runtime.assertCanStartPrimarySignIn(),{code:'AUTH_LOGOUT_IN_PROGRESS'});
  f.auth.currentUser=person('new-person');finish.resolve();await Promise.allSettled([connecting,leaving]);
  assert.equal(f.auth.currentUser.uid,'new-person');assert.equal((await leaving).status,'superseded');
});
