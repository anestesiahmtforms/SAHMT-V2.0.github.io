import {escapeNoticeHtml as esc,linkedNoticeText} from './communication-notice-text.js';
import {activityDeadlineFields,activityDescription,deadlineHoursFromForm} from './communication-activity-ui.js';
import {obligationDueAt,validObligationHours} from '../communication/obligations.js';

export function communicationDate(value) {
  if (!value) return 'Não registrado';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não registrado';
}
const recipientStatus=(person,activity)=>person.status==='CANCELLED'?'Cancelada':person.status==='COMPLETED'?'Concluída':activity?'Atividade pendente':person.readAt?'Mensagem aberta':'Abertura não registrada';

export function openCommunicationHistory({root,client,render,status,report,isCurrent,audienceOptions,onRecover}) {
  render('MENSAGENS ENVIADAS',`<form data-history-filters class="comm-history-filters">
    <label>De<input type="date" name="from"></label><label>Até<input type="date" name="to"></label>
    <label>Tipo<select name="kind" aria-label="Tipo"><option value="">Todos</option><option value="MESSAGE">Mensagem</option><option value="TRAINING">Treinamento</option><option value="SURVEY">Enquete</option></select></label>
    <label>Público<select name="audience"><option value="">Todos os públicos</option>${audienceOptions.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>
    <label class="comm-history-search">Pesquisar título, texto ou remetente<input type="search" name="search" maxlength="200"></label><button type="submit">FILTRAR</button>
    </form><p class="comm-note">Datas em America/Sao_Paulo. Abrir a mensagem registra a abertura, sem afirmar compreensão. Aceitação do push não comprova entrega nem leitura.</p>
    <div data-sent-list></div><button type="button" data-history-next hidden>CARREGAR MAIS</button>`,{inbox:true,sent:true});
  const form=root.querySelector('[data-history-filters]'),list=root.querySelector('[data-sent-list]'),more=root.querySelector('[data-history-next]');
  const current=()=>isCurrent()&&form.isConnected;
  let filters={},cursor='',loading=false,requestTicket=0;
  const items=new Map();
  const recover=error=>{if(['COMM_SESSION_INVALID','COMM_IDENTITY_MISMATCH'].includes(error.code)){onRecover();return true;}return false;};
  function metadata(message){
    const audience=audienceOptions.find(o=>o.id===(message.audienceType==='GROUP'?message.audienceValue:message.audienceType))?.name||message.audienceValue||message.audienceType;
    return `${esc(message.sender||message.senderEmail||message.createdBy?.email||'Remetente não registrado')} · Publicado no app: ${esc(communicationDate(message.publishAt))} · ${esc(audience||'Público não registrado')}`;
  }
  async function load(reset=false){
    if(loading&&!reset)return;const ticket=++requestTicket;loading=true;more.disabled=true;
    if(reset){cursor='';list.replaceChildren();items.clear();}status('Carregando histórico…');
    try{const page=await client.request('SENT_MESSAGES',{cursor,...(Object.keys(filters).length?{filters}:{})});if(!current()||ticket!==requestTicket)return;
      for(const item of page.items){if(items.has(item.id))continue;items.set(item.id,item);
        list.insertAdjacentHTML('beforeend',`<details class="comm-card" data-sent-id="${esc(item.id)}"><summary><strong>${esc(item.title)}</strong></summary><p>${metadata(item)}</p><p class="comm-message">${linkedNoticeText(item.message||'')}</p><div data-history-detail></div></details>`);
      }
      if(page.cursor&&page.cursor===cursor)throw Error('COMM_CURSOR_REPEATED');cursor=page.cursor||'';more.hidden=!cursor;more.textContent='CARREGAR MAIS';status(items.size||cursor?'':'Nenhuma mensagem encontrada.');
    }catch(error){if(!current()||ticket!==requestTicket)return;if(recover(error))return;more.hidden=false;more.textContent='TENTAR NOVAMENTE';report(error,'Histórico indisponível. Tente novamente.');}
    finally{if(current()&&ticket===requestTicket){loading=false;more.disabled=false;}}
  }
  async function detail(card,force=false){
    const container=card.querySelector('[data-history-detail]');if(container.dataset.loading||container.dataset.loaded&&!force)return;
    const item=items.get(card.dataset.sentId);if(!item)return;
    container.dataset.loading='true';container.textContent='Carregando destinatários e registros…';
    try{const result=await client.request('SENT_DETAIL',{id:item.id,...(item.historyRow?{historyRow:item.historyRow}:{})});if(!current()||!card.isConnected)return;
      const message=result.message;card.querySelector('.comm-message').innerHTML=linkedNoticeText(message.message||message.description||'');
      const dueAt=message.activity?obligationDueAt(message):0;
      const canChangeDeadline=dueAt>0&&message.status==='published'&&result.recipients.some(person=>person.status==='PENDING');
      container.innerHTML=`${message.activity?`<p>${esc(activityDescription(message.activity))}</p>`:''}
        ${dueAt?`<p>Prazo atual: <strong>${esc(communicationDate(dueAt))}</strong></p>`:''}
        <p>${result.syncPending?'Arquivamento pendente de sincronização.':'Sem sincronização pendente informada.'}</p>
        ${message.cancellationReason?`<p>Cancelamento: ${esc(message.cancellationReason)}</p>`:''}
        <p class="comm-note">Push: ${esc(message.pushStatus||'situação não registrada neste histórico')}.</p>
        ${!result.recipientsRecorded?'<p>Destinatários e leituras: não registrado no envio original.</p>':`<h4>${result.recipients.length} destinatário(s) registrado(s) no envio</h4>
        <label>Filtrar destinatário ou situação<input type="search" data-recipient-filter placeholder="Nome, e-mail, grupo ou situação"></label>
        <div class="comm-history-recipients">${result.recipients.map(person=>`<article class="comm-recipient-record"><h4>${esc(person.displayName||person.email||person.uid)}</h4><p>${esc(person.email)} · ${esc(person.institutionalGroup)} · ${esc(person.uid)}</p><p>${esc(recipientStatus(person,message.activity))}</p><p>Mensagem aberta: ${person.readAt?esc(communicationDate(person.readAt)):'não registrada'}</p>${message.activity?`<p>Conclusão confirmada: ${person.completedAt?esc(communicationDate(person.confirmedAt||person.completedAt)):'não registrada'}</p>${person.sourceCompletedAt?`<p>Conclusão na origem: ${esc(communicationDate(person.sourceCompletedAt))}</p>`:''}${person.score!=null?`<p>Nota confirmada: ${esc(person.score)}</p>`:''}`:''}</article>`).join('')}</div>`}
        ${result.syncPending?'<button type="button" data-history-retry>REPETIR SINCRONIZAÇÃO</button>':''}
        ${canChangeDeadline?`<form data-update-activity-deadline data-due-at="${dueAt}">${activityDeadlineFields('Novo prazo a partir de agora')}<button type="submit">ALTERAR PRAZO</button></form>`:''}
        ${message.activity&&message.status!=='cancelled'?'<form data-cancel-activity><label>Justificativa do cancelamento<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><button type="submit">CANCELAR CONVOCAÇÃO</button><p class="comm-note">Encerra as pendências desta convocação para todos os destinatários. A justificativa fica registrada no histórico.</p></form>':''}`;
      container.dataset.loaded='true';
    }catch(error){if(!current()||!card.isConnected)return;if(recover(error))return;container.innerHTML='<p>Não foi possível consultar os registros.</p><button type="button" data-detail-retry>TENTAR NOVAMENTE</button>';report(error);}
    finally{delete container.dataset.loading;}
  }
  form.addEventListener('submit',event=>{event.preventDefault();const f=form.elements;filters={};
    if(f.from.value)filters.from=Date.parse(f.from.value+'T00:00:00-03:00');if(f.to.value)filters.to=Date.parse(f.to.value+'T23:59:59.999-03:00');
    if(filters.from&&filters.to&&filters.from>filters.to)return status('O início do período deve ser anterior ao fim.',true);
    for(const name of ['kind','audience','search'])if(f[name].value.trim())filters[name]=f[name].value.trim();void load(true);
  });
  more.addEventListener('click',()=>void load());
  list.addEventListener('toggle',event=>{const card=event.target;if(card.matches('[data-sent-id]')&&card.open)void detail(card);},true);
  list.addEventListener('input',event=>{if(!event.target.matches('[data-recipient-filter]'))return;const query=event.target.value.toLocaleLowerCase('pt-BR');for(const row of event.target.closest('[data-history-detail]').querySelectorAll('.comm-recipient-record'))row.hidden=!row.textContent.toLocaleLowerCase('pt-BR').includes(query);});
  list.addEventListener('click',async event=>{const button=event.target.closest('button'),card=button?.closest('[data-sent-id]');if(!card||button.disabled)return;
    if(button.hasAttribute('data-detail-retry'))return void detail(card,true);
    if(!button.hasAttribute('data-history-retry'))return;button.disabled=true;
    try{await client.request('HISTORY_RETRY',{id:card.dataset.sentId});if(current()&&card.isConnected){status('Sincronização solicitada. Reabra os registros para conferir o resultado.');await detail(card,true);}}
    catch(error){if(current())report(error,'Não foi possível solicitar a sincronização. Tente novamente.');}finally{button.disabled=false;}
  });
  list.addEventListener('submit',async event=>{if(!event.target.matches('[data-cancel-activity]'))return;event.preventDefault();const cancelForm=event.target,button=cancelForm.querySelector('button'),card=cancelForm.closest('[data-sent-id]');if(button.disabled)return;
    const reason=cancelForm.elements.reason.value.trim();if(reason.length<5)return status('Descreva a justificativa com ao menos cinco caracteres.',true);button.disabled=true;
    try{await client.request('CANCEL_ACTIVITY',{id:card.dataset.sentId,reason});if(current()&&card.isConnected){status('Convocação cancelada. Justificativa registrada.');await detail(card,true);}}
    catch(error){if(current())report(error,'Não foi possível confirmar o cancelamento. Tente novamente.');}finally{button.disabled=false;}
  });
  list.addEventListener('submit',async event=>{
    const deadlineForm=event.target;if(!deadlineForm.matches('[data-update-activity-deadline]'))return;
    event.preventDefault();
    const button=deadlineForm.querySelector('button'),card=deadlineForm.closest('[data-sent-id]');
    if(button.disabled||!current())return;
    const deadlineHours=deadlineHoursFromForm(deadlineForm.elements);
    if(!validObligationHours(deadlineHours,Date.now()))return status('Informe um prazo válido em dias ou horas.',true);
    button.disabled=true;
    try{
      const result=await client.request('UPDATE_ACTIVITY_DEADLINE',{id:card.dataset.sentId,deadlineHours,expectedDueAt:Number(deadlineForm.dataset.dueAt)});
      if(current()&&card.isConnected){status(`Prazo alterado para ${communicationDate(result.dueAt)}.`);await detail(card,true);}
    }catch(error){
      if(!current()||!card.isConnected||recover(error))return;
      if(error.code==='COMM_ACTIVITY_DEADLINE_CHANGED'){
        status('O prazo mudou. Confira o prazo atual antes de alterar novamente.',true);
        await detail(card,true);
      }else report(error,'Não foi possível confirmar a alteração do prazo.');
    }finally{button.disabled=false;}
  });
  void load();
}
