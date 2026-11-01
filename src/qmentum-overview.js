import {COUNT_KEYS,QMENTUM_IDS} from './qmentum-catalog.js';
import {periodKey,productionTotals} from './qmentum-engine.js';
import {escapeQ as e} from './qmentum-charts.js';
const names=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const sourceFields=[
 ['general','Anestesia geral'],['sedation','Sedação'],['regional','Anestesia regional'],['spinal','Raquianestesia'],['epidural','Peridural'],['local','Local'],['support','Suporte anestésico'],
 ['anestheticTotal','Procedimentos anestésicos'],['surgical','Procedimentos cirúrgicos'],['legacyBlocks','Bloqueios com risco de intoxicação'],['diabetes','Diabéticos/hiperglicêmicos'],['toxicity','Intoxicação por anestésicos locais'],['headache','Cefaleia pós-punção dural']
];
const count=value=>Number.isSafeInteger(value)&&value>=0;
const rate=value=>Number.isFinite(value)&&value>=0&&value<=1;
export function hasMonthlyInformation(record){
 const input=record?.inputs;if(!input)return false;
 return COUNT_KEYS.some(key=>count(input.counts?.[key])||input.notApplicable?.includes(key))||QMENTUM_IDS.some(id=>rate(input.informedRates?.[id])||rate(input.legacyRates?.[id]?.value));
}
export function latestRecordedMonth(rows){
 let latest=null;
 for(const row of rows){let period;try{period=periodKey(row.year,row.month);}catch{continue;}
  if(row.period!==period||!hasMonthlyInformation(row))continue;
  if(!latest||period>latest.period)latest=row;
 }
 return latest;
}
export function monthlyOverviewRows(input){
 const counts=input?.counts||{},totals=input?.counts?productionTotals(input.counts):{anestheticTotal:null,legacyBlocks:null};
 return sourceFields.map(([key,label])=>{
  const derived=key in totals,value=derived?totals[key]:counts[key],state=count(value)?'value':input?.notApplicable?.includes(key)?'not-applicable':'missing';
  return {key,label,value:state==='value'?value:null,state,origin:derived?'DERIVED':['MANUAL','IMPORTED'].includes(input?.origins?.[key])?input.origins[key]:'UNINFORMED'};
 });
}
export function renderMonthlyOverview(record,{year,month}){
 periodKey(year,month);const title=names[month-1]+' de '+year,hasData=hasMonthlyInformation(record),origin={MANUAL:'Preenchimento manual',IMPORTED:'Importado da referência',DERIVED:'Total conforme a planilha',UNINFORMED:'Origem não informada'};
 return `<section class="qm-monthly-overview" data-qm-overview aria-labelledby="qm-overview-title"><header><span class="qm-overview-eyebrow">INFORMAÇÕES DO MÊS</span><h3 id="qm-overview-title">${e(title)}</h3><p>${hasData?'Procedimentos anestésicos e cirúrgicos realizados.':'Sem informações registradas para este mês.'}</p></header><dl class="qm-overview-values">${monthlyOverviewRows(record?.inputs).map(row=>`<div data-qm-overview-field="${row.key}" data-state="${row.state}" class="qm-overview-value${['anestheticTotal','surgical','legacyBlocks'].includes(row.key)?' qm-overview-value--total':''}"><dt>${e(row.label)}</dt><dd data-overview-value="${row.key}">${row.state==='value'?row.value.toLocaleString('pt-BR'):row.state==='not-applicable'?'Não aplicável':'Não informado'}</dd><small>${row.state==='value'?origin[row.origin]:''}</small></div>`).join('')}</dl>${hasData?'<p class="qm-overview-footnote">Totais seguem os agrupamentos da referência; os registros e critérios dos indicadores são preservados.</p>':''}</section>`;
}
