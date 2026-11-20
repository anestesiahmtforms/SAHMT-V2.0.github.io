import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'vite';import {chromium,webkit} from 'playwright';
for(const engine of ['edge','webkit'])test(`${engine}: all ten occurrence buttons open; stalled direct categories remain cancellable`,{timeout:70000},async()=>{
 const stubs={
  'occurrence-data.js':`export function createOccurrenceRepository(){return {clear(){},list:async()=>[],listAudit:async()=>[],loadCatalog:async()=>{window.calls++;if(window.hang)return new Promise(resolve=>window.release=()=>resolve({catalogs:{}}));return {catalogs:{}};},
   hospitalAccess:async()=>false,listFollowups:async({formId})=>({entries:formId==='F08'?[{id:'gr-1',formId,origin:'hospital',hospitalNumber:'1',title:'Evento externo',occurredOn:'2026-11-20',description:'Relato completo aqui',classification:{},details:{}}]:[],next:null}),
   readAnalysis:async()=>null,saveAnalysis:async({values})=>{window.analysis=values;return true;}};}`,
  'outbox.js':`export async function enqueueOccurrenceSubmission(){throw Error('No writes in this fixture');}export async function listUnsettledOperations(){return [];}`
 };
 const fixture=`import {mountOccurrenceModule} from '/src/occurrences-ui.js';window.calls=0;window.hang=false;const uid='synthetic';window.dispose=mountOccurrenceModule(document.querySelector('#root'),{uid,displayName:'Teste',auth:{currentUser:{uid}},db:{},permissions:{occurrencesWrite:true},isCurrent:()=>true,followupAllowed:true});`;
 const server=await createServer({configFile:false,base:'/',cacheDir:'.local-preview/vite-occurrence-buttons-'+engine,
  plugins:[{name:'isolated-occurrence-buttons',enforce:'pre',load(id){const m=id.replaceAll('\\','/').match(/\/src\/([^/?]+\.js)$/);if(m&&stubs[m[1]])return stubs[m[1]];},configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fixture);}if(req.url!=='/fixture')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><div id="root"></div><script type="module" src="/fixture.js"></script>');});}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/.local-preview/**']}}});
 let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+'/fixture');
  for(let i=1;i<=10;i++){
   const group=i<=7?'A':i===8?'B':i===9?'C':'D',id='F'+String(i).padStart(2,'0');
   await page.locator(`.occurrence-groups [data-occurrence-group="${group}"]`).click();
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
  await page.getByRole('button',{name:'ACOMPANHAR REGISTROS'}).click();
  const followup=page.getByRole('dialog',{name:'OCORRÊNCIAS - SAHMT'});
  await followup.waitFor();
  assert.equal(await followup.locator('[data-hospital-new]').count(),0);
  await followup.locator('[data-occurrence-group="B"]').click();
  await page.getByRole('button',{name:'GR 001 · Evento externo'}).click();
  await page.getByText('Relato completo aqui').waitFor();
  const hospitalTitle=page.locator('.occurrence-followup-report .occurrence-hospital-title');
  assert.equal(await hospitalTitle.textContent(),'Evento externo');
  assert.equal(await hospitalTitle.evaluate(element=>getComputedStyle(element).color),'rgb(7, 83, 161)');
  const analysis=page.locator('[data-followup-analysis]');
  await analysis.locator('[name=problem]').fill('A');
  assert.equal(await analysis.locator('textarea[required]').count(),5);
  await analysis.getByRole('button',{name:'SALVAR ANÁLISE'}).click();
  assert.equal(await page.evaluate(()=>window.analysis),undefined);
  for(const key of ['cause','review','correction','plan']) await analysis.locator('[name='+key+']').fill(key);
  await analysis.getByRole('button',{name:'SALVAR ANÁLISE'}).click();
  await page.getByText('Análise salva.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.analysis),{problem:'A',cause:'cause',review:'review',correction:'correction',plan:'plan'});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
