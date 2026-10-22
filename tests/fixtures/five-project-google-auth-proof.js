import * as firebaseApp from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import {GOOGLE_PROJECT_CONFIG} from '../../src/google-project-auth-config.js';
import {createGoogleProjectAuthRuntime} from '../../src/google-project-auth-adapter.js';
import {createGoogleProjectAuthGoogleButton} from '../../src/google-project-auth-google-button.js';
import {googleIdentity,safeGoogleAuthCode} from '../../src/google-project-auth-core.js';
import {verifyExistingGoogleDestination} from '../../src/google-project-auth-preflight.js';
import {authProofReport} from './five-project-google-auth-report.js';

// Development fixture only. It is not an entry in the production build or service worker.
if(!import.meta.env.DEV||!['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw Error('LOCAL_AUTH_PROOF_ONLY');
const PILOT_UID='uqpHmC2940UGXiOmrYCief6Z0R73';
const projects=['FA','FB','FC','FD','FE'];
const element=id=>document.getElementById(id);
const source=GOOGLE_PROJECT_CONFIG.FA;
const app=firebaseApp.getApps().find(value=>value.name===source.appName)||firebaseApp.initializeApp(source.config,source.appName);
if(app.options.projectId!==source.config.projectId||app.options.appId!==source.config.appId)throw Error('AUTH_CONFIGURATION_REQUIRED');
let auth;
try{auth=firebaseAuth.initializeAuth(app,{persistence:[firebaseAuth.indexedDBLocalPersistence,firebaseAuth.browserLocalPersistence,firebaseAuth.inMemoryPersistence]});}
catch(error){if(error.code!=='auth/already-initialized')throw error;auth=firebaseAuth.getAuth(app);}
const evidence={confirmations:0,reauthenticated:false,exchanges:{},code:null,logout:null};
let runtime,widget,report;
function publish(state){
  const user=auth.currentUser;
  const users=Object.fromEntries(projects.map(target=>{
    const app=firebaseApp.getApps().find(value=>value.name===GOOGLE_PROJECT_CONFIG[target].appName);
    return [target,app?firebaseAuth.getAuth(app).currentUser:null];
  }));
  report=authProofReport({state,users,evidence,expectedUid:PILOT_UID});
  element('report').textContent=JSON.stringify(report,null,2);
  element('targets').replaceChildren(...projects.map(target=>{
    const item=document.createElement('li'),value=report.projects[target];
    item.textContent=`${target}: ${value.status}${value.uidMatchesFa===true?' · UID confere':''}${value.code?' · '+value.code:''}`;
    return item;
  }));
  element('restore').disabled=Boolean(state?.busy)||user?.uid!==PILOT_UID;
  element('logout').disabled=Boolean(state?.busy)||user?.uid!==PILOT_UID;
}
function message(code){evidence.code=code; element('status').textContent=code||'Confirme a mesma conta Google no botão abaixo.';publish(runtime?.controller.snapshot());}
runtime=createGoogleProjectAuthRuntime({sdk:{...firebaseApp,...firebaseAuth},auth,entries:GOOGLE_PROJECT_CONFIG,enabled:true,
  requestUri:()=>location.origin+'/',
  verifyDestination:async options=>{
    const target=projects.find(target=>GOOGLE_PROJECT_CONFIG[target]===options.entry);
    evidence.exchanges[target]={status:'attempted'};
    try{const result=await verifyExistingGoogleDestination(options);evidence.exchanges[target]={status:'passed'};return result;}
    catch(error){evidence.exchanges[target]={status:'failed',code:safeGoogleAuthCode(error)};throw error;}
  }});
runtime.controller.subscribe(publish);
firebaseAuth.onAuthStateChanged(auth,async user=>{
  widget?.dispose();widget=null;
  element('google').replaceChildren();
  if(user?.uid!==PILOT_UID){
    runtime.controller.invalidate();element('source').textContent='A sessão administrativa FA ainda não está aberta nesta origem.';
    message(user?'AUTH_PILOT_ACCOUNT_REQUIRED':'AUTH_SOURCE_REQUIRED');return;
  }
  element('source').textContent='Sessão administrativa FA encontrada. A prova está restrita a esta identidade.';
  if(!googleIdentity(user)){message('AUTH_SOURCE_GOOGLE_LINK_REQUIRED');return;}
  try{
    const restored=await runtime.reconcile(user);
    if(auth.currentUser!==user)return;
    if(restored.complete){message('AUTH_RESTORE_OBSERVED');return;}
    widget=createGoogleProjectAuthGoogleButton({clientId:source.acceptedGoogleClientIds[0],getExpectedIdentity:()=>googleIdentity(auth.currentUser),
      onCredential:async credential=>{
        evidence.confirmations++;evidence.code=null;
        try{const state=await runtime.confirm(credential);evidence.reauthenticated=true;publish(state);message(state.complete?'AUTH_PROOF_CONNECTED':'AUTH_PROOF_PARTIAL');}
        catch(error){message(safeGoogleAuthCode(error));throw error;}
      },
      onLoading:busy=>{element('status').textContent=busy?'Conferindo as sessões…':'Confirmação encerrada. Confira o relatório.';},
      onError:error=>message(safeGoogleAuthCode(error))});
    await widget.render(element('google'));message(null);
  }catch(error){message(safeGoogleAuthCode(error));}
});
element('restore').addEventListener('click',async()=>{
  if(auth.currentUser?.uid!==PILOT_UID)return;
  try{await runtime.reconcile(auth.currentUser);message('AUTH_RESTORE_OBSERVED');}catch(error){message(safeGoogleAuthCode(error));}
});
element('logout').addEventListener('click',async()=>{
  if(auth.currentUser?.uid!==PILOT_UID)return;
  evidence.logout=await runtime.controller.signOutAll();publish(runtime.controller.snapshot());
});
element('copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));element('copy').textContent='RELATÓRIO COPIADO';}
  catch{element('status').textContent='Selecione e copie o relatório exibido abaixo.';}
});
window.addEventListener('pagehide',()=>widget?.dispose(),{once:true});
