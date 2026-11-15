import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.VACCINATION_PREVIEW_URL||'http://127.0.0.1:5178/tests/fixtures/vaccination-preview.html';
const launch={headless:true,...(process.env.CI?{}:{channel:'msedge'})};

test('vaccination starts with a highlighted centered period and the vaccine question',async()=>{
 const browser=await chromium.launch(launch);
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(base+'?hub');
 await page.getByRole('button',{name:'MEU HISTÓRICO VACINAL',exact:true}).click();
 await page.locator('[data-vac-year]:enabled').waitFor();
 assert.equal(await page.locator('.vac-header,.vac-toolbar nav,.vac-period>span,[name=awareness]').count(),0);
 assert.equal(await page.getByText('Situação vacinal · 2026',{exact:true}).count(),0);
 const metrics=await page.locator('.vac-period').evaluate(el=>{const r=el.getBoundingClientRect(),legend=document.querySelector('.vac-vaccines legend');return {center:r.x+r.width/2,width:innerWidth,font:parseFloat(getComputedStyle(legend).fontSize),align:getComputedStyle(legend).textAlign};});
 assert.ok(Math.abs(metrics.center-metrics.width/2)<2);assert.ok(metrics.font>=18);assert.equal(metrics.align,'center');
 if(process.env.SAHMT_LAYOUT_SCREENSHOTS)await page.screenshot({path:process.env.SAHMT_LAYOUT_SCREENSHOTS+'/vaccination-390.png'});
 for(const name of ['Hepatite B','Antitetânica','Triviral','Influenza'])await page.getByLabel(name,{exact:true}).selectOption('UPDATED');
 await page.getByLabel('Declaração sobre os comprovantes',{exact:true}).selectOption('UP_TO_DATE');
 await page.getByLabel('Confirmo que as informações declaradas são verdadeiras.').check();
 await page.getByRole('button',{name:'Salvar meu cadastro',exact:true}).click();await page.getByText('Cadastro salvo com sucesso.',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.lastSaved)).awareness,false);
 }finally{await browser.close();}
});

test('FE exposes vaccination directly and has no dosimetry or Biossegurança button',async()=>{
 const browser=await chromium.launch(launch);try{const page=await browser.newPage();await page.goto(base+'?hub');await page.locator('.management-hub-dialog[data-panel="institutional"]').waitFor();assert.equal(await page.getByRole('button',{name:'BIOSSEGURANÇA',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/DOSIMETRIA/}).count(),0);await page.getByRole('button',{name:'MEU HISTÓRICO VACINAL',exact:true}).click();await page.locator('[data-vac-year]:enabled').waitFor();await page.getByRole('button',{name:'VOLTAR',exact:true}).click();await page.locator('.management-hub-dialog[data-panel="institutional"]').waitFor();}finally{await browser.close();}
});
