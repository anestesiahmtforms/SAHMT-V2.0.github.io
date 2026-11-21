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
  let revision=0,group='',formId='',entries=new Map(),after=null,back=()=>dialog.close(),writing=false;
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

  function groups() {
    const current=render('OCORRÊNCIAS - SAHMT','<div class="occurrence-followup-list">'+groupsMarkup()+'</div>'+
      '<div data-hospital-entry></div>',()=>dialog.close());
    body.querySelectorAll('[data-occurrence-group]').forEach(button=>button.addEventListener('click',()=>{
      group=button.dataset.occurrenceGroup;
      const forms=groupForms();
      if (forms.length!==1) {categories();return;}
      formId=forms[0].id;
      records();
    }));
    if (canInteract() && canShowHospital()) void repository.hospitalAccess({uid}).then(allowed=>{
      if (!allowed || !current()) return;
      const admin=body.querySelector('[data-hospital-entry]');
      admin.innerHTML='<button type="button" class="primary-button" data-hospital-new>REGISTRAR RELATO DO NÚCLEO DE SEGURANÇA</button>';
      admin.querySelector('button').addEventListener('click',hospital);
    }).catch(()=>{});
  }

  function categories() {
    const title=OCCURRENCE_GROUPS.find(item=>item.id===group).title;
    const forms=groupForms();
    render(title,'<div class="occurrence-followup-list">'+forms.map(form=>
      '<button type="button" class="occurrence-form-launch" data-followup-form="'+form.id+'">'+escape(form.title)+'</button>'
    ).join('')+'</div>',groups);
    body.querySelectorAll('[data-followup-form]').forEach(button=>button.addEventListener('click',()=>{
      formId=button.dataset.followupForm;
      records();
    }));
  }

  function records(resume=false) {
    if (!resume) {entries=new Map();after=null;}
    const current=render(getOccurrenceForm(formId).title,
      '<div class="occurrence-followup-list" data-followup-entries></div>'+
      '<p role="status" data-followup-status></p><div class="occurrence-followup-list">'+
      '<button type="button" class="secondary-button" data-followup-more hidden>CARREGAR MAIS</button>'+
      '<button type="button" class="secondary-button" data-followup-refresh>ATUALIZAR REGISTROS</button></div>',groupForms().length===1?groups:categories);
    const list=body.querySelector('[data-followup-entries]'),status=body.querySelector('[data-followup-status]'),
      more=body.querySelector('[data-followup-more]'),refresh=body.querySelector('[data-followup-refresh]');
    let loading=false;
    function showEntries() {
      list.innerHTML=[...entries.values()].map(entry=>
        '<button type="button" class="occurrence-form-launch" data-followup-record="'+escape(entry.id)+'">'+
        '<span class="'+(entry.origin==='hospital'?'occurrence-hospital-title':'')+'"><strong>'+escape(occurrenceProtocol(entry))+
        '</strong> · '+escape(labelFor(entry))+'</span></button>').join('');
      status.textContent=entries.size?'':'Nenhuma ocorrência registrada neste tema.';
      more.hidden=!after;
      more.textContent='CARREGAR MAIS';
    }
    async function load(fromStart=false) {
      if (loading || !current()) return;
      loading=true;more.disabled=refresh.disabled=true;
      status.textContent='Carregando ocorrências…';
      try {
        const page=await repository.listFollowups({uid,formId,after:fromStart?null:after});
        if (!current()) return;
        if(fromStart)entries.clear();
        for (const entry of page.entries) entries.set(entry.id,entry);
        after=page.next;
        showEntries();
      } catch {
        if (current()) {
          status.textContent='Não foi possível consultar as ocorrências.';
          if(!fromStart&&after)more.textContent='TENTAR NOVAMENTE';
        }
      } finally {loading=false;more.disabled=refresh.disabled=false;}
    }
    list.addEventListener('click',event=>{
      const button=event.target.closest('[data-followup-record]');
      if (button&&current()) detail(entries.get(button.dataset.followupRecord));
    });
    more.addEventListener('click',()=>void load());
    refresh.addEventListener('click',()=>void load(true));
    if(resume)showEntries();
    else void load();
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

  function hospital() {
    const options=OCCURRENCE_GROUPS.map(group=>'<optgroup label="'+escape(group.title)+'">'+
      OCCURRENCE_FORMS.filter(form=>form.group===group.id).map(form=>
        '<option value="'+form.id+'">'+escape(form.title)+'</option>').join('')+'</optgroup>').join('');
    const current=render('RELATO DO NÚCLEO DE SEGURANÇA','<form class="occurrence-followup-analysis" data-hospital-form>'+
      '<p>'+privacyNote+'</p><fieldset><label class="occurrence-field"><span>Protocolo do Núcleo</span>'+
      '<input name="number" placeholder="GR 001" maxlength="16" required></label>'+
      '<label class="occurrence-field"><span>Tema</span><select name="formId" required><option value="">Selecione</option>'+options+'</select></label>'+
      '<label class="occurrence-field"><span>Data da ocorrência</span><input type="date" name="occurredOn" required></label>'+
      '<label class="occurrence-field"><span>Título</span><input name="title" maxlength="180" required></label>'+
      '<label class="occurrence-field"><span>Descrição</span><textarea name="description" rows="5" maxlength="5000" required></textarea></label>'+
      '<button class="primary-button" type="submit">REGISTRAR E PUBLICAR</button></fieldset><p role="status"></p></form>',groups);
    const form=body.querySelector('form'),status=form.querySelector('[role="status"]'),container=form.querySelector('fieldset');
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (writing||!current()||!canInteract()||!canShowHospital()) return;
      const input=Object.fromEntries(new FormData(form));
      writing=true;container.disabled=true;status.textContent='Publicando relato…';
      try {
        const protocol=await repository.saveHospital({uid,...input});
        if (current()) {form.reset();status.textContent=protocol+' · Relato publicado para análise.';}
      } catch(error) {
        if(current())status.textContent=error.message==='OCCURRENCE_HOSPITAL_DUPLICATE'?'Já existe um relato com esse protocolo.':
          error.message==='OCCURRENCE_INPUT_INVALID'?'Confira o protocolo GR, a data e os campos do relato.':'Não foi possível publicar o relato.';
      } finally {writing=false;if(current())container.disabled=false;}
    });
  }

  function goBack() {
    if (writing) return;
    heading.classList.remove('occurrence-hospital-heading');
    back();
  }
  host.querySelector('[data-followup-back]').addEventListener('click',goBack);
  dialog.addEventListener('cancel',event=>{event.preventDefault();goBack();});
  return ()=>{if(isCurrent()&&!dialog.open){dialog.showModal();groups();}};
}
