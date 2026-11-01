import {fcPerformancePresentation} from './fc-performance-data.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
const modalities={OCCURRENCE:'Registro de ocorrência',ACKNOWLEDGEMENT:'Ciência de análise',SUGGESTION:'Sugestão aprovada'};
function date(value){const d=value?.toDate?.()??value;return d instanceof Date&&Number.isFinite(d.getTime())?d.toLocaleString('pt-BR'):'Aguardando confirmação';}
const messages={loading:'Carregando seu desempenho…',preparing:'O Desempenho FC está em preparação.',pending:'As pontuações estão sendo confirmadas. Aguarde a atualização do saldo.',offline:'Conecte-se à internet para confirmar seu saldo atual.',blocked:'Não foi possível confirmar seu acesso ao Desempenho FC.'};
export function fcPerformanceMarkup(snapshot){
 const view=snapshot?fcPerformancePresentation(snapshot):{state:'loading'};
 const header='<header><p class="eyebrow">REGISTROS</p><h2>Desempenho FC</h2><p>Pontuações das suas ações em FC, contabilizadas após a ativação deste módulo.</p></header>';
 if(view.state!=='ready')return `<section class="fc-performance">${header}<p role="status" class="empty-state">${messages[view.state]}</p></section>`;
 const rows=(snapshot.ledger||[]).slice(0,200).map(row=>`<tr><td>${escape(date(row.createdAt))}</td><td>${escape(modalities[row.modality]||'Ação em FC')}</td><td>${escape(number(row.points))}</td></tr>`).join('');
 return `<section class="fc-performance">${header}<div class="fc-performance-summary" aria-label="Saldo confirmado"><div><span>Meus pontos FC</span><strong>${escape(number(view.total))}</strong></div><div><span>Desempenho relativo em FC</span><strong>${escape(number(view.percentage))}%</strong></div></div><p>O percentual compara seu saldo com o maior saldo dos participantes autorizados em FC. Os pontos permanecem neste módulo.</p><h3>Meu histórico</h3>${rows?`<div class="fc-performance-table"><table><thead><tr><th>Data</th><th>Ação</th><th>Pontos</th></tr></thead><tbody>${rows}</tbody></table></div><p>Até 200 lançamentos mais recentes. O saldo considera todos os lançamentos confirmados.</p>`:`<p class="empty-state">${view.total===0?'Você ainda não recebeu pontos em FC.':'Aguardando a atualização dos lançamentos.'}</p>`}</section>`;
}
export function mountFcPerformanceModule(root,{repository,isCurrent=()=>true}={}){
 let disposed=false;
 const render=snapshot=>{if(!disposed&&isCurrent())root.innerHTML=fcPerformanceMarkup(snapshot);};
 render(null);
 const unsubscribe=repository.watch({onData:render,onError:()=>render({uid:'blocked',runtime:{enabled:true}})});
 return()=>{disposed=true;unsubscribe();root.replaceChildren();};
}
