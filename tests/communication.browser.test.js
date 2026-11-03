import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.COMMUNICATION_PREVIEW_URL||'http://127.0.0.1:5178/SAHMT-V2.0.github.io/tests/fixtures/communication-preview.html';
const open=(p,name)=>p.getByRole('button',{name,exact:true}).click();
test('admin home, individual recipient, three groups, forwarding and manual send work on phones and desktop',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.goto(url);await open(page,'NOVA COMUNICAÇÃO');
   await page.fill('[name=title]','<img src=x onerror=alert(1)>');await page.fill('[name=message]','Informação institucional de teste');
   await page.selectOption('[name=audienceType]','GROUP');await open(page,'CARREGAR OPÇÕES');
   assert.deepEqual(await page.locator('[name=audienceValue] option').allTextContents(),['EQUIPE','RESIDENTES','SUBSTITUTOS']);
   await page.selectOption('[name=audienceType]','USER');await open(page,'CARREGAR OPÇÕES');await page.selectOption('[name=audienceValue]','fa-person');
   await open(page,'VISUALIZAR ANTES DE PUBLICAR');assert.equal(await page.locator('[data-preview-content] img').count(),0);
   await open(page,'PUBLICAR COMUNICADO');await page.getByText('Comunicado publicado. O Push ainda exige envio manual.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='SEND_BATCH')),false);
   await open(page,'CENTRAL DE COMUNICAÇÃO');await open(page,'ENVIAR NOTIFICAÇÃO PUSH');await open(page,'PREPARAR PUSH');await open(page,'PREPARAR ENVIO MANUAL');await open(page,'CONFIRMAR PRÓXIMO LOTE (ATÉ 3)');
   await page.getByText(/Aceitos pelo FCM: 1/).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='SEND_BATCH').length),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await open(page,'CENTRAL DE COMUNICAÇÃO');await open(page,'ENCAMINHAR INFORMAÇÃO PARA FF');await page.selectOption('[name=project]','FB');await page.fill('[name=recordId]','notice');await open(page,'CONFERIR ORIGEM E PREPARAR RASCUNHO');await page.locator('[name=title]').waitFor();assert.equal(await page.locator('[name=title]').inputValue(),'Informação criada em FB');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
test('ordinary users see own inbox only; Governance hides administrative card entirely',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.goto(url+'?common');await open(page,'MENSAGENS RECEBIDAS');assert.equal(await page.locator('[data-view]').count(),0);assert.equal(await page.locator('[data-enable]').count(),1);assert.equal(await page.evaluate(()=>window.calls.some(c=>['DIRECTORY','GROUPS','MESSAGES'].includes(c.action))),false);
  await page.goto(url+'?common&hub');await page.locator('dialog[open]').waitFor();assert.equal(await page.getByRole('button',{name:'CENTRAL DE COMUNICAÇÃO — FF'}).count(),0);
  await page.goto(url+'?hub');await open(page,'CENTRAL DE COMUNICAÇÃO — FF');await open(page,'DESTINATÁRIOS E GRUPOS');await page.getByText('SUBSTITUTOS',{exact:true}).waitFor();assert.equal(await page.locator('[data-group]').count(),0);
 }finally{await browser.close();}
});
