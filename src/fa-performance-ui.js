const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const points=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:1});
export function faPerformanceMarkup(data){
 if(!data)return '<p role="status">Confirmando pontuação FA…</p>';
 const {summary,team,ledger,reference}=data,credit=data.awards.filter(a=>a.sourceType==='CHECKLIST').reduce((s,a)=>s+a.points,0),delay=data.awards.filter(a=>a.sourceType==='ATRASO').reduce((s,a)=>s+a.points,0);
 const percentage=reference.maxPerformance>0?`<p>${points(summary.total/reference.maxPerformance*100)}% da referência da equipe</p>`:'';
 return `<section class="fc-performance"><h2>Desempenho FA</h2><label>Profissional <select data-fa-subject>${team.map(p=>`<option value="${esc(p.uid)}" ${p.uid===summary.uid?'selected':''}>${esc(p.displayName||p.uid)}</option>`).join('')}</select></label><h3>${points(summary.total)} pontos</h3>${percentage}<p>Checklist: ${points(credit)} · Atrasos: ${points(delay)}</p><p>Edições e cancelamentos ajustam os pontos automaticamente, sem prazo de expiração. Processamento a cada 15 minutos.</p><p>Contagem iniciada em ${esc(new Date(data.effectiveFrom).toLocaleString('pt-BR'))}, sem histórico anterior.</p>${reference.pending?'<p role="status">Há registros pendentes de confirmação de identidade ou dados.</p>':''}<button class="secondary-button" type="button" data-fa-refresh>Atualizar</button><div class="fc-performance-table"><table><thead><tr><th>Data do evento</th><th>Origem</th><th>Ajuste</th></tr></thead><tbody>${ledger.map(l=>`<tr><td>${esc(l.date)}</td><td>${l.sourceType==='ATRASO'?'Atraso':'Checklist'}</td><td>${l.delta>0?'+':''}${points(l.delta)}</td></tr>`).join('')}</tbody></table></div>${ledger.length?'':'<p>Nenhum lançamento após a ativação.</p>'}<p>Até 200 ajustes mais recentes. O saldo inclui todos os lançamentos.</p><p data-fa-status role="status" aria-live="polite"></p></section>`;
}
export function mountFaPerformanceModule(root,{uid,load,isCurrent=()=>true}){
 let disposed=false,subjectUid=uid,generation=0,running=false;
 const current=()=>!disposed&&isCurrent();
 const refresh=async()=>{if(!current()||running)return;running=true;const seq=++generation;root.innerHTML=faPerformanceMarkup(null);try{const data=await load(subjectUid);if(current()&&seq===generation)root.innerHTML=faPerformanceMarkup(data);}catch(e){if(current()&&seq===generation)root.innerHTML=`<p role="status">${e.status===403?'Acesso exclusivo de administradores.':'Pontuação ainda não confirmada. Tentaremos atualizar automaticamente.'}</p>`;}finally{running=false;}};
 const change=e=>{if(e.target.matches('[data-fa-subject]')){subjectUid=e.target.value;void refresh();}};
 const click=e=>{if(e.target.closest('[data-fa-refresh]'))void refresh();};
 root.addEventListener('change',change);root.addEventListener('click',click);void refresh();
 const timer=setInterval(()=>{if(!globalThis.document?.hidden&&globalThis.navigator?.onLine!==false)void refresh();},60000);
 return()=>{disposed=true;generation++;clearInterval(timer);root.removeEventListener('change',change);root.removeEventListener('click',click);root.replaceChildren();};
}
