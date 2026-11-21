import {OCCURRENCE_ANALYSIS_FIELDS} from './occurrence-schema.js';

export const GRA_001_RECORD_ID = '49de5878-28c7-40b5-81e6-f416d58b2433';
export const OCCURRENCE_QUESTION_COUNT = 4;
export const OCCURRENCE_OPTION_LIMIT = 5;
export const OCCURRENCE_PROMPT_LIMIT = 500;
export const OCCURRENCE_OPTION_TEXT_LIMIT = 300;
export const OCCURRENCE_COMMENT_LIMIT = 2000;

export const GRA_001_QUESTIONS = [
  {
    prompt: 'Na sua avaliação, quem deve participar da decisão final sobre o destino do paciente?',
    options: [
      'Anestesiologista, por avaliar a condição clínica ao término da anestesia.',
      'Cirurgião, por ser responsável pelo procedimento e pelo planejamento pós-operatório.',
      'Decisão compartilhada entre anestesiologista e cirurgião, considerando as responsabilidades de cada um.',
      'Profissional responsável pela avaliação clínica, seguindo critérios institucionais e ouvindo a equipe envolvida.',
      'Outra posição.'
    ]
  },
  {
    prompt: 'Qual fator deve ter maior peso na decisão de encaminhar o paciente ao CTI?',
    options: [
      'A reserva prévia do leito.',
      'A condição clínica atual, os riscos e a necessidade de suporte intensivo.',
      'A indicação do cirurgião.',
      'A avaliação do anestesiologista.',
      'A avaliação clínica integrada aos critérios institucionais de admissão.'
    ]
  },
  {
    prompt: 'Se houver discordância entre anestesiologista e cirurgião, qual deve ser o próximo passo?',
    options: [
      'Prevalece a decisão do profissional mais experiente.',
      'Reavaliar conjuntamente o paciente, discutir os riscos e documentar a decisão.',
      'Acionar a coordenação médica imediatamente em todos os casos.',
      'Aplicar o protocolo institucional e escalar o caso se o impasse persistir.'
    ]
  },
  {
    prompt: 'Qual solução você considera mais adequada para evitar novos conflitos?',
    options: [
      'Criar um protocolo com critérios claros de admissão e alta do CTI.',
      'Definir previamente as responsabilidades do anestesiologista e do cirurgião.',
      'Estabelecer decisão compartilhada e fluxo de escalonamento em caso de divergência.',
      'Integrar as três medidas.'
    ]
  }
];

export function normalizeOccurrenceQuestions(questions) {
  const validText=(text,max)=>typeof text==='string'&&text.trim().length>0&&text.trim().length<=max;
  if (!Array.isArray(questions)||questions.length!==OCCURRENCE_QUESTION_COUNT||
    !questions.every(question=>validText(question?.prompt,OCCURRENCE_PROMPT_LIMIT)&&
      Array.isArray(question.options)&&question.options.length>=2&&question.options.length<=OCCURRENCE_OPTION_LIMIT&&
      question.options.every(text=>validText(text,OCCURRENCE_OPTION_TEXT_LIMIT)))) {
    throw new Error('OCCURRENCE_QUESTIONNAIRE_INVALID');
  }
  return questions.map(({prompt,options})=>({prompt:prompt.trim(),options:options.map(text=>text.trim())}));
}

export function formatOccurrenceAnalysisExport({label,questions,entries,legacy}) {
  const definition = questions.map(({prompt,options},index)=>
    ['PERGUNTA '+(index+1)+' DE '+questions.length,prompt,
      ...options.map((text,option)=>(option+1)+'. '+text)].join('\n'));
  const responses = entries.map(({answers,comment},index)=>[
    'RESPOSTA '+(index+1),
    ...answers.map((answer,question)=>(question+1)+'. '+questions[question].options[answer-1]),
    'Comentário:',comment||'(sem comentário)'
  ].join('\n'));
  const previous = legacy.map(({analysis},index)=>['ANÁLISE ANTERIOR '+(index+1),
    ...Object.entries(OCCURRENCE_ANALYSIS_FIELDS).map(([key,field])=>field+'\n'+(analysis[key]??''))].join('\n\n'));
  return [label+' — ABORDAGEM','Total de respostas: '+(entries.length+legacy.length),...definition,...responses,...previous].join('\n\n');
}
