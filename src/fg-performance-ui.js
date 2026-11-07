const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function fgPerformanceMarkup(data){
  if(!data)return '<p role="status">Confirmando pontuação do Checklist…</p>';
  return `<section class="fc-performance"><h2>Desempenho FG</h2><label>Profissional <select data-fg-subject>${data.team.map(p=>`<option value="${esc(p.uid)}" ${p.uid===data.summary.uid?'selected':''}>${esc(p.displayName)}</option>`).join('')}</select></label><h3>${data.summary.total.toLocaleString('pt-BR')} pontos</h3><p>Quando outra pessoa da Equipe dá ciência diária, ela recebe 1 ponto e o escalado perde 1 ponto. Se o próprio escalado der ciência, ninguém pontua.</p><p>O prazo de ciência fecha às 23h59 em ponto, no horário de São Paulo. Se ninguém der ciência, o escalado perde 1 ponto.</p><p>A primeira ciência encerra a apuração do dia. Se não houver ciência, a apuração ocorre automaticamente às 23h59.</p><p>Contagem iniciada em ${esc(new Date(data.effectiveFrom).toLocaleString('pt-BR'))}. Os registros anteriores foram preservados sem nova pontuação.</p><button class="secondary-button" type="button" data-fg-refresh>Atualizar</button><div class="fc-performance-table"><table><thead><tr><th>Dia do relatório</th><th>Ajuste</th><th>Motivo</th></tr></thead><tbody>${data.ledger.map(row=>`<tr><td>${esc(row.day)}</td><td>${row.delta>0?'+':''}${row.delta}</td><td>${row.reason==='NO_ACKNOWLEDGEMENT'?'Sem ciência até 23h59':'Ciência diária'}</td></tr>`).join('')}</tbody></table></div>${data.ledger.length?'':'<p>Nenhum lançamento neste período.</p>'}<p>Até 200 lançamentos recentes. O saldo inclui todos os lançamentos.</p></section>`;
}
export function mountFgPerformanceModule(root,{uid,load,isCurrent=()=>true}){
  let disposed=false,subjectUid=uid,generation=0;
  const current=()=>!disposed&&isCurrent();
  const refresh=async()=>{const seq=++generation,subject=subjectUid;if(!current())return;root.innerHTML=fgPerformanceMarkup(null);try{const data=await load(subject);if(current()&&seq===generation)root.innerHTML=fgPerformanceMarkup(data);}catch(_){if(current()&&seq===generation)root.innerHTML='<p role="status">Não foi possível confirmar a pontuação de FG. Volte ao Checklist e tente novamente.</p>';}};
  const change=event=>{if(event.target.matches('[data-fg-subject]')){subjectUid=event.target.value;void refresh();}};
  const click=event=>{if(event.target.closest('[data-fg-refresh]'))void refresh();};
  root.addEventListener('change',change);root.addEventListener('click',click);void refresh();
  return()=>{disposed=true;generation++;root.removeEventListener('change',change);root.removeEventListener('click',click);root.replaceChildren();};
}
