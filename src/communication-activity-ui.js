import {escapeNoticeHtml as esc} from './communication-notice-text.js';
import {trainingActivityRoute} from './training-activity-route.js';
import {deployment} from './deployment-context.js';
import {communicationRecipientOptions} from './communication-recipient-directory.js';
import {activitySelectionUrl, startActivitySelection, surveyActivityPanels} from './communication-activity-selection.js';
import {rememberModuleNavigation} from './module-navigation.js';

const reasons = {FORBIDDEN:'Sem permissão para esta atividade',NOT_AUTHORIZED:'Sem permissão para esta atividade',INACTIVE:'Integrante inativo',ACTIVITY_UNAVAILABLE:'Atividade indisponível',ATTEMPTS_EXHAUSTED:'Tentativas esgotadas',SOURCE_UNAVAILABLE:'Não foi possível verificar a origem'};
const needsGoogle=error=>['COMM_SESSION_INVALID','COMM_IDENTITY_MISMATCH','COMM_SOURCE_SESSION_INVALID','COMM_SOURCE_IDENTITY_MISMATCH'].includes(error?.code);
const activityKey=activity=>activity?`${activity.kind}:${activity.id}`:'';
function activityAccessUrl(activity,messageId,origin){
  if(!activity)return '';
  const base=activity.kind==='TRAINING'
    ? deployment.fbBase+trainingActivityRoute(activity.id)+'/'+encodeURIComponent(messageId)
    : Object.hasOwn(surveyActivityPanels,activity.id)
      ? deployment.faBase+'#/management-hub/'+surveyActivityPanels[activity.id]+'/required/'+encodeURIComponent(messageId)
      : '';
  return base?new URL(base,origin).href:'';
}
function messageWithActivityLink(description,activity,messageId,origin){
  const link=activityAccessUrl(activity,messageId,origin);
  return link?`${description.trim()}\n\nAcesse a atividade: ${link}`:description.trim();
}
export function activityDescription(activity) {
  if (!activity) return '';
  return activity.kind === 'TRAINING' ? `${activity.title} · Versão ${activity.version} · Nota mínima ${activity.minimumScore} de ${activity.maxScore}` : `${activity.title} · Ciclo ${activity.cycle} · Conclusão pelo envio aceito das respostas`;
}

