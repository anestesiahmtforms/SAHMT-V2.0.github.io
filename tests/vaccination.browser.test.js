import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const base=process.env.VACCINATION_PREVIEW_URL||'http://127.0.0.1:5178/tests/fixtures/vaccination-preview.html';
const options=process.env.SAHMT_TEST_BROWSER_CHANNEL?{channel:process.env.SAHMT_TEST_BROWSER_CHANNEL}:{};
async function browserRun(fn){const browser=await chromium.launch({headless:true,...options});try{await fn(browser);}finally{await browser.close();}}
test('revoked report access clears previously displayed health data and forbids partial release',()=>browserRun(async browser=>{
 for(const deniedDocuments of [false,true]){
  const page=await browser.newPage();await page.goto(base+'?role=admin'+(deniedDocuments?'&documentsDenied':''));await page.getByRole('button',{name:'Painel administrativo',exact:true}).click();
  if(!deniedDocuments){await page.getByRole('heading',{name:'Participação e cobertura autodeclarada',exact:true}).waitFor();await page.evaluate(()=>{window.denyReport=true;});await page.getByRole('button',{name:'Painel administrativo',exact:true}).click();}
  await page.getByText('Sua sessão mudou. Entre novamente para acessar seu histórico.',{exact:true}).waitFor();
  assert.equal(await page.locator('.vac-individuals,.vac-chart,form').count(),0);await page.close();
 }
}));
test('people-management entry preserves activities and back returns one level',()=>browserRun(async browser=>{
 const page=await browser.newPage();await page.goto(base+'?entry');await page.getByText('Atividades existentes',{exact:true}).waitFor();
 await page.getByRole('button',{name:'BIOSSEGURANÇA',exact:true}).click();await page.getByRole('button',{name:'MEU HISTÓRICO VACINAL',exact:true}).click();await page.getByLabel('Ciência das orientações',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.entryBack()),true);await page.getByRole('button',{name:'MEU HISTÓRICO DOSIMETRIA',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.entryBack()),true);await page.getByText('Atividades de Gestão de Pessoas preservadas',{exact:true}).waitFor();
}));
test('record indicators remain visible when document listing is unavailable',()=>browserRun(async browser=>{
 const page=await browser.newPage();await page.goto(base+'?role=admin&documentsOff');await page.getByRole('button',{name:'Painel administrativo',exact:true}).click();
 await page.getByRole('heading',{name:'Participação e cobertura autodeclarada',exact:true}).waitFor();
 await page.getByText('Cadastros disponíveis. A consulta dos comprovantes está temporariamente indisponível.',{exact:true}).waitFor();
 await page.getByLabel('Buscar profissional',{exact:true}).fill('nobody');await page.getByRole('heading',{name:'Consulta individual · 0 profissionais',exact:true}).waitFor();
}));
test('participant required fields, camera input, save confirmation and account invalidation',()=>browserRun(async browser=>{
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(base);
 await page.getByRole('heading',{name:'Meu Histórico Vacinal',exact:true}).waitFor({timeout:5000});
 assert.equal(await page.getByRole('button',{name:'Painel administrativo',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Abrir pasta no Drive',exact:true}).count(),0);
 assert.equal(await page.locator('input[capture="environment"]').count(),1);
 assert.equal(await page.locator('[name=category]').count(),0);
 await page.getByLabel('Hepatite B',{exact:true}).selectOption('UPDATED');await page.getByLabel('Antitetânica',{exact:true}).selectOption('PENDING');await page.getByLabel('Triviral',{exact:true}).selectOption('UPDATED');await page.getByLabel('Influenza',{exact:true}).selectOption('UNKNOWN');
 await page.getByLabel('Ciência das orientações',{exact:true}).selectOption('true');await page.getByLabel('Declaração sobre os comprovantes',{exact:true}).selectOption('WILL_UPDATE');await page.getByLabel('Confirmo que as informações declaradas são verdadeiras.').check();
 await page.getByRole('button',{name:'Salvar meu cadastro',exact:true}).click();await page.getByText('Cadastro salvo com sucesso.',{exact:true}).waitFor();
 const saved=await page.evaluate(()=>window.lastSaved);assert.ok(!('category'in saved));assert.ok(!('uid'in saved));assert.equal(saved.states.tetanus,'PENDING');
 await page.evaluate(()=>window.invalidate());await page.getByText('Sua sessão mudou. Entre novamente para acessar seu histórico.',{exact:true}).waitFor();assert.equal(await page.locator('form').count(),0);
}));
test('responsive admin indicators and own document compression/preview',()=>browserRun(async browser=>{
 const page=await browser.newPage();for(const [width,height] of [[320,568],[390,844],[768,1024],[1440,900]]){
  await page.setViewportSize({width,height});await page.goto(base+'?role=admin');await page.getByRole('button',{name:'Painel administrativo',exact:true}).waitFor({timeout:5000});await page.getByRole('button',{name:'Painel administrativo',exact:true}).click();await page.getByRole('heading',{name:'Participação e cobertura autodeclarada',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Abrir pasta no Drive',exact:true}).getAttribute('href'),'https://drive.google.com/drive/folders/SYNTHETIC_DRIVE_FOLDER');assert.equal(await page.locator('.vac-progress').count()>0,true);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);assert.equal(overflow,false,`${width}px must fit`);
 }
 await page.getByRole('button',{name:'Meu cadastro',exact:true}).click();
 const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=3200;c.height=2400;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#000';x.font='120px Arial';x.fillText('COMPROVANTE DE DEMONSTRAÇÃO',50,250);return Array.from(new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer()));});
 await page.locator('input[data-vac-file="attachment"]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
 await page.locator('.vac-preview img').waitFor();assert.match(await page.locator('.vac-preview').innerText(),/1600 × 1200/);
 await page.getByRole('button',{name:'Enviar comprovante',exact:true}).click();await page.getByText('Comprovante salvo no Drive.',{exact:true}).waitFor();
}));
