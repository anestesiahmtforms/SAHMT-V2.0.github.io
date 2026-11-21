import {formatDisplayDate} from './date-format.js';
import {
  OCCURRENCE_FORMS, OCCURRENCE_GROUPS,
  getOccurrenceForm, occurrenceProtocol
} from './occurrence-schema.js';
import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {mountOccurrenceQuestionnaire} from './occurrence-questionnaire-ui.js';
import {bindOccurrencePromptActions} from './occurrence-ai-ui.js';

const dateLabel = (value,kind) => kind === 'date' ? formatDisplayDate(value) : value;
const labelFor = entry => entry.title || getOccurrenceForm(entry.formId)?.title || 'Ocorrência';
const originTitles = {app:'OCORRÊNCIAS - SAHMT',hospital:'OCORRÊNCIAS - NÚCLEO DE SEGURANÇA'};
const pageSize = 30;
const stateLabels = {
  pending:'Ocorrências em análise',
  clear:'Sem pendências em análise',
  open:'Análise em aberto',
  closed:'Análise concluída'
};

function setAnalysisState(button,state) {
  button.dataset.analysisState=state;
  button.setAttribute('aria-description',stateLabels[state]);
}

function themeState(records) {
  if(records.some(entry=>entry.analysisClosed!==true))return 'pending';
  return records.length?'closed':'clear';
}

const privacyNote = 'O relato será disponibilizado à equipe. Retire nomes e outros dados que identifiquem pessoas.';

function descriptionMarkup(entry) {
  const form = getOccurrenceForm(entry.formId);
  const values = {...entry.classification,...entry.details};
  const details = [...form.classification,...form.fields].flatMap(field => {
    const value = values[field.id];
    return typeof value === 'string' && value ? [[field.label,dateLabel(value,field.type)]] : [];
  });
  if (entry.occurredOn) details.unshift(['Data da ocorrência',formatDisplayDate(entry.occurredOn)]);
  return '<article class="occurrence-followup-report"><h4'+(entry.origin==='hospital'?' class="occurrence-hospital-title"':'')+'>'+
    escape(labelFor(entry))+'</h4><p data-occurrence-description'+(entry.description?'':' hidden')+'>'+escape(entry.description)+'</p>'+
    '<dl>'+details.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl></article>';
}

