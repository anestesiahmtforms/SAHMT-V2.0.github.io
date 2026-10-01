/*
 * Reproducible validation of two real PWA builds using only fictional local data.
 * Every non-local browser request is aborted; no production login or mutation.
 *
 * node scripts/verify-pwa-browser.cjs           -> offline/update/image checks
 * node scripts/verify-pwa-browser.cjs --measure -> 3 samples per build, CPU 4x,
 *                                               150 ms latency, 1.6 Mbps down
 *
 * Prerequisites: current npm build in dist, baseline build exported separately,
 * Playwright available to Node, and an installed or bundled Chromium browser.
 * Optional environment variables:
 *   SAHMT_BASELINE_DIST: baseline dist directory; defaults to
 *                       .local-preview/old-source/dist under the repository.
 *   SAHMT_PLAYWRIGHT_MODULE: module name or absolute Playwright package path;
 *                            defaults to playwright.
 *   SAHMT_BROWSER_EXECUTABLE: optional Chromium/Edge executable path;
 *                             omitted uses Playwright's bundled Chromium.
 * JSON artifacts are written to .local-preview under the repository.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const BASE = '/SAHMT-V2.0.github.io/';
const root = path.resolve(__dirname, '..');
const artifactDir = path.join(root, '.local-preview');
const builds = {
  old: path.resolve(process.env.SAHMT_BASELINE_DIST || path.join(artifactDir, 'old-source', 'dist')),
  current: path.join(root, 'dist')
};
for (const [name, directory] of Object.entries(builds)) {
  for (const file of ['index.html', 'assets-manifest.json', 'service-worker.js']) {
    if (!fs.existsSync(path.join(directory, file))) {
      throw new Error(`Build ${name} incompleto: ${path.join(directory, file)} não existe. Execute o build atual e prepare um build de referência; use SAHMT_BASELINE_DIST para indicar sua pasta dist.`);
    }
  }
}
fs.mkdirSync(artifactDir, {recursive: true});
const cacheVersions = Object.fromEntries(Object.entries(builds).map(([name, directory]) => {
  const match = fs.readFileSync(path.join(directory, 'service-worker.js'), 'utf8').match(/const CACHE = '(sahmt-v2-shell-v\d+)'/);
  if (!match) throw new Error(`Versão do service worker ${name} ausente.`);
  return [name, match[1]];
}));
let chromium;
try {
  ({chromium} = require(process.env.SAHMT_PLAYWRIGHT_MODULE || 'playwright'));
} catch (error) {
  throw new Error('Playwright não está disponível. Indique um módulo existente em SAHMT_PLAYWRIGHT_MODULE ou disponibilize playwright no ambiente Node.', {cause: error});
}
const mime = {'.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.webmanifest':'application/manifest+json'};
let activeBuild = 'current';
let requests = [];
let serverOnline = true;
const imageOverrides = new Map();
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  requests.push({build: activeBuild, path: pathname, served: serverOnline, at: Date.now()});
  // Chromium's background SW update check bypasses context.setOffline. Refuse
  // the socket too, so even that browser-internal check receives no response.
  if (!serverOnline) { req.socket.destroy(); return; }
  if (pathname === '/fixture-seed') { res.writeHead(200, {'content-type':'text/html'}); res.end('<!doctype html><title>Fictional local fixture</title>'); return; }
  if (!pathname.startsWith(BASE)) { res.writeHead(404); res.end(); return; }
  const file = pathname.slice(BASE.length) || 'index.html';
  if (imageOverrides.has(file)) {
    res.writeHead(200, {'content-type':'image/png', 'cache-control':'max-age=86400'});
    res.end(imageOverrides.get(file)); return;
  }
  const target = path.resolve(builds[activeBuild], file);
  if (!target.startsWith(builds[activeBuild] + path.sep)) { res.writeHead(404); res.end(); return; }
  if (!fs.existsSync(target)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(target);
  res.writeHead(200, {'content-type':mime[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-store'});
  res.end(body);
});

async function seed(page) {
  return page.evaluate(async () => {
    const uid = 'fictional-fixture-user';
    const apiKey = 'AIzaSyDg7plEPhaIieyDP3z462gxG9cY_OQCzvA';
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const header = btoa(JSON.stringify({alg:'none',typ:'JWT'}));
    const payload = btoa(JSON.stringify({sub:uid, aud:'sahmt-17a16', iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000)+86400}));
    const user = {uid, email:'fixture@example.invalid', emailVerified:true, displayName:'Usuário Fictício', isAnonymous:false, providerData:[], stsTokenManager:{refreshToken:'fictional-local-only',accessToken:`${header}.${payload}.fixture`,expirationTime:Date.now()+86400000}, createdAt:String(Date.now()),lastLoginAt:String(Date.now()),apiKey,appName:'sahmt-v2'};
    localStorage.setItem(`firebase:authUser:${apiKey}:sahmt-v2`, JSON.stringify(user));
    const authDb=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('firebaseLocalStorageDb',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('firebaseLocalStorage',{keyPath:'fbase_key'});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const tx=authDb.transaction('firebaseLocalStorage','readwrite');
      tx.objectStore('firebaseLocalStorage').put({fbase_key:`firebase:authUser:${apiKey}:sahmt-v2`,value:user});
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });authDb.close();
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('sahmt-v2-local',3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles',{keyPath:'uid'});
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache',{keyPath:'key'});
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox',{keyPath:'requestId'});
        const cache = request.transaction.objectStore('cache');
        if (!cache.indexNames.contains('uid')) cache.createIndex('uid','uid',{unique:false});
        const outbox = request.transaction.objectStore('outbox');
        if (!outbox.indexNames.contains('uid')) outbox.createIndex('uid','uid',{unique:false});
        if (!outbox.indexNames.contains('uidStatus')) outbox.createIndex('uidStatus',['uid','status'],{unique:false});
      };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject) => {
      const tx=db.transaction(['profiles','cache','outbox'],'readwrite');
      tx.objectStore('profiles').put({uid,email:user.email,displayName:user.displayName,sigla:'FX',active:true,access:true,role:'anestesiologista',permissions:{scheduleRead:true,eventsRead:true,eventsWrite:true,labelsRead:true,labelsWrite:true,checklistRead:true,checklistWrite:true},cachedAt:Date.now()});
      const put=(kind,id,data)=>tx.objectStore('cache').put({key:`${uid}::${kind}::${id}`,uid,kind,id,data,cachedAt:Date.now()});
      put('scheduleDays',today,{id:today,date:today,assignments:['FX','FY'],active:true});
      put('contacts','active',[{id:'FX',sigla:'FX',name:'Membro Fictício',active:true}]);
      put('vacations',today,[]);
      put('appConfig','app',{features:{}});
      tx.objectStore('outbox').put({requestId:'fictional-stable-request-id',uid,type:'events',status:'pending',payload:{eventDate:today,memberSigla:'FX'},attempts:0,createdAt:Date.now()});
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    db.close();return {uid,today};
  });
}

async function localContext(browser, {reportedOffline = false} = {}) {
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const blocked = [];
  await context.route('**/*', route => {
    if (!route.request().url().startsWith(origin)) {blocked.push(route.request().url());return route.abort();}
    return route.continue();
  });
  if (reportedOffline) await context.addInitScript(() => Object.defineProperty(Navigator.prototype,'onLine',{get:()=>false,configurable:true}));
  return {context,blocked};
}

