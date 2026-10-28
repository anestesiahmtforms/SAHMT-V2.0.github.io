export const VERSION='1.2';
export const CYCLE='2026';
export const GROUPS=Object.freeze({team:'Equipe',resident:'Residentes',substitute:'Substitutos'});
export const SCALE=[[0,'Nunca'],[1,'Quase nunca'],[2,'Raramente'],[3,'Às vezes'],[4,'Muitas vezes'],[5,'Sempre']];
export const DIMENSIONS=[
 {id:'physical',label:'Fadiga física e recuperação',questions:[
  'Senti peso ou desconforto na cabeça durante minhas atividades.',
  'Senti moleza ou falta de energia no corpo.',
  'Bocejei repetidamente durante o trabalho.',
  'Percebi meu corpo mais lento para realizar atividades habituais.',
  'Senti sonolência em momentos em que precisava permanecer alerta.',
  'Senti os olhos cansados durante minhas atividades.',
  'Tive dificuldade para me movimentar por cansaço.',
  'Tive dificuldade para permanecer em pé por cansaço.',
  'Senti necessidade de me deitar para recuperar energia durante o expediente.',
  'O cansaço persistiu mesmo após meu período habitual de descanso.'
 ]},
 {id:'mental',label:'Concentração e sobrecarga mental',questions:[
  'Precisei fazer mais esforço que o habitual para manter a atenção.',
  'Senti vontade de evitar conversas ou interações no trabalho por cansaço.',
  'Fiquei irritado(a) com mais facilidade que o habitual.',
  'Tive dificuldade para manter o foco nas tarefas.',
  'Preocupações com outros assuntos interromperam minha concentração.',
  'Percebi esquecimentos que dificultaram minhas atividades habituais.',
  'Percebi pequenos lapsos de atenção que exigiram conferir novamente uma tarefa.',
  'Tive dificuldade para desligar a mente e relaxar após o trabalho.',
  'Senti que minha energia era insuficiente para as demandas do dia.',
  'Senti esgotamento a ponto de precisar interromper uma atividade para me recuperar.'
 ]},
 {id:'symptoms',label:'Sintomas físicos percebidos',questions:[
  'Senti dor de cabeça.',
  'Senti peso ou tensão nos ombros.',
  'Senti dores nas costas.',
  'Senti falta de ar ou dificuldade para respirar.',
  'Senti a boca seca.',
  'Percebi rouquidão ou cansaço na voz.',
  'Senti tontura.',
  'Percebi tremores ou contrações nas pálpebras.',
  'Percebi tremores nos braços ou nas pernas.',
  'Senti mal-estar ou sensação de estar adoecendo.'
 ]}
];
export const QUESTIONS=DIMENSIONS.flatMap((dimension,block)=>dimension.questions.map((text,i)=>({id:'S'+String(block*10+i+1).padStart(2,'0'),text,dimension:dimension.id})));
export const BANDS=[{id:'mild',label:'Fadiga leve',min:0,max:30},{id:'moderate',label:'Fadiga moderada',min:31,max:60},{id:'high',label:'Fadiga alta',min:61,max:90},{id:'very_high',label:'Fadiga muito alta',min:91,max:150}];
export function validateAnswers(answers){
 if(!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).length!==30||!QUESTIONS.every(q=>Object.hasOwn(answers,q.id)&&Number.isInteger(answers[q.id])&&answers[q.id]>=0&&answers[q.id]<=5))throw Error('COMPLETE_ALL_30');
 return Object.fromEntries(QUESTIONS.map(q=>[q.id,answers[q.id]]));
}
export function calculate(answers,stressRating){
 const clean=validateAnswers(answers);
 if(stressRating!==undefined&&(!Number.isInteger(stressRating)||stressRating<0||stressRating>10))throw Error('INVALID_STRESS_RATING');
 const total=Object.values(clean).reduce((a,b)=>a+b,0),band=BANDS.find(b=>total>=b.min&&total<=b.max);
 return {total,band:band.id,bandLabel:band.label,dimensions:DIMENSIONS.map(d=>({id:d.id,label:d.label,score:QUESTIONS.filter(q=>q.dimension===d.id).reduce((sum,q)=>sum+clean[q.id],0),maximum:50})),...(stressRating!==undefined?{stressRating}:{})};
}
export function validateSubmission(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).every(k=>['survey_cycle','survey_version','submission_id','group','answers','stress_rating'].includes(k)))throw Error('INVALID_FIELDS');
 if(input.survey_cycle!==CYCLE||input.survey_version!==VERSION||!/^[a-f0-9]{32}$/.test(input.submission_id)||!Object.hasOwn(GROUPS,input.group))throw Error('INVALID_SUBMISSION');
 const answers=validateAnswers(input.answers);calculate(answers,input.stress_rating);
 return {survey_cycle:CYCLE,survey_version:VERSION,submission_id:input.submission_id,group:input.group,answers,...(input.stress_rating!==undefined?{stress_rating:input.stress_rating}:{})};
}
