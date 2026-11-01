import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const engine=process.env.QMENTUM_BROWSER==='webkit'?webkit:chromium;
const launchOptions=process.env.QMENTUM_BROWSER_CHANNEL?{channel:process.env.QMENTUM_BROWSER_CHANNEL,headless:true}:{headless:true};
const viewports=[['mobile',390,844],['tablet',768,1024],['desktop',1440,1000],['compact',320,568]];
// A synthetic, single-pixel image; no clinical source images or counts.
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const image=(name='synthetic.png',mimeType='image/png',buffer=pixel)=>({name,mimeType,buffer});
async function withBrowser(run) {
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});let browser;
 try {
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port,base=origin+server.config.base;
  browser=await engine.launch(launchOptions);
  await run(browser,base,origin);
 } finally {await browser?.close();await server.close();}
}
async function fixture(browser,base,origin,options={},viewport={width:900,height:900}) {
 const page=await browser.newPage({viewport});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(base+'tests/fixtures/qmentum-runtime.html');
 await page.evaluate(async({base,options})=>{const {mountPrintInputFixture}=await import(base+'tests/fixtures/qmentum-print-ui-fixture.js');window.printInput=mountPrintInputFixture(document.querySelector('#root'),options);},{base,options});
 return page;
}
async function selectPair(page) {
 await page.locator('[data-print-file="TECHNIQUES"]').setInputFiles(image('techniques.png'));
 await page.locator('[data-print-file="INDICATORS"]').setInputFiles(image('indicators.jpg','image/jpeg'));
}
async function uploadPreview(page) {await selectPair(page);await page.getByRole('button',{name:'Gerar prévia',exact:true}).click();await page.locator('[data-print-count="anestheticProcedures"]').waitFor();}

