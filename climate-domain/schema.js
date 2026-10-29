export const VERSION = '1.4';
export const GROUPS = {team: 'Equipe', resident: 'Residentes'};
export const groupForModule = value => ({team:'team',resident:'resident',preceptor:'team',clinical:'team',substitute:'team'}[value] || 'unspecified');
export const CYCLE = '2026';
export const DIMENSIONS = [
  ['Propósito e pertencimento', ['Compreendo os objetivos e prioridades do SAHMT.', 'Sinto orgulho de integrar esta equipe.', 'Percebo respeito às diferentes experiências e gerações.', 'Sinto que minhas contribuições são valorizadas.']],
  ['Liderança e governança', ['As decisões relevantes são comunicadas com clareza.', 'A liderança ouve sugestões e preocupações da equipe.', 'Os critérios para decisões que afetam o trabalho são transparentes.', 'Confio que problemas relatados são tratados de forma justa.']],
  ['Comunicação e cooperação', ['Recebo informações necessárias em tempo adequado.', 'Há boa cooperação entre anestesiologistas, residentes e equipe administrativa.', 'Mudanças de processos são explicadas antes da implementação, quando possível.', 'A passagem de informações entre profissionais e turnos é segura e organizada.']],
  ['Segurança psicológica e cultura justa', ['Posso expressar dúvidas ou preocupações sem receio de humilhação.', 'Sinto segurança para comunicar incidentes e quase falhas.', 'Os relatos de segurança são utilizados para aprendizagem e prevenção.', 'Posso questionar uma conduta quando identifico risco ao paciente, independentemente da hierarquia.']],
  ['Condições de trabalho e bem-estar', ['A distribuição de demandas e responsabilidades é percebida como equilibrada.', 'Tenho acesso a recursos e informações necessários para realizar meu trabalho com segurança.', 'A organização considera os impactos de fadiga e sobrecarga na segurança.', 'Sei onde buscar apoio quando enfrento dificuldades relacionadas ao trabalho.']],
  ['Desenvolvimento e melhoria', ['Recebo feedback construtivo que contribui para meu desenvolvimento.', 'Tenho oportunidades adequadas de atualização e aprendizagem.', 'Sou incentivado(a) a sugerir melhorias nos processos.', 'Conheço as ações de melhoria decorrentes de avaliações, auditorias ou incidentes.']],
  ['Qualidade e experiência do paciente', ['A identificação correta do paciente é uma prioridade visível no serviço.', 'As práticas de comunicação segura são incentivadas no cotidiano.', 'O serviço promove discussão respeitosa de riscos e oportunidades de melhoria.', 'Percebo compromisso consistente com qualidade assistencial e experiência do paciente.']],
  ['Engajamento e futuro', ['Acredito que o SAHMT está preparado para crescer mantendo a qualidade.', 'Pretendo continuar contribuindo para o desenvolvimento da equipe.', 'A equipe participa de forma significativa das mudanças que impactam seu trabalho.', 'Confio que os resultados desta pesquisa serão utilizados para melhorias concretas.']]
];
const questions = (prefix, texts) => texts.map((text, i) => ({id: prefix + String(i + 1).padStart(2, '0'), text}));
export const COMMON = questions('Q', DIMENSIONS.flatMap(([, texts]) => texts));
export const MODULES = {
  resident: questions('R', ['Recebo supervisão compatível com minha etapa de formação.', 'Posso pedir ajuda ao preceptor sem constrangimento.', 'Os feedbacks educacionais são oportunos e respeitosos.', 'Tenho clareza sobre responsabilidades e limites de autonomia.', 'As oportunidades de aprendizagem são distribuídas de forma justa.']),
  preceptor: questions('T', ['Tenho clareza sobre minhas responsabilidades como preceptor.', 'Disponho de condições para supervisionar com segurança.', 'Há alinhamento entre os preceptores quanto às expectativas educacionais.', 'Recebo apoio para lidar com dificuldades de ensino e supervisão.', 'A atividade de preceptoria é reconhecida pela organização.'])
};
export const OPEN = questions('O', ['Qual é o principal ponto forte do SAHMT que devemos preservar?', 'Qual mudança teria maior impacto positivo no seu cotidiano?', 'Que situação ou processo merece atenção prioritária para a segurança do paciente?', 'O que poderia melhorar a integração entre diferentes funções e gerações?', 'Há alguma sugestão adicional? Evite nomes e detalhes identificáveis.']);
export const questionsForSelection = value => MODULES[value] || (value === 'team' ? MODULES.preceptor : []);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowedKeys = (value, keys) => isObject(value) && Object.keys(value).every(key => keys.includes(key));
export function validateSubmission(input) {
  if (!allowedKeys(input, ['survey_version', 'survey_cycle', 'submission_id', 'consent', 'answers', 'comments', 'group']) || input.consent !== true || input.survey_version !== VERSION || input.survey_cycle !== CYCLE || !/^[a-f0-9]{32}$/.test(input.submission_id)) throw Error('INVALID_SUBMISSION');
  const group = input.group;
  if (!Object.hasOwn(GROUPS,group)) throw Error('INVALID_GROUP');
  const ids = [...COMMON, ...Object.values(MODULES).flat()].map(q => q.id);
  if (!allowedKeys(input.answers, ids) || !COMMON.some(q => Number.isInteger(input.answers[q.id]))) throw Error('INVALID_ANSWERS');
  const answers = {};
  for (const [id, value] of Object.entries(input.answers)) {
    if (value !== 'NA' && (!Number.isInteger(value) || value < 1 || value > 5)) throw Error('INVALID_ANSWER');
    answers[id] = value;
  }
  if (Object.values(MODULES).filter(qs => qs.some(q => Object.hasOwn(answers, q.id))).length > 1) throw Error('MIXED_MODULES');
  if (input.survey_version === VERSION) for (const [key,qs] of Object.entries(MODULES)) if (qs.some(q => Object.hasOwn(answers,q.id)) && groupForModule(key) !== group) throw Error('GROUP_MODULE_MISMATCH');
  if (!allowedKeys(input.comments, OPEN.map(q => q.id))) throw Error('INVALID_COMMENTS');
  const comments = {};
  for (const [id, value] of Object.entries(input.comments)) {
    if (typeof value !== 'string' || value.length > 1500) throw Error('INVALID_COMMENT');
    if (value.trim()) comments[id] = value.trim();
  }
  return {survey_version: input.survey_version, survey_cycle: CYCLE, submission_id: input.submission_id, answers, comments, ...(Object.hasOwn(input,'group') ? {group} : {})};
}
