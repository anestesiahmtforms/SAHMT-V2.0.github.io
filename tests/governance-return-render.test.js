import {canUseVacationModule} from '../src/vacations-2027-domain.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseFragment} from 'parse5';
import {canUseManagementPilot,canUseGovernanceHub,canUseYearEndSchedule} from '../src/management-pilot.js';
import {featureEnabledForRoute, DEFAULT_APP_FEATURES} from '../src/feature-flags.js';
import {shouldRenderHashChange} from '../src/router.js';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
const shell=main.slice(main.indexOf('function shellView() {'),main.indexOf('async function loadHome()'));
const cards=main.slice(main.indexOf('function moduleCards() {'),main.indexOf('function hasOccurrencePermission()'));
const occurrencePermission=main.slice(main.indexOf('function hasOccurrencePermission()'),main.indexOf('function managementUtilityCards()'));
const render=main.slice(main.indexOf('async function render() {'),main.indexOf('async function updateOutboxStatus()'));
const hubLoader=main.slice(main.indexOf('async function loadModule(route) {'),main.indexOf("  if(route === 'qmentum'){",main.indexOf('async function loadModule(route) {')))+"\nloaded.push(route);}";

// Parse the actual shell. Selectors must match real attributes and ancestry;
// returning a fabricated button for any selector concealed the previous bug.
function dom() {
  const attr=(node,key)=>node.attrs?.find(a=>a.name===key)?.value;
  const matches=(node,selector)=>{
    const not=selector.match(/:not\(([^)]+)\)/);
    if(not){if(matches(node,not[1]))return false;selector=selector.replace(not[0],'');}
    const tag=selector.match(/^[\w-]+/)?.[0];
    if(tag&&node.tagName!==tag)return false;
    for(const [,name,value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))if(attr(node,name)===undefined||(value!==undefined&&attr(node,name)!==value))return false;
    const plain=selector.replace(/\[[^\]]+\]/g,'');
    const id=plain.match(/#([\w-]+)/)?.[1];if(id&&attr(node,'id')!==id)return false;
    for(const [,name] of plain.matchAll(/\.([\w-]+)/g))if(!attr(node,'class')?.split(' ').includes(name))return false;
    return Boolean(node.tagName);
  };
  function decorate(node){
    node.listeners={};node.isConnected=true;
    node.addEventListener=(type,handler)=>(node.listeners[type]??=[]).push(handler);
    node.removeAttribute=name=>{node.attrs=node.attrs.filter(a=>a.name!==name);};
    node.dataset=new Proxy({},{get:(_,name)=>attr(node,'data-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))});
    node.querySelectorAll=selector=>{
      const results=[];
      function walk(child){
        if(selector.split(',').some(option=>{
          const parts=option.trim().split(/\s+/);if(!matches(child,parts.pop()))return false;
          let parent=child.parentNode;
          while(parts.length){const part=parts.pop();while(parent&&!matches(parent,part))parent=parent.parentNode;if(!parent)return false;parent=parent.parentNode;}
          return true;
        }))results.push(child);
        for(const next of child.childNodes||[])walk(next);
      }
      for(const child of node.childNodes||[])walk(child);return results;
    };
    node.querySelector=selector=>node.querySelectorAll(selector)[0]||null;
    Object.defineProperty(node,'innerHTML',{configurable:true,set(html){node.childNodes=parseFragment(html).childNodes;for(const child of node.childNodes){child.parentNode=node;decorate(child);}},get(){return '';
    }});
    Object.defineProperty(node,'textContent',{configurable:true,get(){return node.nodeName==='#text'?node.value:(node.childNodes||[]).map(c=>c.textContent).join('');},set(value){node.innerHTML=String(value);}});
    for(const child of node.childNodes||[])decorate(child);
    return node;
  }
  return decorate(parseFragment(''));
}
const user={uid:'fixture-admin',displayName:'Fixture',email:'admin@example.invalid',emailVerified:true};
const authorized=()=>({status:'signed-in',user,profile:{uid:user.uid,email:user.email,active:true,access:true,role:'administrador_app',permissions:{}},offline:false});
const limited=()=>({status:'auth-limited',user,profile:{uid:user.uid,active:false,access:false,permissions:{}},offline:true,validatingProfile:true});
function harness({route='management',target='FB',session=authorized()}={}){
  const app=dom(),assignments=[],mounts=[],mountOptions=[],loaded=[];
  const ctx=vm.createContext({env:{BASE_URL:'/',VITE_FK_FUNCTIONAL_ENABLED:'true'},googleProjectAuthEnabled:true,operationalContentAllowed:()=>true,operationalFolderNotice:()=>'',operationalRouteFolder:()=>null,
    app,document:app,session,loadOwnLabelModuleProfile(){},loadOwnChecklistModuleProfile(){},readConsultationsAccess:async()=>session.profile?.memberCategories?.includes('EFETIVO')===true,location:{hash:'#/'+route,assign:url=>assignments.push(url)},history:{replaceState(){}},
    deployment:{target,faBase:'/SAHMT-V2.0.github.io/',externalManagementEnabled:true},rememberModuleNavigation(){},
    evaluationModuleGeneration:0,googleAccessPanel:null,scheduleGridObserver:null,operationalDrafts:{flush(){},restore(){}},
    updateInformationBanner(){},liveReports:new Map(),reportStates:new Map(),reportPayloads:new Map(),
    labelReportLoad:0,labelReportLoadingMore:false,labelReportState:'idle',cleanupLabelMedia:null,stopChecklistQrScanner(){},
    cleanupDocumentTraining:null,cleanupUserInspection:null,cleanupCurrentModule:null,startupBannerActive:false,yearEndStartup:{visible:false,status:'inactive',setSession(){}},
    loginView:()=>'<main>Login</main>',bindLogin(){},canUseVacationModule,canUseManagementPilot,canUseGovernanceHub,canUseYearEndSchedule,climateSurveyEnabled:true,deniedOperationalModules:new Set(),notice:'',
    canOpenRestrictedModule:()=>true,featureEnabledForRoute,appFeatures:DEFAULT_APP_FEATURES,
    fdPerformanceEnabled:false,fePerformanceEnabled:false,communicationFeatureEnabled:false,forwardingButton:()=>'',communicationAdminSession:()=>false,
    bindProfileRetryControl(){},preloadOperationalDataWhenIdle(){},bindModuleForm(){},updateOutboxStatus(){},navigator:{onLine:true},isOfflineRuntimeForced:()=>false,onlineValidationRequired:false,syncOutbox(){},
    todayInputValue:()=>'2026-01-01',labelReportMode:'daily',labelReportOpen:false,
    labels:{management:['Grupos de Gestão'],training:['Desempenho'],'management-hub':['Governança']},
    managementUtilityCards:()=>'',can:permission=>session.profile?.role==='administrador_app'||session.profile?.permissions?.[permission]===true,actionForm:()=>'',escapeHtml:value=>String(value),loaded,
    mountHub:(content,options)=>{mounts.push(options.initialPanel);mountOptions.push(options);return ()=>{};},
    fakeFunctionalAccess:async()=>({allowed:true,group:session.profile?.role==='administrador_app'?null:'EQUIPE'})
  });
  const code=(router+'\n'+cards+'\n'+occurrencePermission+'\n'+shell+'\n'+hubLoader+'\n'+render).replaceAll('import.meta.env.BASE_URL',"'/'")
    .replaceAll('import.meta.env','env').replace("import('./management-hub.js')",'Promise.resolve({mountManagementHub:mountHub})')
    .replace("import('./functional-access.js')",'Promise.resolve({getFunctionalAccess:fakeFunctionalAccess})');
  vm.runInContext(code,ctx);
  return {ctx,app,assignments,mounts,mountOptions,loaded,render:()=>ctx.render()};
}

for(const route of ['management','training'])for(const sessionFactory of [authorized]){
  test(`${route}: actual ${sessionFactory.name} footer sends FB to the Governance root`,async()=>{
    const h=harness({route,session:sessionFactory()});await h.render();
    const footer=h.app.querySelector('.'+route+'-home-button');assert.ok(footer);
    assert.equal(footer.textContent,'VOLTAR');assert.equal(footer.dataset.route,'management-hub');
    assert.equal(h.app.querySelector('.brand').dataset.route,'home');
    for(const click of footer.listeners.click||[])await click();
    assert.deepEqual(h.assignments,['/SAHMT-V2.0.github.io/#/management-hub']);
    const arrival=harness({target:'FA',route:h.assignments[0].split('#/')[1],session:limited()});
    await arrival.render();assert.equal(arrival.ctx.location.hash,'#/management-hub');assert.deepEqual(arrival.mounts,[]);
    arrival.ctx.session=authorized();await arrival.render();assert.deepEqual(arrival.mounts,['home']);
  });
}
test('FA preserves Governance while validating the profile, then mounts it after authorization',async()=>{
  const h=harness({target:'FA',route:'management-hub',session:limited()});
  await h.render();assert.equal(h.ctx.location.hash,'#/management-hub');assert.deepEqual(h.mounts,[]);assert.deepEqual(h.loaded,[]);
  assert.match(h.app.textContent,/validação do perfil/);
  h.ctx.session={...limited(),validatingProfile:false,profileFailureCode:'PROFILE_READ_FAILED'};
  await h.render();assert.equal(h.ctx.location.hash,'#/management-hub');assert.deepEqual(h.mounts,[]);
  assert.ok(h.app.querySelector('[data-profile-reconnect]'));
  h.ctx.session=authorized();await h.render();
  assert.equal(h.ctx.location.hash,'#/management-hub');assert.deepEqual(h.mounts,['home']);
});

for(const route of ['management','training','management-hub','labels'])test(`${route} is blocked offline and only reopens with server authorization`,async()=>{
 const h=harness({target:'FA',route,session:limited()});await h.render();
 assert.ok(h.app.querySelector('[data-online-gate]'));assert.equal(h.app.querySelector('.brand'),null);
 assert.deepEqual(h.loaded,[]);assert.deepEqual(h.mounts,[]);assert.equal(h.ctx.location.hash,'#/'+route);
 h.ctx.session=authorized();h.ctx.navigator.onLine=false;await h.render();assert.ok(h.app.querySelector('[data-online-gate]'));
});
test('FA blocks Governance for an unverified common user before mounting any panel',async()=>{
  const session=authorized();session.profile.role='anestesiologista';session.user={...session.user,emailVerified:false};
  const h=harness({target:'FA',route:'management-hub',session});await h.render();
  assert.equal(h.ctx.location.hash,'#/home');assert.deepEqual(h.mounts,[]);
});

test('FA directs verified team members to FK without granting the other Governance panels',async()=>{
  const session=authorized();session.profile.role='anestesiologista';session.user={...session.user,emailVerified:true,email:'team@example.invalid'};session.profile.memberCategories=['EFETIVO'];session.profile.email=session.user.email;
  const h=harness({target:'FA',route:'management-hub',session});await h.render();
  assert.equal(canUseYearEndSchedule(session),true);assert.equal(h.ctx.location.hash,'#/management-hub');assert.deepEqual(h.mounts,['home']);const access=h.mountOptions[0].access;assert.equal(access.indicatorResults,undefined);for(const key of ['groups','records','institutionalSurveys','surveys'])assert.equal(access[key],false);for(const key of ['functional','yearEndSchedule','vacations2027','results'])assert.equal(access[key],true);assert.equal(access.sahmtPerformance,undefined);
});
for(const status of ['blocked','signed-out'])test(`FA does not mount Governance for ${status}`,async()=>{
  const h=harness({target:'FA',route:'management-hub',session:{...authorized(),status}});await h.render();
  assert.equal(h.app.textContent,'Login');assert.deepEqual(h.mounts,[]);
});

test('Etiquetas retains its HOME footer and original route',async()=>{
  const h=harness({target:'FA',route:'labels'});await h.render();
  const footer=h.app.querySelector('.labels-home-button');
  assert.equal(footer.textContent,'HOME');assert.equal(footer.dataset.route,'home');
  for(const click of footer.listeners.click||[])await click();
  assert.equal(h.ctx.location.hash,'#/home');assert.deepEqual(h.assignments,[]);
});

test('residents and substitutes can open Governance without opening consultations',async()=>{for(const category of ['RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO']){const session=authorized();session.user={...session.user};session.profile.role='anestesiologista';session.profile.memberCategories=[category];const h=harness({target:'FA',route:'management-hub',session});await h.render();assert.deepEqual(h.mounts,['home']);const access=h.mountOptions[0].access;for(const key of ['groups','records','surveys','yearEndSchedule','vacations2027','institutionalSurveys'])assert.equal(access[key],false);}});
test('administrators retain every Governance destination without requiring team affiliation',async()=>{const h=harness({target:'FA',route:'management-hub'});await h.render();const access=h.mountOptions[0].access;for(const key of ['groups','records','occurrences','surveys','yearEndSchedule','vacations2027','institutionalSurveys'])assert.equal(access[key],true,key);});

test('administrator opens Occurrences with registration enabled while the general feature is disabled',async()=>{
 const session=authorized(),content={isConnected:true,innerHTML:''},opened=[];
 const auth={currentUser:{uid:session.user.uid}},db={};
 const ctx=vm.createContext({route:'occurrences',session,content,evaluationModuleGeneration:0,
  currentRoute:()=> 'occurrences',can:key=>session.profile.role==='administrador_app'||session.profile.permissions[key]===true,
  canUseManagementPilot,featureEnabledForRoute,appFeatures:DEFAULT_APP_FEATURES,
  moduleFirebase:{getIndicatorsAuth:()=>auth,getIndicatorsFirestore:()=>db,waitForIndicatorsSession:async()=>{}},
  moduleSession:{waitForFcModuleSession:async()=>auth},
  moduleUi:{mountOccurrenceModule:(root,options)=>{opened.push(options);return ()=>{};}}
 });
 const begin=main.indexOf("  if (route === 'occurrences') {");
 const end=main.indexOf("  if (route === 'management' && hasFinanceOnlyManagementAccess",begin);
 const branch=main.slice(begin,end).replace("import('./fc-module-firebase.js')",'moduleFirebase')
  .replace("import('./fc-module-session.js')",'moduleSession').replace("import('./occurrences-ui.js')",'moduleUi');
 vm.runInContext(occurrencePermission,ctx);
 await vm.runInContext('(async()=>{'+branch+'})()',ctx);
 assert.equal(opened.length,1);assert.equal(opened[0].permissions.occurrencesWrite,true);
 assert.equal(opened[0].permissions.occurrencesRead,undefined);assert.equal(opened[0].isCurrent(),true);
 session.profile.role='anestesiologista';assert.equal(ctx.hasOccurrencePermission(),false);
 assert.equal(opened[0].isCurrent(),false);
 session.profile.role='administrador_app';session.profile.active=false;assert.equal(ctx.hasOccurrencePermission(),false);
});
