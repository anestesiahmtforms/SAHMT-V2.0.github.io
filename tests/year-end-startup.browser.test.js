import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {createYearEndStartupPreview} from './helpers/year-end-startup-preview.js';
const safari=process.env.SAHMT_BROWSER_ENGINE==='webkit',engine=safari?webkit:chromium;

test('temporary team banner persists until manual close, isolates scheduling, and disappears after a server-confirmed choice',{timeout:90000},async t=>{
 let preview,browser,page,closing;
 const cleanup=()=>closing??=Promise.allSettled([browser?.close(),preview?.close()]);t.signal.addEventListener('abort',()=>{void cleanup();},{once:true});
 try{
  preview=await createYearEndStartupPreview();browser=await engine.launch({headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})});
  const context=await browser.newContext({viewport:{width:390,height:844}});page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin=new URL(preview.url).origin;await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(preview.url);await page.locator('.boot-card').waitFor();const original=await page.locator('.boot-card').boundingBox();
  preview.release();await page.locator('.year-end-startup').waitFor();const campaign=await page.locator('.boot-card').boundingBox();
  assert.ok(Math.abs(original.width-campaign.width)<1);assert.ok(Math.abs(original.height-campaign.height)<1,`card heights: ${original.height}, ${campaign.height}`);
  await page.waitForTimeout(3500);assert.equal(await page.locator('.year-end-startup').count(),1);
  await mkdir('.local-preview',{recursive:true});await page.screenshot({path:`.local-preview/year-end-startup-${safari?'webkit':'chromium'}.png`,fullPage:true});
  await page.getByRole('button',{name:'Fechar banner'}).click();await page.locator('#schedule-date').waitFor();assert.equal(await page.getByRole('button',{name:/Governança/}).isDisabled(),true);
  await page.reload();await page.getByRole('button',{name:'ESCALA FINAL DE ANO',exact:true}).click();await page.locator('[data-year-end-form]').waitFor();
  assert.equal(new URL(page.url()).hash,'#/year-end-schedule');assert.equal(await page.locator('.management-hub-dialog').count(),0);
  await page.locator('input[name="plantao"][value="natal"]').check();const submit=page.getByRole('button',{name:'CONFIRMAR ESCOLHAS →'});assert.equal(await submit.isDisabled(),true);
  await page.locator('input[name="grupo"][value="reveillon"]').check();await submit.click();await page.getByText('Não foi possível conectar. Confira a internet e tente novamente.',{exact:true}).waitFor();assert.equal(preview.records.size,0);
  await page.reload();await page.getByRole('button',{name:'ESCALA FINAL DE ANO',exact:true}).click();await page.locator('input[name="plantao"][value="natal"]').check();await page.locator('input[name="grupo"][value="reveillon"]').check();await page.getByRole('button',{name:'CONFIRMAR ESCOLHAS →'}).click();await page.getByText('Escolhas confirmadas!',{exact:true}).waitFor();assert.equal(preview.records.size,1);
  await page.locator('.brand[data-route="home"]').click();await page.locator('#schedule-date').waitFor();assert.equal(await page.getByRole('button',{name:/Governança/}).isDisabled(),true);
  await page.evaluate(()=>location.hash='#/management-hub/surveys');await page.waitForFunction(()=>location.hash==='#/home');assert.equal(await page.locator('.management-hub-dialog').count(),0);
  await page.reload();await page.locator('#schedule-date').waitFor();assert.equal(await page.locator('.year-end-startup').count(),0);
  const another=await browser.newPage({viewport:{width:390,height:844}});await another.goto(preview.url);await another.locator('#schedule-date').waitFor();assert.equal(await another.locator('.year-end-startup').count(),0);await another.close();
  for(const account of ['resident','substitute']){await page.goto(preview.url+'?account='+account);await page.locator('#schedule-date').waitFor();assert.equal(await page.locator('.year-end-startup').count(),0);await page.evaluate(()=>location.hash='#/year-end-schedule');await page.waitForFunction(()=>location.hash==='#/home');assert.equal(await page.locator('[data-year-end-form]').count(),0);}
  assert.deepEqual(errors,[]);
 }catch(error){console.log('Year-end startup browser failure:',error.message);await mkdir('.local-preview',{recursive:true});await page?.screenshot({path:`.local-preview/year-end-startup-failure-${safari?'webkit':'chromium'}.png`,fullPage:true}).catch(()=>{});throw error;}
 finally{await cleanup();}
});
