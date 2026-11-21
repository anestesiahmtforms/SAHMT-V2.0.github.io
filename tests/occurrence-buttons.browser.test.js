import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'vite';import {chromium,webkit} from 'playwright';
for(const engine of ['edge','webkit'])test(`${engine}: all ten occurrence buttons open; stalled direct categories remain cancellable`,{timeout:70000},async()=>{
 const stubs={
  'occurrence-data.js':`export function createOccurrenceRepository(){return {clear(){},list:async()=>{window.recentReads++;return [{formTitle:'Dilema Ético'}];},listAudit:async()=>{window.auditReads++;return [{formId:'F08',reportId:'synthetic',anonymous:false}];},loadCatalog:async()=>{window.calls++;if(window.hang)return new Promise(resolve=>window.release=()=>resolve({catalogs:{}}));return {catalogs:{}};},
   hospitalAccess:async()=>false,listFollowups:async({formId})=>({entries:formId==='F03'&&window.followupPublished?
    [{id:'gr-1',formId,origin:'hospital',hospitalNumber:'1',title:'Evento externo',occurredOn:'2026-11-20',description:'Relato completo aqui',classification:{},details:{}}]
    :formId==='F08'?[{id:'ethical-test',formId,origin:'app',sequence:1,title:'Dilema de teste',description:'Relato do dilema',classification:{},details:{}}]:[],next:null}),
   readAnalysis:async()=>null,saveAnalysis:async({values})=>{window.analysis=values;return true;},
   descriptionAccess:async()=>window.canEditDescription===true,saveDescription:async(input)=>{window.descriptionEdit=input;return input.description;},
   readEthicalReview:async()=>window.ethicalReview?.text||'',saveEthicalReview:async input=>{window.ethicalReview=input;return input.text;}};}`,
  'outbox.js':`export async function enqueueOccurrenceSubmission(){throw Error('No writes in this fixture');}export async function listUnsettledOperations(){return [];}`
 };
 const fixture=`import {mountOccurrenceModule} from '/src/occurrences-ui.js';window.calls=0;window.recentReads=0;window.auditReads=0;window.hang=false;const uid='synthetic';window.dispose=mountOccurrenceModule(document.querySelector('#root'),{uid,displayName:'Teste',auth:{currentUser:{uid}},db:{},permissions:{occurrencesRead:true,occurrencesWrite:true,occurrencesAuditRead:true},isCurrent:()=>true,followupAllowed:true});`;
 const fixtureMarkup='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<link rel="stylesheet" href="/src/styles.css"><div class="app-shell app-shell--occurrences"><header class="topbar">'+
  '<div class="identity-card"><button class="brand">SAHMT</button><div class="identity-card__user-row"><div class="identity-card__user">Pessoa de teste</div></div>'+
  '<h2 class="events-header-operational occurrences-title">REGISTRO DE OCORRÊNCIAS</h2></div></header>'+
  '<main class="main-content"><section class="module-view panel module-view--occurrences"><div id="root" class="module-content"></div></section></main>'+
  '<footer class="app-footer"><button type="button" class="secondary-button occurrences-home-button">HOME</button><span>SAHMT</span></footer>'+
  '</div><script type="module" src="/fixture.js"></script>';
 const server=await createServer({configFile:false,base:'/',cacheDir:'.local-preview/vite-occurrence-buttons-'+engine,
  plugins:[{name:'isolated-occurrence-buttons',enforce:'pre',load(id){const m=id.replaceAll('\\','/').match(/\/src\/([^/?]+\.js)$/);if(m&&stubs[m[1]])return stubs[m[1]];},configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fixture);}if(req.url!=='/fixture')return next();res.setHeader('Content-Type','text/html');res.end(fixtureMarkup);});}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/.local-preview/**']}}});
 let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+'/fixture');
  await page.getByRole('button',{name:'ACOMPANHAR REGISTROS'}).waitFor();
  assert.equal(await page.getByText(/Auditoria restrita|Registro autenticado/).count(),0);
  assert.equal(await page.evaluate(()=>window.auditReads),0);
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:568,height:320},{width:1440,height:900}]) {
   await page.setViewportSize(viewport);
   const layout=await page.evaluate(()=>{
    const bounds=element=>{const {left,right,top,bottom,width,height}=element.getBoundingClientRect();return {left,right,top,bottom,width,height};};
    const banner=document.querySelector('.app-shell--occurrences'),menu=banner.querySelector('.occurrence-groups');
    return {banner:bounds(banner),menu:bounds(menu),home:bounds(banner.querySelector('.occurrences-home-button')),
     buttons:[...menu.querySelectorAll(':scope > button')].map(bounds)};
   });
   const hint=JSON.stringify({viewport,layout});
   assert.ok(Math.abs((layout.banner.left+layout.banner.right)/2-viewport.width/2)<=1,hint);
   assert.ok(Math.abs((layout.banner.top+layout.banner.bottom)/2-viewport.height/2)<=1,hint);
   assert.equal(layout.buttons.length,5,hint);
   assert.ok(layout.buttons.every(button=>button.height>=44&&button.top>=layout.menu.top&&button.bottom<=layout.home.top),hint);
   assert.ok(layout.home.bottom<=layout.banner.bottom&&layout.home.height>=44,hint);
   assert.ok(layout.banner.width<=672,hint);
  }
  await page.setViewportSize({width:390,height:844});
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
  assert.equal(await page.getByRole('heading',{name:'Registros recentes'}).count(),0);
  assert.equal(await page.evaluate(()=>window.recentReads),0);
  await page.getByRole('button',{name:'ACOMPANHAR REGISTROS'}).click();
  const followup=page.getByRole('dialog',{name:'OCORRÊNCIAS - SAHMT'});
  await followup.waitFor();
  const followupBanner=page.locator('.occurrence-followup[open]');
  const back=followupBanner.locator('[data-followup-back]');
  async function checkFollowupBanner({compact=false}={}) {
   const viewport=page.viewportSize(),frame=await followupBanner.boundingBox(),footer=await back.boundingBox();
   const hint=JSON.stringify({viewport,frame,footer});
   assert.ok(frame.width<=672&&Math.abs(frame.x+frame.width/2-viewport.width/2)<=1,hint);
   assert.ok(Math.abs(frame.y+frame.height/2-viewport.height/2)<=1,hint);
   if(compact)assert.ok(frame.height<viewport.height*.9,hint);
   assert.ok(footer.height>=44&&footer.y+footer.height<=frame.y+frame.height,hint);
  }
  for (const viewport of [{width:320,height:568},{width:568,height:320},{width:1440,height:900}]) {
   await page.setViewportSize(viewport);
   await checkFollowupBanner({compact:true});
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await followup.locator('[data-hospital-new]').count(),0);
  for(const group of ['A','C','D']){
   await followup.locator('[data-occurrence-group="'+group+'"]').click();
   await checkFollowupBanner();
   if(group==='A'){
    await followupBanner.locator('[data-followup-form="F01"]').click();
    await page.getByText('Nenhuma ocorrência registrada neste tema.').waitFor();
    await checkFollowupBanner({compact:true});
    await back.click();
   }
   await back.click();
   await followup.waitFor();
  }
  await followup.locator('[data-occurrence-group="A"]').click();
  await followupBanner.locator('[data-followup-form="F03"]').click();
  await page.getByText('Nenhuma ocorrência registrada neste tema.').waitFor();
  await page.evaluate(()=>window.followupPublished=true);
  await page.getByRole('button',{name:'ATUALIZAR REGISTROS'}).click({timeout:2000});
  await page.getByRole('button',{name:'GR 001 · Evento externo'}).click();
  await page.getByText('Relato completo aqui').waitFor();
  assert.equal(await followupBanner.getByRole('button',{name:'EDITAR DESCRIÇÃO'}).count(),0);
  await checkFollowupBanner();
  const hospitalTitle=page.locator('.occurrence-followup-report .occurrence-hospital-title');
  assert.equal(await hospitalTitle.textContent(),'Evento externo');
  assert.equal(await hospitalTitle.evaluate(element=>getComputedStyle(element).color),'rgb(7, 83, 161)');
  const analysis=page.locator('[data-followup-analysis]');
  const scroll=await page.locator('.occurrence-followup').evaluate(dialog=>{
   const body=dialog.querySelector('[data-followup-body]'),back=dialog.querySelector('[data-followup-back]');
   const before=back.getBoundingClientRect().top;
   body.scrollTop=body.scrollHeight;
   const after=back.getBoundingClientRect().top;
   return {before,after,scrolled:body.scrollTop,outer:dialog.scrollTop};
  });
  assert.ok(scroll.scrolled>0,JSON.stringify(scroll));
  assert.equal(scroll.outer,0);
  assert.equal(scroll.after,scroll.before);
  await analysis.locator('[name=problem]').fill('A');
  assert.equal(await analysis.locator('textarea[required]').count(),5);
  await analysis.getByRole('button',{name:'SALVAR ANÁLISE'}).click();
  assert.equal(await page.evaluate(()=>window.analysis),undefined);
  for(const key of ['cause','review','correction','plan']) await analysis.locator('[name='+key+']').fill(key);
  await analysis.getByRole('button',{name:'SALVAR ANÁLISE'}).click();
  await page.getByText('Análise salva.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.analysis),{problem:'A',cause:'cause',review:'review',correction:'correction',plan:'plan'});
  await back.click();
  await page.evaluate(()=>window.canEditDescription=true);
  await page.getByRole('button',{name:'GR 001 · Evento externo'}).click();
  await followupBanner.getByRole('button',{name:'EDITAR DESCRIÇÃO'}).click();
  const editor=followupBanner.getByRole('textbox',{name:'Descrição da ocorrência'});
  assert.equal(await editor.inputValue(),'Relato completo aqui');
  await editor.fill('Texto revisado');
  await followupBanner.getByRole('button',{name:'SALVAR DESCRIÇÃO'}).click();
  await followupBanner.getByText('Descrição atualizada.',{exact:true}).waitFor();
  assert.equal(await followupBanner.locator('[data-occurrence-description]').textContent(),'Texto revisado');
  assert.deepEqual(await page.evaluate(()=>window.descriptionEdit),{
   uid:'synthetic',id:'gr-1',description:'Texto revisado',expectedDescription:'Relato completo aqui'
  });
  await back.click();
  await page.getByRole('button',{name:'GR 001 · Evento externo'}).click();
  await followupBanner.getByText('Texto revisado',{exact:true}).waitFor();
  await back.click();
  await back.click();
  await back.click();
  await followup.waitFor();
  await page.evaluate(()=>window.canEditDescription=false);
  await followup.locator('[data-occurrence-group="B"]').click();
  const ethicalRecord=followupBanner.getByRole('button',{name:'GRA 001 · Dilema de teste'});
  await ethicalRecord.click();
  await followupBanner.getByText('Relato do dilema',{exact:true}).waitFor();
  assert.equal(await followupBanner.locator('textarea').count(),0);
  await back.click();
  await page.evaluate(()=>window.canEditDescription=true);
  await ethicalRecord.click();
  const approach=followupBanner.getByRole('textbox',{name:'ABORDAGEM',exact:true});
  await approach.fill('Primeira linha\nSegunda linha');
  assert.equal(await followupBanner.locator('[data-followup-analysis],input[type="file"]').count(),0);
  await followupBanner.getByRole('button',{name:'SALVAR ABORDAGEM'}).click();
  await followupBanner.getByText('Abordagem salva.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.ethicalReview),{uid:'synthetic',id:'ethical-test',text:'Primeira linha\nSegunda linha',expectedText:''});
  await back.click();
  await ethicalRecord.click();
  await approach.waitFor();
  await followupBanner.getByText('Carregando abordagem…',{exact:true}).waitFor({state:'hidden'});
  assert.equal(await approach.inputValue(),'Primeira linha\nSegunda linha');
  await back.click();
  await back.click();
  await followup.waitFor();
  await back.click();
  await followup.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
