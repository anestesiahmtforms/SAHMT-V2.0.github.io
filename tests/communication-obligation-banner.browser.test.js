import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
let server,browser,url;
before(async()=>{server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:0}});await server.listen();url=server.resolvedUrls.local[0]+'tests/fixtures/communication-obligation-banner.html';browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});});
after(async()=>{await browser?.close();await server?.close();});
async function pageFor(options={}){const page=await browser.newPage(options);page.setDefaultTimeout(10000);await page.goto(url,{timeout:30000});await page.locator('[data-obligation-banner]').waitFor();return page;}
const panel=page=>page.locator('[data-obligation-banner]');

test('Cadastro Profissional dos Substitutos usa as 48 horas da convocação',async()=>{
 const page=await pageFor({viewport:{width:980,height:760}});
 try {
  await page.evaluate(async()=>{
   const publishAt=Date.parse('2026-11-27T12:00:00Z');
   fixture.now=publishAt;
   fixture.items=[{id:'activity-substitutes',publishAt,dueAt:publishAt+48*3600000,substituteConvocation:true,
    activity:{kind:'SURVEY',id:'professional',title:'Cadastro Profissional',cycle:'2026'}}];
   await banner.refresh();
  });
  assert.equal(await panel(page).getAttribute('data-blocking'),'false');
  assert.match(await panel(page).locator('[data-deadline]').textContent(),/29\/11\/2026, 09:00/);
  await page.evaluate(async()=>{fixture.now=fixture.items[0].dueAt;await banner.refresh();});
  assert.equal(await panel(page).getAttribute('data-blocking'),'true');
  assert.equal((await panel(page).boundingBox()).width,980);
 } finally {await page.close();}
});

test('banner compacto mostra o título da atividade, o caminho na Home e somente o botão de abrir',async()=>{
 const page=await pageFor({viewport:{width:320,height:568}});try{
  const banner=panel(page);
  assert.deepEqual(await banner.getByLabel('Atividade pendente').locator('option').allTextContents(),['Treinamento seguro','Pesquisa de Clima Organizacional']);
  assert.equal(await banner.locator('[data-path]').textContent(),'Home › Governança › Grupos de Gestão › Gestão de Documentos › Treinamento seguro');
  assert.doesNotMatch(await banner.innerText(),/https:\/\/|link abaixo/);
  assert.deepEqual(await banner.getByRole('button').allTextContents(),['Abrir atividade']);
  const box=await banner.boundingBox();assert.ok(Math.abs(box.width-288)<=1&&box.height<=255,JSON.stringify(box));
  await banner.getByLabel('Atividade pendente').selectOption('new');
  assert.equal(await banner.locator('[data-path]').textContent(),'Home › Governança › Enquetes e Consultas › Acesso Restrito › Pesquisa de Clima Organizacional');
  await banner.getByRole('button',{name:'Abrir atividade',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>fixture.opens),['new']);
 }finally{await page.close();}
});
test('usa 90% da largura até o prazo definido e volta ao tamanho normal após mudança de prazo',async()=>{
 const page=await pageFor({viewport:{width:390,height:844}});try{
  await page.evaluate(()=>{fixture.items=[{...fixture.items[0],dueAt:fixture.now+6*3600000}];});
  await page.evaluate(()=>window.age(5));
  assert.equal(await panel(page).getAttribute('data-blocking'),'false');
  assert.ok(Math.abs((await panel(page).boundingBox()).width-351)<=1);
  await page.evaluate(()=>window.age(6));
  assert.equal(await panel(page).getAttribute('data-blocking'),'true');
  const deadline=await panel(page).boundingBox();assert.equal(deadline.width,390);assert.equal(deadline.height,844);
  await page.evaluate(async()=>{fixture.items[0].dueAt=fixture.now+72*3600000;await banner.refresh();});
  assert.equal(await panel(page).getAttribute('data-blocking'),'false');
  assert.ok(Math.abs((await panel(page).boundingBox()).width-351)<=1);
 }finally{await page.close();}
});

