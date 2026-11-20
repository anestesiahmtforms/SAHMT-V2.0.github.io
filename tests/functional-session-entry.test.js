import {renderOperationalFolderDirectory} from '../src/operational-folder-directory.js';
import {formatCalendarDuration,formatDisplayDateTime} from '../src/date-format.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createGoogleProjectAuth} from '../src/google-project-auth-core.js';
const person={uid:'same-uid',providerData:[{providerId:'google.com',uid:'same-google'}]};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('the Functional professional entry loads complete records for the owner or an authorized admin with a selected member',async()=>{
 const person={uid:'member',email:'member@example.invalid'},calls=[];
 const record={uid:person.uid,email:person.email,answers:{fullName:'Pessoa Sintética',formation:['TEA'],motherName:'Mãe Sintética'}};
 const files=[{name:'cv.pdf',subject:'CV',status:'STORED'}];
 let selectedRecord=record,driveError=false;
 const source=readFileSync(new URL('../src/functional-results.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
 const context=vm.createContext({fcProfessionalRegistrationEnabled:true,
  callRegistrationApi:async options=>{calls.push(options);
   if(['BOOTSTRAP','DETAIL'].includes(options.action))return {record:selectedRecord};
   if(driveError)throw Error('NOT_AVAILABLE');
   return {files};
  }});
 vm.runInContext(source,context);
 const load=(subjectUid,administrator=false)=>context.loadFunctionalResult({key:'professionalRegistration',uid:person.uid,subjectUid,administrator,
  faAuth:{currentUser:person},isCurrent:()=>true});
 const other=await load('other');
 assert.equal(other.ownOnly,true);
 assert.equal(calls.length,0);
 const own=await load(person.uid);
 assert.equal(own.record,record);
 assert.equal(own.files,files);
 assert.deepEqual(calls.map(({kind,action})=>[kind,action]),[['professional','BOOTSTRAP'],['drive','LIST_OWN']]);
 selectedRecord={...record,uid:'other'};
 const mismatch=await load(person.uid);
 assert.equal(mismatch.record,null);
 assert.equal(mismatch.files?.length??0,0);
 selectedRecord=record;driveError=true;
 const partial=await load(person.uid);
 assert.equal(partial.record,record);
 assert.equal(partial.files,null);
 driveError=false;
 calls.length=0;
 selectedRecord={...record,uid:'other',email:'other@example.invalid'};
 const selected=await load('other',true);
 assert.equal(selected.record,selectedRecord);
 assert.equal(selected.files,files);
 assert.deepEqual(calls.map(({kind,action,input})=>[kind,action,input.uid]),[
  ['professional','DETAIL','other'],['drive','LIST_SUBJECT','other']
 ]);
});

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

test('FK retries a temporary eligibility failure while the FA login credential is available',async()=>{
 const credential={idToken:'ephemeral'},calls=[];
 let reads=0;
 const controller=createGoogleProjectAuth({targets:['FA','FK'],getPrimaryUser:()=>person,
  canConnectTarget:async()=>{if(++reads===1)throw {code:'auth/network-request-failed'};return true;},
  restoreTarget:async()=>null,signOutTarget:async()=>{},sleep:async()=>{},
  connectTarget:async(target,proof)=>{calls.push([target,proof]);return person;}});
 await controller.connect(credential);
 assert.equal(reads,2);
 assert.deepEqual(calls,[['FK',credential]]);
 assert.equal(controller.snapshot().targets.FK.status,'ready');
});

test('FK folder policy waits for verified auth and reopens after a terminated listener',async()=>{
 const policy={disabled:[]},requests=[],events=new Map();
 let authChanged,state={uid:person.uid,targets:{FK:{status:'pending'}}};
 const controller={snapshot:()=>state,subscribe(callback){authChanged=callback;callback(state);return()=>{authChanged=null;};}};
 const code=readFileSync(new URL('../src/functional-folder-policy.js',import.meta.url),'utf8')
  .replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'')
  .replaceAll("import('./functional-firebase.js')",'Promise.resolve(firebase)')
  .replaceAll("import('./google-project-auth-runtime.js')",'Promise.resolve(runtime)');
 const context=vm.createContext({
  firebase:{getFunctionalFirestore:()=>({})},runtime:{googleProjectAuth:controller,verifyGoogleProjectSession:async()=>true},
  doc:(_db,...path)=>path.join('/'),onSnapshot:(path,options,next,error)=>{
   const request={path,next,error,stopped:false};requests.push(request);return()=>{request.stopped=true;};
  },
  navigator:{onLine:true},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),
  functionalFolderPolicyValid:value=>value===policy
 });
 vm.runInContext(code,context);
 context.watchFunctionalFolderPolicy(person.uid);
 await turn();
 assert.equal(requests.length,0);
 state={...state,targets:{FK:{status:'ready'}}};authChanged(state);
 await turn();
 assert.equal(requests[0].path,'runtimePolicy/folders');
 requests[0].next({metadata:{},exists:()=>true,data:()=>policy});
 assert.equal(vm.runInContext('functionalFolderPolicy()',context),policy);
 requests[0].error({code:'unavailable'});
 assert.equal(vm.runInContext('functionalFolderPolicy()',context),null);
 events.get('online')();
 await turn();
 assert.equal(requests.length,2);
 context.watchFunctionalFolderPolicy('');
 assert.equal(requests[1].stopped,true);
 assert.equal(authChanged,null);
});

