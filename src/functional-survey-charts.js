import {EPIDEMIOLOGICAL_FIELDS} from './registration-domain.js';
import {DIMENSIONS as STRESS_DIMENSIONS} from '../stress-domain/schema.js';

function scoreChart(label, value, maximum, labels) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) return [];
  return [{label, slices:labels.map((label,index)=>({label,value:index ? maximum-value : value}))}];
}

export function functionalSurveyCharts(survey, report) {
  return [['team','Equipe'],['resident','Residentes']].map(([key,label])=>{
    const group=report.groups?.[key];
    const charts=[];
    if(group?.suppressed===false&&Number.isSafeInteger(group.respondents)&&group.respondents>=5){
      if(survey==='climate'){
        const general=group.general;
        if(Number.isSafeInteger(general?.denominator)&&general.denominator>=5&&
           Number.isSafeInteger(general.numerator)&&general.numerator>=0&&general.numerator<=general.denominator){
          charts.push(...scoreChart('Respostas favoráveis',general.numerator,general.denominator,['Favoráveis','Demais respostas válidas']));
        }
      }else if(survey==='stress'){
        for(const {id,label} of STRESS_DIMENSIONS){
          const dimension=Array.isArray(group.dimensions)&&group.dimensions.find(row=>row.id===id);
          if(dimension?.maximum===50)charts.push(...scoreChart(label,dimension.mean,50,['Média observada','Diferença até o máximo da escala']));
        }
      }else if(survey==='epidemiological'){
        for(const field of EPIDEMIOLOGICAL_FIELDS.filter(field=>field.type==='select')){
          const question=Array.isArray(group.questions)&&group.questions.find(row=>row.id===field.id);
          if(question?.suppressed!==false||!Number.isSafeInteger(question.respondents)||question.respondents<5||
             question.respondents>group.respondents||!Array.isArray(question.options))continue;
          const slices=field.options.map(([id,label])=>({label,value:question.options.find(option=>option.id===id)?.count}));
          if(slices.some(({value})=>!Number.isSafeInteger(value)||value<0||value>0&&value<5)||
             slices.reduce((sum,{value})=>sum+value,0)!==question.respondents)continue;
          charts.push({label:field.label,slices});
        }
      }
    }
    return {label,charts};
  });
}
