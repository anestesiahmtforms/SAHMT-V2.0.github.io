import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.VACCINATION_PREVIEW_URL||'http://127.0.0.1:5178/tests/fixtures/vaccination-preview.html';
async function run(fn){const browser=await chromium.launch({headless:true,channel:process.env.SAHMT_TEST_BROWSER_CHANNEL||'msedge'});try{await fn(browser);}finally{await browser.close();}}
async function open(page,query=''){await page.goto(base+'?entry'+query);await page.getByRole('button',{name:'BIOSSEGURANÇA',exact:true}).click();await page.getByRole('button',{name:'MEU HISTÓRICO DOSIMETRIA',exact:true}).click();await page.getByRole('button',{name:'2025',exact:true}).waitFor();}

test('annual banners preserve twelve monthly values, responsive layout and session privacy',()=>run(async browser=>{
 const page=await browser.newPage();
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await open(page);
  assert.equal(await page.evaluate(()=>window.doseRequests?.length||0),0);
  assert.equal(await page.locator('.dosimetry-year svg').count(),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const year of [2025,2026]){
   await page.getByRole('button',{name:String(year),exact:true}).click();await page.getByText('Profissional de demonstração',{exact:true}).waitFor();
   await page.getByRole('heading',{name:'Meu Histórico de Dosimetria · '+year,exact:true}).waitFor();
   assert.equal(await page.locator('.dosimetry-table tbody tr').count(),12);
   assert.equal(await page.locator('[data-dose-month="1"]').innerText(),year===2025?'0,7':'ANR');
   assert.equal(await page.locator('[data-dose-month="2"]').innerText(),year===2025?'ANR':'0,2');
   assert.equal(await page.locator('[data-dose-month="12"]').innerText(),year===2025?'ANR':'Não disponível');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${year} at ${width}px fits`);
   await page.getByRole('button',{name:'VOLTAR PARA OS ANOS',exact:true}).click();assert.equal(await page.locator('.dosimetry-owner,.dosimetry-table').count(),0);
  }
  await page.getByRole('button',{name:'2026',exact:true}).click();await page.getByText('Profissional de demonstração',{exact:true}).waitFor();
  await page.evaluate(()=>window.invalidate());await page.getByText('Sua sessão mudou. Entre novamente para consultar seu histórico individual.',{exact:true}).waitFor();
  assert.equal(await page.locator('.dosimetry-owner').count(),0);assert.equal(await page.locator('[data-dose-month="2"]').innerText(),'Não disponível');
  await page.evaluate(()=>window.entryBack());await page.evaluate(()=>window.entryBack());
  await page.getByRole('button',{name:'MEU HISTÓRICO VACINAL',exact:true}).waitFor();await page.evaluate(()=>window.entryBack());
  await page.getByText('Atividades de Gestão de Pessoas preservadas',{exact:true}).waitFor();
 }
}));

test('late response from a previous year cannot replace the current annual banner',()=>run(async browser=>{
 const page=await browser.newPage();await open(page,'&doseRace');await page.getByRole('button',{name:'2025',exact:true}).click();
 await page.waitForFunction(()=>typeof window.completeOldDose==='function');await page.getByRole('button',{name:'VOLTAR PARA OS ANOS',exact:true}).click();
 await page.getByRole('button',{name:'2026',exact:true}).click();await page.getByText('Profissional de demonstração',{exact:true}).waitFor();
 await page.evaluate(async()=>{window.completeOldDose();await new Promise(resolve=>setTimeout(resolve,100));});
 await page.getByRole('heading',{name:'Meu Histórico de Dosimetria · 2026',exact:true}).waitFor();assert.equal(await page.locator('[data-dose-month="1"]').innerText(),'ANR');
}));

test('missing or mismatched annual records do not display doses from another year',()=>run(async browser=>{
 const page=await browser.newPage();
 for(const query of ['&doseEmpty','&doseWrongYear']){await open(page,query);await page.getByRole('button',{name:'2025',exact:true}).click();await page.locator('[aria-busy="false"]').waitFor();assert.equal(await page.locator('.dosimetry-owner').count(),0);assert.equal(await page.locator('[data-dose-month="1"]').innerText(),'Não disponível');if(query.includes('Wrong'))await page.getByText('O relatório retornado não corresponde ao ano selecionado. Solicite a conferência à Gestão de Pessoas.',{exact:true}).waitFor();else await page.getByText('Não há relatório de dosimetria vinculado ao seu cadastro para este ano. Solicite a conferência à Gestão de Pessoas.',{exact:true}).waitFor();}
}));
