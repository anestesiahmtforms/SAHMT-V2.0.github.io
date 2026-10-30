import './year-end-schedule.css';
import {YEAR_END_SHIFTS,YEAR_END_GROUPS,sortYearEndRegistrations,yearEndMessage} from './year-end-schedule.js';

const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=(options,id)=>options.find(o=>o.id===id)?.label||'—';
const date=value=>{
  if(!value)return '—';
  const d=typeof value.toDate==='function'?value.toDate():new Date(value);
  return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(d);
};
const options=(name,items,required=true)=>items.map(o=>`<label class="year-end-option"><input type="radio" name="${name}" value="${o.id}"${required?' required':''}><span><strong>${h(o.label)}</strong><span class="year-end-dates">${h(o.dates)}</span>${o.detail?`<small>${h(o.detail)}</small>`:''}</span><span class="year-end-check" aria-hidden="true">✓</span></label>`).join('');

export function mountYearEndSchedule(root,{createRepository,isCurrent=()=>true}={}) {
  let disposed=false,repository=null,participation=null,stop=()=>{},loadId=0,ready=false,busy=false,dirty=false,own=null,rows=[];
  const live=()=>!disposed&&isCurrent()&&root.isConnected;
  const form=()=>root.querySelector('form');
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
    button.textContent=busy?'CONFIRMANDO…':same?'ESCOLHAS REGISTRADAS':own?'ATUALIZAR ESCOLHAS':'CONFIRMAR ESCOLHAS →';
    f.setAttribute('aria-busy',String(busy));
    const groupSummary=participation.requireGroup?label(YEAR_END_GROUPS,chosen.grupo):'Grupo dispensado para '+participation.sigla;
    root.querySelector('[data-year-end-summary]').textContent=complete?`${label(YEAR_END_SHIFTS,chosen.plantao)} · ${groupSummary}${own?' · Sua posição: '+own.position+'º':''}`:!chosen.plantao?(participation.requireGroup&&!chosen.grupo?'Escolha seu plantão e seu grupo.':'Escolha seu plantão. Obrigatório para participar.'):'Escolha seu grupo de trabalho. Obrigatório para participar.';
  };
  const paintRows=()=>{
    root.querySelector('[data-year-end-total]').textContent=rows.length+' '+(rows.length===1?'inscrição':'inscrições');
    root.querySelector('[data-year-end-rows]').innerHTML=rows.length?sortYearEndRegistrations(rows).map(r=>`<tr${r.uid===repository?.uid?' class="year-end-own"':''}><td><span class="year-end-position">${h(r.position)}º</span></td><th scope="row">${h(r.sigla||'—')}${r.uid===repository?.uid?'<small class="year-end-you">Você</small>':''}</th><td><span class="year-end-tag year-end-tag--${r.plantao==='natal'?'natal':'reveillon'}">${h(label(YEAR_END_SHIFTS,r.plantao))}</span></td><td>${r.grupo===null?'<span class="year-end-exempt">Dispensado</span>':h(label(YEAR_END_GROUPS,r.grupo))}</td><td>${h(date(r.createdAt))}</td></tr>`).join(''):`<tr><td colspan="5" class="year-end-empty">${ready?'As primeiras escolhas começam aqui. Confirme as suas para entrar na lista.':'Carregando inscrições…'}</td></tr>`;
  };
  const render=()=>{
    root.innerHTML=`<section class="year-end" aria-label="Escolhas para a escala final de ano">
      <div class="year-end-intro"><span class="year-end-season">NATAL & RÉVEILLON · 2026 / 2027</span><h3>${participation.requireGroup?'Seu plantão. Seu grupo.':'Seu plantão.'}</h3><p>${participation.requireGroup?'Plantão e grupo de trabalho são obrigatórios para a equipe efetiva.':`Para a sigla ${h(participation.sigla)}, somente o plantão é obrigatório. O grupo de trabalho está desativado.`}</p><span class="year-end-connection" data-year-end-connection>Conectando…</span></div>
      <form data-year-end-form>
        <div class="year-end-fields"><fieldset data-year-end-category="plantao" disabled><legend><span>1</span> Escolho o plantão</legend><p>Obrigatório · selecione apenas um plantão.</p>${options('plantao',YEAR_END_SHIFTS)}</fieldset>
        <fieldset data-year-end-category="grupo"${participation.requireGroup?'':' class="year-end-fieldset--inactive"'} disabled><legend><span>2</span> Escolho o grupo de trabalho</legend><p>${participation.requireGroup?'Obrigatório · selecione apenas um grupo.':`Dispensado para ${h(participation.sigla)} · campo inativo.`}</p>${options('grupo',YEAR_END_GROUPS,participation.requireGroup)}</fieldset></div>
        <div class="year-end-confirm"><p data-year-end-summary></p><button type="submit" class="primary-button year-end-submit" disabled>CONFIRMAR ESCOLHAS →</button><small>Sua posição é definida na primeira confirmação. Ao atualizar as opções, ela é mantida.</small></div>
      </form>
      <div class="year-end-feedback" data-year-end-feedback role="status" aria-live="polite"></div><button type="button" class="secondary-button" data-year-end-retry hidden>TENTAR NOVAMENTE</button>
      <section class="year-end-ranking" aria-labelledby="year-end-ranking-title"><header><div><span class="year-end-section-label">ORDEM DE ESCOLHA</span><h3 id="year-end-ranking-title">Participação da equipe</h3></div><span class="year-end-total" data-year-end-total>0 inscrições</span></header><p>A lista usa as siglas e segue a ordem de confirmação.</p>
      <div class="year-end-table-wrap"><table><caption class="year-end-sr">Siglas da equipe em ordem de confirmação</caption><thead><tr><th scope="col">Posição</th><th scope="col">Sigla</th><th scope="col">Plantão</th><th scope="col">Grupo de trabalho</th><th scope="col">Confirmado em</th></tr></thead><tbody data-year-end-rows></tbody></table></div></section>
    </section>`;
    hydrate();paintForm();paintRows();
  };
  const failed=error=>{
    ready=false;rows=[];own=null;dirty=false;participation=null;
    const excluded=error.code==='YEAR_END_INELIGIBLE';
    root.innerHTML=`<section class="year-end year-end-denied" role="alert"><h3>${excluded?'Acesso indisponível':'Não foi possível abrir a escala'}</h3><p>${h(yearEndMessage(error))}</p>${excluded?'':'<button type="button" class="secondary-button" data-year-end-retry>TENTAR NOVAMENTE</button>'}</section>`;
  };
  async function connect() {
    const ticket=++loadId;stop();stop=()=>{};ready=false;busy=false;dirty=false;rows=[];own=null;participation=null;
    root.innerHTML='<p role="status">Conferindo sua participação na equipe…</p>';
    const current=()=>live()&&ticket===loadId;
    try {
      repository=await createRepository(current);if(!current())return;
      participation=await repository.open();if(!current())return;
      render();
      stop=repository.subscribe(state=>{
        if(!current())return;
        rows=state.rows;own=rows.find(r=>r.uid===repository.uid)||null;ready=true;
        if(!dirty)hydrate();paintForm();paintRows();
        root.querySelector('[data-year-end-connection]').textContent=state.fromCache?'Cópia em cache · reconectando':'Atualização em tempo real';
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
      own=result;dirty=false;hydrate();notice(result.updated?`Escolhas atualizadas. Você continua na ${result.position}ª posição.`:`Escolhas confirmadas! Você está na ${result.position}ª posição.`);
    } catch(error){if(live()){if(['YEAR_END_INELIGIBLE','permission-denied'].includes(error.code))failed(error);else notice(yearEndMessage(error),true);}}
    finally{busy=false;if(live())paintForm();}
  };
  const click=event=>{if(event.target.closest('[data-year-end-retry]'))void connect();};
  root.addEventListener('change',change);root.addEventListener('submit',submit);root.addEventListener('click',click);void connect();
  return ()=>{disposed=true;loadId++;stop();rows=[];own=null;root.removeEventListener('change',change);root.removeEventListener('submit',submit);root.removeEventListener('click',click);root.replaceChildren();root.classList.remove('year-end-host');};
}
