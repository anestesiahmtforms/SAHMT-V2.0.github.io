import {percent,RESULT_LABELS,compareResults} from './qmentum-engine.js';
export const escapeQ=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const MONTHS=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export function monthlyChart(series,{title='Evolução mensal',target=null}={}) {
 const months=MONTHS.map((label,index)=>({label,result:series.find(item=>item.month===index+1)?.result??null}));
 return `<figure class="qm-chart qm-monthly-chart"><figcaption>${escapeQ(title)}</figcaption>${target!==null?`<p class="qm-monthly-target">Meta: ${escapeQ(percent(target))}</p>`:''}<ol class="qm-monthly-bars" aria-label="${escapeQ(title)}: resultados de janeiro a dezembro">${months.map(({label,result})=>{
  const missing=result?.ratio==null;
  const state=RESULT_LABELS[result?.status]||'Sem dados';
  return `<li class="qm-monthly-row qm-monthly-row--${missing?'missing':result.status==='VALID'?'reviewed':'unreviewed'}"><span class="qm-monthly-month">${label}</span><span class="qm-monthly-rail${missing?' qm-monthly-rail--empty':''}" aria-hidden="true">${missing?'':`<span class="qm-monthly-fill" style="width:${result.ratio*100}%"></span>`}${target!==null?`<span class="qm-monthly-target-marker" style="left:${target*100}%"></span>`:''}</span><strong class="qm-monthly-value">${escapeQ(percent(result?.ratio))}</strong><small class="qm-monthly-state">${missing?'Sem resultado · ':''}${escapeQ(state)}</small></li>`;
 }).join('')}</ol><p class="qm-monthly-legend">Verde: calculado com definição aprovada. Âmbar: informado ou provisório. Sem resultado: mês sem barra; não representa 0%.${target!==null?' Traço vertical: meta.':''}</p><details><summary>Valores do gráfico</summary><div class="qm-monthly-table-scroll" tabindex="0" role="region" aria-label="Valores mensais e proveniência"><table><thead><tr><th scope="col">Mês</th><th scope="col">Resultado</th><th scope="col">N / D</th><th scope="col">Estado</th><th scope="col">Fonte</th><th scope="col">Definição</th><th scope="col">Meta</th></tr></thead><tbody>${months.map(({label,result})=>`<tr><th scope="row">${label}</th><td>${escapeQ(percent(result?.ratio))}</td><td>${escapeQ(result?.N??'—')} / ${escapeQ(result?.D??'—')}</td><td>${escapeQ(RESULT_LABELS[result?.status]||'Sem dados')}</td><td>${escapeQ(result?.sourceMode??'—')}</td><td>${escapeQ(result?.definitionVersion??'—')}</td><td>${escapeQ(percent(result?.target))}</td></tr>`).join('')}</tbody></table></div></details></figure>`;
}
export function performanceChart(current,previous) {
 const comparison=compareResults(current,previous);
 const target=current?.status==='VALID'&&current.targetValidated&&current.target!==null?current.target:null;
 if(current?.status!=='VALID'||current.ratio===null||target===null&&!comparison)return '<section class="qm-chart"><h4>Performance</h4><p>Sem comparação válida. São necessários dados revisados e uma meta validada ou período anterior compatível.</p></section>';
 const other=target??previous.ratio;
 return `<figure class="qm-chart"><figcaption>Performance — ${target===null?'comparação histórica':'meta vigente'}</figcaption><svg viewBox="0 0 560 115" role="img" aria-label="Resultado ${percent(current.ratio)}; ${target===null?'anterior':'meta'} ${percent(other)}"><text x="0" y="20">Atual</text><rect x="95" y="5" width="${current.ratio*320}" height="25" fill="#127a80"/><text x="420" y="23">${percent(current.ratio)}</text><text x="0" y="65">${target===null?'Anterior':'Meta'}</text><rect x="95" y="47" width="${other*320}" height="25" fill="#956915"/><text x="420" y="65">${percent(other)}</text></svg><p>Atual: ${current.N}/${current.D}. ${target===null?`Anterior: ${previous.N}/${previous.D}. Variação: ${comparison.points.toLocaleString('pt-BR',{maximumFractionDigits:4})} p.p.`:`Meta: ${percent(target)}; origem ${escapeQ(current.targetSource)}.`}</p></figure>`;
}
export function resultCard(result){return `<strong>${percent(result?.ratio)}</strong><span>N ${result?.N??'—'} / D ${result?.D??'—'}</span><small>${escapeQ(RESULT_LABELS[result?.status]||'Sem dados')} · Meta ${percent(result?.target)}</small>`;}
export function exportQmentumCsv(months,unitLabel) {
 const rows=[['Unidade','Ano','Mês','Indicador','Numerador','Denominador','Razão','Estado','Fonte','Versão da definição','Versão da entrada','Meta','Meta validada','Legado']];
 for(const month of months)for(const result of Object.values(month.results))rows.push([unitLabel,month.year,month.month,result.indicatorId,result.N,result.D,result.ratio,RESULT_LABELS[result.status],result.sourceMode,result.definitionVersion,month.version,result.target,result.targetValidated,month.inputs.legacyRates[result.indicatorId]?.value??null]);
 const cell=value=>{const raw=String(value??'');return '"'+(/^[=+@-]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';};
 return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