async function prime(page, build) {
  activeBuild=build;
  serverOnline=true;
  await page.goto(origin+BASE);
  await page.evaluate(async () => {
    const registration=await navigator.serviceWorker.register('/SAHMT-V2.0.github.io/service-worker.js',{scope:'/SAHMT-V2.0.github.io/'});
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    return registration.active?.scriptURL;
  });
  await seed(page);
}

async function checkOffline(browser) {
  const {context,blocked}=await localContext(browser);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await prime(page,'current');
  await page.waitForLoadState('networkidle');
  const networkBefore=requests.length;
  serverOnline=false;
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.identity-card__user').filter({hasText:'Usuário Fictício'}).waitFor({timeout:15000}).catch(async e=>{console.log(await page.locator('body').innerText(),errors);throw e;});
  await page.locator('.schedule-sigla').first().waitFor({timeout:10000}).catch(()=>{});
  assert.ok((await page.locator('#app').innerText()).includes('FX'),'escala fictícia em cache deve abrir offline');
  await page.locator('[data-route="labels"]').click();
  await page.locator('#label-manual-open').click();
  await page.locator('#label-entry-dialog[open]').waitFor();
  await page.locator('[name="patientName"]').fill('CASO FICTÍCIO SEM PACIENTE');
  await page.locator('#label-entry-close').click();
  await page.evaluate(async file => {
    const module=await import(`/SAHMT-V2.0.github.io/${file}`);
    if (typeof module.bindLabelCamera!=='function') throw new Error('camera controller missing');
  },JSON.parse(fs.readFileSync(path.join(builds.current,'assets-manifest.json')))['src/label-camera.js']?.file);
  await page.evaluate(async()=>{
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='/SAHMT-V2.0.github.io/vendor/zxing.min.js';
      script.onload=resolve;script.onerror=()=>reject(new Error('QR decoder unavailable offline'));
      document.head.append(script);
    });
    if(typeof window.ZXing?.QRCodeReader!=='function')throw new Error('QR decoder API missing');
  });
  const preserved=await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('sahmt-v2-local',3);r.onsuccess=()=>resolve(r.result);});
    const value=await new Promise(resolve=>{const r=db.transaction('outbox').objectStore('outbox').get('fictional-stable-request-id');r.onsuccess=()=>resolve(r.result);});
    db.close();return value;
  });
  assert.equal(preserved.requestId,'fictional-stable-request-id');
  const offlineRequests=requests.slice(networkBefore);
  assert.ok(offlineRequests.every(r=>!r.served && r.path.endsWith('/service-worker.js')),`nenhum recurso do app deve alcançar o servidor local durante abertura offline: ${JSON.stringify(offlineRequests)}`);
  const caches=await page.evaluate(()=>caches.keys());
  assert.deepEqual(errors, [], 'abertura offline não deve gerar rejeição de módulo obrigatório');
  const result={offlineOpen:true,cachedSchedule:true,labelsManualDialog:true,cameraModuleOffline:true,qrDecoderOffline:true,stableOutboxPreserved:true,serverResponsesWhileOffline:0,refusedBrowserUpdateChecks:offlineRequests.length,cacheNames:caches,externalRequestsBlocked:blocked.length,pageErrors:errors};
  await context.close();return result;
}

