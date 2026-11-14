import {APP_VERSION} from '../src/app-version.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {createYearEndStartupPreview} from './helpers/year-end-startup-preview.js';
const safari=process.env.SAHMT_BROWSER_ENGINE==='webkit',engine=safari?webkit:chromium;

test('the owner can switch between administrator and team views without replacing the login',{timeout:60000},async()=>{
 const preview=await createYearEndStartupPreview();let browser;
 try{
  preview.records.set('mode-owner',{uid:'mode-owner',sigla:'FR',plantao:'natal',grupo:null,position:1,createdAt:Date.now()});
  preview.release();
  browser=await engine.launch({headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})});
  const context=await browser.newContext({viewport:{width:320,height:650}}),page=await context.newPage();
  page.setDefaultTimeout(12000);
  const origin=new URL(preview.url).origin;
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(preview.url+'?account=mode-owner');
  const selector=page.getByLabel('Modo de uso');
  assert.equal(await selector.inputValue(),'administrator');
  await selector.selectOption('team');
  assert.equal(await selector.inputValue(),'team');
  const bounds=await selector.boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=320&&bounds.height>=44,JSON.stringify(bounds));
  await page.reload();
  assert.equal(await selector.inputValue(),'team');
  await page.evaluate(()=>location.hash='#/admin');
  await page.waitForFunction(()=>location.hash==='#/home');
  await assertTeamConsultations(page);
  await page.evaluate(()=>location.hash='#/management-hub/surveys');
  await page.getByRole('button',{name:'ESCALA DE FÉRIAS 2027',exact:true}).click();
  await page.locator('.vacations-2027').waitFor();
  assert.equal(await page.locator('[data-vac-admin]').count(),0);
  assert.equal(await page.locator('[data-vac-simulation-sigla]').count(),0);
  await page.getByRole('button',{name:'VOLTAR',exact:true}).click();
  await openYearEnd(page);
  await page.waitForFunction(()=>document.querySelector('input[name="plantao"][value="natal"]')?.checked===true);
  assert.equal(await page.locator('[data-year-end-admin]').count(),0);
  await page.evaluate(()=>location.hash='#/year-end-schedule');
  await page.locator('.year-end-dialog[open]').waitFor();
  await page.waitForFunction(()=>document.querySelector('input[name="plantao"][value="natal"]')?.checked===true);
  assert.equal(await page.locator('[data-year-end-admin]').count(),0);
  await page.getByRole('button',{name:'Voltar ao início',exact:true}).click();
  await selector.selectOption('administrator');
  await page.evaluate(()=>location.hash='#/year-end-schedule');
  await page.locator('[data-year-end-admin]').waitFor();
  await page.evaluate(()=>location.hash='#/management-hub/vacations2027');
  await page.locator('[data-vac-admin]').waitFor();
  await page.goto(preview.url+'?account=admin');
  await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
  assert.equal(await selector.count(),0);
 }finally{await browser?.close();await preview.close();}
});

test('banner recovers without FE login; team Governance opens schedules and consultations',{timeout:60000},async()=>{
 const preview=await createYearEndStartupPreview({statusFailures:1,requireSecondaryConnect:true});let browser;
 try{
  preview.release();browser=await engine.launch({headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})});const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(12000);
  const origin=new URL(preview.url).origin;await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(preview.url);await page.locator('.app-shell--home [data-route="schedule"]').waitFor();assert.equal(await page.evaluate(()=>window.fixtureFeReady),false);
  await openYearEnd(page);await page.getByRole('button',{name:'CONECTAR ESCALA COM GOOGLE',exact:true}).waitFor();
  assert.equal(await page.locator('.year-end-startup:visible').count(),0);await page.getByRole('button',{name:'CONECTAR ESCALA COM GOOGLE',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-year-end-form] fieldset')?.disabled===false);assert.equal(await page.evaluate(()=>window.fixtureFeReady),true);
  await page.getByRole('button',{name:'Voltar ao início',exact:true}).click();await page.locator('.app-shell--home [data-route="schedule"]').waitFor();assert.equal(await page.getByRole('button',{name:/Governança/}).isDisabled(),false);
  await assertTeamConsultations(page);
 }finally{await browser?.close();await preview.close();}
});

