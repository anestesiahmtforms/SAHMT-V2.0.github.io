import test from 'node:test';import assert from 'node:assert/strict';
import {GRA_001_QUESTIONS,GRA_001_RECORD_ID} from '../src/occurrence-questionnaire.js';
import {createServer} from 'vite';import {chromium,webkit} from 'playwright';
for(const engine of ['edge','webkit'])test(`${engine}: all ten occurrence buttons open; stalled direct categories remain cancellable`,{timeout:70000},async()=>{
 const stubs={
  'occurrence-data.js':`export function createOccurrenceRepository(){return {clear(){},list:async()=>{window.recentReads++;return [{formTitle:'Dilema Ético'}];},listAudit:async()=>{window.auditReads++;return [{formId:'F08',reportId:'synthetic',anonymous:false}];},loadCatalog:async()=>{window.calls++;if(window.hang)return new Promise(resolve=>window.release=()=>resolve({catalogs:{}}));return {catalogs:{}};},
   listFollowups:async({after,origin})=>after?{entries:origin==='app'?[
      {id:'49de5878-28c7-40b5-81e6-f416d58b2433',formId:'F08',origin:'app',sequence:1,title:'Enquete de teste',
      description:'Relato com questionário',classification:{},details:{},analysisStarted:true,responsesClosedAt:window.closedReplies?.['49de5878-28c7-40b5-81e6-f416d58b2433'],analysisClosed:!!window.pollResult,eventClosed:!!window.eventClosed},
      {id:'ethical-test',formId:'F08',origin:'app',sequence:2,title:'Dilema de teste',
      description:'Relato do dilema',classification:{},details:{},analysisClosed:!!window.closedOther,eventClosed:!!window.closedOther}
    ]:[],next:null}:{entries:origin==='hospital'&&window.followupPublished?
    [{id:'gr-1',formId:'F03',origin:'hospital',hospitalNumber:'1',title:'Evento externo',
      occurredOn:'2026-11-20',description:'Relato completo aqui',preparedDescription:window.preparations?.['gr-1'],classification:{},details:{},analysisStarted:!!window.questionnaires?.['gr-1'],responsesClosedAt:window.closedReplies?.['gr-1']}]
    :[],next:'next'},
   readAnalysis:async()=>null,listAnalyses:async({id})=>({entries:id==='gr-1'?
     [{analysis:{problem:'Linha um.\\nLinha dois.',cause:'Causa',review:'Revisão',correction:'Correção',plan:'Plano'}}]:[],next:null}),
   descriptionAccess:async()=>window.canEditDescription===true,saveDescription:async(input)=>{window.descriptionEdit=input;return input.description;},
   readOccurrenceQuestionnaire:async({id})=>id===${JSON.stringify(GRA_001_RECORD_ID)}?${JSON.stringify(GRA_001_QUESTIONS)}:window.questionnaires?.[id]??null,
   publishOccurrenceQuestionnaire:async({id,description,questions})=>{
     (window.preparations??={})[id]=description;(window.questionnaires??={})[id]=questions;return questions;
   },
   closeOccurrenceResponses:async({id})=>{(window.closedReplies??={})[id]=true;},
   readOccurrenceResponse:async({id})=>!!window.responses?.[id],
   submitOccurrenceResponse:async input=>{(window.responses??={})[input.id]=input;return 'submitted';},
   readOccurrenceResult:async({id})=>window.pollResult?.id===id?{text:window.pollResult.text,updatedAt:window.resultGeneration}:null,
   readOccurrenceAcknowledgement:async({id,resultAt})=>window.acknowledgement?.id===id&&window.acknowledgement.resultAt===resultAt,
   acknowledgeOccurrence:async input=>{window.acknowledgement=input;},
   finalizeOccurrence:async input=>{window.finalized=input;window.eventClosed=true;},
   saveOccurrenceResult:async input=>{window.pollResult=input;window.resultGeneration=(window.resultGeneration??0)+1;return input.text;},
   listOccurrenceResponses:async({id,after})=>after?
     {entries:[{answers:[1,2,3,4],comment:'Segunda resposta.\\nComentário em duas linhas.'}],next:null}:
     {entries:window.responses?.[id]?[window.responses[id]]:[],next:window.exportPollPages?'next':null}};}`,
  'outbox.js':`export async function enqueueOccurrenceSubmission(){throw Error('No writes in this fixture');}export async function listUnsettledOperations(){return [];}`
 };
 const fixture=`import {mountOccurrenceModule} from '/src/occurrences-ui.js';window.calls=0;window.recentReads=0;window.auditReads=0;window.hang=false;const uid='synthetic';window.dispose=mountOccurrenceModule(document.querySelector('#root'),{uid,displayName:'Teste',auth:{currentUser:{uid}},db:{},permissions:{occurrencesRead:true,occurrencesWrite:true,occurrencesAuditRead:true},isCurrent:()=>true,followupAllowed:true});`;
 const fixtureMarkup='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<link rel="stylesheet" href="/src/styles.css"><div class="app-shell app-shell--occurrences"><header class="topbar">'+
  '<div class="identity-card"><button class="brand">SAHMT</button><div class="identity-card__user-row"><div class="identity-card__user">Pessoa de teste</div></div>'+
  '<h2 class="events-header-operational occurrences-title">REGISTRO DE OCORRÊNCIAS -SAHMT</h2></div></header>'+
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
  await page.getByRole('button',{name:'ANÁLISE DE OCORRÊNCIAS - SAHMT'}).waitFor();
  assert.equal(await page.getByText(/Auditoria restrita|Registro autenticado/).count(),0);
  assert.equal(await page.evaluate(()=>window.auditReads),0);
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:568,height:320},{width:1440,height:900}]) {
   await page.setViewportSize(viewport);
   const layout=await page.evaluate(()=>{
    const bounds=element=>{const {left,right,top,bottom,width,height}=element.getBoundingClientRect();return {left,right,top,bottom,width,height};};
    const banner=document.querySelector('.app-shell--occurrences'),menu=banner.querySelector('.occurrence-menu');
    const registration=menu.querySelector('.occurrence-groups'),analysis=menu.querySelector('.occurrence-analysis-menu');
    const title=banner.querySelector('.occurrences-title');
    const analysisTitle=analysis.querySelector('.occurrence-analysis-title');
    const titleText=document.createRange();
    titleText.selectNodeContents(title);
    const titleRect=titleText.getBoundingClientRect();
    return {banner:bounds(banner),menu:bounds(menu),home:bounds(banner.querySelector('.occurrences-home-button')),
     title:bounds(title),titleText:{left:titleRect.left,right:titleRect.right,lines:titleText.getClientRects().length},
     registration:bounds(registration),analysis:bounds(analysis),
     titleBackground:getComputedStyle(title).backgroundImage,analysisTitleBackground:getComputedStyle(analysisTitle).backgroundImage,
     registrationButtons:[...registration.querySelectorAll(':scope > button')].map(bounds),
     analysisButtons:[...analysis.querySelectorAll(':scope > button')].map(bounds)};
   });
   const hint=JSON.stringify({viewport,layout});
   assert.ok(Math.abs((layout.banner.left+layout.banner.right)/2-viewport.width/2)<=1,hint);
   assert.ok(Math.abs((layout.banner.top+layout.banner.bottom)/2-viewport.height/2)<=1,hint);
   assert.equal(layout.titleText.lines,1,hint);
   assert.equal(layout.analysisTitleBackground,layout.titleBackground,hint);
   assert.ok(layout.titleText.left>=layout.title.left&&layout.titleText.right<=layout.title.right,hint);
   assert.equal(layout.registrationButtons.length,4,hint);
   assert.equal(layout.analysisButtons.length,2,hint);
   assert.ok(layout.registration.bottom<layout.analysis.top||layout.registration.right<layout.analysis.left,hint);
   assert.ok([...layout.registrationButtons,...layout.analysisButtons].every(
    button=>button.height>=44&&button.top>=layout.menu.top&&button.bottom<=layout.home.top),hint);
   assert.ok(layout.analysisButtons[0].bottom<=layout.analysisButtons[1].top,hint);
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
   assert.equal(await page.getByText('A identidade é mantida para auditoria restrita.').count(),0);
   if(id==='F10'){
    assert.equal(await page.getByRole('heading',{name:'NÃO CONFORMIDADE DE PROCESSO',exact:true}).count(),1);
    assert.equal(await page.getByRole('textbox',{name:'Atendimento',exact:true}).count(),1);
   }
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
  const appLaunch=page.getByRole('button',{name:'ANÁLISE DE OCORRÊNCIAS - SAHMT'});
  const hospitalLaunch=page.getByRole('button',{name:'ANÁLISE DE OCORRÊNCIAS - NSP'});
  await appLaunch.locator('xpath=self::*[@data-analysis-state="pending"]').waitFor();
  await appLaunch.click();
  const followup=page.getByRole('dialog',{name:'OCORRÊNCIAS - SAHMT'});
  const hospitalFollowup=page.getByRole('dialog',{name:'OCORRÊNCIAS - NÚCLEO DE SEGURANÇA'});
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
   await checkFollowupBanner();
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await followup.locator('[data-occurrence-group]').count(),4);
  assert.equal(await followup.getByRole('button',{name:'OCORRÊNCIAS - NÚCLEO DE SEGURANÇA'}).count(),0);
  const appEthics=followup.locator('[data-occurrence-group="B"]');
  await appEthics.locator('xpath=self::*[@data-analysis-state="pending"]').waitFor();
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
  await back.click();
  await hospitalLaunch.click();
  await hospitalFollowup.waitFor();
  await checkFollowupBanner({compact:true});
  assert.equal(await hospitalFollowup.locator('[data-occurrence-group]').count(),4);
  assert.equal(await hospitalFollowup.getByRole('button',{name:'NOVO RELATO DO NÚCLEO'}).count(),0);
  const hospitalCare=hospitalFollowup.locator('[data-occurrence-group="A"]');
  await hospitalCare.locator('xpath=self::*[@data-analysis-state="clear"]').waitFor();
  await hospitalCare.click();
  await followupBanner.locator('[data-followup-form="F03"]').click();
  await page.getByText('Nenhuma ocorrência registrada neste tema.').waitFor();
  await page.evaluate(()=>window.followupPublished=true);
  await page.getByRole('button',{name:'ATUALIZAR REGISTROS'}).click({timeout:2000});
  const grRecord=page.getByRole('button',{name:'GR 001 · Evento externo'});
  await grRecord.locator('xpath=self::*[@data-analysis-state="preparing"][@disabled]').waitFor();
  await page.evaluate(()=>window.canEditDescription=true);
  await page.getByRole('button',{name:'ATUALIZAR REGISTROS'}).click();
  await grRecord.click();
  await page.getByText('Relato completo aqui').waitFor();
  await checkFollowupBanner();
  const hospitalTitle=page.locator('.occurrence-followup-report .occurrence-hospital-title');
  assert.equal(await hospitalTitle.textContent(),'Evento externo');
  assert.equal(await hospitalTitle.evaluate(element=>getComputedStyle(element).color),'rgb(7, 83, 161)');
  const actionFooter=followupBanner.locator('footer');
  await actionFooter.getByRole('button',{name:'PREPARAR OCORRÊNCIA'}).click();
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
  const editor=followupBanner.getByRole('textbox',{name:'Descrição para análise da equipe'});
  assert.equal(await editor.inputValue(),'Texto revisado');
  assert.equal(await followupBanner.locator('[data-occurrence-description]').textContent(),'Relato completo aqui');
  assert.equal(await page.evaluate(()=>window.preparations),undefined);
  await page.evaluate(()=>{
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    write:async items=>{window.copiedPoll=await(await items[0].getType('text/plain')).text();},
    writeText:async text=>{window.copiedPoll=text;}
   }});
  });
  const analyzeButton=actionFooter.getByRole('button',{name:'ANALISAR RESPOSTAS'});
  await analyzeButton.click();
  const analysis=followupBanner.locator('.occurrence-ai-pane:visible');
  await analysis.getByText('Publique a preparação para abrir as respostas da equipe.',{exact:true}).waitFor();
  assert.equal(await analysis.getByRole('button',{name:'ENCERRAR RESPOSTAS DA EQUIPE'}).isVisible(),false);
  await analyzeButton.click();
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
  await config.getByRole('button',{name:'PUBLICAR OCORRÊNCIA E QUESTIONÁRIO'}).click();
  await followupBanner.getByText('Pergunta do Núcleo 1',{exact:true}).waitFor();
  assert.equal(await followupBanner.getByRole('radio').count(),2);
  assert.equal(await followupBanner.locator('[data-occurrence-description]').textContent(),'Texto revisado');
  assert.equal(await page.evaluate(()=>window.preparations['gr-1']),'Texto revisado');
  await analyzeButton.click();
  const closeReplies=analysis.getByRole('button',{name:'ENCERRAR RESPOSTAS DA EQUIPE'});
  await closeReplies.waitFor();
  assert.equal(await analysis.getByRole('textbox',{name:'Prompt para a IA'}).count(),0);
  await closeReplies.click();
  await analysis.getByText('Revise o texto antes de copiar.',{exact:true}).waitFor();
  const archivePrompt=await analysis.getByRole('textbox',{name:'Prompt para a IA'}).inputValue();
  assert.match(archivePrompt,/GR 001[\s\S]*"relato": "Texto revisado"[\s\S]*ANÁLISE ANTERIOR 1[\s\S]*Linha um\.\nLinha dois\./);
  await back.click();
  await page.evaluate(()=>window.canEditDescription=false);
  await page.getByRole('button',{name:'GR 001 · Evento externo'}).click();
  await followupBanner.getByText('Texto revisado',{exact:true}).waitFor();
  await followupBanner.getByText('Respostas da equipe encerradas.',{exact:true}).waitFor();
  assert.equal(await followupBanner.getByRole('radio').count(),0);
  await back.click();
  await back.click();
  await back.click();
  await hospitalCare.locator('xpath=self::*[@data-analysis-state="pending"]').waitFor();
  await back.click();
  await appLaunch.click();
  await appEthics.click();
  await followupBanner.getByRole('button',{name:'GRA 002 · Dilema de teste'})
    .locator('xpath=self::*[@data-analysis-state="preparing"][@disabled]').waitFor();
  const pollRecord=followupBanner.getByRole('button',{name:'GRA 001 · Enquete de teste'});
  await pollRecord.locator('xpath=self::*[@data-analysis-state="open"]').waitFor();
  assert.match(await pollRecord.evaluate(element=>getComputedStyle(element).backgroundImage),/249, 218, 134/);
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
  await page.getByRole('button',{name:'ATUALIZAR REGISTROS'}).click();
  await pollRecord.click();
  await poll.getByText('Sua resposta foi registrada.').waitFor();
  assert.equal(await followupBanner.getByText('RESPOSTAS DA ABORDAGEM',{exact:true}).count(),0);
  assert.equal(await resultButton.count(),0);
  await page.evaluate(()=>window.exportPollPages=true);
  await analyzeButton.click();
  await closeReplies.click();
  await analysis.getByText('Revise o texto antes de copiar.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(id=>window.closedReplies[id],GRA_001_RECORD_ID),true);
  await analysis.getByRole('button',{name:'COPIAR PROMPT'}).click();
  await analysis.getByText('Prompt copiado.',{exact:true}).waitFor();
  const analysisPrompt=await page.evaluate(()=>window.copiedPoll);
  assert.match(analysisPrompt,/"protocolo": "GRA 001"[\s\S]*CONTAGEM POR ALTERNATIVA[\s\S]*Comentário de teste/);
  assert.match(analysisPrompt,/Total de respostas: 2/);
  assert.match(analysisPrompt,/RESPOSTA 1[\s\S]*Outra posição\.[\s\S]*Comentário de teste\./);
  assert.match(analysisPrompt,/RESPOSTA 2[\s\S]*A condição clínica atual, os riscos e a necessidade de suporte intensivo\.[\s\S]*Segunda resposta\.\nComentário em duas linhas\./);
  assert.doesNotMatch(analysisPrompt,/synthetic/);
  await analysis.getByRole('textbox',{name:'Resposta da IA em JSON'}).fill(JSON.stringify({
   protocolo:'GRA 001',resultado:'Primeiro parágrafo.\nSegundo parágrafo.'
  }));
  await analysis.getByRole('button',{name:'CARREGAR RASCUNHO'}).click();
  await analysis.getByText(/Rascunho carregado em Resultado/).waitFor();
  assert.equal(await page.evaluate(()=>window.pollResult),undefined);
  assert.equal(await followupBanner.getByRole('textbox',{name:'Resultado final'}).inputValue(),'Primeiro parágrafo.\nSegundo parágrafo.');
  await followupBanner.getByRole('button',{name:'PUBLICAR RESULTADO'}).click();
  await followupBanner.getByText('Resultado publicado. A equipe já pode registrar ciência.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.pollResult),
   {uid:'synthetic',id:GRA_001_RECORD_ID,text:'Primeiro parágrafo.\nSegundo parágrafo.',expectedText:''});
  await back.click();
  await page.evaluate(()=>window.canEditDescription=false);
  await page.getByRole('button',{name:'ATUALIZAR REGISTROS'}).click();
  await pollRecord.locator('xpath=self::*[@data-analysis-state="published"]').waitFor();
  await pollRecord.click();
  await followupBanner.locator('.occurrence-poll-final-text').waitFor();
  assert.equal(await resultButton.count(),0);
  assert.equal(await followupBanner.locator('.occurrence-poll-final-text').textContent(),'Primeiro parágrafo.\nSegundo parágrafo.');
  const ack=followupBanner.getByRole('button',{name:'CIÊNCIA',exact:true});
  await ack.click();
  await followupBanner.getByRole('button',{name:'CIÊNCIA REGISTRADA',exact:true}).locator('xpath=self::*[@disabled]').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.acknowledgement),{uid:'synthetic',id:GRA_001_RECORD_ID,resultAt:1});
  assert.equal(await followupBanner.getByRole('button',{name:'FINALIZAR EVENTO'}).count(),0);
  assert.equal(await followupBanner.getByRole('button',{name:'EDITAR ANÁLISE FINAL'}).count(),0);
  assert.equal(await followupBanner.getByRole('button',{name:'PUBLICAR RESULTADO'}).count(),0);
  await back.click();
  await page.evaluate(()=>window.canEditDescription=true);
  await page.getByRole('button',{name:'ATUALIZAR REGISTROS'}).click();
  await pollRecord.click();
  await followupBanner.getByRole('button',{name:'EDITAR ANÁLISE FINAL'}).click();
  await followupBanner.getByRole('textbox',{name:'Resultado final'}).fill('Resultado revisado.');
  await followupBanner.getByRole('button',{name:'PUBLICAR RESULTADO'}).click();
  await followupBanner.getByText('Resultado revisado.',{exact:true}).waitFor();
  await followupBanner.getByRole('button',{name:'FINALIZAR EVENTO'}).click();
  await followupBanner.getByText('Evento finalizado.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.finalized),{uid:'synthetic',id:GRA_001_RECORD_ID,resultAt:2});
  await back.click();
  await pollRecord.locator('xpath=self::*[@data-analysis-state="finalized"]').waitFor();
  await back.click();
  await followup.waitFor();
  await appEthics.locator('xpath=self::*[@data-analysis-state="pending"]').waitFor();
  await appEthics.click();
  await page.evaluate(()=>window.closedOther=true);
  await page.getByRole('button',{name:'ATUALIZAR REGISTROS'}).click();
  await followupBanner.getByRole('button',{name:'GRA 002 · Dilema de teste'})
    .locator('xpath=self::*[@data-analysis-state="finalized"]').waitFor();
  await back.click();
  await appEthics.locator('xpath=self::*[@data-analysis-state="clear"]').waitFor();
  await back.click();
  await followup.waitFor({state:'hidden'});
  await hospitalLaunch.click();
  await hospitalCare.locator('xpath=self::*[@data-analysis-state="pending"]').waitFor();
  await back.click();
  await hospitalFollowup.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
