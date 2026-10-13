import {OCCURRENCE_FORMS, OCCURRENCE_GROUPS, OCCURRENCE_PENDING_FORM, getOccurrenceForm, validateOccurrenceValues} from './occurrence-schema.js';
import {createOccurrenceRepository} from './occurrence-data.js';

const FORM_ORDER = Object.freeze({A:['F01','F02','PENDING_ONCOLOGY','F03','F04','F05','F06','F07'],B:['F08'],C:['F09'],D:['F10']});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dayLocal = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };
const fieldLabel = item => `${escape(item.label)}${item.required ? ' *' : ''}`;

export function occurrenceModuleAccess(permissions = {}) {
  return Object.freeze({read:permissions.occurrencesRead === true,write:permissions.occurrencesWrite === true,
    audit:permissions.occurrencesAuditRead === true, any:['occurrencesRead','occurrencesWrite','occurrencesAuditRead'].some(key => permissions[key] === true)});
}

export function occurrenceGroupMarkup({canWrite=true}={}) {
  return OCCURRENCE_GROUPS.map(group => `<details class="occurrence-group" data-occurrence-group="${group.id}"><summary>${escape(group.title)}</summary><div class="occurrence-group__items">${FORM_ORDER[group.id].map(id => {
    if (id === 'PENDING_ONCOLOGY') return `<button type="button" class="occurrence-form-launch occurrence-form-launch--pending" disabled><span>${escape(OCCURRENCE_PENDING_FORM.label)}</span><small>${escape(OCCURRENCE_PENDING_FORM.status)}</small></button>`;
    const form=getOccurrenceForm(id); return `<button type="button" class="occurrence-form-launch" data-occurrence-form="${id}" ${canWrite?'':'disabled'}><span>${escape(form.title)}</span><small>${canWrite?'Formulário de Registro':'Sem autorização para registrar'}</small></button>`;
  }).join('')}</div></details>`).join('');
}

export function occurrenceFieldMarkup(item, catalogs = {}) {
  const label=fieldLabel(item), required=item.required?'required':'';
  if(item.type==='select') {
    const options=Array.isArray(catalogs[item.catalog])?catalogs[item.catalog]:[];
    const search=options.length>20?`<input class="occurrence-select-search" type="search" data-filter-select="${item.id}" aria-label="Pesquisar ${escape(item.label)}" placeholder="Pesquisar opção">`:'';
    return `<label class="occurrence-field"><span>${label}</span>${search}<select name="${escape(item.id)}" ${required}><option value="">Selecione</option>${options.map(option=>`<option value="${escape(option)}">${escape(option)}</option>`).join('')}</select></label>`;
  }
  const type=item.type==='date'?'date':item.type==='time'?'time':'text';
  const control=item.type==='textarea'?`<textarea name="${escape(item.id)}" rows="3" maxlength="${item.maxLength||5000}" ${required}></textarea>`:
    `<input name="${escape(item.id)}" type="${type}" ${required} maxlength="${item.maxLength||180}" ${item.type==='date'&&item.id==='eventDate'?`value="${dayLocal()}"`:''}>`;
  return `<label class="occurrence-field occurrence-field--${item.type}"><span>${label}</span>${control}</label>`;
}

