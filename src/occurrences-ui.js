import {OCCURRENCE_GROUPS, getOccurrenceForm, validateOccurrenceValues} from './occurrence-schema.js';
import {createOccurrenceRepository} from './occurrence-data.js';
import {enqueueOccurrenceSubmission, listUnsettledOperations} from './outbox.js';

const FORM_ORDER = Object.freeze({A:['F01','F02','F03','F04','F05','F06','F07'],B:['F08'],C:['F09'],D:['F10']});
const ICONS = Object.freeze({
  care:'<path d="M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M12 8v8M8 12h8"/>',
  ethics:'<path d="M12 3v17M7 21h10M5 7h14M5 7l-3 7h6zM19 7l-3 7h6z"/>',
  privacy:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  checklist:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 10l1 1 2-2M13 10h3M8 16l1 1 2-2M13 16h3"/>',
  medication:'<path d="m9 5 10 10M5 9l4-4a5 5 0 0 1 7 7l-4 4a5 5 0 0 1-7-7z"/>',
  equipment:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M6 11h3l2-4 3 7 2-3h2"/>',
  supplies:'<path d="m3 7 9-4 9 4v11l-9 4-9-4zM3 7l9 4 9-4M12 11v11M7 5l9 4"/>',
  fall:'<circle cx="15" cy="4" r="2"/><path d="m13 8-4 3-5-1M13 8l4 4h4M13 8l-1 7-5 5M12 15l5 5"/>'
});
const FORM_ICONS=Object.freeze({F01:'medication',F02:'medication',F03:'care',F04:'care',F05:'fall',F06:'equipment',F07:'supplies',F08:'ethics',F09:'privacy',F10:'checklist'});
const iconMarkup = key => `<svg class="occurrence-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[key]}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dayLocal = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };
const fieldLabel = item => `${escape(item.label)}${item.required ? ' *' : ''}`;

export function occurrenceModuleAccess(permissions = {}) {
  return Object.freeze({read:permissions.occurrencesRead === true,write:permissions.occurrencesWrite === true,
    audit:permissions.occurrencesAuditRead === true, any:['occurrencesRead','occurrencesWrite','occurrencesAuditRead'].some(key => permissions[key] === true)});
}

export function occurrenceGroupMarkup() {
  const icons={A:'care',B:'ethics',C:'privacy',D:'checklist'};
  return OCCURRENCE_GROUPS.map(group => `<button type="button" class="occurrence-group" data-occurrence-group="${group.id}" aria-haspopup="dialog">${iconMarkup(icons[group.id])}<span class="occurrence-button-label">${escape(group.title.toLocaleUpperCase('pt-BR'))}</span><span class="occurrence-group__arrow" aria-hidden="true">›</span></button>`).join('');
}

export function occurrenceCategoryMarkup(groupId,{canWrite=true}={}) {
  const group=OCCURRENCE_GROUPS.find(item=>item.id===groupId);
  if(!group)return '';
  return `<dialog class="occurrence-dialog occurrence-category-dialog" aria-labelledby="occurrence-category-title"><div class="occurrence-dialog__form"><header class="occurrence-dialog__header"><h3 id="occurrence-category-title" tabindex="-1" autofocus>${escape(group.title.toLocaleUpperCase('pt-BR'))}</h3></header><div class="occurrence-dialog__body"><div class="occurrence-group__items" style="--occurrence-options:${FORM_ORDER[group.id].length}">${FORM_ORDER[group.id].map(id => {
    const form=getOccurrenceForm(id); return `<button type="button" class="occurrence-form-launch" data-occurrence-form="${id}" ${canWrite?'':'disabled'}>${iconMarkup(FORM_ICONS[id])}<span class="occurrence-button-label">${escape(form.title.toLocaleUpperCase('pt-BR'))}</span></button>`;
  }).join('')}</div><p class="occurrence-category-status" role="status" aria-live="polite"></p></div><footer class="occurrence-dialog__footer occurrence-dialog__footer--single"><button type="button" class="secondary-button" data-occurrence-group-cancel>VOLTAR</button></footer></div></dialog>`;
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
  return `<dialog class="occurrence-dialog" aria-labelledby="occurrence-form-title"><form class="occurrence-dialog__form" novalidate><header class="occurrence-dialog__header"><h3 id="occurrence-form-title" tabindex="-1" autofocus>${escape(form.title.toLocaleUpperCase('pt-BR'))}</h3></header><div class="occurrence-dialog__body">${general}${classification}${additional}${privacy}<p class="occurrence-form-status" role="status" aria-live="polite"></p></div><footer class="occurrence-dialog__footer"><button type="button" class="secondary-button" data-occurrence-cancel>VOLTAR</button><button type="submit" class="primary-button" data-occurrence-save>SALVAR</button></footer></form></dialog>`;
}

const recoverableCatalogErrors = new Set(['OCCURRENCE_SESSION_INVALID', 'OCCURRENCE_PERMISSION_DENIED',
  'OCCURRENCE_CATALOG_PERMISSION_DENIED']);

export async function loadOccurrenceCatalogForSession({repository,uid,isCurrent}={}) {
  if(!isCurrent())throw new Error('OCCURRENCE_SESSION_CHANGED');
  const result=await repository.loadCatalog({uid});
  if(!isCurrent())throw new Error('OCCURRENCE_SESSION_CHANGED');
  return result;
}

const queueableOccurrenceFailures = new Set(['OCCURRENCE_AUTHORIZATION_UNAVAILABLE','OCCURRENCE_TRANSIENT_WRITE_FAILED']);

export async function submitOccurrenceWithFallback({repository,input,enqueue=enqueueOccurrenceSubmission,isCurrent=()=>true,createdAtClient=Date.now()}={}) {
  try {
    return await repository.save(input);
  } catch (error) {
    if (!queueableOccurrenceFailures.has(error?.message)) throw error;
    if (!isCurrent()) throw new Error('OCCURRENCE_SESSION_CHANGED');
    await enqueue({uid:input.uid,recordId:input.recordId,payload:{formId:input.formId,values:input.values,
      displayName:input.displayName,anonymous:input.anonymous,createdAtClient}});
    return Object.freeze({status:'queued',id:input.recordId,pointsStatus:'PENDING_VALIDATION'});
  }
}

export function summarizeOccurrenceOutbox(items=[]) {
  const occurrences=items.filter(item=>item?.type==='occurrences');
  const queued=occurrences.filter(item=>item.status==='queued').length;
  const needsReview=occurrences.filter(item=>item.status==='failed'||item.status==='conflict').length;
  return Object.freeze({queued,needsReview,message:[queued?`${queued} ocorrência(s) salva(s) neste dispositivo, aguardando sincronização.`:'',
    needsReview?`${needsReview} ocorrência(s) precisam de revisão e não foram confirmadas.`:''].filter(Boolean).join(' ')});
}

export function occurrenceQueueFailureMessage(error) {
  if(error?.message==='OCCURRENCE_QUEUE_FULL')return 'A fila local está cheia. Sincronize envios pendentes; mantenha o formulário aberto enquanto isso.';
  if(error?.message==='OCCURRENCE_QUEUE_TOO_LARGE')return 'Este registro excede o limite local de armazenamento. Mantenha o formulário aberto e envie quando o Firestore voltar.';
  if(error?.message==='OCCURRENCE_PERMISSION_DENIED')return 'A permissão não foi confirmada pelo servidor. O registro não foi salvo nem enfileirado.';
  if(error?.message==='OCCURRENCE_RECONCILIATION_REQUIRED')return 'O envio precisa de revisão administrativa. Não tente reenviar este registro.';
  return 'Não foi possível salvar neste dispositivo. Nenhum envio foi confirmado; mantenha o formulário aberto.';
}

export function occurrenceCatalogErrorMessage(error) {
  if (error?.message==='OCCURRENCE_PERMISSION_DENIED'||error?.message==='OCCURRENCE_CATALOG_PERMISSION_DENIED')
    return 'Seu perfil não tem permissão para ler o catálogo. Entre novamente no app.';
  if (error?.message==='OCCURRENCE_FC_CONNECTION_UNAVAILABLE'||error?.message==='OCCURRENCE_SESSION_INVALID')
    return 'Sua sessão não está disponível. Entre novamente no app.';
  if (error?.message==='OCCURRENCE_CATALOG_INVALID') return 'O catálogo está em formato inválido. Avise a administração.';
  return 'Não foi possível ler o catálogo agora. Tente novamente.';
}

export function createOccurrenceSessionGate({auth,uid,isCurrent}={}) {
  return () => {
    if (!isCurrent?.()) return Promise.reject(new Error('OCCURRENCE_SESSION_CHANGED'));
    if (auth?.currentUser?.uid===uid) return Promise.resolve();
    return Promise.reject(new Error('OCCURRENCE_SESSION_INVALID'));
  };
}

export function mountOccurrenceModule(root,{uid,displayName,auth,db,permissions={},isCurrent=()=>false,idGenerator=()=>crypto.randomUUID()}={}) {
  const pageCurrent=isCurrent;
  let disposed=false;
  isCurrent=()=>!disposed&&root.isConnected&&pageCurrent();
  const access=occurrenceModuleAccess(permissions);
  if(!access.any||!uid||!db||!auth||!isCurrent()) { root.innerHTML='<p class="empty-state" role="status">Sessão de Resultados ou autorização específica indisponível.</p>'; return ()=>{}; }
  const repository=createOccurrenceRepository({db,auth,idGenerator,isCurrent});
  const ensureSession=createOccurrenceSessionGate({auth,uid,isCurrent});
  let catalogs={},saving=false,loading=false,pendingRecordId=null,catalogLoadSequence=0,activeCatalogDialog=null;
  const cancelCatalogLoad=dialog=>{
    if(activeCatalogDialog!==dialog)return;
    catalogLoadSequence++;loading=false;activeCatalogDialog=null;
  };
  root.innerHTML=`<section class="occurrence-module" aria-label="Registro de Ocorrências">${!navigator.onLine?'<p class="sync-state">Sem conexão. Formulários já abertos após validação podem ser salvos neste dispositivo e enviados quando o serviço voltar.</p>':''}<p class="occurrence-module-status" role="status" aria-live="polite"></p><div class="occurrence-groups">${occurrenceGroupMarkup()}</div>${access.read||access.audit?`<div class="occurrence-review">${access.read?'<section class="occurrence-records" aria-live="polite"><h3>Registros recentes</h3><div data-occurrence-records><p class="loading">Carregando…</p></div></section>':''}${access.audit?'<section class="occurrence-records occurrence-audit"><h3>Auditoria restrita</h3><div data-occurrence-audit><p class="loading">Carregando…</p></div></section>':''}</div>`:''}<div data-occurrence-category-host></div><div data-occurrence-dialog-host></div></section>`;
  const host=root.querySelector('[data-occurrence-dialog-host]'), records=root.querySelector('[data-occurrence-records]');
  const moduleStatus=root.querySelector('.occurrence-module-status');
  let pendingStatusGeneration=0;
  const refreshPendingStatus=async()=>{
    const generation=++pendingStatusGeneration;
    try {
      const summary=summarizeOccurrenceOutbox(await listUnsettledOperations(uid));
      if(!isCurrent()||generation!==pendingStatusGeneration||!summary.message)return;
      moduleStatus.textContent=summary.message;
    } catch {}
  };
  const onOutboxChange=event=>{
    if(event.detail?.type&&event.detail.type!=='occurrences')return;
    void refreshPendingStatus().then(()=>{
      if(event.type==='sahmt-write-synced'&&event.detail?.type==='occurrences'&&isCurrent())
        moduleStatus.textContent='Ocorrência confirmada pelo servidor. Pontuação aguardando validação.';
    });
  };
  window.addEventListener('sahmt-write-queued',onOutboxChange);
  window.addEventListener('sahmt-write-synced',onOutboxChange);
  window.addEventListener('sahmt-write-rejected',onOutboxChange);
  void refreshPendingStatus();
  const loadRecords=async()=>{
    if(!access.read||!records)return;
    try {await ensureSession();const items=await repository.list({uid,pageSize:30}); if(!isCurrent())return;
      records.innerHTML=items.length?`<ul class="record-list">${items.map(item=>`<li><strong>${escape(item.formTitle)}</strong><small>${escape(item.occurredOn||'—')} · ${escape(item.authorLabel||'Anônimo')}</small><p>${escape(item.occurrence||'Registro de não conformidade')}</p><small class="record-meta">Pontuação: ${escape(item.pointsStatus||'PENDING_VALIDATION')}</small></li>`).join('')}</ul>`:'<p class="empty-state">Nenhuma ocorrência disponível.</p>';
    } catch {if(isCurrent())records.innerHTML='<p class="empty-state" role="status">Não foi possível carregar os registros autorizados.</p>';}
  };
  const auditRoot=root.querySelector('[data-occurrence-audit]');
  const loadAudit=async()=>{
    if(!access.audit||!auditRoot)return;
    try {await ensureSession();const items=await repository.listAudit({uid,pageSize:30});if(!isCurrent())return;
      auditRoot.innerHTML=items.length?`<ul class="record-list">${items.map(item=>`<li><strong>${escape(item.formId)}</strong><small>${escape(item.anonymous?'Identidade preservada em trilha restrita':'Registro autenticado')} · ${escape(item.reportId)}</small></li>`).join('')}</ul>`:'<p class="empty-state">Nenhum evento de auditoria disponível.</p>';
    } catch {if(isCurrent())auditRoot.innerHTML='<p class="empty-state">Não foi possível carregar a auditoria autorizada.</p>';}
  };
  const categoryHost=root.querySelector('[data-occurrence-category-host]');
  const open=async (formId,{direct=false}={})=>{
    if(!access.write||!isCurrent()||saving||loading)return;
    const form=getOccurrenceForm(formId);if(!form)return;
    const categoryDialog=categoryHost.querySelector('dialog');
    const categoryStatus=direct?root.querySelector('.occurrence-module-status'):categoryHost.querySelector('.occurrence-category-status');
    const loadSequence=++catalogLoadSequence;
    const currentLoad=()=>loadSequence===catalogLoadSequence&&isCurrent()&&(direct||categoryDialog?.open);
    activeCatalogDialog=categoryDialog;
    loading=true;
    if(categoryStatus)categoryStatus.textContent='Carregando…';
    try {
      await ensureSession();
      const result=await loadOccurrenceCatalogForSession({repository,uid,isCurrent:currentLoad});
      if(!currentLoad())return;
      catalogs=result.catalogs;
    } catch(error) {if(currentLoad()&&categoryStatus)categoryStatus.textContent=occurrenceCatalogErrorMessage(error);return;}
    finally {if(loadSequence===catalogLoadSequence){loading=false;activeCatalogDialog=null;}}
    if(!currentLoad())return;
    if(categoryStatus)categoryStatus.textContent='';
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
      try {pendingRecordId ||= idGenerator();const input={uid,displayName,anonymous:formElement.elements.anonymous.checked,formId,values,recordId:pendingRecordId,catalogs};
        const result=await submitOccurrenceWithFallback({repository,input,isCurrent});
        if(!isCurrent())return;pendingRecordId=null;
        const queued=result.status==='queued';
        moduleStatus.textContent=queued?'Ocorrência salva neste dispositivo, aguardando sincronização. Ainda não foi confirmada pelo Firestore.':result.status==='already-saved'?'Este envio já havia sido confirmado.':'Registro confirmado no Firestore. Pontuação aguardando validação.';
        status.textContent=queued?'O envio continua pendente até ser aceito pelo servidor.':'';
        dialog.close(queued?'queued':'saved');formElement.reset();formElement.dataset.dirty='false';
        if(!queued)await loadRecords();
      } catch(error) {if(isCurrent())status.textContent=occurrenceQueueFailureMessage(error);}
      finally {saving=false;if(saveButton.isConnected){saveButton.disabled=false;saveButton.textContent='SALVAR';}if(cancelButton?.isConnected)cancelButton.disabled=false;}
    });
    dialog.showModal();
  };
  root.querySelectorAll('[data-occurrence-group]').forEach(button=>button.addEventListener('click',()=>{
    if(!isCurrent()||saving||loading)return;
    const forms=FORM_ORDER[button.dataset.occurrenceGroup];
    if(forms?.length===1){void open(forms[0],{direct:true});return;}
    categoryHost.innerHTML=occurrenceCategoryMarkup(button.dataset.occurrenceGroup,{canWrite:access.write});
    const dialog=categoryHost.querySelector('dialog');
    categoryHost.querySelector('[data-occurrence-group-cancel]').addEventListener('click',()=>{if(saving)return;cancelCatalogLoad(dialog);dialog.close();});
    dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();else cancelCatalogLoad(dialog);});
    dialog.addEventListener('close',()=>cancelCatalogLoad(dialog));
    if(access.write)categoryHost.querySelectorAll('[data-occurrence-form]').forEach(launch=>launch.addEventListener('click',()=>void open(launch.dataset.occurrenceForm)));
    dialog.showModal();
  }));
  void loadRecords();void loadAudit();
  return ()=>{disposed=true;catalogLoadSequence++;loading=false;activeCatalogDialog=null;repository.clear();window.removeEventListener('sahmt-write-queued',onOutboxChange);window.removeEventListener('sahmt-write-synced',onOutboxChange);window.removeEventListener('sahmt-write-rejected',onOutboxChange);root.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());root.replaceChildren();};
}
