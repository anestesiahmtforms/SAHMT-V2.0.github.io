import {formatDisplayDate} from './date-format.js';
import {
  OCCURRENCE_ANALYSIS_FIELDS, OCCURRENCE_ANALYSIS_LIMIT, OCCURRENCE_FORMS, OCCURRENCE_GROUPS,
  getOccurrenceForm, occurrenceProtocol, readOccurrenceAnalysis
} from './occurrence-schema.js';
import {escapeNoticeHtml as escape} from './communication-notice-text.js';

const dateLabel = (value,kind) => kind === 'date' ? formatDisplayDate(value) : value;
const labelFor = entry => entry.title || getOccurrenceForm(entry.formId)?.title || 'Ocorrência';
const fields = Object.entries(OCCURRENCE_ANALYSIS_FIELDS);
const privacyNote = 'O relato será disponibilizado à equipe. Retire nomes, números de atendimento e outros dados que identifiquem pessoas.';

function descriptionMarkup(entry) {
  const form = getOccurrenceForm(entry.formId);
  const values = {...entry.classification,...entry.details};
  const details = [...form.classification,...form.fields].flatMap(field => {
    const value = values[field.id];
    return typeof value === 'string' && value ? [[field.label,dateLabel(value,field.type)]] : [];
  });
  if (entry.occurredOn) details.unshift(['Data da ocorrência',formatDisplayDate(entry.occurredOn)]);
  return '<article class="occurrence-followup-report"><h4'+(entry.origin==='hospital'?' class="occurrence-hospital-title"':'')+'>'+
    escape(labelFor(entry))+'</h4>'+(entry.description?'<p>'+escape(entry.description)+'</p>':'')+
    '<dl>'+details.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl></article>';
}

