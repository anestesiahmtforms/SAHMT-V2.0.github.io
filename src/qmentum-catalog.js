/** Institutional worksheet definitions, not a claim of Qmentum certification. */
export const QMENTUM_SCHEMA = 1;
export const QMENTUM_ENGINE = 'qmentum-1';
export const QMENTUM_TITLE = 'INDICADORES OBRIGATÓRIOS QMENTUM';
export const PRODUCTION = Object.freeze({general:'Anestesia geral',sedation:'Sedação',regional:'Regional',spinal:'Raquianestesia',epidural:'Peridural',local:'Local',support:'Suporte anestésico',surgical:'Procedimentos cirúrgicos',diabetes:'Diabéticos/hiperglicêmicos',toxicity:'Intoxicações por anestésicos locais',eventEpisodes:'Total de episódios de eventos',eventProcedures:'Procedimentos únicos com pelo menos um evento'});
const rows = [
 ['QM01','Taxa de mudança de técnica anestésica','techniqueChanges','Mudanças de técnica','surgical','ratio','lower',false,'TAXA !D18 = D4/ANESTESIAS!D20'],
 ['QM02','Incidência de via aérea difícil identificada no intraoperatório','difficultAirway','Casos identificados','general','ratio','lower',false,'TAXA !D19 = D5/ANESTESIAS!D11'],
 ['QM03','Efetividade do protocolo de manejo de intoxicação por anestésicos locais','effectiveToxicity','Casos com manejo efetivo','toxicity','ratio','higher',true,'TAXA !D20; IFERROR legado não é efetividade sem casos'],
 ['QM04','Incidência de encaminhamento à UTI não planejado por eventos anestésicos','unplannedIcu','Encaminhamentos não planejados por eventos anestésicos','surgical','ratio','lower',false,'TAXA !D21'],
 ['QM05','Incidência de náuseas e vômitos do intraoperatório até a alta anestésica','ponv','Procedimentos com náuseas ou vômitos','surgical','ratio','lower',false,'TAXA !D22'],
 ['QM06','Incidência de dor aguda do intraoperatório até a alta anestésica','acutePain','Procedimentos com dor aguda','surgical','ratio','lower',false,'TAXA !D23'],
 ['QM07','Efetividade do controle glicêmico perioperatório','effectiveGlucose','Pacientes com controle efetivo','diabetes','ratio','higher',true,'TAXA !D24 = D10/ANESTESIAS!D23'],
 ['QM08','Evento de hipoglicemia perioperatória','hypoglycemia','Procedimentos com hipoglicemia','surgical','ratio','lower',false,'TAXA !D25'],
 ['QM09','Incidência de hipotermia não intencional do intraoperatório até a alta anestésica','hypothermia','Procedimentos com hipotermia não intencional','surgical','ratio','lower',false,'TAXA !D26'],
 ['QM10','Incidência de PCR do intraoperatório até a alta anestésica','cardiacArrest','Procedimentos com parada cardiorrespiratória','surgical','ratio','lower',false,'TAXA !D27'],
 ['QM11','Efetividade do protocolo de prevenção de cefaleia pós punção dural','headache','Casos de cefaleia','spinal','complement','higher',true,'TAXA !H28 = 1-H14/ANESTESIAS!H14; fórmula explícita em maio'],
 ['QM12','Taxa de procedimentos eletivos com consulta pré-anestésica','electiveConsults','Eletivos com consulta pré-anestésica','electiveEligible','ratio','higher',true,'OUTROS INDICADORES!F3; N/D proposto'],
 ['QM13','Taxa de estratificação de risco anestésico do serviço','riskAssessed','Procedimentos com risco estratificado','riskEligible','ratio','higher',true,'OUTROS INDICADORES!F4; universo a validar'],
 ['QM14','Taxa de saídas sem eventos relacionados ao ato anestésico','eventProcedures','Procedimentos únicos com pelo menos um evento','surgical','complement','higher',true,'OUTROS INDICADORES!F5; origem usa episódios, não procedimentos únicos'],
 ['QM15','Taxa de mortalidade associada à anestesia em até 48 horas','deaths48','Óbitos atribuídos à anestesia em até 48h','eligible48','ratio','lower',true,'OUTROS INDICADORES!F6; coorte e atribuição a validar'],
 ['QM16','Taxa de mortalidade associada à anestesia em até 30 dias','deaths30','Óbitos atribuídos à anestesia em até 30 dias','eligible30','ratio','lower',true,'OUTROS INDICADORES!F7; coorte e atribuição a validar'],
 ['QM17','Taxa de conformidade da profilaxia antimicrobiana cirúrgica','antibioticCompliant','Procedimentos com profilaxia conforme','antibioticEligible','ratio','higher',true,'OUTROS INDICADORES!F8; meta da planilha: 95%'],
 ['QM18','Efetividade do Protocolo de Cirurgia Segura','safeSurgeryCompliant','Procedimentos com protocolo conforme','safeSurgeryEligible','ratio','higher',true,'OUTROS INDICADORES!F12; meta da planilha: 98%']
];
export const QMENTUM_INDICATORS = Object.freeze(rows.map(([id,name,numerator,numeratorLabel,denominator,rule,direction,proposed,source])=>Object.freeze({id,name,numerator,numeratorLabel,denominator,rule,direction,proposed,source,unit:'proporção',sourceTarget:id==='QM17'?.95:id==='QM18'?.98:null})));
export const QMENTUM_IDS = Object.freeze(QMENTUM_INDICATORS.map(d=>d.id));
export const FIELD_LABELS = Object.freeze({...PRODUCTION,...Object.fromEntries(QMENTUM_INDICATORS.map(d=>[d.numerator,d.numeratorLabel])),electiveEligible:'Eletivos elegíveis',riskEligible:'Procedimentos elegíveis para estratificação',eligible48:'Coorte elegível para seguimento de 48h',eligible30:'Coorte elegível para seguimento de 30 dias',antibioticEligible:'Elegíveis para profilaxia antimicrobiana',safeSurgeryEligible:'Elegíveis avaliados no protocolo de cirurgia segura',followed48:'Acompanhados até 48h',pending48:'Seguimentos de 48h pendentes',followed30:'Acompanhados até 30 dias',pending30:'Seguimentos de 30 dias pendentes'});
export const COUNT_KEYS = Object.freeze(Object.keys(FIELD_LABELS));
export const getIndicator = id=>QMENTUM_INDICATORS.find(d=>d.id===id) || null;
export function initialDefinitions() {
 return {version:1,validFrom:'1900-01',reason:'Definições da fonte; validação institucional pendente',referenceVersion:'references-2026-10-14',items:Object.fromEntries(QMENTUM_INDICATORS.map(d=>[d.id,{approved:false,criterion:'',target:d.sourceTarget,targetSource:d.sourceTarget===null?'NONE':'WORKSHEET',targetValidated:false,populationKey:d.denominator}]))};
}
export function emptyInputs() {
 return {counts:Object.fromEntries(COUNT_KEYS.map(key=>[key,null])),notApplicable:[],origins:Object.fromEntries(COUNT_KEYS.map(key=>[key,'UNINFORMED'])),informedRates:Object.fromEntries(QMENTUM_IDS.map(id=>[id,null])),legacyRates:{},attribution48:false,attribution30:false,uniqueEventProceduresConfirmed:false,techniqueUniverseConfirmed:false,comment:''};
}