function ui({folderAllowed=()=>true,connected=true,fkState={status:'pending',code:'AUTH_GOOGLE_SESSION_REQUIRED'},refresh=async()=>{},initialReadFails=false,profileUid=person.uid,administrator=false,readTeam=async()=>({snapshot:null,recognition:null})}={}){
 const source=readFileSync(new URL('../src/functional-ui.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env','env');
 const updates=[],auth={currentUser:{uid:person.uid}},sources={innerHTML:''},status={textContent:''};
 let recovery=0,retries=0,reads=0,authChanged;
 const intro={hidden:false},topics={hidden:true},tenure={hidden:true},duration={},topicsTitle={focus(){this.focused=true;}};
 const listeners=new Map(),recognition={hidden:true},teamStatus={},select={disabled:true,focus(){}},owner={};
 const picker={hidden:true,querySelector:s=>s==='[data-fk-subject]'?select:teamStatus};
 const button={setAttribute(){},focus(){}},detailBody={innerHTML:'',replaceChildren(){this.innerHTML='';}},detailTitle={},detailIcon={};
 const detail={open:false,showModal(){this.open=true;},close(){this.open=false;this.onClose?.();},
  addEventListener(key,fn){if(key==='close')this.onClose=fn;},
  querySelector:key=>({'[data-fk-detail-body]':detailBody,'#fk-detail-title':detailTitle,'[data-fk-detail-icon]':detailIcon})[key]};
 const openSource=key=>listeners.get('click')({target:{closest:s=>s==='[data-fk-source]'?{dataset:{fkSource:key}}:null}});
 const retryButton={addEventListener:(_event,listener)=>{retryButton.click=listener;}};
 const hosts={'#fk-detail':detail,'[data-fk-sources]':sources,'[data-fk-refresh-status]':status,'[data-fk-owner]':owner,'[data-fk-recognition]':recognition,'[data-fk-picker]':picker,'[data-fk-retry]':retryButton,'[data-fk-intro]':intro,'[data-fk-topics]':topics,'[data-fk-topics-title]':topicsTitle,
  '[data-fk-tenure]':tenure,'[data-fk-duration]':duration,'[data-fk-open-topics]':button};
 const header={querySelector:s=>hosts[s]};
 const root={isConnected:true,innerHTML:'',addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),querySelector:s=>hosts[s],closest:()=>({querySelector:()=>header})};
 const openPicker=()=>listeners.get('click')({target:{closest:s=>s==='[data-fk-team]'?button:null}});
 const choose=value=>listeners.get('change')({target:{value,matches:s=>s==='[data-fk-subject]'}});
 const show=key=>listeners.get('click')({target:{closest:selector=>selector==='[data-fk-'+key+']'?button:null}});
 const context=vm.createContext({renderOperationalFolderDirectory,formatCalendarDuration:date=>formatCalendarDuration(date,'2026-11-19'),formatDisplayDateTime,setTimeout,clearTimeout,env:{VITE_FK_INSTITUTIONAL_SURVEYS_ENABLED:'true'},
  onAuthStateChanged:(_auth,callback)=>{authChanged=callback;return()=>{};},
  getFunctionalAuth:()=>auth,getFunctionalFirestore:()=>({}),waitForGoogleProjectSession:async()=>connected,
  googleProjectAuth:{snapshot:()=>({targets:{FK:fkState}})},
  readFunctionalTeamOverview:readTeam,listFunctionalTeam:async()=>[{uid:'ana',name:'Ana'},{uid:'bia',name:'Bia'}],
  refreshFunctionalOverview:refresh,operationalContentAllowed:folderAllowed,operationalFolderNotice:()=>'',doc:(_db,...path)=>path.join('/'),
  getDocFromServer:async path=>{if(path.startsWith('functionalRecognition'))return {exists:()=>true,data:()=>({uid:person.uid,message:'Mensagem própria',teamJoinedOn:'2019-09-01'})};reads++;if(initialReadFails&&reads===1)throw Error('permission-denied');return {exists:()=>path.startsWith('functionalProfiles'),data:()=>({uid:profileUid,sources:{professionalRegistration:{state:'READY',data:{record:true}},biosafetyManual:{state:'READY'}}})};}});
 vm.runInContext(source,context);
 return {root,sources,status,owner,recognition,intro,topics,tenure,duration,topicsTitle,show,select,openPicker,choose,detail,detailBody,detailTitle,openSource,updates,run:()=>context.mountFunctionalModule(root,{uid:person.uid,faAuth:auth,administrator,displayName:'Pessoa autenticada',onSessionRequired:()=>recovery++,onRetry:()=>retries++}),recovery:()=>recovery,retries:()=>retries,retryButton,changeFkUser:uid=>authChanged({uid})};
}

