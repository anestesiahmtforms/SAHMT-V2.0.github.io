import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const base=process.env.VACCINATION_PREVIEW_URL||'http://127.0.0.1:5178/tests/fixtures/vaccination-preview.html';
async function run(fn){const browser=await chromium.launch({headless:true,channel:process.env.SAHMT_TEST_BROWSER_CHANNEL||'msedge'});try{await fn(browser);}finally{await browser.close();}}
async function menu(page,query=''){await page.goto(base+'?entry'+query);await page.getByRole('button',{name:'BIOSSEGURANÇA',exact:true}).click();}
test('manual button is above both histories, has an icon and opens an isolated HTML reader with one-level back',()=>run(async browser=>{
 const page=await browser.newPage();
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await menu(page);const manual=page.getByRole('button',{name:'MANUAL DE BIOSSEGURANÇA - HMT',exact:true});
  const a=await manual.boundingBox(),b=await page.getByRole('button',{name:'MEU HISTÓRICO VACINAL',exact:true}).boundingBox();assert.ok(a.y+a.height<=b.y);assert.equal(await manual.locator('svg').count(),1);assert.equal(await page.evaluate(()=>window.manualRequests||0),0);
  await manual.click();await page.frameLocator('iframe').getByRole('heading',{name:'Manual de demonstração',exact:true}).waitFor();await page.frameLocator('iframe').getByRole('link',{name:'Ir à referência',exact:true}).click();await page.frameLocator('iframe').getByRole('heading',{name:'Referência',exact:true}).waitFor();assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'),'no-referrer');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'VOLTAR PARA BIOSSEGURANÇA',exact:true}).click();assert.equal(await page.locator('iframe').count(),0);await page.getByRole('button',{name:'MEU HISTÓRICO DOSIMETRIA',exact:true}).waitFor();
 }
}));
test('session change removes the complete manual and denied access never mounts an iframe',()=>run(async browser=>{
 const page=await browser.newPage();await menu(page);await page.getByRole('button',{name:'MANUAL DE BIOSSEGURANÇA - HMT',exact:true}).click();await page.frameLocator('iframe').getByRole('heading',{name:'Manual de demonstração',exact:true}).waitFor();await page.evaluate(()=>window.invalidate());await page.getByText('Sua sessão mudou. Entre novamente para consultar o manual.',{exact:true}).waitFor();assert.equal(await page.locator('iframe').count(),0);
 await menu(page,'&manualDenied');await page.getByRole('button',{name:'MANUAL DE BIOSSEGURANÇA - HMT',exact:true}).click();await page.getByText('Sua sessão mudou. Entre novamente para consultar o manual.',{exact:true}).waitFor();assert.equal(await page.locator('iframe').count(),0);
}));
