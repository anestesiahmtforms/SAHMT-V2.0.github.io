import './year-end-schedule.css';
import {YEAR_END_SHIFTS,YEAR_END_GROUPS,sortYearEndRegistrations,yearEndMessage} from './year-end-schedule.js';

const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=(options,id)=>options.find(o=>o.id===id)?.label||'—';
const date=value=>{
  if(!value)return '—';
  const d=typeof value.toDate==='function'?value.toDate():new Date(value);
  return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(d);
};
const options=(name,items)=>items.map(o=>`<label class="year-end-option"><input type="radio" name="${name}" value="${o.id}" required><span><strong>${h(o.label)}</strong><span class="year-end-dates">${h(o.dates)}</span>${o.detail?`<small>${h(o.detail)}</small>`:''}</span><span class="year-end-check" aria-hidden="true">✓</span></label>`).join('');

export function mountYearEndSchedule(root,{createRepository,isCurrent=()=>true}={}) {
  let disposed=false,repository=null,stop=()=>{},loadId=0,ready=false,busy=false,dirty=false,own=null,rows=[];
  const live=()=>!disposed&&isCurrent()&&root.isConnected;
  root.classList.add('year-end-host');
  root.innerHTML=`<section class="year-end" aria-label="Escolhas para a escala final de ano">
    <div class="year-end-intro"><span class="year-end-season">NATAL & RÉVEILLON · 2026 / 2027</span><h3>Seu plantão. Seu grupo.</h3><p>Escolha uma opção em cada categoria e confirme sua participação.</p><span class="year-end-connection" data-year-end-connection>Conectando…</span></div>
    <form data-year-end-form>
      <div class="year-end-fields"><fieldset disabled><legend><span>1</span> Escolho o plantão</legend><p>Selecione apenas um plantão.</p>${options('plantao',YEAR_END_SHIFTS)}</fieldset>
      <fieldset disabled><legend><span>2</span> Escolho o grupo de trabalho</legend><p>Selecione apenas um grupo.</p>${options('grupo',YEAR_END_GROUPS)}</fieldset></div>
      <div class="year-end-confirm"><p data-year-end-summary>Falta escolher seu plantão e seu grupo.</p><button type="submit" class="primary-button year-end-submit" disabled>CONFIRMAR ESCOLHAS <span aria-hidden="true">→</span></button><small>Sua posição é definida na primeira confirmação. Ao atualizar as opções, ela é mantida.</small></div>
    </form>
    <div class="year-end-feedback" data-year-end-feedback role="status" aria-live="polite"></div><button type="button" class="secondary-button" data-year-end-retry hidden>TENTAR NOVAMENTE</button>
    <section class="year-end-ranking" aria-labelledby="year-end-ranking-title"><header><div><span class="year-end-section-label">ORDEM DE ESCOLHA</span><h3 id="year-end-ranking-title">Participação da equipe</h3></div><span class="year-end-total" data-year-end-total>0 inscrições</span></header><p>A lista segue a ordem de confirmação das escolhas.</p>
    <div class="year-end-table-wrap"><table><caption class="year-end-sr">Inscrições em ordem de confirmação</caption><thead><tr><th scope="col">Posição</th><th scope="col">Integrante</th><th scope="col">Plantão</th><th scope="col">Grupo de trabalho</th><th scope="col">Confirmado em</th></tr></thead><tbody data-year-end-rows><tr><td colspan="5" class="year-end-empty">Carregando inscrições…</td></tr></tbody></table></div></section>
  </section>`;
  const form=root.querySelector('form'),feedback=root.querySelector('[data-year-end-feedback]'),retry=root.querySelector('[data-year-end-retry]');
  const selection=()=>({plantao:form.querySelector('[name="plantao"]:checked')?.value,grupo:form.querySelector('[name="grupo"]:checked')?.value});
  const notice=(text,error=false)=>{feedback.textContent=text;feedback.classList.toggle('year-end-feedback--error',error);feedback.setAttribute('role',error?'alert':'status');};
  const hydrate=()=>{for(const input of form.querySelectorAll('input'))input.checked=own?.[input.name]===input.value;};
  const paintForm=()=>{
    const chosen=selection(),complete=Boolean(chosen.plantao&&chosen.grupo),same=own&&chosen.plantao===own.plantao&&chosen.grupo===own.grupo;
    for(const fieldset of form.querySelectorAll('fieldset'))fieldset.disabled=!ready||busy;
    const button=form.querySelector('button');button.disabled=!ready||busy||!complete||Boolean(same);
    button.textContent=busy?'CONFIRMANDO…':same?'ESCOLHAS REGISTRADAS':own?'ATUALIZAR ESCOLHAS':'CONFIRMAR ESCOLHAS →';
    form.setAttribute('aria-busy',String(busy));
    root.querySelector('[data-year-end-summary]').textContent=complete?`${label(YEAR_END_SHIFTS,chosen.plantao)} + ${label(YEAR_END_GROUPS,chosen.grupo)}${own?' · Sua posição: '+own.position+'º':''}`:'Falta escolher '+(!chosen.plantao&&!chosen.grupo?'seu plantão e seu grupo.':!chosen.plantao?'seu plantão.':'seu grupo.');
  };
  const paintRows=()=>{
    root.querySelector('[data-year-end-total]').textContent=rows.length+' '+(rows.length===1?'inscrição':'inscrições');
    root.querySelector('[data-year-end-rows]').innerHTML=rows.length?sortYearEndRegistrations(rows).map(r=>`<tr${r.uid===repository?.uid?' class="year-end-own"':''}><td><span class="year-end-position">${h(r.position)}º</span></td><th scope="row">${h(r.displayName)}${r.uid===repository?.uid?'<small class="year-end-you">Você</small>':''}</th><td><span class="year-end-tag year-end-tag--${r.plantao==='natal'?'natal':'reveillon'}">${h(label(YEAR_END_SHIFTS,r.plantao))}</span></td><td>${h(label(YEAR_END_GROUPS,r.grupo))}</td><td>${h(date(r.createdAt))}</td></tr>`).join(''):`<tr><td colspan="5" class="year-end-empty">${ready?'As primeiras escolhas começam aqui. Confirme as suas para entrar na lista.':'A lista estará disponível quando a conexão for confirmada.'}</td></tr>`;
  };
  async function connect() {
    const ticket=++loadId;stop();stop=()=>{};ready=false;retry.hidden=true;notice('');paintForm();
    const current=()=>live()&&ticket===loadId;
    try {
      repository=await createRepository(current);if(!current())return;
      await repository.open();if(!current())return;
      stop=repository.subscribe(state=>{
        if(!current())return;
        rows=state.rows;own=rows.find(r=>r.uid===repository.uid)||null;ready=true;
        if(!dirty)hydrate();paintForm();paintRows();
        root.querySelector('[data-year-end-connection]').textContent=state.fromCache?'Cópia em cache · reconectando':'Atualização em tempo real';
      },error=>{if(!current())return;ready=false;rows=[];own=null;dirty=false;hydrate();paintForm();paintRows();notice(yearEndMessage(error),true);retry.hidden=false;root.querySelector('[data-year-end-connection]').textContent='Conexão indisponível';});
      if(!current())stop();
    } catch(error) {
      if(!current())return;
      ready=false;rows=[];own=null;dirty=false;hydrate();paintForm();paintRows();notice(yearEndMessage(error),true);retry.hidden=false;root.querySelector('[data-year-end-connection]').textContent='Conexão indisponível';
    }
  }
  const change=()=>{dirty=true;notice('');paintForm();};
  const submit=async event=>{
    event.preventDefault();if(!live()||!ready||busy||!form.reportValidity())return;
    const input=selection();busy=true;notice('');paintForm();
    try {
      const result=await repository.save(input);if(!live())return;
      own=result;dirty=false;hydrate();notice(result.updated?`Escolhas atualizadas. Você continua na ${result.position}ª posição.`:`Escolhas confirmadas! Você está na ${result.position}ª posição.`);
    } catch(error){if(live())notice(yearEndMessage(error),true);}
    finally{busy=false;if(live())paintForm();}
  };
  form.addEventListener('change',change);form.addEventListener('submit',submit);retry.addEventListener('click',connect);void connect();
  return ()=>{disposed=true;loadId++;stop();rows=[];own=null;form.removeEventListener('change',change);form.removeEventListener('submit',submit);retry.removeEventListener('click',connect);root.replaceChildren();root.classList.remove('year-end-host');};
}