async function checkOldTab(browser) {
  const {context,blocked}=await localContext(browser,{reportedOffline:true});
  const page=await context.newPage();
  await prime(page,'old');
  await page.reload();
  await page.locator('.identity-card__user').filter({hasText:'Usuário Fictício'}).waitFor();
  const oldManifest=JSON.parse(fs.readFileSync(path.join(builds.old,'assets-manifest.json')));
  const oldEntry=oldManifest['index.html'].file;
  const oldCamera=oldManifest['src/label-camera.js'].file;
  assert.ok(await page.evaluate(entry=>performance.getEntriesByType('resource').some(r=>r.name.endsWith(entry)),oldEntry));
  activeBuild='current';
  await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.getRegistration();
    await registration.update();
    if (registration.installing) await new Promise((resolve,reject)=>{
      const worker=registration.installing;worker.addEventListener('statechange',()=>{
        if(worker.state==='activated')resolve();
        if(worker.state==='redundant')reject(new Error('new worker redundant'));
      });
    });
  });
  await page.waitForFunction(async expected=>{const names=await caches.keys();return names.includes(expected);}, cacheVersions.current);
  serverOnline=false;
  await context.setOffline(true);
  const networkBefore=requests.length;
  await page.locator('[data-route="labels"]').click();
  await page.locator('#label-manual-open').click();
  await page.locator('#label-entry-dialog[open]').waitFor();
  await page.evaluate(async file=>{await import(`/SAHMT-V2.0.github.io/${file}`);},oldCamera);
  const names=await page.evaluate(()=>caches.keys());
  assert.ok(names.includes(cacheVersions.old),'cache da aba antiga deve permanecer');
  assert.ok(names.includes(cacheVersions.current),'novo cache deve estar ativo');
  assert.ok(requests.slice(networkBefore).every(r=>!r.served && r.path.endsWith('/service-worker.js')));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.identity-card__user').filter({hasText:'Usuário Fictício'}).waitFor();
  const currentManifest=JSON.parse(fs.readFileSync(path.join(builds.current,'assets-manifest.json')));
  const currentEntry=currentManifest['index.html'].file;
  assert.ok(await page.evaluate(entry=>performance.getEntriesByType('resource').some(r=>r.name.endsWith(entry)),currentEntry),'a navegação offline seguinte deve usar o shell atualizado');
  const result={oldTabEntry:oldEntry,oldCamera,oldTabLabelsAfterUpdate:true,newOfflineNavigationUsesCurrentBuild:true,cacheNames:names,serverResponsesWhileOffline:0,externalRequestsBlocked:blocked.length};
  await context.close();return result;
}

