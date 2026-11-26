import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {formatDisplayDate} from './date-format.js';
import {OCCURRENCE_ANALYSIS_ATTENDANCE_MARKER} from './occurrence-ai-prompts.js';
import {OCCURRENCE_COMMENT_LIMIT,OCCURRENCE_OPTION_LIMIT,OCCURRENCE_PROMPT_LIMIT,
  OCCURRENCE_OPTION_TEXT_LIMIT,OCCURRENCE_IMPROVEMENT_OPTION_LIMIT,
  normalizeOccurrencePreparationQuestions,withOccurrenceImprovementActions} from './occurrence-questionnaire.js';
import {OCCURRENCE_ETHICAL_REVIEW_LIMIT} from './occurrence-schema.js';
import {showOccurrenceConfirmation} from './occurrence-confirmation.js';

function mountOccurrenceResponse(section,{repository,uid,id,questions,isCurrent,canInteract,isWriting,setWriting,questionnaireRevision}) {
  const total=questions.length;
  const answers=Array(total).fill(0);
  let step=0,comment='';
  section.innerHTML='<h4>ABORDAGEM</h4><div data-ethical-poll-content></div><p role="status" data-ethical-poll-status></p>';
  const content=section.querySelector('[data-ethical-poll-content]');
  const status=section.querySelector('[data-ethical-poll-status]');
  function confirmed() {
    content.replaceChildren();
    status.textContent='Sua resposta foi registrada.';
  }
  async function load() {
    content.replaceChildren();
    status.textContent='Carregando questionário…';
    try {
      const submitted=await repository.readOccurrenceResponse({uid,id});
      if (!isCurrent()) return;
      if (submitted) confirmed();
      else if (canInteract()) showStep(false);
      else status.textContent='O envio de respostas está indisponível neste momento.';
    } catch {
      if (!isCurrent()) return;
      status.textContent='Não foi possível consultar o questionário.';
      content.innerHTML='<button type="button" class="secondary-button">TENTAR NOVAMENTE</button>';
      content.querySelector('button').addEventListener('click',()=>void load());
    }
  }
  function showStep(focus=true) {
    const {prompt,options}=questions[step];
    const last=step===total-1;
    status.textContent='';
    content.innerHTML='<form><fieldset class="occurrence-poll-question"><legend tabindex="-1"><small>PERGUNTA '+(step+1)+' DE '+total+
      '</small><strong>'+escape(prompt)+'</strong></legend>'+
      options.map((text,index)=>'<label class="occurrence-poll-option"><input type="radio" name="answer" value="'+(index+1)+'" required '+
        (answers[step]===index+1?'checked':'')+'><span>'+escape(text)+'</span></label>').join('')+
      (last?'<label class="occurrence-field"><span>Opiniões e propostas (opcional)</span><textarea name="comment" rows="3" maxlength="'+OCCURRENCE_COMMENT_LIMIT+'">'+
        escape(comment)+'</textarea></label>':'')+
      '<div class="occurrence-poll-actions">'+(step?'<button type="button" class="secondary-button" data-poll-previous>ANTERIOR</button>':'')+
      '<button type="submit" class="primary-button">'+(last?'ENVIAR RESPOSTA':'PRÓXIMA')+'</button></div></fieldset></form>';
    const form=content.querySelector('form'),controls=form.querySelector('fieldset');
    if (focus) form.querySelector('legend').focus();
    form.addEventListener('input',()=>{
      answers[step]=Number(form.elements.answer.value);
      if (last) comment=form.elements.comment.value;
    });
    form.querySelector('[data-poll-previous]')?.addEventListener('click',()=>{
      if (!isCurrent()||isWriting()) return;
      step--;
      showStep();
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (!isCurrent()||isWriting()) return;
      if (!canInteract()) {status.textContent='O envio de respostas está indisponível neste momento.';return;}
      answers[step]=Number(form.elements.answer.value);
      if (!last){step++;showStep();return;}
      comment=form.elements.comment.value;
      setWriting(true);
      controls.disabled=true;
      status.textContent='Enviando resposta…';
      try {
        await repository.submitOccurrenceResponse({uid,id,answers:[...answers],comment,questionnaireRevision});
        if(isCurrent())confirmed();
      } catch(error) {
        if(isCurrent())status.textContent=error.message==='OCCURRENCE_INTERACTION_CHANGED'
          ?'A página mudou. Reabra a ocorrência para responder à versão atual.'
          :'Não foi possível confirmar a resposta. Tente novamente.';
      } finally {
        setWriting(false);
        if(isCurrent())controls.disabled=false;
      }
    });
  }
  void load();
}

