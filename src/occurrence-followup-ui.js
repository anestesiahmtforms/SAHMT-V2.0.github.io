import {formatDisplayDate} from './date-format.js';
import {
  OCCURRENCE_FORMS, OCCURRENCE_GROUPS,
  getOccurrenceForm, occurrenceProtocol, withOccurrencePatientFields, occurrenceActionFollowupFields
} from './occurrence-schema.js';
import {escapeNoticeHtml as escape} from './communication-notice-text.js';
import {mountOccurrenceQuestionnaire} from './occurrence-questionnaire-ui.js';
import {bindOccurrencePromptActions} from './occurrence-ai-ui.js';
import {occurrenceAnalysisState,occurrenceChainState,setOccurrenceAnalysisState} from './occurrence-analysis-state.js';

const dateLabel = (value,kind) => kind === 'date' ? formatDisplayDate(value) : value;
const labelFor = entry => entry.title || getOccurrenceForm(entry.formId)?.title || 'Ocorrência';
const originTitles = {app:'OCORRÊNCIAS - SAHMT',hospital:'OCORRÊNCIAS - NÚCLEO DE SEGURANÇA'};
const pageSize = 30;

function descriptionMarkup(entry,original) {
  const form = getOccurrenceForm(entry.formId);
  const record=original??entry;
  const values={...record.classification,...record.details,...record.details?.actionFollowup};
  const fields=original
    ? [...withOccurrencePatientFields([...form.classification,...form.fields]),...occurrenceActionFollowupFields(form)]
    : [...form.classification,...form.fields];
  const details = fields.flatMap(field => {
    const value = values[field.id];
    return typeof value === 'string' && value ? [[field.label,dateLabel(value,field.type)]] : [];
  });
  if(record.occurredOn)details.unshift(['Data da ocorrência',formatDisplayDate(record.occurredOn)]);
  const description=original?original.description:entry.analysisStarted===true?(entry.preparedDescription??entry.description):entry.description;
  return '<article class="occurrence-followup-report"><h4'+(entry.origin==='hospital'?' class="occurrence-hospital-title"':'')+'>'+
    escape(entry.origin==='app'&&entry.analysisStarted?'PRÉ-ANÁLISE':original?.occurrence||labelFor(entry))+
    '</h4><p data-occurrence-description'+(description?'':' hidden')+'>'+escape(description)+'</p>'+
    '<dl>'+details.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl></article>';
}

