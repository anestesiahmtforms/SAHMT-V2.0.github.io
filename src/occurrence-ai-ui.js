import {occurrenceProtocol} from './occurrence-schema.js';
import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {buildPreparationPrompt,buildAnalysisPrompt,readPreparationDraft,readAnalysisDraft} from './occurrence-ai-prompts.js';

const shortcutUrl='shortcuts://run-shortcut?name='+encodeURIComponent('SAHMT Ocorrências')+'&input=clipboard';

function draftErrorMessage(error,{formId,protocol,fallback='Confira se o JSON retornado segue o formato solicitado no prompt.'}){
  switch(error.message){
    case 'OCCURRENCE_IMPROVEMENT_VOTE_INVALID':return 'Use duas ou três ações distintas na última pergunta.';
    case 'OCCURRENCE_PREPARATION_QUESTION_COUNT_INVALID':return formId==='F08'?'Inclua as quatro perguntas do roteiro IDEA.'
      :'Inclua de cinco a dez perguntas, contando a votação final.';
    case 'OCCURRENCE_ANALYSIS_DATE_INVALID':return 'Confira o prazo sugerido. Use uma data válida ou deixe o campo vazio.';
    case 'OCCURRENCE_DRAFT_PROTOCOL':return 'O protocolo do rascunho deve ser '+protocol+'.';
    default:return fallback;
  }
}

function openSahmtPreparation(host,{mode,isCurrent,isWriting,formId,protocol}){
  const dialog=document.createElement('dialog');
  dialog.className='occurrence-preparation-dialog';
  dialog.setAttribute('aria-label','Preparar ocorrência');
  dialog.innerHTML='<button class="primary-button" type="button">EXECUTAR NO CHATGPT</button>'+
    '<p role="status"></p>';
  host.append(dialog);
  const button=dialog.querySelector('button'),status=dialog.querySelector('[role="status"]');
  const current=()=>isCurrent()&&dialog.open;
  let prompt='',launched=false;
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.addEventListener('cancel',event=>{if(isWriting())event.preventDefault();});
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog||isWriting())return;
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
  });
  async function prepare(){
    button.disabled=true;
    status.textContent='';
    try{prompt=await mode.prepare();}catch{
      if(current())status.textContent='Não foi possível preparar a ocorrência. Toque no botão para tentar novamente.';
    }finally{if(current())button.disabled=false;}
  }
  button.addEventListener('click',async()=>{
    if(!current()||isWriting()||button.disabled)return;
    if(!prompt){void prepare();return;}
    button.disabled=true;
    status.textContent='';
    try{
      if(!launched){
        try{await navigator.clipboard.writeText(prompt);}catch{
          if(current())status.textContent='Não foi possível acessar a área de transferência. Toque para tentar novamente.';
          return;
        }
        if(!current())return;
        launched=true;
        button.textContent='IMPORTAR RESPOSTA DO IPHONE';
        try{window.location.assign(shortcutUrl);}catch{
          status.textContent='Abra SAHMT Ocorrências no app Atalhos e volte para importar.';
        }
        return;
      }
      let text;
      try{text=await navigator.clipboard.readText();}catch{
        if(current())status.textContent='Permita a colagem no iPhone e toque no botão novamente.';
        return;
      }
      if(!current())return;
      if(!text.trim()||text.trim()===prompt.trim()){
        status.textContent='A resposta ainda não chegou. Se o atalho não abriu, execute SAHMT Ocorrências no app Atalhos.';
        return;
      }
      if(!await mode.stage(text,dialog)&&current())status.textContent='Não foi possível abrir a pré-análise. Tente novamente.';
    }catch(error){
      if(current())status.textContent=draftErrorMessage(error,{formId,protocol,fallback:'A resposta não segue o formato esperado.'});
    }finally{if(current()&&button.isConnected)button.disabled=false;}
  });
  dialog.showModal();
  void prepare();
  return dialog;
}