async function readOccurrenceResponses({repository,uid,id,questions,isCurrent}) {
  async function readAll(list) {
    const entries=[];
    let cursor=null;
    do {
      const page=await list({uid,id,after:cursor});
      if(!isCurrent())throw new Error('OCCURRENCE_SESSION_CHANGED');
      entries.push(...page.entries);
      cursor=page.next;
    } while(cursor);
    return entries;
  }
  const [entries,legacy]=await Promise.all([
    questions.length?readAll(repository.listOccurrenceResponses):[],
    readAll(repository.listAnalyses)
  ]);
  return {questions,entries,legacy};
}

function bindOccurrenceResult(panel,{
  repository,uid,id,entry,isCurrent,canEdit,isWriting,setWriting,onResultPublished,onEventFinalized,
  resultActions,confirmationHost,onResultDraft,onAcknowledged
}) {
  panel.innerHTML='<div data-poll-result-body></div><p role="status"></p>';
  const body=panel.querySelector('[data-poll-result-body]'),status=panel.querySelector('[role="status"]');
  const safetyAnalysis=entry.formId!=='F08';
  const sahmt=entry.origin==='app';
  let published=null,workingDraft=null,loading=false;

  async function run(button,progress,action) {
    if(!isCurrent()||isWriting()||button.disabled)return;
    setWriting(true);button.disabled=true;status.textContent=progress;
    try {await action();}
    catch(error) {
      if(isCurrent())status.textContent=['OCCURRENCE_ETHICAL_REVIEW_CHANGED','OCCURRENCE_RESULT_CHANGED'].includes(error.message)
        ?'O resultado mudou. Volte e abra novamente para consultar a versão atual.'
        :'Não foi possível confirmar esta ação. Tente novamente.';
    } finally {setWriting(false);if(isCurrent())button.disabled=false;}
  }

  const preview=({text,dueDate})=>'<p class="occurrence-poll-final-text">'+escape(text)+'</p>'+
    (dueDate?'<p><strong>Prazo da ação de melhoria</strong> <time datetime="'+escape(dueDate)+'">'+
      escape(formatDisplayDate(dueDate))+'</time></p>':'');

  function renderPublished() {
    body.innerHTML='<h4>RESULTADO DA ANÁLISE PELO SERVIÇO</h4>'+preview(published)+
      '<div class="occurrence-result-actions"><button type="button" class="primary-button" disabled data-occurrence-ack>'+
      (sahmt?'DAR CIÊNCIA':'CIÊNCIA')+'</button>'+
      (!sahmt&&canEdit&&!entry.eventClosed?
        '<button type="button" class="secondary-button" data-occurrence-result-edit>EDITAR ANÁLISE FINAL</button>'+
        '<button type="button" class="secondary-button" data-occurrence-finalize>FINALIZAR ANÁLISE</button>':'')+'</div>';
    const ack=body.querySelector('[data-occurrence-ack]');
    if(sahmt){
      resultActions.replaceChildren(ack);
      resultActions.hidden=false;
    }
    const resultAt=published.updatedAt;
    function showAcknowledged() {
      ack.textContent='CIÊNCIA REGISTRADA';
      ack.disabled=true;
    }
    void repository.readOccurrenceAcknowledgement({uid,id,resultAt}).then(acknowledged=>{
      if(!isCurrent()||!ack.isConnected)return;
      if(acknowledged){showAcknowledged();onAcknowledged?.();}
      else ack.disabled=false;
    }).catch(()=>{if(isCurrent()&&ack.isConnected)ack.disabled=false;});
    ack.addEventListener('click',async()=>{
      let confirmed=false;
      await run(ack,'Registrando ciência…',async()=>{
        await repository.acknowledgeOccurrence({uid,id,resultAt});
        if(isCurrent()){confirmed=true;status.textContent='Ciência registrada.';}
      });
      if(confirmed&&isCurrent()){
        showAcknowledged();
        onAcknowledged?.();
        if(sahmt)showOccurrenceConfirmation(confirmationHost,'VOCÊ ESTÁ CIENTE!');
      }
    });
    body.querySelector('[data-occurrence-result-edit]')?.addEventListener('click',()=>{if(!isWriting())renderEditor(published);});
    const finalize=body.querySelector('[data-occurrence-finalize]');
    finalize?.addEventListener('click',()=>void run(finalize,'Finalizando evento…',async()=>{
      await repository.finalizeOccurrence({uid,id,resultAt});
      if(!isCurrent())return;
      entry.eventClosed=true;
      onEventFinalized?.();
      renderPublished();
      status.textContent='Evento finalizado.';
    }));
  }

  function renderSahmtDraft() {
    panel.hidden=false;
    body.innerHTML='<h4 tabindex="-1">ANÁLISE FINAL · RASCUNHO</h4>'+preview(workingDraft);
    resultActions.hidden=false;
    resultActions.innerHTML='<button type="button" class="secondary-button" data-result-edit>EDITAR</button>'+
      '<button type="button" class="primary-button" data-result-release>LIBERAR</button>';
    resultActions.querySelector('[data-result-edit]').addEventListener('click',()=>{
      if(isWriting())return;
      renderEditor(workingDraft);
    });
    const release=resultActions.querySelector('[data-result-release]');
    release.addEventListener('click',()=>void run(release,'Liberando análise final…',async()=>{
      await repository.releaseOccurrenceResult({uid,id,expectedText:workingDraft.text,expectedDueDate:workingDraft.dueDate??''});
      if(!isCurrent())return;
      entry.analysisClosed=true;
      published=await repository.readOccurrenceResult({uid,id});
      if(!isCurrent())return;
      if(!published)throw Error('OCCURRENCE_RESULT_MISSING');
      onResultPublished?.(published.updatedAt);
      renderPublished();
      status.textContent='Análise liberada. A equipe já pode registrar ciência.';
    }));
    onResultDraft?.();
    body.querySelector('h4').focus();
  }

  function renderEditor({text,dueDate=''}) {
    body.innerHTML='<form class="occurrence-followup-analysis"><fieldset>'+
      (safetyAnalysis?'<p>Confira as informações antes de publicar o resultado para a equipe.</p>':'')+
      '<label class="occurrence-field"><span>Resultado final</span><textarea name="result" rows="8" required maxlength="'+
      OCCURRENCE_ETHICAL_REVIEW_LIMIT+'"></textarea></label>'+
      (safetyAnalysis?'<label class="occurrence-field"><span>Prazo da ação de melhoria</span><input name="dueDate" type="date" lang="pt-BR"></label>':'')+
      '<button type="submit" class="primary-button">'+(sahmt?'SALVAR ALTERAÇÕES':'PUBLICAR RESULTADO')+'</button>'+
      (published||workingDraft?'<button type="button" class="secondary-button" data-result-cancel>CANCELAR</button>':'')+'</fieldset></form>';
    const form=body.querySelector('form'),input=form.elements.result,controls=form.querySelector('fieldset');
    const submit=form.querySelector('[type="submit"]');
    input.value=text;
    if(safetyAnalysis)form.elements.dueDate.value=dueDate;
    if(sahmt){resultActions.hidden=true;resultActions.replaceChildren();}
    input.focus({preventScroll:true});
    form.querySelector('[data-result-cancel]')?.addEventListener('click',()=>{
      if(!isWriting()){if(sahmt)renderSahmtDraft();else renderPublished();}
    });
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const next=input.value.trim();
      if(!next){status.textContent='Preencha o resultado final.';return;}
      if(sahmt){
        void run(submit,'Salvando análise final…',async()=>{
          const nextDate=safetyAnalysis?form.elements.dueDate.value:'';
          controls.disabled=true;
          try {
            await repository.saveOccurrenceResultDraft({uid,id,text:next,dueDate:nextDate,
              expectedText:workingDraft.text,expectedDueDate:workingDraft.dueDate??''});
            if(!isCurrent())return;
            workingDraft={text:next,dueDate:nextDate};
            renderSahmtDraft();
            status.textContent='Alterações salvas.';
          } finally {controls.disabled=false;}
        });
        return;
      }
      void run(submit,'Publicando resultado…',async()=>{
        controls.disabled=true;
        try {
          await repository.saveOccurrenceResult({uid,id,text:next,expectedText:published?.text??'',
            ...(safetyAnalysis?{dueDate:form.elements.dueDate.value,expectedDueDate:published?.dueDate??''}:{})});
          if(!isCurrent())return;
          entry.analysisClosed=true;
          onResultPublished?.();
          published=await repository.readOccurrenceResult({uid,id});
          if(!isCurrent())return;
          renderPublished();
          status.textContent='Resultado publicado. A equipe já pode registrar ciência.';
        } finally {controls.disabled=false;}
      });
    });
    return input;
  }

  async function open(draft) {
    if(!isCurrent()||isWriting()||loading)return false;
    loading=true;panel.hidden=false;status.textContent='Carregando resultado…';
    try {
      const privateDraft=sahmt&&canEdit&&!entry.analysisClosed;
      const [result,attendance]=await Promise.all([
        privateDraft?repository.readOccurrenceResultDraft({uid,id}):repository.readOccurrenceResult({uid,id}),
        draft&&safetyAnalysis&&canEdit&&entry.origin==='app'?repository.readAnalysisAttendance({uid,id}):null
      ]);
      if(!isCurrent()||isWriting())return false;
      if(entry.analysisClosed===true&&!result)throw Error('OCCURRENCE_RESULT_MISSING');
      if(privateDraft){
        if(draft){
          const text=draft.text.replaceAll(OCCURRENCE_ANALYSIS_ATTENDANCE_MARKER,attendance??'A confirmar no registro');
          const dueDate=draft.dueDate??'';
          setWriting(true);
          try{
            await repository.saveOccurrenceResultDraft({uid,id,text,dueDate,expectedText:result?.text??'',
              expectedDueDate:result?.dueDate??''});
          }finally{setWriting(false);}
          if(!isCurrent())return false;
          workingDraft={text,dueDate};
        }else workingDraft=result;
        status.textContent='';
        if(workingDraft)renderSahmtDraft();
        else panel.hidden=true;
        return Boolean(workingDraft);
      }
      published=result;
      status.textContent='';
      if(draft&&canEdit&&!entry.eventClosed){
        renderEditor({...draft,text:draft.text.replaceAll(OCCURRENCE_ANALYSIS_ATTENDANCE_MARKER,
          attendance??'A confirmar no registro')}).focus();
      } else if(published)renderPublished();
      else if(canEdit&&!entry.eventClosed)renderEditor({text:''});
      return true;
    } catch {
      if(isCurrent()){
        status.textContent='Não foi possível abrir o resultado.';
        if(entry.analysisClosed===true){
          body.innerHTML='<button type="button" class="secondary-button">TENTAR NOVAMENTE</button>';
          body.querySelector('button').addEventListener('click',()=>void open());
        }
      }
      return false;
    } finally {loading=false;}
  }
  if(entry.analysisClosed===true||(sahmt&&canEdit&&entry.responsesClosedAt))void open();
  return draft=>open(draft);
}

