import {MANAGEMENT_AREA_SEED} from './management-seed.js';
export const REGISTRATION_CYCLE='2026';
export const PROFESSIONAL_FIELDS=[
 {id:'fullName',label:'Nome completo',type:'text',required:true,max:180,section:'Identificação'},
 {id:'filiation',label:'Filiação',type:'text',max:240},
 {id:'birthDate',label:'Data de nascimento',type:'date',required:true},
 {id:'cpf',label:'CPF',type:'text',required:true,max:14,inputmode:'numeric'},
 {id:'crm',label:'Número do CRM',type:'text',required:true,max:12,inputmode:'numeric'},
 {id:'crmState',label:'UF do CRM',type:'select',required:true,options:['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(x=>[x,x])},
 {id:'rqe',label:'RQE, quando houver',type:'text',max:100},
 {id:'phone',label:'Telefone com DDD',type:'tel',required:true,max:40,section:'Contato e atuação'},
 {id:'address',label:'Endereço completo',type:'textarea',required:true,max:600},
 {id:'workDays',label:'Dias habituais de trabalho',type:'checks',required:true,options:['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado','Domingo','Escala variável'].map((x,i)=>[String(i),x])},
 {id:'shifts',label:'Horários, jornadas e plantões',type:'textarea',required:true,max:1200},
 {id:'managementAreas',label:'Áreas de gestão em que gostaria de participar (mínimo de duas)',type:'checks',required:true,min:2,options:MANAGEMENT_AREA_SEED.map(a=>[a.id,a.name]),section:'Áreas de interesse'},
 {id:'surgicalAreas',label:'Áreas da clínica cirúrgica em que tem maior entrosamento e gosta de atuar',type:'textarea',required:true,max:2000},
 {id:'surgicalDetails',label:'Áreas específicas ou subespecialidades de interesse',type:'textarea',max:1500},
 {id:'formation',label:'Formação, títulos e qualificações',type:'textarea',required:true,max:4000,section:'Formação e competências',help:'Descreva suas qualificações ou informe Nenhum.'},
 {id:'technicalSkills',label:'Competências técnicas',type:'textarea',required:true,max:4000,help:'Descreva ou informe Nenhum.'},
 {id:'leadership',label:'Gestão, liderança e governança',type:'textarea',required:true,max:3000,help:'Descreva experiências ou informe Nenhum.'},
 {id:'teachingResearch',label:'Ensino, pesquisa e inovação',type:'textarea',required:true,max:3000,help:'Descreva experiências ou informe Nenhum.'},
 {id:'complementarySkills',label:'Competências complementares',type:'textarea',required:true,max:3000,help:'Descreva ou informe Nenhum.'},
 {id:'institutionalParticipation',label:'Participação institucional',type:'textarea',required:true,max:3000,help:'Descreva comissões, projetos ou atividades, ou informe Nenhum.'},
 {id:'lattes',label:'Link do Currículo Lattes',type:'url',max:300},
 {id:'outsideWork',label:'Exerce atividades profissionais fora do SAHMT?',type:'select',required:true,options:[['NO','Não'],['YES','Sim']],section:'Informações adicionais'},
 {id:'outsideWorkDetails',label:'Se desejar, descreva suas atividades externas',type:'textarea',max:1500,when:['outsideWork','YES']},
 {id:'additionalInfo',label:'Outras experiências ou informações relevantes para o desenvolvimento da equipe',type:'textarea',max:3000}
];
const choices=values=>values.map((label,i)=>[String(i),label]);
const frequency=[['NEVER','Nunca'],['RARELY','Raramente'],['SOMETIMES','Às vezes'],['OFTEN','Quase sempre'],['ALWAYS','Sempre']];
export const EPIDEMIOLOGICAL_FIELDS=[
 {id:'ageBand',label:'Faixa etária',type:'select',options:choices(['Menos de 20 anos','20 a 29 anos','30 a 39 anos','40 a 49 anos','50 a 59 anos','60 a 69 anos','70 a 79 anos','80 anos ou mais']),section:'Perfil e hábitos'},
 {id:'bmiBand',label:'Faixa de IMC',type:'select',options:[['LOW','Menor que 18,5'],['MID','18,5 a menos de 25'],['UPPER','25 a menos de 30'],['B30','30 a menos de 35'],['B35','35 a menos de 40'],['B40','40 ou mais']]},
 {id:'exercise',label:'Em quantos dias da semana costuma praticar atividade física?',type:'select',options:choices(['Nenhum','1 a 2 dias','3 a 4 dias','5 dias ou mais'])},
 {id:'routineCare',label:'Com que frequência costuma realizar avaliações de saúde de rotina?',type:'select',options:choices(['Mensalmente','A cada três meses','A cada seis meses','Anualmente','Em intervalos maiores que um ano','Somente diante de sintomas ou urgências'])},
 {id:'diet',label:'Qual padrão predomina na sua rotina alimentar?',type:'select',options:choices(['Refeições caseiras regulares','Refeições planejadas com orientação nutricional','Refeições fora de casa em horários irregulares','Fast food ou alimentos industrializados com frequência','Rotina variada, sem um padrão predominante'])},
 {id:'sleep',label:'Como considera seu sono habitual?',type:'select',options:choices(['Regular','Irregular','Tenho alteração ou distúrbio do sono referido'])},
 {id:'sleepHours',label:'Quantas horas costuma dormir por dia?',type:'select',options:choices(['Menos de 5 horas','5 a menos de 6 horas','6 a menos de 7 horas','7 a menos de 8 horas','8 horas ou mais'])},
 {id:'weeklyRest',label:'Qual é sua frequência de descanso semanal?',type:'select',options:choices(['Nenhum dia de descanso na semana','Um dia por semana','Dois ou mais dias por semana','Descanso em intervalos maiores que uma semana'])},
 {id:'conditions',label:'Possui alguma condição de saúde que deseja informar?',type:'checks',none:'NONE',options:[['NONE','Nenhuma condição referida'],['CARDIO','Cardiovascular'],['ENDO','Endocrinológica ou metabólica'],['RESP','Respiratória'],['MUSC','Musculoesquelética'],['NEURO','Neurológica ou de saúde mental'],['RENAL','Renal'],['OTHER','Outra condição, sem detalhar']],section:'Saúde autodeclarada'},
 {id:'medication',label:'Faz uso de medicamentos?',type:'select',options:[['NO','Não'],['YES','Sim']]},
 {id:'familyHistory',label:'Há histórico familiar de alguma das condições abaixo?',type:'checks',none:'NONE',options:[['NONE','Nenhuma condição conhecida'],['DIAB','Diabetes'],['HYPER','Hipertensão'],['CARDIO','Cardiopatia'],['CANCER','Câncer'],['RENAL','Doença renal'],['MENTAL','Depressão ou outra condição de saúde mental'],['UNKNOWN','Não sei informar']]},
 {id:'tobacco',label:'Qual alternativa descreve seu uso de tabaco ou cigarro eletrônico?',type:'select',options:choices(['Nunca usei','Ex-usuário','Uso cigarro convencional','Uso cigarro eletrônico','Uso ambos'])},
 {id:'alcohol',label:'Em quantos dias da semana costuma consumir bebida alcoólica?',type:'select',options:choices(['Não consumo','Até um dia por semana','Dois a três dias por semana','Quatro ou mais dias por semana'])},
 {id:'exhaustion',label:'Com que frequência considera seu ritmo de trabalho exaustivo?',type:'select',options:frequency,section:'Trabalho e bem-estar'},
 {id:'pressure',label:'Com que frequência sente muita pressão no trabalho?',type:'select',options:frequency},
 {id:'pauses',label:'Com que frequência consegue realizar pausas durante a jornada?',type:'select',options:frequency},
 {id:'ergonomics',label:'Com que frequência percebe desconforto relacionado à postura ou à organização do trabalho?',type:'select',options:frequency},
 {id:'program',label:'Qual sua opinião sobre um programa multiprofissional periódico de saúde e bem-estar para a equipe?',type:'select',options:choices(['Tenho interesse','Prefiro que seja avaliado em outro momento','Não tenho interesse no momento'])},
 {id:'priorities',label:'Quais frentes de saúde e bem-estar deveriam ser priorizadas?',type:'checks',options:[['REST','Descanso e organização das escalas'],['FOOD','Alimentação e nutrição'],['ACTIVITY','Atividade física'],['MENTAL','Apoio psicológico e saúde mental'],['PREVENTION','Avaliações preventivas de saúde'],['ERGONOMICS','Ergonomia e condições de trabalho'],['PAUSES','Pausas durante a jornada']]}
];
export const ATTACHMENT_SUBJECTS=Object.freeze({CV:'Currículo Lattes',PROFESSIONAL:'CRM e RQE',QUALIFICATIONS:'Diplomas e certificados',REGISTRATION:'Documentos cadastrais'});
const error=code=>{throw Object.assign(Error(code),{code,status:400});};
export function validCpf(value){const v=String(value).replace(/\D/g,'');if(!/^\d{11}$/.test(v)||/^(\d)\1{10}$/.test(v))return false;return [9,10].every(n=>{const sum=[...v.slice(0,n)].reduce((s,d,i)=>s+Number(d)*(n+1-i),0);return (sum*10%11)%10===Number(v[n]);});}
export function validateProfessionalAnswers(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!PROFESSIONAL_FIELDS.some(f=>f.id===k)))error('REGISTRATION_INVALID_INPUT');const out={};
 for(const f of PROFESSIONAL_FIELDS){const v=input[f.id];if(f.type==='checks'){const list=v??[];if(!Array.isArray(list)||list.some(x=>!f.options.some(([id])=>id===x))||new Set(list).size!==list.length||f.required&&list.length<(f.min||1))error('REGISTRATION_INVALID_'+f.id.toUpperCase());out[f.id]=[...list].sort();continue;}if(v!==undefined&&typeof v!=='string')error('REGISTRATION_INVALID_'+f.id.toUpperCase());const text=(v||'').trim();if(f.required&&!text||text.length>(f.max||200)||f.options&&text&&!f.options.some(([id])=>id===text))error('REGISTRATION_INVALID_'+f.id.toUpperCase());out[f.id]=text;}
 if(!validCpf(out.cpf))error('REGISTRATION_INVALID_CPF');out.cpf=out.cpf.replace(/\D/g,'');if(out.fullName.split(/\s+/).length<2||!/^\d{1,12}$/.test(out.crm)||(!/^\+?[\d() .-]{10,40}$/.test(out.phone)||!/^\d{10,15}$/.test(out.phone.replace(/\D/g,'')))||!/^\d{4}-\d{2}-\d{2}$/.test(out.birthDate)||!Number.isFinite(Date.parse(out.birthDate+'T00:00:00Z'))||new Date(out.birthDate+'T00:00:00Z').toISOString().slice(0,10)!==out.birthDate||out.birthDate<'1900-01-01'||out.birthDate>new Date().toISOString().slice(0,10))error('REGISTRATION_INVALID_INPUT');
 if(out.lattes){let url;try{url=new URL(out.lattes);}catch{error('REGISTRATION_INVALID_LATTES');}if(!['https:','http:'].includes(url.protocol)||url.hostname!=='lattes.cnpq.br'||url.username||url.password)error('REGISTRATION_INVALID_LATTES');}if(out.outsideWork!=='YES')out.outsideWorkDetails='';return out;
}
export function bmiBand(weight,height){const w=Number(String(weight).replace(',','.')),h=Number(String(height).replace(',','.'));if(!Number.isFinite(w)||!Number.isFinite(h)||w<10||w>500||h<50||h>250)return null;const value=w/(h/100)**2;return {value:Math.round(value*10)/10,band:value<18.5?'LOW':value<25?'MID':value<30?'UPPER':value<35?'B30':value<40?'B35':'B40'};}
export function validateEpidemiologicalSubmission(input){
 const keys=['survey_cycle','survey_version','submission_id','group','consent','answers','comments'];if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k))||input.survey_cycle!==REGISTRATION_CYCLE||input.survey_version!=='1.0'||input.consent!==true||!/^[a-f0-9]{32}$/.test(input.submission_id)||!['team','resident'].includes(input.group))error('EPIDEMIOLOGICAL_INVALID_INPUT');
 if(!input.answers||typeof input.answers!=='object'||Array.isArray(input.answers)||Object.keys(input.answers).some(k=>!EPIDEMIOLOGICAL_FIELDS.some(f=>f.id===k)))error('EPIDEMIOLOGICAL_INVALID_INPUT');const answers={};let answered=0;
 for(const f of EPIDEMIOLOGICAL_FIELDS){const v=input.answers[f.id];if(f.type==='checks'){const list=v??[];if(!Array.isArray(list)||list.some(x=>!f.options.some(([id])=>id===x))||new Set(list).size!==list.length||f.none&&list.includes(f.none)&&list.length>1||list.includes('UNKNOWN')&&list.length>1)error('EPIDEMIOLOGICAL_INVALID_INPUT');answers[f.id]=[...list].sort();if(list.length)answered++;}else{if(v!==undefined&&v!==''&&v!=='NI'&&!f.options.some(([id])=>id===v))error('EPIDEMIOLOGICAL_INVALID_INPUT');answers[f.id]=v||'NI';if(answers[f.id]!=='NI')answered++;}}
 if(!answered)error('EPIDEMIOLOGICAL_EMPTY');if(input.comments!==undefined&&(typeof input.comments!=='string'||input.comments.length>1500))error('EPIDEMIOLOGICAL_INVALID_INPUT');return {survey_cycle:REGISTRATION_CYCLE,survey_version:'1.0',submission_id:input.submission_id,consent:true,group:input.group,answers,comments:(input.comments||'').trim()};
}
