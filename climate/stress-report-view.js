import {GROUPS} from '../stress-domain/schema.js';
const addText=(document,host,tag,text)=>{const node=document.createElement(tag);node.textContent=text;host.append(node);return node;};
function chart(document,host,items,maximum){
 const container=document.createElement('div');container.className='stress-chart';
 for(const item of items){const row=document.createElement('div'),label=document.createElement('div');row.className='stress-chart-row';label.className='stress-chart-label';addText(document,label,'span',item.label);addText(document,label,'strong',item.value===null?'Protegido':`${item.value}${item.suffix||''}`);row.append(label);
  if(item.value!==null){const meter=document.createElement('progress');meter.max=maximum;meter.value=item.value;meter.setAttribute('aria-label',`${item.label}: ${item.value} de ${maximum}`);meter.className='stress-meter';row.append(meter);}container.append(row);
 }
 host.append(container);
}
function meanBlock(document,host,data){
 addText(document,host,'p',`${data.respondents} envios válidos — não confirma participantes únicos.`);
 addText(document,host,'p',`Pontuação média de fadiga: ${data.meanScore}/150`);
 chart(document,host,data.dimensions.map(d=>({label:d.label,value:d.mean,suffix:'/50'})),50);
 addText(document,host,'p',data.perceivedStress?`Estresse percebido médio: ${data.perceivedStress.mean}/10 (medida independente).`:'Estresse percebido: sem divulgação por proteção da amostra ou falta de respostas suficientes.');
}
export function renderStressReport(document,data){
 const section=document.createElement('section');addText(document,section,'h2',`Ciclo ${data.survey_cycle}`);
 const general=document.createElement('section');addText(document,general,'h3','Resultado geral');meanBlock(document,general,data.overall);
 addText(document,general,'h4','Comparação das médias gerais e por grupo');chart(document,general,[{label:'Geral',value:data.overall.meanScore,suffix:'/150'},...Object.entries(GROUPS).map(([key,label])=>({label,value:data.groups[key]?.suppressed||key==='secretaries'?null:data.groups[key]?.meanScore??null,suffix:'/150'}))],150);
 addText(document,general,'p','Contagens por faixa e percentuais de fadiga alta não são divulgados para impedir reconstrução de dados de grupos pequenos.');section.append(general);
 addText(document,section,'h3','Resultado por grupo de atividade');
 for(const [key,label]of Object.entries(GROUPS)){const card=document.createElement('section');card.className='stress-result-group';card.dataset.stressGroup=key;addText(document,card,'h4',label);const group=data.groups[key];if(!group||group.suppressed||key==='secretaries')addText(document,card,'p',group?.reason||'Sem divulgação para proteger a confidencialidade.');else meanBlock(document,card,group);section.append(card);}
 addText(document,section,'h3','Oportunidades de melhoria');
 for(const item of data.opportunities||[]){const card=document.createElement('section');card.className='stress-opportunity';addText(document,card,'h4',item.dimension);addText(document,card,'p',item.evidence);addText(document,card,'p',item.action);addText(document,card,'p',item.followUp);section.append(card);}
 addText(document,section,'p','Limiar gerencial para priorização: média de dimensão a partir de 40% da escala. É uma regra institucional de planejamento, não um ponto de corte clínico. Células e grupos protegidos não representam zero.');
 addText(document,section,'p',data.methodology);return section;
}