function bindQuestionnaireEditor(panel,{repository,uid,id,entry,isCurrent,isWriting,setWriting},onSaved,edit,{review=false}={}) {
  let questionCount=0;
  const requireThree=entry.origin==='app'&&entry.formId!=='F08'&&(review||edit?.keepThreeImprovements===true);
  const improvementVote=index=>entry.formId!=='F08'&&index===questionCount-1;
  const optionLimit=index=>improvementVote(index)?OCCURRENCE_IMPROVEMENT_OPTION_LIMIT:OCCURRENCE_OPTION_LIMIT;
  const minimumOptions=index=>improvementVote(index)&&requireThree?OCCURRENCE_IMPROVEMENT_OPTION_LIMIT:2;
  const questionMarkup=index=>
    '<fieldset><legend>PERGUNTA '+(index+1)+' DE '+questionCount+'</legend>'+
    (improvementVote(index)?'<strong>Votação da ação de melhoria</strong>':'')+
    '<label class="occurrence-field"><span>Enunciado</span><textarea name="prompt-'+index+'" rows="2" maxlength="'+
    OCCURRENCE_PROMPT_LIMIT+'" required></textarea></label>'+
    Array.from({length:optionLimit(index)},(_,option)=>
      '<label class="occurrence-field"><span>Alternativa '+(option+1)+(option<minimumOptions(index)?'':' (opcional)')+'</span>'+
      '<input name="option-'+index+'-'+option+'" maxlength="'+OCCURRENCE_OPTION_TEXT_LIMIT+'" '+(option<minimumOptions(index)?'required':'')+'></label>').join('')+
    '</fieldset>';
  if(review){
    panel.classList.add('occurrence-preparation-dialog--review');
    panel.setAttribute('aria-label','Pré-análise');
  }
  panel.innerHTML=(review?'<div class="occurrence-preparation-content"><article data-preparation-preview></article>':'')+
    '<form class="occurrence-followup-analysis"'+(review?' hidden':'')+'><h4>'+
    (edit?'EDITAR PÁGINA DE INTERAÇÃO':review?'EDITAR PRÉ-ANÁLISE':'REVISAR PREPARAÇÃO')+'</h4>'+
    '<fieldset><label class="occurrence-field"><span>Descrição para análise da equipe</span>'+
    '<textarea name="description" rows="5" maxlength="5000" required></textarea></label>'+
    '<div class="occurrence-followup-analysis" data-occurrence-question-fields></div>'+
    (review?'':'<button type="submit" class="primary-button">'+(edit?'SALVAR ALTERAÇÕES':'PUBLICAR OCORRÊNCIA E QUESTIONÁRIO')+'</button>')+
    (edit?'<button type="button" class="secondary-button" data-cancel-interaction>CANCELAR</button>':'')+'</fieldset>'+
    '</form><p role="status"></p>'+(review?'</div><footer class="occurrence-dialog__footer">'+
      '<button type="button" class="secondary-button" data-preparation-edit>EDITAR</button>'+
      '<button type="button" class="primary-button" data-preparation-publish>PUBLICAR</button></footer>':'');
  if(!review)panel.hidden=true;
  const form=panel.querySelector('form'),controls=form.querySelector('fieldset'),status=panel.querySelector('[role="status"]');
  const preview=panel.querySelector('[data-preparation-preview]'),editButton=panel.querySelector('[data-preparation-edit]'),
    publishButton=panel.querySelector('[data-preparation-publish]');
  const readDraft=()=>{
    const questions=Array.from({length:questionCount},(_,index)=>({
      prompt:form.elements['prompt-'+index].value.trim(),
      options:Array.from({length:optionLimit(index)},(_,option)=>form.elements['option-'+index+'-'+option].value.trim()).filter(Boolean)
    }));
    const text=form.elements.description.value.trim();
    const vote=questions.at(-1);
    const description=review&&requireThree&&vote?.options.length===OCCURRENCE_IMPROVEMENT_OPTION_LIMIT
      ?withOccurrenceImprovementActions(text,vote.options):text;
    return {description,questions};
  };
  function showPreview(){
    const {description,questions}=readDraft();
    if(description.length<=5000)form.elements.description.value=description;
    form.hidden=true;
    preview.hidden=false;
    editButton.textContent='EDITAR';
    preview.innerHTML='<h4 tabindex="-1">PRÉ-ANÁLISE</h4><p class="occurrence-poll-final-text">'+escape(description)+'</p>'+
      '<ol>'+questions.map(({prompt,options})=>'<li><strong>'+escape(prompt)+'</strong><ul>'+
      options.map(option=>'<li>'+escape(option)+'</li>').join('')+'</ul></li>').join('')+'</ol>';
    preview.querySelector('h4').focus();
  }
  if(review){
    editButton.addEventListener('click',()=>{
      if(!isCurrent()||isWriting())return;
      if(!form.hidden){if(form.reportValidity())showPreview();return;}
      status.textContent='';
      preview.hidden=true;
      form.hidden=false;
      editButton.textContent='VER PRÉ-ANÁLISE';
      form.elements.description.focus();
    });
    publishButton.addEventListener('click',()=>{if(isCurrent()&&!isWriting())form.requestSubmit();});
  }
  form.querySelector('[data-cancel-interaction]')?.addEventListener('click',()=>{if(!isWriting())panel.hidden=true;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!isCurrent()||isWriting())return;
    const {description,questions:draft}=readDraft();
    if(!form.elements.description.value.trim()){status.textContent='Preencha a descrição para análise.';return;}
    if(description.length>5000){status.textContent='A pré-análise com as ações deve ter até 5.000 caracteres.';return;}
    let normalized;
    try {normalized=questionCount?normalizeOccurrencePreparationQuestions(draft,entry.formId,
      {requireThreeImprovementOptions:requireThree}):undefined;}
    catch(error) {
      status.textContent=error.message==='OCCURRENCE_IMPROVEMENT_VOTE_INVALID'
        ?(requireThree?'Use três ações distintas na última pergunta.':'Use duas ou três ações distintas na última pergunta.')
        :'Preencha todas as perguntas e pelo menos duas alternativas de cada uma.';
      return;
    }
    setWriting(true);controls.disabled=true;status.textContent=edit?'Salvando alterações…':'Publicando ocorrência e questionário…';
    if(review)editButton.disabled=publishButton.disabled=true;
    try {
      const saved=edit ? await repository.updateOccurrenceInteraction({uid,id,description,questions:normalized,
        expectedDescription:edit.description,expectedRevision:edit.revision})
        : {questions:await repository.publishOccurrenceQuestionnaire({uid,id,description,questions:normalized}),
          revision:0,canReviseQuestions:true};
      if(isCurrent()){
        if(review)panel.close();
        panel.replaceChildren();panel.hidden=true;onSaved(saved,description);
      }
    } catch(error) {
      if(!isCurrent())return;
      if(error.message==='OCCURRENCE_QUESTIONS_LOCKED'){
        form.querySelector('[data-occurrence-question-fields]').replaceChildren();
        questionCount=0;
        status.textContent='A equipe já começou a responder. Agora você pode salvar a descrição.';
      } else if(['OCCURRENCE_QUESTIONNAIRE_PUBLISHED','OCCURRENCE_INTERACTION_CHANGED'].includes(error.message)) {
        status.textContent='A página foi atualizada. Reabra a ocorrência para editar a versão atual.';
      } else status.textContent='Não foi possível salvar a página. Tente novamente.';
    } finally {
      setWriting(false);controls.disabled=false;
      if(review)editButton.disabled=publishButton.disabled=false;
    }
  });
  return ({description,questions=[]})=>{
    questionCount=questions.length;
    form.querySelector('[data-occurrence-question-fields]').innerHTML=questions.map((_,index)=>questionMarkup(index)).join('');
    form.elements.description.value=description;
    for(const [index,{prompt,options}] of questions.entries()){
      form.elements['prompt-'+index].value=prompt;
      for(let option=0;option<optionLimit(index);option++) {
        form.elements['option-'+index+'-'+option].value=options[option]??'';
      }
    }
    panel.hidden=false;
    if(review){showPreview();return true;}
    status.textContent=edit?(questionCount?'':'As perguntas estão fixas. Você pode ajustar a descrição.')
      :'Revise a descrição e as perguntas antes de publicar.';
    form.elements.description.focus();
    return true;
  };
}