test('server-confirmed age, oldest priority and bounded request budget; no read or dismiss',async()=>{
 const page=await pageFor();try{
  assert.equal(await page.getByLabel('Atividade pendente').inputValue(),'old');
  for(const [hours,stage] of [[0,0],[23,0],[24,1],[48,2],[72,3],[96,4],[119,4],[120,5]]){
   await page.evaluate(h=>window.age(h),hours);assert.equal(await panel(page).getAttribute('data-stage'),String(stage));
  }
  assert.equal(await panel(page).getByRole('button',{name:/fechar|dispensar/i}).count(),0);
  assert.equal(await page.evaluate(()=>fixture.calls.some(c=>/READ|MARK/.test(c.action))),false);
  assert.ok(await page.evaluate(()=>fixture.calls.filter(c=>c.action==='VERIFY_ACTIVITY').every(c=>c.input.id==='old')));
  await page.evaluate(()=>{Date.now=()=>9999999999999;localStorage.setItem('obligation-clock','9999999999999');});
  await page.evaluate(()=>window.age(0));assert.equal(await panel(page).getAttribute('data-stage'),'0');
  await page.getByLabel('Atividade pendente').selectOption('new');await page.getByRole('button',{name:'Abrir atividade',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>fixture.opens),['new']);
  const requests=await page.evaluate(async()=>{banner.setActivityActive(null);fixture.items=Array.from({length:20},(_,i)=>({...fixture.items[0],id:'pending-'+i,publishAt:1700000000000+i}));fixture.calls=[];await banner.refresh();return fixture.calls.map(c=>c.action);});
  assert.deepEqual(requests,['PENDING_ACTIVITIES','VERIFY_ACTIVITY']);
 }finally{await page.close();}
});

test('phone pointer/touch and keyboard movement stay bounded; routes and native modal preserve access',async()=>{
 const page=await pageFor({viewport:{width:320,height:568},hasTouch:true});try{
  const handle=page.getByLabel(/Mover aviso/);await handle.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');
  const before=await panel(page).boundingBox();await handle.press('Shift+ArrowDown');const after=await panel(page).boundingBox();assert.ok(after.y>before.y);
  const drag=await handle.boundingBox();await page.mouse.move(drag.x+20,drag.y+10);await page.mouse.down();await page.mouse.move(2000,2000);await page.mouse.up();
  const touch=await page.context().newCDPSession(page),touchHandle=await handle.boundingBox();
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchHandle.x+30,y:touchHandle.y+15}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:1,y:1}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
  const bounds=await panel(page).boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=321&&bounds.y+bounds.height<=569,JSON.stringify(bounds));
  await page.evaluate(()=>{document.querySelector('#route').innerHTML='<button id="route-two">Outra rota</button>';document.querySelector('#native').showModal();});
  await panel(page).locator('xpath=ancestor::dialog[@id="native"]').waitFor();
  assert.equal(await panel(page).evaluate(el=>el.closest('dialog')?.id),'native');
  await page.evaluate(()=>{const second=document.createElement('dialog');second.id='second';second.innerHTML='<button>Segundo modal</button>';document.body.append(second);second.showModal();});
  await panel(page).locator('xpath=ancestor::dialog[@id="second"]').waitFor();
  await page.evaluate(()=>{const first=document.querySelector('#native');first.close();first.showModal();});
  await panel(page).locator('xpath=ancestor::dialog[@id="native"]').waitFor();
  await page.getByLabel('Atividade pendente').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Abrir atividade');
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 }finally{await page.close();}
});

test('120h blocks general controls while the selected activity stays usable',async()=>{
 const page=await pageFor({viewport:{width:320,height:568}});try{
  await page.evaluate(()=>window.age(120));assert.equal(await panel(page).getAttribute('data-blocking'),'true');
  assert.equal(await page.locator('#route').evaluate(el=>el.inert),true);
  await page.evaluate(()=>document.querySelector('#general').click());assert.equal(await page.evaluate(()=>fixture.general),0);
  await page.getByRole('button',{name:'Abrir atividade',exact:true}).click();
  assert.equal(await panel(page).getAttribute('data-blocking'),'false');
  await page.locator('#activity-control').click();assert.equal(await page.evaluate(()=>fixture.submitted),1);
  await page.evaluate(()=>{document.querySelector('#native').close();banner.setActivityActive(null);});
  await page.waitForFunction(()=>document.querySelector('[data-obligation-banner]')?.dataset.blocking==='true');
  await page.evaluate(async()=>{fixture.completed=['old','new'];await banner.refresh();});
  assert.equal(await panel(page).count(),0);assert.equal(await page.locator('#route').evaluate(el=>el.inert),false);
 }finally{await page.close();}
});

