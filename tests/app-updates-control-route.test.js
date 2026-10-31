import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
const render=main.slice(main.indexOf('async function render() {'),main.indexOf('function renderOnlineGate()'));
const click=main.slice(main.lastIndexOf("document.addEventListener('click',async event=>{"),main.indexOf('const targetedAppUpdates='));
const authorized=()=>({status:'signed-in',offline:false,user:{uid:'fixture-admin'},profile:{uid:'fixture-admin',active:true,access:true,role:'administrador_app',permissions:{}}});

function harness({target='FA',route='app-updates-control',session=authorized(),loadPanel}={}){
 const assignments=[],panels=[],cleanups=[],listeners=new Map(),app={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
 const ctx=vm.createContext({session,app,navigator:{onLine:true},location:{hash:'#/'+route,assign:url=>assignments.push(url)},
  deployment:{target,externalManagementEnabled:true,faBase:'/SAHMT-V2.0.github.io/',fbBase:'/SAHMT-V2.0.github.io/gestao/'},
  rememberModuleNavigation(){},rememberManagementReturn(){},repairAppFiles:()=>false,staleModuleFailure:()=>false,
  loadSession:async()=>({ensureManagementSession:async()=>true}),
  document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(type,listener)=>listeners.set(type,listener)},
  evaluationModuleGeneration:0,googleAccessPanel:null,scheduleGridObserver:null,operationalDrafts:{flush(){}},updateInformationBanner(){},
  liveReports:new Map(),reportStates:new Map(),reportPayloads:new Map(),labelReportLoad:0,labelReportLoadingMore:false,labelReportState:'idle',cleanupLabelMedia:null,
  stopChecklistQrScanner(){},cleanupDocumentTraining:null,cleanupUserInspection:null,cleanupCurrentModule:null,startupBannerActive:false,
  isOfflineRuntimeForced:()=>false,onlineValidationRequired:false,renderOnlineGate:()=>{app.innerHTML='Online gate';},loginView:()=>'Login',bindLogin(){},
  can:permission=>ctx.session.profile?.role==='administrador_app'||ctx.session.profile?.permissions?.[permission]===true,
  canUseYearEndSchedule:()=>false,canUseGovernanceHub:()=>false,deniedOperationalModules:new Set(),notice:'',
  canOpenRestrictedModule:()=>false,hasOccurrencePermission:()=>false,featureEnabledForRoute:()=>true,appFeatures:{},
  shellView:()=>'Shell',bindProfileRetryControl(){},preloadOperationalDataWhenIdle(){},updateOutboxStatus(){},loadHome(){},loadModule(){},bindModuleForm(){},
  loadPanel:loadPanel||(async()=>({openAppUpdatePanel:async options=>{panels.push(options);const cleanup=()=>cleanups.push(options);return cleanup;}}))
 });
 vm.runInContext((router+'\n'+render+'\n'+click).replaceAll('import.meta.env.BASE_URL',"'/'")
  .replaceAll("import('./management-entry-session.js')",'loadSession()')
  .replaceAll("await import('./app-updates-targeted-admin.js')",'await loadPanel()'),ctx);
 return {ctx,app,assignments,panels,cleanups,render:()=>ctx.render(),click:()=>listeners.get('click')({target:{closest:selector=>selector==='[data-app-update-panel]'?{}:null}})};
}

test('the Management control button in FB navigates to the principal FA app',async()=>{
 const h=harness({target:'FB',route:'management'});await h.click();
 assert.deepEqual(h.assignments,['/SAHMT-V2.0.github.io/#/app-updates-control']);
 assert.equal(h.panels.length,0,'FB must not read or request updates in its own database');
});

test('the FA control route stays in FA with cutover active and exits through Management',async()=>{
 const h=harness();await h.render();
 assert.equal(h.ctx.currentRoute(),'app-updates-control');
 assert.deepEqual(h.assignments,[]);assert.equal(h.panels.length,1);
 assert.equal(h.panels[0].target,'FA');assert.equal(h.panels[0].isCurrent(),true);
 await h.panels[0].onExit();
 assert.deepEqual(h.assignments,['/SAHMT-V2.0.github.io/gestao/#/management']);
});

test('a direct control hash in FB forwards to FA before reading any receipts',async()=>{
 const h=harness({target:'FB'});await h.render();
 assert.deepEqual(h.assignments,['/SAHMT-V2.0.github.io/#/app-updates-control']);assert.equal(h.panels.length,0);
});

for(const [name,mutate] of [
 ['common user',s=>s.profile.role='anestesiologista'],
 ['inactive admin',s=>s.profile.active=false],
 ['blocked access',s=>s.profile.access=false],
 ['profile validation',s=>s.validatingProfile=true],
 ['limited session',s=>s.status='auth-limited'],
 ['signed out',s=>s.status='signed-out'],
 ['offline',s=>s.offline=true]
])test(`the dedicated control route performs no reads for ${name}`,async()=>{
 const session=authorized();mutate(session);const h=harness({session});await h.render();
 assert.equal(h.panels.length,0);assert.deepEqual(h.assignments,[]);
 if(name==='common user'||name==='inactive admin'||name==='blocked access')assert.equal(h.ctx.location.hash,'#/home');
});

test('an admin revocation while loading the control module prevents opening it',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);let opens=0,loads=0;
 const h=harness({loadPanel:()=>{loads++;return pending;}}),opening=h.render();await Promise.resolve();assert.equal(loads,1);
 h.ctx.session.profile.role='anestesiologista';finish({openAppUpdatePanel:async()=>{opens++;return()=>{};}});await opening;
 assert.equal(opens,0);
});

test('teardown and stale exits never navigate back to Management',async()=>{
 const h=harness();await h.render();assert.equal(h.panels.length,1);
 h.ctx.session.profile.role='anestesiologista';await h.render();
 assert.equal(h.cleanups.length,1);assert.deepEqual(h.assignments,[]);
 await h.panels[0].onExit();assert.deepEqual(h.assignments,[]);
});
