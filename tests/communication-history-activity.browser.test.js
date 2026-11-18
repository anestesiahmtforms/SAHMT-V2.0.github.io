import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

test('Central real components: catalog, preview, exact retry, history, receipts and visible reads',async t=>{
 const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 const url=`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/communication-history-activity-preview.html`;
 const page=await browser.newPage({viewport:{width:320,height:568}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const open=name=>page.getByRole('button',{name,exact:true}).click();
 const setup=async(query='')=>{await page.goto(url+query);await open('TREINAMENTOS E ENQUETES');await page.getByLabel('Definir atividade').selectOption('TRAINING:training-synthetic');await page.getByLabel('Nota mínima').fill('7');};
 try{
  await t.test('published source metadata and preview precede send; lost response retains exact request',async()=>{
   await setup('?lost');await page.locator('[data-activity-link-row]').waitFor();
   await open('CONFERIR DESTINATÁRIOS');await page.getByText(/1 destinatário\(s\) receberão esta atividade/).waitFor();
   await page.locator('.comm-activity-recipient-details summary').click();
   assert.match(await page.locator('[data-activity-preview]').innerText(),/Pessoa Teste.*team/);assert.match(await page.locator('[data-activity-preview]').innerText(),/excluded-person — Sem permissão/);
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='CREATE_ACTIVITY')),false);
   await open('ENVIAR ATIVIDADE');await page.getByRole('button',{name:'CONFIRMAR MESMO ENVIO',exact:true}).waitFor();await open('CONFIRMAR MESMO ENVIO');await page.getByRole('button',{name:'ENVIADO',exact:true}).waitFor();
   const sends=await page.evaluate(()=>window.calls.filter(c=>c.action==='CREATE_ACTIVITY'));assert.equal(sends.length,2);assert.deepEqual(sends[0].input,sends[1].input);assert.match(sends[0].input.id,/^activity-/);
   assert.equal(await page.locator('[data-activity-form]').evaluate(form=>form.scrollWidth<=form.clientWidth),true);
  });
  await t.test('grouped module catalog exposes a direct activity link and uses published training only',async()=>{
   await setup();
   const trainingOption=page.locator('optgroup[label="Gestão de Documentos"] option[value="TRAINING:training-synthetic"]');
   const surveyOption=page.locator('optgroup[label="Enquetes e Consultas"] option[value="SURVEY:survey-synthetic"]');
   assert.equal(await trainingOption.textContent(),'Treinamento publicado');
   assert.equal(await surveyOption.textContent(),'Enquete publicada');
   await page.getByLabel('Definir atividade').selectOption('TRAINING:training-other');
   await page.getByLabel('Nota mínima').fill('7');
   const route='#/management/area-gestao-de-documentos/required/training-other';
   assert.match(await page.locator('[data-activity-link]').getAttribute('href'),new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
   await open('CONFERIR DESTINATÁRIOS');
   await page.getByRole('button',{name:'ENVIAR ATIVIDADE',exact:true}).waitFor();
   const activity=await page.evaluate(()=>window.calls.filter(c=>c.action==='PREVIEW_ACTIVITY').at(-1).input.activity);
   assert.deepEqual(activity,{kind:'TRAINING',id:'training-other',title:'Cirurgia Segura',version:2,maxScore:10,minimumScore:7});
  });
  await t.test('editing invalidates preview; surveys have cycle and no minimum; no late send',async()=>{
   await setup();await open('CONFERIR DESTINATÁRIOS');await page.getByRole('button',{name:'ENVIAR ATIVIDADE',exact:true}).waitFor();
   await open('REVISAR SELEÇÃO');await page.getByLabel('Definir atividade').selectOption('SURVEY:survey-synthetic');assert.equal(await page.getByLabel('Nota mínima').isVisible(),false);assert.equal(await page.locator('[data-confirm-activity]').count(),0);
   await open('CONFERIR DESTINATÁRIOS');await page.getByRole('button',{name:'ENVIAR ATIVIDADE',exact:true}).waitFor();
   const activity=await page.evaluate(()=>window.calls.filter(c=>c.action==='PREVIEW_ACTIVITY').at(-1).input.activity);assert.equal(activity.cycle,'2026-11');assert.equal('minimumScore' in activity,false);
   await page.evaluate(()=>window.current=false);await open('ENVIAR ATIVIDADE');
   // Session ownership must be checked before invoking any mutation.
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='CREATE_ACTIVITY')),false);
  });
  await t.test('history filters and pagination retain full body, person receipts and legacy honesty',async()=>{
   await page.goto(url);await open('MENSAGENS ENVIADAS');await page.locator('[data-sent-id] summary').first().click();await page.getByText('Conclusão confirmada:',{exact:false}).waitFor();
   assert.match(await page.locator('.comm-message').innerText(),/Corpo integral\nSegunda linha/);assert.equal(await page.getByText('Conclusão na origem:',{exact:false}).count(),0);assert.match(await page.locator('.comm-recipient-record').innerText(),/Mensagem aberta:/);
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='MESSAGE_READ')),false);
   await open('REPETIR SINCRONIZAÇÃO');await page.getByText(/Sincronização solicitada/).waitFor();
   await page.getByLabel('Justificativa do cancelamento').fill('Atividade retirada');await open('CANCELAR CONVOCAÇÃO');await page.getByText('Cancelamento: Atividade retirada',{exact:true}).waitFor();
   await open('CARREGAR MAIS');await page.getByText('Histórico legado',{exact:true}).click();await page.getByText('Destinatários e leituras: não registrado no envio original.',{exact:true}).waitFor();
   await page.getByLabel('De',{exact:true}).fill('2026-11-01');await page.getByLabel('Tipo',{exact:true}).selectOption('SURVEY');await page.getByLabel('Pesquisar título, texto ou remetente').fill('Convocação');await open('FILTRAR');
   const request=await page.evaluate(()=>window.calls.filter(c=>c.action==='SENT_MESSAGES').at(-1).input);assert.equal(request.cursor,'');assert.deepEqual(request.filters,{from:Date.parse('2026-11-01T00:00:00-03:00'),kind:'SURVEY',search:'Convocação'});
  });
  await t.test('inbox listing is not a read; hidden expansion is deferred; repeats are idempotent',async()=>{
   await page.goto(url+'?common');await page.getByText('Convocação sintética',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='MESSAGE_READ')),false);
   await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));await page.getByText('Convocação sintética',{exact:true}).click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='MESSAGE_READ')),false);
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await page.getByText(/Abertura registrada:/).waitFor();
   await page.getByText('Convocação sintética',{exact:true}).click();await page.getByText('Convocação sintética',{exact:true}).click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='MESSAGE_READ').length),1);
   await page.getByText('Aviso legado',{exact:true}).click();await page.getByText('Leitura: não registrado no envio original.',{exact:true}).waitFor();assert.equal(await page.locator('[data-message-id="legacy-message"]').getAttribute('data-read-recorded'),'legacy');
  });
  assert.deepEqual(errors,[]);
 }finally{await page.close();await browser.close();await server.close();}
});
