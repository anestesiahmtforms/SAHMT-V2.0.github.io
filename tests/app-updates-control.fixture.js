import {openAppUpdatePanel as openRealPanel} from '/src/app-updates-targeted-admin.js';

globalThis.__SAHMT_DEPLOYMENT__={target:location.pathname.includes('/gestao/')?'FB':'FA',externalManagementEnabled:true};
const {deployment}=await import('/src/deployment-context.js');
const {rememberModuleNavigation,rememberManagementReturn}=await import('/src/module-navigation.js');
const repairAppFiles=()=>false,staleModuleFailure=()=>false;
const fixtureManagementSession=async()=>({ensureManagementSession:async()=>true});
const app=document.querySelector('#app');
let session={status:'signed-in',offline:false,user:{uid:'fixture-admin'},profile:{uid:'fixture-admin',active:true,access:true,role:sessionStorage.getItem('control-fixture-role')||'administrador_app',permissions:{}}};
let evaluationModuleGeneration=0,googleAccessPanel=null,scheduleGridObserver=null,labelReportLoad=0,labelReportLoadingMore=false,labelReportState='idle';
let cleanupLabelMedia=null,cleanupDocumentTraining=null,cleanupUserInspection=null,cleanupCurrentModule=null,startupBannerActive=false,onlineValidationRequired=false,notice='';
const operationalDrafts={flush(){}},liveReports=new Map(),reportStates=new Map(),reportPayloads=new Map(),deniedOperationalModules=new Set(),appFeatures={};
const updateInformationBanner=()=>{},stopChecklistQrScanner=()=>{},isOfflineRuntimeForced=()=>false,bindLogin=()=>{},bindProfileRetryControl=()=>{};
const can=permission=>session.profile.role==='administrador_app'||session.profile.permissions[permission]===true;
const canUseYearEndSchedule=()=>false,canUseGovernanceHub=()=>false,canOpenRestrictedModule=()=>true,hasOccurrencePermission=()=>false,featureEnabledForRoute=()=>true;
const loginView=()=>'<main>Login</main>',shellView=()=>'<main class="main-content"><div id="module-content"></div></main>';
const preloadOperationalDataWhenIdle=()=>{},updateOutboxStatus=()=>{},bindModuleForm=()=>{},renderOnlineGate=()=>{app.textContent='Online gate';};
const loadHome=()=>{app.textContent='Home';};
const loadModule=route=>{if(route==='management')app.querySelector('#module-content').innerHTML=can('admin')?'<button type="button" data-app-update-panel>CONTROLE DE ATUALIZAÇÕES</button>':'<p>Gestão</p>';};
async function api(action,input={}){
  const response=await fetch('/__control-updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:deployment.target,action,...input})});
  if(!response.ok)throw Error('unavailable');return response.json();
}
const fixturePanel=async()=>({openAppUpdatePanel:options=>openRealPanel({...options,readRelease:async()=>200,services:{
  listAppUpdateUsers:()=>api('users'),readUserAppUpdates:(_,uid)=>api('read',{uid}),
  requestUserAppUpdate:(_,uid,minimumRelease)=>api('request',{uids:[uid],minimumRelease}),
  cancelUserAppUpdate:(_,uid)=>api('cancel',{uid}),sendAppUpdateBatch:(_,uids,minimumRelease)=>api('request',{uids,minimumRelease})
}})});
window.controlFixture={target:deployment.target,cutover:deployment.externalManagementEnabled};
