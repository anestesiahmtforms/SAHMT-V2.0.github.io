import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
test('real PDF rendering, mobile modal, coverage, completion and close cleanup',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+server.config.base+'tests/fixtures/diretrizes-reading.html');await page.waitForFunction(()=>window.readingFixtureReady);
  await page.locator('[data-open-diretriz-reader]').click();await page.waitForFunction(()=>document.querySelector('canvas').width>0&&document.querySelector('[data-reader-next]').disabled===false);
  assert.equal(await page.locator('dialog[open]').count(),1);assert.equal(await page.locator('[data-reader-complete]').isDisabled(),true);
  const box=await page.locator('[data-reader-close]').boundingBox();assert.ok(box.y+box.height<=844);
  const scrollBottom=()=>page.locator('.diretrizes-ebook__pages').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
  await scrollBottom();await page.locator('[data-reader-next]').click();await page.waitForFunction(()=>document.querySelector('[data-reader-page]').textContent.includes('Página 2')&&!document.querySelector('[data-reader-text]').disabled);
  await scrollBottom();await page.waitForFunction(()=>!document.querySelector('[data-reader-complete]').disabled);
  await page.locator('[data-reader-complete]').click();await page.waitForSelector('[data-reader-form]:not([hidden])');
  assert.deepEqual(await page.evaluate(()=>window.readingCalls.find(c=>c.action==='complete').pages),[1,2]);
  assert.match(await page.locator('[data-reading-status]').innerText(),/formulário liberado/);
  await page.locator('[data-reader-close]').click();assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await page.locator('canvas').evaluate(el=>el.width),0);
  assert.equal(await page.locator('[data-reader-form]').getAttribute('href'),null);
  await page.goto(origin+server.config.base+'tests/fixtures/diretrizes-reading.html?failure=1');await page.waitForFunction(()=>window.readingFixtureReady);
  await page.locator('[data-open-diretriz-reader]').click();await page.waitForFunction(()=>document.querySelector('[data-reader-page]').textContent.includes('1 apresentadas'));
  await page.locator('[data-reader-next]').click();await page.waitForFunction(()=>document.querySelector('[data-reading-status]').textContent.includes('Não foi possível'));
  await scrollBottom();assert.equal(await page.locator('[data-reader-complete]').isDisabled(),true);
  assert.match(await page.locator('[data-reader-page]').innerText(),/1 apresentadas/);
  assert.equal(await page.locator('canvas').evaluate(el=>el.width),0);
 }finally{await browser?.close();await server.close();}
});
