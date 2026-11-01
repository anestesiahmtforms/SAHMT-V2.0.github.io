import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const engine=process.env.QMENTUM_BROWSER==='webkit'?webkit:chromium;
const launchOptions=process.env.QMENTUM_BROWSER_CHANNEL?{channel:process.env.QMENTUM_BROWSER_CHANNEL,headless:true}:{headless:true};
const viewports=[['mobile',390,844],['tablet',768,1024],['desktop',1440,1000],['compact',320,568]];

test('legacy manual state and manager print entry keep the selected month in one dialog',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port,base=origin+server.config.base;browser=await engine.launch(launchOptions);const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await fixture(page,base,{withPrints:true,legacy:true});
  await page.getByRole('button',{name:'Entrada manual',exact:true}).click();assert.equal(await page.locator('select[data-state="anestheticProcedures"]').inputValue(),'MISSING');assert.equal(await page.locator('[data-count="anestheticProcedures"]').inputValue(),'');await page.locator('[data-qm-close]').click();
  await page.locator('#qm-date').fill('2026-08');await page.locator('#qm-date').dispatchEvent('change');await page.waitForFunction(()=>document.querySelector('.qm-module-status')?.textContent.includes('Agosto'));
  await page.getByRole('button',{name:'Entrada por prints',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),1);assert.match(await page.locator('[data-print-scope]').innerText(),/2026-08/);
  await page.getByRole('button',{name:'Usar Drive',exact:true}).click();await page.getByRole('button',{name:'Sincronizar alterações',exact:true}).click();await page.waitForFunction(()=>window.monthly.printCalls.length===1);assert.deepEqual(await page.evaluate(()=>window.monthly.printCalls[0]),{unitId:'synthetic-a',year:2026});
  await page.locator('[data-qm-close]').click();assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#qm-date').inputValue(),'2026-08');
  await fixture(page,base,{role:'collector',withPrints:true});assert.equal(await page.getByRole('button',{name:'Entrada por prints',exact:true}).count(),0);
 }finally{await browser?.close();await server.close();}
});

async function fixture(page,base,options={}) {
 await page.goto(base+'tests/fixtures/qmentum-runtime.html');
 await page.evaluate(async({base,options})=>{
  const {mountMonthlyFixture}=await import(base+'tests/fixtures/qmentum-monthly-fixture.js');
  window.monthly=await mountMonthlyFixture(document.querySelector('#root'),options);
 },{base,options});
}

