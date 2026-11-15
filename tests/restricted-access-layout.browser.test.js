import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {createYearEndStartupPreview} from './helpers/year-end-startup-preview.js';

test('restricted access fits all seven buttons and the footer on phone and desktop',{timeout:60000},async()=>{
 const preview=await createYearEndStartupPreview();let browser;
 try{
  preview.release();const safari=process.env.SAHMT_BROWSER_ENGINE==='webkit';browser=await (safari?webkit:chromium).launch({headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})});
  const page=await browser.newPage();page.setDefaultTimeout(12000);
  const origin=new URL(preview.url).origin;
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(preview.url);await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
  await page.evaluate(()=>location.hash='#/management-hub/institutional');
  await page.locator('.management-hub-dialog[data-panel="institutional"]').waitFor();
  for(const viewport of [{width:320,height:568},{width:390,height:650},{width:768,height:900},{width:1440,height:900}]){
   await page.setViewportSize(viewport);
   const metrics=await page.locator('.management-hub-dialog').evaluate(dialog=>{
    const body=dialog.querySelector('.management-hub-body'),footer=dialog.querySelector('footer').getBoundingClientRect();
    return {labels:[...dialog.querySelectorAll('[data-hub-item]')].map(el=>el.textContent),count:dialog.querySelectorAll('[data-hub-item]').length,overflow:body.scrollHeight-body.clientHeight,
     footer:{top:footer.top,bottom:footer.bottom},buttons:[...dialog.querySelectorAll('[data-hub-item]')].map(el=>{
      const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,clipped:el.scrollHeight>el.clientHeight+1};
     })};
   });
   if(process.env.SAHMT_LAYOUT_SCREENSHOTS)await page.screenshot({path:process.env.SAHMT_LAYOUT_SCREENSHOTS+'/restricted-'+viewport.width+'.png'});
   assert.equal(metrics.count,7);
   assert.ok(metrics.labels.some(x=>x.includes('MEU HISTÓRICO VACINAL')));
   assert.ok(metrics.labels.every(x=>!x.includes('BIOSSEGURANÇA')&&!x.includes('DOSIMETRIA')));
   assert.ok(metrics.buttons.every((r,i,rows)=>!i||r.top>=rows[i-1].bottom),JSON.stringify(metrics));
   assert.ok(metrics.overflow<=1,JSON.stringify({viewport,metrics}));
   assert.ok(metrics.buttons.every(r=>r.top>=0&&r.bottom<=metrics.footer.top&&r.left>=0&&r.right<=viewport.width&&!r.clipped),JSON.stringify({viewport,metrics}));
   assert.ok(metrics.footer.bottom<=viewport.height,JSON.stringify({viewport,metrics}));
  }
 }finally{await browser?.close();await preview.close();}
});
