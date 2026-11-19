import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {PROFESSIONAL_FIELDS,EPIDEMIOLOGICAL_FIELDS} from '../src/registration-domain.js';
const url='http://127.0.0.1:5178/SAHMT-V2.0.github.io/tests/fixtures/registration-preview.html';
async function run(fn){const browser=await chromium.launch({headless:true,channel:'msedge'});try{await fn(browser);}finally{await browser.close();}}
const open=(page,name)=>page.getByRole('button',{name,exact:true}).click();
test('FE entry buttons and anonymous epidemiological form fit phones and desktop; BMI stays local',()=>run(async browser=>{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await page.goto(url);assert.equal(await page.locator('[data-hub-item] svg').count(),2);await open(page,'ACESSO RESTRITO');await open(page,'CADASTRO EPIDEMIOLÓGICO - SAHMT');await page.getByRole('heading',{name:'Equipe',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Indicadores Epidemiológicos'}).count(),0);assert.equal(await page.locator('form').isVisible(),false);await page.check('[name=consent]');await open(page,'Iniciar Pesquisa');assert.equal(await page.locator('[name=group],[name=email],[name=fullName],[name=uid]').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await open(page,'Enviar resposta');assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='SUBMIT')),false);for(const f of EPIDEMIOLOGICAL_FIELDS)if(f.type==='checks')await page.check(`[name="${f.id}"][value="${f.options[0][0]}"]`);else await page.selectOption(`[name="${f.id}"]`,f.options[0][0]);await page.check('[name=conditions][value=CARDIO]');await page.check('[name=conditions][value=NONE]');assert.equal(await page.locator('[name=conditions][value=CARDIO]').isChecked(),false);await page.locator('summary').click();await page.fill('[data-local-weight]','70');await page.fill('[data-local-height]','175');assert.equal(await page.locator('[name=bmiBand]').inputValue(),'MID');await page.fill('[name=comments]','Sem sugestão');await open(page,'Enviar resposta');await page.getByText('Sua participação foi registrada.',{exact:true}).waitFor();const input=await page.evaluate(()=>window.calls.find(c=>c.action==='SUBMIT').input);assert.equal(input.consent,true);assert.equal(input.answers.bmiBand,'MID');assert.doesNotMatch(JSON.stringify(input),/weight|height|email|uid|fullName/);assert.equal(await page.locator('form').count(),0);assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);}assert.deepEqual(errors,[]);}));
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

test('professional form saves the grid and uploads immediately after file selection',()=>run(async browser=>{
 const page=await browser.newPage({viewport:{width:320,height:700}});
 await page.goto(url+'?retry');
 await open(page,'ACESSO RESTRITO');
 await open(page,'CADASTRO PROFISSIONAL - SAHMT');
 await page.locator('form').waitFor();
 const grid=page.locator('.reg-work-grid table');
 assert.equal(await grid.locator('thead th').count(),7);
 assert.equal(await grid.locator('tbody input').count(),42);
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
 await page.getByRole('checkbox',{name:'Segunda-feira, Semanal'}).check();
 await page.getByRole('checkbox',{name:'Segunda-feira, Manhã'}).check();
 await page.getByRole('checkbox',{name:'Domingo, Plantão'}).check();
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
 const answers=await page.evaluate(()=>window.calls.find(c=>c.action==='SAVE').input.answers);
 assert.deepEqual(answers.workDays,['0:WEEKLY','0:MORNING','6:ON_CALL']);
 assert.deepEqual(answers.surgicalAreas,['CARDIOVASCULAR','UROLOGY']);
 assert.deepEqual(answers.formation,['TEA','MESTRADO']);
 assert.deepEqual(answers.institutionalParticipation,['COMISSOES','DIRECAO']);
 assert.equal(await page.locator('[data-drive-connect],[data-reg-upload]').count(),0);
 const attachments=page.locator('.reg-attachments');
 const picker=attachments.getByRole('button',{name:'Escolher documento/Fotografar documento',exact:true});
 assert.equal(await attachments.getByText(/Escolha o assunto e selecione um arquivo/).count(),0);
 assert.equal(await attachments.getByRole('heading',{name:'Comprovantes'}).evaluate(el=>getComputedStyle(el).textAlign),'center');
 assert.equal(await attachments.getByText('Assunto',{exact:true}).evaluate(el=>getComputedStyle(el).textAlign),'center');
 assert.equal(await page.locator('[data-reg-subject]').evaluate(el=>getComputedStyle(el).textAlign),'center');
 assert.equal(await attachments.locator('input[type=file]').count(),1);
 assert.equal(await page.locator('[data-reg-file]').getAttribute('capture'),null);
 assert.equal(await picker.isDisabled(),true);
 await page.selectOption('[data-reg-subject]','CV');
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),picker.click()]);
 await chooser.setFiles({name:'exemplo.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nsynthetic\n%%EOF')});
 await page.getByText('Não foi possível confirmar a operação. Tente novamente.',{exact:true}).waitFor();
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
 assert.equal(await dialog.getAttribute('data-panel'),'institutional');
}));
test('duplicate participant cannot submit again and a late bootstrap cannot restore a closed banner',()=>run(async browser=>{const page=await browser.newPage();await page.goto(url+'?done');await open(page,'ACESSO RESTRITO');await open(page,'CADASTRO EPIDEMIOLÓGICO - SAHMT');await page.getByText('Você já participou desta pesquisa neste ciclo. Não é possível enviar outra resposta.',{exact:true}).waitFor();assert.equal(await page.locator('form').isVisible(),false);await page.goto(url+'?late');await open(page,'ACESSO RESTRITO');await open(page,'CADASTRO PROFISSIONAL - SAHMT');await page.waitForFunction(()=>!!window.releaseLate);await open(page,'VOLTAR');await page.evaluate(()=>window.releaseLate());await page.waitForTimeout(50);assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('[data-hub-item]').count(),4);}));