export function mountOccurrenceQuestionnaire(host,options) {
  const {repository,uid,id,entry,editor,isCurrent,isWriting,setWriting,onEditorReady,onPrepared}=options;
  host.innerHTML='<div data-interaction-actions hidden></div><p data-interaction-status role="status"></p><div data-questionnaire-editor></div>'+
    '<section class="occurrence-followup-analysis" data-ethical-poll></section>'+
    '<section class="occurrence-poll-result" data-ethical-poll-result hidden></section>';
  const config=host.querySelector('[data-questionnaire-editor]');
  const response=host.querySelector('[data-ethical-poll]');
  const result=host.querySelector('[data-ethical-poll-result]');
  const interaction=options.interactionActions??host.querySelector('[data-interaction-actions]');
  const interactionStatus=host.querySelector('[data-interaction-status]');
  const sahmt=entry.origin==='app';
  interaction.innerHTML='<div class="occurrence-result-actions">'+
    '<button class="secondary-button" type="button" data-interaction-edit>EDITAR PÁGINA DE INTERAÇÃO</button>'+
    '<button class="secondary-button" type="button" data-interaction-close>'+
    (sahmt?'FINALIZAR PRÉ-ANÁLISE':'ENCERRAR INTERAÇÃO')+'</button></div>';
  let resultBound=false,published=null,stageResult,stagePreparation;
  function showResult(canEdit) {
    if(!isCurrent()||resultBound)return;
    resultBound=true;
    stageResult=bindOccurrenceResult(result,{...options,canEdit,onResultDraft:()=>{
      response.hidden=true;
      options.onResultDraft?.();
    },onResultPublished:resultAt=>{
      response.replaceChildren();
      options.onResultPublished?.(resultAt);
    }});
  }
  function showResponse(questions,questionnaireRevision=0) {
    if(entry.analysisClosed!==true){
      if(entry.responsesClosedAt)response.innerHTML='<p role="status">Respostas da equipe encerradas.</p>';
      else mountOccurrenceResponse(response,{...options,questions,questionnaireRevision,isCurrent:()=>isCurrent()&&!entry.responsesClosedAt&&!entry.analysisClosed});
    }
  }
  async function editInteraction(description) {
    if(!published||!isCurrent()||isWriting()||entry.responsesClosedAt||entry.analysisClosed)return false;
    const current=await repository.readOccurrenceQuestionnaire({uid,id});
    if(!current||!isCurrent()||isWriting()||entry.responsesClosedAt)return false;
    published=current;
    const expected=entry.preparedDescription??entry.description??'';
    const open=bindQuestionnaireEditor(config,options,(saved,text)=>{
      const changed=saved.revision!==published.revision;
      published=saved;
      entry.preparedDescription=text;
      onPrepared?.();
      if(changed)showResponse(saved.questions,saved.revision);
      interactionStatus.textContent='Página de interação atualizada.';
    },{description:expected,revision:current.revision,
      keepThreeImprovements:current.questions.at(-1)?.options.length===OCCURRENCE_IMPROVEMENT_OPTION_LIMIT});
    return open({description:description??expected,questions:current.canReviseQuestions?current.questions:[]});
  }
  interaction.querySelector('[data-interaction-edit]').addEventListener('click',()=>void editInteraction().catch(()=>{
    if(isCurrent())interactionStatus.textContent='Não foi possível abrir o editor. Tente novamente.';
  }));
  interaction.querySelector('[data-interaction-close]').addEventListener('click',async()=>{
    if(!isCurrent()||isWriting()||entry.responsesClosedAt)return;
    setWriting(true);
    interactionStatus.textContent='Encerrando interação…';
    try {
      await repository.closeOccurrenceResponses({uid,id});
      if(!isCurrent())return;
      entry.responsesClosedAt=true;
      config.hidden=true;
      interaction.hidden=true;
      response.innerHTML='<p role="status">Respostas da equipe encerradas.</p>';
      interactionStatus.textContent='';
      options.onResponsesClosed?.();
    } catch {
      if(isCurrent())interactionStatus.textContent='Não foi possível encerrar a interação. Tente novamente.';
    } finally {setWriting(false);}
  });
  async function load() {
    response.innerHTML='<p role="status">Consultando questionário…</p>';
    try {
      const [questionnaire,canEdit]=await Promise.all([repository.readOccurrenceQuestionnaire({uid,id}),editor]);
      const {questions=null,revision=0}=questionnaire??{};
      if(!isCurrent())return;
      response.replaceChildren();
      if(canEdit)showResult(true);
      else if(entry.analysisClosed===true)showResult(false);
      published=questionnaire;
      if(questions) {
        interaction.hidden=!canEdit||!!entry.responsesClosedAt||entry.analysisClosed===true;
        showResponse(questions,revision);
      }
      else if(canEdit&&entry.analysisClosed!==true) {
        const savePreparation=(saved,description)=>{
          entry.analysisStarted=true;
          published=saved;
          stagePreparation=null;
          entry.preparedDescription=description;
          onPrepared?.();
          interaction.hidden=false;
          showResponse(saved.questions,saved.revision);
        };
        stagePreparation=sahmt?(draft,target)=>target?.open&&
          bindQuestionnaireEditor(target,options,savePreparation,null,{review:true})(draft)
          :bindQuestionnaireEditor(config,options,savePreparation);
      } else if(entry.analysisClosed!==true)response.innerHTML='<p>Questionário ainda não publicado.</p>';
      if(canEdit&&entry.analysisClosed!==true)onEditorReady?.({
        hasQuestionnaire:()=>Boolean(published),
        readResponses:()=>readOccurrenceResponses({...options,questions:published?.questions??[]}),
        stageDescription:editInteraction,
        stagePreparation:(draft,target)=>stagePreparation?.(draft,target),stageResult
      });
    } catch {
      if(!isCurrent())return;
      response.innerHTML='<p role="status">Não foi possível consultar o questionário.</p>'+
        '<button type="button" class="secondary-button">TENTAR NOVAMENTE</button>';
      response.querySelector('button').addEventListener('click',()=>void load());
    }
  }
  void load();
}
