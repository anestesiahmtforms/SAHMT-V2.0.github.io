import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const moduleCode=source.slice(source.indexOf('async function loadModule(route)'),source.indexOf("  if (['management', 'training'].includes(route) && !canOpenRestrictedModule(route))"))+'}';
function moduleFixture(){
 const mounts=[],auth={currentUser:{uid:'one'}},ctx=vm.createContext({
  session:{status:'signed-in',user:{uid:'one'}},evaluationModuleGeneration:1,cleanupCurrentModule:null,
  route:'qmentum',content:{isConnected:true},currentRoute:()=>ctx.route,canOpenRestrictedModule:()=>true,
  document:{querySelector:()=>ctx.content},navigate:()=>{},
  fc:{getIndicatorsAuth:()=>auth,getIndicatorsFirestore:()=>({}),waitForIndicatorsSession:async()=>true},
  gate:{waitForFcModuleSession:async()=>auth},data:{createQmentumRepository:()=>({})},
  ui:{mountQmentumModule:async(root,options)=>{const done=deferred();mounts.push({root,options,done});return done.promise;}}
 });
 let code=moduleCode;
 for(const [file,name] of [['fc-module-firebase','fc'],['fc-module-session','gate'],['qmentum-data','data'],['qmentum-ui','ui']])code=code.replace(`import('./${file}.js')`,name);
 vm.runInContext(code.replaceAll('import.meta','importMeta'),ctx);
 return {ctx,mounts,load:()=>ctx.loadModule('qmentum')};
}
test('FC mount belongs to its page instance even after returning to the same route',async()=>{
 const h=moduleFixture(),old=h.load();await tick();
 h.ctx.content.isConnected=false;h.ctx.content={isConnected:true};h.ctx.evaluationModuleGeneration++;
 assert.equal(h.mounts[0].options.isCurrent(),false);
 h.mounts[0].done.resolve(()=>{});await old;
});
test('late FC mount disposes itself without replacing the current module cleanup',async()=>{
 const h=moduleFixture(),old=h.load();await tick();
 h.ctx.route='home';h.ctx.content.isConnected=false;h.ctx.evaluationModuleGeneration++;
 let disposed=0;const activeCleanup=()=>{};h.ctx.cleanupCurrentModule=activeCleanup;
 h.mounts[0].done.resolve(()=>disposed++);await old;
 assert.equal(h.ctx.cleanupCurrentModule,activeCleanup);assert.equal(disposed,1);
});

const renderCode=source.slice(source.indexOf('async function render() {'),source.indexOf('function renderOnlineGate()'));
function renderFixture({flush=async()=>{},cleanup=null}={}){
 const app={innerHTML:'FC',querySelector:()=>null,querySelectorAll:()=>[]};
 const ctx=vm.createContext({
  app,route:'home',currentRoute:()=>ctx.route,evaluationModuleGeneration:0,
  googleAccessPanel:null,scheduleGridObserver:null,operationalDrafts:{flush},
  session:{status:'signed-in',user:{uid:'one'},profile:{}},liveReports:{get:()=>null},reportStates:new Map(),reportPayloads:new Map(),
  labelReportLoad:0,labelReportLoadingMore:false,labelReportState:'idle',cleanupLabelMedia:null,stopChecklistQrScanner(){},
  cleanupDocumentTraining:null,cleanupUserInspection:null,cleanupCurrentModule:cleanup,startupBannerActive:false,
  deployment:{target:'FA',externalManagementEnabled:false},deniedOperationalModules:new Set(),featureEnabledForRoute:()=>true,appFeatures:{},
  shellView:()=> 'HOME',preloadOperationalDataWhenIdle(){},document:{querySelectorAll:()=>[],querySelector:()=>null},
  loadHome:async()=>{},loadModule:async()=>{},updateInformationBanner(){},can:()=>false,updateOutboxStatus(){},navigator:{onLine:true},isOfflineRuntimeForced:()=>false,onlineValidationRequired:false,
  console:{warn(){}},notice:'',labels:{},navigate(){},canOpenRestrictedModule:()=>true,importMeta:{env:{BASE_URL:'/'}}
 });
 vm.runInContext(renderCode.replaceAll('import.meta','importMeta'),ctx);
 return {ctx,app,render:()=>ctx.render()};
}
test('Home remains navigable while a previously captured local draft write is pending',async()=>{
 const pending=deferred(),h=renderFixture({flush:()=>pending.promise});
 const render=h.render();await tick();const screen=h.app.innerHTML;
 pending.resolve();await render;
 assert.equal(screen,'HOME');
});
test('module cleanup failure cannot strand the user on the FC page',async()=>{
 const h=renderFixture({cleanup:()=>{throw Error('synthetic cleanup failure');}});
 await assert.doesNotReject(h.render());assert.equal(h.app.innerHTML,'HOME');
});
test('a pending module cleanup cannot block the next page',async()=>{
 const pending=deferred(),h=renderFixture({cleanup:()=>pending.promise});
 const old=h.render();await tick();const screen=h.app.innerHTML;
 pending.resolve();await old;assert.equal(screen,'HOME');
});
test('an older module load cannot bind controls after a newer page has opened',async()=>{
 const pending=deferred(),h=renderFixture();let bindings=0;
 h.ctx.route='offline';h.ctx.loadModule=()=>pending.promise;h.ctx.bindModuleForm=async()=>bindings++;
 const old=h.render();await tick();h.ctx.route='home';await h.render();
 pending.resolve();await old;
 assert.equal(bindings,0);assert.equal(h.app.innerHTML,'HOME');
});
