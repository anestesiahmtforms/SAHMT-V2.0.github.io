import {escapeNoticeHtml as esc} from './communication-notice-text.js';
import {mountTrainingPicker, trainingPickerMarkup} from './communication-training-picker.js';
import {trainingActivityRoute} from './training-activity-route.js';
import {deployment} from './deployment-context.js';

const reasons = {FORBIDDEN:'Sem permissão para esta atividade',NOT_AUTHORIZED:'Sem permissão para esta atividade',INACTIVE:'Integrante inativo',ACTIVITY_UNAVAILABLE:'Atividade indisponível',ATTEMPTS_EXHAUSTED:'Tentativas esgotadas',SOURCE_UNAVAILABLE:'Não foi possível verificar a origem'};
export function activityDescription(activity) {
  if (!activity) return '';
  return activity.kind === 'TRAINING' ? `${activity.title} · Versão ${activity.version} · Nota mínima ${activity.minimumScore} de ${activity.maxScore}` : `${activity.title} · Ciclo ${activity.cycle} · Conclusão pelo envio aceito das respostas`;
}

/** Every send is preceded by a server-issued recipient preview; the browser never supplies a URL. */
export function openActivityComposer({root,client,render,status,report,isCurrent,audienceOptions,loadDirectory,state,onRecover}) {
  state.id ??= `activity-${crypto.randomUUID()}`;
  state.kind ??= 'TRAINING'; state.audience ??= 'ALL';
  render('TREINAMENTOS E ENQUETES', `<form data-activity-form>
    <label>Título<input name="title" maxlength="120" required value="${esc(state.title || '')}"></label>
    <label>Orientação<textarea name="description" maxlength="4000" required>${esc(state.description || '')}</textarea></label>
    <label>Tipo de atividade<select name="kind"><option value="TRAINING">TREINAMENTO</option><option value="SURVEY"${state.kind==='SURVEY'?' selected':''}>ENQUETE</option></select></label>
    ${trainingPickerMarkup}
    <label>Atividade publicada<select name="activity" required><option value="">Carregando atividades…</option></select></label>
    <p data-activity-meta class="comm-note"></p>
    <a data-open-selected-training target="_blank" rel="noopener" hidden>Conferir treinamento em nova aba</a>
    <label data-minimum-label>Nota mínima<input name="minimumScore" type="number" min="0.01" step="any" required value="${esc(state.minimumScore ?? '')}"></label>
    <label>Público<select name="audience">${audienceOptions.map(o=>`<option value="${esc(o.id)}"${o.id===state.audience?' selected':''}>${esc(o.name)}</option>`).join('')}</select></label>
    <label>Destinatário<select name="recipient" disabled><option value="">Selecione Individual</option></select></label>
    <button type="submit" name="preview">CONFERIR DESTINATÁRIOS</button>
    <button type="button" data-reload-activities>RECARREGAR ATIVIDADES</button>
    <button type="button" data-recover-activity>RECUPERAR ACESSO</button>
    <section data-activity-preview aria-live="polite"></section>
  </form>`, {compose:true,activity:true});
  const form=root.querySelector('[data-activity-form]'),f=form.elements;
  const current=()=>isCurrent()&&form.isConnected;
  let catalog=[],catalogTicket=0,recipientTicket=0;
  const pickerElement=form.querySelector('[data-training-picker]');
  const openTraining=form.querySelector('[data-open-selected-training]');
  const picker=mountTrainingPicker(pickerElement,id=>{
    if(!current()||f.activity.disabled)return;
    f.activity.value=id;
    f.activity.dispatchEvent(new Event('change',{bubbles:true}));
    f.activity.focus();
  });
  const remember=()=>Object.assign(state,{title:f.title.value.trim(),description:f.description.value.trim(),kind:f.kind.value,audience:f.audience.value,recipient:f.recipient.value,activityId:f.activity.value,minimumScore:f.minimumScore.value});
  const busy=()=>{
    const locked=state.sending||state.sent||Boolean(state.pending);
    for(const element of form.querySelectorAll('input[name],textarea[name],select'))element.disabled=locked||Boolean(state.loading);
    picker.setDisabled(locked||Boolean(state.loading)||!catalog.length);
    f.recipient.disabled=locked||state.loading||f.audience.value!=='USER'||!f.recipient.options.length||f.recipient.options.length===1;
    f.preview.disabled=locked||state.loading||state.previewing||!catalog.length;
    form.querySelector('[data-reload-activities]').disabled=locked||state.loading||state.previewing;
    form.querySelector('[data-recover-activity]').disabled=Boolean(state.sending);
    for(const button of root.querySelectorAll('footer button'))button.disabled=Boolean(state.sending);
    const send=form.querySelector('[data-confirm-activity]');if(send)send.disabled=Boolean(state.sending||state.sent||!state.preview?.recipients?.length);
    const edit=form.querySelector('[data-edit-activity]');if(edit)edit.disabled=Boolean(state.sending||state.pending||state.sent);
  };
  function metadata(){
    const activity=catalog.find(item=>item.id===f.activity.value),training=f.kind.value==='TRAINING';
    form.querySelector('[data-minimum-label]').hidden=!training;f.minimumScore.required=training;
    pickerElement.hidden=!training;
    openTraining.hidden=!training||!activity;
    if(training&&activity)openTraining.href=deployment.fbBase+trainingActivityRoute(activity.id);
    else openTraining.removeAttribute('href');
    f.minimumScore.max=activity?.maxScore??'';
    const location=training&&activity?.folderPath?.length?` · ${activity.folderPath.join(' › ')}`:'';
    form.querySelector('[data-activity-meta]').textContent=activity?(training?`Versão ${activity.version} · Pontuação máxima: ${activity.maxScore}${location}`:`Ciclo ${activity.cycle} · Sem nota mínima`):'Selecione uma atividade existente e publicada.';
  }
  function showPreview(){
    const p=state.preview;if(!p)return;
    form.querySelector('[data-activity-preview]').innerHTML=`<h3>Confirme a convocação</h3><p><strong>${esc(state.title)}</strong></p><p>${esc(activityDescription(p.activity))}</p>
      <p><strong>${p.recipients.length} destinatário(s) elegível(is)</strong></p><ul class="comm-recipient-preview">${p.recipients.map(person=>`<li>${esc(person.displayName||person.email||person.uid)} · ${esc(person.email)} · ${esc(person.institutionalGroup)}</li>`).join('')}</ul>
      <p>${p.excluded.length} excluído(s)</p>${p.excluded.length?`<ul>${p.excluded.map(person=>`<li>${esc(person.uid)} — ${esc(reasons[person.reason]||`Indisponível para esta atividade (${person.reason})`)}</li>`).join('')}</ul>`:''}
      <p class="comm-note">Os destinatários acima serão fixados no envio. Uma conclusão anterior válida da mesma versão ou ciclo será reconhecida.</p>
      <button type="button" data-confirm-activity>${state.sent?'ENVIADO':state.pending?'CONFIRMAR MESMO ENVIO':'CONFIRMAR E ENVIAR'}</button><button type="button" data-edit-activity>REVISAR SELEÇÃO</button>`;
    busy();
  }
  async function recipients(){
    const ticket=++recipientTicket;
    f.recipient.required=f.audience.value==='USER';
    if(!f.recipient.required){f.recipient.innerHTML='<option value="">Selecione Individual</option>';busy();return;}
    f.recipient.innerHTML='<option value="">Carregando destinatários…</option>';busy();
    try{const users=await loadDirectory();if(!current()||ticket!==recipientTicket)return;
      f.recipient.innerHTML='<option value="">Selecione um destinatário</option>'+users.map(p=>`<option value="${esc(p.uid)}">${esc(p.displayName||p.email)} · ${esc(p.email||p.institutionalGroup)}</option>`).join('');f.recipient.value=state.recipient||'';
    }catch(error){if(current()&&ticket===recipientTicket)report(error,'Não foi possível carregar os integrantes. Recarregue as atividades para tentar novamente.');}
    finally{if(current()&&ticket===recipientTicket)busy();}
  }
  async function load(){
    const ticket=++catalogTicket;catalog=[];picker.update([]);state.loading=true;busy();
    try{const result=await client.request('ACTIVITY_CATALOG',{kind:f.kind.value});if(!current()||ticket!==catalogTicket)return;
      catalog=result.items;picker.update(f.kind.value==='TRAINING'?catalog:[]);f.activity.innerHTML='<option value="">Selecione uma atividade</option>'+catalog.map(item=>`<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('');f.activity.value=state.activityId||'';metadata();
      status(catalog.length?'':'Nenhuma atividade publicada disponível para este tipo.');
    }catch(error){if(current()&&ticket===catalogTicket){catalog=[];f.activity.innerHTML='<option value="">Atividades indisponíveis</option>';report(error,'Não foi possível consultar a origem. Recarregue as atividades para tentar novamente.');}}
    finally{if(current()&&ticket===catalogTicket){state.loading=false;busy();}}
  }
  form.addEventListener('change',event=>{
    if(state.pending||state.sent)return;
    remember();state.preview=null;form.querySelector('[data-activity-preview]').replaceChildren();
    if(event.target===f.kind){state.activityId='';void load();}
    if(event.target===f.audience)void recipients();
    metadata();
  });
  // Input invalidates even an already displayed confirmation, before focus leaves the field.
  form.addEventListener('input',()=>{if(!state.pending&&!state.sent){remember();state.preview=null;form.querySelector('[data-activity-preview]').replaceChildren();}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(state.previewing||state.pending||state.sent||state.loading)return;
    remember();const selected=catalog.find(item=>item.id===state.activityId);if(!selected)return;
    const activity=state.kind==='TRAINING'
      ? {kind:selected.kind,id:selected.id,title:selected.title,version:selected.version,maxScore:selected.maxScore,minimumScore:Number(state.minimumScore)}
      : selected;
    if(state.kind==='TRAINING'&&!(activity.minimumScore>0&&activity.minimumScore<=activity.maxScore))return status('Informe uma nota mínima maior que zero e até a pontuação máxima.',true);
    state.previewing=true;busy();status('Conferindo permissão e destinatários…');
    const selection=JSON.stringify([state.title,state.description,state.kind,state.activityId,state.minimumScore,state.audience,state.recipient]);
    try{const preview=await client.request('PREVIEW_ACTIVITY',{activity,audience:state.audience,...(state.audience==='USER'?{recipient:state.recipient}:{})});if(!current())return;
      remember();if(selection!==JSON.stringify([state.title,state.description,state.kind,state.activityId,state.minimumScore,state.audience,state.recipient]))return status('A seleção mudou. Confira os destinatários novamente.');
      state.preview=preview;showPreview();status(preview.recipients.length?'Confira a lista completa antes de confirmar o envio.':'Nenhum destinatário elegível. Revise a seleção.',!preview.recipients.length);
    }catch(error){if(current())report(error,'Não foi possível conferir a atividade. Recarregue a origem e tente novamente.');}
    finally{state.previewing=false;if(current())busy();}
  });
  form.addEventListener('click',async event=>{
    if(!current())return;
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.hasAttribute('data-recover-activity')){remember();onRecover();return;}
    if(button.hasAttribute('data-reload-activities')){remember();state.preview=null;form.querySelector('[data-activity-preview]').replaceChildren();void load();void recipients();return;}
    if(button.hasAttribute('data-edit-activity')){state.preview=null;form.querySelector('[data-activity-preview]').replaceChildren();return;}
    if(!button.hasAttribute('data-confirm-activity')||state.sending||state.sent||!state.preview?.recipients.length)return;
    state.pending??={id:state.id,previewId:state.preview.previewId,title:state.title,description:state.description,confirmed:true};
    state.sending=true;busy();status('Enviando convocação…');
    try{const result=await client.request('CREATE_ACTIVITY',state.pending);if(!current())return;state.sent=true;state.pending=null;showPreview();status(result.syncQueued?'Convocação publicada. Arquivamento no histórico pendente de sincronização.':'Convocação publicada no app.');}
    catch(error){if(!current())return;
      if(['COMM_ACTIVITY_PREVIEW_EXPIRED','COMM_ACTIVITY_CHANGED','COMM_ACTIVITY_AUDIENCE_CHANGED','COMM_NO_ELIGIBLE_RECIPIENTS'].includes(error.code)){state.pending=null;state.preview=null;form.querySelector('[data-activity-preview]').replaceChildren();}
      if(['COMM_SESSION_INVALID','COMM_IDENTITY_MISMATCH'].includes(error.code)){onRecover();return;}
      if(state.preview)showPreview();report(error,state.pending?'Envio sem confirmação. Use CONFIRMAR MESMO ENVIO para consultar ou repetir a mesma convocação.':'A seleção mudou ou expirou. Recarregue a atividade e confira os destinatários novamente.');
    }finally{state.sending=false;if(current())busy();}
  });
  metadata();void recipients();void load();if(state.preview)showPreview();
}
