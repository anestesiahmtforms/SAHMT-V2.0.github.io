import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {createYearEndStartupPreview} from './helpers/year-end-startup-preview.js';
const safari=process.env.SAHMT_BROWSER_ENGINE==='webkit',engine=safari?webkit:chromium;

test('Home keeps search last and shows every tile without clipping or scrolling',async()=>{
 const preview=await createYearEndStartupPreview({homeModulesEnabled:true});let browser;
 try{
  browser=await engine.launch({headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const account of ['team','mode-owner']){
   await page.setViewportSize({width:390,height:844});
   await page.goto(preview.url+'?account='+account);
   await page.locator('.app-shell--home [data-route="schedule"]').waitFor();
   await page.locator('.startup-logo').waitFor({state:'detached'});
   const search=page.getByRole('button',{name:/BUSCAR NO ECOSISTEMA/});
   await search.waitFor();assert.equal(await search.isDisabled(),true);
   assert.equal(await page.locator('.module-grid .module-card').count(),5);
   assert.equal(await page.locator('.module-grid .module-card:last-child strong').textContent(),'BUSCAR NO ECOSISTEMA');
   assert.match(await search.locator('img').getAttribute('src'),/home-search\.svg$/);
   assert.equal(await search.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),true);
   assert.ok(await page.locator('.home-welcome').evaluate(element=>parseFloat(getComputedStyle(element).borderTopWidth)>=2));
   for(const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:430,height:932},{width:568,height:320},{width:844,height:390},{width:1366,height:900}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(70);
    const result=await page.evaluate(()=>{
     const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
     const main=document.querySelector('.app-shell--home .main-content'),grid=document.querySelector('.module-grid');
     return {width:innerWidth,height:innerHeight,document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],main:[main.clientHeight,main.scrollHeight],grid:rect(grid),blocks:['.home-logo-stage','.home-identity-topbar .identity-card','.home-welcome','.app-footer>span'].map(selector=>rect(document.querySelector(selector))),cards:[...grid.children].map(el=>({rect:rect(el),title:rect(el.querySelector('strong')),label:el.querySelector('strong').textContent,titleLineHeight:parseFloat(getComputedStyle(el.querySelector('strong')).lineHeight),titleOverflow:el.querySelector('strong').scrollWidth-el.querySelector('strong').clientWidth,subtitleOverflow:el.querySelector('small').scrollWidth-el.querySelector('small').clientWidth,overflowX:el.scrollWidth-el.clientWidth,overflowY:el.scrollHeight-el.clientHeight}))};
    });
    const hint=JSON.stringify({account,viewport,result});
    assert.ok(result.document[0]<=viewport.width+1&&result.document[1]<=viewport.height+1,hint);
    assert.ok(result.main[1]<=result.main[0]+1,hint);
    for(let i=0;i<result.blocks.length;i++){
     const block=result.blocks[i];assert.ok(block.top>=-1&&block.bottom<=viewport.height+1,hint);
     if(i)assert.ok(result.blocks[i-1].bottom<=block.top+1,hint);
    }
    for(const card of result.cards){
     assert.ok(card.rect.height>=44&&card.rect.top>=-1&&card.rect.bottom<=viewport.height+1,hint);
     assert.ok(card.rect.left>=-1&&card.rect.right<=viewport.width+1,hint);
     assert.ok(card.overflowX<=1&&card.overflowY<=1,hint);
     assert.ok(card.title.height<=card.titleLineHeight+1&&card.titleOverflow<=1&&card.subtitleOverflow<=1,hint);
     assert.ok(card.title.left>=card.rect.left&&card.title.right<=card.rect.right,hint);
    }
   }
  }
  assert.deepEqual(errors,[]);
  await mkdir('.local-preview',{recursive:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local-preview/home-search-'+engine.name()+'.png'});
 }finally{await browser?.close();await preview.close();}
});
