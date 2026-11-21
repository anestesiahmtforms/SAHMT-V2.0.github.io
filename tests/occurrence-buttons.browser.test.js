import test from 'node:test';import assert from 'node:assert/strict';
import {GRA_001_QUESTIONS,GRA_001_RECORD_ID} from '../src/occurrence-questionnaire.js';
import {createServer} from 'vite';import {chromium,webkit} from 'playwright';
for(const engine of ['edge','webkit'])test(`${engine}: all ten occurrence buttons open; stalled direct categories remain cancellable`,{timeout:70000},async()=>{
 const stubs={
  'occurrence-data.js':`export function createOccurrenceRepository(){return {clear(){},list:async()=>{window.recentReads++;return [{formTitle:'Dilema Ético'}];},listAudit:async()=>{window.auditReads++;return [{formId:'F08',reportId:'synthetic',anonymous:false}];},loadCatalog:async()=>{window.calls++;if(window.hang)return new Promise(resolve=>window.release=()=>resolve({catalogs:{}}));return {catalogs:{}};},
   hospitalAccess:async()=>false,listFollowups:async({formId})=>({entries:formId==='F03'&&window.followupPublished?
    [{id:'gr-1',formId,origin:'hospital',hospitalNumber:'1',title:'Evento externo',occurredOn:'2026-11-20',description:'Relato completo aqui',classification:{},details:{}}]
    :formId==='F08'?[
     {id:'49de5878-28c7-40b5-81e6-f416d58b2433',formId,origin:'app',sequence:1,title:'Enquete de teste',description:'Relato com questionário',classification:{},details:{}},
     {id:'ethical-test',formId,origin:'app',sequence:2,title:'Dilema de teste',description:'Relato do dilema',classification:{},details:{}}
    ]:[],next:null}),
   readAnalysis:async()=>null,listAnalyses:async({id})=>({entries:id==='gr-1'?
     [{analysis:{problem:'Linha um.\\nLinha dois.',cause:'Causa',review:'Revisão',correction:'Correção',plan:'Plano'}}]:[],next:null}),
   descriptionAccess:async()=>window.canEditDescription===true,saveDescription:async(input)=>{window.descriptionEdit=input;return input.description;},
   readOccurrenceQuestionnaire:async({id})=>id===${JSON.stringify(GRA_001_RECORD_ID)}?${JSON.stringify(GRA_001_QUESTIONS)}:window.questionnaires?.[id]??null,
   publishOccurrenceQuestionnaire:async({id,questions})=>{(window.questionnaires??={})[id]=questions;return questions;},
   readOccurrenceResponse:async({id})=>!!window.responses?.[id],
   submitOccurrenceResponse:async input=>{(window.responses??={})[input.id]=input;return 'submitted';},
   readOccurrenceResult:async({id})=>window.pollResult?.id===id?window.pollResult.text:'',
   saveOccurrenceResult:async input=>{window.pollResult=input;return input.text;},
   listOccurrenceResponses:async({id,after})=>after?
     {entries:[{answers:[1,2,3,4],comment:'Segunda resposta.\\nComentário em duas linhas.'}],next:null}:
     {entries:window.responses?.[id]?[window.responses[id]]:[],next:window.exportPollPages?'next':null}};}`,
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
  await followupBanner.getByText('Questionário ainda não publicado.',{exact:true}).waitFor();
  assert.equal(await followupBanner.getByText('CONFIGURAR QUESTIONÁRIO',{exact:true}).count(),0);
  assert.equal(await followupBanner.locator('[data-occurrence-ai-actions] button').count(),0);
  await back.click();
  await page.evaluate(()=>window.canEditDescription=true);
  await page.getByRole('button',{name:'GR 001 · Evento externo'}).click();
  const actionFooter=followupBanner.locator('footer');
  await actionFooter.getByRole('button',{name:'PREPARAR OCORRÊNCIA COM IA'}).click();
  const prep=followupBanner.locator('.occurrence-ai-pane:visible');
  await prep.getByText('Revise o texto antes de copiar.',{exact:true}).waitFor();
  const prepText=await prep.getByRole('textbox',{name:'Prompt para a IA'}).inputValue();
  assert.match(prepText,/"protocolo": "GR 001"[\s\S]*"relato": "Relato completo aqui"/);
  const draft={protocolo:'GR 999',descricao:'Texto revisado',perguntas:Array.from({length:4},(_,index)=>({
   prompt:'Pergunta do Núcleo '+(index+1),options:['Resposta 1','Resposta 2']
  }))};
  const aiResponse=prep.getByRole('textbox',{name:'Resposta da IA em JSON'});
  await aiResponse.fill(JSON.stringify(draft));
  await prep.getByRole('button',{name:'CARREGAR RASCUNHO'}).click();
  await prep.getByText('O protocolo do rascunho deve ser GR 001.',{exact:true}).waitFor();
  await aiResponse.fill(JSON.stringify({...draft,protocolo:'GR 001'}));
  await prep.getByRole('button',{name:'CARREGAR RASCUNHO'}).click();
  await prep.getByText(/Rascunho carregado/).waitFor();
  assert.equal(await page.evaluate(()=>window.descriptionEdit),undefined);
  const editor=followupBanner.getByRole('textbox',{name:'Descrição da ocorrência'});
  assert.equal(await editor.inputValue(),'Texto revisado');
  await followupBanner.getByRole('button',{name:'SALVAR DESCRIÇÃO'}).click();
  await followupBanner.getByText('Descrição atualizada.',{exact:true}).waitFor();
  assert.equal(await followupBanner.locator('[data-occurrence-description]').textContent(),'Texto revisado');
  assert.deepEqual(await page.evaluate(()=>window.descriptionEdit),{
   uid:'synthetic',id:'gr-1',description:'Texto revisado',expectedDescription:'Relato completo aqui'
  });
  await page.evaluate(()=>{
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    write:async items=>{window.copiedPoll=await(await items[0].getType('text/plain')).text();},
    writeText:async text=>{window.copiedPoll=text;}
   }});
  });
  const results=followupBanner.locator('[data-ethical-poll-results]');
  await results.getByText('RESPOSTAS DA ABORDAGEM').click();
  await results.getByRole('button',{name:'COPIAR TODAS AS RESPOSTAS'}).click();
  await results.getByText('Todas as respostas foram copiadas.',{exact:true}).waitFor();
  assert.match(await page.evaluate(()=>window.copiedPoll),/GR 001[\s\S]*ANÁLISE ANTERIOR 1[\s\S]*Linha um\.\nLinha dois\./);
  const config=followupBanner.locator('[data-questionnaire-editor]');
  const scroll=await followupBanner.evaluate(dialog=>{
   const body=dialog.querySelector('[data-followup-body]'),back=dialog.querySelector('[data-followup-back]');
   const before=back.getBoundingClientRect().top;
   body.scrollTop=body.scrollHeight;
   const after=back.getBoundingClientRect().top;
   return {before,after,scrolled:body.scrollTop,outer:dialog.scrollTop};
  });
  assert.ok(scroll.scrolled>0&&scroll.outer===0&&scroll.after===scroll.before,JSON.stringify(scroll));
  for(let index=0;index<4;index++){
   assert.equal(await config.locator('[name=prompt-'+index+']').inputValue(),'Pergunta do Núcleo '+(index+1));
   for(let option=0;option<2;option++){
    assert.equal(await config.locator('[name=option-'+index+'-'+option+']').inputValue(),'Resposta '+(option+1));
   }
  }
  await config.getByRole('button',{name:'PUBLICAR QUESTIONÁRIO'}).click();
  await followupBanner.getByText('Pergunta do Núcleo 1',{exact:true}).waitFor();
  assert.equal(await followupBanner.getByRole('radio').count(),2);
  await back.click();
  await page.evaluate(()=>window.canEditDescription=false);
  await page.getByRole('button',{name:'GR 001 · Evento externo'}).click();
  await followupBanner.getByText('Texto revisado',{exact:true}).waitFor();
  await followupBanner.getByText('Pergunta do Núcleo 1',{exact:true}).waitFor();
  await back.click();
  await back.click();
  await back.click();
  await followup.locator('[data-occurrence-group="B"]').click();
  await followupBanner.getByRole('button',{name:'GRA 002 · Dilema de teste'}).click();
  await followupBanner.getByText('Questionário ainda não publicado.',{exact:true}).waitFor();
  assert.equal(await followupBanner.getByRole('radio').count(),0);
  await back.click();
  const pollRecord=followupBanner.getByRole('button',{name:'GRA 001 · Enquete de teste'});
  await pollRecord.click();
  const poll=followupBanner.locator('[data-ethical-poll]');
  for(const [index,count] of [5,5,4,4].entries()){
   await poll.getByText('PERGUNTA '+(index+1)+' DE 4',{exact:true}).waitFor();
   assert.equal(await poll.getByRole('radio').count(),count);
   if(index===0){
    await poll.getByRole('button',{name:'PRÓXIMA'}).click();
    assert.equal(await poll.getByText('PERGUNTA 1 DE 4',{exact:true}).count(),1);
   }
   await poll.getByRole('radio').last().check();
   if(index<3)await poll.getByRole('button',{name:'PRÓXIMA'}).click();
   else {
    await poll.getByRole('textbox',{name:'Comentário opcional'}).fill('Comentário de teste.');
    await poll.getByRole('button',{name:'ENVIAR RESPOSTA'}).click();
   }
  }
  await poll.getByText('Sua resposta foi registrada.').waitFor();
  const resultButton=followupBanner.getByRole('button',{name:'RESULTADO DA ANÁLISE PELO SERVIÇO'});
  assert.equal(await resultButton.count(),0);
  assert.deepEqual(await page.evaluate(id=>window.responses[id],GRA_001_RECORD_ID),
   {uid:'synthetic',id:GRA_001_RECORD_ID,answers:[5,5,4,4],comment:'Comentário de teste.'});
  assert.equal(await followupBanner.getByText('RESPOSTAS DA ABORDAGEM').count(),0);
  await back.click();
  await page.evaluate(()=>window.canEditDescription=true);
  await pollRecord.click();
  await poll.getByText('Sua resposta foi registrada.').waitFor();
  await results.getByText('RESPOSTAS DA ABORDAGEM').click();
  await results.getByText('Total de respostas: 1',{exact:true}).waitFor();
  await page.evaluate(()=>window.exportPollPages=true);
  await results.getByRole('button',{name:'COPIAR TODAS AS RESPOSTAS'}).click();
  await results.getByText('Todas as respostas foram copiadas.',{exact:true}).waitFor();
  const copied=await page.evaluate(()=>window.copiedPoll);
  assert.match(copied,/Total de respostas: 2/);
  assert.match(copied,/RESPOSTA 1[\s\S]*Outra posição\.[\s\S]*Comentário de teste\./);
  assert.match(copied,/RESPOSTA 2[\s\S]*A condição clínica atual, os riscos e a necessidade de suporte intensivo\.[\s\S]*Segunda resposta\.\nComentário em duas linhas\./);
  assert.doesNotMatch(copied,/synthetic/);
  await actionFooter.getByRole('button',{name:'ANALISAR RESPOSTAS COM IA'}).click();
  const analysis=followupBanner.locator('.occurrence-ai-pane:visible');
  await analysis.getByText('Revise o texto antes de copiar.',{exact:true}).waitFor();
  await analysis.getByRole('button',{name:'COPIAR PROMPT'}).click();
  await analysis.getByText('Prompt copiado.',{exact:true}).waitFor();
  const analysisPrompt=await page.evaluate(()=>window.copiedPoll);
  assert.match(analysisPrompt,/"protocolo": "GRA 001"[\s\S]*CONTAGEM POR ALTERNATIVA[\s\S]*Comentário de teste/);
  await analysis.getByRole('textbox',{name:'Resposta da IA em JSON'}).fill(JSON.stringify({
   protocolo:'GRA 001',resultado:'Primeiro parágrafo.\nSegundo parágrafo.'
  }));
  await analysis.getByRole('button',{name:'CARREGAR RASCUNHO'}).click();
  await analysis.getByText(/Rascunho carregado em Resultado/).waitFor();
  assert.equal(await page.evaluate(()=>window.pollResult),undefined);
  assert.equal(await followupBanner.getByRole('textbox',{name:'Resultado final'}).inputValue(),'Primeiro parágrafo.\nSegundo parágrafo.');
  await followupBanner.getByRole('button',{name:'PUBLICAR RESULTADO'}).click();
  await followupBanner.getByText('Resultado publicado para os participantes.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.pollResult),
   {uid:'synthetic',id:GRA_001_RECORD_ID,text:'Primeiro parágrafo.\nSegundo parágrafo.',expectedText:''});
  await back.click();
  await page.evaluate(()=>window.canEditDescription=false);
  await pollRecord.click();
  await resultButton.click();
  assert.equal(await followupBanner.locator('.occurrence-poll-final-text').textContent(),'Primeiro parágrafo.\nSegundo parágrafo.');
  assert.equal(await followupBanner.getByRole('button',{name:'PUBLICAR RESULTADO'}).count(),0);
  await back.click();
  await back.click();
  await followup.waitFor();
  await back.click();
  await followup.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
