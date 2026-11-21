import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {OCCURRENCE_COMMENT_LIMIT,OCCURRENCE_QUESTION_COUNT,OCCURRENCE_OPTION_LIMIT,OCCURRENCE_PROMPT_LIMIT,
  OCCURRENCE_OPTION_TEXT_LIMIT,formatOccurrenceAnalysisExport,normalizeOccurrenceQuestions} from './occurrence-questionnaire.js';
import {OCCURRENCE_ETHICAL_REVIEW_LIMIT} from './occurrence-schema.js';

function mountOccurrenceResponse(section,{repository,uid,id,questions,isCurrent,canInteract,isWriting,setWriting,onSubmitted}) {
  const total=questions.length;
  const answers=Array(total).fill(0);
  let step=0,comment='';
  section.innerHTML='<h4>ABORDAGEM</h4><div data-ethical-poll-content></div><p role="status" data-ethical-poll-status></p>';
  const content=section.querySelector('[data-ethical-poll-content]');
  const status=section.querySelector('[data-ethical-poll-status]');
  function confirmed() {
    content.replaceChildren();
    status.textContent='Sua resposta foi registrada.';
    onSubmitted();
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
  if(!entries.length&&!legacy.length)throw new Error('OCCURRENCE_POLL_EMPTY');
  return {questions,entries,legacy};
}

function bindOccurrenceResponses(panel,{repository,uid,id,label,questions,isCurrent}) {
  panel.innerHTML='<summary>RESPOSTAS DA ABORDAGEM</summary><p role="status"></p><div data-ethical-poll-totals></div>'+
    '<ul class="occurrence-poll-comments" aria-label="Comentários"></ul>'+
    '<button type="button" class="secondary-button" data-poll-more hidden>CARREGAR MAIS</button>'+
    '<button type="button" class="secondary-button" data-poll-copy>COPIAR TODAS AS RESPOSTAS</button>'+
    '<p role="status" data-poll-copy-status></p><label class="occurrence-field" data-poll-copy-fallback hidden>'+
    '<span>Texto para copiar</span><textarea rows="8" readonly></textarea></label>';
  panel.hidden=false;
  const status=panel.querySelector('[role="status"]'),more=panel.querySelector('[data-poll-more]');
  const results=panel.querySelector('[data-ethical-poll-totals]'),comments=panel.querySelector('ul');
  const counts=questions.map(({options})=>options.map(()=>0));
  let after=null,total=0,loading=false,loaded=false;
  async function load(){
    if (!isCurrent()||loading) return;
    loading=true;more.disabled=true;status.textContent='Carregando respostas…';
    try {
      const page=questions.length?await repository.listOccurrenceResponses({uid,id,after}):{entries:[],next:null};
      if(!isCurrent())return;
      for(const {answers,comment} of page.entries){
        total++;
        answers.forEach((answer,index)=>counts[index][answer-1]++);
        if(comment)comments.insertAdjacentHTML('beforeend','<li>'+escape(comment)+'</li>');
      }
      after=page.next;loaded=true;more.hidden=!after;more.textContent='CARREGAR MAIS';
      status.textContent=!questions.length?'A cópia inclui as análises já registradas.':total?(after?'Respostas carregadas: ':'Total de respostas: ')+total:'Nenhuma resposta recebida.';
      results.innerHTML=total?questions.map(({prompt,options},index)=>
        '<details><summary>'+escape(prompt)+'</summary><ul>'+options.map((text,option)=>
          '<li><strong>'+counts[index][option]+'</strong> · '+escape(text)+'</li>').join('')+'</ul></details>').join(''):'';
    } catch {
      if(isCurrent()){status.textContent='Não foi possível consultar as respostas.';more.hidden=false;more.textContent='TENTAR NOVAMENTE';}
    } finally {loading=false;more.disabled=false;}
  }
  panel.addEventListener('toggle',()=>{if(panel.open&&!loaded)void load();});
  more.addEventListener('click',()=>void load());
  const copy=panel.querySelector('[data-poll-copy]'),copyStatus=panel.querySelector('[data-poll-copy-status]');
  const fallback=panel.querySelector('[data-poll-copy-fallback]'),copyText=fallback.querySelector('textarea');
  copy.addEventListener('click',async()=>{
    if(copy.disabled||!isCurrent())return;
    copy.disabled=true;fallback.hidden=true;copyText.value='';
    copyStatus.textContent='Preparando a cópia de todas as respostas…';
    const exported=readOccurrenceResponses({repository,uid,id,questions,isCurrent}).then(data=>
      formatOccurrenceAnalysisExport({label,...data}));
    const clipboard=navigator.clipboard;
    try {
      let copied=false;
      if (clipboard?.write&&typeof ClipboardItem==='function') {
        const data=exported.then(text=>new Blob([text],{type:'text/plain'}));
        void data.catch(()=>{});
        try {await clipboard.write([new ClipboardItem({'text/plain':data})]);copied=true;} catch {}
      }
      const text=await exported;
      if(!isCurrent())return;
      if(!copied&&clipboard?.writeText) {
        try {await clipboard.writeText(text);copied=true;} catch {}
      }
      if(!isCurrent())return;
      if(copied){copyStatus.textContent='Todas as respostas foram copiadas.';return;}
      copyStatus.textContent='Selecione e copie o texto abaixo.';
      copyText.value=text;fallback.hidden=false;copyText.focus();copyText.select();
    } catch(error) {
      if(isCurrent())copyStatus.textContent=error.message==='OCCURRENCE_POLL_EMPTY'?'Nenhuma resposta recebida.':
        'Não foi possível preparar a cópia. Tente novamente.';
    } finally {copy.disabled=false;}
  });
}

function bindOccurrenceResult(panel,{repository,uid,id,isCurrent,canEdit,isWriting,setWriting}) {
  panel.innerHTML='<button type="button" class="secondary-button" aria-expanded="false">RESULTADO DA ANÁLISE PELO SERVIÇO</button>'+
    '<div data-poll-result-body hidden></div><p role="status"></p>';
  const toggle=panel.querySelector('button'),body=panel.querySelector('[data-poll-result-body]'),status=panel.querySelector('[role="status"]');
  let published='',loaded=false;
  async function load() {
    const text=await repository.readOccurrenceResult({uid,id});
    if (!isCurrent()) return;
    published=text;loaded=true;
    if (canEdit||published) panel.hidden=false;
  }
  function render() {
    status.textContent='';
    if(!canEdit){body.innerHTML='<p class="occurrence-poll-final-text">'+escape(published)+'</p>';return;}
    body.innerHTML='<form class="occurrence-followup-analysis"><fieldset>'+
      '<label class="occurrence-field"><span>Resultado final</span><textarea name="result" rows="8" required maxlength="'+
      OCCURRENCE_ETHICAL_REVIEW_LIMIT+'"></textarea></label><button type="submit" class="primary-button">PUBLICAR RESULTADO</button></fieldset></form>';
    const form=body.querySelector('form'),input=form.elements.result,controls=form.querySelector('fieldset');
    input.value=published;
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (!isCurrent()||isWriting()) return;
      const text=input.value.trim();
      if(!text){status.textContent='Preencha o resultado final.';return;}
      setWriting(true);controls.disabled=true;toggle.disabled=true;status.textContent='Publicando resultado…';
      try {
        const result=await repository.saveOccurrenceResult({uid,id,text,expectedText:published});
        if(isCurrent()){
          input.value=published=result;
          status.textContent='Resultado publicado para os participantes.';
        }
      } catch(error) {
        if(isCurrent())status.textContent=error.message==='OCCURRENCE_ETHICAL_REVIEW_CHANGED'
          ?'O resultado mudou desde que você abriu o registro. Volte e reabra para ler a versão atual.'
          :'Não foi possível publicar o resultado. Tente novamente.';
      } finally {setWriting(false);if(isCurrent()){controls.disabled=false;toggle.disabled=false;}}
    });
  }
  async function open() {
    if(!isCurrent()||isWriting()||toggle.disabled)return false;
    if(!loaded) {
      toggle.disabled=true;
      try {await load();}
      catch {
        if(isCurrent())status.textContent='Não foi possível abrir o resultado.';
        return false;
      } finally {toggle.disabled=false;}
    }
    if(!isCurrent()||isWriting())return false;
    body.hidden=false;
    toggle.setAttribute('aria-expanded','true');
    if(!body.childElementCount)render();
    return true;
  }
  toggle.addEventListener('click',()=>{
    if(!isCurrent()||isWriting())return;
    if(body.hidden)void open();
    else {
      body.hidden=true;
      toggle.setAttribute('aria-expanded','false');
    }
  });
  if(canEdit)panel.hidden=false;
  else void load().catch(()=>{});
  return async text=>{
    if(!canEdit||!await open())return false;
    const input=body.querySelector('textarea');
    input.value=text;
    input.focus();
    return true;
  };
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
  panel.innerHTML='<details><summary>CONFIGURAR QUESTIONÁRIO</summary>'+
    '<form class="occurrence-followup-analysis"><p>Inclua pelo menos duas alternativas por pergunta. As perguntas ficam fixas depois de publicadas.</p>'+
    '<fieldset>'+questions+'<button type="submit" class="primary-button">PUBLICAR QUESTIONÁRIO</button></fieldset>'+
    '</form></details><p role="status"></p>';
  const form=panel.querySelector('form'),controls=form.querySelector('fieldset'),status=panel.querySelector('[role="status"]');
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!isCurrent()||isWriting())return;
    const draft=Array.from({length:OCCURRENCE_QUESTION_COUNT},(_,index)=>({
      prompt:form.elements['prompt-'+index].value,
      options:Array.from({length:OCCURRENCE_OPTION_LIMIT},(_,option)=>form.elements['option-'+index+'-'+option].value.trim()).filter(Boolean)
    }));
    let normalized;
    try {normalized=normalizeOccurrenceQuestions(draft);}
    catch {status.textContent='Preencha as quatro perguntas e pelo menos duas alternativas de cada uma.';return;}
    setWriting(true);controls.disabled=true;status.textContent='Publicando questionário…';
    try {
      const published=await repository.publishOccurrenceQuestionnaire({uid,id,questions:normalized});
      if(isCurrent()){panel.replaceChildren();onPublished(published);}
    } catch(error) {
      if(isCurrent())status.textContent=error.message==='OCCURRENCE_QUESTIONNAIRE_PUBLISHED'
        ?'O questionário já foi publicado. Volte e reabra a ocorrência.'
        :'Não foi possível publicar o questionário. Tente novamente.';
    } finally {setWriting(false);controls.disabled=false;}
  });
  return draft=>{
    for(const [index,{prompt,options}] of draft.entries()){
      form.elements['prompt-'+index].value=prompt;
      for(let option=0;option<OCCURRENCE_OPTION_LIMIT;option++) {
        form.elements['option-'+index+'-'+option].value=options[option]??'';
      }
    }
    panel.querySelector('details').open=true;
    status.textContent='Revise as perguntas e publique quando estiverem prontas.';
  };
}

