import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {PROFESSIONAL_FIELDS,EPIDEMIOLOGICAL_FIELDS} from '../src/registration-domain.js';
const url='http://127.0.0.1:5178/SAHMT-V2.0.github.io/tests/fixtures/registration-preview.html';
async function run(fn){const browser=await chromium.launch({headless:true,...(process.env.REGISTRATION_BROWSER_EXECUTABLE ? {executablePath:process.env.REGISTRATION_BROWSER_EXECUTABLE} : {channel:'msedge'})});try{await fn(browser);}finally{await browser.close();}}
const open=(page,name)=>page.getByRole('button',{name,exact:true}).click();
test('resident sees only the nine requested professional fields and no attachment controls',()=>run(async browser=>{
 const page=await browser.newPage();
 await page.goto(url+'?resident');
 await open(page,'ACESSO RESTRITO');
 await open(page,'CADASTRO PROFISSIONAL - SAHMT');
 await page.getByRole('button',{name:'SALVAR MEU CADASTRO'}).waitFor();
 assert.deepEqual(await page.locator('.reg-form [data-field]').evaluateAll(nodes=>nodes.map(node=>node.dataset.field)),
  ['fullName','birthDate','cpf','crm','phone','address','managementAreas','surgicalAreas','lattes']);
 assert.equal(await page.locator('.reg-attachments').count(),0);
 assert.equal(await page.evaluate(()=>window.calls.some(call=>call.kind==='drive')),false);
}));
test('epidemiological modal highlights start, requires a local BMI calculation and accepts a blank suggestion',()=>run(async browser=>{
 const page=await browser.newPage({isMobile:true,hasTouch:true});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:740});
  await page.goto(url);
  await page.locator('body').evaluate(body=>body.classList.add('app-shell'));
  assert.equal(await page.locator('[data-hub-item] svg').count(),2);
  await open(page,'ACESSO RESTRITO');
  assert.match(await page.locator('[data-hub-item]').first().innerText(),/MEU HISTÓRICO VACINAL/);
  await open(page,'CADASTRO EPIDEMIOLÓGICO - SAHMT');
  await page.getByRole('heading',{name:'Equipe',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Indicadores Epidemiológicos'}).count(),0);
  assert.equal(await page.locator('form').isVisible(),false);
  const start=page.getByRole('button',{name:'Iniciar Pesquisa',exact:true});
  assert.ok((await start.boundingBox()).height>=48);
  assert.equal(await start.isDisabled(),true);
  await page.check('[name=consent]');
  await start.click();

  const dialog=page.locator('.survey-questions');
  const body=dialog.locator('.survey-question-body');
  const footer=dialog.locator('footer');
  const bounds=await dialog.boundingBox(), footerBounds=await footer.boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
  assert.ok(footerBounds.y+footerBounds.height<=740);
  for(const name of ['Voltar','Enviar resposta'])
   assert.ok((await footer.getByRole('button',{name,exact:true}).boundingBox()).height>=52);
  assert.equal(await dialog.evaluate(el=>getComputedStyle(el).position),'fixed');
  assert.equal(await dialog.evaluate(el=>getComputedStyle(el).overflowY),'hidden');
  assert.equal(await body.evaluate(el=>getComputedStyle(el).scrollbarWidth),'thin');
  assert.ok(await body.evaluate(el=>{el.scrollTop=el.scrollHeight;return el.scrollTop;}));
  assert.deepEqual(await footer.boundingBox(),footerBounds);
  assert.equal(await page.locator('[name=group],[name=email],[name=fullName],[name=uid],[name=bmiBand]').count(),0);
  assert.ok(await body.locator('input:not([type=checkbox]),select,textarea').evaluateAll(fields=>
   fields.every(field=>parseFloat(getComputedStyle(field).fontSize)>=16)));

  const calculator=dialog.locator('.reg-bmi');
  const calculatorButton=calculator.getByText('Calcular faixa de IMC',{exact:true});
  const age=dialog.locator('[name=ageBand]');
  const exercise=dialog.locator('[name=exercise]');
  assert.equal(await dialog.getByText('Faixa de IMC',{exact:true}).count(),0);
  assert.ok((await age.boundingBox()).y<(await calculatorButton.boundingBox()).y);
  assert.ok((await calculatorButton.boundingBox()).y<(await exercise.boundingBox()).y);
  for(const field of EPIDEMIOLOGICAL_FIELDS){
   if(field.id==='bmiBand')continue;
   if(field.type==='checks')await page.check('[name="'+field.id+'"][value="'+field.options[0][0]+'"]');
   else await page.selectOption('[name="'+field.id+'"]',field.options[0][0]);
  }
  await page.check('[name=conditions][value=CARDIO]');
  await page.check('[name=conditions][value=NONE]');
  assert.equal(await page.locator('[name=conditions][value=CARDIO]').isChecked(),false);
  await open(page,'Enviar resposta');
  assert.equal(await page.evaluate(()=>window.calls.some(call=>call.action==='SUBMIT')),false);
  assert.equal(await calculator.evaluate(el=>el.open),true);
  await page.fill('[data-local-weight]','70.2');
  await page.fill('[data-local-height]','175');
  assert.match(await page.locator('[data-local-bmi]').textContent(),/22,9/);
  await page.fill('[data-local-height]','');
  await calculatorButton.click();
  await open(page,'Enviar resposta');
  assert.equal(await page.evaluate(()=>window.calls.some(call=>call.action==='SUBMIT')),false);
  assert.equal(await calculator.evaluate(el=>el.open),true);
  await page.fill('[data-local-height]','175');
  assert.equal(await page.locator('[name=comments]').inputValue(),'');
  await open(page,'Enviar resposta');

  await page.getByText('Sua participação foi registrada.',{exact:true}).waitFor();
  const input=await page.evaluate(()=>window.calls.find(call=>call.action==='SUBMIT').input);
  assert.equal(input.consent,true);
  assert.equal(input.answers.bmiBand,'MID');
  assert.equal(input.comments,'');
  assert.doesNotMatch(JSON.stringify(input),/weight|height|email|uid|fullName/);
  assert.equal(await page.locator('form').count(),0);
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
 }
 assert.deepEqual(errors,[]);
}));
test('professional modal keeps a compact header and a fixed footer while the form scrolls',()=>run(async browser=>{
 const page=await browser.newPage({isMobile:true,hasTouch:true});
 for(const [width,height,headerLimit] of [[320,568,63],[390,844,75],[1440,900,75]]){
  await page.setViewportSize({width,height});
  await page.goto(url);
  await page.locator('body').evaluate(body=>body.classList.add('app-shell'));
  await open(page,'ACESSO RESTRITO');
  await open(page,'CADASTRO PROFISSIONAL - SAHMT');
  await page.locator('form').waitFor();
  const dialog=page.getByRole('dialog'),header=dialog.locator('header'),back=dialog.getByRole('button',{name:'VOLTAR'});
  const bounds=await dialog.boundingBox(),headerBounds=await header.boundingBox(),footerBounds=await back.boundingBox();
  const columns=dialog.locator('.reg-work-grid thead th');
  assert.equal(await columns.count(),6);
  assert.equal(await columns.nth(1).getAttribute('aria-label'),'Semanal');
  assert.equal(await columns.nth(1).innerText(),width<=620?'Sem.':'Semanal');
  assert.equal(await columns.nth(2).getAttribute('aria-label'),'Quinzenal');
  assert.equal(await dialog.locator('.reg-work-key').isVisible(),width<=620);
  assert.ok(await columns.evaluateAll(headers=>headers.every(header=>
   getComputedStyle(header).writingMode==='horizontal-tb'&&header.scrollWidth<=header.clientWidth)));
  assert.equal(await dialog.evaluate(element=>getComputedStyle(element).position),'fixed');
  assert.ok(headerBounds.height<=headerLimit,`Cabeçalho de ${headerBounds.height}px a ${width}px`);
  assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height);
  assert.ok(footerBounds.y+footerBounds.height<=height);
  const body=dialog.locator('[data-hub-body]');
  assert.equal(await body.evaluate(element=>getComputedStyle(element).overflowY),'auto');
  assert.equal(await body.evaluate(element=>getComputedStyle(element).scrollbarWidth),'thin');
  assert.ok(await body.evaluate(element=>{element.scrollTop=element.scrollHeight;return element.scrollTop;}));
  assert.deepEqual(await header.boundingBox(),headerBounds);
  assert.deepEqual(await back.boundingBox(),footerBounds);
  assert.ok(await body.locator('input:not([type=checkbox]):not([type=file]),select,textarea').evaluateAll(fields=>
   fields.every(field=>parseFloat(getComputedStyle(field).fontSize)>=16)));
 }
}));

