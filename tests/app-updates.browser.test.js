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
   await page.evaluate(()=>{window.obligation=window.openRequiredActivity();});
   const activity=page.locator('[data-obligation-banner][data-blocking="true"]');
   await activity.waitFor();
   await page.evaluate(()=>window.offerUpdate());
   const update=page.getByRole('dialog',{name:'Nova versão disponível',exact:true});
   await update.waitFor({timeout:3000});
   assert.equal(await activity.isVisible(),false);
   assert.equal(await page.getByRole('button',{name:'Depois',exact:true}).count(),0);
   assert.deepEqual(await page.evaluate(()=>window.repairs),[]);
   await page.keyboard.press('Escape');
   assert.equal(await update.isVisible(),true);
   await page.evaluate(()=>{location.hash='#/schedule';});
   await page.waitForFunction(()=>location.hash==='#/management-hub/results');
   await page.evaluate(()=>{window.repairAccepted=false;});
   await update.getByRole('button',{name:'Atualizar agora',exact:true}).click();
   assert.equal(await update.isVisible(),true);
   assert.match(await update.locator('[data-app-update-message]').textContent(),/Não foi possível iniciar/);
   await page.evaluate(()=>{window.repairAccepted=true;});
   await update.getByRole('button',{name:'Atualizar agora',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>window.repairs),[{target:'FA',hash:'#/management-hub/results'},{target:'FA',hash:'#/management-hub/results'}]);
   assert.equal(await update.isVisible(),true,'the old page stays blocked until navigation');
   assert.equal(await page.evaluate(()=>window.obligationOpenCount),0);
   await page.evaluate(()=>window.updates.stop());
   await activity.waitFor();
   await page.evaluate(()=>window.obligation.cleanup());
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