test('upload preview keeps independent totals and deliberately confirms within one scrollable dialog at four viewport sizes',async()=>{
 await mkdir('.local-preview/qmentum',{recursive:true});
 await withBrowser(async(browser,base,origin)=>{
  for(const [name,width,height] of viewports) {
   const page=await fixture(browser,base,origin,{}, {width,height}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   assert.equal(await page.locator('dialog[open]').count(),1,name);
   assert.match(await page.locator('[data-print-scope]').innerText(),/Agosto.*2026|2026.*Agosto/i,name);
   assert.equal(await page.getByRole('button',{name:'Gerar prévia',exact:true}).isDisabled(),true,name);
   await selectPair(page);
   assert.equal(await page.locator('[data-print-image]').count(),2,name);
   assert.equal(await page.evaluate(()=>window.printInput.calls.length),0,name);
   await page.getByRole('button',{name:'Gerar prévia',exact:true}).click();
   await page.locator('[data-print-count="anestheticProcedures"]').waitFor();
   assert.equal(await page.locator('[data-print-count="anestheticProcedures"]').inputValue(),'83',name);
   assert.equal(await page.locator('[data-print-count="surgical"]').inputValue(),'71',name);
   assert.match(await page.locator('[data-print-total="anestheticProcedures"]').innerText(),/Total geral/,name);
   assert.match(await page.locator('[data-print-total="surgical"]').innerText(),/Total de registros/,name);
   assert.equal(await page.locator('[data-print-count="headache"]').count(),0,name);
   assert.match(await page.locator('[data-print-missing]').innerText(),/cefaleia/i,name);
   assert.match(await page.locator('[data-print-changes]').innerText(),/Anestesia geral.*58.*60/s,name);
   await page.locator('[data-print-count="general"]').fill('0');
   await page.getByRole('button',{name:'Confirmar importação',exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:`.local-preview/qmentum/${engine.name()}-${name}-print-preview.png`,fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);
   assert.equal(await page.locator('dialog[open]').count(),1,name);
   await page.getByRole('button',{name:'Confirmar importação',exact:true}).click();
   await page.waitForFunction(()=>window.printInput.saved.length===1);
   const calls=await page.evaluate(()=>window.printInput.calls);
   assert.equal(calls.length,2,name);
   assert.deepEqual(calls[0].payload,{unitId:'synthetic-unit',period:'2026-08',source:'UPLOAD',files:[{kind:'TECHNIQUES',name:'techniques.png',mimeType:'image/png',base64:pixel.toString('base64')},{kind:'INDICATORS',name:'indicators.jpg',mimeType:'image/jpeg',base64:pixel.toString('base64')}]},name);
   assert.deepEqual(calls[1],{operation:'apply',payload:{unitId:'synthetic-unit',period:'2026-08',previewId:'a'.repeat(64),baseVersion:3,corrections:{general:0},resolutions:{}}},name);
   assert.match(await page.locator('[data-print-status]').innerText(),/confirmada|confirmado|salva|salvo/i,name);
   assert.deepEqual(errors,[],name);await page.close();
  }
 });
});

test('missing totals stay pending and every manual conflict requires a deliberate choice',async()=>{
 await withBrowser(async(browser,base,origin)=>{
  const page=await fixture(browser,base,origin);
  await page.evaluate(()=>{const p=window.printInput.responses.preview.preview;delete p.counts.anestheticProcedures;p.missingFields.push('anestheticProcedures');p.conflicts=[{field:'general',current:62,source:60,baseline:58},{field:'toxicity',current:2,source:0,baseline:1}];});
  await uploadPreview(page);
  const confirm=page.getByRole('button',{name:'Confirmar importação',exact:true});
  assert.equal(await page.locator('[data-print-count="anestheticProcedures"]').inputValue(),'');
  assert.equal(await confirm.isDisabled(),true);
  assert.match(await page.locator('[data-print-conflicts]').innerText(),/Anestesia geral.*62.*60.*58/s);
  await page.locator('[data-print-count="anestheticProcedures"]').fill('0');
  assert.equal(await page.locator('[data-print-total="anestheticProcedures"] [data-print-field-pending]').isHidden(),true);
  await page.locator('[data-print-resolution="general"][value="KEEP_MANUAL"]').check();
  assert.equal(await confirm.isDisabled(),true);
  await page.locator('[data-print-resolution="toxicity"][value="USE_SOURCE"]').check();
  assert.equal(await confirm.isEnabled(),true);
  await page.locator('[data-print-count="surgical"]').fill('-1');assert.equal(await confirm.isDisabled(),true);
  await page.locator('[data-print-count="surgical"]').fill('1.5');assert.equal(await confirm.isDisabled(),true);
  await page.locator('[data-print-count="surgical"]').fill('71');
  await confirm.click();await page.waitForFunction(()=>window.printInput.saved.length===1);
  assert.deepEqual(await page.evaluate(()=>window.printInput.calls.at(-1).payload),{unitId:'synthetic-unit',period:'2026-08',previewId:'a'.repeat(64),baseVersion:3,corrections:{anestheticProcedures:0},resolutions:{general:'KEEP_MANUAL',toxicity:'USE_SOURCE'}});
 });
});

test('rejects unsupported and oversized uploads and revokes local thumbnails on replacement and disposal',async()=>{
 await withBrowser(async(browser,base,origin)=>{
  const page=await fixture(browser,base,origin);
  const input=page.locator('[data-print-file="TECHNIQUES"]');
  await input.setInputFiles(image('synthetic.gif','image/gif'));assert.match(await page.locator('[data-print-status]').innerText(),/PNG.*JPEG/i);
  await input.setInputFiles(image('too-big.png','image/png',Buffer.alloc(2*1024*1024+1)));assert.match(await page.locator('[data-print-status]').innerText(),/2\s*MB/i);
  assert.equal(await page.evaluate(()=>window.printInput.urls.created.length),0);
  await selectPair(page);await input.setInputFiles(image('replacement.png'));
  assert.deepEqual(await page.evaluate(()=>[window.printInput.urls.created.length,window.printInput.urls.revoked.length]),[3,1]);
  await page.evaluate(()=>window.printInput.dispose());
  assert.deepEqual(await page.evaluate(()=>window.printInput.urls.created.slice().sort()),await page.evaluate(()=>window.printInput.urls.revoked.slice().sort()));
  assert.equal(await page.evaluate(()=>window.printInput.calls.length),0);
 });
});

test('explicitly keeping a missing manual total validates the source total and preserves that resolution',async()=>{
 await withBrowser(async(browser,base,origin)=>{
  const page=await fixture(browser,base,origin);
  await page.evaluate(()=>{window.printInput.responses.preview.preview.conflicts=[{field:'anestheticProcedures',current:null,source:83,baseline:81}];});
  await uploadPreview(page);
  const confirm=page.getByRole('button',{name:'Confirmar importação',exact:true});
  assert.equal(await confirm.isDisabled(),true);
  await page.locator('[data-print-resolution="anestheticProcedures"][value="KEEP_MANUAL"]').check();
  assert.equal(await page.locator('[data-print-count="anestheticProcedures"]').inputValue(),'83');
  assert.equal(await confirm.isEnabled(),true);
  await confirm.click();await page.waitForFunction(()=>window.printInput.saved.length===1);
  assert.deepEqual(await page.evaluate(()=>window.printInput.calls.at(-1).payload.resolutions),{anestheticProcedures:'KEEP_MANUAL'});
 });
});

test('Drive scan lists new and changed sources without writing or changing the selected month',async()=>{
 await withBrowser(async(browser,base,origin)=>{
  const page=await fixture(browser,base,origin,{mode:'DRIVE'});
  await page.getByRole('button',{name:'Sincronizar alterações',exact:true}).click();
  await page.locator('[data-print-candidate="2026-08"]').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.printInput.calls),[{operation:'scan',payload:{unitId:'synthetic-unit',year:2026}}]);
  assert.match(await page.locator('[data-print-candidates]').innerText(),/Novo.*Alterado.*Sem alterações.*Par incompleto.*Duplicad/s);
  assert.equal(await page.locator('[data-print-candidate="2026-07"] button').count(),0);
  await page.evaluate(()=>{window.printInput.responses.preview.preview.sources=[{kind:'TECHNIQUES',id:'synthetic-techniques',url:'https://drive.google.com/file/d/synthetic-techniques/view'},{kind:'INDICATORS',id:'synthetic-indicators',url:'https://drive.google.com/file/d/synthetic-indicators/view'},{kind:'TECHNIQUES',id:'mismatch',url:'https://drive.google.com/file/d/another/view'},{kind:'INDICATORS',id:'untrusted',url:'https://example.test/file/d/untrusted/view'}];});
  await page.locator('[data-print-candidate="2026-08"] button').click();
  await page.locator('[data-print-count="surgical"]').waitFor();
  assert.equal(await page.locator('[data-print-source-link]').count(),2);
  assert.equal(await page.locator('[data-print-total="anestheticProcedures"] a').getAttribute('href'),'https://drive.google.com/file/d/synthetic-techniques/view');
  assert.equal(await page.locator('[data-print-total="surgical"] a').getAttribute('href'),'https://drive.google.com/file/d/synthetic-indicators/view');
  assert.equal(await page.locator('[data-print-source-link]').first().getAttribute('rel'),'noopener noreferrer');
  assert.deepEqual(await page.evaluate(()=>window.printInput.calls.at(-1)),{operation:'preview',payload:{unitId:'synthetic-unit',period:'2026-08',source:'DRIVE'}});
  assert.equal(await page.evaluate(()=>window.printInput.saved.length),0);
  await page.getByRole('button',{name:'Confirmar importação',exact:true}).click();await page.waitForFunction(()=>window.printInput.saved.length===1);
  await page.close();
  const unchanged=await fixture(browser,base,origin,{responses:{preview:{status:'UNCHANGED'}}});
  await selectPair(unchanged);await unchanged.getByRole('button',{name:'Gerar prévia',exact:true}).click();
  await unchanged.waitForFunction(()=>document.querySelector('[data-print-status]').textContent.includes('Sem alterações'));
  assert.equal(await unchanged.getByRole('button',{name:'Confirmar importação',exact:true}).count(),0);
  assert.equal(await unchanged.evaluate(()=>window.printInput.saved.length),0);
 });
});