async function openYearEnd(page){
 await page.evaluate(()=>location.hash='#/year-end-schedule');
}

async function assertTeamConsultations(page){
 await page.evaluate(()=>location.hash='#/management-hub/surveys');await page.locator('.management-hub-dialog[data-panel="surveys"]').waitFor();
 const dialog=page.locator('.management-hub-dialog');
 const items=dialog.locator('[data-hub-item]');
 assert.equal(await items.count(),5);
 for(const title of ['ESCALA FINAL DE ANO','ESCALA DE FÉRIAS 2027','PESQUISAS INSTITUCIONAIS','CADASTRO PROFISSIONAL','CADASTRO EPIDEMIOLÓGICO']){
  assert.equal(await items.filter({hasText:title}).isEnabled(),true,title);
 }
 await page.evaluate(()=>location.hash='#/home');await page.locator('.app-shell--home [data-route="schedule"]').waitFor();assert.equal(await page.locator('.management-hub-dialog').count(),0);
}

async function compactLayout(page){
 await page.waitForFunction(()=>document.querySelector('[data-year-end-form] fieldset')?.disabled===false);
 const metrics=await page.evaluate(()=>{
  const dialog=document.querySelector('.year-end-dialog'),title=dialog.querySelector('h2'),field=dialog.querySelector('fieldset'),button=dialog.querySelector('[type="submit"]');
  const rect=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
  return {viewport:{width:innerWidth,height:innerHeight},dialog:rect(dialog),title:rect(title),button:rect(button),gap:rect(field).top-rect(title).bottom,titleColor:getComputedStyle(title).color,
   overflow:[dialog,dialog.querySelector('[data-year-end-dialog-body]'),dialog.querySelector('form')].map(el=>({height:el.scrollHeight-el.clientHeight,width:el.scrollWidth-el.clientWidth})),
   controls:[...dialog.querySelectorAll('.year-end-option,[type="submit"]')].map(rect),text:dialog.textContent};
 });
 assert.ok(metrics.overflow.every(m=>m.height<=1&&m.width<=1),JSON.stringify(metrics));
 assert.ok(metrics.controls.every(r=>r.top>=0&&r.bottom<=metrics.viewport.height&&r.left>=0&&r.right<=metrics.viewport.width),JSON.stringify(metrics));
 assert.ok(Math.abs((metrics.title.left+metrics.title.right)/2-metrics.viewport.width/2)<1,JSON.stringify(metrics));
 assert.equal(metrics.titleColor,'rgb(255, 255, 255)');assert.ok(metrics.gap<=28,`title/form gap: ${metrics.gap}`);
 assert.doesNotMatch(metrics.text,/SAHMT|Atualização em tempo real|Obrigatório|Dispensado para|Escolhas registradas|Os totais são/);
 assert.equal(await page.locator('.year-end-dialog [data-year-end-admin]').count(),0);
 assert.equal(await page.locator('.year-end-dialog [data-year-end-count]').count(),0);
 assert.equal(await page.locator('.year-end-option-icon').count(),5);
 assert.equal(await page.locator('[data-year-end-category="plantao"] legend').textContent(),'ESCOLHO O PLANTÃO:');
 assert.equal(await page.locator('[data-year-end-category="grupo"] legend').textContent(),'ESCOLHO O GRUPO DE TRABALHO:');
 assert.equal(await page.locator('.year-end-submit').textContent(),'CONFIRMA ESCOLHAS');
}

