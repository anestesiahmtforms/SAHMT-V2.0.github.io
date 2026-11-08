import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.SAHMT_PERFORMANCE_PREVIEW_URL||'http://127.0.0.1:5187/tests/fixtures/sahmt-performance-preview.html';
async function run(fn){const browser=await chromium.launch({headless:true,channel:process.env.SAHMT_TEST_BROWSER_CHANNEL||'msedge'});try{await fn(browser);}finally{await browser.close();}}
test('consolidated summary, categories, history and admin form fit mobile and desktop',()=>run(async browser=>{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1000});await page.goto(base);await page.locator('[data-sp-total]').waitFor();
  assert.equal(await page.getByRole('heading',{name:'DESEMPENHO - SAHMT'}).count(),1);assert.equal(await page.locator('[data-sp-category]').count(),6);assert.equal(await page.locator('[data-sp-total]').innerText(),'87,5');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:/ATIVIDADES OPERACIONAIS/}).click();await page.getByText('Checklist confirmado',{exact:true}).waitFor();await page.getByRole('button',{name:'Carregar mais',exact:true}).click();await page.getByText('Revisão de checklist',{exact:true}).waitFor();assert.equal(await page.locator('.sp-history-list li').count(),3);
  await page.getByRole('button',{name:/Voltar às categorias/}).click();await page.getByRole('button',{name:'Adicionar lançamento manual'}).click();await page.getByLabel('Pessoa',{exact:true}).selectOption('u1');await page.getByLabel('Categoria',{exact:true}).selectOption('CONTINUING_EDUCATION');assert.equal(await page.getByLabel('Tipo de ocorrência',{exact:true}).isVisible(),false);
  await page.getByLabel('Pontos',{exact:true}).fill('-2.5');await page.getByLabel('Justificativa',{exact:true}).fill('Ajuste da educação continuada');await page.getByRole('button',{name:'Registrar para próxima apuração'}).click();await page.getByText(/Lançamento registrado\. Aguardando/).waitFor();
  assert.equal(await page.locator('[data-sp-total]').innerText(),'87,5');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
  const write=await page.evaluate(()=>window.calls.find(call=>call.action==='ADD_SAHMT_MANUAL').input);assert.equal(write.kind,'CONTINUING_EDUCATION');assert.equal(write.points,-2.5);
 }
 assert.deepEqual(errors,[]);
}));
test('read-only, unavailable, stale, batch-change and disposed states remain honest',()=>run(async browser=>{
 const page=await browser.newPage();await page.goto(base+'?readOnly');await page.locator('[data-sp-total]').waitFor();assert.equal(await page.locator('[data-sp-manual]').count(),0);
 await page.goto(base+'?preparing');await page.getByText(/consolidado está em preparação/).waitFor();assert.equal(await page.locator('[data-sp-total]').count(),0);
 await page.goto(base+'?unavailable');await page.getByText(/Não foi possível consultar a apuração/).waitFor();assert.equal(await page.locator('[data-sp-total]').count(),0);
 await page.goto(base+'?stale');await page.getByText(/apuração está desatualizada/).waitFor();assert.equal(await page.locator('[data-sp-total]').innerText(),'87,5');
 await page.goto(base+'?batchChanged');await page.getByRole('button',{name:/ATIVIDADES OPERACIONAIS/}).click();await page.getByText('Checklist confirmado',{exact:true}).waitFor();await page.getByRole('button',{name:'Carregar mais',exact:true}).click();await page.getByText(/A apuração mudou/).waitFor();assert.equal(await page.locator('.sp-history-list li').count(),0);
 await page.goto(base+'?late');await page.waitForFunction(()=>!!window.releaseLate);await page.evaluate(()=>{window.invalidate();window.releaseLate();});assert.equal(await page.locator('#app').innerText(),'');
}));
test('ambiguous manual failure preserves all inputs and reuses UUID without changing confirmed totals',()=>run(async browser=>{
 const page=await browser.newPage();await page.goto(base+'?saveError');await page.getByRole('button',{name:'Adicionar lançamento manual'}).click();await page.getByLabel('Pessoa',{exact:true}).selectOption('u1');await page.getByLabel('Pontos',{exact:true}).fill('3.5');await page.getByLabel('Justificativa',{exact:true}).fill('Participação na reunião do serviço');await page.getByRole('button',{name:'Registrar para próxima apuração'}).click();await page.getByText(/Seus dados foram preservados/).waitFor();assert.equal(await page.getByLabel('Pontos',{exact:true}).inputValue(),'3.5');assert.equal(await page.getByLabel('Justificativa',{exact:true}).inputValue(),'Participação na reunião do serviço');await page.getByRole('button',{name:'Registrar para próxima apuração'}).click();await page.getByText(/Lançamento registrado\. Aguardando/).waitFor();const ids=await page.evaluate(()=>window.calls.filter(call=>call.action==='ADD_SAHMT_MANUAL').map(call=>call.input.requestId));assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(await page.locator('[data-sp-total]').innerText(),'87,5');
}));
