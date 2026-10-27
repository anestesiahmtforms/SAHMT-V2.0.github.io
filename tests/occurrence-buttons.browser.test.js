import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'vite';import {chromium,webkit} from 'playwright';
for(const engine of ['edge','webkit'])test(`${engine}: all ten occurrence buttons open; stalled direct categories remain cancellable`,{timeout:70000},async()=>{
 const stubs={
  'occurrence-data.js':`export function createOccurrenceRepository(){return {clear(){},list:async()=>[],listAudit:async()=>[],loadCatalog:async()=>{window.calls++;if(window.hang)return new Promise(resolve=>window.release=()=>resolve({catalogs:{}}));return {catalogs:{}};}};}`,
  'outbox.js':`export async function enqueueOccurrenceSubmission(){throw Error('No writes in this fixture');}export async function listUnsettledOperations(){return [];}`
 };
 const fixture=`import {mountOccurrenceModule} from '/src/occurrences-ui.js';window.calls=0;window.hang=false;const uid='synthetic';window.dispose=mountOccurrenceModule(document.querySelector('#root'),{uid,displayName:'Teste',auth:{currentUser:{uid}},db:{},permissions:{occurrencesWrite:true},isCurrent:()=>true});`;
 const server=await createServer({configFile:false,base:'/',cacheDir:'.local-preview/vite-occurrence-buttons-'+engine,
  plugins:[{name:'isolated-occurrence-buttons',enforce:'pre',load(id){const m=id.replaceAll('\\','/').match(/\/src\/([^/?]+\.js)$/);if(m&&stubs[m[1]])return stubs[m[1]];},configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fixture);}if(req.url!=='/fixture')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/fixture.js"></script>');});}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/.local-preview/**']}}});
 let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+'/fixture');
  for(let i=1;i<=10;i++){
   const group=i<=7?'A':i===8?'B':i===9?'C':'D',id='F'+String(i).padStart(2,'0');
   await page.locator(`[data-occurrence-group="${group}"]`).click();
   if(group==='A')await page.locator(`[data-occurrence-form="${id}"]`).click();
   await page.locator('[data-occurrence-dialog-host] dialog[open]').waitFor();
   assert.ok(await page.locator('[data-occurrence-dialog-host] input, [data-occurrence-dialog-host] textarea').count());
   await page.locator('[data-occurrence-cancel]').click();
   if(group==='A')await page.locator('[data-occurrence-group-cancel]').click();
  }
  await page.evaluate(()=>window.hang=true);await page.locator('[data-occurrence-group="B"]').click();
  await page.getByText('Carregando opções do formulário…',{exact:true}).waitFor();
  await page.locator('[data-occurrence-group-cancel]').click({timeout:1500});assert.equal(await page.locator('dialog[open]').count(),0);
  await page.evaluate(()=>window.hang=false);await page.locator('[data-occurrence-group="C"]').click();await page.locator('[data-occurrence-dialog-host] dialog[open]').waitFor();
  await page.evaluate(()=>window.release());assert.equal(await page.locator('[data-occurrence-dialog-host] dialog[open]').count(),1);
  await page.locator('[data-occurrence-cancel]').click();
  await page.evaluate(()=>window.hang=true);await page.locator('[data-occurrence-group="D"]').click();
  await page.getByText(/O catálogo não respondeu no prazo/).waitFor({timeout:12000});
  await page.evaluate(()=>window.hang=false);await page.locator('[data-occurrence-form="F10"]').click();await page.locator('[data-occurrence-dialog-host] dialog[open]').waitFor();
  await page.locator('[data-occurrence-cancel]').click();await page.locator('[data-occurrence-group-cancel]').click();
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
