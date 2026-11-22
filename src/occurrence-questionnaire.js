import {OCCURRENCE_ANALYSIS_FIELDS} from './occurrence-schema.js';

export const GRA_001_RECORD_ID = '49de5878-28c7-40b5-81e6-f416d58b2433';
export const OCCURRENCE_QUESTION_COUNT = 4;
export const OCCURRENCE_OPTION_LIMIT = 5;
export const OCCURRENCE_PROMPT_LIMIT = 500;
export const OCCURRENCE_OPTION_TEXT_LIMIT = 300;
export const OCCURRENCE_COMMENT_LIMIT = 2000;

export const GRA_001_QUESTIONS = [
  {
    prompt: 'Quais valores ou princípios você considera mais relevantes para deliberar sobre o destino pós-operatório neste caso?',
    options: [
      'Beneficência, considerando o benefício esperado para o paciente.',
      'Não maleficência, ponderando os riscos de cada destino possível.',
      'Autonomia, considerando as preferências do paciente quando conhecidas.',
      'Justiça, considerando critérios consistentes de acesso ao CTI.',
      'Ponderação conjunta desses princípios, explicitando os conflitos entre eles.'
    ]
  },
  {
    prompt: 'Qual informação ou fator adicional você priorizaria para esclarecer a decisão sobre o CTI neste caso?',
    options: [
      'Condição clínica ao término da anestesia e necessidade de suporte.',
      'Motivo da reserva prévia e o que mudou desde o planejamento.',
      'Preferências do paciente ou de seu representante, quando aplicável.',
      'Capacidade de acompanhamento e suporte nos destinos disponíveis.',
      'Critérios institucionais de admissão e avaliação da equipe do CTI.'
    ]
  },
  {
    prompt: 'Como você organizaria a participação das partes interessadas na deliberação sobre o destino pós-operatório?',
    options: [
      'Anestesiologista e cirurgião discutem o caso e registram os fundamentos da decisão.',
      'Anestesiologista, cirurgião e equipe do CTI deliberam juntos quando a indicação é incerta.',
      'O responsável previsto no fluxo do serviço coordena a deliberação e ouve as equipes envolvidas.',
      'A equipe envolvida incorpora as preferências do paciente ou do representante, conforme aplicável.'
    ]
  },
  {
    prompt: 'Qual abordagem você considera eticamente mais justificável diante dos fatos e das lacunas do relato?',
    options: [
      'Reavaliar as alternativas em conjunto e justificar a decisão com os dados atuais e critérios institucionais.',
      'Manter o planejamento inicial se a avaliação atual sustentar os motivos da reserva.',
      'Solicitar avaliação da equipe do CTI para esclarecer a indicação diante da incerteza.',
      'Seguir o fluxo institucional de deliberação e escalar a decisão se persistir divergência.'
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