async function checkSameUrlImageRefresh(browser) {
  const {context}=await localContext(browser,{reportedOffline:true});
  const page=await context.newPage();
  await prime(page,'current');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.identity-card__user').filter({hasText:'Usuário Fictício'}).waitFor();
  const images=await page.evaluate(()=>['#c00','#0c0'].map(color=>{
    const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
    const paint=canvas.getContext('2d');paint.fillStyle=color;paint.fillRect(0,0,8,8);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const file='assets/offline-schedule/segunda-2026.jpg';
  imageOverrides.set(file,Buffer.from(images[0],'base64'));
  const oldImage=await page.evaluate(async file=>{
    const response=await fetch(`/SAHMT-V2.0.github.io/${file}`);
    const cache=await caches.open('sahmt-v2-offline-schedule-v1');
    await cache.put(`/SAHMT-V2.0.github.io/${file}`,response.clone());
    return btoa(String.fromCharCode(...new Uint8Array(await response.arrayBuffer())));
  },file);
  assert.equal(oldImage,images[0]);
  imageOverrides.set(file,Buffer.from(images[1],'base64'));
  const newImage=await page.evaluate(async file=>{
    const response=await fetch(`/SAHMT-V2.0.github.io/${file}`,{cache:'reload'});
    const cache=await caches.open('sahmt-v2-offline-schedule-v1');
    await cache.put(`/SAHMT-V2.0.github.io/${file}`,response.clone());
    return btoa(String.fromCharCode(...new Uint8Array(await response.arrayBuffer())));
  },file);
  assert.equal(newImage,images[1],'reload deve receber imagem corrigida do servidor na mesma URL');
  serverOnline=false;await context.setOffline(true);
  const preserved=await page.evaluate(async file=>{
    const cache=await caches.open('sahmt-v2-offline-schedule-v1');
    const response=await cache.match(`/SAHMT-V2.0.github.io/${file}`);
    const image=btoa(String.fromCharCode(...new Uint8Array(await response.arrayBuffer())));
    const db=await new Promise(resolve=>{const r=indexedDB.open('sahmt-v2-local',3);r.onsuccess=()=>resolve(r.result);});
    const outbox=await new Promise(resolve=>{const r=db.transaction('outbox').objectStore('outbox').get('fictional-stable-request-id');r.onsuccess=()=>resolve(r.result);});
    db.close();return {image,requestId:outbox.requestId};
  },file);
  assert.equal(preserved.image,images[1]);assert.equal(preserved.requestId,'fictional-stable-request-id');
  imageOverrides.delete(file);await context.close();
  return {sameUrlCorrectedImage:true,correctedImageAvailableOfflineCache:true,stableOutboxPreserved:true,images:'local 8x8 synthetic red/green PNG; no patient data',offlineVerification:'CacheStorage body check; request/cache precedence covered by SW regression test'};
}

async function measureBuild(browser,build) {
  activeBuild=build;
  serverOnline=true;
  const results=[];
  for(let sample=0;sample<3;sample++) {
    const {context}=await localContext(browser,{reportedOffline:true});
    const page=await context.newPage();
    await page.goto(origin+'/fixture-seed');await seed(page);
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750,connectionType:'cellular4g'});
    const start=Date.now();await page.goto(origin+BASE,{waitUntil:'domcontentloaded'});
    await page.locator('.identity-card__user').filter({hasText:'Usuário Fictício'}).waitFor();
    const open=Date.now()-start;
    const clickStart=Date.now();await page.locator('#schedule-next').click();
    await page.waitForFunction(()=>document.querySelector('#schedule-date')?.value!==new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
    const firstInteraction=Date.now()-clickStart;
    const moduleStart=Date.now();await page.locator('[data-route="labels"]').click();
    await page.locator('#label-manual-open').click();await page.locator('#label-entry-dialog[open]').waitFor();
    const labelsManual=Date.now()-moduleStart;
    results.push({openMs:open,firstInteractionMs:firstInteraction,labelsManualMs:labelsManual});
    await context.close();
  }
  return {samples:results,medians:Object.fromEntries(Object.keys(results[0]).map(key=>[key,results.map(v=>v[key]).sort((a,b)=>a-b)[1]]))};
}

let origin;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,...(process.env.SAHMT_BROWSER_EXECUTABLE ? {executablePath:process.env.SAHMT_BROWSER_EXECUTABLE} : {})});
  try {
    const report=process.argv.includes('--measure') ? {fixture:'real builds; 390x844; CPU4x; 150ms/1.6Mbps; synthetic offline profile; external requests aborted',baseline:await measureBuild(browser,'old'),current:await measureBuild(browser,'current')} : {offline:await checkOffline(browser),oldTab:await checkOldTab(browser),imageRefresh:await checkSameUrlImageRefresh(browser)};
    const reportPath=path.join(artifactDir,process.argv.includes('--measure')?'mobile-measures.json':'offline-browser-results.json');
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e.stack);server.close();process.exitCode=1;});
