import test from 'node:test';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright';
test('isolated demo: personas, simulated record, repeated quiz, revision and zero external calls',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}});let browser;
 try{
  const origin='http://127.0.0.1:'+server.httpServer.address().port,external=[],errors=[];
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(origin+'/SAHMT-V2.0.github.io/demo.html');
  await page.getByRole('button',{name:'Usuário comum',exact:true}).click();
  assert.equal(await page.locator('[data-route="admin"]').count(),0);
  await page.locator('[data-route="events"]').click();
  for(const input of await page.locator('[data-record] input').all())await input.fill('Exemplo fictício');
  await page.locator('[data-record] button').click();assert.equal(await page.locator('.demo-record').count(),1);
  await page.locator('[data-action="home"]').click();await page.locator('[data-route="management"]').click();
  assert.equal(await page.locator('[data-id="training-1"]').first().getAttribute('data-training-state'),'blue');
  await page.locator('[data-id="training-1"]').first().click();await page.locator('[data-read]').check();
  await page.locator('[name=q0]').selectOption('Azul');await page.locator('[name=q1]').selectOption('Não');await page.locator('[name=ack]').check();await page.locator('[data-quiz] button[type=submit]').click();
  assert.equal(await page.locator('[data-id="training-1"]').first().getAttribute('data-training-state'),'green');
  await page.locator('[data-id="training-1"]').first().click();await page.locator('[data-read]').check();
  await page.locator('[name=q0]').selectOption('Verde');await page.locator('[name=q1]').selectOption('Sim');await page.locator('[name=ack]').check();await page.locator('[data-quiz] button[type=submit]').click();
  assert.equal(await page.locator('[data-id="training-1"]').first().getAttribute('data-training-state'),'yellow');
  await page.locator('[data-action=home]').click();await page.locator('[data-route=training]').click();assert.match(await page.locator('h2').innerText(),/10 pontos/);
  await page.locator('[data-action=switch]').click();await page.getByRole('button',{name:'Administrador',exact:true}).click();
  await page.locator('[data-route=management]').click();await page.locator('[data-action=revision][data-id=training-1]').click();
  await page.locator('[data-action=switch]').click();await page.getByRole('button',{name:'Usuário comum',exact:true}).click();await page.locator('[data-route=management]').click();
  assert.equal(await page.locator('[data-id="training-1"]').first().getAttribute('data-training-state'),'blue');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'.local-preview/demo-training-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(async()=>{try{await fetch('https://example.invalid/forbidden');return 'sent';}catch{return 'blocked';}}),'blocked');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);
 }finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