test('professional birth date shows calendar age alongside it using the Sao Paulo date',()=>run(async browser=>{
 const page=await browser.newPage({viewport:{width:320,height:700},isMobile:true,hasTouch:true});
 await page.clock.setFixedTime(new Date('2025-03-10T02:00:00Z'));
 await page.goto(url);
 await open(page,'ACESSO RESTRITO');
 await open(page,'CADASTRO PROFISSIONAL - SAHMT');
 const birth=page.getByLabel('Data de nascimento', {exact:false});
 await birth.waitFor();
 const age=page.locator('output[data-reg-age-value]');
 assert.equal(await age.count(),1);
 assert.equal(await age.isVisible(),false);
 for(const [date,expected] of [
  ['2000-03-09','25 anos, 0 meses e 0 dias'],
  ['2000-02-29','25 anos, 0 meses e 9 dias'],
  ['2000-01-31','25 anos, 1 mês e 9 dias'],
  ['2025-03-08','0 anos, 0 meses e 1 dia']
 ]){
  await birth.fill(date);
  assert.equal(await age.textContent(),expected);
 }
 assert.equal(await page.getByText('IDADE ATUAL',{exact:true}).isVisible(),true);
 const birthBox=await birth.boundingBox(),ageBox=await age.boundingBox();
 assert.ok(ageBox.x>=birthBox.x+birthBox.width&&ageBox.x+ageBox.width<=320);
 for(const date of ['2025-03-10','']){
  await birth.fill(date);
  assert.equal(await age.isVisible(),false);
 }
 await page.clock.setFixedTime(new Date('2024-02-29T15:00:00Z'));
 await birth.fill('2000-02-29');
 assert.equal(await age.textContent(),'24 anos, 0 meses e 0 dias');
}));

