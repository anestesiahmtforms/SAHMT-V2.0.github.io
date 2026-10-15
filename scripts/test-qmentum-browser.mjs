import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.QMENTUM_PREVIEW_URL||'http://127.0.0.1:5184/SAHMT-V2.0.github.io/tests/fixtures/qmentum-preview.html';
const url=new URL(base);assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Local preview only');
await mkdir('.local-preview/qmentum',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});let checks=0;
try {
 for(const [label,width,height] of [['mobile',390,844],['tablet',768,1024],['desktop',1440,1000],['compact',320,568]]){
  const context=await browser.newContext({viewport:{width,height}});await context.route('**/*',route=>new URL(route.request().url()).origin===url.origin?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.waitForSelector('html[data-qmentum-ready="true"]');
  assert.equal(await page.locator('.qm-indicator').count(),18);checks++;
  const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollHeight,viewport:innerHeight,horizontal:document.documentElement.scrollWidth>innerWidth,home:document.querySelector('.qm-home-button').getBoundingClientRect().bottom,grid:document.querySelector('.qm-grid').clientHeight}));
  assert.ok(layout.scroll<=height+1,`${label}: page must not scroll`);assert.equal(layout.horizontal,false);assert.ok(layout.home<=height&&layout.grid>60);checks+=3;
  await page.screenshot({path:`.local-preview/qmentum/${label}-page.png`});
  await page.locator('[data-qm-indicator="QM18"]').scrollIntoViewIfNeeded();const scroll=await page.locator('.qm-grid').evaluate(n=>n.scrollTop);await page.locator('[data-qm-indicator="QM18"]').click();
  await page.waitForSelector('dialog[open]');assert.match(await page.locator('#qm-dialog-title').innerText(),/QM18/);checks++;
  const monthName=new Intl.DateTimeFormat('pt-BR',{month:'long'}).format(new Date());assert.ok((await page.locator('.qm-dialog__header small').innerText()).toLocaleLowerCase('pt-BR').includes(`${monthName} de ${new Date().getFullYear()}`));checks++;
  const bounds=await page.locator('.qm-dialog').boundingBox();assert.ok(bounds.y>=0&&bounds.x>=0&&bounds.y+bounds.height<=height+1&&bounds.x+bounds.width<=width+1);checks++;
  assert.equal(await page.locator('.qm-analysis p').count(),2);assert.equal(await page.locator('.qm-dialog .qm-chart').count(),2);checks+=2;
  await page.screenshot({path:`.local-preview/qmentum/${label}-modal.png`});
  await page.locator('[data-count="safeSurgeryCompliant"]').fill('98');await page.locator('[data-count="safeSurgeryEligible"]').fill('100');await page.locator('[data-qm-action="save"]').click();
  await page.waitForFunction(()=>document.querySelector('.qm-status')?.textContent.includes('salva no FA'));assert.equal(await page.evaluate(()=>window.qmentumPreview.rows.length),1);checks++;
  await page.locator('[data-qm-close]').click();assert.ok(Math.abs(await page.locator('.qm-grid').evaluate(n=>n.scrollTop)-scroll)<2);assert.equal(await page.evaluate(()=>document.activeElement.dataset.qmIndicator),'QM18');checks+=2;
  await page.locator('[data-qm-indicator="QM18"]').click();assert.equal(await page.locator('[data-count="safeSurgeryCompliant"]').inputValue(),'98');checks++;
  const original=await page.locator('[data-date]').inputValue(),selectedDay=original.slice(0,7)+'-20';await page.locator('[data-date]').fill(selectedDay);await page.locator('[data-date]').dispatchEvent('change');await page.locator('[data-qm-action="save"]').click();await page.waitForFunction(()=>window.qmentumPreview.rows[0]?.version===2);assert.equal(await page.evaluate(()=>window.qmentumPreview.rows.length),1);assert.equal(await page.evaluate(()=>window.qmentumPreview.rows[0].referenceDate),selectedDay);checks+=2;
  await page.locator('[data-qm-close]').click();const outerDay=original.slice(0,7)+'-21';await page.locator('#qm-date').fill(outerDay);await page.locator('#qm-date').dispatchEvent('change');await page.locator('[data-qm-indicator="QM18"]').click();assert.equal(await page.locator('[data-date]').inputValue(),outerDay);checks++;
  const openEntry=()=>width<=600?page.locator('.qm-tools-menu').selectOption('entry'):page.locator('[data-qm-action="entry"]').click();
  await page.locator('[data-qm-close]').click();await openEntry();assert.equal(await page.locator('[data-count]').count(),await page.evaluate(()=>Object.keys(window.qmentumPreview.emptyInputs().counts).length));checks++;
  await page.locator('[data-count="general"]').fill('15');await page.locator('[data-qm-close]').click();await openEntry();assert.equal(await page.locator('[data-count="general"]').inputValue(),'15');checks++;
  await page.setViewportSize({width,height:Math.max(380,Math.round(height*.6))});const small=await page.locator('[data-qm-close]').boundingBox();assert.ok(small.y+small.height<=Math.max(380,Math.round(height*.6))+1);checks++;
  assert.equal(await page.locator('.qm-references').count(),0);checks++;
  const lines=await page.evaluate(()=>{const el=document.createElement('section');el.className='qm-ai-analysis';const text=('Dados agregados exigem revisão institucional e acompanhamento pela coordenação clínica. ').repeat(4).slice(0,340);el.innerHTML='<p></p><p></p>';el.querySelectorAll('p').forEach(p=>p.textContent=text);document.querySelector('.qm-dialog__body').append(el);return [...el.querySelectorAll('p')].map(p=>Math.round(p.getBoundingClientRect().height/parseFloat(getComputedStyle(p).lineHeight)));});
  assert.ok(lines.every(n=>n<=15),label+': AI paragraphs exceed 15 standard lines');checks++;
  await page.getByRole('button',{name:'VOLTAR',exact:true}).click();
  await page.locator('[data-qm-indicator="QM01"]').click();await page.locator('[data-qm-action="quarterly"]').click();
  await page.waitForSelector('[data-quarter]');assert.equal(await page.locator('dialog[open]').count(),1);checks++;
  await page.locator('[data-qm-close]').click();assert.match(await page.locator('#qm-dialog-title').innerText(),/QM01/);checks++;
  assert.deepEqual(errors,[]);checks++;await context.close();
 }
 console.log(JSON.stringify({code:'QMENTUM_BROWSER_LOCAL_OK',checks,viewports:4,externalRequests:0}));
} finally {await browser.close();}