test('temporary team banner opens a compact fixed form; only administrators see totals and registrations',{timeout:120000},async t=>{
 let preview,browser,page,closing;
 const cleanup=()=>closing??=Promise.allSettled([browser?.close(),preview?.close()]);t.signal.addEventListener('abort',()=>{void cleanup();},{once:true});
 try{
  preview=await createYearEndStartupPreview({holdAuthentication:true});browser=await engine.launch({headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})});
  const context=await browser.newContext({viewport:{width:390,height:844}});page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin=new URL(preview.url).origin;await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(preview.url);await page.locator('.startup-logo').waitFor();
  assert.equal(await page.locator('.startup-logo img').count(),1);assert.equal((await page.locator('.startup-logo').textContent()).trim(),'');
  assert.equal(await page.locator('.year-end-startup').isVisible(),false);
  preview.releaseAuthentication();await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
  assert.equal(await page.locator('.home-logo-stage [data-app-version]').textContent(),APP_VERSION);
  const versionLayout=await page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,left:r.left};};
    return {badge:rect('[data-app-version]'),stage:rect('.home-logo-stage')};
  });
  assert.ok(versionLayout.badge.right<=versionLayout.stage.right&&versionLayout.stage.right-versionLayout.badge.right<12);
  assert.ok(versionLayout.badge.bottom<=versionLayout.stage.bottom&&versionLayout.stage.bottom-versionLayout.badge.bottom<12);
  assert.equal(await page.locator('.startup-logo').count(),0,'authentication closes the logo without a timed animation');
  assert.equal(await page.locator('.year-end-startup').isVisible(),false,'the Home does not fetch FE campaign status');
  await page.waitForTimeout(500);assert.deepEqual(preview.requests,[],'Home startup must not call the FE Worker');
  await page.evaluate(()=>{window.initialSchedule=document.querySelector('.app-shell--home [data-route="schedule"]');});
  await openYearEnd(page);preview.release();
  await page.locator('.year-end-dialog[open]').waitFor();
  assert.equal(await page.evaluate(()=>window.initialSchedule!==null),true,'Home had rendered before the user opened FE');
  assert.ok(preview.requests.some(request=>request.action==='banner'),'opening the FE module is allowed to request its own status');
  await page.evaluate(()=>{window.initialCampaign=document.querySelector('.year-end-startup');location.hash='#/notifications';});
  await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
  assert.equal(await page.locator('.year-end-startup').isVisible(),false);
  await page.evaluate(()=>location.hash='#/home');await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
  await page.waitForTimeout(3500);assert.equal(await page.locator('.year-end-startup').isVisible(),false);
  await mkdir('.local-preview',{recursive:true});await page.screenshot({path:`.local-preview/year-end-startup-${safari?'webkit':'chromium'}.png`,fullPage:true});
  await page.locator('.app-shell--home [data-route="schedule"]').waitFor();assert.equal(await page.getByRole('button',{name:/Governança/}).isDisabled(),false);
  await page.reload();await openYearEnd(page);await page.locator('[data-year-end-form]').waitFor();assert.equal(await page.locator('.year-end-startup').isVisible(),false,'the banner never covers its form');
  assert.equal(new URL(page.url()).hash,'#/year-end-schedule');assert.equal(await page.locator('.management-hub-dialog').count(),0);
  await page.locator('.year-end-dialog[open]').waitFor();
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:568,height:320}]){await page.setViewportSize(viewport);await page.waitForTimeout(80);await compactLayout(page);}
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('input[name="plantao"]').count(),3);assert.equal(await page.locator('input[name="grupo"]').count(),2);assert.equal(await page.locator('input[name="grupo"][value="carnaval"]').count(),0);
  await page.locator('input[name="plantao"][value="natal"]').check();const submit=page.getByRole('button',{name:'CONFIRMA ESCOLHAS',exact:true});assert.equal(await submit.isDisabled(),true);
  await page.locator('input[name="grupo"][value="reveillon"]').check();await submit.click();await page.getByText('Não foi possível conectar. Confira a internet e tente novamente.',{exact:true}).waitFor();assert.equal(preview.records.size,0);
  await page.getByRole('button',{name:'Voltar ao início',exact:true}).click();await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
  await page.goto(preview.url);await openYearEnd(page);await page.locator('input[name="plantao"][value="carnaval"]').check();await page.locator('input[name="grupo"][value="reveillon"]').check();await page.getByRole('button',{name:'CONFIRMA ESCOLHAS',exact:true}).click();await page.getByText('Escolhas confirmadas!',{exact:true}).waitFor();assert.equal(preview.records.size,1);assert.equal(preview.records.get('team').plantao,'carnaval');
  assert.equal(await page.locator('.year-end-submit').textContent(),'CONFIRMA ESCOLHAS');
  await page.reload();await page.waitForFunction(()=>document.querySelector('input[name="plantao"][value="carnaval"]')?.checked===true);await compactLayout(page);
  await page.screenshot({path:`.local-preview/year-end-startup-carnival-${safari?'webkit':'chromium'}.png`,fullPage:true});
  await page.getByRole('button',{name:'Voltar ao início',exact:true}).click();await page.locator('.app-shell--home [data-route="schedule"]').waitFor();assert.equal(await page.getByRole('button',{name:/Governança/}).isDisabled(),false);
  await assertTeamConsultations(page);
  await page.reload();await page.locator('.app-shell--home [data-route="schedule"]').waitFor();assert.equal(await page.locator('.year-end-startup:visible').count(),0);
  const another=await browser.newPage({viewport:{width:390,height:844}});await another.goto(preview.url);await another.locator('.app-shell--home [data-route="schedule"]').waitFor();assert.equal(await another.locator('.year-end-startup:visible').count(),0);await another.close();
  await page.goto(preview.url+'?account=shift-only');await openYearEnd(page);await compactLayout(page);assert.equal(await page.locator('[data-year-end-category="grupo"]').evaluate(el=>el.disabled),true);for(const radio of await page.locator('input[name="grupo"]').all())assert.equal(await radio.isDisabled(),true);await page.locator('input[name="plantao"][value="carnaval"]').check();await page.getByRole('button',{name:'CONFIRMA ESCOLHAS',exact:true}).click();await page.getByText('Escolhas confirmadas!',{exact:true}).waitFor();assert.equal(preview.records.get('shift-only').grupo,null);
  preview.records.set('admin',{uid:'admin',sigla:'ZZ',plantao:'natal',grupo:'reveillon',position:3,createdAt:Date.now()});
  for(let i=0;i<20;i++)preview.records.set('row'+i,{uid:'row'+i,sigla:'AA',plantao:'natal',grupo:'natal',position:i+4,createdAt:Date.now()});
  await page.setViewportSize({width:1366,height:900});await page.goto(preview.url+'?account=admin#/year-end-schedule');await page.locator('[data-year-end-rows] tr').first().waitFor();assert.equal(await page.locator('[data-year-end-admin]').count(),1);assert.equal(await page.locator('[data-year-end-count="plantaoCarnaval"]').textContent(),'2');
  const before=await page.locator('.year-end-submit').boundingBox();const scrolled=await page.locator('[data-year-end-admin]').evaluate(el=>{el.scrollTop=el.scrollHeight;return el.scrollTop;});assert.ok(scrolled>0);assert.deepEqual(await page.locator('.year-end-submit').boundingBox(),before);
  await page.screenshot({path:`.local-preview/year-end-startup-admin-${safari?'webkit':'chromium'}.png`,fullPage:true});await page.setViewportSize({width:390,height:844});
  preview.records.clear();await page.goto(preview.url);await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
  for(const account of ['resident','substitute']){
   await page.goto(preview.url+'?account='+account);
   await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
   assert.equal(await page.locator('.year-end-startup:visible').count(),0);
   await page.evaluate(()=>location.hash='#/year-end-schedule');
   await page.waitForFunction(()=>location.hash==='#/home');
   assert.equal(await page.locator('[data-year-end-form]').count(),0);
   assert.equal(await page.getByRole('button',{name:/Governança/}).isEnabled(),true);
   await page.evaluate(()=>location.hash='#/management-hub/surveys');
   const consultations=page.locator('.management-hub-dialog[data-panel="surveys"]');
   await consultations.waitFor();
   const items=consultations.locator('[data-hub-item]');
   assert.equal(await items.count(),1);
   assert.equal(await items.filter({hasText:'PESQUISAS INSTITUCIONAIS'}).isEnabled(),true);
  }
  assert.deepEqual(errors,[]);
 }catch(error){console.log('Year-end startup browser failure:',error.message);await mkdir('.local-preview',{recursive:true});await page?.screenshot({path:`.local-preview/year-end-startup-failure-${safari?'webkit':'chromium'}.png`,fullPage:true}).catch(()=>{});throw error;}
 finally{await cleanup();}
});