export function mountOccurrenceFollowup(host,{
  repository,uid,isCurrent,groupsMarkup,canInteract,canShowHospital
}) {
  host.innerHTML='<dialog class="occurrence-dialog occurrence-followup" aria-labelledby="occurrence-followup-title">'+
    '<div class="occurrence-dialog__form"><header class="occurrence-dialog__header">'+
    '<h3 id="occurrence-followup-title" tabindex="-1">OCORRÊNCIAS - SAHMT</h3></header>'+
    '<div class="occurrence-dialog__body" data-followup-body></div>'+
    '<footer class="occurrence-dialog__footer occurrence-dialog__footer--single"><div class="occurrence-ai-actions" data-occurrence-ai-actions hidden></div><button type="button" class="secondary-button" data-followup-back>VOLTAR</button></footer></div></dialog>';
  const dialog=host.querySelector('dialog'),body=host.querySelector('[data-followup-body]'),heading=host.querySelector('h3');
  const promptActions=host.querySelector('[data-occurrence-ai-actions]');
  let revision=0,group='',origin='app',formId='',shown=pageSize,back=()=>dialog.close(),writing=false;
  let overview=null,overviewRequest=null;
  const groupForms=()=>OCCURRENCE_FORMS.filter(form=>form.group===group);
  function render(title,markup,nextBack) {
    const version=++revision;
    heading.textContent=title;
    body.innerHTML=markup;
    promptActions.replaceChildren();
    promptActions.hidden=true;
    body.scrollTop=0;
    back=nextBack;
    heading.focus({preventScroll:true});
    return ()=>isCurrent()&&dialog.open&&version===revision;
  }

  async function fetchOverview() {
    const records=[];
    let after=null;
    do {
      const page=await repository.listFollowups({uid,after});
      if (!isCurrent()||!dialog.open) throw new Error('OCCURRENCE_SESSION_CHANGED');
      records.push(...page.entries.filter(entry=>entry.origin===origin));
      after=page.next;
    } while(after);
    return records;
  }

  function getOverview(refresh=false) {
    if (overviewRequest) return overviewRequest;
    if (overview&&!refresh) return Promise.resolve(overview);
    const request=fetchOverview().then(records=>{
      if(overviewRequest===request)overview=records;
      return records;
    }).finally(()=>{
      if(overviewRequest===request)overviewRequest=null;
    });
    overviewRequest=request;
    return request;
  }

  function groups() {
    const current=render(originTitles[origin],
      '<div class="occurrence-followup-list">'+groupsMarkup()+'</div><p role="status" data-followup-status></p>',
      ()=>dialog.close());
    heading.classList.toggle('occurrence-hospital-heading',origin==='hospital');
    const buttons=[...body.querySelectorAll('[data-occurrence-group]')];
    for(const button of buttons)button.addEventListener('click',()=>{
      group=button.dataset.occurrenceGroup;
      const forms=groupForms();
      if (forms.length!==1) {categories();return;}
      formId=forms[0].id;
      records();
    });
    void getOverview().then(items=>{
      if(!current())return;
      for(const button of buttons) {
        const theme=button.dataset.occurrenceGroup;
        setAnalysisState(button,themeState(items.filter(entry=>getOccurrenceForm(entry.formId)?.group===theme)));
      }
    }).catch(()=>{
      if(current())body.querySelector('[data-followup-status]').textContent='Não foi possível consultar a situação das análises.';
    });
  }

  function categories() {
    const title=OCCURRENCE_GROUPS.find(item=>item.id===group).title;
    const current=render(title,'<div class="occurrence-followup-list">'+groupForms().map(form=>
      '<button type="button" class="occurrence-form-launch" data-followup-form="'+form.id+'">'+escape(form.title)+'</button>'
    ).join('')+'</div>',groups);
    const buttons=[...body.querySelectorAll('[data-followup-form]')];
    for(const button of buttons)button.addEventListener('click',()=>{
      formId=button.dataset.followupForm;
      records();
    });
    void getOverview().then(items=>{
      if(!current())return;
      for(const button of buttons) {
        setAnalysisState(button,themeState(items.filter(entry=>entry.formId===button.dataset.followupForm)));
      }
    }).catch(()=>{});
  }

  function records(resume=false) {
    if (!resume) shown=pageSize;
    const current=render(getOccurrenceForm(formId).title,
      '<div class="occurrence-followup-list" data-followup-entries></div>'+
      '<p role="status" data-followup-status></p><div class="occurrence-followup-list">'+
      '<button type="button" class="secondary-button" data-followup-more hidden>CARREGAR MAIS</button>'+
      '<button type="button" class="secondary-button" data-followup-refresh>ATUALIZAR REGISTROS</button></div>',groupForms().length===1?groups:categories);
    const list=body.querySelector('[data-followup-entries]'),status=body.querySelector('[data-followup-status]'),
      more=body.querySelector('[data-followup-more]'),refresh=body.querySelector('[data-followup-refresh]');
    let found=[],loading=false;
    function showEntries() {
      list.innerHTML=found.slice(0,shown).map(entry=>
        '<button type="button" class="occurrence-form-launch" data-followup-record="'+escape(entry.id)+'"'+
        ' data-analysis-state="'+(entry.analysisClosed===true?'closed':'open')+'" aria-description="'+
        (entry.analysisClosed===true?stateLabels.closed:stateLabels.open)+'">'+
        '<span class="'+(entry.origin==='hospital'?'occurrence-hospital-title':'')+'"><strong>'+escape(occurrenceProtocol(entry))+
        '</strong> · '+escape(labelFor(entry))+'</span></button>').join('');
      status.textContent=found.length?'':'Nenhuma ocorrência registrada neste tema.';
      more.hidden=shown>=found.length;
    }
    async function load(force=false) {
      if (loading || !current()) return;
      loading=true;refresh.disabled=true;
      status.textContent='Carregando ocorrências…';
      try {
        const items=await getOverview(force);
        if (!current()) return;
        found=items.filter(entry=>entry.formId===formId);
        if(force)shown=pageSize;
        showEntries();
      } catch {
        if(current())status.textContent='Não foi possível consultar as ocorrências.';
      } finally {loading=false;refresh.disabled=false;}
    }
    list.addEventListener('click',event=>{
      const button=event.target.closest('[data-followup-record]');
      if (button&&current()) detail(found.find(entry=>entry.id===button.dataset.followupRecord));
    });
    more.addEventListener('click',()=>{shown+=pageSize;showEntries();});
    refresh.addEventListener('click',()=>void load(true));
    void load();
  }

  function detail(entry) {
    const label=occurrenceProtocol(entry);
    const current=render(label,descriptionMarkup(entry)+
      '<div data-occurrence-description-tools hidden></div><div data-occurrence-questionnaire></div>'+
      '<div data-occurrence-ai-panel></div>',()=>records(true));
    heading.classList.toggle('occurrence-hospital-heading',entry.origin==='hospital');
    const descriptionTools=body.querySelector('[data-occurrence-description-tools]');
    const promptPanel=body.querySelector('[data-occurrence-ai-panel]');
    let stageDescription;
    const editor=canShowHospital()?repository.descriptionAccess({uid}).then(allowed=>{
      if (allowed&&current())stageDescription=bindDescriptionEditor(descriptionTools,entry,current);
      return Boolean(stageDescription);
    }).catch(()=>false):Promise.resolve(false);
    const isWriting=()=>writing;
    mountOccurrenceQuestionnaire(body.querySelector('[data-occurrence-questionnaire]'),{
      repository,uid,id:entry.id,label:label+' · '+labelFor(entry),editor,
      isCurrent:current,canInteract,isWriting,setWriting:value=>{writing=value;},
      onResultPublished:()=>{entry.analysisClosed=true;},
      onEditorReady:options=>bindOccurrencePromptActions(promptActions,promptPanel,{
        ...options,entry,isCurrent:current,isWriting,stageDescription
      })
    });
  }

  function bindDescriptionEditor(panel,entry,current) {
    panel.innerHTML='<button type="button" class="secondary-button" data-edit-occurrence-description>EDITAR DESCRIÇÃO</button>'+
      '<form class="occurrence-followup-analysis" hidden><p>'+privacyNote+'</p><fieldset>'+
      '<label class="occurrence-field"><span>Descrição da ocorrência</span><textarea name="description" rows="5" maxlength="5000" required></textarea></label>'+
      '<button type="submit" class="primary-button">SALVAR DESCRIÇÃO</button>'+
      '<button type="button" class="secondary-button" data-cancel-description>CANCELAR</button></fieldset></form><p role="status"></p>';
    panel.hidden=false;
    const edit=panel.querySelector('[data-edit-occurrence-description]'),form=panel.querySelector('form'),
      inputs=form.querySelector('fieldset'),input=form.elements.description,status=panel.querySelector('[role="status"]');
    function close() {form.hidden=true;edit.hidden=false;edit.focus({preventScroll:true});}
    function open(description=entry.description||'') {
      if (!current()||writing||!canShowHospital()) return;
      input.value=description;
      status.textContent='';
      edit.hidden=true;
      form.hidden=false;
      input.focus();
    }
    edit.addEventListener('click',()=>open());
    form.querySelector('[data-cancel-description]').addEventListener('click',()=>{status.textContent='';close();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (!current()||writing||!canShowHospital()) return;
      const description=input.value.trim();
      if (!description) {status.textContent='Preencha a descrição da ocorrência.';return;}
      writing=true;inputs.disabled=true;status.textContent='Salvando descrição…';
      try {
        const saved=await repository.saveDescription({uid,id:entry.id,description,expectedDescription:entry.description??null});
        if (!current()) return;
        entry.description=saved;
        const published=body.querySelector('[data-occurrence-description]');
        published.textContent=saved;
        published.hidden=false;
        status.textContent='Descrição atualizada.';
        close();
      } catch(error) {
        if (!current()) return;
        status.textContent=error.message==='OCCURRENCE_DESCRIPTION_CHANGED'
          ?'A descrição mudou desde que você abriu o registro. Volte e atualize a lista antes de editar novamente.'
          :'Não foi possível salvar a descrição. Confira o seu acesso e tente novamente.';
      } finally {writing=false;if(current())inputs.disabled=false;}
    });
    return open;
  }

  function goBack() {
    if (writing) return;
    heading.classList.remove('occurrence-hospital-heading');
    back();
  }
  host.querySelector('[data-followup-back]').addEventListener('click',goBack);
  dialog.addEventListener('cancel',event=>{event.preventDefault();goBack();});
  return source=>{
    if(!isCurrent()||dialog.open)return;
    origin=source==='hospital'?'hospital':'app';
    overview=null;
    overviewRequest=null;
    dialog.showModal();
    groups();
  };
}
