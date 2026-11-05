import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.COMMUNICATION_PREVIEW_URL||'http://127.0.0.1:5178/SAHMT-V2.0.github.io/tests/fixtures/communication-preview.html';
const open=(p,name)=>p.getByRole('button',{name,exact:true}).click();

test('missing FF session replaces loading with Google recovery and retries only bootstrap',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.goto(url+'?common&needs-google');await open(page,'Confirmar Google (teste)');await page.locator('[data-enable]').waitFor();assert.equal(await page.getByText('Confirmando acesso no servidor FF…',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='BOOTSTRAP').length),2);assert.equal(await page.evaluate(()=>window.calls.some(c=>['SAVE_MESSAGE','SEND_BATCH','REGISTER_DEVICE'].includes(c.action))),false);}finally{await browser.close();}
});
test('FF local recipients, three groups and automatic send work without foreign forwarding',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.goto(url);await open(page,'CRIAR E ENVIAR AVISO');
   await page.fill('[name=title]','<img src=x onerror=alert(1)>');await page.fill('[name=message]','Informação institucional de teste');
   await page.selectOption('[name=audienceType]','GROUP');await open(page,'CARREGAR OPÇÕES');
   assert.deepEqual(await page.locator('[name=audienceValue] option').allTextContents(),['EQUIPE','RESIDENTES','SUBSTITUTOS']);
   await page.selectOption('[name=audienceType]','USER');await open(page,'CARREGAR OPÇÕES');await page.selectOption('[name=audienceValue]','fa-person');
   await open(page,'VISUALIZAR AVISO');assert.equal(await page.locator('[data-preview-content] img').count(),0);
   await open(page,'ENVIAR');await page.getByText('Aviso enviado. O Push foi iniciado automaticamente.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='SEND_BATCH')),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await open(page,'CENTRAL DE COMUNICAÇÃO');assert.equal(await page.getByRole('button',{name:'ENCAMINHAR INFORMAÇÃO PARA FF'}).count(),0);
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='IMPORT_SOURCE')),false);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
test('ordinary users see own inbox only; Governance hides administrative card entirely',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.goto(url+'?common');await open(page,'MENSAGENS RECEBIDAS');assert.equal(await page.locator('[data-view]').count(),0);assert.equal(await page.locator('[data-enable]').count(),1);assert.equal(await page.evaluate(()=>window.calls.some(c=>['DIRECTORY','GROUPS','MESSAGES'].includes(c.action))),false);
  await page.goto(url+'?common&hub');await page.locator('dialog[open]').waitFor();assert.equal(await page.getByRole('button',{name:'CENTRAL DE COMUNICAÇÃO',exact:true}).count(),0);
  await page.goto(url+'?hub');await open(page,'CENTRAL DE COMUNICAÇÃO');await open(page,'DESTINATÁRIOS E GRUPOS');await page.getByText('SUBSTITUTOS',{exact:true}).waitFor();assert.equal(await page.locator('[data-group]').count(),0);
 }finally{await browser.close();}
});
