import {occurrenceProtocol} from './occurrence-schema.js';
import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {buildPreparationPrompt,buildAnalysisPrompt,readPreparationDraft,readAnalysisDraft} from './occurrence-ai-prompts.js';

const shortcutUrl='shortcuts://run-shortcut?name='+encodeURIComponent('SAHMT Ocorrências')+'&input=clipboard';

export function bindOccurrencePromptActions(footer,host,{
  entry,isCurrent,isWriting,hasQuestionnaire,readPreparationContext,readResponses,stageDescription,stagePreparation,stageResult
}) {
  const protocol=occurrenceProtocol(entry);
  const iphone=/iPhone/i.test(navigator.userAgent);
  const modes={
    preparation:{
      label:'PREPARAR OCORRÊNCIA',
      prepare:async()=>buildPreparationPrompt(entry,hasQuestionnaire(),await readPreparationContext()),
      async stage(text) {
        const draft=readPreparationDraft(text,protocol,hasQuestionnaire(),entry.formId);
        return draft.questions ? stagePreparation(draft) : stageDescription(draft.description);
      },
      success:'Rascunho carregado. Revise a preparação antes de publicar.'
    },
    analysis:{
      label:'ANALISAR RESPOSTAS',
      async prepare() {
        const [responses,context]=await Promise.all([readResponses(),readPreparationContext(true)]);
        return buildAnalysisPrompt(entry,responses,context);
      },
      stage:text=>stageResult(readAnalysisDraft(text,protocol)),
      success:'Rascunho carregado em Resultado da análise pelo serviço. Revise antes de publicar.'
    }
  };
  footer.innerHTML=Object.entries(modes).map(([key,{label}])=>
    '<button type="button" class="secondary-button" data-ai-action="'+key+'" aria-expanded="false">'+label+'</button>'
  ).join('');
  footer.hidden=false;
  const actions=[...footer.querySelectorAll('button')];
  if(entry.responsesClosedAt)footer.querySelector('[data-ai-action="preparation"]').disabled=true;
  const panes=new Map();
  for(const [key,mode] of Object.entries(modes)) {
    const pane=document.createElement('section');
    pane.className='occurrence-followup-analysis occurrence-ai-pane';
    pane.hidden=true;
    pane.innerHTML='<h4 tabindex="-1">'+escape(mode.label)+'</h4>'+
      '<div data-ai-fields><p>'+(iphone?'Revise o prompt antes de executar no ChatGPT.':'Copie o prompt, cole na IA que você usa e traga de volta a resposta em JSON.')+'</p>'+
      '<label class="occurrence-field"><span>Prompt para a IA</span><textarea rows="5"></textarea></label>'+
      (iphone?'<button class="primary-button" type="button" data-ai-iphone>EXECUTAR NO CHATGPT</button>'+
        '<a class="secondary-button" data-ai-shortcut href="'+shortcutUrl+'" hidden>ABRIR ATALHOS</a>'+
        '<button class="secondary-button" type="button" data-ai-import>IMPORTAR RESPOSTA DO IPHONE</button>'+
        '<details><summary>Configurar o atalho</summary><p>No app Atalhos, crie “SAHMT Ocorrências” com “Obter Área de Transferência”, '+
        '“Usar Modelo” com a extensão ChatGPT, e “Copiar para a Área de Transferência” usando a resposta do modelo.</p></details>':'')+
      '<button class="secondary-button" type="button" data-ai-copy disabled>COPIAR PROMPT</button>'+
      '<form><label class="occurrence-field"><span>Resposta da IA em JSON</span>'+
      '<textarea rows="4" required></textarea></label>'+
      '<button class="primary-button" type="submit">CARREGAR RASCUNHO</button></form></div><p role="status"></p>';
    host.append(pane);
    const heading=pane.querySelector('h4'),prompt=pane.querySelector('textarea');
    const copy=pane.querySelector('[data-ai-copy]'),form=pane.querySelector('form'),status=pane.querySelector('[role="status"]');
    const fields=pane.querySelector('[data-ai-fields]'),shortcut=pane.querySelector('[data-ai-shortcut]');
    let request=0;
    async function open() {
      const version=++request;
      heading.focus();
      copy.disabled=true;
      prompt.value='';
      if(shortcut)shortcut.hidden=true;
      fields.hidden=true;
      if(key==='analysis'&&!entry.responsesClosedAt){
        if(!hasQuestionnaire()){
          status.textContent='Publique a preparação para abrir as respostas da equipe.';
          return;
        }
        status.textContent='Use Encerrar interação na página de respostas para iniciar a análise.';
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
    pane.querySelector('[data-ai-iphone]')?.addEventListener('click',async()=>{
      if(!await copyPrompt())return;
      shortcut.hidden=false;
      status.textContent='Quando o atalho terminar, volte ao SAHMT e toque em Importar resposta do iPhone.';
      try {window.location.assign(shortcutUrl);} catch {/* O link Abrir Atalhos permanece disponível. */}
    });
    pane.querySelector('[data-ai-import]')?.addEventListener('click',async()=>{
      if(!isCurrent()||isWriting())return;
      const input=form.querySelector('textarea');
      try {
        const text=await navigator.clipboard.readText();
        if(!isCurrent()||pane.hidden)return;
        input.value=text;
        if(!text.trim()){status.textContent='A área de transferência está vazia.';return;}
        form.requestSubmit();
      } catch {
        if(!isCurrent()||pane.hidden)return;
        input.focus();
        status.textContent='Cole a resposta no campo e toque em Carregar rascunho.';
      }
    });
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
        if(error.message==='OCCURRENCE_IMPROVEMENT_VOTE_INVALID') {
          status.textContent='Use duas ou três ações distintas na última pergunta.';
        } else if(error.message==='OCCURRENCE_PREPARATION_QUESTION_COUNT_INVALID') {
          status.textContent=entry.formId==='F08'?'Inclua as quatro perguntas do roteiro IDEA.'
            :'Inclua de cinco a dez perguntas, contando a votação final.';
        } else if(error.message==='OCCURRENCE_ANALYSIS_DATE_INVALID') {
          status.textContent='Confira o prazo sugerido. Use uma data válida ou deixe o campo vazio.';
        } else {
          status.textContent=error.message==='OCCURRENCE_DRAFT_PROTOCOL'
            ?'O protocolo do rascunho deve ser '+protocol+'.'
            :'Confira se o JSON retornado segue o formato solicitado no prompt.';
        }
      } finally {button.disabled=false;}
    });
  }
  for(const action of actions)action.addEventListener('click',()=>{
    if(!isCurrent()||isWriting())return;
    const selected=panes.get(action.dataset.aiAction);
    const opening=selected.pane.hidden;
    for(const button of actions)button.setAttribute('aria-expanded',String(opening&&button===action));
    for(const pane of panes.values())pane.pane.hidden=!opening||pane!==selected;
    if(opening)void selected.open();
  });
  return ()=>{
    footer.querySelector('[data-ai-action="preparation"]').disabled=true;
    for(const button of actions)button.setAttribute('aria-expanded','false');
    for(const {pane} of panes.values())pane.hidden=true;
  };
}
