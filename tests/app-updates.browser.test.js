import {mkdir} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

test('Governance indicators and the update notice work above mobile dialogs',{timeout:120000},async()=>{
 await mkdir('.local-preview',{recursive:true});
 const server=await createServer({configFile:false,appType:'custom',root:process.cwd(),base:'/',optimizeDeps:{noDiscovery:true,entries:[]},server:{host:'127.0.0.1',port:0}});
 server.middlewares.use('/updates-fixture',(req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:system-ui}*{box-sizing:border-box}</style><label>Rascunho<input id="draft"></label><button id="open-hub">Governança</button><div id="root"></div><script type="module" src="/tests/app-updates.fixture.js"></script></html>');});
 await server.listen();let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  for(const fallback of [false,true]){
   const context=await browser.newContext({viewport:{width:390,height:844}});
   if(fallback)await context.addInitScript(()=>{HTMLElement.prototype.showPopover=undefined;});
   const page=await context.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external.push(route.request().url());return route.abort();});
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/updates-fixture#/management-hub/results`);
   await page.waitForFunction(()=>window.fixtureReady);
   await page.getByLabel('Rascunho').fill('Texto em andamento');
   await page.getByRole('button',{name:'Governança',exact:true}).click();
   await page.getByRole('button',{name:/INDICADORES - SAHMT/}).click();
   await page.getByText('Os indicadores consolidados do SAHMT serão exibidos nesta área.').waitFor();
   assert.equal(await page.locator('#management-hub-title').textContent(),'INDICADORES - SAHMT');
   assert.equal(await page.locator('[data-hub-body] button').count(),0);
   assert.deepEqual(await page.evaluate(()=>window.indicatorCalls),[]);
   assert.equal(await page.locator('iframe').count(),0);
   assert.equal(await page.locator('#management-hub-title').textContent(),'INDICADORES - SAHMT');
   assert.deepEqual(await page.evaluate(()=>window.indicatorCalls),[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.evaluate(()=>window.offerUpdate());
   await page.getByRole('button',{name:'Atualizar agora',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.repairs),[],'the page never reloads merely because a version is available');
   await page.screenshot({path:`.local-preview/app-updates-indicators-mobile${fallback?'-fallback':''}.png`,fullPage:true});
   await page.getByRole('button',{name:'Depois',exact:true}).click();
   assert.equal(await page.locator('#sahmt-app-update-prompt').isVisible(),false);
   await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
   await page.evaluate(()=>{window.repairAccepted=false;history.replaceState(null,'',location.pathname);});
   await page.getByRole('button',{name:'Atualizar agora',exact:true}).click();
   assert.equal(await page.locator('#sahmt-app-update-prompt').isVisible(),true);
   assert.match(await page.locator('[data-app-update-message]').textContent(),/Não foi possível iniciar/);
   await page.evaluate(()=>{window.repairAccepted=true;location.hash='#/management-hub/results';});
   await page.getByRole('button',{name:'Atualizar agora',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>window.repairs),[{target:'FA',hash:'#/home'},{target:'FA',hash:'#/management-hub/results'}]);
   assert.equal(await page.locator('#sahmt-app-update-prompt').isVisible(),false);
   await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
   assert.equal(await page.locator('#sahmt-app-update-prompt').isVisible(),false,'accepted updates do not reappear on the old page');
   await page.evaluate(()=>window.closeHub());
   assert.equal(await page.getByLabel('Rascunho').inputValue(),'Texto em andamento');

   // The FK performance panel is no longer part of Governança/FD.
   await page.evaluate(()=>window.openHub());
   assert.equal(await page.getByRole('button',{name:'INDICADORES - SAHMT',exact:true}).count(),1);
   await page.evaluate(()=>window.openHub(false));
   assert.equal(await page.getByRole('button',{name:/INDICADORES - SAHMT/}).isDisabled(),true);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   await context.close();
  }
 }finally{await browser?.close();await server.close();}
});
