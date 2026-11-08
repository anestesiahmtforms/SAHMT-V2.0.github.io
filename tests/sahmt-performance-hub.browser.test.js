import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const base=process.env.SAHMT_HUB_PREVIEW_URL||'http://127.0.0.1:5187/SAHMT-V2.0.github.io/tests/fixtures/sahmt-performance-hub-preview.html';
test('common user opens standard two-block hub panel and returns without loading institutional sources',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('button',{name:'DESEMPENHO - SAHMT',exact:true}).click();await page.locator('[data-sp-total]').waitFor();
 assert.equal(await page.locator('#management-hub-title').textContent(),'DESEMPENHO - SAHMT');assert.equal(await page.locator('[data-sp-category]').count(),6);
 assert.equal(await page.locator('.management-hub-header').count(),1);assert.equal(await page.locator('.management-hub-content-panel').count(),1);
 await page.getByRole('button',{name:/ATIVIDADES OPERACIONAIS/}).click();await page.getByText('Nenhum lançamento confirmado nesta categoria.').waitFor();
 await page.locator('[data-hub-back]').click();assert.equal(await page.locator('#management-hub-title').textContent(),'INDICADORES - SAHMT');
 assert.deepEqual(await page.evaluate(()=>window.calls.map(x=>x.action)),['GET_SAHMT_PERFORMANCE','LIST_SAHMT_HISTORY']);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
