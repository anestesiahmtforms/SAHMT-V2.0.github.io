import {fePerformancePresentation} from './fe-performance-data.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
const date=value=>{const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toLocaleString('pt-BR'):'Aguardando confirmação';};
const surveyName={climate:'Pesquisa de clima',stress:'Pesquisa de estresse e fadiga',epidemiological:'Consulta epidemiológica'};
const states={loading:'Carregando seu desempenho FE…',preparing:'O Desempenho FE está em preparação.',pending:'As pontuações estão sendo confirmadas.',offline:'Conecte-se à internet para confirmar seu saldo FE.',blocked:'Não foi possível confirmar seu acesso ao Desempenho FE.'};

export function fePerformanceMarkup(snapshot){
 const view=snapshot?fePerformancePresentation(snapshot):{state:'loading'};
 const header='<header><p class="eyebrow">ENQUETES E CONSULTAS</p><h2>Desempenho FE</h2><p>Cada participação aceita em uma pesquisa vale 1 ponto, qualquer que seja a resposta.</p></header>';
 if(view.state!=='ready')return `<section class="fe-performance">${header}<p role="status" class="empty-state">${states[view.state]||states.blocked}</p></section>`;
 const rows=(snapshot.awards||[]).slice(0,200).map(row=>`<tr><td>${escape(date(row.createdAt))}</td><td>${escape(surveyName[row.survey]||'Pesquisa')}</td><td>1</td></tr>`).join('');
 return `<section class="fe-performance">${header}<div class="fe-performance-summary"><div><span>Meus pontos FE</span><strong>${escape(number(view.total))}</strong></div><div><span>Desempenho relativo FE</span><strong>${escape(number(view.percentage))}%</strong></div></div><p>O percentual compara seu saldo com o maior saldo confirmado no FE. Suas respostas não aparecem nesta tela.</p><h3>Meu histórico</h3>${rows?`<div class="fe-performance-table"><table><thead><tr><th>Data</th><th>Participação</th><th>Pontos</th></tr></thead><tbody>${rows}</tbody></table></div><p>Até 200 participações mais recentes.</p>`:'<p class="empty-state">Você ainda não recebeu pontos em FE.</p>'}</section>`;
}

export function mountFePerformanceModule(root,{repository,isCurrent=()=>true}={}){
 let disposed=false;const render=snapshot=>{if(!disposed&&isCurrent())root.innerHTML=fePerformanceMarkup(snapshot);};
 render(null);void repository.loadSummary().then(render).catch(()=>render({uid:'blocked',summary:{uid:'blocked'},status:'BLOCKED'}));
 return()=>{disposed=true;root.replaceChildren();};
}
