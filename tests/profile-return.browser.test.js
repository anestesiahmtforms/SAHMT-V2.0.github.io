import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

// Real auth.js, profile HTTP reader, main.js and lifecycle. Only Firebase
// identity/Watch and application records are synthetic; no production reads.
for(const engine of ['edge','webkit'])test(`${engine}: returning to Checklist recovers a stalled profile without restarting`,{timeout:100000},async()=>{
 const base='/SAHMT-V2.0.github.io/';
 const profile={uid:'navigation-fixture',displayName:'Teste de navegação',active:true,access:true,role:'administrador_app',permissions:{admin:true,checklistRead:true,checklistWrite:true,scheduleRead:true}};
 const stubs={
  'firebase-app.js':'export const firebaseConfigured=false,app=null,appCheckReady=Promise.resolve(null);',
  'firebase-auth.js':'export const auth={currentUser:window.fixture.user};',
  'data-lite.js':'export async function readAppFeatures(){return {};}export async function readSchedule(){return null;}export async function listActiveContacts(){return [];}export async function listVacationsForDate(){return [];}',
  'data.js':'export async function syncQueuedOperations(){return {};}export async function listUnsentChecklistTransfers(){return [];}export async function flushOperationalSheetDelivery(){}export async function listModuleRecords(){return [];}export async function getAppFeatures(){return {};}',
  'google-project-auth-runtime.js':'export async function maintainGoogleProjectSessions(){return {status:"ready"};}',
  'firebase-secondary-session-lifecycle.js':'export async function reconcileFirebaseSecondarySessions(){return {};}export async function signOutAllFirebaseProjects(){return true;}',
  'remote-continuity.js':'export async function recoverRemoteContinuity(){return null;}'
 };
 const fixtureCache=`export async function readCachedProfile(){return window.fixture.stallCacheRead?new Promise(()=>{}):window.fixture.profile;}
 export function cacheProfile(){return new Promise(()=>{});}export async function clearUserLocalData(){}export async function pendingOperationCount(){return 0;}export async function pendingTrainingProgressCount(){return 0;}`;
 const server=await createServer({configFile:false,base,cacheDir:'.local-preview/vite-profile-return-'+engine,
  define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FA'}),'import.meta.env.VITE_GOOGLE_PROJECT_AUTH_ENABLED':JSON.stringify('false')},
  plugins:[{name:'isolated-profile-return',enforce:'pre',resolveId(id){if(id==='virtual:fixture-profile-cache')return '\0fixture-profile-cache';},load(id){if(id==='\0fixture-profile-cache')return fixtureCache;const match=id.replaceAll('\\','/').match(/\/src\/([^/?]+\.js)$/);if(match&&stubs[match[1]])return stubs[match[1]];},
   transform(code,id){if(!id.replaceAll('\\','/').endsWith('/src/auth.js'))return;return code
    .replace("import {firebaseConfigured} from './firebase-app.js';",'const firebaseConfigured=true;')
    .replace("from './outbox.js'","from 'virtual:fixture-profile-cache'")
    .replace("import('firebase/auth')",'Promise.resolve(window.fixture.authApi)')
    .replace("import('firebase/firestore')",'Promise.resolve({doc:()=>({}),onSnapshot:()=>()=>{}})');},
   configureServer(server){server.middlewares.use((req,res,next)=>{
    const path=req.url?.split('?')[0];
    if(path===base+'fixture-profile-cache.js'){res.setHeader('Content-Type','text/javascript');return res.end(fixtureCache);}
    if(path===base+'tests/other-module.html'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><a href="'+base+'tests/profile-return.html#/checklist">Retornar ao Checklist</a>');}
    if(path!==base+'tests/profile-return.html')return next();
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script type="module" src="'+base+'src/main.js"></script>');
   });}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/.local-preview/**']}}});
 let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await (engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(profile=>{
   const user={uid:profile.uid,email:'fixture@example.test',getIdToken:async()=> 'synthetic-token'};
   window.fixture={profile,user,stallCacheRead:sessionStorage.getItem('stallCacheRead')==='true',pageId:crypto.randomUUID(),authApi:{onAuthStateChanged:(_auth,fn)=>{queueMicrotask(()=>fn(user));return()=>{};}}};
  },profile);
  let mode='success',reads=0;
  const encode=value=>typeof value==='boolean'?{booleanValue:value}:typeof value==='string'?{stringValue:value}:{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin===origin)return route.continue();
   if(url.hostname==='firestore.googleapis.com'&&url.pathname.endsWith('/users/'+profile.uid)){
    reads++;assert.equal(route.request().headers().authorization,'Bearer synthetic-token');
    if(mode==='hang')return;
    return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({name:url.pathname.slice('/v1/'.length),fields:encode(profile).mapValue.fields})});
   }
   return route.abort();
  });
  const entry=origin+base+'tests/profile-return.html#/checklist';
  await page.goto(entry);await page.waitForSelector('[data-route="home"]');
  await page.waitForFunction(()=>document.querySelector('[data-route="checklist-scan"]')||document.body.textContent.includes('LER QR Code'));
  await page.waitForFunction(()=>!document.querySelector('[data-local-profile-notice]'));
  await page.goto(origin+base+'tests/other-module.html');mode='hang';
  await page.getByText('Retornar ao Checklist').click();
  await page.waitForSelector('[data-profile-reconnect]:not([disabled])',{timeout:20000});
  const pageId=await page.evaluate(()=>window.fixture.pageId);mode='success';
  // No user click/reload: the failure arriving after pageshow must arm recovery.
  await page.waitForFunction(()=>!document.querySelector('[data-local-profile-notice]')&&document.body.textContent.includes('LER QR Code'),{},{timeout:30000});
  assert.equal(await page.evaluate(()=>window.fixture.pageId),pageId);
  assert.ok(reads>=3);const before=reads;
  for(let i=0;i<3;i++){await page.evaluate(()=>location.hash='#/home');await page.waitForSelector('#schedule-date');await page.evaluate(()=>location.hash='#/checklist');await page.waitForFunction(()=>document.body.textContent.includes('LER QR Code'));}
  assert.equal(reads,before,'healthy internal navigation must not reread the profile');
  // A stalled local cache read must also leave a bounded path to server validation.
  await page.evaluate(()=>sessionStorage.setItem('stallCacheRead','true'));await page.goto(origin+base+'tests/other-module.html');
  await page.getByText('Retornar ao Checklist').click();await page.waitForFunction(()=>document.body.textContent.includes('LER QR Code')&&!document.querySelector('[data-local-profile-notice]'),{},{timeout:10000});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
