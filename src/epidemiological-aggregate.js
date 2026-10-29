import {EPIDEMIOLOGICAL_FIELDS,REGISTRATION_CYCLE,validateEpidemiologicalSubmission} from './registration-domain.js';
export const EPIDEMIOLOGICAL_MIN_GROUP=5;
export function aggregateEpidemiological(rows){
 const valid=rows.filter(r=>{try{validateEpidemiologicalSubmission({survey_cycle:r.survey_cycle,survey_version:r.survey_version,submission_id:'a'.repeat(32),consent:true,group:r.group,answers:r.answers});return true;}catch{return false;}});
 const groups=Object.fromEntries([['resident','Residentes'],['team','Equipe']].map(([key,label])=>{
  const selected=valid.filter(r=>r.group===key);if(selected.length<5)return [key,{label,suppressed:true,reason:'Menos de cinco respostas no grupo.'}];
  const questions=EPIDEMIOLOGICAL_FIELDS.map(f=>{
   const values=selected.map(r=>r.answers?.[f.id]).filter(v=>f.type==='checks'?Array.isArray(v)&&v.length:typeof v==='string'&&v!=='NI');
   if(values.length<5||selected.length-values.length>0&&selected.length-values.length<5)return {id:f.id,label:f.label,suppressed:true};
   const counts=f.options.map(([id,label])=>({id,label,count:values.filter(v=>Array.isArray(v)?v.includes(id):v===id).length}));
   if(counts.some(c=>c.count>0&&c.count<5||values.length-c.count>0&&values.length-c.count<5))return {id:f.id,label:f.label,suppressed:true};
   return {id:f.id,label:f.label,suppressed:false,respondents:values.length,options:counts.map(c=>({...c,percent:Math.round(c.count*1000/values.length)/10}))};
  });return [key,{label,suppressed:false,respondents:selected.length,questions}];
 }));return {survey_cycle:REGISTRATION_CYCLE,survey_version:'1.0',grouping_version:2,groups,methodology:'Residentes e Equipe; substitutos integram Equipe. Sem cruzamentos, dados individuais ou total combinado. Distribuições com células pequenas ou ausência potencialmente identificável são suprimidas.'};
}
