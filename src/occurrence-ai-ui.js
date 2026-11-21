import {occurrenceProtocol} from './occurrence-schema.js';
import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {buildPreparationPrompt,buildAnalysisPrompt,readPreparationDraft,readAnalysisDraft} from './occurrence-ai-prompts.js';

export function bindOccurrencePromptActions(footer,host,{
  entry,isCurrent,isWriting,hasQuestionnaire,readResponses,stageDescription,stageQuestions,stageResult
}) {
  const protocol=occurrenceProtocol(entry);
  const modes={
    preparation:{
      label:'PREPARAR OCORRÊNCIA COM IA',
      prepare:()=>buildPreparationPrompt(entry,hasQuestionnaire()),
      async stage(text) {
        const draft=readPreparationDraft(text,protocol,hasQuestionnaire());
        if(draft.questions)stageQuestions(draft.questions);
        stageDescription(draft.description);
        return true;
      },
      success:'Rascunho carregado. Revise a descrição e, se houver perguntas novas, revise o questionário antes de publicar.'
    },
    analysis:{
      label:'ANALISAR RESPOSTAS COM IA',
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
  const panes=new Map();
  for(const [key,mode] of Object.entries(modes)) {
    const pane=document.createElement('section');
    pane.className='occurrence-followup-analysis occurrence-ai-pane';
    pane.hidden=true;
    pane.innerHTML='<h4 tabindex="-1">'+escape(mode.label)+'</h4>'+
      '<p>Copie o prompt, cole na IA que você usa e traga de volta a resposta em JSON.</p>'+
      '<label class="occurrence-field"><span>Prompt para a IA</span><textarea rows="5"></textarea></label>'+
      '<button class="secondary-button" type="button" data-ai-copy disabled>COPIAR PROMPT</button>'+
      '<form><label class="occurrence-field"><span>Resposta da IA em JSON</span>'+
      '<textarea rows="4" required></textarea></label>'+
      '<button class="primary-button" type="submit">CARREGAR RASCUNHO</button></form><p role="status"></p>';
    host.append(pane);
    const heading=pane.querySelector('h4'),prompt=pane.querySelector('textarea');
    const copy=pane.querySelector('[data-ai-copy]'),form=pane.querySelector('form'),status=pane.querySelector('[role="status"]');
    let request=0;
    panes.set(key,{pane,async open() {
      const version=++request;
      heading.focus();
      copy.disabled=true;
      prompt.value='';
      status.textContent='Preparando prompt…';
      try {
        const text=await mode.prepare();
        if(!isCurrent()||request!==version)return;
        prompt.value=text;
        copy.disabled=false;
        status.textContent='Revise o texto antes de copiar.';
      } catch(error) {
        if(!isCurrent()||request!==version)return;
        status.textContent=error.message==='OCCURRENCE_POLL_EMPTY'
          ?'Ainda não há respostas para analisar.'
          :'Não foi possível preparar o prompt. Reabra esta ação para tentar novamente.';
      }
    }});
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
      if(!isCurrent()||isWriting())return;
      const button=form.querySelector('button');
      if(button.disabled)return;
      button.disabled=true;
      try {
        if(await mode.stage(form.querySelector('textarea').value)) {
          if(isCurrent())status.textContent=mode.success;
        } else if(isCurrent())status.textContent='Não foi possível abrir o editor. Tente novamente.';
      } catch(error) {
        if(!isCurrent())return;
        status.textContent=error.message==='OCCURRENCE_DRAFT_PROTOCOL'
          ?'O protocolo do rascunho deve ser '+protocol+'.'
          :'Confira se o JSON retornado segue o formato solicitado no prompt.';
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