test('monthly home and single-modal navigation across four viewport sizes',async()=>{
 await mkdir('.local-preview/qmentum',{recursive:true});
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});let browser;
 try {
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port,base=origin+server.config.base;
  browser=await engine.launch(launchOptions);
  for(const [name,width,height] of viewports) {
   const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await fixture(page,base);
   assert.equal(await page.locator('#qm-date').getAttribute('type'),'month',name);
   assert.equal(await page.locator('#qm-date').inputValue(),'2026-06',name);
   assert.equal(await page.locator('[data-qm-overview] [data-qm-overview-field]').count(),13,name);
   assert.equal(await page.locator('.qm-indicator').count(),0,name);
   assert.equal(await page.locator('[data-qm-overview] input').count(),0,name);
   const homeBounds=await page.locator('.qm-home-button').boundingBox(),openBounds=await page.locator('[data-qm-action="indicators"]').boundingBox();assert.ok(homeBounds.y>=0&&homeBounds.y+homeBounds.height<=height+1,name);assert.ok(openBounds.y>=0&&openBounds.y+openBounds.height<=height+1,name);
   await page.screenshot({path:`.local-preview/qmentum/${engine.name()}-${name}-monthly-home.png`,fullPage:true});
   await page.getByRole('button',{name:'INDICADORES OBRIGATÓRIOS QMENTUM',exact:true}).click();
   assert.equal(await page.locator('.qm-indicator').count(),18,name);
   await page.screenshot({path:`.local-preview/qmentum/${engine.name()}-${name}-mandatory-selection.png`,fullPage:true});
   await page.locator('[data-qm-indicator="QM18"]').scrollIntoViewIfNeeded();
   const scroll=await page.locator('.qm-grid').evaluate(n=>n.scrollTop);
   await page.locator('[data-qm-indicator="QM18"]').click();
   assert.equal(await page.locator('dialog[open]').count(),1,name);
   assert.equal(await page.locator('.qm-monthly-row').count(),12,name);
   const bars=await page.locator('.qm-monthly-row').first().boundingBox();assert.ok(bars.width>bars.height,name);
   await page.screenshot({path:`.local-preview/qmentum/${engine.name()}-${name}-monthly-bars.png`,fullPage:true});
   await page.locator('[data-count="safeSurgeryCompliant"]').fill('8999');
   await page.locator('[data-qm-close]').click();
   assert.equal(await page.locator('.qm-indicator').count(),18,name);
   assert.ok(Math.abs(await page.locator('.qm-grid').evaluate(n=>n.scrollTop)-scroll)<2,name);
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.qmIndicator),'QM18',name);
   await page.locator('[data-qm-indicator="QM18"]').click();
   assert.equal(await page.locator('[data-count="safeSurgeryCompliant"]').inputValue(),'8999',name);
   await page.locator('[data-qm-action="quarterly"]').click();
   await page.waitForSelector('[data-quarter]');assert.equal(await page.locator('dialog[open]').count(),1,name);
   await page.locator('[data-qm-close]').click();assert.match(await page.locator('#qm-dialog-title').innerText(),/QM18/,name);
   await page.locator('[data-qm-close]').click();await page.locator('[data-qm-close]').click();
   assert.equal(await page.locator('dialog[open]').count(),0,name);
   assert.equal(await page.locator('#qm-date').inputValue(),'2026-06',name);
   await page.locator('#qm-date').fill('2026-08');await page.locator('#qm-date').dispatchEvent('change');
   await page.waitForFunction(()=>document.querySelector('.qm-module-status')?.textContent.includes('Agosto'));
   assert.match(await page.locator('[data-qm-overview]').innerText(),/Sem dados|Sem registro|Não informado/i,name);
   assert.equal(await page.locator('[data-qm-overview] [data-state="value"]').count(),0,name);
   await page.getByRole('button',{name:'Entrada manual',exact:true}).click();
   assert.equal(await page.locator('[data-date]').inputValue(),'2026-08-01',name);
   await page.locator('[data-count="general"]').fill('8123');
   await page.locator('[data-qm-action="save"]').click();
   await page.waitForFunction(()=>window.monthly.writes.length===1&&document.querySelector('.qm-status')?.textContent.includes('salva no FC'));
   assert.deepEqual(await page.evaluate(()=>{const w=window.monthly.writes[0];return [w.unitId,w.year,w.month,w.referenceDate,w.inputs.counts.general,w.action];}),['synthetic-a',2026,8,'2026-08-01',8123,'SAVE'],name);
   await page.locator('[data-qm-close]').click();assert.equal(await page.locator('dialog[open]').count(),0,name);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);
   assert.deepEqual(errors,[],name);await page.close();
  }
 } finally {await browser?.close();await server.close();}
});

test('unit defaults, explicit month scope, read-only home and failed loads preserve edits',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});let browser;
 try {
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port,base=origin+server.config.base;
  browser=await engine.launch(launchOptions);const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await fixture(page,base,{role:'collector'});
  assert.equal(await page.getByRole('button',{name:'Entrada manual',exact:true}).count(),0);
  await page.locator('#qm-unit').selectOption('synthetic-b');await page.waitForFunction(()=>document.querySelector('#qm-date').value==='2025-09');
  await page.locator('#qm-date').fill('2026-05');await page.locator('#qm-date').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('.qm-module-status')?.textContent.includes('Maio'));
  await page.locator('#qm-unit').selectOption('synthetic-a');await page.waitForFunction(()=>document.querySelector('.qm-module-status')?.textContent.includes('Synthetic A'));
  assert.equal(await page.locator('#qm-date').inputValue(),'2026-05');
  await page.getByRole('button',{name:'INDICADORES OBRIGATÓRIOS QMENTUM',exact:true}).click();await page.locator('[data-qm-indicator="QM01"]').click();
  await page.locator('[data-count="techniqueChanges"]').fill('81');
  await page.evaluate(()=>window.monthly.failedYear=2027);
  await page.locator('[data-date]').fill('2027-02-10');await page.locator('[data-date]').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('.qm-status')?.textContent.includes('Não foi possível'));
  assert.equal(await page.locator('[data-date]').inputValue(),'2026-05-17');
  assert.equal(await page.locator('[data-count="techniqueChanges"]').inputValue(),'81');
  await page.locator('[data-qm-close]').click();await page.locator('[data-qm-close]').click();
  await page.evaluate(()=>window.monthly.failedUnit='synthetic-b');await page.locator('#qm-unit').selectOption('synthetic-b');
  await page.waitForFunction(()=>document.querySelector('.qm-module-status')?.textContent.includes('Não foi possível'));
  assert.equal(await page.locator('#qm-unit').inputValue(),'synthetic-a');assert.equal(await page.locator('#qm-date').inputValue(),'2026-05');
  await page.getByRole('button',{name:'INDICADORES OBRIGATÓRIOS QMENTUM',exact:true}).click();await page.locator('[data-qm-indicator="QM01"]').click();
  assert.equal(await page.locator('[data-count="techniqueChanges"]').inputValue(),'81');
 } finally {await browser?.close();await server.close();}
});
