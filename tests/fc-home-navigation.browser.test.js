import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

test('FC to Home remains usable with delayed reads, rapid reentry and pending local storage',{timeout:90000},async()=>{
 const base='/SAHMT-V2.0.github.io/';
 const stubs={
  'firebase-app.js':'export const firebaseConfigured=false,app=null,appCheckReady=Promise.resolve(null);',
  'auth.js':`const user={uid:'fc-navigation-fixture',email:'fixture@example.test',displayName:'Teste FC'};
   export function watchSession(fn){fn({status:'signed-in',user,offline:false,profile:{uid:user.uid,displayName:user.displayName,active:true,access:true,role:'administrador_app',permissions:{admin:true,scheduleRead:true,occurrencesRead:true,occurrencesWrite:true}}});return()=>{};}
   export async function retryAuthenticatedProfile(){}export async function signInGoogle(){}export async function signOutGlobal(){return true;}`,
  'data-lite.js':`export async function readAppFeatures(){return {management:true,trainings:true,occurrences:true};}export async function readSchedule(){return null;}export async function listActiveContacts(){return [];}export async function listVacationsForDate(){return [];}`,
  'data.js':`export async function syncQueuedOperations(){return {};}export async function listUnsentChecklistTransfers(){return [];}export async function flushOperationalSheetDelivery(){}export async function listModuleRecords(){return [];}export async function getAppFeatures(){return {};}`,
  'google-project-auth-runtime.js':'export async function maintainGoogleProjectSessions(){return {status:"ready"};}',
  'fc-module-firebase.js':`const auth={currentUser:{uid:'fc-navigation-fixture',getIdToken:async()=> 'synthetic',getIdTokenResult:async()=>({claims:{}})},authStateReady:async()=>{}};
   export const getIndicatorsAuth=()=>auth,getIndicatorsFirestore=()=>({});export async function waitForIndicatorsSession(){return true;}`,
  'qmentum-data.js':`import {initialDefinitions} from './qmentum-catalog.js';
   window.fcFixture={requests:[],drafts:new Map()};
   export function createDraftStore(){return {read:key=>window.fcFixture.drafts.get(JSON.stringify(key)),save:(key,value)=>window.fcFixture.drafts.set(JSON.stringify(key),structuredClone(value)),remove:key=>window.fcFixture.drafts.delete(JSON.stringify(key))};}
   export function createQmentumRepository(){const request={};window.fcFixture.requests.push(request);return {
    open:()=>new Promise(resolve=>request.open=()=>resolve({access:{role:'manager'},units:[{unitId:'test-unit',name:'Unidade teste'}],definitions:initialDefinitions()})),
    year:()=>new Promise(resolve=>request.year=()=>resolve([])),history:async()=>[],definition:async()=>initialDefinitions()
   };}`,
  'occurrence-data.js':`export function createOccurrenceRepository(){return {clear(){},list:async()=>[],listAudit:async()=>[],loadCatalog:()=>new Promise(resolve=>(window.fcFixture.catalogs??=[]).push(()=>resolve({catalogs:{}})))};}`,
  'offline-form-drafts.js':`export function installOperationalDrafts(){return {flush:()=>new Promise(()=>{}),restore:async()=>false};}`
 };
 const server=await createServer({configFile:false,base,cacheDir:'.local-preview/vite-fc-home-navigation',
  define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FA',externalManagementEnabled:false}),'import.meta.env.VITE_GOOGLE_PROJECT_AUTH_ENABLED':JSON.stringify('false')},
  plugins:[{name:'isolated-fc-navigation',enforce:'pre',load(id){const match=id.replaceAll('\\','/').match(/\/src\/([^/?]+\.js)$/);if(match&&stubs[match[1]])return stubs[match[1]];},configureServer(server){server.middlewares.use((req,res,next)=>{
   if(req.url?.split('?')[0]!==base+'tests/fc-home.html')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="'+base+'src/main.js"></script>');
  });}}],server:{host:'127.0.0.1',port:0}});
 let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+base+'tests/fc-home.html#/qmentum');
  await page.waitForFunction(()=>window.fcFixture?.requests[0]?.open);
  const goHome=async()=>{await page.locator('.brand[data-route="home"]').click();await page.waitForSelector('#schedule-date',{timeout:3000});assert.equal(new URL(page.url()).hash,'#/home');};
  await goHome();
  await page.evaluate(()=>location.hash='#/qmentum');
  await page.waitForFunction(()=>window.fcFixture.requests[1]?.open);
  await page.evaluate(()=>window.fcFixture.requests[1].open());
  await page.waitForFunction(()=>window.fcFixture.requests[1].year);
  await page.evaluate(()=>window.fcFixture.requests[1].year());
  await page.waitForSelector('[data-qm-indicator="QM01"]');
  // An older opening finishes after reentry. It must not seize the new page's cleanup.
  await page.evaluate(()=>window.fcFixture.requests[0].open());
  await page.waitForTimeout(100);
  await page.evaluate(()=>window.fcFixture.requests[0].year?.());
  await page.locator('[data-qm-indicator="QM01"]').click();
  await page.locator('[data-count="techniqueChanges"]').fill('7');
  // Browser/PWA back can change the route while a top-layer dialog is open.
  await page.evaluate(()=>location.hash='#/home');
  await page.waitForSelector('#schedule-date',{timeout:3000});
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await page.evaluate(()=>[...window.fcFixture.drafts.values()][0]?.inputs.counts.techniqueChanges),7);
  await page.locator('.brand[data-route="home"]').click();

  // Pending initial FC data also cannot prevent leaving by the common Home control.
  await page.evaluate(()=>location.hash='#/qmentum');
  await page.waitForFunction(()=>window.fcFixture.requests[2]?.open);
  await page.evaluate(()=>window.fcFixture.requests[2].open());
  await page.waitForFunction(()=>window.fcFixture.requests[2].year);
  await goHome();
  await page.evaluate(()=>window.fcFixture.requests[2].year());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#schedule-date').count(),1);
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.evaluate(()=>location.hash='#/occurrences');
  await page.waitForSelector('[data-occurrence-group="A"]');
  await page.locator('[data-occurrence-group="A"]').click();
  await page.locator('[data-occurrence-form="F01"]').click();
  await page.waitForFunction(()=>window.fcFixture.catalogs?.length===1);
  // Slow FC catalogue reads must leave an exit from the modal available.
  await page.locator('[data-occurrence-group-cancel]').click({timeout:2000});
  assert.equal(await page.locator('dialog[open]').count(),0);
  // Reopening must start a fresh attempt; the cancelled response cannot open a form.
  await page.locator('[data-occurrence-group="A"]').click();
  await page.locator('[data-occurrence-form="F02"]').click();
  await page.waitForFunction(()=>window.fcFixture.catalogs.length===2);
  await page.evaluate(()=>window.fcFixture.catalogs[0]());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-occurrence-dialog-host] dialog[open]').count(),0);
  await page.locator('[data-occurrence-group-cancel]').click({timeout:2000});
  await goHome();
  await page.evaluate(()=>window.fcFixture.catalogs[1]());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('dialog[open]').count(),0);
  // Repeat the full user path, leaving each pending request behind without restarting.
  for(let i=0;i<3;i++){
   await page.evaluate(()=>location.hash='#/occurrences');
   await page.waitForSelector('[data-occurrence-group="A"]');
   await page.locator('[data-occurrence-group="A"]').click();
   await page.locator('[data-occurrence-form="F01"]').click();
   await page.waitForFunction(count=>window.fcFixture.catalogs.length===count,3+i);
   if(i===1)await page.keyboard.press('Escape');else await page.locator('[data-occurrence-group-cancel]').click({timeout:2000});
   await goHome();
  }
  // Single-form categories keep the page's Home control available while loading.
  await page.evaluate(()=>location.hash='#/occurrences');
  await page.waitForSelector('[data-occurrence-group="B"]');
  await page.locator('[data-occurrence-group="B"]').click();
  await page.waitForFunction(()=>window.fcFixture.catalogs.length===6);
  await goHome();
  await page.evaluate(()=>window.fcFixture.catalogs[5]());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('dialog[open]').count(),0);
  // The normal successful load still opens the selected form.
  await page.evaluate(()=>location.hash='#/occurrences');
  await page.waitForSelector('[data-occurrence-group="A"]');
  await page.locator('[data-occurrence-group="A"]').click();
  await page.locator('[data-occurrence-form="F01"]').click();
  await page.waitForFunction(()=>window.fcFixture.catalogs.length===7);
  await page.evaluate(()=>window.fcFixture.catalogs[6]());
  await page.waitForSelector('[data-occurrence-dialog-host] dialog[open]');
  await page.locator('[data-occurrence-cancel]').click();
  await page.locator('[data-occurrence-group-cancel]').click();
  await goHome();
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
