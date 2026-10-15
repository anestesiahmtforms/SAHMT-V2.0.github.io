import {QMENTUM_ENGINE,QMENTUM_IDS,QMENTUM_INDICATORS,COUNT_KEYS,getIndicator} from './qmentum-catalog.js';
export const RESULT_LABELS={VALID:'Calculado com definição aprovada',PROVISIONAL:'Definição pendente',PENDING:'Dados pendentes',NOT_APPLICABLE:'Não aplicável / sem casos elegíveis',INCONSISTENT:'Inconsistência',FOLLOWUP_PENDING:'Seguimento pendente',INFORMED:'Taxa informada (sem contagens)'};
export function validateInputs(input) {
 if(!input||!input.counts||!input.origins||!input.informedRates||!input.legacyRates||!Array.isArray(input.notApplicable))throw Error('QMENTUM_INPUT_INVALID');
 for(const map of [input.counts,input.origins])if(Object.keys(map).sort().join()!==[...COUNT_KEYS].sort().join())throw Error('QMENTUM_FIELDS_INVALID');
 for(const key of COUNT_KEYS)if(input.counts[key]!==null&&(!Number.isSafeInteger(input.counts[key])||input.counts[key]<0||input.counts[key]>10000000))throw Error('QMENTUM_COUNT_INVALID');
 if(new Set(input.notApplicable).size!==input.notApplicable.length||input.notApplicable.some(k=>!COUNT_KEYS.includes(k)||input.counts[k]!==null))throw Error('QMENTUM_STATE_INVALID');
 if(Object.values(input.origins).some(s=>!['MANUAL','UNINFORMED','IMPORTED'].includes(s)))throw Error('QMENTUM_ORIGIN_INVALID');
 if(Object.keys(input.informedRates).sort().join()!==[...QMENTUM_IDS].sort().join())throw Error('QMENTUM_RATES_INVALID');
 if(Object.values(input.informedRates).some(n=>n!==null&&(!Number.isFinite(n)||n<0||n>1)))throw Error('QMENTUM_RATE_INVALID');
 if(Object.keys(input.legacyRates).some(id=>!QMENTUM_IDS.includes(id)))throw Error('QMENTUM_LEGACY_INVALID');
 for(const key of ['attribution48','attribution30','uniqueEventProceduresConfirmed','techniqueUniverseConfirmed'])if(typeof input[key]!=='boolean')throw Error('QMENTUM_STATE_INVALID');
 if(typeof input.comment!=='string'||input.comment.length>2000)throw Error('QMENTUM_COMMENT_INVALID');
 return input;
}
export function validateDefinitions(defs) {
 if(!Number.isSafeInteger(defs?.version)||defs.version<1||!/^\d{4}-(0[1-9]|1[0-2])$/.test(defs.validFrom||'')||typeof defs.reason!=='string'||defs.reason.length<8||defs.reason.length>1000||defs.referenceVersion!=='references-2026-10-14')throw Error('QMENTUM_DEFINITION_INVALID');
 if(Object.keys(defs.items||{}).sort().join()!==[...QMENTUM_IDS].sort().join())throw Error('QMENTUM_DEFINITION_INVALID');
 for(const d of QMENTUM_INDICATORS){const x=defs.items[d.id];if(typeof x.approved!=='boolean'||typeof x.targetValidated!=='boolean'||typeof x.criterion!=='string'||x.criterion.length>1500||x.approved&&x.criterion.trim().length<8||x.populationKey!==d.denominator||!['NONE','WORKSHEET','INSTITUTION'].includes(x.targetSource)||x.target!==null&&(!Number.isFinite(x.target)||x.target<0||x.target>1)||x.target===null&&x.targetValidated)throw Error('QMENTUM_DEFINITION_INVALID');}
 return defs;
}
export function calculateIndicator(id,inputs,defs,{inputVersion=0,calculatedAt=null}={}) {
 const d=getIndicator(id);if(!d)throw Error('QMENTUM_INDICATOR_INVALID');
 const cfg=defs.items[id],N=inputs.counts[d.numerator],D=inputs.counts[d.denominator];
 const result={indicatorId:id,N,D,ratio:null,status:'PENDING',definitionVersion:defs.version,inputVersion,sourceMode:'CALCULATED',calculatedAt,engineVersion:QMENTUM_ENGINE,target:cfg.target,targetValidated:cfg.targetValidated,targetSource:cfg.targetSource,rule:d.rule,populationKey:cfg.populationKey,pending:[]};
 const finish=(status,pending=[])=>({...result,status,pending});
 if((N!==null&&D!==null&&N>D)||(D===0&&N>0))return finish('INCONSISTENT',['NUMERATOR_EXCEEDS_DENOMINATOR']);
 if(inputs.notApplicable.includes(d.numerator)||inputs.notApplicable.includes(d.denominator))return finish('NOT_APPLICABLE',['DECLARED_NOT_APPLICABLE']);
 if(N===null||D===null){
  const informed=inputs.informedRates[id];
  if(informed!==null)return {...finish('INFORMED',['COUNTS_NOT_AVAILABLE']),ratio:informed,sourceMode:'INFORMED'};
  return finish('PENDING',['COUNTS_NOT_AVAILABLE']);
 }
 if(D===0)return finish('NOT_APPLICABLE',['NO_ELIGIBLE_CASES']);
 if(['QM15','QM16'].includes(id)){
  const suffix=id==='QM15'?'48':'30',followed=inputs.counts['followed'+suffix],pending=inputs.counts['pending'+suffix];
  if(followed!==null&&pending!==null&&(followed+pending!==D||N>followed))return finish('INCONSISTENT',['FOLLOWUP_COUNTS_DIVERGE']);
  if(pending!==0||followed!==D||!inputs['attribution'+suffix])return finish('FOLLOWUP_PENDING',['COHORT_OR_ATTRIBUTION_PENDING']);
 }
 if(id==='QM14'&&!inputs.uniqueEventProceduresConfirmed)return finish('PROVISIONAL',['UNIQUE_PROCEDURES_UNCONFIRMED']);
 result.ratio=d.rule==='complement'?1-N/D:N/D;
 return finish(cfg.approved?'VALID':'PROVISIONAL',cfg.approved?[]:['DEFINITION_NOT_APPROVED']);
}
export function calculateMonth(inputs,definitions,options={}) {
 validateInputs(inputs);validateDefinitions(definitions);
 return Object.fromEntries(QMENTUM_IDS.map(id=>[id,calculateIndicator(id,inputs,definitions,options)]));
}
export function productionTotals(counts) {
 const sum=keys=>keys.every(k=>counts[k]!==null)?keys.reduce((n,k)=>n+counts[k],0):null;
 return {anestheticTotal:sum(['general','sedation','regional','spinal','epidural','local','support']),legacyBlocks:sum(['regional','epidural','local'])};
}
export function aggregateResults(rows) {
 if(!rows.length)return {ratio:null,status:'PENDING',N:null,D:null};
 const first=rows[0];
 if(rows.some(r=>r.indicatorId!==first.indicatorId||r.definitionVersion!==first.definitionVersion||r.populationKey!==first.populationKey||r.rule!==first.rule))return {ratio:null,status:'PENDING',reason:'INCOMPATIBLE_DEFINITIONS',N:null,D:null};
 if(rows.some(r=>!['VALID','NOT_APPLICABLE'].includes(r.status)||r.sourceMode!=='CALCULATED'||r.N===null||r.D===null))return {ratio:null,status:'PENDING',reason:'COUNTS_OR_VALIDATION_PENDING',N:null,D:null};
 const N=rows.reduce((s,r)=>s+r.N,0),D=rows.reduce((s,r)=>s+r.D,0);
 return {N,D,ratio:D?first.rule==='complement'?1-N/D:N/D:null,status:D?'VALID':'NOT_APPLICABLE'};
}
export function monthlySeries(months,id,year) {
 return Array.from({length:12},(_,i)=>{const doc=months.find(m=>m.year===year&&m.month===i+1);return {month:i+1,result:doc?.results?.[id]||null};});
}
export function compareResults(current,previous) {
 if(current?.status!=='VALID'||previous?.status!=='VALID'||current.definitionVersion!==previous.definitionVersion||current.populationKey!==previous.populationKey||current.ratio===null||previous.ratio===null)return null;
 return {points:(current.ratio-previous.ratio)*100,current:{N:current.N,D:current.D},previous:{N:previous.N,D:previous.D}};
}
export function periodKey(year,month) {if(!Number.isInteger(year)||year<1900||year>2200||!Number.isInteger(month)||month<1||month>12)throw Error('QMENTUM_PERIOD_INVALID');return `${year}-${String(month).padStart(2,'0')}`;}
export function canClose(results) {return QMENTUM_IDS.every(id=>['VALID','NOT_APPLICABLE'].includes(results[id]?.status));}
export const percent=value=>value===null||value===undefined?'—':new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:2,maximumFractionDigits:4}).format(value);
