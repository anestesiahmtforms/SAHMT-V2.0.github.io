import {COMMON, DIMENSIONS, GROUPS, VERSION, CYCLE} from './schema.js';
export const MIN_GROUP = 5;
export function summarize(rows, ids, total) {
  let favorable = 0, denominator = 0;
  for (const id of ids) {
    const values = rows.map(row => row.answers[id]).filter(Number.isInteger);
    if (values.length < MIN_GROUP || (total - values.length > 0 && total - values.length < MIN_GROUP)) return null;
    denominator += values.length;
    favorable += values.filter(value => value >= 4).length;
  }
  return {numerator: favorable, denominator, favorable: Math.round(1000 * favorable / denominator) / 10};
}
export function aggregate(rows, cycle = CYCLE) {
  rows=rows.filter(row=>Object.hasOwn(GROUPS,row.group));
  if (rows.length < MIN_GROUP) throw Error('INSUFFICIENT_RESPONDENTS');
  const ids = COMMON.map(q => q.id);
  return {
    survey_cycle: cycle, survey_version: VERSION,
    participation: {suppressed:true,uniquePeopleVerified:false},
    // No pooled scores: small groups cannot be reconstructed by subtraction.
    groups: Object.fromEntries(Object.entries(GROUPS).map(([key,label]) => {
      const selected = rows.filter(row => row.group === key);
      if (selected.length < MIN_GROUP) return [key,{label,suppressed:true,reason:'Não divulgado: menos de cinco respostas no grupo.'}];
      return [key,{
        label,suppressed:false,general:summarize(selected,ids,selected.length),
        dimensions:DIMENSIONS.map(([label],i)=>({label,score:summarize(selected,ids.slice(i*4,i*4+4),selected.length)})),
        psychologicalSafety:summarize(selected,ids.slice(12,16),selected.length),
        safetyCulture:summarize(selected,[13,14,15,24,25,26,27].map(i=>ids[i]),selected.length),
        contribution:summarize(selected,['Q30'],selected.length),improvementTrust:summarize(selected,['Q32'],selected.length)
      }];
    })),
    methodology:'Resultados separados de equipe, residentes e substitutos. Sem total de pontuações ou cruzamentos. Registros de categorias descontinuadas são excluídos. Grupos antigos foram autodeclarados; novos envios usam o cadastro institucional.'
  };
}
