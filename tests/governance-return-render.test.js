import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseFragment} from 'parse5';
import {canUseManagementPilot,canUseGovernanceHub} from '../src/management-pilot.js';
import {featureEnabledForRoute, DEFAULT_APP_FEATURES} from '../src/feature-flags.js';
import {shouldRenderHashChange} from '../src/router.js';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
const shell=main.slice(main.indexOf('function shellView() {'),main.indexOf('async function loadHome()'));
const cards=main.slice(main.indexOf('function moduleCards() {'),main.indexOf('function hasOccurrencePermission()'));
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
const user={uid:'fixture-admin',displayName:'Fixture'};
const authorized=()=>({status:'signed-in',user,profile:{uid:user.uid,active:true,access:true,role:'administrador_app',permissions:{}},offline:false});
const limited=()=>({status:'auth-limited',user,profile:{uid:user.uid,active:false,access:false,permissions:{}},offline:true,validatingProfile:true});
function harness({route='management',target='FB',session=authorized()}={}){
  const app=dom(),assignments=[],mounts=[],loaded=[];
  const ctx=vm.createContext({
    app,document:app,session,location:{hash:'#/'+route,assign:url=>assignments.push(url)},history:{replaceState(){}},
    deployment:{target,faBase:'/SAHMT-V2.0.github.io/',externalManagementEnabled:true},rememberModuleNavigation(){},
    evaluationModuleGeneration:0,googleAccessPanel:null,scheduleGridObserver:null,operationalDrafts:{flush(){},restore(){}},
    updateInformationBanner(){},liveReports:new Map(),reportStates:new Map(),reportPayloads:new Map(),
    labelReportLoad:0,labelReportLoadingMore:false,labelReportState:'idle',cleanupLabelMedia:null,stopChecklistQrScanner(){},
    cleanupDocumentTraining:null,cleanupUserInspection:null,cleanupCurrentModule:null,startupBannerActive:false,
    loginView:()=>'<main>Login</main>',bindLogin(){},canUseManagementPilot,canUseGovernanceHub,climateSurveyEnabled:true,deniedOperationalModules:new Set(),notice:'',
    canOpenRestrictedModule:()=>true,hasOccurrencePermission:()=>true,featureEnabledForRoute,appFeatures:DEFAULT_APP_FEATURES,
    bindProfileRetryControl(){},preloadOperationalDataWhenIdle(){},bindModuleForm(){},updateOutboxStatus(){},navigator:{onLine:true},isOfflineRuntimeForced:()=>false,onlineValidationRequired:false,syncOutbox(){},
    todayInputValue:()=>'2026-01-01',labelReportMode:'daily',labelReportOpen:false,
    labels:{management:['Grupos de Gestão'],training:['Desempenho'],'management-hub':['Governança']},
    managementUtilityCards:()=>'',can:()=>false,actionForm:()=>'',escapeHtml:value=>String(value),loaded,
    mountHub:(content,options)=>{mounts.push(options.initialPanel);return ()=>{};}
  });
  const code=(router+'\n'+cards+'\n'+shell+'\n'+hubLoader+'\n'+render).replaceAll('import.meta.env.BASE_URL',"'/'")
    .replace("await import('./management-hub.js')",'await Promise.resolve({mountManagementHub:mountHub})');
  vm.runInContext(code,ctx);
  return {ctx,app,assignments,mounts,loaded,render:()=>ctx.render()};
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
test('FA opens Governance for surveys without granting access to pilot modules',async()=>{
  const session=authorized();session.profile.role='anestesiologista';
  const h=harness({target:'FA',route:'management-hub',session});await h.render();
  assert.equal(h.ctx.location.hash,'#/management-hub');assert.deepEqual(h.mounts,['home']);
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
