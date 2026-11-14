import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createGoogleProjectAuth} from '../src/google-project-auth-core.js';
const person={uid:'same-uid',providerData:[{providerId:'google.com',uid:'same-google'}]};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('FK connects from the FA credential while an unrelated restoration is stalled',async()=>{
 const gate=deferred(),calls=[];
 const controller=createGoogleProjectAuth({targets:['FA','FB','FK'],getPrimaryUser:()=>person,
  restoreTarget:async target=>{if(target==='FB')await gate.promise;return null;},
  connectTarget:async(target,credential)=>{calls.push([target,credential]);return person;},signOutTarget:async()=>{}});
 const credential={idToken:'ephemeral'},connecting=controller.connect(credential);
 try{await turn();assert.equal(controller.snapshot().targets.FK.status,'ready');assert.equal(calls[0][1],credential);}
 finally{gate.resolve();await connecting;}
});

test('a group excluded from FK completes other sessions without FK credential exchange',async()=>{
 const calls=[];
 const controller=createGoogleProjectAuth({targets:['FA','FB','FK'],getPrimaryUser:()=>person,
  canConnectTarget:async target=>target!=='FK',restoreTarget:async()=>null,
  connectTarget:async target=>{calls.push(target);return person;},signOutTarget:async()=>{}});
 await controller.connect({idToken:'ephemeral'});
 assert.deepEqual(calls,['FB']);assert.equal(controller.snapshot().targets.FK.status,'excluded');
 controller.observeTarget('FK',null);assert.equal(controller.snapshot().complete,true);
});

function ui({connected=true,refresh=async()=>{},initialReadFails=false,profileUid=person.uid,administrator=false,readTeam=async()=>({snapshot:null,recognition:null})}={}){
 const source=readFileSync(new URL('../src/functional-ui.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env','env');
 const updates=[],auth={currentUser:{uid:person.uid}},sources={innerHTML:''},status={textContent:''};
 let recovery=0,reads=0,authChanged;
 const listeners=new Map(),recognition={hidden:true},teamStatus={},select={disabled:true,focus(){}},owner={};
 const picker={hidden:true,querySelector:s=>s==='[data-fk-subject]'?select:teamStatus};
 const button={setAttribute(){},focus(){}},detailBody={innerHTML:'',replaceChildren(){this.innerHTML='';}},detailTitle={},detailIcon={};
 const detail={open:false,showModal(){this.open=true;},close(){this.open=false;this.onClose?.();},
  addEventListener(key,fn){if(key==='close')this.onClose=fn;},
  querySelector:key=>({'[data-fk-detail-body]':detailBody,'#fk-detail-title':detailTitle,'[data-fk-detail-icon]':detailIcon})[key]};
 const openSource=key=>listeners.get('click')({target:{closest:s=>s==='[data-fk-source]'?{dataset:{fkSource:key}}:null}});
 const hosts={'#fk-detail':detail,'[data-fk-sources]':sources,'[data-fk-refresh-status]':status,'[data-fk-owner]':owner,'[data-fk-recognition]':recognition,'[data-fk-picker]':picker};
 const root={isConnected:true,innerHTML:'',addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),querySelector:s=>hosts[s]};
 const openPicker=()=>listeners.get('click')({target:{closest:s=>s==='[data-fk-team]'?button:null}});
 const choose=value=>listeners.get('change')({target:{value,matches:s=>s==='[data-fk-subject]'}});
 const context=vm.createContext({setTimeout,clearTimeout,env:{VITE_FK_INSTITUTIONAL_SURVEYS_ENABLED:'true'},
  onAuthStateChanged:(_auth,callback)=>{authChanged=callback;return()=>{};},
  getFunctionalAuth:()=>auth,getFunctionalFirestore:()=>({}),waitForGoogleProjectSession:async()=>connected,
  readFunctionalTeamOverview:readTeam,listFunctionalTeam:async()=>[{uid:'ana',name:'Ana'},{uid:'bia',name:'Bia'}],
  refreshFunctionalOverview:refresh,operationalContentAllowed:()=>true,operationalFolderNotice:()=>'',doc:(_db,...path)=>path.join('/'),
  getDocFromServer:async path=>{if(path.startsWith('functionalRecognition'))return {exists:()=>true,data:()=>({uid:person.uid,message:'Mensagem própria'})};reads++;if(initialReadFails&&reads===1)throw Error('permission-denied');return {exists:()=>path.startsWith('functionalProfiles'),data:()=>({uid:profileUid,sources:{professionalRegistration:{state:'READY',data:{record:true}},biosafetyManual:{state:'READY'}}})};}});
 vm.runInContext(source,context);
 return {root,sources,status,owner,recognition,select,openPicker,choose,detail,detailBody,detailTitle,openSource,updates,run:()=>context.mountFunctionalModule(root,{uid:person.uid,faAuth:auth,administrator,displayName:'Pessoa autenticada',onSessionRequired:()=>recovery++}),recovery:()=>recovery,changeFkUser:uid=>authChanged({uid})};
}

