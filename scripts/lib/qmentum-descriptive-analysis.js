import {createHash} from 'node:crypto';
import {QMENTUM_IDS,getIndicator} from '../../src/qmentum-catalog.js';
import {quarterFacts,analysisInputSignature,validateAiText} from '../../src/qmentum-quarterly.js';
export const DESCRIPTIVE_VERSION='assisted-descriptive-fa-1';
const hash=text=>createHash('sha256').update(text).digest('hex');
const percent=n=>(n*100).toFixed(2).replace('.',',')+'%';
const months=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const actions={
 QM01:'conferir os motivos registrados de mudança de técnica e manter o mesmo universo de procedimentos cirúrgicos',
 QM02:'padronizar a distinção entre dificuldade de via aérea prevista e identificada durante o procedimento, reconciliando os registros com anestesias gerais',
 QM03:'conferir os casos de intoxicação e definir o que caracteriza manejo efetivo; manter meses sem casos como não aplicáveis',
 QM04:'conferir planejamento prévio da UTI e classificação dos encaminhamentos, sem atribuir causa a partir do total agregado',
 QM05:'uniformizar a janela de observação de náuseas e vômitos até a alta anestésica e conferir a completude dos registros',
 QM06:'uniformizar o critério e a janela de registro de dor aguda; reconciliar os eventos com o denominador cirúrgico',
 QM07:'explicitar o critério de controle glicêmico efetivo e conferir o universo elegível; a razão observada não comprova efeito de protocolo',
 QM08:'definir o critério institucional de hipoglicemia e a janela de observação; conferir os registros antes de interpretar a variação',
 QM09:'documentar o critério, método e momento da medição de temperatura para tornar os meses comparáveis',
 QM10:'reconciliar os registros de PCR, sua janela temporal e o universo cirúrgico; análise de causas exige revisão específica, além do agregado',
 QM11:'confirmar a busca de cefaleia e o denominador de raquianestesias; manter incidência e seu complemento identificados separadamente',
 QM12:'recuperar numerador e denominador de eletivos elegíveis com consulta; preservar a taxa histórica sem reconstruir contagens por arredondamento',
 QM13:'definir a população elegível e recuperar contagens de estratificação; validar completude, além do percentual informado',
 QM14:'manter a contagem por cirurgia única confirmada e revisar a composição dos eventos; não deduzir causas ou gravidade somente da taxa',
 QM15:'identificar coorte, acompanhados, pendentes e óbitos atribuídos em até 48h antes de validar a taxa de mortalidade',
 QM16:'identificar coorte, acompanhados, pendentes e óbitos atribuídos em até 30 dias antes de validar a taxa de mortalidade',
 QM17:'recuperar contagens de elegíveis e conformes, documentar o critério de profilaxia e validar institucionalmente a meta da planilha',
 QM18:'recuperar elegíveis e conformes, explicitar os itens avaliados do protocolo e validar a meta; percentual informado não comprova adesão integral'
};
export function descriptiveMetrics(facts){
 const values=facts.months.map(m=>m.result),present=values.filter(Boolean);
 const compatible=present.length===3&&present.every(r=>r.sourceMode==='CALCULATED'&&['VALID','PROVISIONAL','NOT_APPLICABLE'].includes(r.status)&&(r.D===0&&r.status==='NOT_APPLICABLE'||Number.isFinite(r.ratio))&&Number.isSafeInteger(r.N)&&Number.isSafeInteger(r.D)&&r.N>=0&&r.D>=0&&r.N<=r.D&&r.indicatorId===present[0].indicatorId&&r.definitionVersion===present[0].definitionVersion&&r.populationKey===present[0].populationKey&&r.rule===present[0].rule);
 if(compatible){const N=present.reduce((s,r)=>s+r.N,0),D=present.reduce((s,r)=>s+r.D,0);return{mode:D===0?'NOT_APPLICABLE':'CALCULATED_PROVISIONAL',N,D,ratio:D?(present[0].rule==='complement'?1-N/D:N/D):null,validated:present.every(r=>r.status==='VALID')};}
 return{mode:present.some(r=>r.sourceMode==='INFORMED')?'INFORMED_ONLY':'INSUFFICIENT_DATA',N:null,D:null,ratio:null,validated:false};
}
export function descriptiveAnalysis({rows,indicatorId,year,quarter,unitId,now=Date.now()}){
 const facts=quarterFacts({rows,indicatorId,year,quarter,now}),metrics=descriptiveMetrics(facts),priorQuarter=quarter===1?4:quarter-1,priorYear=quarter===1?year-1:year;
 let previous=null;try{previous=descriptiveMetrics(quarterFacts({rows,indicatorId,year:priorYear,quarter:priorQuarter,now}));}catch{}
 const period=quarter+'º trimestre de '+year;let analysis;
 if(metrics.mode==='NOT_APPLICABLE')analysis=period+': não houve casos elegíveis registrados (N/D '+metrics.N+'/'+metrics.D+'). Não há taxa de efetividade a estimar. O percentual da fórmula original não deve ser interpretado como sucesso do protocolo.';
 else if(metrics.mode==='CALCULATED_PROVISIONAL'){
  const comparison=previous?.ratio!==null&&previous?.ratio!==undefined?' Anterior: '+percent(previous.ratio)+'; razão '+(metrics.ratio>previous.ratio?'maior':metrics.ratio<previous.ratio?'menor':'igual')+' neste trimestre.':' Sem base anterior comparável disponível.';
  const caution=indicatorId==='QM14'?' Cirurgias distintas confirmadas; sem inferência de causa ou gravidade.':indicatorId==='QM11'?' Complemento da incidência; não comprova prevenção causal.':indicatorId==='QM03'?' Meses sem casos não elevam a efetividade.':indicatorId==='QM07'?' Critério de controle efetivo ainda depende de aprovação.':' Definição institucional pendente; sem conclusão validada de desempenho.';
  analysis=period+': N/D '+metrics.N+'/'+metrics.D+'; resultado descritivo '+percent(metrics.ratio)+'.'+comparison+caution;
 }else{
  const rates=facts.months.map(m=>months[m.month-1]+': '+(m.result?.ratio===null||m.result?.ratio===undefined?'sem taxa':percent(m.result.ratio))).join('; ');
  const values=facts.months.map(m=>m.result?.ratio),complete=values.every(Number.isFinite);
  const trend=!complete?'':values.every(v=>v===values[0])?' Percentuais informados estáveis.':values[0]<=values[1]&&values[1]<=values[2]?' Sequência informada crescente.':values[0]>=values[1]&&values[1]>=values[2]?' Sequência informada decrescente.':' Percentuais oscilaram no período.';
  analysis=period+': '+rates+'.'+trend+' Sem N/D, não há estimativa trimestral ou média dos percentuais.';
  if(['QM15','QM16'].includes(indicatorId))analysis+=' Taxas zero informadas não validam ausência de óbitos atribuídos sem coorte e seguimento.';
 }
 const action='Proposta à Coordenação Clínica/Qualidade: '+actions[indicatorId]+'. Revisar na próxima reunião trimestral, com responsável e retorno registrados.';
 // The number allowlist includes only source facts and exact derived arithmetic.
 // These are descriptive drafts, not scientific evidence or a clinical verdict.
 const paragraphs=validateAiText({analysis,action},{facts,metrics,previous});
 const signature=analysisInputSignature(facts,hash),id=hash(DESCRIPTIVE_VERSION+':'+unitId+':'+year+':'+quarter+':'+indicatorId+':'+signature);
 return{id,unitId,indicatorId,year,quarter,signature,facts,descriptiveMetrics:metrics,paragraphs,status:'GENERATED_PENDING_REVIEW',reviewed:false,provider:'Codex — revisão assistida dos dados',model:DESCRIPTIVE_VERSION,generationMethod:'ASSISTED_FACTUAL_TEMPLATE',analysisScope:'DESCRIPTIVE_DATA_QUALITY_ONLY',clinicalRecommendations:false,evidenceVersion:'INTERNAL_AGGREGATED_RECORDS_ONLY',promptVersion:DESCRIPTIVE_VERSION,generatedAt:now};
}
export function historicalDescriptiveAnalyses({rows,unitId='sahmt',year=2026,now=Date.now()}){
 if(unitId!=='sahmt'||year!==2026||!Array.isArray(rows)||rows.some(r=>r.unitId!==unitId)||new Set(rows.map(r=>r.year+':'+r.month)).size!==rows.length||[1,2,3,4,5,6].some(m=>!rows.some(r=>r.unitId===unitId&&r.year===year&&r.month===m)))throw Error('QMENTUM_DESCRIPTIVE_SOURCE_INCOMPLETE');
 return[1,2].flatMap(quarter=>QMENTUM_IDS.map(indicatorId=>descriptiveAnalysis({rows,unitId,year,quarter,indicatorId,now})));
}
