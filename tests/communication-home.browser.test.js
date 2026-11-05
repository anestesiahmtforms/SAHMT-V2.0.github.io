import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {chromium} from 'playwright';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const main=read('src/main.js'),shell=main.slice(main.indexOf('function shellView() {'),main.indexOf('async function loadHome()')).replaceAll('import.meta.env.BASE_URL',"'/SAHMT-V2.0.github.io/'");
test('actual Home shell keeps the notification request compact and all module buttons visible on iPhone',async()=>{
 const ctx=vm.createContext({currentRoute:()=> 'home',session:{status:'signed-in',accountMode:'administrator',user:{displayName:'Pessoa de teste'},profile:{displayName:'Pessoa de teste'}},labels:{},can:()=>false,APP_VERSION:'TEST',escapeHtml:String,notice:'',communicationFeatureEnabled:true,communicationDevicePushActive:()=>false,forwardingButton:()=>'<a class="comm-forward">Encaminhar</a>',moduleCards:()=>['Operacional','Etiquetas','Governança','Checklist'].map(x=>`<button class="module-card"><span>${x}</span></button>`).join('')});
 vm.runInContext(shell+'\nglobalThis.markup=shellView();',ctx);
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.emulateMedia({reducedMotion:'reduce'});for(const [width,height]of [[320,568],[390,844],[430,932]]){
  await page.setViewportSize({width,height});await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+read('src/styles.css')+read('src/communication.css')+'</style>'+ctx.markup);
  assert.equal(await page.locator('.main-content > .comm-forward').count(),0);
  const banner=await page.locator('.comm-home-banner').boundingBox();assert.ok(banner.height<120,JSON.stringify({width,height,banner}));
  const schedule=await page.locator('.schedule-card').boundingBox();assert.ok(schedule.y<height/2,'no giant spacer above schedule');
  for(const b of await page.locator('.module-card,.comm-home-banner button').all()){if(height<=650)await b.scrollIntoViewIfNeeded();const box=await b.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=height,JSON.stringify({width,height,box,banner,schedule}));}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }}finally{await browser.close();}
});