export function bindOccurrencePromptActions(footer,host,{
  entry,original=entry,isCurrent,isWriting,hasQuestionnaire,readPreparationContext,readResponses,stageDescription,stagePreparation,stageResult
}) {
  const protocol=occurrenceProtocol(entry);
  const sahmt=entry.origin==='app';
  const promptEntry=()=>({...original,...entry});
  const modes={
    preparation:{
      label:'PREPARAR OCORRÊNCIA',
      prepare:async()=>buildPreparationPrompt(promptEntry(),hasQuestionnaire(),await readPreparationContext()),
      async stage(text,target) {
        const draft=readPreparationDraft(text,protocol,hasQuestionnaire(),entry.formId);
        return draft.questions ? stagePreparation(draft,target) : stageDescription(draft.description);
      },
      success:'Rascunho carregado. Revise a preparação antes de publicar.'
    },
    analysis:{
      label:sahmt?'ANÁLISE FINAL':'ANALISAR RESPOSTAS',
      async prepare() {
        const [responses,context]=await Promise.all([readResponses(),readPreparationContext(true)]);
        return buildAnalysisPrompt(promptEntry(),responses,context);
      },
      stage:text=>stageResult(readAnalysisDraft(text,protocol)),
      success:'Rascunho carregado em Resultado da análise pelo serviço. Revise antes de publicar.'
    }
  };
  footer.innerHTML=Object.entries(modes).map(([key,{label}])=>
    '<button type="button" class="secondary-button" data-ai-action="'+key+'" '+
    (sahmt&&key==='preparation'?'aria-haspopup="dialog"':'aria-expanded="false"')+'>'+label+'</button>'
  ).join('');
  footer.hidden=false;
  const actions=[...footer.querySelectorAll('button')];
  const preparation=footer.querySelector('[data-ai-action="preparation"]');
  const analysis=footer.querySelector('[data-ai-action="analysis"]');
  function updateActions(){
    preparation.disabled=!!entry.responsesClosedAt;
    if(sahmt){
      preparation.hidden=entry.analysisStarted===true;
      analysis.hidden=!hasQuestionnaire();
      analysis.disabled=!entry.responsesClosedAt;
    }
  }
  updateActions();
  let preparationDialog;
  if(sahmt)preparation.addEventListener('click',()=>{
    if(!isCurrent()||isWriting()||preparationDialog?.open)return;
    preparationDialog=openSahmtPreparation(host,{mode:modes.preparation,isCurrent,isWriting,formId:entry.formId,protocol});
  });
  const panes=new Map();
  for(const [key,mode] of Object.entries(modes)) {
    if(sahmt&&key==='preparation')continue;
    const pane=document.createElement('section');
    pane.className='occurrence-followup-analysis occurrence-ai-pane';
    pane.hidden=true;
    pane.innerHTML='<h4 tabindex="-1">'+escape(mode.label)+'</h4>'+
      '<div data-ai-fields><p>Revise o prompt antes de executar no ChatGPT.</p>'+
      '<label class="occurrence-field"><span>Prompt para a IA</span><textarea rows="5"></textarea></label>'+
      '<button class="primary-button" type="button" data-ai-iphone>EXECUTAR NO CHATGPT</button>'+
        '<a class="secondary-button" data-ai-shortcut href="'+shortcutUrl+'" hidden>ABRIR ATALHOS</a>'+
        '<details><summary>Configurar o atalho</summary><p>No app Atalhos, crie “SAHMT Ocorrências” com “Obter Área de Transferência”, '+
        '“Usar Modelo” com a extensão ChatGPT, e “Copiar para a Área de Transferência” usando a resposta do modelo.</p></details>'+
      '<button class="secondary-button" type="button" data-ai-copy disabled>COPIAR PROMPT</button>'+
      '<form><label class="occurrence-field"><span>Resposta da IA em JSON</span>'+
      '<textarea rows="4" required></textarea></label>'+
      '<button class="primary-button" type="submit">CARREGAR RASCUNHO</button></form></div><p role="status"></p>';
    host.append(pane);
    const heading=pane.querySelector('h4'),prompt=pane.querySelector('textarea');
    const copy=pane.querySelector('[data-ai-copy]'),form=pane.querySelector('form'),status=pane.querySelector('[role="status"]');
    const fields=pane.querySelector('[data-ai-fields]'),shortcut=pane.querySelector('[data-ai-shortcut]');
    const chatgpt=pane.querySelector('[data-ai-iphone]');
    let sentPrompt='';
    let request=0;
    async function open() {
      const version=++request;
      heading.focus();
      copy.disabled=true;
      prompt.value='';
      sentPrompt='';
      chatgpt.disabled=false;
      chatgpt.textContent='EXECUTAR NO CHATGPT';
      shortcut.hidden=true;
      fields.hidden=true;
      if(key==='analysis'&&!entry.responsesClosedAt){
        if(!hasQuestionnaire()){
          status.textContent='Publique a preparação para abrir as respostas da equipe.';
          return;
        }
        status.textContent=sahmt?'Finalize a pré-análise para abrir a análise final.'
          :'Use Encerrar interação na página de respostas para iniciar a análise.';
        return;
      }
      status.textContent='Preparando prompt…';
      try {
        const text=await mode.prepare();
        if(!isCurrent()||request!==version)return;
        prompt.value=text;
        fields.hidden=false;
        copy.disabled=false;
        status.textContent='Revise o texto antes de copiar.';
      } catch(error) {
        if(!isCurrent()||request!==version)return;
        status.textContent='Não foi possível preparar o prompt. Reabra esta ação para tentar novamente.';
      }
    }
    panes.set(key,{pane,open});
    async function copyPrompt(){
      if(!isCurrent()||!prompt.value.trim())return false;
      try {
        await navigator.clipboard.writeText(prompt.value);
        if(!isCurrent())return false;
        status.textContent='Prompt copiado.';
        return true;
      } catch {
        if(!isCurrent())return false;
        prompt.focus();prompt.select();
        status.textContent='Texto selecionado. Use a opção Copiar do aparelho.';
        return false;
      }
    }
    copy.addEventListener('click',()=>void copyPrompt());
    chatgpt.addEventListener('click',async()=>{
      if(!isCurrent()||isWriting()||!prompt.value.trim())return;
      const version=request;
      chatgpt.disabled=true;
      try {
        if(sentPrompt){
          await importResponse(version);
          return;
        }
        const text=prompt.value.trim();
        const copied=await copyPrompt();
        if(!isCurrent()||pane.hidden||request!==version)return;
        sentPrompt=text;
        chatgpt.textContent='IMPORTAR RESPOSTA DO IPHONE';
        shortcut.hidden=false;
        if(!copied){
          status.textContent='Copie o prompt selecionado e toque em Abrir Atalhos.';
          return;
        }
        status.textContent='Ao terminar o atalho, volte e toque em Importar resposta do iPhone.';
        try {window.location.assign(shortcutUrl);} catch {/* O link permanece disponível. */}
      } finally {
        if(request===version)chatgpt.disabled=false;
      }
    });
    async function importResponse(version){
      const input=form.querySelector('textarea');
      try {
        const text=await navigator.clipboard.readText();
        if(!isCurrent()||pane.hidden||request!==version)return;
        if(!text.trim()||text.trim()===sentPrompt){
          status.textContent='A resposta ainda não chegou. Execute o atalho e aguarde terminar.';
          return;
        }
        input.value=text;
        form.requestSubmit();
      } catch {
        if(!isCurrent()||pane.hidden||request!==version)return;
        input.focus();
        status.textContent='Cole a resposta no campo e toque em Carregar rascunho.';
      }
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!isCurrent()||isWriting()||(key==='analysis'&&!entry.responsesClosedAt))return;
      const button=form.querySelector('button');
      if(button.disabled)return;
      button.disabled=true;
      try {
        if(await mode.stage(form.querySelector('textarea').value)) {
          if(isCurrent())status.textContent=mode.success;
        } else if(isCurrent())status.textContent='Não foi possível abrir o editor. Tente novamente.';
      } catch(error) {
        if(!isCurrent())return;
        status.textContent=draftErrorMessage(error,{formId:entry.formId,protocol});
      } finally {button.disabled=false;}
    });
  }
  const inlineActions=actions.filter(button=>panes.has(button.dataset.aiAction));
  for(const action of inlineActions)action.addEventListener('click',()=>{
    if(!isCurrent()||isWriting())return;
    const selected=panes.get(action.dataset.aiAction);
    const opening=selected.pane.hidden;
    for(const button of inlineActions)button.setAttribute('aria-expanded',String(opening&&button===action));
    for(const pane of panes.values())pane.pane.hidden=!opening||pane!==selected;
    if(opening)void selected.open();
  });
  return ()=>{
    updateActions();
    if(preparationDialog?.open)preparationDialog.close();
    for(const button of inlineActions)button.setAttribute('aria-expanded','false');
    for(const {pane} of panes.values())pane.hidden=true;
  };
}