test('failed confirmation preserves images, preview and corrections and blocks repeated in-flight writes',async()=>{
 await withBrowser(async(browser,base,origin)=>{
  const page=await fixture(browser,base,origin,{failures:{apply:1}});await uploadPreview(page);
  await page.locator('[data-print-count="general"]').fill('64');
  await page.getByRole('button',{name:'Confirmar importação',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-print-status]').textContent.includes('Não foi possível'));
  assert.equal(await page.locator('[data-print-count="general"]').inputValue(),'64');assert.equal(await page.locator('[data-print-image]').count(),2);
  assert.equal(await page.locator('[data-print-file="TECHNIQUES"]').evaluate(n=>n.files[0].name),'techniques.png');
  assert.equal(await page.evaluate(()=>window.printInput.saved.length),0);
  await page.evaluate(()=>{window.printInput.hold.apply=true;});
  await page.getByRole('button',{name:'Confirmar importação',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Confirmar importação',exact:true}).isDisabled(),true);
  await page.evaluate(()=>document.querySelector('[data-print-action="apply"]').click());
  assert.equal(await page.evaluate(()=>window.printInput.calls.filter(c=>c.operation==='apply').length),2);
  await page.evaluate(()=>window.printInput.release('apply'));await page.waitForFunction(()=>window.printInput.saved.length===1);
 });
});

test('session and disposal guards reject stale results and prevent writes from the old scope',async()=>{
 await withBrowser(async(browser,base,origin)=>{
  const page=await fixture(browser,base,origin,{hold:{preview:true}});
  await selectPair(page);await page.getByRole('button',{name:'Gerar prévia',exact:true}).click();
  await page.waitForFunction(()=>window.printInput.pending.preview);
  await page.evaluate(()=>{window.printInput.current=false;window.printInput.release('preview');});
  await page.waitForFunction(()=>!document.querySelector('[data-print-root]').getAttribute('aria-busy')||document.querySelector('[data-print-root]').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('[data-print-count]').count(),0);
  assert.equal(await page.evaluate(()=>window.printInput.calls.some(c=>c.operation==='apply')),false);
  await page.close();
  const stale=await fixture(browser,base,origin);await uploadPreview(stale);
  await stale.evaluate(()=>{window.printInput.current=false;});
  await stale.getByRole('button',{name:'Confirmar importação',exact:true}).click();
  assert.equal(await stale.evaluate(()=>window.printInput.calls.some(c=>c.operation==='apply')),false);
  await stale.close();
  const disposed=await fixture(browser,base,origin,{hold:{apply:true}});await uploadPreview(disposed);
  await disposed.getByRole('button',{name:'Confirmar importação',exact:true}).click();
  await disposed.waitForFunction(()=>window.printInput.pending.apply);
  await disposed.evaluate(()=>{window.printInput.dispose();window.printInput.release('apply');});
  await disposed.waitForTimeout(50);assert.equal(await disposed.evaluate(()=>window.printInput.saved.length),0);
  await disposed.close();
  const excluded=await fixture(browser,base,origin,{period:'2026-06'});
  assert.match(await excluded.locator('[data-print-status]').innerText(),/julho.*2026/i);
  assert.equal(await excluded.getByRole('button',{name:'Gerar prévia',exact:true}).isDisabled(),true);
 });
});
