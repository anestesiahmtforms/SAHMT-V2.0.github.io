import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';

test('administrator can scroll document folders while the return footer stays visible', {timeout:120000},async()=>{
 const server=await createServer({configFile:false,appType:'custom',root:process.cwd(),base:'/',optimizeDeps:{noDiscovery:true,entries:[]},define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FB'}),'import.meta.env.VITE_HTML_TRAINING_ENDPOINT':'""'},server:{host:'127.0.0.1',port:0}});
 const main=await readFile('src/main.js','utf8');
 const activityTemplate=main.slice(main.indexOf("  if (route === 'management' && (can('managementActivityWrite')"),main.indexOf("  if (route === 'notifications'",main.indexOf("  if (route === 'management' && (can('managementActivityWrite')")));
 const activityForm=Function('can','route',activityTemplate+'return "";')(()=>true,'management');
 server.middlewares.use('/admin-scroll-fixture',(req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><dialog class="management-area-dialog"><header class="management-area-dialog__header"><h2>Área</h2></header><div class="management-area-dialog__body"><div class="management-area-detail" id="root"></div></div><footer class="management-area-dialog__footer"><button>VOLTAR</button></footer></dialog><script type="module" src="/tests/html-training-ui.fixture.js"></script></html>');});
 await server.listen();let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/admin-scroll-fixture`);
  await page.locator('dialog').evaluate(dialog=>dialog.showModal());
  await page.getByRole('button',{name:'Protocolos',exact:true}).waitFor();
  await page.locator('.management-area-dialog__body').evaluate((body,html)=>body.insertAdjacentHTML('afterbegin',html),activityForm);
  await page.evaluate(()=>{window.mount('admin');});
  await page.getByRole('button',{name:'Desativar Protocolos',exact:true}).waitFor();
  for(const [width,height] of [[320,568],[390,844],[667,375],[1366,768]]){
   await page.setViewportSize({width,height});
   assert.ok(await page.locator('.ht-browser-grid').evaluate(grid=>grid.clientHeight)>40,'administrator activity form must not collapse the folder viewport');
   await page.getByRole('button',{name:'ROPs',exact:true}).click();
   await page.getByRole('button',{name:'Desativar Cultura de segurança',exact:true}).waitFor();
   const layout=await page.locator('.ht-browser-grid').evaluate(grid=>{const dialog=grid.closest('dialog'),footer=dialog.querySelector('footer');return {gridHeight:grid.clientHeight,contentHeight:grid.scrollHeight,gridBottom:grid.getBoundingClientRect().bottom,footerTop:footer.getBoundingClientRect().top,footerBottom:footer.getBoundingClientRect().bottom};});

   assert.ok(layout.gridHeight>40,'grid retains a usable viewport');
   assert.ok(layout.gridBottom<=layout.footerTop+2,'folder grid stays above return footer');
   assert.ok(layout.footerBottom<=height,'return stays inside screen');
   if(layout.contentHeight>layout.gridHeight+2){
    await page.locator('.ht-browser-grid').hover();await page.mouse.wheel(0,800);await page.waitForTimeout(150);
    assert.ok(await page.locator('.ht-browser-grid').evaluate(grid=>grid.scrollTop)>0,'wheel scroll reaches administrator folders');
   }
   await mkdir('.local-preview',{recursive:true});await page.screenshot({path:`.local-preview/document-admin-scroll-${width}.png`});
   await page.evaluate(()=>window.trainingBack());
  }
 }finally{await browser?.close();await server.close();}
});

