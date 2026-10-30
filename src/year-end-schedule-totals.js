import {yearEndError} from './year-end-schedule.js';

export const YEAR_END_TOTAL_KEYS=Object.freeze(['plantaoNatal','plantaoReveillon','grupoNatal','grupoReveillon','totalRegistrations']);
export const emptyYearEndTotals=()=>({plantaoNatal:0,plantaoReveillon:0,grupoNatal:0,grupoReveillon:0,totalRegistrations:0});
export function readYearEndTotals(value) {
  if(!value||YEAR_END_TOTAL_KEYS.some(key=>!Number.isSafeInteger(value[key])||value[key]<0)||
    value.plantaoNatal+value.plantaoReveillon!==value.totalRegistrations||
    value.grupoNatal+value.grupoReveillon>value.totalRegistrations)throw yearEndError('YEAR_END_CORRUPT_ORDER');
  return Object.fromEntries(YEAR_END_TOTAL_KEYS.map(key=>[key,value[key]]));
}
export function changeYearEndTotals(value,previous,choices) {
  const next=readYearEndTotals(value);
  for(const [field,option,key] of [['plantao','natal','plantaoNatal'],['plantao','reveillon','plantaoReveillon'],['grupo','natal','grupoNatal'],['grupo','reveillon','grupoReveillon']]){
    next[key]+=Number(choices[field]===option)-Number(previous?.[field]===option);
  }
  next.totalRegistrations+=previous?0:1;
  return readYearEndTotals(next);
}
