import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const base=process.env.VACCINATION_PREVIEW_URL||'http://127.0.0.1:5178/tests/fixtures/vaccination-preview.html';
const options=process.env.SAHMT_TEST_BROWSER_CHANNEL?{channel:process.env.SAHMT_TEST_BROWSER_CHANNEL}:{};
async function browserRun(fn){const browser=await chromium.launch({headless:true,...options});try{await fn(browser);}finally{await browser.close();}}

test('entry back returns one level from the simplified vaccine form',()=>browserRun(async browser=>{
 const page=await browser.newPage();await page.goto(base+'?entry');await page.getByText('Atividades existentes',{exact:true}).waitFor();
 await page.getByRole('button',{name:'BIOSSEGURANÇA',exact:true}).click();await page.getByRole('button',{name:'MEU HISTÓRICO VACINAL',exact:true}).click();await page.getByLabel('Hepatite B',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.entryBack()),true);await page.getByRole('button',{name:'MEU HISTÓRICO DOSIMETRIA',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.entryBack()),true);await page.getByText('Atividades de Gestão de Pessoas preservadas',{exact:true}).waitFor();
}));

test('required vaccine states, camera input, save confirmation and account invalidation remain functional',()=>browserRun(async browser=>{
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(base);await page.locator('[data-vac-year]:enabled').waitFor();
 assert.equal(await page.locator('.vac-header,.vac-toolbar nav,[name=awareness],[name=category]').count(),0);
 assert.equal(await page.getByRole('link',{name:'Abrir pasta no Drive',exact:true}).count(),0);assert.equal(await page.locator('input[capture="environment"]').count(),1);
 await page.getByLabel('Hepatite B',{exact:true}).selectOption('UPDATED');await page.getByLabel('Antitetânica',{exact:true}).selectOption('PENDING');await page.getByLabel('Triviral',{exact:true}).selectOption('UPDATED');await page.getByLabel('Influenza',{exact:true}).selectOption('UNKNOWN');
 await page.getByLabel('Declaração sobre os comprovantes',{exact:true}).selectOption('WILL_UPDATE');await page.getByLabel('Confirmo que as informações declaradas são verdadeiras.').check();
 await page.getByRole('button',{name:'Salvar meu cadastro',exact:true}).click();await page.getByText('Cadastro salvo com sucesso.',{exact:true}).waitFor();
 const saved=await page.evaluate(()=>window.lastSaved);assert.ok(!('category'in saved));assert.ok(!('uid'in saved));assert.equal(saved.states.tetanus,'PENDING');assert.equal(saved.awareness,false);
 await page.evaluate(()=>window.invalidate());await page.getByText('Sua sessão mudou. Entre novamente para acessar seu histórico.',{exact:true}).waitFor();assert.equal(await page.locator('form').count(),0);
}));

test('administrators also see the simplified personal form without the old three-button toolbar',()=>browserRun(async browser=>{
 const page=await browser.newPage();await page.goto(base+'?role=admin');await page.locator('[data-vac-year]:enabled').waitFor();
 for(const name of ['Meu cadastro','Painel administrativo','Recarregar'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0);
 assert.equal(await page.locator('.vac-period>span,.vac-header').count(),0);
 await page.evaluate(()=>window.invalidate());assert.equal(await page.locator('form').count(),0);
}));

test('the simplified form stays responsive and preserves private document compression, preview and upload',()=>browserRun(async browser=>{
 const page=await browser.newPage();for(const [width,height]of [[320,568],[390,844],[768,1024],[1440,900]]){
  await page.setViewportSize({width,height});await page.goto(base+'?role=admin');await page.locator('[data-vac-year]:enabled').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,width+'px must fit');
 }
 const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=3200;c.height=2400;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#000';x.font='120px Arial';x.fillText('COMPROVANTE DE DEMONSTRAÇÃO',50,250);return Array.from(new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer()));});
 await page.locator('input[data-vac-file="attachment"]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
 await page.locator('.vac-preview img').waitFor();assert.match(await page.locator('.vac-preview').innerText(),/1600 × 1200/);
 await page.getByRole('button',{name:'Enviar comprovante',exact:true}).click();await page.getByText('Comprovante salvo em FE.',{exact:true}).waitFor();
}));
