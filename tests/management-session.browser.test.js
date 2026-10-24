import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
test('FB keeps document routes during profile validation; five-project panel opens only explicitly',{timeout:90000},async()=>{
 const base='/SAHMT-V2.0.github.io/';
 const stubs={
  'firebase-app.js':'export const firebaseConfigured=true,app=null,appCheckReady=Promise.resolve(null);',
  'auth.js':`const user={uid:'isolated-fixture',email:'fixture@example.test',displayName:'Pessoa de teste'};let emit;const limited=()=>({status:'auth-limited',user,offline:true,validatingProfile:false,profile:{uid:user.uid,active:false,access:false,permissions:{}}});const valid=()=>({status:'signed-in',user,offline:false,profile:{uid:user.uid,email:user.email,displayName:user.displayName,active:true,access:true,role:'administrador_app',permissions:{admin:true}}});export function watchSession(fn){emit=fn;window.fixtureLimited=()=>emit(limited());window.fixtureValid=()=>emit(valid());fn(limited());return()=>{};}export async function retryAuthenticatedProfile(){emit(valid());}export async function signInGoogle(){}export async function signOutGlobal(){return true;}`,
  'data-lite.js':`export async function readAppFeatures(){return {checklist:true,labels:true,trainings:true,management:true,notifications:true,occurrences:false,esg:false,innovation:false};}export async function readSchedule(){return null;}`,
  'data.js':`export async function listModuleRecords(){return [{id:'area-gestao-de-documentos',name:'Gestão de Documentos',active:true,version:1,managerUids:[],memberUids:[]}];}export async function listManagementActivities(){return [];}export async function listManagementIndicators(){return [];}export async function listIndicatorMeasurements(){return [];}export async function listManagementActionPlans(){return [];}export async function listManagementActionPlanItems(){return [];}export async function listManagementDocuments(){return [];}export async function getManagementTaskScoringRule(){return null;}export async function listManagementActivityScoreReviews(){return [];}export async function listUnsentChecklistTransfers(){return [];}export async function flushOperationalSheetDelivery(){}export async function getAppFeatures(){return {};}export async function syncQueuedOperations(){return {};}`,
  'performance-ui.js':'export function mountManagementEvaluationAccess(){return ()=>{};}'
 };
 const server=await createServer({cacheDir:'.local-preview/vite-management-session',define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FB',externalManagementEnabled:false})},plugins:[{name:'isolated-auth-session',enforce:'pre',load(id){const match=id.replaceAll('\\','/').match(/\/src\/([^/?]+\.js)$/);if(match&&stubs[match[1]])return stubs[match[1]];},configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!==base+'tests/module-session.html')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="'+base+'src/main.js"></script>');});}}],server:{host:'127.0.0.1',port:0}});let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+base+'tests/module-session.html#/management');
  await page.waitForFunction(()=>typeof window.fixtureValid==='function');
  await page.waitForSelector('#retry-profile-access',{timeout:20000});
  assert.equal(new URL(page.url()).hash,'#/management');
  await page.evaluate(()=>window.fixtureValid());

  await page.locator('[data-management-area="area-gestao-de-documentos"]').click();
  await page.waitForSelector('#management-area-dialog[open]');
  assert.equal(new URL(page.url()).hash,'#/management/area-gestao-de-documentos');
  await page.evaluate(()=>window.fixtureLimited());await page.waitForSelector('#retry-profile-access');
  assert.equal(new URL(page.url()).hash,'#/management/area-gestao-de-documentos');
  await page.evaluate(()=>window.fixtureValid());await page.waitForSelector('#management-area-dialog[open]');
  assert.equal(new URL(page.url()).hash,'#/management/area-gestao-de-documentos');
  await page.evaluate(async url=>{
   const {mountGoogleProjectAuthPanel}=await import(url);let state={uid:'fixture',complete:false,busy:true,targets:{FA:{status:'ready'},FB:{status:'restoring'},FC:{status:'pending'},FD:{status:'pending'},FE:{status:'pending'}}},listener,visible=false,renders=0;
   const panel=mountGoogleProjectAuthPanel({controller:{snapshot:()=>state,subscribe:fn=>{listener=fn;fn(state);return()=>{};}},confirm:async()=>{},getUser:()=>({uid:'fixture'}),isVisible:()=>visible,createGoogleButton:()=>({render:async()=>{renders++;},dispose(){}})});
   window.panelFixture={panel,setVisible(v){visible=v;panel.refresh();},finishRestore(){state={...state,busy:false};listener(state);},renders:()=>renders};
  },origin+base+'src/google-project-auth-ui.js');
  assert.equal(await page.locator('.google-auth-update').isVisible(),false);
  await page.evaluate(()=>{window.panelFixture.setVisible(true);window.panelFixture.finishRestore();});
  assert.equal(await page.locator('.google-auth-update').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.panelFixture.renders()),0);
  await page.evaluate(()=>window.panelFixture.panel.open());assert.equal(await page.locator('.google-auth-update').isVisible(),true);
  await page.evaluate(()=>window.panelFixture.setVisible(false));assert.equal(await page.locator('.google-auth-update').isVisible(),false);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
