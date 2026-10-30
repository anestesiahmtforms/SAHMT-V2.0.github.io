import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
const safari=process.env.SAHMT_BROWSER_ENGINE==='webkit';
const engine=safari?webkit:chromium;
const browserOptions={headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})};
const pageOptions=safari?{isMobile:true,hasTouch:true,deviceScaleFactor:3}:{};

test('administrator can scroll document folders while the return footer stays visible', {timeout:120000},async()=>{
 const server=await createServer({configFile:false,appType:'custom',root:process.cwd(),base:'/',optimizeDeps:{noDiscovery:true,entries:[]},define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FB'}),'import.meta.env.VITE_HTML_TRAINING_ENDPOINT':'""'},server:{host:'127.0.0.1',port:0}});
 const main=await readFile('src/main.js','utf8');
 const activityTemplate=main.slice(main.indexOf("  if (route === 'management' && (can('managementActivityWrite')"),main.indexOf("  if (route === 'notifications'",main.indexOf("  if (route === 'management' && (can('managementActivityWrite')")));
 const activityForm=Function('can','route',activityTemplate+'return "";')(()=>true,'management');
 server.middlewares.use('/admin-scroll-fixture',(req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><dialog class="management-area-dialog"><header class="management-area-dialog__header"><h2>Área</h2></header><div class="management-area-dialog__body"><div class="management-area-detail" id="root"></div></div><footer class="management-area-dialog__footer"><button>VOLTAR</button></footer></dialog><script type="module" src="/tests/html-training-ui.fixture.js"></script></html>');});
 await server.listen();let browser;
 try{
  browser=await engine.launch(browserOptions);
  const page=await browser.newPage(pageOptions);
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/admin-scroll-fixture`);
  await page.evaluate(()=>{const shell=document.createElement('div');shell.className='app-shell app-shell--management';shell.innerHTML='<header class="topbar">SAHMT</header><main class="main-content"><section class="module-view panel module-view--management"><div class="management-menu-scroll"><div id="module-content" class="module-content"></div></div><button class="management-home-button">VOLTAR</button></section></main><footer class="app-footer">SAHMT</footer>';document.body.append(shell);shell.querySelector('#module-content').append(document.querySelector('dialog'));});
  await page.locator('dialog').evaluate(dialog=>dialog.showModal());
  await page.getByRole('button',{name:'Protocolos',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  const participant=await page.locator('.management-document-banner').boundingBox();
  assert.ok(participant.height<560&&Math.abs(participant.y+participant.height/2-422)<2,'participant sees a compact central panel');
  await page.locator('.management-area-dialog__body').evaluate((body,html)=>body.insertAdjacentHTML('afterbegin',html),activityForm);
  await page.evaluate(()=>{window.mount('admin');});
  await page.getByRole('button',{name:'Desativar Protocolos',exact:true}).waitFor();
  assert.equal(await page.locator('.management-document-banner').count(),1,'remount never nests banner panels');
  const admin=await page.locator('.management-document-banner').boundingBox();
  assert.ok(Math.abs(admin.height-participant.height)<40,'admin controls do not add a new row or stretch the banner');
  const legacy=await page.addStyleTag({content:'.app-shell dialog{inset:5dvh 5vw!important;width:90vw!important;height:90dvh!important;max-width:90vw!important;max-height:90dvh!important;margin:0!important;overflow:auto!important}'});
  const insideLegacy=await page.locator('.management-document-banner').boundingBox();
  assert.ok(Math.abs(insideLegacy.height-admin.height)<2&&Math.abs(insideLegacy.y+insideLegacy.height/2-422)<2,'visible banner stays compact even when an outer dialog is forced to 90% height');
  await legacy.evaluate(style=>style.remove());
  await mkdir('.local-preview',{recursive:true});
  await page.screenshot({path:'.local-preview/document-admin-central-banner.png'});
  for(const [width,height] of [[320,568],[390,844],[667,375],[1366,768]]){
   await page.setViewportSize({width,height});
   assert.ok(await page.locator('.ht-browser-grid').evaluate(grid=>grid.clientHeight)>40,'administrator activity form must not collapse the folder viewport');
   await page.getByRole('button',{name:'ROPs',exact:true}).click();
   await page.getByRole('button',{name:'Desativar Cultura de segurança',exact:true}).waitFor();
   const layout=await page.locator('.management-area-dialog__body').evaluate(body=>{const panel=body.closest('.management-document-banner'),footer=panel.querySelector('footer'),rect=panel.getBoundingClientRect();return {gridHeight:body.clientHeight,contentHeight:body.scrollHeight,gridBottom:body.getBoundingClientRect().bottom,footerTop:footer.getBoundingClientRect().top,footerBottom:footer.getBoundingClientRect().bottom,panelTop:rect.top,panelBottom:rect.bottom,panelCenter:rect.y+rect.height/2,panelWidth:rect.width};});

   assert.ok(layout.gridHeight>40,'grid retains a usable viewport');
   assert.ok(layout.gridBottom<=layout.footerTop+2,'folder grid stays above return footer');
   assert.ok(layout.footerBottom<=height,'return stays inside screen');
   assert.ok(layout.panelTop>=0&&layout.panelBottom<=height&&Math.abs(layout.panelCenter-height/2)<2,'panel stays inside and centered in the viewport');
   assert.ok(Math.abs(layout.panelWidth-width*.9)<2,'panel retains 90% of viewport width');
   if(layout.contentHeight>layout.gridHeight+2){
    if(safari)await page.locator('.management-area-dialog__body').evaluate(el=>el.scrollBy(0,800));
    else {await page.locator('.management-area-dialog__body').hover();await page.mouse.wheel(0,800);}
    await page.waitForTimeout(150);
    assert.ok(await page.locator('.management-area-dialog__body').evaluate(body=>body.scrollTop)>0,'internal scroll reaches administrator folders');
   }
   await mkdir('.local-preview',{recursive:true});await page.screenshot({path:`.local-preview/document-admin-scroll-${width}.png`});
   await page.evaluate(()=>window.trainingBack());
  }
 }finally{await browser?.close();await server.close();}
});


test('management subfolder dialogs center compact content at 90% width and scroll long content', {timeout:60000},async()=>{
 const css=await readFile('src/styles.css','utf8');
 const browser=await engine.launch(browserOptions);
 try{
  const page=await browser.newPage(pageOptions);
  await page.route('**/*',route=>route.abort());
  for(const className of ['management-area-dialog','management-document-dialog']){
   await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div class="app-shell app-shell--management"><dialog class="${className}"><header class="management-area-dialog__header"><h2>Subpasta de Gestão</h2></header><div class="management-area-dialog__body"><button>Documento A</button><button>Documento B</button></div><footer class="management-area-dialog__footer"><button>VOLTAR</button></footer></dialog></div>`);
   await page.locator('dialog').evaluate(dialog=>dialog.showModal());
   for(const [width,height] of [[320,568],[390,844],[667,375],[1366,900]]){
    await page.setViewportSize({width,height});
    const box=await page.locator('dialog').boundingBox();
    assert.ok(Math.abs(box.width-width*.9)<2,'dialog occupies 90% of viewport width');
    assert.ok(Math.abs(box.x+box.width/2-width/2)<2&&Math.abs(box.y+box.height/2-height/2)<2,'dialog centers on both axes');
    assert.ok(box.height<height*.7,'short content does not expand vertically');
    assert.ok(box.y>0&&box.y+box.height<height,'space stays outside the compact dialog');
   }
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:`.local-preview/${className}-centered-mobile.png`});
   await page.locator('.management-area-dialog__body').evaluate(body=>{body.innerHTML=Array.from({length:25},(_,i)=>`<p>Documento de teste ${i+1}</p>`).join('');});
   await page.setViewportSize({width:320,height:568});
   const body=page.locator('.management-area-dialog__body');
   assert.ok(await body.evaluate(el=>el.scrollHeight>el.clientHeight),'long content has internal scroll');
   if(safari)await body.evaluate(el=>el.scrollBy(0,600));
   else {await body.hover();await page.mouse.wheel(0,600);}
   await page.waitForTimeout(150);
   assert.ok(await body.evaluate(el=>el.scrollTop)>0,'long subfolder content scrolls');
   const footer=await page.locator('footer').boundingBox();
   assert.ok(footer.y+footer.height<=568,'return footer stays visible');
  }
 }finally{await browser.close();}
});