export function mountOccurrenceFollowup(host,{
  repository,uid,isCurrent,groupsMarkup,canInteract,canShowHospital,isAdministrator,onChainChanged
}) {
  host.innerHTML='<dialog class="occurrence-dialog occurrence-followup" aria-labelledby="occurrence-followup-title">'+
    '<div class="occurrence-dialog__form"><header class="occurrence-dialog__header">'+
    '<h3 id="occurrence-followup-title" tabindex="-1">OCORRÊNCIAS - SAHMT</h3></header>'+
    '<div class="occurrence-dialog__body" data-followup-body></div>'+
    '<footer class="occurrence-dialog__footer occurrence-dialog__footer--single"><div data-followup-interaction hidden></div>'+
    '<div class="occurrence-ai-actions" data-occurrence-ai-actions hidden></div><div class="occurrence-result-actions" data-followup-result hidden></div>'+
    '<button type="button" class="secondary-button" data-followup-back>VOLTAR</button></footer></div></dialog>';
  const dialog=host.querySelector('dialog'),body=host.querySelector('[data-followup-body]'),heading=host.querySelector('h3');
  const promptActions=host.querySelector('[data-occurrence-ai-actions]');
  const interactionActions=host.querySelector('[data-followup-interaction]');
  const resultActions=host.querySelector('[data-followup-result]');
  let revision=0,group='',origin='app',formId='',shown=pageSize,back=()=>dialog.close(),writing=false;
  let overview=null,overviewRequest=null;
  const groupForms=()=>OCCURRENCE_FORMS.filter(form=>form.group===group);
  function render(title,markup,nextBack) {
    const version=++revision;
    heading.textContent=title;
    body.innerHTML=markup;
    for(const actions of [promptActions,interactionActions,resultActions]){
      actions.replaceChildren();
      actions.hidden=true;
    }
    body.scrollTop=0;
    back=nextBack;
    heading.focus({preventScroll:true});
    return ()=>isCurrent()&&dialog.open&&version===revision;
  }

  async function fetchOverview(source) {
    const records=[];
    let after=null;
    do {
      const page=await repository.listFollowups({uid,origin:source,after});
      if (!isCurrent()||!dialog.open) throw new Error('OCCURRENCE_SESSION_CHANGED');
      records.push(...page.entries.filter(entry=>entry.origin===source));
      after=page.next;
    } while(after);
    if (source==='app') records.sort((first,second)=>(second.sequence??0)-(first.sequence??0));
    return records;
  }

  function getOverview(refresh=false) {
    if (overviewRequest) return overviewRequest;
    if (overview&&!refresh) return Promise.resolve(overview);
    const request=fetchOverview(origin).then(records=>{
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
        setOccurrenceAnalysisState(button,occurrenceChainState(items.filter(entry=>getOccurrenceForm(entry.formId)?.group===theme),origin));
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
        setOccurrenceAnalysisState(button,occurrenceChainState(items.filter(entry=>entry.formId===button.dataset.followupForm),origin));
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
    const editorAccess=()=>origin==='app'?Promise.resolve(isAdministrator()):canShowHospital()
      ?repository.descriptionAccess({uid}).catch(()=>false):Promise.resolve(false);
    let editor=editorAccess();
    function showEntries(canEdit=false) {
      list.innerHTML=found.slice(0,shown).map(entry=>
        '<button type="button" class="occurrence-form-launch" data-followup-record="'+escape(entry.id)+'">'+
        '<span class="'+(entry.origin==='hospital'?'occurrence-hospital-title':'')+'"><strong>'+escape(occurrenceProtocol(entry))+
        '</strong> · '+escape(labelFor(entry))+'</span></button>').join('');
      for(const [index,button] of [...list.querySelectorAll('button')].entries()) {
        const state=occurrenceAnalysisState(found[index]);
        setOccurrenceAnalysisState(button,state);
        if(origin==='app')button.dataset.sahmtRecord='';
        button.disabled=state==='preparing'&&!canEdit;
      }
      status.textContent=found.length?'':'Nenhuma ocorrência registrada neste tema.';
      more.hidden=shown>=found.length;
    }
    async function load(force=false) {
      if (loading || !current()) return;
      loading=true;refresh.disabled=true;
      if(force)editor=editorAccess();
      status.textContent='Carregando ocorrências…';
      try {
        const [items,canEdit]=await Promise.all([getOverview(force),editor]);
        if (!current()) return;
        found=items.filter(entry=>entry.formId===formId);
        if(force)shown=pageSize;
        showEntries(canEdit);
      } catch {
        if(current())status.textContent='Não foi possível consultar as ocorrências.';
      } finally {loading=false;refresh.disabled=false;}
    }
    list.addEventListener('click',event=>{
      const button=event.target.closest('[data-followup-record]');
      if(button&&!button.disabled&&current())void openDetail(found.find(entry=>entry.id===button.dataset.followupRecord),editor,current);
    });
    more.addEventListener('click',()=>void editor.then(canEdit=>{if(current()){shown+=pageSize;showEntries(canEdit);}}));
    refresh.addEventListener('click',()=>void load(true));
    void load();
  }

  async function openDetail(entry,editor,current) {
    if(entry.origin!=='app'||!isAdministrator()){detail(entry,editor,entry);return;}
    const pending=render(occurrenceProtocol(entry),'<p role="status">Abrindo ocorrência…</p>',()=>records(true));
    try{
      const {entry:promptSource,original}=await repository.readOccurrenceFollowup({uid,id:entry.id,
        includeOriginal:!entry.analysisStarted&&!entry.analysisClosed});
      if(!pending())return;
      if(!promptSource)throw Error('OCCURRENCE_RECORD_NOT_FOUND');
      detail(entry,editor,promptSource,original);
    }catch{
      if(pending())body.querySelector('[role="status"]').textContent='Não foi possível abrir a ocorrência. Volte e tente novamente.';
    }
  }

  function detail(entry,canEdit,promptSource,original) {
    const label=occurrenceProtocol(entry);
    const sahmt=entry.origin==='app';
    const mayShowOriginal=!sahmt||isAdministrator()&&!entry.analysisStarted&&!entry.analysisClosed;
    const report=sahmt&&entry.analysisClosed?'':descriptionMarkup(mayShowOriginal?promptSource:entry,original);
    const questionnaire='<div data-occurrence-questionnaire></div>';
    const current=render(label,(entry.analysisClosed===true?questionnaire+report:report+questionnaire)+
      '<div data-occurrence-ai-panel></div>',()=>records(true));
    heading.classList.toggle('occurrence-hospital-heading',entry.origin==='hospital');
    const promptPanel=body.querySelector('[data-occurrence-ai-panel]');
    let closePromptInteraction;
    const editor=canEdit.then(allowed=>allowed&&current());
    const isWriting=()=>writing;
    mountOccurrenceQuestionnaire(body.querySelector('[data-occurrence-questionnaire]'),{
      repository,uid,id:entry.id,entry,label:label+' · '+labelFor(entry),editor,
      interactionActions:sahmt?interactionActions:null,resultActions,
      confirmationHost:host,
      isCurrent:current,canInteract,isWriting,setWriting:value=>{writing=value;},
      onPrepared:()=>{
        const description=body.querySelector('[data-occurrence-description]');
        description.textContent=entry.preparedDescription;
        description.hidden=false;
        if(sahmt){
          body.querySelector('.occurrence-followup-report h4').textContent='PRÉ-ANÁLISE';
          body.querySelector('.occurrence-followup-report dl').replaceChildren();
          closePromptInteraction?.();
          onChainChanged?.();
        }
      },
      onResponsesClosed:()=>{closePromptInteraction?.();if(sahmt)onChainChanged?.();},
      onResultDraft:()=>{
        if(sahmt){
          closePromptInteraction?.();
          promptActions.hidden=true;
          const report=body.querySelector('.occurrence-followup-report');
          if(report)report.hidden=true;
        }
      },
      onResultPublished:resultAt=>{
        promptActions.hidden=true;promptPanel.replaceChildren();
        if(sahmt){
          body.prepend(body.querySelector('[data-occurrence-questionnaire]'));
          entry.resultAt=resultAt;entry.acknowledged=false;onChainChanged?.();
        }
      },
      onAcknowledged:()=>{if(sahmt){entry.acknowledged=true;onChainChanged?.();}},
      onEventFinalized:()=>onChainChanged?.(),
      onEditorReady:options=>{closePromptInteraction=bindOccurrencePromptActions(promptActions,promptPanel,{
        ...options,entry,original:promptSource,isCurrent:current,isWriting,setWriting:value=>{writing=value;},
        readPreparationContext:(includeClinical=false)=>entry.origin==='app'&&entry.formId!=='F08'
          ? repository.readPreparationContext({uid,id:entry.id,formId:entry.formId,includeClinical}) : {}
      });}
    });
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
