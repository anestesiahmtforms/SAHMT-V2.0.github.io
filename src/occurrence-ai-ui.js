import {occurrenceProtocol} from './occurrence-schema.js';
import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {buildPreparationPrompt,buildAnalysisPrompt,readPreparationDraft,readAnalysisDraft} from './occurrence-ai-prompts.js';
import {OCCURRENCE_IMPROVEMENT_QUESTION} from './occurrence-questionnaire.js';

export function bindOccurrencePromptActions(footer,host,{
  entry,isCurrent,isWriting,setWriting,hasQuestionnaire,readPreparationContext,readResponses,closeResponses,stageDescription,stagePreparation,stageResult
}) {
  const protocol=occurrenceProtocol(entry);
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
      prepare:async()=>buildAnalysisPrompt(entry,await readResponses()),
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
      (key==='analysis'?'<button class="secondary-button" type="button" data-close-responses hidden>ENCERRAR RESPOSTAS DA EQUIPE</button>':'')+
      '<div data-ai-fields><p>Copie o prompt, cole na IA que você usa e traga de volta a resposta em JSON.</p>'+
      '<label class="occurrence-field"><span>Prompt para a IA</span><textarea rows="5"></textarea></label>'+
      '<button class="secondary-button" type="button" data-ai-copy disabled>COPIAR PROMPT</button>'+
      '<form><label class="occurrence-field"><span>Resposta da IA em JSON</span>'+
      '<textarea rows="4" required></textarea></label>'+
      '<button class="primary-button" type="submit">CARREGAR RASCUNHO</button></form></div><p role="status"></p>';
    host.append(pane);
    const heading=pane.querySelector('h4'),prompt=pane.querySelector('textarea');
    const copy=pane.querySelector('[data-ai-copy]'),form=pane.querySelector('form'),status=pane.querySelector('[role="status"]');
    const fields=pane.querySelector('[data-ai-fields]'),close=pane.querySelector('[data-close-responses]');
    let request=0;
    async function open() {
      const version=++request;
      heading.focus();
      copy.disabled=true;
      prompt.value='';
      if(close)close.hidden=true;
      fields.hidden=true;
      if(key==='analysis'&&!entry.responsesClosedAt){
        if(!hasQuestionnaire()){
          status.textContent='Publique a preparação para abrir as respostas da equipe.';
          return;
        }
        close.hidden=false;
        status.textContent='Encerre as respostas quando a equipe tiver concluído a participação.';
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
    close?.addEventListener('click',async()=>{
      if(!isCurrent()||isWriting()||close.disabled)return;
      close.disabled=true;setWriting(true);
      status.textContent='Encerrando respostas da equipe…';
      let closed=false;
      try {closed=await closeResponses();}
      catch {if(isCurrent())status.textContent='Não foi possível encerrar as respostas. Tente novamente.';}
      finally {setWriting(false);close.disabled=false;}
      if(closed&&isCurrent()){
        footer.querySelector('[data-ai-action="preparation"]').disabled=true;
        await open();
      }
    });
    copy.addEventListener('click',async()=>{
      if(!isCurrent()||!prompt.value.trim())return;
      try {
        await navigator.clipboard.writeText(prompt.value);
        if(isCurrent())status.textContent='Prompt copiado.';
      } catch {
        if(!isCurrent())return;
        prompt.focus();prompt.select();
        status.textContent='Texto selecionado. Use a opção Copiar do aparelho.';
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
          status.textContent='Use “'+OCCURRENCE_IMPROVEMENT_QUESTION+'” na última pergunta, com duas ou três alternativas distintas.';
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
}
