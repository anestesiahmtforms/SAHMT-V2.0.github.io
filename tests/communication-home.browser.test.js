import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {chromium} from 'playwright';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const main=read('src/main.js'),shell=main.slice(main.indexOf('function shellView() {'),main.indexOf('async function loadHome()')).replaceAll('import.meta.env.BASE_URL',"'/SAHMT-V2.0.github.io/'");
test('Home keeps full-width entries separated and auxiliary actions reachable',async()=>{
 const ctx=vm.createContext({currentRoute:()=> 'home',session:{status:'signed-in',accountMode:'administrator',user:{displayName:'Pessoa de teste'},profile:{displayName:'Pessoa de teste',active:true,access:true}},labels:{checklist:['Checklist',''],labels:['Etiquetas',''],management:['Governança','']},can:()=>false,canUseGovernanceHub:()=>true,canUseVacationModule:()=>true,canUseYearEndSchedule:()=>true,fgChecklistEnabled:true,fhLabelsEnabled:true,appFeatures:{},featureEnabledForRoute:()=>true,APP_VERSION:'TEST',escapeHtml:String,notice:'',communicationFeatureEnabled:true});
 const cards=main.slice(main.indexOf('function moduleCards() {'),main.indexOf('function hasOccurrencePermission()')).replaceAll('import.meta.env.BASE_URL',"'/SAHMT-V2.0.github.io/'");
 vm.runInContext(cards+shell+'\nglobalThis.markup=shellView();',ctx);
 ctx.markup=ctx.markup.replace(/src="\/SAHMT-V2.0.github.io\/([^\"]+)"/g,(_,path)=>`src="data:${path.endsWith('.svg')?'image/svg+xml':'image/png'};base64,${readFileSync(new URL('../public/'+path,import.meta.url)).toString('base64')}"`);
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.emulateMedia({reducedMotion:'reduce'});for(const [width,height]of [[320,568],[390,844],[430,932],[844,390],[1280,900]]){
  await page.setViewportSize({width,height});await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+read('src/styles.css')+read('src/communication.css')+'</style>'+ctx.markup);
  assert.equal(await page.locator('.main-content > .comm-forward').count(),0);
  assert.equal(await page.locator('.schedule-card,.home-header-scale').count(),0);
  assert.deepEqual(await page.locator('.module-card').evaluateAll(bs=>bs.map(b=>b.dataset.route)),['checklist','schedule','labels','management-hub']);
  const boxes=await page.locator('.module-card').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return {y:r.y,width:r.width,height:r.height};}));
  for(let i=0;i<boxes.length;i++){assert.equal(boxes[i].width,boxes[0].width);assert.ok(boxes[i].height>=44);if(i)assert.ok(boxes[i].y-boxes[i-1].y-boxes[i-1].height>=16);}
  for(const b of await page.locator('.module-card,.comm-home-banner button').all()){await b.scrollIntoViewIfNeeded();const box=await b.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=height,JSON.stringify({width,height,box}));}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('.module-card').first().scrollIntoViewIfNeeded();
  if(process.env.HOME_PREVIEW_PATH&&width===390)await page.screenshot({path:process.env.HOME_PREVIEW_PATH});
 }}finally{await browser.close();}
});