test('source failure preserves pending state and recovers; confirmed completion removes only its item',async()=>{
 const page=await pageFor();try{
  await page.evaluate(async()=>{fixture.fail=true;await banner.refresh();});await page.getByText(/Não foi possível verificar/).waitFor();assert.equal(await page.getByLabel('Atividade pendente').locator('option').count(),2);
  await page.evaluate(()=>{fixture.fail=false;window.dispatchEvent(new Event('online'));});await page.getByText(/Não foi possível verificar/).waitFor({state:'hidden'});
  await page.evaluate(async()=>{fixture.unavailable=true;await banner.refresh();});await page.getByText(/Atividade indisponível/).waitFor();
  await page.evaluate(async()=>{fixture.unavailable=false;fixture.completed.push('old');window.dispatchEvent(new Event('communication:activity-completed'));});
  await page.waitForFunction(()=>document.querySelector('[data-obligation-banner] select')?.value==='new');
  await page.evaluate(async()=>{fixture.completed.push('new');await banner.refresh();});assert.equal(await panel(page).count(),0);
 }finally{await page.close();}
});

test('cleanup suppresses late responses and old-session resume events',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>{fixture.hold=true;window.pendingRefresh=banner.refresh();});await page.waitForFunction(()=>typeof fixture.release==='function');
  await page.evaluate(async()=>{banner.cleanup();fixture.current=false;fixture.release();await pendingRefresh;});assert.equal(await panel(page).count(),0);
  const count=await page.evaluate(()=>fixture.calls.length);await page.evaluate(()=>window.dispatchEvent(new Event('online')));assert.equal(await page.evaluate(()=>fixture.calls.length),count);
 }finally{await page.close();}
});

test('Cadastro Profissional abre pela convocação e reaparece após sair sem enviar',async()=>{
 const page=await pageFor({viewport:{width:320,height:568},hasTouch:true});
 try{
  await page.evaluate(()=>{
   fixture.items=[{...fixture.items[1],id:'activity-registration',activity:{kind:'SURVEY',id:'professional',title:'Cadastro Profissional - SAHMT',cycle:'2026'}}];
   window.dispatchEvent(new Event('focus'));
  });
  const open=panel(page).getByRole('button',{name:'Abrir Cadastro Profissional',exact:true});
  await open.click();
  assert.deepEqual(await page.evaluate(()=>fixture.destination),{
   base:'/SAHMT-V2.0.github.io/',hash:'#/management-hub/professional/required/activity-registration'
  });
  await panel(page).waitFor({state:'hidden'});
  await page.locator('#activity-control').click();
  await page.evaluate(()=>{document.querySelector('#native').close();banner.setActivityActive(null);});
  await open.waitFor();
  await page.evaluate(()=>{
   fixture.completed.push('activity-registration');
   window.dispatchEvent(new Event('communication:activity-completed'));
  });
  await panel(page).waitFor({state:'detached'});
 }finally{await page.close();}
});

