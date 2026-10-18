import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

test('Desempenho resets completion on live revision and never confirms cached metadata',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+server.config.base+'tests/fixtures/performance-training-live.html');
  await page.waitForSelector('[data-training-state="green"]',{state:'attached'});
  assert.equal(await page.evaluate(()=>window.trainingLive.includeParticipations),false);
  await page.evaluate(()=>window.trainingLive.revise());
  await page.waitForSelector('[data-training-state="blue"]',{state:'attached'});
  assert.match(await page.locator('#evaluation-activity-training').innerText(),/Versão 2/);
  await page.evaluate(()=>window.trainingLive.cache());
  assert.equal(await page.locator('[data-training-state="green"]').count(),0);
  assert.equal(await page.locator('a.training-state-button').count(),0);
  await page.evaluate(()=>window.trainingLive.invalidate());
  assert.equal(await page.locator('a.training-state-button').count(),0);
  await page.evaluate(()=>window.trainingLive.cleanup());
  assert.equal(await page.evaluate(()=>window.trainingLive.stops),2);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
