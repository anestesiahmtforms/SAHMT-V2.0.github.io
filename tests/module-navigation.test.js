import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {rememberModuleNavigation, consumeModuleNavigation,rememberManagementReturn,consumeManagementReturn,readManagementReturn} from '../src/module-navigation.js';
import {activityDestination,surveyActivityPanels} from '../src/communication-activity-selection.js';
const FA='/SAHMT-V2.0.github.io/',FB=FA+'gestao/';
const fixture=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('a same-tab app switch consumes the animation hint once',()=>{
 const storage=fixture();assert.equal(rememberModuleNavigation(FB,{storage,pathname:FA,now:1000}),true);
 assert.equal(consumeModuleNavigation({storage,pathname:FB,now:1100}),true);
 assert.equal(consumeModuleNavigation({storage,pathname:FB,now:1200}),false);
 assert.equal(rememberModuleNavigation(FA,{storage,pathname:FB,now:2000}),true);
 assert.equal(consumeModuleNavigation({storage,pathname:FA,now:2100}),true);
});
test('cold launch, stale, future and wrong destination hints retain the opening animation',()=>{
 for(const [pathname,now] of [[FA,1100],[FB,32000],[FB,900]]){
  const storage=fixture();rememberModuleNavigation(FB,{storage,pathname:FA,now:1000});assert.equal(consumeModuleNavigation({storage,pathname,now}),false);
 }
 assert.equal(consumeModuleNavigation({storage:fixture(),pathname:FA,now:1000}),false);
});
test('same-app routes and unrecognized paths cannot create a module handoff',()=>{
 const storage=fixture();for(const target of [FA,'https://example.com/',FA+'tools/'])assert.equal(rememberModuleNavigation(target,{storage,pathname:FA,now:1}),false);
});
test('unavailable browser storage cannot break navigation',()=>{
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 assert.equal(rememberModuleNavigation(FB,{storage,pathname:FA}),false);assert.equal(consumeModuleNavigation({storage,pathname:FB}),false);
});
test('explicit session repair returns once to the original management area',()=>{
 const storage=fixture(),hash='#/management/area-gestao-de-documentos';
 assert.equal(rememberManagementReturn(hash,{storage,now:1000}),true);
 assert.equal(consumeManagementReturn({storage,now:1100}),hash);
 assert.equal(consumeManagementReturn({storage,now:1200}),null);
 assert.equal(rememberManagementReturn('https://example.com',{storage}),false);
 rememberManagementReturn(hash,{storage,now:1000});assert.equal(consumeManagementReturn({storage,now:602000}),null);
});
test('recuperar Gestão preserva o treinamento e a convocação exatos',()=>{
 const storage=fixture();
 const hash='#/management/area-gestao-de-documentos/required/protocolo%3A1/activity-123';
 assert.equal(rememberManagementReturn(hash,{storage,now:1000}),true);
 assert.equal(rememberManagementReturn(hash+'/extra',{storage,now:1050}),false);
 assert.equal(readManagementReturn({storage,now:1100}),hash);
 assert.equal(consumeManagementReturn({storage,now:1100}),hash);
 assert.equal(readManagementReturn({storage,now:1200}),null);
});
test('Abrir atividade envia a enquete ao formulário e retoma o mesmo treinamento após recuperar Gestão',async()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const storage=fixture(),session={status:'signed-in',user:{uid:'member'},profile:{active:true,access:true}};
 const location={pathname:FA,hash:'#/home',href:FA+'#/home',assign(path){this.destination=path;}};
 let onOpen,googleOpens=0,ready=false;
 const controller={setActivityActive(){},cleanup(){}};
 const modules={
  './communication-obligation-banner.js':{mountCommunicationObligationBanner(options){onOpen=options.onOpenActivity;return controller;}},
  './communication-client.js':{createCommunicationClient:()=>({dispose(){}})},
  './management-entry-session.js':{ensureManagementSession:async()=>ready}
 };
 const context=vm.createContext({activityDestination,surveyActivityPanels,location,session,deployment:{faBase:FA,fbBase:FB},
  communicationFeatureEnabled:true,obligationBanner:null,obligationBannerUid:'',load:async path=>modules[path],
  rememberManagementReturn:hash=>rememberManagementReturn(hash,{storage}),readManagementReturn:()=>readManagementReturn({storage}),
  rememberModuleNavigation(){},googleAccessPanel:{open(){googleOpens++;}}});
 const start=main.indexOf('function activeObligationId()'),end=main.indexOf('async function render()',start);
 vm.runInContext(main.slice(start,end).replaceAll('import(','load(')+'\nsyncObligationBanner();',context);
 await new Promise(resolve=>setImmediate(resolve));
 await onOpen({id:'activity-survey',activity:{kind:'SURVEY',id:'professional'}});
 assert.equal(location.hash,'#/management-hub/professional/required/activity-survey');
 const item={id:'activity-training',activity:{kind:'TRAINING',id:'training-1'}};
 const target='#/management/area-gestao-de-documentos/required/training-1/activity-training';
 await onOpen(item);
 assert.equal(location.hash,'#/offline');
 assert.equal(googleOpens,1);
 assert.equal(vm.runInContext('activeObligationId()',context),'activity-training');
 assert.equal(consumeManagementReturn({storage}),target);
 ready=true;
 await onOpen(item);
 assert.equal(location.destination,FB+target);
});