export function occurrenceFormMarkup(form, catalogs = {}, displayName = '') {
  const general=form.id==='F10'?'':`<section class="occurrence-form-section"><h4>Informações Gerais</h4><div class="occurrence-form-grid">
    <label class="occurrence-field"><span>Autor</span><input value="${escape(displayName)}" readonly aria-describedby="occurrence-author-note"></label>
    ${form.fields.filter(item=>['eventDate','occurrence','description'].includes(item.id)).map(item=>occurrenceFieldMarkup(item,catalogs)).join('')}
    </div></section>`;
  const privacy=`<section class="occurrence-privacy"><label class="occurrence-anonymous"><input type="checkbox" name="anonymous"><span>Realizar registro anônimo</span></label><small id="occurrence-author-note">No modo anônimo, o relato será exibido como “Anônimo”; o identificador ainda será mantido internamente para auditoria. Isto não é anonimato absoluto.</small></section>`;
  const generalIds=new Set(['eventDate','occurrence','description']);
  const classification=form.classification.length?`<section class="occurrence-form-section"><h4>Classificação</h4><div class="occurrence-form-grid">${form.classification.map(item=>occurrenceFieldMarkup(item,catalogs)).join('')}</div></section>`:'';
  const details=form.fields.filter(item=>!generalIds.has(item.id));
  const additional=details.length?`<section class="occurrence-form-section"><h4>Dados do formulário</h4><div class="occurrence-form-grid">${details.map(item=>occurrenceFieldMarkup(item,catalogs)).join('')}</div></section>`:'';
  return `<dialog class="occurrence-dialog" aria-label="Formulário de Registro"><form class="occurrence-dialog__form" novalidate><header class="occurrence-dialog__header"><p class="eyebrow">Formulário de Registro</p><h3>${escape(form.title)}</h3></header><div class="occurrence-dialog__body">${general}${classification}${additional}${privacy}<p class="occurrence-form-status" role="status" aria-live="polite"></p></div><footer class="occurrence-dialog__footer"><button type="button" class="secondary-button" data-occurrence-cancel>VOLTAR</button><button type="submit" class="primary-button" data-occurrence-save>SALVAR</button></footer></form></dialog>`;
}