export function mountOccurrenceQuestionnaire(host,options) {
  const {repository,uid,id,editor,isCurrent,onEditorReady}=options;
  host.innerHTML='<div data-questionnaire-editor></div>'+
    '<section class="occurrence-followup-analysis" data-ethical-poll></section>'+
    '<details data-ethical-poll-results hidden></details>'+
    '<section class="occurrence-poll-result" data-ethical-poll-result hidden></section>';
  const config=host.querySelector('[data-questionnaire-editor]');
  const response=host.querySelector('[data-ethical-poll]');
  const exportPanel=host.querySelector('[data-ethical-poll-results]');
  const result=host.querySelector('[data-ethical-poll-result]');
  let resultBound=false,publishedQuestions=null,stageResult,stageQuestions;
  function showResult(canEdit) {
    if(!isCurrent()||resultBound)return;
    resultBound=true;
    stageResult=bindOccurrenceResult(result,{...options,canEdit});
  }
  function showQuestions(questions,canEdit) {
    if(canEdit)bindOccurrenceResponses(exportPanel,{...options,questions});
    mountOccurrenceResponse(response,{...options,questions,onSubmitted:()=>showResult(canEdit)});
  }
  async function load() {
    response.innerHTML='<p role="status">Consultando questionário…</p>';
    try {
      const [questions,canEdit]=await Promise.all([repository.readOccurrenceQuestionnaire({uid,id}),editor]);
      if(!isCurrent())return;
      response.replaceChildren();
      if(canEdit)showResult(true);
      else void repository.readAnalysis({uid,id}).then(analysis=>{if(analysis)showResult(false);}).catch(()=>{});
      publishedQuestions=questions;
      if(questions)showQuestions(questions,canEdit);
      else if(canEdit) {
        bindOccurrenceResponses(exportPanel,{...options,questions:[]});
        stageQuestions=bindQuestionnaireEditor(config,options,published=>{
          publishedQuestions=published;
          stageQuestions=null;
          // Replace the archive panel so its listeners only refer to the published questions.
          const panel=exportPanel.cloneNode(false);
          exportPanel.replaceWith(panel);
          bindOccurrenceResponses(panel,{...options,questions:published});
          mountOccurrenceResponse(response,{...options,questions:published,onSubmitted:()=>showResult(true)});
        });
      } else response.innerHTML='<p>Questionário ainda não publicado.</p>';
      if(canEdit)onEditorReady?.({
        hasQuestionnaire:()=>Boolean(publishedQuestions),
        readResponses:()=>readOccurrenceResponses({...options,questions:publishedQuestions??[]}),
        stageQuestions:draft=>stageQuestions?.(draft),stageResult
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
