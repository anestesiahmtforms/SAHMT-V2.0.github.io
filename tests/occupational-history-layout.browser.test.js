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

test('dosimetry uses a centered year banner and keeps all monthly rows within its fixed modal',async()=>{
 const browser=await chromium.launch(launch);
 try{const page=await browser.newPage();for(const viewport of [{width:320,height:568},{width:390,height:650},{width:768,height:900},{width:1440,height:900}]){
 await page.setViewportSize(viewport);await page.goto(base+'?hub');await page.getByRole('button',{name:'MEU HISTÓRICO DE DOSIMETRIA',exact:true}).click();
 await page.locator('.dosimetry-years').waitFor();
 assert.equal(await page.locator('[data-dose-back],[data-dose-refresh]').count(),0);
 const years=await page.locator('.dosimetry-year').all();const first=await years[0].boundingBox(),second=await years[1].boundingBox();
 assert.ok(second.y>=first.y+first.height);assert.ok(Math.abs(first.x-second.x)<1);assert.ok(first.width>first.height*2);
 const banner=await page.locator('.management-hub-dialog').boundingBox();assert.ok(Math.abs(banner.y+banner.height/2-viewport.height/2)<2);assert.ok(banner.height<450);
 await page.getByRole('button',{name:'2025',exact:true}).click();await page.locator('[data-dose-month="1"]').getByText('0,7',{exact:true}).waitFor();
 assert.equal(await page.locator('.dosimetry-owner,.dosimetry-period,.dosimetry-meta,[data-dose-back],[data-dose-refresh]').count(),0);
 assert.equal(await page.locator('.dosimetry-table tbody tr').count(),12);
 const metrics=await page.locator('.management-hub-dialog').evaluate(dialog=>{const body=dialog.querySelector('.management-hub-body'),footer=dialog.querySelector('footer').getBoundingClientRect(),last=dialog.querySelector('.dosimetry-legend').getBoundingClientRect();return {overflow:body.scrollHeight-body.clientHeight,last:last.bottom,footer:footer.top,bottom:footer.bottom};});
 if(process.env.SAHMT_LAYOUT_SCREENSHOTS)await page.screenshot({path:process.env.SAHMT_LAYOUT_SCREENSHOTS+'/dosimetry-record-'+viewport.width+'.png'});
 assert.ok(metrics.overflow<=1,JSON.stringify({viewport,metrics}));assert.ok(metrics.last<=metrics.footer&&metrics.bottom<=viewport.height,JSON.stringify({viewport,metrics}));
 await page.getByRole('button',{name:'VOLTAR',exact:true}).click();await page.locator('.dosimetry-years').waitFor();
 if(process.env.SAHMT_LAYOUT_SCREENSHOTS)await page.screenshot({path:process.env.SAHMT_LAYOUT_SCREENSHOTS+'/dosimetry-years-'+viewport.width+'.png'});
 }
 }finally{await browser.close();}
});