test('professional form refreshes saved changes from another session and preserves a local draft',()=>run(async browser=>{
 const page=await browser.newPage();
 await page.goto(url);
 await open(page,'ACESSO RESTRITO');
 await open(page,'CADASTRO PROFISSIONAL - SAHMT');
 const crm=page.locator('[name=crm]');
 await crm.waitFor();
 await page.evaluate(()=>window.updateRegistration({version:1,answers:{crm:'12345'}}));
 await page.waitForFunction(()=>document.querySelector('[name=crm]')?.value==='12345');
 await crm.fill('65432');
 await page.evaluate(async()=>{
  window.updateRegistration({version:2,answers:{crm:'11111'}});
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 });
 assert.equal(await crm.inputValue(),'65432');
}));

test('professional form saves the grid and uploads immediately after file selection',()=>run(async browser=>{
 const page=await browser.newPage({viewport:{width:320,height:700}});
 await page.goto(url+'?retry&legacyText');
 await page.locator('body').evaluate(body=>body.classList.add('app-shell'));
 await open(page,'ACESSO RESTRITO');
 await open(page,'CADASTRO PROFISSIONAL - SAHMT');
 await page.locator('form').waitFor();
 await open(page,'SALVAR MEU CADASTRO');
 const feedback=page.locator('[data-reg-feedback]');
 const teachingResearch=page.locator('[name=teachingResearch]');
 const address=page.locator('[name=address]');
 assert.equal(await teachingResearch.getAttribute('required'),null);
 assert.equal(await address.getAttribute('required'),null);
 async function assertCompactFeedback(){
  const geometry=await feedback.evaluate(dialog=>{
   const {x,y,width,height,bottom}=dialog.getBoundingClientRect();
   const actions=dialog.querySelector('.reg-feedback-actions').getBoundingClientRect();
   return {x,y,width,height,viewportWidth:innerWidth,viewportHeight:innerHeight,bottomGap:bottom-actions.bottom};
  });
  assert.ok(Math.abs(geometry.x+geometry.width/2-geometry.viewportWidth/2)<2);
  assert.ok(Math.abs(geometry.y+geometry.height/2-geometry.viewportHeight/2)<2);
  assert.ok(geometry.width<=geometry.viewportWidth-32);
  assert.ok(geometry.bottomGap>=0&&geometry.bottomGap<=20);
 }
 assert.equal(await feedback.getAttribute('data-kind'),'error');
 await assertCompactFeedback();
 assert.match(await feedback.innerText(),/CPF.*preenchimento obrigatório/);
 assert.match(await feedback.innerText(),/declaração de veracidade/);
 assert.doesNotMatch(await feedback.innerText(),/Ensino, pesquisa e inovação/);
 await open(page,'OK');
 await page.locator('[name=crm]').fill('123');
 await open(page,'VOLTAR');
 assert.match(await feedback.innerText(),/Fechar sem salvar/);
 await open(page,'Continuar editando');
 assert.equal(await page.locator('[name=crm]').inputValue(),'123');
 await page.keyboard.press('Escape');
 await open(page,'Sair sem salvar');
 await open(page,'CADASTRO PROFISSIONAL - SAHMT');
 await page.locator('form').waitFor();
 assert.equal(await page.locator('[name=crm]').inputValue(),'');
 const grid=page.locator('.reg-work-grid table');
 const participation=page.locator('[data-reg-schedule-participation]');
 assert.equal(await participation.textContent(),'A preencher');
 assert.ok((await participation.boundingBox()).y>(await grid.boundingBox()).y+(await grid.boundingBox()).height);
 assert.equal(await grid.locator('thead th').count(),6);
 assert.equal(await grid.getByRole('checkbox').count(),32);
 const sunday=grid.getByRole('row',{name:/Domingo/});
 assert.deepEqual(await sunday.getByRole('checkbox').evaluateAll(checkboxes=>checkboxes.map(input=>input.getAttribute('aria-label'))),
  ['Domingo, Quinzenal','Domingo, Plantão noturno']);
 assert.equal(await grid.getByRole('checkbox',{name:/Integral/}).count(),0);
 const saturdayWeekly=grid.getByRole('checkbox',{name:'Sábado, Semanal'});
 const saturdayFortnightly=grid.getByRole('checkbox',{name:'Sábado, Quinzenal'});
 await saturdayWeekly.check();
 assert.equal(await participation.textContent(),'7,14%');
 await saturdayFortnightly.check();
 assert.equal(await saturdayWeekly.isChecked(),false);
 assert.equal(await participation.textContent(),'3,57%');
 const saturdayMorning=grid.getByRole('checkbox',{name:'Sábado, Manhã'});
 await saturdayMorning.check();
 assert.equal(await participation.textContent(),'1,79%');
 await saturdayMorning.uncheck();
 await saturdayWeekly.check();
 assert.equal(await saturdayFortnightly.isChecked(),false);
 assert.equal(await participation.textContent(),'7,14%');
 await saturdayWeekly.uncheck();
 assert.equal(await grid.evaluate(e=>e.getBoundingClientRect().right>e.closest('[data-hub-body]').getBoundingClientRect().right),false);
 const back=page.getByRole('button',{name:'VOLTAR',exact:true});
 const before=await back.boundingBox();
 assert.ok(await page.locator('[data-hub-body]').evaluate(element=>{element.scrollTop=element.scrollHeight;return element.scrollTop;}));
 assert.deepEqual(await back.boundingBox(),before);
 assert.equal(await page.locator('[name=group],[name=crmState],[name=shifts],[name=surgicalDetails],[name=complementarySkills]').count(),0);
 for(const f of PROFESSIONAL_FIELDS){
  if(f.type==='checks')for(const [id] of f.options.slice(0,f.min||1))await page.check('[name="'+f.id+'"][value="'+id+'"]');
  if(f.type==='select')await page.selectOption('[name="'+f.id+'"]',f.options[0][0]);
  if(f.required&&!f.options)await page.fill('[name="'+f.id+'"]',({fullName:'Pessoa Sintética',birthDate:'1990-01-01',cpf:'52998224725',crm:'12345',phone:'31999999999'}[f.id]||'Informação sintética'));
 }
 await page.getByLabel('Mãe',{exact:true}).fill('Mãe Sintética');
 await page.getByLabel('Pai',{exact:true}).fill('Pai Sintético');
 assert.equal(await page.locator('[name=filiation]').count(),0);
 await page.getByRole('checkbox',{name:'Segunda-feira, Manhã'}).check();
 await page.getByRole('checkbox',{name:'Domingo, Plantão noturno'}).check();
 assert.equal(await participation.textContent(),'10,71%');
 await sunday.getByRole('checkbox',{name:'Domingo, Quinzenal'}).check();
 assert.equal(await participation.textContent(),'10,71%');
 for(const field of PROFESSIONAL_FIELDS.filter(field=>field.type==='multi-select')){
  const group=page.locator(`[data-field="${field.id}"]`);
  assert.equal(await group.locator('summary').count(),0);
  const checkboxes=group.getByRole('checkbox');
  assert.equal(await checkboxes.count(),field.options.length);
  assert.ok(await checkboxes.evaluateAll(inputs=>inputs.every(input=>input.getClientRects().length>0)));
 }
 await page.getByRole('checkbox',{name:'Urologia',exact:true}).check();
 await page.getByRole('checkbox',{name:'Nenhuma',exact:true}).check();
 assert.equal(await page.getByRole('checkbox',{name:'Urologia',exact:true}).isChecked(),false);
 await page.getByRole('checkbox',{name:'Cardiovascular',exact:true}).check();
 await page.getByRole('checkbox',{name:'Urologia',exact:true}).check();
 assert.equal(await page.getByRole('checkbox',{name:'Nenhuma',exact:true}).isChecked(),false);
 await page.getByRole('checkbox',{name:'TEA',exact:true}).check();
 await page.getByRole('checkbox',{name:'Mestrado',exact:true}).check();
 await page.getByRole('checkbox',{name:'Comissões',exact:true}).check();
 await page.getByRole('checkbox',{name:'Direção',exact:true}).check();
 await page.check('[name=truth]');
 await open(page,'SALVAR MEU CADASTRO');
 await page.getByText('Cadastro salvo com sucesso.',{exact:true}).waitFor();
 assert.equal(await feedback.getAttribute('data-kind'),'success');
 assert.equal(await feedback.locator('[data-reg-feedback-details]').isVisible(),false);
 assert.equal(await feedback.getByRole('button').count(),1);
 await assertCompactFeedback();
 await page.setViewportSize({width:740,height:320});
 await assertCompactFeedback();
 await page.setViewportSize({width:320,height:700});
 await open(page,'OK');
 const [firstSave,secondSave,saved]=await page.evaluate(()=>window.calls.filter(c=>c.action==='SAVE').map(c=>c.input));
 assert.equal(firstSave.answers.address,'');
 assert.equal(firstSave.answers.teachingResearch,'');
 assert.equal(secondSave.answers.address,'Não informado (campo opcional)');
 assert.equal(saved.answers.teachingResearch,'Não informado (campo opcional)');
 const answers=saved.answers;
 assert.equal(answers.motherName,'Mãe Sintética');
 assert.equal(answers.fatherName,'Pai Sintético');
 assert.deepEqual(answers.workDays,['0:MORNING','6:FORTNIGHTLY','6:ON_CALL']);
 assert.deepEqual(answers.surgicalAreas,['CARDIOVASCULAR','UROLOGY']);
 assert.deepEqual(answers.formation,['TEA','MESTRADO']);
 assert.deepEqual(answers.institutionalParticipation,['COMISSOES','DIRECAO']);
 assert.equal(await page.locator('[data-drive-connect],[data-reg-upload]').count(),0);
 const attachments=page.locator('.reg-attachments');
 const picker=attachments.getByRole('button',{name:'Escolher documento/Fotografar documento',exact:true});
 assert.equal(await attachments.getByText(/Escolha o assunto e selecione um arquivo/).count(),0);
 assert.equal(await attachments.getByRole('heading',{name:'Comprovantes (opcionais)'}).evaluate(el=>getComputedStyle(el).textAlign),'center');
 assert.equal(await attachments.getByText('Assunto',{exact:true}).evaluate(el=>getComputedStyle(el).textAlign),'center');
 assert.equal(await page.locator('[data-reg-subject]').evaluate(el=>getComputedStyle(el).textAlign),'center');
 assert.equal(await attachments.locator('input[type=file]').count(),1);
 assert.equal(await page.locator('[data-reg-file]').getAttribute('capture'),null);
 assert.equal(await picker.isDisabled(),true);
 await page.selectOption('[data-reg-subject]','CV');
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),picker.click()]);
 await chooser.setFiles({name:'exemplo.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nsynthetic\n%%EOF')});
 await page.getByText('Não foi possível confirmar a operação. Tente novamente.',{exact:true}).waitFor();
 await open(page,'SALVAR MEU CADASTRO');
 await page.getByText('Cadastro salvo com sucesso.',{exact:true}).waitFor();
 await open(page,'OK');
 await open(page,'TENTAR NOVAMENTE');
 await page.getByText('Comprovante arquivado no Drive na pasta correspondente.',{exact:true}).waitFor();
 const attempts=await page.evaluate(()=>window.calls.filter(c=>c.action==='UPLOAD').map(c=>c.input));
 assert.equal(attempts.length,2);
 assert.equal(attempts[0].subject,'CV');
 assert.deepEqual(attempts[0],attempts[1]);
 assert.equal(await page.locator('[data-reg-file]').inputValue(),'');
 await open(page,'VOLTAR');
 assert.equal(await page.locator('[name=cpf]').count(),0);
 await open(page,'CADASTRO PROFISSIONAL - SAHMT');
 await page.locator('[name=cpf]').waitFor();
 assert.equal(await page.locator('[name=cpf]').inputValue(),'52998224725');
 assert.equal(await teachingResearch.inputValue(),'');
 assert.equal(await address.inputValue(),'');
 assert.equal(await page.getByLabel('Mãe',{exact:true}).inputValue(),'Mãe Sintética');
 assert.equal(await page.getByLabel('Pai',{exact:true}).inputValue(),'Pai Sintético');
 assert.equal(await participation.textContent(),'10,71%');
 assert.match(await page.locator('[data-reg-age-value]').textContent(),/\d+ anos, \d+ (?:mês|meses) e \d+ (?:dia|dias)/);
 for(const field of ['surgicalAreas','formation','institutionalParticipation']){
  const selected=await page.locator(`input[name="${field}"]:checked`).evaluateAll(inputs=>inputs.map(input=>input.value));
  assert.deepEqual(selected,answers[field]);
 }
 await page.evaluate(()=>window.invalidate());
 assert.equal(await page.locator('form').count(),0);
}));
test('closing an attachment picker keeps the professional form and its draft open',()=>run(async browser=>{
 const page=await browser.newPage({viewport:{width:390,height:740}});
 await page.goto(url);
 await open(page,'ACESSO RESTRITO');
 await open(page,'CADASTRO PROFISSIONAL - SAHMT');
 const dialog=page.getByRole('dialog');
 const name=page.getByRole('textbox',{name:'Nome completo'});
 await name.fill('Rascunho de teste');
 await page.selectOption('[data-reg-subject]','CV');
 await page.locator('[data-reg-file]').dispatchEvent('cancel',{bubbles:true,cancelable:false});
 assert.equal(await dialog.getAttribute('data-panel'),'professional');
 assert.equal(await name.inputValue(),'Rascunho de teste');
 assert.equal(await page.evaluate(()=>window.calls.some(call=>call.action==='UPLOAD')),false);
 await page.locator('[data-reg-file]').setInputFiles({
  name:'comprovante.pdf',mimeType:'application/octet-stream',buffer:Buffer.from('%PDF-1.7\nsynthetic\n%%EOF')
 });
 await page.getByText('Comprovante arquivado no Drive na pasta correspondente.',{exact:true}).waitFor();
 await page.evaluate(()=>{window.createImageBitmap=async()=>{throw Error('Decodificador indisponível');};});
 const photo=await page.evaluate(()=>document.createElement('canvas').toDataURL('image/jpeg').split(',')[1]);
 await page.locator('[data-reg-file]').setInputFiles({
  name:'foto.jpg',mimeType:'image/jpeg',buffer:Buffer.from(photo,'base64')
 });
 await page.getByText('Comprovante arquivado no Drive na pasta correspondente.',{exact:true}).waitFor();
 assert.equal(await dialog.getAttribute('data-panel'),'professional');
 assert.equal(await name.inputValue(),'Rascunho de teste');
 assert.deepEqual(await page.evaluate(()=>window.calls.filter(call=>call.action==='UPLOAD').map(call=>call.input.mimeType)),
  ['application/pdf','image/jpeg']);
 await dialog.dispatchEvent('cancel',{bubbles:false,cancelable:true});
 await open(page,'Sair sem salvar');
 assert.equal(await dialog.getAttribute('data-panel'),'institutional');
}));
test('duplicate participant cannot submit again and a late bootstrap cannot restore a closed banner',()=>run(async browser=>{const page=await browser.newPage();await page.goto(url+'?done');await open(page,'ACESSO RESTRITO');await open(page,'CADASTRO EPIDEMIOLÓGICO - SAHMT');await page.getByText('Você já participou desta pesquisa neste ciclo. Não é possível enviar outra resposta.',{exact:true}).waitFor();assert.equal(await page.locator('form').isVisible(),false);await page.goto(url+'?late');await open(page,'ACESSO RESTRITO');await open(page,'CADASTRO PROFISSIONAL - SAHMT');await page.waitForFunction(()=>!!window.releaseLate);await open(page,'VOLTAR');await page.evaluate(()=>window.releaseLate());await page.waitForTimeout(50);assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('[data-hub-item]').count(),5);}));