export function mountOccurrenceModule(root,{uid,displayName,auth,db,permissions={},isCurrent=()=>false,idGenerator=()=>crypto.randomUUID()}={}) {
  const access=occurrenceModuleAccess(permissions);
  if(!access.any||!uid||!db||!auth||!isCurrent()) { root.innerHTML='<p class="empty-state" role="status">Sessão de Resultados ou autorização específica indisponível.</p>'; return ()=>{}; }
  const repository=createOccurrenceRepository({db,auth,idGenerator,isCurrent});
  let catalogs={},saving=false,pendingRecordId=null;
  root.innerHTML=`<section class="occurrence-module" aria-label="Registro de Ocorrências">${!navigator.onLine?'<p class="sync-state">Sem conexão. Rascunhos não são armazenados localmente.</p>':''}<p class="occurrence-module-status" role="status" aria-live="polite"></p><p class="occurrence-points-note">Cada formulário salvo cria um lançamento de 2 pontos pendente de validação; a integração com Desempenho ainda requer reconciliação administrativa.</p><div class="occurrence-groups">${occurrenceGroupMarkup({canWrite:access.write})}</div><section class="occurrence-records" aria-live="polite"><h3>Registros recentes</h3><div data-occurrence-records><p class="loading">Carregando…</p></div></section>${access.audit?'<section class="occurrence-records occurrence-audit"><h3>Auditoria restrita</h3><div data-occurrence-audit><p class="loading">Carregando…</p></div></section>':''}<div data-occurrence-dialog-host></div></section>`;
  const host=root.querySelector('[data-occurrence-dialog-host]'), records=root.querySelector('[data-occurrence-records]');
  const loadRecords=async()=>{
    if(!access.read){records.innerHTML='<p class="record-meta">A listagem geral é restrita; você pode registrar uma nova ocorrência.</p>';return;}
    try {const items=await repository.list({uid,pageSize:30}); if(!isCurrent())return;
      records.innerHTML=items.length?`<ul class="record-list">${items.map(item=>`<li><strong>${escape(item.formTitle)}</strong><small>${escape(item.occurredOn||'—')} · ${escape(item.authorLabel||'Anônimo')}</small><p>${escape(item.occurrence||'Registro de não conformidade')}</p><small class="record-meta">Pontuação: ${escape(item.pointsStatus||'PENDING_VALIDATION')}</small></li>`).join('')}</ul>`:'<p class="empty-state">Nenhuma ocorrência disponível.</p>';
    } catch {if(isCurrent())records.innerHTML='<p class="empty-state" role="status">Não foi possível carregar os registros autorizados.</p>';}
  };
  const auditRoot=root.querySelector('[data-occurrence-audit]');
  const loadAudit=async()=>{
    if(!access.audit||!auditRoot)return;
    try {const items=await repository.listAudit({uid,pageSize:30});if(!isCurrent())return;
      auditRoot.innerHTML=items.length?`<ul class="record-list">${items.map(item=>`<li><strong>${escape(item.formId)}</strong><small>${escape(item.anonymous?'Identidade preservada em trilha restrita':'Registro autenticado')} · ${escape(item.reportId)}</small></li>`).join('')}</ul>`:'<p class="empty-state">Nenhum evento de auditoria disponível.</p>';
    } catch {if(isCurrent())auditRoot.innerHTML='<p class="empty-state">Não foi possível carregar a auditoria autorizada.</p>';}
  };
  const open=async formId=>{
    if(!access.write||!isCurrent()||saving)return;
    const form=getOccurrenceForm(formId);if(!form)return;
    host.innerHTML='<p class="loading">Carregando catálogo protegido…</p>';
    try {catalogs=(await repository.loadCatalog({uid})).catalogs;} catch {host.innerHTML='<p class="empty-state" role="status">O catálogo privado ainda não está disponível no Firestore FC.</p>';return;}
    if(!isCurrent())return;
    host.innerHTML=occurrenceFormMarkup(form,catalogs,displayName);
    const dialog=host.querySelector('dialog'), formElement=host.querySelector('form'), status=host.querySelector('.occurrence-form-status'), saveButton=host.querySelector('[data-occurrence-save]'), cancelButton=host.querySelector('[data-occurrence-cancel]');
    host.querySelectorAll('[data-filter-select]').forEach(input=>input.addEventListener('input',()=>{
      const select=host.querySelector(`select[name="${CSS.escape(input.dataset.filterSelect)}"]`),filter=input.value.trim().toLocaleLowerCase('pt-BR');
      for(const option of select?.options||[]) if(option.value) option.hidden=!option.text.toLocaleLowerCase('pt-BR').includes(filter);
    }));
    cancelButton?.addEventListener('click',()=>{
      if(saving)return;
      if(formElement.dataset.dirty==='true'&&!globalThis.confirm('Descartar o preenchimento? O rascunho não foi salvo.'))return;
      dialog.close('cancel');
    });
    dialog.addEventListener('cancel',event=>{
      if(saving||(formElement.dataset.dirty==='true'&&!globalThis.confirm('Descartar o preenchimento? O rascunho não foi salvo.')))event.preventDefault();
    });
    dialog.addEventListener('close',()=>{if(dialog.returnValue!=='saved')pendingRecordId=null;});
    formElement.addEventListener('input',()=>{formElement.dataset.dirty='true';});
    formElement.addEventListener('submit',async event=>{
      event.preventDefault();if(saving||!isCurrent())return;
      const values=Object.fromEntries([...new FormData(formElement)].filter(([key])=>key!=='anonymous').map(([key,value])=>[key,String(value)]));
      const check=validateOccurrenceValues(formId,values,catalogs);
      if(!check.valid){status.textContent='Confira os campos obrigatórios e as opções selecionadas.';return;}
      saving=true;saveButton.disabled=true;if(cancelButton)cancelButton.disabled=true;saveButton.textContent='SALVANDO…';status.textContent='';
      try {pendingRecordId ||= idGenerator();const result=await repository.save({uid,displayName,anonymous:formElement.elements.anonymous.checked,formId,values,recordId:pendingRecordId,catalogs});
        if(!isCurrent())return;pendingRecordId=null;root.querySelector('.occurrence-module-status').textContent=result.status==='already-saved'?'Este envio já havia sido confirmado.':'Registro confirmado no Firestore FC. Pontuação aguardando validação.';
        dialog.close('saved');formElement.reset();formElement.dataset.dirty='false';await loadRecords();
      } catch(error) {if(isCurrent())status.textContent=error?.message==='OCCURRENCE_RECONCILIATION_REQUIRED'
        ?'O envio precisa de reconciliação administrativa. Não tente reenviar.'
        :'Não foi possível confirmar a gravação. Se tentar novamente nesta tela, o mesmo identificador será reutilizado para evitar duplicação.';}
      finally {saving=false;if(saveButton.isConnected){saveButton.disabled=false;saveButton.textContent='SALVAR';}if(cancelButton?.isConnected)cancelButton.disabled=false;}
    });
    dialog.showModal();
  };
  if(access.write)root.querySelectorAll('[data-occurrence-form]').forEach(button=>button.addEventListener('click',()=>void open(button.dataset.occurrenceForm)));
  void loadRecords();void loadAudit();
  return ()=>{repository.clear();host.replaceChildren();root.replaceChildren();};
}
