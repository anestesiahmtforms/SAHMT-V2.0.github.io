import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.VACCINATION_PREVIEW_URL||'http://127.0.0.1:5178/tests/fixtures/vaccination-preview.html';
test('biosafety navigation, twelve monthly values, responsive layout and session invalidation',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.SAHMT_TEST_BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage();
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.goto(base+'?entry');
   await page.getByRole('button',{name:'BIOSSEGURANÇA',exact:true}).click();
   assert.equal(await page.locator('.biosafety-choice svg').count(),2);
   await page.getByRole('button',{name:'MEU HISTÓRICO DOSIMETRIA',exact:true}).click();
   await page.getByText('Profissional de demonstração',{exact:true}).waitFor();
   assert.equal(await page.locator('.dosimetry-table tbody tr').count(),12);
   assert.equal(await page.locator('[data-dose-month="1"]').innerText(),'ANR');
   assert.equal(await page.locator('[data-dose-month="2"]').innerText(),'0,2');
   assert.equal(await page.locator('[data-dose-month="12"]').innerText(),'Não disponível');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}px fits`);
   await page.getByRole('button',{name:'VOLTAR PARA BIOSSEGURANÇA',exact:true}).click();
   await page.getByRole('button',{name:'MEU HISTÓRICO VACINAL',exact:true}).click();
   await page.getByLabel('Ciência das orientações',{exact:true}).waitFor();
   await page.evaluate(()=>window.entryBack());
   await page.getByRole('button',{name:'MEU HISTÓRICO DOSIMETRIA',exact:true}).click();
   await page.getByText('Profissional de demonstração',{exact:true}).waitFor();
   await page.evaluate(()=>window.invalidate());
   await page.getByText('Sua sessão mudou. Entre novamente para consultar seu histórico individual.',{exact:true}).waitFor();
   assert.equal(await page.locator('.dosimetry-owner').count(),0);
   assert.equal(await page.locator('[data-dose-month="2"]').innerText(),'Não disponível');
   await page.evaluate(()=>window.entryBack());await page.evaluate(()=>window.entryBack());
   await page.getByText('Atividades de Gestão de Pessoas preservadas',{exact:true}).waitFor();
  }
 }finally{await browser.close();}
});
