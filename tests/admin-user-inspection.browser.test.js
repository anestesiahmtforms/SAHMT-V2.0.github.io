import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
test('administrative view stays read-only, retains actor, scopes subject and cleans up modal',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(origin+server.config.base+'tests/fixtures/admin-user-inspection.html');await page.waitForFunction(()=>window.inspectionFixtureReady);
  await page.locator('#inspect').click();await page.waitForSelector('dialog[open]');
  assert.match(await page.locator('dialog').innerText(),/Pessoa fictícia/);assert.match(await page.locator('dialog').innerText(),/Treinamento completo/);
  assert.equal(await page.locator('dialog input,dialog textarea,dialog form,dialog a').count(),0);
  assert.equal(await page.evaluate(()=>window.inspectionFixture.actor),'admin-fixture');
  assert.ok((await page.evaluate(()=>window.inspectionFixture.requests)).every(call=>call.actor==='admin-fixture'&&call.subject==='person-fixture'));
  const box=await page.locator('dialog button').boundingBox();assert.ok(box.y+box.height<=844);
  await page.locator('dialog button').click();assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.evaluate(()=>window.inspectionFixture.stops),1);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{await browser?.close();await server.close();}
});
