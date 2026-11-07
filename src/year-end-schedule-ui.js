import './year-end-schedule.css';
import {YEAR_END_SHIFTS,YEAR_END_GROUPS,sortYearEndRegistrations,yearEndPendingParticipants,yearEndMessage} from './year-end-schedule.js';
import {yearEndOptionIcon} from './year-end-icons.js';
import {openYearEndScheduleEditor} from './year-end-schedule-editor.js';

const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=(options,id)=>options.find(o=>o.id===id)?.label||'—';
const date=value=>{
  if(!value)return '—';
  const d=typeof value.toDate==='function'?value.toDate():new Date(value);
  return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(d);
};
const options=(name,items,required=true)=>items.map(o=>`<label class="year-end-option"><input type="radio" name="${name}" value="${o.id}"${required?' required':''}><span class="year-end-option__content"><strong>${yearEndOptionIcon(o.id)}<span class="year-end-option__name">${h(o.label)}</span></strong><span class="year-end-dates">${h(o.dates)}</span>${o.detail?`<small>${h(o.detail)}</small>`:''}</span><span class="year-end-check" aria-hidden="true">✓</span></label>`).join('');

export function mountYearEndSchedule(root,{createRepository,isCurrent=()=>true,onConfirmed=()=>{},connectAccess=null}={}) {
  let disposed=false,repository=null,participation=null,stop=()=>{},closeEditor=()=>{},loadId=0,ready=false,busy=false,dirty=false,own=null,rows=[],participants=[],totals=null;
  const live=()=>!disposed&&isCurrent()&&root.isConnected;
  const form=()=>root.querySelector('[data-year-end-form]');
  root.classList.add('year-end-host');
  const selection=()=>({plantao:form()?.querySelector('[name="plantao"]:checked')?.value,grupo:participation?.requireGroup?form()?.querySelector('[name="grupo"]:checked')?.value:null});
  const notice=(text,error=false)=>{
    const feedback=root.querySelector('[data-year-end-feedback]');if(!feedback)return;
    feedback.textContent=text;feedback.classList.toggle('year-end-feedback--error',error);feedback.setAttribute('role',error?'alert':'status');
  };
  const hydrate=()=>{for(const input of form()?.querySelectorAll('input')||[])input.checked=(input.name!=='grupo'||participation.requireGroup)&&own?.[input.name]===input.value;};
  const paintForm=()=>{
    const f=form();if(!f)return;
    const chosen=selection(),complete=Boolean(chosen.plantao&&(!participation.requireGroup||chosen.grupo)),same=own&&chosen.plantao===own.plantao&&chosen.grupo===own.grupo;
    for(const fieldset of f.querySelectorAll('fieldset'))fieldset.disabled=!ready||busy||fieldset.dataset.yearEndCategory==='grupo'&&!participation.requireGroup;
    const button=f.querySelector('button');button.disabled=!ready||busy||!complete||Boolean(same);
    button.textContent='CONFIRMA ESCOLHAS';
    f.setAttribute('aria-busy',String(busy));
  };
  const paintRows=()=>{
    for(const element of root.querySelectorAll('[data-year-end-count]'))element.textContent=totals?String(totals[element.dataset.yearEndCount]):'—';
    if(!participation?.isAdmin)return;
    const pending=yearEndPendingParticipants(rows,participants),entries=[...sortYearEndRegistrations(rows),...pending.map(person=>({...person,pending:true}))];
    root.querySelector('[data-year-end-total]').textContent=rows.length+' '+(rows.length===1?'inscrição':'inscrições')+(ready?' · '+pending.length+' '+(pending.length===1?'pendente':'pendentes'):'');
    root.querySelector('[data-year-end-rows]').innerHTML=entries.length?entries.map(r=>{
      const classes=[r.pending?'year-end-pending':'',r.uid===repository?.uid?'year-end-own':''].filter(Boolean).join(' '),exempt=r.pending?!r.requireGroup:r.grupo===null;
      return `<tr${classes?` class="${classes}"`:''}><td><span class="year-end-position">${r.pending?'—':h(r.position)+'º'}</span></td><th scope="row">${h(r.sigla||(r.pending?'Sem sigla':'—'))}${r.uid===repository?.uid?'<small class="year-end-you">Você</small>':''}</th><td><span class="year-end-tag year-end-tag--${r.pending?'pending':h(r.plantao)}">${r.pending?'Pendente':h(label(YEAR_END_SHIFTS,r.plantao))}</span></td><td>${exempt?'<span class="year-end-exempt">Dispensado</span>':r.pending?'Pendente':h(label(YEAR_END_GROUPS,r.grupo))}</td><td>${r.pending?'—':h(date(r.createdAt))}</td><td><button type="button" class="year-end-edit-button" data-year-end-edit="${h(r.uid)}" aria-label="Editar escolhas de ${h(r.sigla||'participante sem sigla')}"${participants.some(person=>person.uid===r.uid)?'':' disabled'}>EDITAR</button></td></tr>`;
    }).join(''):`<tr><td colspan="6" class="year-end-empty">${ready?'As primeiras escolhas começam aqui. Confirme as suas para entrar na lista.':'Carregando inscrições…'}</td></tr>`;
  };
  const render=()=>{
    root.innerHTML=`<section class="year-end${participation.isAdmin?' year-end--administrator':''}" aria-label="Escolhas para a escala final de ano">
      ${participation.canParticipate?`<form data-year-end-form>
        <div class="year-end-fields"><fieldset data-year-end-category="plantao" disabled><legend>ESCOLHO O PLANTÃO:</legend>${options('plantao',YEAR_END_SHIFTS)}</fieldset>
        <fieldset data-year-end-category="grupo"${participation.requireGroup?'':' class="year-end-fieldset--inactive"'} disabled><legend>ESCOLHO O GRUPO DE TRABALHO:</legend>${options('grupo',YEAR_END_GROUPS,participation.requireGroup)}</fieldset></div>
        <div class="year-end-confirm"><div class="year-end-feedback" data-year-end-feedback role="status" aria-live="polite"></div><button type="submit" class="primary-button year-end-submit" disabled>CONFIRMA ESCOLHAS</button></div>
      </form>`:''}
      ${participation.isAdmin?`<div class="year-end-admin" data-year-end-admin role="region" aria-label="Informações da administração" tabindex="0">
      <section class="year-end-counts" aria-labelledby="year-end-counts-title"><span class="year-end-section-label">PARTICIPAÇÃO DA EQUIPE</span><h3 id="year-end-counts-title">Quantidade de escolhas</h3><p>Totais por opção, atualizados a cada confirmação.</p><div class="year-end-count-groups">${[['Plantões',[['Plantão Natal','plantaoNatal'],['Plantão Réveillon','plantaoReveillon'],['Plantão Carnaval','plantaoCarnaval']]],['Grupos de trabalho',[['Grupo Natal','grupoNatal'],['Grupo Réveillon','grupoReveillon']]]].map(([title,items])=>`<article><h4>${h(title)}</h4><dl>${items.map(([text,key])=>`<div><dt>${h(text)}</dt><dd data-year-end-count="${key}">—</dd></div>`).join('')}</dl></article>`).join('')}</div></section>
      <section class="year-end-ranking" aria-labelledby="year-end-ranking-title"><header><div><span class="year-end-section-label">ACESSO DO ADMINISTRADOR · ORDEM DE ESCOLHA</span><h3 id="year-end-ranking-title">Marcações da equipe</h3></div><span class="year-end-total" data-year-end-total>0 inscrições</span></header><p>Siglas em ordem de confirmação. Ao final, quem ainda não escolheu aparece como Pendente.</p>
      <p class="year-end-feedback" data-year-end-admin-feedback role="status" aria-live="polite"></p><div class="year-end-table-wrap"><table><caption class="year-end-sr">Siglas da equipe em ordem de confirmação, seguidas das pendentes</caption><thead><tr><th scope="col">Posição</th><th scope="col">Sigla</th><th scope="col">Plantão</th><th scope="col">Grupo de trabalho</th><th scope="col">Confirmado em</th><th scope="col">Controle</th></tr></thead><tbody data-year-end-rows></tbody></table></div></section>
      </div>`:''}
    </section>`;
    hydrate();paintForm();paintRows();
  };
  const failed=error=>{
    closeEditor();
    ready=false;rows=[];participants=[];totals=null;own=null;dirty=false;participation=null;
    const excluded=error.code==='YEAR_END_INELIGIBLE';
    root.innerHTML=`<section class="year-end year-end-denied" role="alert"><h3>${excluded?'Acesso indisponível':'Não foi possível abrir a escala'}</h3><p>${h(yearEndMessage(error))}</p>${error.code==='YEAR_END_AUTH_REQUIRED'&&typeof connectAccess==='function'?'<button type="button" class="primary-button" data-year-end-connect>CONECTAR ESCALA COM GOOGLE</button>':''}${excluded?'':'<button type="button" class="secondary-button" data-year-end-retry>TENTAR NOVAMENTE</button>'}</section>`;
  };
  async function connect() {
    closeEditor();
    const ticket=++loadId;stop();stop=()=>{};ready=false;busy=false;dirty=false;rows=[];participants=[];totals=null;own=null;participation=null;
    root.innerHTML='<p role="status">Conferindo sua participação na equipe…</p>';
    const current=()=>live()&&ticket===loadId;
    try {
      repository=await createRepository(current);if(!current())return;
      participation=await repository.open();if(!current())return;
      render();
      stop=repository.subscribe(state=>{
        if(!current())return;
        rows=participation.isAdmin?state.rows||[]:[];participants=participation.isAdmin?state.participants||[]:[];totals=state.totals;own=state.own;ready=true;
        if(!dirty)hydrate();paintForm();paintRows();
      },error=>{if(current())failed(error);});
      if(!current())stop();
    } catch(error) {if(current())failed(error);}
  }
  const change=event=>{if(!event.target.matches('input[type="radio"]'))return;dirty=true;notice('');paintForm();};
  const submit=async event=>{
    if(!event.target.matches('[data-year-end-form]'))return;
    event.preventDefault();if(!live()||!ready||busy||!form()?.reportValidity())return;
    const input=selection();busy=true;notice('');paintForm();
    try {
      const result=await repository.save(input);if(!live())return;
      own=result;dirty=false;hydrate();notice(result.updated?'Escolhas atualizadas.':'Escolhas confirmadas!');
      onConfirmed(result,participation);
    } catch(error){if(live()){if(['YEAR_END_INELIGIBLE','permission-denied'].includes(error.code))failed(error);else notice(yearEndMessage(error),true);}}
    finally{busy=false;if(live())paintForm();}
  };
  const click=event=>{
    const edit=event.target.closest('[data-year-end-edit]');
    if(edit&&participation?.isAdmin&&ready&&!busy){
      const person=participants.find(p=>p.uid===edit.dataset.yearEndEdit);if(!person)return;
      closeEditor();closeEditor=openYearEndScheduleEditor(root,{person,record:rows.find(r=>r.uid===person.uid),renderOptions:options,isCurrent:live,save:input=>repository.saveFor(person.uid,input),onSaved:result=>{
        if(!live())return;
        root.querySelector('[data-year-end-admin-feedback]').textContent=`Escolhas de ${person.sigla||'participante sem sigla'} ${result.updated?'atualizadas':'confirmadas'}.`;
        if(result.uid===repository.uid){own=result;dirty=false;hydrate();paintForm();onConfirmed(result,participation);}
      }});return;
    }
    if(event.target.closest('[data-year-end-retry]'))void connect();
    const button=event.target.closest('[data-year-end-connect]');
    if(button&&typeof connectAccess==='function'){
      button.disabled=true;
      void Promise.resolve().then(()=>connectAccess()).then(()=>{if(live())void connect();},()=>{if(live()){button.disabled=false;root.querySelector('.year-end-denied p').textContent='Não foi possível conectar. Tente novamente com a mesma conta Google do app.';}});
    }
  };
  root.addEventListener('change',change);root.addEventListener('submit',submit);root.addEventListener('click',click);void connect();
  return ()=>{disposed=true;loadId++;stop();closeEditor();rows=[];participants=[];own=null;root.removeEventListener('change',change);root.removeEventListener('submit',submit);root.removeEventListener('click',click);root.replaceChildren();root.classList.remove('year-end-host');};
}