export function mountOccurrenceFollowup(host,{
  repository,uid,isCurrent,groupsMarkup,canInteract,canShowHospital,isAdministrator=false
}) {
  host.innerHTML='<dialog class="occurrence-dialog occurrence-followup" aria-labelledby="occurrence-followup-title">'+
    '<div class="occurrence-dialog__form"><header class="occurrence-dialog__header">'+
    '<h3 id="occurrence-followup-title" tabindex="-1">OCORRÊNCIAS - SAHMT</h3></header>'+
    '<div class="occurrence-dialog__body" data-followup-body></div>'+
    '<footer class="occurrence-dialog__footer occurrence-dialog__footer--single"><button type="button" class="secondary-button" data-followup-back>VOLTAR</button></footer></div></dialog>';
  const dialog=host.querySelector('dialog'),body=host.querySelector('[data-followup-body]'),heading=host.querySelector('h3');
  let revision=0,group='',formId='',entries=new Map(),after=null,back=()=>dialog.close(),writing=false;
  const groupForms=()=>OCCURRENCE_FORMS.filter(form=>form.group===group);
  function render(title,markup,nextBack) {
    const version=++revision;
    heading.textContent=title;
    body.innerHTML=markup;
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
      '<p role="status" data-followup-status></p><button type="button" class="secondary-button" data-followup-more hidden>CARREGAR MAIS</button>',groupForms().length===1?groups:categories);
    const list=body.querySelector('[data-followup-entries]'),status=body.querySelector('[data-followup-status]'),
      more=body.querySelector('[data-followup-more]');
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
    async function load() {
      if (loading || !current()) return;
      loading=true;more.disabled=true;
      status.textContent='Carregando ocorrências…';
      try {
        const page=await repository.listFollowups({uid,formId,after});
        if (!current()) return;
        for (const entry of page.entries) entries.set(entry.id,entry);
        after=page.next;
        showEntries();
      } catch {
        if (current()) {status.textContent='Não foi possível consultar as ocorrências.';more.textContent='TENTAR NOVAMENTE';more.hidden=false;}
      } finally {loading=false;more.disabled=false;}
    }
    list.addEventListener('click',event=>{
      const button=event.target.closest('[data-followup-record]');
      if (button&&current()) detail(entries.get(button.dataset.followupRecord));
    });
    more.addEventListener('click',()=>void load());
    if(resume)showEntries();
    else void load();
  }

  function detail(entry) {
    const current=render(occurrenceProtocol(entry),descriptionMarkup(entry)+
      '<form class="occurrence-followup-analysis" data-followup-analysis><h4>ANÁLISE DO PROBLEMA</h4>'+
      '<p>Ao preencher um campo, preencha os cinco para salvar a análise.</p><fieldset disabled>'+
      fields.map(([key,label])=>'<label class="occurrence-field"><span>'+label+'</span><textarea rows="3" name="'+key+
        '" maxlength="'+OCCURRENCE_ANALYSIS_LIMIT+'"></textarea></label>').join('')+
      '<button class="primary-button" type="submit">SALVAR ANÁLISE</button></fieldset><p role="status" data-analysis-status>Carregando análise…</p></form>'+
      (isAdministrator?'<details data-admin-analyses><summary>ANÁLISES ENVIADAS</summary><div data-analyses-list></div>'+
        '<p role="status"></p><button type="button" class="secondary-button" hidden>CARREGAR MAIS</button></details>':''),()=>records(true));
    heading.classList.toggle('occurrence-hospital-heading',entry.origin==='hospital');
    const form=body.querySelector('form'),container=form.querySelector('fieldset'),status=form.querySelector('[data-analysis-status]');
    function values() {return Object.fromEntries(fields.map(([key])=>[key,form.elements[key].value]));}
    function requireTogether() {
      const started=Object.values(values()).some(value=>value.trim());
      for (const [key] of fields) form.elements[key].required=started;
    }
    form.addEventListener('input',requireTogether);
    void repository.readAnalysis({uid,id:entry.id}).then(analysis=>{
      if (!current()) return;
      for (const [key] of fields) form.elements[key].value=analysis?.[key]||'';
      requireTogether();
      container.disabled=!canInteract();
      status.textContent=canInteract()?'':'A edição da análise está indisponível.';
    }).catch(()=>{if(current())status.textContent='Não foi possível carregar a análise. Volte e abra novamente.';});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (!current()||writing||container.disabled||!canInteract()) return;
      const input=values();
      try {
        if (!readOccurrenceAnalysis(input)) {status.textContent='Preencha os cinco campos para salvar uma análise.';return;}
      } catch {status.textContent='Preencha os cinco campos para salvar uma análise.';return;}
      writing=true;container.disabled=true;
      try {
        await repository.saveAnalysis({uid,id:entry.id,values:input});
        if (current()) status.textContent='Análise salva.';
      } catch {if(current())status.textContent='Não foi possível confirmar a análise. Tente novamente.';}
      finally {writing=false;if(current()) container.disabled=!canInteract();}
    });
    if (isAdministrator) bindAnalyses(body.querySelector('[data-admin-analyses]'),entry.id,current);
  }

  function bindAnalyses(panel,id,current) {
    const list=panel.querySelector('[data-analyses-list]'),status=panel.querySelector('p'),button=panel.querySelector('button');
    let after=null,loading=false,loaded=false;
    async function load() {
      if (!current()||loading) return;
      loading=true;button.disabled=true;status.textContent='Carregando análises…';
      try {
        const page=await repository.listAnalyses({uid,id,after});
        if (!current()) return;
        for(const item of page.entries) {
          list.insertAdjacentHTML('beforeend','<dl>'+fields.map(([key,label])=>
            '<div><dt>'+label+'</dt><dd>'+escape(item.analysis[key])+'</dd></div>').join('')+'</dl>');
        }
        after=page.next;loaded=true;button.hidden=!after;button.textContent='CARREGAR MAIS';
        status.textContent=list.children.length?'':'Nenhuma análise enviada.';
      } catch {
        if(current()){status.textContent='Não foi possível consultar as análises.';button.hidden=false;button.textContent='TENTAR NOVAMENTE';}
      } finally {loading=false;button.disabled=false;}
    }
    panel.addEventListener('toggle',()=>{if(panel.open&&!loaded)void load();});
    button.addEventListener('click',()=>void load());
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
