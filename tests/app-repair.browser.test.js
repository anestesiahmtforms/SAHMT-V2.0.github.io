import test from 'node:test';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
test('repair activates both current shells and preserves another open draft and local data',{timeout:120000},async()=>{
 const root='/SAHMT-V2.0.github.io/';let version=238,browser,server;
 const sources={};for(const prefix of ['','gestao/'])sources[root+prefix+'service-worker.js']=await readFile('dist/'+prefix+'service-worker.js','utf8');
 try{
  server=await preview({preview:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-release-update',configurePreviewServer(server){server.middlewares.use((req,res,next)=>{
   const source=sources[req.url?.split('?')[0]];if(!source)return next();res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','no-store');res.end(source.replaceAll('shell-v239','shell-v'+version));
  });}}]});
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const hold=await context.newPage();await hold.goto(origin+root);await hold.waitForSelector('#google-login',{timeout:20000});await hold.evaluate(()=>navigator.serviceWorker.ready);
  await hold.evaluate(()=>{localStorage.setItem('isolated-pending-record','preserved');const input=document.createElement('textarea');input.id='isolated-draft';input.value='Rascunho preservado';document.body.append(input);});
  const page=await context.newPage();await page.goto(origin+root+'gestao/#/management');await page.waitForSelector('#google-login',{timeout:20000});await page.evaluate(()=>navigator.serviceWorker.ready);
  version=239;
  const hash='#/management/area-gestao-de-documentos';
  await page.goto(origin+root+'tools/refresh-app.html?'+new URLSearchParams({target:'FB',route:hash}));
  await page.waitForURL(url=>url.pathname===root+'gestao/'&&url.hash===hash,{timeout:70000});
  await page.waitForSelector('#google-login',{timeout:15000});
  const keys=await page.evaluate(()=>caches.keys());assert.ok(keys.includes('sahmt-v2-shell-v239'));assert.ok(keys.includes('sahmt-fb-v2-shell-v239'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('isolated-pending-record')),'preserved');
  assert.equal(await hold.locator('#isolated-draft').inputValue(),'Rascunho preservado');
  assert.equal(await page.locator('.google-auth-update:visible').count(),0);
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));}
});