/** Every send is preceded by a server-issued recipient preview; the browser never supplies a URL. */
export function openActivityComposer({root,client,render,status,report,isCurrent,audienceOptions,loadDirectory,state,onRecover,user}) {
  state.id ??= `activity-${crypto.randomUUID()}`;
  state.title = 'Atividade';
  state.description = 'Acesse a atividade selecionada pelo link abaixo.';
  state.kind ??= 'TRAINING'; state.audience ??= 'ALL';
  const initialActivityOption=state.sourceActivity
    ? `<option value="${esc(activityKey(state.sourceActivity))}">${esc(state.sourceActivity.title)}</option>`
    : '<option value="">Carregando atividades…</option>';
  render('Atividade', `<form data-activity-form>
    <label>Definir atividade<select name="activity" required>${initialActivityOption}</select></label>
    <p data-activity-link-row class="comm-activity-link-row" hidden>Link da atividade: <a data-activity-link target="_blank" rel="noopener noreferrer"></a></p>
    <nav class="comm-activity-source-links" aria-label="Módulos de origem"><button type="button" data-activity-source="TRAINING">Gestão de Documentos</button><button type="button" data-activity-source="SURVEY">Enquetes e Consultas</button><button type="button" data-reload-activities hidden>ATUALIZAR LISTA</button></nav>
    <label data-minimum-label>Nota mínima<input name="minimumScore" type="number" min="0.01" step="any" required value="${esc(state.minimumScore ?? '')}"></label>
    <label>Público<select name="audience">${audienceOptions.map(o=>`<option value="${esc(o.id)}"${o.id===state.audience?' selected':''}>${esc(o.name)}</option>`).join('')}</select></label>
    <label data-recipient-label hidden>Destinatário<select name="recipient" disabled><option value="">Selecione Individual</option></select></label>
    <section data-activity-preview aria-live="polite"></section>
    <button type="submit" name="preview">CONFERIR DESTINATÁRIOS</button>
    <button type="button" data-recover-activity hidden>RECUPERAR ACESSO</button>
  </form>`, {activity:true});
  const form=root.querySelector('[data-activity-form]'),f=form.elements;
  const current=()=>isCurrent()&&form.isConnected;
  let catalog=[],catalogTicket=0,recipientTicket=0;
  const activityLink=form.querySelector('[data-activity-link]');
  const activityLinkRow=form.querySelector('[data-activity-link-row]');
  const selectedActivity=()=>catalog.find(item=>activityKey(item)===f.activity.value);
  const remember=()=>{
    const selected=selectedActivity() || (activityKey(state.sourceActivity)===f.activity.value ? state.sourceActivity:null);
    Object.assign(state,{title:'Atividade',description:'Acesse a atividade selecionada pelo link abaixo.',kind:selected?.kind||'TRAINING',audience:f.audience.value,recipient:f.recipient.value,activityId:selected?.id||'',minimumScore:f.minimumScore.value});
    if(selected!==state.sourceActivity&&activityKey(selected)!==activityKey(state.sourceActivity))delete state.sourceActivity;
  };
  const busy=()=>{
    const locked=state.sending||state.sent||Boolean(state.pending);
    for(const element of form.querySelectorAll('input[name],textarea[name],select'))element.disabled=locked||Boolean(state.loading);
    f.recipient.disabled=locked||state.loading||f.audience.value!=='USER'||!f.recipient.options.length||f.recipient.options.length===1;
    f.preview.disabled=locked||state.loading||state.previewing||!selectedActivity();
    for(const button of form.querySelectorAll('[data-activity-source]'))button.disabled=locked||Boolean(state.previewing);
    form.querySelector('[data-reload-activities]').disabled=locked||state.loading||state.previewing;
    form.querySelector('[data-recover-activity]').disabled=Boolean(state.sending);
    for(const button of root.querySelectorAll('footer button'))button.disabled=Boolean(state.sending);
    const send=form.querySelector('[data-confirm-activity]');if(send)send.disabled=Boolean(state.sending||state.sent||!state.preview?.recipients?.length);
    const edit=form.querySelector('[data-edit-activity]');if(edit)edit.disabled=Boolean(state.sending||state.pending||state.sent);
  };
  function metadata(){
    const activity=selectedActivity() || state.sourceActivity;
    const training=activity?.kind==='TRAINING';
    form.querySelector('[data-minimum-label]').hidden=!training||!selectedActivity();f.minimumScore.required=training&&Boolean(selectedActivity());
    const link=activityAccessUrl(activity,state.id,root.ownerDocument.location.origin);
    activityLink.href=link;
    activityLink.textContent=link||'';
    activityLinkRow.hidden=!link;
    f.minimumScore.max=activity?.maxScore??'';
  }
  function showPreview(){
    const p=state.preview;if(!p)return;
    form.dataset.confirmation='true';
    const outgoingMessage=messageWithActivityLink(state.description,p.activity,state.id,root.ownerDocument.location.origin);
    form.querySelector('[data-activity-preview]').innerHTML=`<p class="comm-activity-preview-title">${esc(activityDescription(p.activity))}</p><p class="comm-activity-outgoing-message">${esc(outgoingMessage)}</p>
      <p class="comm-activity-preview-count">${p.recipients.length} destinatário(s) receberão esta atividade${p.excluded.length?` · ${p.excluded.length} excluído(s)`:''}</p>
      <details class="comm-activity-recipient-details"><summary>Conferir destinatários e exclusões</summary><ul class="comm-recipient-preview">${p.recipients.map(person=>`<li>${esc(person.displayName||person.email||person.uid)} · ${esc(person.institutionalGroup)}</li>`).join('')}${p.excluded.map(person=>`<li>${esc(person.displayName||person.email||person.uid)} — ${esc(reasons[person.reason]||'Sem acesso ou já concluiu')}</li>`).join('')}</ul></details>
      <button type="button" data-confirm-activity>${state.sent?'ENVIADO':state.pending?'CONFIRMAR MESMO ENVIO':'ENVIAR ATIVIDADE'}</button><button type="button" data-edit-activity>REVISAR SELEÇÃO</button>`;
    f.preview.hidden=true;
    busy();
  }
  async function recipients(){
    const ticket=++recipientTicket;
    f.recipient.required=f.audience.value==='USER';form.querySelector('[data-recipient-label]').hidden=!f.recipient.required;
    if(!f.recipient.required){f.recipient.innerHTML='<option value="">Selecione Individual</option>';busy();return;}
    f.recipient.innerHTML='<option value="">Carregando destinatários…</option>';busy();
    try{const users=await loadDirectory();if(!current()||ticket!==recipientTicket)return;
      f.recipient.innerHTML=communicationRecipientOptions(users,{selected:state.recipient});
    }catch(error){if(current()&&ticket===recipientTicket)report(error,'Não foi possível carregar os integrantes. Recarregue as atividades para tentar novamente.');}
    finally{if(current()&&ticket===recipientTicket)busy();}
  }
  async function load(){
    const ticket=++catalogTicket;catalog=[];state.loading=true;busy();
    try{const results=await Promise.allSettled([client.request('ACTIVITY_CATALOG',{kind:'TRAINING'}),client.request('ACTIVITY_CATALOG',{kind:'SURVEY'})]);if(!current()||ticket!==catalogTicket)return;
      const trainings=results[0].status==='fulfilled'?results[0].value.items||[]:[],surveys=results[1].status==='fulfilled'?results[1].value.items||[]:[];
      catalog=[...trainings,...surveys];
      const options=(items)=>items.map(item=>`<option value="${esc(activityKey(item))}">${esc(item.title)}</option>`).join('');
      f.activity.innerHTML='<option value="">Selecione uma atividade</option>'+`<optgroup label="Gestão de Documentos">${options(catalog.filter(item=>item.kind==='TRAINING'))}</optgroup>`+`<optgroup label="Enquetes e Consultas">${options(catalog.filter(item=>item.kind==='SURVEY'))}</optgroup>`;
      const linked=state.sourceActivity;
      const linkedAvailable=catalog.some(item=>activityKey(item)===activityKey(linked));
      if(linked&&!linkedAvailable)f.activity.add(new Option(linked.title,activityKey(linked)));
      f.activity.value=activityKey(catalog.find(item=>item.id===state.activityId&&item.kind===state.kind) || linked);metadata();
      const failures=results.filter(result=>result.status==='rejected'),empty=!catalog.length;
      form.querySelector('[data-reload-activities]').hidden=!empty&&!failures.length&&(!linked||linkedAvailable);
      form.querySelector('[data-recover-activity]').hidden=!failures.some(result=>needsGoogle(result.reason));
      if(linked&&!linkedAvailable)status(results[linked.kind==='TRAINING'?0:1].status==='rejected'
        ? 'Link incluído. Não foi possível confirmar a atividade na origem. Atualize a lista para continuar.'
        : 'Link incluído. Libere a atividade no módulo de origem e atualize a lista antes de enviar.',true);
      else if(empty)status('Nenhuma atividade publicada. Ative ou publique no módulo correspondente e atualize a lista.');
      else if(failures.length)status('Uma das origens está indisponível; as atividades carregadas continuam disponíveis.',true);
      else status('');
    }catch(error){if(current()&&ticket===catalogTicket){catalog=[];f.activity.innerHTML='<option value="">Atividades indisponíveis</option>';form.querySelector('[data-reload-activities]').hidden=false;form.querySelector('[data-recover-activity]').hidden=!needsGoogle(error);report(error,'Não foi possível consultar as atividades. Confira os módulos de origem e atualize a lista.');}}
    finally{if(current()&&ticket===catalogTicket){state.loading=false;busy();}}
  }
  form.addEventListener('change',event=>{
    if(state.pending||state.sent)return;
    remember();state.preview=null;delete form.dataset.confirmation;form.querySelector('[data-activity-preview]').replaceChildren();f.preview.hidden=false;
    if(event.target===f.activity){const selected=catalog.find(item=>activityKey(item)===f.activity.value);state.activityId=selected?.id||'';state.kind=selected?.kind||'TRAINING';state.minimumScore='';f.minimumScore.value='';}
    if(event.target===f.audience)void recipients();
    metadata();busy();
  });
  // Input invalidates even an already displayed confirmation, before focus leaves the field.
  form.addEventListener('input',()=>{if(!state.pending&&!state.sent){remember();state.preview=null;delete form.dataset.confirmation;form.querySelector('[data-activity-preview]').replaceChildren();f.preview.hidden=false;}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(state.previewing||state.pending||state.sent||state.loading)return;
    remember();const selected=catalog.find(item=>activityKey(item)===f.activity.value);if(!selected)return;
    state.activityId=selected.id;state.kind=selected.kind;
    const activity=selected.kind==='TRAINING'
      ? {kind:selected.kind,id:selected.id,title:selected.title,version:selected.version,maxScore:selected.maxScore,minimumScore:Number(state.minimumScore)}
      : selected;
    if(selected.kind==='TRAINING'&&!(activity.minimumScore>0&&activity.minimumScore<=activity.maxScore))return status('Informe uma nota mínima maior que zero e até a pontuação máxima.',true);
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
    if(button.dataset.activitySource){
      if(!state.loading)remember();
      const {id,kind,activityId,minimumScore,audience,recipient,sourceActivity}=state;
      const source=button.dataset.activitySource;
      if(!startActivitySelection(user,source,{id,kind,activityId,minimumScore,audience,recipient,sourceActivity})){
        status('Não foi possível preservar a convocação. Tente abrir o módulo novamente.',true);return;
      }
      const target=new URL(activitySelectionUrl(source),root.ownerDocument.location.href);
      rememberModuleNavigation(target.pathname);
      root.ownerDocument.location.assign(target);
      return;
    }
    if(button.hasAttribute('data-recover-activity')){remember();onRecover();return;}
    if(button.hasAttribute('data-reload-activities')){remember();state.preview=null;form.querySelector('[data-activity-preview]').replaceChildren();void load();void recipients();return;}
    if(button.hasAttribute('data-edit-activity')){state.preview=null;delete form.dataset.confirmation;form.querySelector('[data-activity-preview]').replaceChildren();f.preview.hidden=false;return;}
    if(!button.hasAttribute('data-confirm-activity')||state.sending||state.sent||!state.preview?.recipients.length)return;
    const description=messageWithActivityLink(state.description,state.preview.activity,state.id,root.ownerDocument.location.origin);
    if(description.length>4000){status('A orientação excede o limite após incluir o link. Reduza o texto e confira os destinatários novamente.',true);state.preview=null;form.querySelector('[data-activity-preview]').replaceChildren();return;}
    state.pending??={id:state.id,previewId:state.preview.previewId,title:state.title,description,confirmed:true};
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
