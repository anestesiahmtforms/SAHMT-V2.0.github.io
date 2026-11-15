import {fail} from './domain.js';
export const OBLIGATION_DAY=86_400_000;
export const SURVEY_ACTIVITIES=Object.freeze({epidemiological:'Cadastro Epidemiológico SAHMT',climate:'Pesquisa de Clima Organizacional',stress:'Avaliação de Estresse e Fadiga'});
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,199}$/.test(v);
export function obligationStage(publishedAt,serverNow){
 if(![publishedAt,serverNow].every(v=>Number.isSafeInteger(v)&&v>=0))throw fail('COMM_INVALID_ACTIVITY');
 return Math.min(5,Math.max(0,Math.floor((serverNow-publishedAt)/OBLIGATION_DAY)));
}
export function validateObligation(value){
 const keys=value?.kind==='TRAINING'?['kind','id','title','version','minimumScore','maxScore']:['kind','id','title','cycle'];
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==keys.length||!keys.every(k=>Object.hasOwn(value,k))||!identifier(value.id)||typeof value.title!=='string'||!value.title.trim()||value.title.length>240)throw fail('COMM_INVALID_ACTIVITY');
 if(value.kind==='TRAINING'){
  if(!Number.isSafeInteger(value.version)||value.version<1||![value.minimumScore,value.maxScore].every(v=>Number.isFinite(v)&&v>0&&v<=1000)||value.minimumScore>value.maxScore)throw fail('COMM_INVALID_ACTIVITY');
 }else if(value.kind!=='SURVEY'||!Object.hasOwn(SURVEY_ACTIVITIES,value.id)||!/^20\d{2}$/.test(value.cycle))throw fail('COMM_INVALID_ACTIVITY');
 return Object.fromEntries(keys.map(k=>[k,value[k]]));
}
export function trainingCompletion(training,state,activity,subjectUid){
 const pending={completed:false};
 if(!subjectUid||activity?.kind!=='TRAINING'||training?.id!==activity.id||training.version!==activity.version||training.maxScore!==activity.maxScore||state?.uid!==subjectUid||state.trainingId!==activity.id||!Array.isArray(state.attempts))return pending;
 const attempts=state.attempts.filter(a=>a.trainingVersion===activity.version&&Number.isSafeInteger(a.acknowledgedAt)&&a.acknowledgedAt>0&&Number.isSafeInteger(a.completedAt)&&a.completedAt>=a.acknowledgedAt&&Number.isFinite(a.score)&&a.score>=activity.minimumScore&&a.score<=activity.maxScore&&a.maxScore===activity.maxScore).sort((a,b)=>a.completedAt-b.completedAt);
 return attempts.length?{completed:true,completedAt:attempts[0].completedAt,score:attempts[0].score}:pending;
}
