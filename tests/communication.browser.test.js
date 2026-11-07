import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.COMMUNICATION_PREVIEW_URL||'http://127.0.0.1:5178/SAHMT-V2.0.github.io/tests/fixtures/communication-preview.html';
const open=(p,name)=>p.getByRole('button',{name,exact:true}).click();

test('missing FF session replaces loading with Google recovery and retries only bootstrap',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.goto(url+'?common&needs-google');await open(page,'Confirmar Google (teste)');await page.locator('[data-enable]').waitFor();assert.equal(await page.getByText('Confirmando acesso no servidor FF…',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='BOOTSTRAP').length),2);assert.equal(await page.evaluate(()=>window.calls.some(c=>['SAVE_MESSAGE','SEND_BATCH','REGISTER_DEVICE'].includes(c.action))),false);}finally{await browser.close();}
});
test('o formulário compacto agrupa destinatários e confirma um único envio',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  for(const [width,height] of [[320,460],[390,844],[768,768],[1440,900]]){
   await page.setViewportSize({width,height});await page.goto(url+'?hub');
   await open(page,'CENTRAL DE COMUNICAÇÃO');await open(page,'CRIAR E ENVIAR EVENTO');
   const form=page.locator('[data-comm-form]'),send=form.getByRole('button',{name:'ENVIAR',exact:true}),recipient=form.getByLabel('Destinatário');
   assert.equal(await recipient.isDisabled(),true);
   assert.deepEqual(await form.getByLabel('Público').locator('option').allTextContents(),['TODOS','EQUIPE','RESIDENTES','SUBSTITUTOS','INDIVIDUAL']);
   assert.deepEqual(await form.locator('input, textarea, select').evaluateAll(elements=>elements.map(element=>element.name)),['title','description','audienceType','audienceValue']);
   const beforeColor=await send.evaluate(button=>getComputedStyle(button).backgroundColor);
   await form.getByLabel('Título').fill('Evento de teste');
   const description='Veja #/home e https://example.test/watch?v=abc&list=xyz';
   await form.getByLabel('Descrição do aviso').fill(description);
   await form.getByLabel('Público').selectOption('USER');await recipient.selectOption('ff-resident');
   assert.deepEqual(await recipient.locator('optgroup').evaluateAll(groups=>groups.map(group=>[group.label,group.textContent])),[['EQUIPE','Pessoa da Equipe'],['RESIDENTES','Pessoa Residente'],['SUBSTITUTOS','Pessoa Substituta']]);
   await send.evaluate(button=>{button.click();button.click();});
   const sent=form.getByRole('button',{name:'ENVIADO',exact:true});await sent.waitFor();
   assert.equal(await sent.isDisabled(),true);
   assert.equal(beforeColor,'rgb(169, 41, 40)');
   assert.equal(await sent.evaluate(button=>getComputedStyle(button).backgroundColor),'rgb(23, 98, 62)');
   assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.action==='CREATE_EVENT').map(c=>[c.input.description,c.input.recipient])),[[description,'ff-resident']]);
   const fit=await page.locator('dialog[open]').evaluate(dialog=>{
    const body=dialog.querySelector('[data-hub-body]'),footer=body.querySelector('.comm-actions');
    return {fixed:getComputedStyle(dialog).position,overflow:getComputedStyle(body).overflowY,clipped:footer.getBoundingClientRect().bottom>body.getBoundingClientRect().bottom,wide:body.scrollWidth>body.clientWidth};
   });
   assert.deepEqual(fit,{fixed:'fixed',overflow:'hidden',clipped:false,wide:false},`${width}x${height}`);
   await open(page,'CENTRAL DE COMUNICAÇÃO');await open(page,'CRIAR E ENVIAR EVENTO');await open(page,'VOLTAR');
   await page.locator('dialog[data-panel=home]').waitFor();
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
test('ordinary users see own inbox only; Governance hides administrative card entirely',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.goto(url+'?common');await open(page,'MENSAGENS RECEBIDAS');assert.equal(await page.locator('[data-view]').count(),0);assert.equal(await page.locator('[data-enable]').count(),1);assert.equal(await page.evaluate(()=>window.calls.some(c=>['DIRECTORY','GROUPS','MESSAGES'].includes(c.action))),false);
  await page.goto(url+'?common&hub');await page.locator('dialog[open]').waitFor();assert.equal(await page.getByRole('button',{name:'CENTRAL DE COMUNICAÇÃO',exact:true}).count(),0);
  await page.goto(url+'?hub');await open(page,'CENTRAL DE COMUNICAÇÃO');await page.getByRole('button',{name:'CRIAR E ENVIAR EVENTO'}).waitFor();assert.equal(await page.locator('.comm-menu button').count(),1);
 }finally{await browser.close();}
});
