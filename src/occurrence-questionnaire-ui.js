import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {OCCURRENCE_COMMENT_LIMIT,OCCURRENCE_QUESTION_COUNT,OCCURRENCE_OPTION_LIMIT,OCCURRENCE_PROMPT_LIMIT,
  OCCURRENCE_OPTION_TEXT_LIMIT,normalizeOccurrenceQuestions} from './occurrence-questionnaire.js';
import {OCCURRENCE_ETHICAL_REVIEW_LIMIT} from './occurrence-schema.js';

function mountOccurrenceResponse(section,{repository,uid,id,questions,isCurrent,canInteract,isWriting,setWriting}) {
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
      (last?'<label class="occurrence-field"><span>Comentário opcional</span><textarea name="comment" rows="3" maxlength="'+OCCURRENCE_COMMENT_LIMIT+'">'+
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
        await repository.submitOccurrenceResponse({uid,id,answers:[...answers],comment});
        if(isCurrent())confirmed();
      } catch {
        if(isCurrent())status.textContent='Não foi possível confirmar a resposta. Tente novamente.';
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
  repository,uid,id,entry,isCurrent,canEdit,isWriting,setWriting,onResultPublished,onEventFinalized
}) {
  panel.innerHTML='<div data-poll-result-body></div><p role="status"></p>';
  const body=panel.querySelector('[data-poll-result-body]'),status=panel.querySelector('[role="status"]');
  let published=null,loading=false;

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

  function renderPublished() {
    body.innerHTML='<h4>RESULTADO DA ANÁLISE PELO SERVIÇO</h4><p class="occurrence-poll-final-text">'+escape(published.text)+'</p>'+
      '<div class="occurrence-result-actions"><button type="button" class="primary-button" disabled data-occurrence-ack>CIÊNCIA</button>'+
      (canEdit&&!entry.eventClosed?
        '<button type="button" class="secondary-button" data-occurrence-result-edit>EDITAR ANÁLISE FINAL</button>'+
        '<button type="button" class="secondary-button" data-occurrence-finalize>FINALIZAR EVENTO</button>':'')+'</div>';
    const ack=body.querySelector('[data-occurrence-ack]');
    const resultAt=published.updatedAt;
    function showAcknowledged() {
      ack.textContent='CIÊNCIA REGISTRADA';
      ack.disabled=true;
    }
    void repository.readOccurrenceAcknowledgement({uid,id,resultAt}).then(acknowledged=>{
      if(!isCurrent()||!ack.isConnected)return;
      if(acknowledged)showAcknowledged();
      else ack.disabled=false;
    }).catch(()=>{if(isCurrent()&&ack.isConnected)ack.disabled=false;});
    ack.addEventListener('click',async()=>{
      let confirmed=false;
      await run(ack,'Registrando ciência…',async()=>{
        await repository.acknowledgeOccurrence({uid,id,resultAt});
        if(isCurrent()){confirmed=true;status.textContent='Ciência registrada.';}
      });
      if(confirmed&&isCurrent())showAcknowledged();
    });
    body.querySelector('[data-occurrence-result-edit]')?.addEventListener('click',()=>{if(!isWriting())renderEditor(published.text);});
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

  function renderEditor(text) {
    body.innerHTML='<form class="occurrence-followup-analysis"><fieldset>'+
      '<label class="occurrence-field"><span>Resultado final</span><textarea name="result" rows="8" required maxlength="'+
      OCCURRENCE_ETHICAL_REVIEW_LIMIT+'"></textarea></label><button type="submit" class="primary-button">PUBLICAR RESULTADO</button>'+
      (published?'<button type="button" class="secondary-button" data-result-cancel>CANCELAR</button>':'')+'</fieldset></form>';
    const form=body.querySelector('form'),input=form.elements.result,controls=form.querySelector('fieldset');
    const submit=form.querySelector('[type="submit"]');
    input.value=text;
    input.focus({preventScroll:true});
    form.querySelector('[data-result-cancel]')?.addEventListener('click',()=>{if(!isWriting())renderPublished();});
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const next=input.value.trim();
      if(!next){status.textContent='Preencha o resultado final.';return;}
      void run(submit,'Publicando resultado…',async()=>{
        controls.disabled=true;
        try {
          await repository.saveOccurrenceResult({uid,id,text:next,expectedText:published?.text??''});
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
      const result=await repository.readOccurrenceResult({uid,id});
      if(!isCurrent()||isWriting())return false;
      if(entry.analysisClosed===true&&!result)throw Error('OCCURRENCE_RESULT_MISSING');
      published=result;
      status.textContent='';
      if(typeof draft==='string'&&canEdit&&!entry.eventClosed){
        renderEditor(draft).focus();
      } else if(published)renderPublished();
      else if(canEdit&&!entry.eventClosed)renderEditor('');
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
  if(entry.analysisClosed===true)void open();
  return text=>open(text);
}

function bindQuestionnaireEditor(panel,{repository,uid,id,isCurrent,isWriting,setWriting},onPublished) {
  const questions=Array.from({length:OCCURRENCE_QUESTION_COUNT},(_,index)=>
    '<fieldset><legend>PERGUNTA '+(index+1)+' DE '+OCCURRENCE_QUESTION_COUNT+'</legend>'+
    '<label class="occurrence-field"><span>Enunciado</span><textarea name="prompt-'+index+'" rows="2" maxlength="'+
    OCCURRENCE_PROMPT_LIMIT+'" required></textarea></label>'+
    Array.from({length:OCCURRENCE_OPTION_LIMIT},(_,option)=>
      '<label class="occurrence-field"><span>Alternativa '+(option+1)+(option<2?'':' (opcional)')+'</span>'+
      '<input name="option-'+index+'-'+option+'" maxlength="'+OCCURRENCE_OPTION_TEXT_LIMIT+'" '+(option<2?'required':'')+'></label>').join('')+
    '</fieldset>').join('');
  panel.innerHTML='<form class="occurrence-followup-analysis"><h4>REVISAR PREPARAÇÃO</h4>'+
    '<fieldset><label class="occurrence-field"><span>Descrição para análise da equipe</span>'+
    '<textarea name="description" rows="5" maxlength="5000" required></textarea></label>'+
    questions+'<button type="submit" class="primary-button">PUBLICAR OCORRÊNCIA E QUESTIONÁRIO</button></fieldset>'+
    '</form><p role="status"></p>';
  panel.hidden=true;
  const form=panel.querySelector('form'),controls=form.querySelector('fieldset'),status=panel.querySelector('[role="status"]');
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!isCurrent()||isWriting())return;
    const draft=Array.from({length:OCCURRENCE_QUESTION_COUNT},(_,index)=>({
      prompt:form.elements['prompt-'+index].value,
      options:Array.from({length:OCCURRENCE_OPTION_LIMIT},(_,option)=>form.elements['option-'+index+'-'+option].value.trim()).filter(Boolean)
    }));
    const description=form.elements.description.value.trim();
    if(!description){status.textContent='Preencha a descrição para análise.';return;}
    let normalized;
    try {normalized=normalizeOccurrenceQuestions(draft);}
    catch {status.textContent='Preencha as quatro perguntas e pelo menos duas alternativas de cada uma.';return;}
    setWriting(true);controls.disabled=true;status.textContent='Publicando ocorrência e questionário…';
    try {
      const published=await repository.publishOccurrenceQuestionnaire({uid,id,description,questions:normalized});
      if(isCurrent()){panel.replaceChildren();panel.hidden=true;onPublished(published,description);}
    } catch(error) {
      if(isCurrent())status.textContent=error.message==='OCCURRENCE_QUESTIONNAIRE_PUBLISHED'
        ?'O questionário já foi publicado. Volte e reabra a ocorrência.'
        :'Não foi possível publicar o questionário. Tente novamente.';
    } finally {setWriting(false);controls.disabled=false;}
  });
  return ({description,questions})=>{
    form.elements.description.value=description;
    for(const [index,{prompt,options}] of questions.entries()){
      form.elements['prompt-'+index].value=prompt;
      for(let option=0;option<OCCURRENCE_OPTION_LIMIT;option++) {
        form.elements['option-'+index+'-'+option].value=options[option]??'';
      }
    }
    panel.hidden=false;
    status.textContent='Revise a descrição e as perguntas antes de publicar.';
    form.elements.description.focus();
    return true;
  };
}

export function mountOccurrenceQuestionnaire(host,options) {
  const {repository,uid,id,entry,editor,isCurrent,onEditorReady,onPrepared}=options;
  host.innerHTML='<div data-questionnaire-editor></div>'+
    '<section class="occurrence-followup-analysis" data-ethical-poll></section>'+
    '<section class="occurrence-poll-result" data-ethical-poll-result hidden></section>';
  const config=host.querySelector('[data-questionnaire-editor]');
  const response=host.querySelector('[data-ethical-poll]');
  const result=host.querySelector('[data-ethical-poll-result]');
  let resultBound=false,publishedQuestions=null,stageResult,stagePreparation;
  function showResult(canEdit) {
    if(!isCurrent()||resultBound)return;
    resultBound=true;
    stageResult=bindOccurrenceResult(result,{...options,canEdit,onResultPublished:()=>{
      response.replaceChildren();
      options.onResultPublished?.();
    }});
  }
  function showResponse(questions) {
    if(entry.analysisClosed!==true){
      if(entry.responsesClosedAt)response.innerHTML='<p role="status">Respostas da equipe encerradas.</p>';
      else mountOccurrenceResponse(response,{...options,questions,isCurrent:()=>isCurrent()&&!entry.responsesClosedAt&&!entry.analysisClosed});
    }
  }
  async function load() {
    response.innerHTML='<p role="status">Consultando questionário…</p>';
    try {
      const [questions,canEdit]=await Promise.all([repository.readOccurrenceQuestionnaire({uid,id}),editor]);
      if(!isCurrent())return;
      response.replaceChildren();
      if(canEdit)showResult(true);
      else if(entry.analysisClosed===true)showResult(false);
      publishedQuestions=questions;
      if(questions)showResponse(questions);
      else if(canEdit&&entry.analysisClosed!==true) {
        stagePreparation=bindQuestionnaireEditor(config,options,(published,description)=>{
          entry.analysisStarted=true;
          publishedQuestions=published;
          stagePreparation=null;
          entry.preparedDescription=description;
          onPrepared?.();
          showResponse(published);
        });
      } else if(entry.analysisClosed!==true)response.innerHTML='<p>Questionário ainda não publicado.</p>';
      if(canEdit&&entry.analysisClosed!==true)onEditorReady?.({
        hasQuestionnaire:()=>Boolean(publishedQuestions),
        readResponses:()=>readOccurrenceResponses({...options,questions:publishedQuestions??[]}),
        closeResponses:async()=>{
          await repository.closeOccurrenceResponses({uid,id});
          if(!isCurrent())return false;
          entry.responsesClosedAt=true;
          response.innerHTML='<p role="status">Respostas da equipe encerradas.</p>';
          options.onResponsesClosed?.();
          return true;
        },
        stagePreparation:draft=>stagePreparation?.(draft),stageResult
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
