import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url='http://127.0.0.1:5182/tests/fixtures/vacations-2027-preview.html';
test('FE vacations is a responsive visual shell with no backend, storage, or editable slots',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5182/'))external.push(r.url());});
  for(const width of [320,390,820,1440]){
   await page.setViewportSize({width,height:900});await page.goto(url);
   await page.getByRole('button',{name:'ESCALA DE FÉRIAS 2027',exact:true}).click();
   await page.locator('.vacations-2027').waitFor();
   assert.equal(await page.locator('.vacations-2027 table').count(),12);
   assert.equal(await page.locator('.vacations-2027 tbody tr').count(),52);
   assert.equal(await page.locator('.vacations-2027 input,.vacations-2027 select,.vacations-2027 form,.vacations-2027 iframe').count(),0);
   assert.equal(await page.getByRole('button',{name:'Atualizar escala',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Gestão administrativa',exact:true}).count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.locator('.vacations-2027').evaluate(el=>el.scrollWidth>el.clientWidth),false);
   await page.locator('.management-hub-body').evaluate(el=>el.scrollTop=el.scrollHeight);
   await page.getByRole('heading',{name:'DEZEMBRO',exact:true}).scrollIntoViewIfNeeded();
   assert.equal(await page.getByRole('heading',{name:'DEZEMBRO',exact:true}).isVisible(),true);
   assert.deepEqual(await page.evaluate(()=>[window.calls,localStorage.length,sessionStorage.length]),[[],0,0]);
   await page.getByRole('button',{name:'VOLTAR',exact:true}).click();
   assert.equal(await page.locator('.vacations-2027').count(),0);
   assert.equal(await page.getByRole('button',{name:'ESCALA DE FÉRIAS 2027',exact:true}).isEnabled(),true);
  }
  await page.goto(url+'?admin');await page.getByRole('button',{name:'ESCALA DE FÉRIAS 2027',exact:true}).click();
  await page.locator('.vacations-2027').waitFor();assert.equal(await page.getByRole('button',{name:'Gestão administrativa',exact:true}).isDisabled(),true);
  await page.goto(url+'?denied');assert.equal(await page.locator('dialog').getAttribute('data-panel'),'home');assert.equal(await page.locator('.vacations-2027').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 } finally {await browser.close();}
});