test('sexta-feira bloqueia a navegação até confirmar o Cadastro Profissional',async()=>{
 const page=await pageFor({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 try{
  await page.clock.install();
  const item=await page.evaluate(async()=>{
   const cutoff=Date.parse('2026-11-27T00:00:00-03:00');
   fixture.now=cutoff-500;
   const registration={id:'activity-registration',publishAt:cutoff-86400000,dueAt:cutoff+86400000,
    activity:{kind:'SURVEY',id:'professional',title:'Cadastro Profissional - SAHMT',cycle:'2026'}};
   fixture.items=[{...fixture.items[0],publishAt:cutoff-86400000},registration];
   await banner.refresh();
   return registration;
  });
  assert.equal(await panel(page).getAttribute('data-blocking'),'false');
  await page.evaluate(()=>{fixture.now+=500;});
  await page.clock.runFor(550);
  const banner=panel(page);
  assert.equal(await banner.getAttribute('data-blocking'),'true');
  assert.equal(await banner.getByLabel('Atividade pendente').inputValue(),item.id);
  const bounds=await banner.boundingBox();
  assert.equal(bounds.width,390);
  assert.equal(bounds.height,844);
  await page.evaluate(()=>{banner.setActivityActive('old');document.querySelector('#general').click();});
  assert.equal(await page.evaluate(()=>fixture.general),0);
  await banner.getByRole('button',{name:'Abrir Cadastro Profissional'}).click();
  await banner.waitFor({state:'hidden'});
  await page.evaluate(()=>{
   const feedback=document.createElement('dialog');
   feedback.id='save-feedback';
   feedback.innerHTML='<button>Confirmar</button>';
   document.querySelector('#native').append(feedback);
   feedback.showModal();
  });
  await page.getByRole('button',{name:'Confirmar'}).click();
  assert.equal(await banner.isVisible(),false);
  await page.evaluate(()=>{
   document.querySelector('#save-feedback').close();
   document.querySelector('#native').close();
  });
  await banner.waitFor();
  assert.equal(await banner.getAttribute('data-blocking'),'true');
  await page.goto(url+'?offline');
  await banner.waitFor();
  assert.equal(await banner.getAttribute('data-blocking'),'true');
  await page.evaluate(async item=>{
   fixture.fail=false;
   fixture.now=Date.parse('2026-11-27T00:00:00-03:00');
   fixture.items=[item];
   fixture.completed=[item.id];
   await banner.refresh();
  },item);
  assert.equal(await banner.count(),0);
  assert.equal(await page.locator('#route').evaluate(el=>el.inert),false);
 }finally{await page.close();}
});

for (const [affiliation, group, label] of [['resident','resident','Residentes'],['substitute','team','Equipe']]) {
 test('o banner epidemiológico abre o formulário para '+affiliation, async()=>{
  const page=await pageFor({viewport:{width:390,height:844}});
  try{
   await page.evaluate(async({affiliation,group})=>{
    const publishAt=Date.parse('2026-11-27T12:00:00Z');
    fixture.now=publishAt+48*3600000;
    fixture.epidemiologicalGroup=group;
    fixture.items=[{id:'activity-epidemiological',publishAt,dueAt:fixture.now,[affiliation+'Convocation']:true,
     activity:{kind:'SURVEY',id:'epidemiological',title:'Cadastro Epidemiológico SAHMT',cycle:'2026'}}];
    await banner.refresh();
   },{affiliation,group});
   assert.equal(await panel(page).getAttribute('data-blocking'),'true');
   await panel(page).getByRole('button',{name:'Abrir atividade'}).click();
   await page.getByRole('heading',{name:label,exact:true}).waitFor({timeout:4000});
   assert.equal(await panel(page).isVisible(),false);
   await page.check('[name=consent]');
   await page.getByRole('button',{name:'Iniciar Pesquisa'}).click();
   const questions=page.locator('.survey-questions');
   assert.equal(await questions.isVisible(),true);
   await questions.evaluate(async dialog=>{
    const {EPIDEMIOLOGICAL_FIELDS}=await import('/src/registration-domain.js');
    for(const field of EPIDEMIOLOGICAL_FIELDS){
     if(field.id==='bmiBand')continue;
     const input=dialog.querySelector('[name="'+field.id+'"]');
     if(field.type==='checks')input.checked=true;
     else input.value=field.options[0][0];
    }
    dialog.querySelector('[data-local-weight]').value='70.2';
    dialog.querySelector('[data-local-height]').value='175';
   });
   await questions.getByRole('button',{name:'Enviar resposta'}).click();
   await page.waitForFunction(()=>fixture.epidemiologicalSubmission!=null);
   assert.equal(await page.evaluate(()=>fixture.epidemiologicalSubmission.group),group);
  }finally{await page.close();}
 });
}