test('a temporary FK recovery failure stays in the module and retries instead of requesting a Google login',async()=>{
 const f=ui({connected:false,fkState:{status:'pending',code:'AUTH_ELIGIBILITY_UNAVAILABLE'}});
 const cleanup=await f.run();
 assert.equal(f.recovery(),0);
 assert.match(f.root.innerHTML,/Tentar novamente/);
 f.retryButton.click();
 assert.equal(f.retries(),1);
 cleanup();
});

test('FK renders its profile before a slow refresh resolves',async()=>{
 const gate=deferred(),f=ui({refresh:()=>gate.promise});const cleanup=await f.run();
 assert.doesNotMatch(f.root.innerHTML,/data-fk-team|data-fk-survey|Biossegurança/);
 assert.deepEqual([...f.root.innerHTML.matchAll(/data-fk-source="([^"]+)"/g)].map(m=>m[1]),
  ['performance','professionalRegistration','dosimetry','vaccination','climate','stress','epidemiological','notifications']);
 assert.equal(f.root.innerHTML.match(/data-fk-source="([^"]+)"/)?.[1],'performance');
 assert.match(f.root.innerHTML,/aria-haspopup="dialog"/);
 assert.match(f.root.innerHTML,/data-fk-topics hidden/);
 assert.equal(f.intro.hidden,false);
 await turn();
 assert.equal(f.tenure.hidden,false);
 assert.equal(f.duration.textContent,'7 anos, 2 meses e 18 dias');
 f.show('open-topics');
 assert.equal(f.topics.hidden,false);
 assert.equal(f.intro.hidden,true);
 assert.equal(f.tenure.hidden,true);
 assert.equal(f.topicsTitle.focused,true);
 f.show('back-intro');
 assert.equal(f.topics.hidden,true);
 assert.equal(f.tenure.hidden,false);
 assert.doesNotMatch(f.root.innerHTML,/ACESSO INDIVIDUAL|SAHMT/);
 const loaded=f.sources.innerHTML;
 cleanup();gate.resolve();await turn();assert.equal(f.sources.innerHTML,loaded);
 assert.equal(f.tenure.hidden,true);
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
  assert.match(f.root.innerHTML,/data-fk-dose-admin>Atualizar histórico de dosimetria/);
  f.openPicker();await turn();
  assert.match(f.select.innerHTML,/<option value="ana">Ana<\/option>/);
  const first=f.choose('ana');
  assert.equal(f.sources.innerHTML,'');
  assert.equal(f.recognition.hidden,true);
  await f.choose('bia');assert.deepEqual(calls,['ana','bia']);
  assert.equal(f.owner.textContent,'Bia');assert.equal(f.recognition.textContent,'Mensagem da Bia');assert.match(f.sources.innerHTML,/Histórico Vacinal/);
  ana.resolve({snapshot:{uid:'ana',sources:{dosimetry:{state:'READY'}}},recognition:'Mensagem da Ana'});
  own.resolve();await first;await turn();
  f.openSource('performance');
  assert.equal(f.detail.open,true);
  assert.equal(f.detailTitle.textContent,'Desempenho');
  assert.match(f.detailBody.innerHTML,/PONTOS TOTAIS ADQUIRIDOS[\s\S]*12,5[\s\S]*data-tone="high">81%[\s\S]*Margens de avaliação/);
  assert.match(f.sources.innerHTML,/Histórico Vacinal/);
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
 await turn();
 assert.equal(f.owner.textContent,'Pessoa autenticada');
 assert.equal(f.recognition.textContent,'Mensagem própria');
 assert.match(f.root.innerHTML,/Cadastro Profissional/);
 f.changeFkUser('other-uid');
 assert.doesNotMatch(f.root.innerHTML,/Cadastro Profissional/);
 assert.equal(f.owner.hidden,true);
 assert.equal(f.recognition.hidden,true);
 assert.equal(f.recognition.textContent,'');
});


test('inactive Funcional keeps the nested directory visible without starting source reads',async()=>{
 let refreshes=0;
 const f=ui({folderAllowed:()=>false,refresh:async()=>refreshes++});
 const cleanup=await f.run();
 assert.match(f.root.innerHTML,/<summary><span>Biossegurança<\/span>[\s\S]*<summary><span>Dosimetria<\/span>/);
 assert.match(f.root.innerHTML,/Pesquisas institucionais/);
 assert.doesNotMatch(f.root.innerHTML,/data-fk-dose-admin|iframe/);
 assert.equal(refreshes,0);
 cleanup();
});

test('inactive functional subfolder opens its status without launching a result request',async()=>{
 const f=ui({folderAllowed:id=>id!=='funcional/cadastro-profissional'});
 const cleanup=await f.run();
 assert.match(f.root.innerHTML,/data-fk-source="professionalRegistration"[^>]*>/);
 assert.doesNotMatch(f.root.innerHTML,/data-fk-source="professionalRegistration"[^>]*disabled/);
 f.openSource('professionalRegistration');
 assert.equal(f.detail.open,true);
 assert.match(f.detailBody.innerHTML,/Cadastro profissional/);
 assert.doesNotMatch(f.detailBody.innerHTML,/data-fk-result|Consultando/);
 cleanup();
});
