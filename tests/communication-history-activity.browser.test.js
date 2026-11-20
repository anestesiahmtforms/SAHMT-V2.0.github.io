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
  await t.test('a conferência expirada reabre as escolhas e permite concluir o envio',async()=>{
   await setup('?expired');
   await open('CONFERIR DESTINATÁRIOS');await open('ENVIAR ATIVIDADE');
   await page.getByText('A conferência expirou. Confira os destinatários novamente para enviar.').waitFor();
   assert.equal(await page.getByLabel('Definir atividade').inputValue(),'TRAINING:training-synthetic');
   assert.equal(await page.getByLabel('Nota mínima').inputValue(),'7');
   await open('CONFERIR DESTINATÁRIOS');await open('ENVIAR ATIVIDADE');
   await page.getByRole('button',{name:'ENVIADO',exact:true}).waitFor();
   const sends=await page.evaluate(()=>window.calls.filter(call=>call.action==='CREATE_ACTIVITY'));
   assert.deepEqual(sends.map(call=>call.input.previewId),['preview-1','preview-2']);
  });
  await t.test('o prazo pode ser informado em horas e alterado em dias no histórico',async()=>{
   await setup('?deadline');
   assert.equal(await page.locator('[data-activity-source]').count(),0);
   await page.getByLabel('Prazo para esta atividade').fill('6');
   await page.getByLabel('Unidade').selectOption('hours');
   await open('CONFERIR DESTINATÁRIOS');
   await page.getByText('Prazo: 6 hora(s) a partir do envio.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.calls.find(c=>c.action==='PREVIEW_ACTIVITY').input.deadlineHours),6);
   await page.goto(url+'?deadline');await open('MENSAGENS ENVIADAS');await open('ATIVIDADES');
   await page.locator('[data-sent-id]>summary').first().click();
   await page.getByText('Registros do envio',{exact:true}).click();
   const editor=page.locator('[data-update-activity-deadline]');
   await editor.getByLabel('Novo prazo a partir de agora').fill('2');
   await editor.getByRole('button',{name:'ALTERAR PRAZO'}).click();
   await page.getByText(/^Prazo alterado para/).waitFor();
   assert.equal(await page.evaluate(()=>window.calls.find(c=>c.action==='UPDATE_ACTIVITY_DEADLINE').input.deadlineHours),48);
   await editor.getByLabel('Novo prazo a partir de agora').fill('9');
   await editor.getByLabel('Unidade').selectOption('hours');
   await editor.getByRole('button',{name:'ALTERAR PRAZO'}).click();
   await page.waitForFunction(()=>window.calls.filter(c=>c.action==='UPDATE_ACTIVITY_DEADLINE').length===2);
   assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.action==='UPDATE_ACTIVITY_DEADLINE').map(c=>c.input.deadlineHours)),[48,9]);
  });
  await t.test('o modal de Atividade acompanha a altura dos campos e fica centralizado',async()=>{
   await setup('?hub');
   await page.getByLabel('Público').selectOption('USER');
   await page.getByLabel('Destinatário').selectOption('synthetic-person');
   const modal=page.locator('.management-hub-dialog');
   const size=await modal.evaluate(dialog=>{
    const r=dialog.getBoundingClientRect(),body=dialog.querySelector('.management-hub-body');
    const form=dialog.querySelector('[data-activity-form]').getBoundingClientRect(),footer=dialog.querySelector('.comm-actions').getBoundingClientRect();
    return {center:r.y+r.height/2,height:r.height,viewport:innerHeight,gap:footer.top-form.bottom,scroll:body.scrollHeight-body.clientHeight};
   });
   assert.ok(Math.abs(size.center-size.viewport/2)<=2,JSON.stringify(size));
   assert.ok(size.height<size.viewport-36&&size.gap<=16&&size.scroll<=1,JSON.stringify(size));
   await page.getByLabel('Público').selectOption('ALL');
   assert.ok((await modal.boundingBox()).height<size.height-30);
  });
  await t.test('atividade na origem alterna o estado somente para administrador',async()=>{
   await page.goto(url+'?survey-toggle');
   await open('ATIVAR ATIVIDADE');await open('DESATIVAR ATIVIDADE');
   await page.getByRole('button',{name:'ATIVAR ATIVIDADE',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.folderRequests),[
    {folder:'consultas/cadastro-profissional',enabled:true},{folder:'consultas/cadastro-profissional',enabled:false}
   ]);
   await page.goto(url+'?survey-toggle&common');await page.getByRole('dialog').waitFor();
   assert.equal(await page.getByRole('button',{name:/ativar atividade/i}).count(),0);
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
  await t.test('sent folders display only message, date and recipient, with optional activity records',async()=>{
   await page.goto(url);await open('MENSAGENS ENVIADAS');await open('ATIVIDADES');await page.locator('[data-sent-id]>summary').first().click();
   await page.getByText('Registros do envio',{exact:true}).click();await page.getByText('Conclusão confirmada:',{exact:false}).waitFor();
   assert.match(await page.locator('.comm-message').innerText(),/Corpo integral\nSegunda linha/);assert.equal(await page.getByText('Conclusão na origem:',{exact:false}).count(),0);assert.match(await page.locator('.comm-recipient-record').innerText(),/Mensagem aberta:/);
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='MESSAGE_READ')),false);
   await open('REPETIR SINCRONIZAÇÃO');await page.getByText(/Sincronização solicitada/).waitFor();
   await page.getByLabel('Justificativa do cancelamento').fill('Atividade retirada');await open('CANCELAR CONVOCAÇÃO');await page.getByText('Cancelamento: Atividade retirada',{exact:true}).waitFor();
   await open('VOLTAR ÀS PASTAS');await open('LIBERAÇÃO');await page.getByText('Para Pessoa L2',{exact:true}).waitFor();
   assert.deepEqual(await page.locator('[data-sent-id]>summary span:last-child').allTextContents(),['Para Pessoa L2','Para Pessoa AB']);
   await open('VOLTAR ÀS PASTAS');await open('EVENTOS ENVIADOS');await open('CARREGAR MAIS');const legacy=page.locator('[data-sent-id="legacy-message"]');await legacy.locator(':scope>summary').click();await legacy.getByText('Registros do envio',{exact:true}).click();
   await page.getByText('Destinatários e leituras: não registrado no envio original.',{exact:true}).waitFor();
   assert.deepEqual(await page.locator('[data-sent-id]>summary strong').allTextContents(),['Evento de teste','Histórico legado']);
   assert.equal(await page.locator('input[type=date],input[type=search],button:has-text("FILTRAR")').count(),0);
   const calls=await page.evaluate(()=>window.calls.filter(c=>c.action==='SENT_MESSAGES').map(c=>c.input));
   assert.ok(calls.every(input=>input.summary===true&&!input.filters));
  });
  await t.test('inbox listing is not a read; hidden expansion is deferred; repeats are idempotent',async()=>{
   await page.goto(url+'?common');await page.getByText('Convocação sintética',{exact:true}).waitFor();
   const unread=page.locator('[data-message-id="synthetic-message"]'),read=page.locator('[data-message-id="legacy-message"]');
   assert.deepEqual(await page.locator('[data-message-id] summary h3').allTextContents(),['Convocação sintética','Aviso legado']);
   assert.equal(await unread.getAttribute('data-read-state'),'unread');assert.equal(await read.getAttribute('data-read-state'),'read');assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='MESSAGE_READ')),false);
   await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));await page.getByText('Convocação sintética',{exact:true}).click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='MESSAGE_READ')),false);
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await page.getByText(/Abertura registrada:/).waitFor();
   await page.getByText('Convocação sintética',{exact:true}).click();await page.getByText('Convocação sintética',{exact:true}).click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='MESSAGE_READ').length),1);
   assert.equal(await unread.getAttribute('data-read-state'),'read');
  });

  await t.test('a Home mantém o botão vermelho até abrir as duas mensagens amarelas',async()=>{
   await page.goto(url+'?common&unread');
   const shortcut=page.locator('.comm-inbox-shortcut');
   await page.locator('.comm-inbox-shortcut[data-unread="true"]').waitFor();
   assert.equal(await shortcut.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(169, 29, 45)');
   await shortcut.click();
   const latest=page.locator('[data-message-id="user-one"]'),older=page.locator('[data-message-id="user-two"]');
   await latest.waitFor();
   assert.equal(await latest.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 241, 191)');
   await latest.locator('summary').click();
   await latest.getByText('Lida',{exact:true}).waitFor();
   assert.equal(await latest.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(227, 244, 230)');
   await open('VOLTAR PARA HOME');
   await page.locator('.comm-inbox-shortcut[data-unread="true"]').waitFor();
   await shortcut.click();
   await older.locator('summary').click();
   await older.getByText('Lida',{exact:true}).waitFor();
   await open('VOLTAR PARA HOME');
   await page.locator('.comm-inbox-shortcut[data-unread="false"]').waitFor();
  });
  assert.deepEqual(errors,[]);
 }finally{await page.close();await browser.close();await server.close();}
});
