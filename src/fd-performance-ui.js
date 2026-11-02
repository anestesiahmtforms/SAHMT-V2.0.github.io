import {fdPerformancePresentation} from './fd-performance-data.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
const time=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('pt-BR'):'Aguardando confirmação';};
const states={loading:'Carregando seu desempenho FD…',preparing:'O Desempenho FD está em preparação.',pending:'As pontuações estão sendo confirmadas.',offline:'Conecte-se à internet para confirmar seu saldo FD.',blocked:'Não foi possível confirmar seu acesso ao Desempenho FD.'};
function readings(metric){
 const points=metric.latest?[metric.latest]:(metric.months||[]).filter(row=>row.status!=='FUTURE');
 if(!points.length)return '<p>Aguardando a publicação dos resultados deste indicador.</p>';
 return `<details><summary>Consultar resultados de ${escape(metric.year)}</summary><div class="fd-performance-table"><table><thead><tr><th>Período</th><th>Resultado</th><th>Análise</th></tr></thead><tbody>${points.map(row=>`<tr><td>${escape(row.period)}</td><td>${['VALID','PARTIAL'].includes(row.status)&&Number.isFinite(row.value)?escape(number(row.value)+' '+(metric.unit||'')):'—'}</td><td>${escape(row.analysis||'Resultado ainda não disponível.')}</td></tr>`).join('')}</tbody></table></div></details>`;
}

export function fdPerformanceMarkup(snapshot){
 const view=snapshot?fdPerformancePresentation(snapshot):{state:'loading'};
 const header='<header><p class="eyebrow">INDICADORES</p><h2>Desempenho FD</h2><p>Ciência vale 1 ponto. Sugestões aprovadas por outra pessoa valem 2 pontos.</p></header>';
 if(view.state!=='ready')return `<section class="fd-performance">${header}<p role="status" class="empty-state">${states[view.state]||states.blocked}</p></section>`;
 const awards=snapshot.awards||[],suggestions=snapshot.suggestions||[];
 const rows=awards.slice(0,200).map(row=>`<tr><td>${escape(time(row.createdAt))}</td><td>${escape(row.modality==='ACKNOWLEDGEMENT'?'Ciência do indicador':'Sugestão aprovada')}</td><td>${escape(number(row.points))}</td></tr>`).join('');
 const cards=(snapshot.indicators||[]).map(metric=>{
  const acked=awards.some(row=>row.modality==='ACKNOWLEDGEMENT'&&row.metricId===metric.id&&row.year===metric.year),suggestion=suggestions.find(row=>row.metricId===metric.id&&row.year===metric.year);
  return `<article class="fd-performance-indicator"><h3>${escape(metric.name||metric.id)}</h3>${metric.description?`<p>${escape(metric.description)}</p>`:''}${readings(metric)}<button type="button" data-fd-ack="${escape(metric.id)}" data-year="${escape(metric.year)}" ${acked?'disabled':''}>${acked?'Ciência registrada':'Reconheço este indicador · 1 ponto'}</button>${suggestion?`<p role="status">Sugestão ${escape(suggestion.status==='PENDING'?'aguardando revisão':suggestion.status==='APPROVED'?'aprovada':'recusada')}.</p>`:`<form data-fd-suggestion="${escape(metric.id)}" data-year="${escape(metric.year)}"><label>Sugestão para este indicador<textarea name="text" required minlength="8" maxlength="2000"></textarea></label><button type="submit">Enviar sugestão · até 2 pontos após aprovação</button></form>`}</article>`;
 }).join('');
 const queue=(snapshot.pendingSuggestions||[]).filter(item=>item.uid!==snapshot.uid).map(item=>`<article class="fd-performance-suggestion"><p>${escape(item.text)}</p><button type="button" data-fd-review="${escape(item.id)}" data-decision="APPROVED">Aprovar · 2 pontos para quem sugeriu</button><button type="button" data-fd-review="${escape(item.id)}" data-decision="REJECTED">Recusar</button></article>`).join('');
 return `<section class="fd-performance">${header}<div class="fd-performance-summary"><div><span>Meus pontos FD</span><strong>${escape(number(view.total))}</strong></div><div><span>Desempenho relativo FD</span><strong>${escape(number(view.percentage))}%</strong></div></div><p>O percentual compara seu saldo com o maior saldo confirmado no FD. Seus pontos ficam neste módulo.</p><h3>Indicadores</h3><div class="fd-performance-indicators">${cards||'<p class="empty-state">Nenhum indicador disponível para este perfil.</p>'}</div>${queue?`<h3>Sugestões para revisar</h3><div class="fd-performance-review-queue">${queue}</div>`:''}<h3>Meu histórico</h3>${rows?`<div class="fd-performance-table"><table><thead><tr><th>Data</th><th>Ação</th><th>Pontos</th></tr></thead><tbody>${rows}</tbody></table></div><p>Até 200 lançamentos mais recentes.</p>`:'<p class="empty-state">Você ainda não recebeu pontos em FD.</p>'}<p role="status" data-fd-status aria-live="polite"></p></section>`;
}

export function mountFdPerformanceModule(root,{repository,isCurrent=()=>true}={}){
 let disposed=false,snapshot=null;
 const render=()=>{if(!disposed&&isCurrent())root.innerHTML=fdPerformanceMarkup(snapshot);};
 const refresh=async()=>{snapshot=await repository.loadSummary();render();};
 const action=async operation=>{const status=root.querySelector('[data-fd-status]');if(status)status.textContent='Salvando e confirmando no servidor…';root.querySelectorAll('button,textarea').forEach(el=>{el.disabled=true;});try{await operation();await refresh();}catch{if(status)status.textContent='Não foi possível confirmar. Revise sua conexão e tente novamente.';root.querySelectorAll('button,textarea').forEach(el=>{el.disabled=false;});}};
 render();void refresh().catch(()=>{snapshot={uid:'blocked',summary:{uid:'blocked'},status:'BLOCKED'};render();});
 const click=event=>{const ack=event.target.closest('[data-fd-ack]'),review=event.target.closest('[data-fd-review]');if(ack)void action(()=>repository.acknowledge(ack.dataset.fdAck,Number(ack.dataset.year)));if(review)void action(()=>repository.reviewSuggestion(review.dataset.fdReview,review.dataset.decision));};
 const submit=event=>{const form=event.target.closest('[data-fd-suggestion]');if(!form)return;event.preventDefault();const text=new FormData(form).get('text');void action(()=>repository.submitSuggestion(form.dataset.fdSuggestion,Number(form.dataset.year),String(text||'')));};
 root.addEventListener('click',click);root.addEventListener('submit',submit);
 return()=>{disposed=true;root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.replaceChildren();};
}
