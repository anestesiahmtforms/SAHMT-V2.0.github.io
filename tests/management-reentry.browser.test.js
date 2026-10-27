import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';
test('FA to FB reentry refreshes a cached management catalog and preserves an open activity draft',{timeout:60000},async()=>{
const base='/SAHMT-V2.0.github.io/';
const profile={uid:'navigation-fixture',email:'fixture@example.test',displayName:'Teste de navegação',active:true,access:true,role:'administrador_app',permissions:{admin:true}};
const stubs={
 'data-lite.js':`export async function readAppFeatures(){return {};}export async function readSchedule(){return null;}export async function listActiveContacts(){return [];}export async function listVacationsForDate(){return [];}`,
 'data.js':`import {isOfflineRuntimeForced} from './offline-runtime-mode.js';export async function listModuleRecords(){window.fixtureCatalogReads=(window.fixtureCatalogReads||0)+1;const local=isOfflineRuntimeForced();return [{id:'area-gestao-operacional',name:local?'Gestão Operacional — local':'Gestão Operacional — servidor',stale:local,active:true,version:1,managerUids:[],memberUids:[]}];}export async function listManagementActivities(){return [];}export async function listManagementIndicators(){return [];}export async function listIndicatorMeasurements(){return [];}export async function listManagementActionPlans(){return [];}export async function listManagementActionPlanItems(){return [];}export async function listManagementDocuments(){return [];}export async function getManagementTaskScoringRule(){return null;}export async function listManagementActivityScoreReviews(){return [];}export async function listUnsentChecklistTransfers(){return [];}export async function flushOperationalSheetDelivery(){}export async function getAppFeatures(){return {};}export async function syncQueuedOperations(){return {};}`,

 'remote-continuity.js':`export async function recoverRemoteContinuity(){return null;}`
};
const server=await createServer({configFile:false,base,cacheDir:'.local-preview/vite-management-reentry',optimizeDeps:{entries:['index.html']},
 plugins:[{name:'return-flow-fixture',enforce:'pre',load(id){
  const match=id.replaceAll('\\','/').match(/\/src\/([^/?]+\.js)$/);if(!match)return;
  if(stubs[match[1]])return stubs[match[1]];
  if(match[1]==='main.js')return readFileSync(id,'utf8').replace('function sessionChanged(next) {',"function sessionChanged(next) {window.fixtureSession={status:next.status,offline:next.offline,validatingProfile:next.validatingProfile};");
  if(match[1]==='deployment-context.js')return readFileSync(id,'utf8').replace(/const supplied = .*;/,"const supplied = {target:location.pathname.includes('/gestao/')?'FB':'FA',externalManagementEnabled:true};");
  if(match[1]==='google-project-auth-config.js')return readFileSync(id,'utf8').replace(/export const googleProjectAuthEnabled = .*;/,"export const googleProjectAuthEnabled = !location.pathname.includes('/gestao/');");
 },configureServer(server){server.middlewares.use((req,res,next)=>{
  if(![base,base+'gestao/'].includes(req.url?.split('?')[0]))return next();
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="'+base+'src/main.js"></script>');
 });}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/.local-preview/**']}}});
await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.SAHMT_TEST_BROWSER_PATH?{executablePath:process.env.SAHMT_TEST_BROWSER_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--no-zygote','--single-process']}:{} )});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({entries,profile})=>{
  if(!localStorage.getItem('fixture-seeded')){
   for(const entry of Object.values(entries)){
    const claims={sub:profile.uid,user_id:profile.uid,aud:entry.config.projectId,iss:'https://securetoken.google.com/'+entry.config.projectId,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'google.com'}};
    const encode=x=>btoa(JSON.stringify(x)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    const accessToken=encode({alg:'none',typ:'JWT'})+'.'+encode(claims)+'.fixture';
    const record={uid:profile.uid,email:profile.email,displayName:profile.displayName,emailVerified:true,isAnonymous:false,providerData:[{providerId:'google.com',uid:'google-fixture',email:profile.email,displayName:profile.displayName}],stsTokenManager:{refreshToken:'fixture-refresh-token',accessToken,expirationTime:Date.now()+3600000},apiKey:entry.config.apiKey,appName:entry.appName};
    localStorage.setItem('firebase:authUser:'+entry.config.apiKey+':'+entry.appName,JSON.stringify(record));
   }
   localStorage.setItem('fixture-seeded','true');
  }
  window.fixturePageId=crypto.randomUUID();
 },{entries:GOOGLE_PROJECT_CONFIG,profile});
 const encode=value=>typeof value==='boolean'?{booleanValue:value}:typeof value==='string'?{stringValue:value}:{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
 let mode='success',reads=[],releaseProfile;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin===origin)return route.continue();
  if(url.hostname==='identitytoolkit.googleapis.com'&&url.pathname.endsWith('/accounts:lookup')){
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({users:[{localId:profile.uid,email:profile.email,emailVerified:true,displayName:profile.displayName,providerUserInfo:[{providerId:'google.com',rawId:'google-fixture',email:profile.email,displayName:profile.displayName}]}]})});
  }
  if(url.hostname==='firestore.googleapis.com'&&url.pathname.endsWith('/users/'+profile.uid)){
   reads.push(url.pathname);
   if(mode.startsWith('hang')&&url.pathname.includes('sahmt-gestao-5ae66'))await new Promise(resolve=>releaseProfile=resolve);
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:url.pathname.slice('/v1/'.length),fields:encode(mode==='hang-blocked'&&url.pathname.includes('sahmt-gestao-5ae66')?{...profile,active:false,access:false}:profile).mapValue.fields})});
  }
  return route.abort();
 });
 await page.goto(origin+base+'#/management-hub');
 await page.waitForSelector('.management-hub-dialog[open]',{timeout:20000});
 for(let i=0;i<4;i++){
  mode=i===0?'success':i===3?'hang-blocked':'hang';
  await page.getByRole('button',{name:'Grupos de Gestão',exact:true}).click();await page.waitForURL('**/gestao/**');
  await page.waitForSelector('[data-management-area]');
  if(i>0){
   await page.waitForFunction(()=>document.querySelector('#outbox-status')?.textContent.includes('VERIFICANDO CONEXÃO'));
   assert.match(await page.locator('[data-management-area]').first().innerText(),/local/);
   if(i>=2){
    await page.locator('[data-management-area]').first().click();
    await page.waitForSelector('#management-area-dialog[open]');
    await page.locator('#management-area-dialog form[data-module-form=activity] input[name=title]').fill('Atividade em edição');
    await page.evaluate(()=>{window.savedDraft=document.querySelector('#management-area-dialog form[data-module-form=activity] input[name=title]');window.savedDialog=document.querySelector('#management-area-dialog');});
   }
   while(!releaseProfile)await new Promise(resolve=>setTimeout(resolve,10));
   releaseProfile();releaseProfile=null;
  }
  if(i===3){
   await page.waitForFunction(()=>window.fixtureSession?.status==='blocked');
   assert.equal(await page.evaluate(()=>window.savedDraft.isConnected),false);
   const readsBefore=await page.evaluate(()=>window.fixtureCatalogReads);
   await page.evaluate(async()=>{window.savedDialog.dispatchEvent(new Event('close'));await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
   assert.equal(await page.evaluate(()=>window.fixtureCatalogReads),readsBefore);
   assert.equal(await page.locator('[data-management-area]').count(),0);
   break;
  }
  await page.waitForFunction(()=>window.fixtureSession?.status==='signed-in'&&window.fixtureSession.offline===false,{},{timeout:22000});
  // A server-confirmed profile must update the header even when dialogs survive.
  await page.waitForFunction(()=>document.querySelector('#outbox-open')?.classList.contains('sync-status-button--synced'),{},{timeout:3000});
  if(i===2){
   assert.equal(await page.locator('#management-area-dialog').evaluate(node=>node.open),true);
   assert.equal(await page.locator('#management-area-dialog form[data-module-form=activity] input[name=title]').inputValue(),'Atividade em edição');
   assert.equal(await page.evaluate(()=>window.savedDraft===document.querySelector('#management-area-dialog form[data-module-form=activity] input[name=title]')),true);
   await page.locator('[data-management-area-back]').click();
  }
  await page.waitForFunction(()=>document.querySelector('[data-management-area]')?.textContent.includes('servidor'),{},{timeout:3000});
  await page.locator('.management-home-button').click();
  await page.waitForURL('**/#/management-hub');await page.waitForSelector('.management-hub-dialog[open]',{timeout:20000});
  await page.locator('[data-hub-back]').click();await page.waitForSelector('#schedule-content');
  await page.getByRole('button',{name:/Governança/}).click();await page.waitForSelector('.management-hub-dialog[open]');
 }
 assert.deepEqual(errors,[]);assert.ok(reads.some(path=>path.includes('sahmt-gestao-5ae66')));
}finally{await browser?.close();await server.close();}
});