test('FK renders its profile before a slow refresh resolves',async()=>{
 const gate=deferred(),f=ui({refresh:()=>gate.promise});const cleanup=await f.run();
 assert.doesNotMatch(f.root.innerHTML,/data-fk-team|data-fk-survey|Pesquisas institucionais|Biossegurança/);assert.match(f.root.innerHTML,/Dados sincronizados/);
 assert.equal(f.root.innerHTML.match(/data-fk-source="([^"]+)"/)?.[1],'performance');
 assert.match(f.root.innerHTML,/aria-haspopup="dialog"/);
 assert.doesNotMatch(f.root.innerHTML,/ACESSO INDIVIDUAL|SAHMT/);
 cleanup();gate.resolve();await turn();assert.equal(f.sources.innerHTML,'');
});

test('administrator selection clears the previous profile and ignores responses for an earlier choice',async()=>{
 const ana=deferred(),own=deferred(),calls=[];
 const f=ui({administrator:true,refresh:()=>own.promise,readTeam:({subjectUid})=>{
  calls.push(subjectUid);
  return subjectUid==='ana'?ana.promise:Promise.resolve({snapshot:{uid:'bia',sources:{vaccination:{state:'READY'}}},recognition:'Mensagem da Bia',performance:{uid:'bia',total:12.5,percentage:81,updatedAt:Date.now()}});
 }});
 const cleanup=await f.run();
 try{
  assert.match(f.root.innerHTML,/Selecionar integrante da Equipe/);
  f.openPicker();await turn();
  assert.match(f.select.innerHTML,/<option value="ana">Ana<\/option>/);
  const first=f.choose('ana');
  assert.equal(f.sources.innerHTML,'');
  assert.equal(f.recognition.hidden,true);
  await f.choose('bia');assert.deepEqual(calls,['ana','bia']);
  assert.equal(f.owner.textContent,'Bia');assert.equal(f.recognition.textContent,'Mensagem da Bia');assert.match(f.sources.innerHTML,/Vacinação/);
  ana.resolve({snapshot:{uid:'ana',sources:{dosimetry:{state:'READY'}}},recognition:'Mensagem da Ana'});
  own.resolve();await first;await turn();
  f.openSource('performance');
  assert.equal(f.detail.open,true);
  assert.equal(f.detailTitle.textContent,'Desempenho');
  assert.match(f.detailBody.innerHTML,/PONTOS TOTAIS ADQUIRIDOS[\s\S]*12,5[\s\S]*data-tone="high">81%[\s\S]*Margens de avaliação/);
  assert.match(f.sources.innerHTML,/Vacinação/);assert.doesNotMatch(f.sources.innerHTML,/Dosimetria|Cadastro Profissional/);
  assert.equal(f.recognition.textContent,'Mensagem da Bia');
  f.detail.close();
  assert.equal(f.detailBody.innerHTML,'');
  await f.choose('');assert.equal(f.owner.textContent,'Pessoa autenticada');assert.equal(f.recognition.textContent,'Mensagem própria');assert.match(f.sources.innerHTML,/Cadastro Profissional/);
 }finally{cleanup();}
});

test('missing FK session returns to central FA recovery without an individual Google button',async()=>{
 const f=ui({connected:false}),cleanup=await f.run();assert.equal(f.recovery(),1);
 assert.doesNotMatch(f.root.innerHTML,/functional-google-auth/);cleanup();
});

test('a first user without a readable snapshot can see Desempenho while generation runs',async()=>{
 const gate=deferred(),f=ui({initialReadFails:true,refresh:()=>gate.promise}),cleanup=await f.run();
 assert.match(f.root.innerHTML,/data-fk-source="performance"/);cleanup();gate.resolve();
});

test('refresh failure preserves the functional screen and reports stale sources',async()=>{
 const f=ui({refresh:async()=>{throw Error('unavailable');}}),cleanup=await f.run();await turn();
 assert.match(f.status.textContent,/não puderam ser atualizadas/);assert.doesNotMatch(f.root.innerHTML,/data-fk-survey|Pesquisas institucionais/);cleanup();
});

test('FK refuses to show a snapshot with a different owner UID',async()=>{
 const f=ui({profileUid:'other-uid',refresh:()=>assert.fail('foreign profile must never be refreshed')});
 await f.run();
 assert.doesNotMatch(f.root.innerHTML,/Dados sincronizados|Cadastro Profissional/);
 assert.match(f.root.innerHTML,/Não foi possível confirmar/);
});

test('FK clears visible data when the destination session changes',async()=>{
 const f=ui();
 await f.run();
 assert.match(f.root.innerHTML,/Cadastro Profissional/);
 f.changeFkUser('other-uid');
 assert.doesNotMatch(f.root.innerHTML,/Cadastro Profissional/);
});
