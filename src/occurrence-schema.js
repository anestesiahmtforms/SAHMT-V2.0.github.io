export const OCCURRENCE_CATALOG_SPECS = Object.freeze({
  SETORES_9: Object.freeze({count: 9, searchable: false}),
  SETORES_55: Object.freeze({count: 55, searchable: true}),
  SIM_NAO_NI: Object.freeze({count: 3, searchable: false}),
  PERIODO: Object.freeze({count: 3, searchable: false}),
  TIPO_INTERNAÇÃO: Object.freeze({count: 2, searchable: false}),
  BRADEN: Object.freeze({count: 5, searchable: false}),
  TIPO_LP: Object.freeze({count: 4, searchable: false}),
  ESTAGIO_LP: Object.freeze({count: 6, searchable: false}),
  TOPOGRAFIA_LP: Object.freeze({count: 13, searchable: false}),
  RISCO_QUEDA: Object.freeze({count: 4, searchable: false}),
  LOCAL_QUEDA: Object.freeze({count: 6, searchable: false}),
  MECANISMO_QUEDA: Object.freeze({count: 3, searchable: false}),
  CONSCIENCIA: Object.freeze({count: 4, searchable: false}),
  TIPO_SEGURANCA: Object.freeze({count: 12, searchable: false}),
  TIPOS_INCIDENTES: Object.freeze({count: 145, searchable: true}),
  RAM_100: Object.freeze({count: 100, searchable: true})
});

const field = (id, label, type = 'text', extra = {}) => Object.freeze({id, label, type, required: true, ...extra});
const select = (id, label, catalog) => field(id, label, 'select', {catalog});
const date = (id, label) => field(id, label, 'date');
const time = (id, label) => field(id, label, 'time');
const long = (id, label) => field(id, label, 'textarea', {maxLength: 3000});
const attendance = (id = 'attendance', maxLength = 180) => field(id, 'Atendimento', 'text', {
  maxLength, fullWidth: true, hint: 'Conferir o número do atendimento, pois é imprescindível'
});
const patientFields = Object.freeze([
  field('sex', 'Sexo', 'select', {options: Object.freeze(['Masculino', 'Feminino', 'Outro'])}),
  field('age', 'Idade', 'text', {maxLength: 40, hint: 'Informe em anos, meses ou dias'}),
  long('diagnosisOrTreatment', 'Diagnóstico ou Tratamento')
]);

const choice = (id, label, options, extra = {}) => field(id, label, 'select', {options: Object.freeze(options), ...extra});

export const OCCURRENCE_EVENT_CLASSIFICATIONS = Object.freeze([
  'Circunstância de Risco', 'Evento Adverso Grave', 'Evento Adverso Leve', 'Evento Adverso Moderado',
  'Evento sem Dano', 'Near Miss (Erro)', 'Never Events', 'Óbito'
]);
const eventClassification = choice('eventClassification', 'Classificação do evento:', OCCURRENCE_EVENT_CLASSIFICATIONS, {fullWidth:true});
const common = Object.freeze([
  date('eventDate', 'Data da ocorrência'),
  eventClassification,
  field('occurrence', 'Ocorrência', 'text', {hint:'Descreva o tipo de ocorrência de forma objetiva',maxLength:180}),
  field('description', 'Descrição', 'textarea', {hint:'Faça uma descrição detalhada e completa, passo a passo do ocorrido',maxLength:5000})
]);

const disclosure = choice('chartDisclosure', 'Disclosure com registro em prontuário:', [
  'Sim', 'Não', 'Não se aplica (Evento sem envolver o paciente)'
], {fullWidth: true});
const analysisParticipants = field('analysisParticipants', 'Pessoas envolvidas na análise do evento:', 'text', {
  fixedValue: 'Serviço de Anestesiologia', fullWidth: true
});

const clinicalFactors = Object.freeze([
  choice('patientFactors', 'Fatores contribuintes do paciente?', [
    'Nenhum', 'Barreira linguística e de comunicação', 'Doença (complexidade e gravidade)', 'Personalidade e fatores sociais'
  ]),
  choice('taskFactors', 'Fatores contribuintes da tarefa?', [
    'Nenhum', 'Clareza da estrutura e concepção da tarefa', 'Disponibilidade e acurácia de resultados de exames', 'Disponibilidade e uso de protocolos'
  ]),
  choice('individualFactors', 'Fatores contribuintes individuais?', [
    'Nenhum', 'Conhecimento e habilidades', 'Valores e comportamentos profissionais', 'Competências'
  ]),
  choice('teamFactors', 'Fatores contribuintes do time (equipe)?', [
    'Nenhuma', 'Comunicação escrita', 'Comunicação verbal', 'Consciência situacional e representação compartilhada',
    'Estrutura da equipe (congruência, consistência, liderança)', 'Supervisão e busca por ajuda', 'Apoio mútuo'
  ]),
  choice('workEnvironmentFactors', 'Fatores do ambiente de trabalho?', [
    'Nenhuma', 'Nível das equipes e conjunto de habilidades', 'Padrões dos turnos e carga de trabalho',
    'Design, disponibilidade e manutenção dos equipamentos', 'Ambiente físico', 'Apoio administrativo e gerencial', 'Atrasos'
  ])
]);
const informationTechnology = choice('informationTechnologyFactors', 'Fatores de TI e sistemas eletrônicos?', [
  'Nenhuma', 'Hardware (incluindo design e manutenção)', 'Software (incluindo design e manutenção)',
  'Conteúdo técnico e suporte à decisão clínica', 'Interface pessoa-dispositivo', 'Integração no fluxo de trabalho', 'Proteção de dados'
]);

const immediateAction = () => long('immediateAction', 'Disposição (ação imediata: Descreva sintomas observados e suas ações para o cuidado)');
const actionFollowup = (after, fields, factors, closingFields = []) => Object.freeze({
  after, fields: Object.freeze([...fields, analysisParticipants]), factors: Object.freeze(factors),
  closingFields: Object.freeze(closingFields)
});
const clinicalFollowup = actionFollowup('immediateAction', [], clinicalFactors, [disclosure]);
const periodFollowup = actionFollowup('eventPeriod', [], clinicalFactors, [disclosure]);
const adverseReactionFollowup = actionFollowup('prescriptionNumber', [immediateAction()], clinicalFactors, [disclosure]);
const informationSecurityFollowup = actionFollowup('othersInformed', [], [informationTechnology]);

export function occurrenceActionFollowupFields(form) {
  const followup = form.actionFollowup;
  return followup ? [...followup.fields, ...followup.factors, ...followup.closingFields] : [];
}

export function withOccurrencePatientFields(fields) {
  return fields.flatMap(item => item.id === 'attendance' || item.id === 'patientOrAttendance'
    ? [item, ...patientFields] : [item]);
}

const forms = [
  {id: 'F01', group: 'A', title: 'Notificação de Farmacovigilância - Queixa Técnica de Medicamento', fields: [
    attendance(), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    field('medicationName', 'Nome do Medicamento'), field('lotNumber', 'Número do Lote'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'),
    immediateAction(), select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F02', group: 'A', title: 'Notificação de Farmacovigilância - Reação Adversa ao Medicamento',
    actionFollowup: adverseReactionFollowup, fields: [
    attendance(), select('eventSector', 'Local de ocorrência da RAM', 'SETORES_9'),
    select('reactionEvent', 'Qual incidente/evento aconteceu?', 'RAM_100'), field('medicationRegimen', 'Nome do Medicamento/Esquema QT'),
    date('suspectedReactionDate', 'Data suspeita RAM'), field('prescriptionNumber', 'Número Prescrição')
  ]},
  {id: 'F03', group: 'A', title: 'Notificação de Incidentes Assistenciais', fields: [
    attendance(), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    select('admissionType', 'Tipo de internação', 'TIPO_INTERNAÇÃO'), select('incidentType', 'Tipo de Evento', 'TIPOS_INCIDENTES'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), immediateAction(),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F04', group: 'A', title: 'Notificação de Lesão por Pressão (LP)', fields: [
    attendance(), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    select('originSector', 'Setor de Origem da LP', 'SETORES_55'), select('bradenRisk', 'Risco para LP (Escala de Braden)', 'BRADEN'),
    date('lesionOpeningDate', 'Data da Abertura da Lesão'), select('lesionType', 'Tipo de LP', 'TIPO_LP'),
    select('lesionStage', 'Estágio da Lesão', 'ESTAGIO_LP'), select('topography', 'Topografia', 'TOPOGRAFIA_LP'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), immediateAction(),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F05', group: 'A', title: 'Notificação de Queda', fields: [
    attendance(), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    date('fallDate', 'Data da Queda'), time('fallTime', 'Horário da Queda'), select('fallRisk', 'Classificação do Risco de Queda', 'RISCO_QUEDA'),
    select('fallRiskGuidance', 'Orientado quanto ao risco de queda?', 'SIM_NAO_NI'), date('lastAssessmentDate', 'Data da Última Avaliação'),
    select('redWristband', 'Portador de Pulseira Vermelha?', 'SIM_NAO_NI'), select('fallLocation', 'Local da Queda', 'LOCAL_QUEDA'),
    select('fallMechanism', 'Mecanismo de queda', 'MECANISMO_QUEDA'), select('adequateFootwear', 'Em uso de calçado adequado?', 'SIM_NAO_NI'),
    select('consciousness', 'Estado de Consciência no Momento', 'CONSCIENCIA'), select('injury', 'Apresentou lesão?', 'SIM_NAO_NI'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), immediateAction(),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F06', group: 'A', title: 'Notificação de Tecnovigilância - Equipamentos', fields: [
    attendance(), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    field('equipmentName', 'Nome do Equipamento'), field('tagNumber', 'Número TAG'), field('serialNumber', 'Número de Série'),
    field('serviceCallNumber', 'Número do chamado'), date('failureDate', 'Data falha do equipamento'), time('failureTime', 'Horário da falha do equipamento'),
    select('clinicalEngineeringCalled', 'Engenharia Clínica foi acionada?', 'SIM_NAO_NI'),
    select('previousOccurrence', 'O Fato Ocorreu Anteriormente?', 'SIM_NAO_NI'), select('causedDamage', 'Causou Danos?', 'SIM_NAO_NI'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), immediateAction(),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F07', group: 'A', title: 'Notificação de Tecnovigilância - Materiais', fields: [
    attendance(), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    field('materialName', 'Nome do Material'), field('manufacturerName', 'Nome do Fabricante'), field('lotNumber', 'Lote'),
    select('previousOccurrence', 'O Fato Ocorreu Anteriormente?', 'SIM_NAO_NI'), select('causedDamage', 'Causou Danos?', 'SIM_NAO_NI'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), immediateAction(),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F08', group: 'B', title: 'Dilema Ético', classification: [select('occurrenceSector', 'Setor da Ocorrência', 'SETORES_55')],
    fields: [attendance()]},
  {id: 'F09', group: 'C', title: 'Notificação de Incidente de Segurança da Informação',
    actionFollowup: informationSecurityFollowup, fields: [
    attendance(), time('incidentTime', 'Hora'), field('incidentLocation', 'Localização (Onde está o incidente)'),
    long('incidentEffect', 'Efeito do incidente'), field('eventDiscovery', 'Como o evento foi descoberto'),
    select('securityIncidentType', 'Tipo de incidente', 'TIPO_SEGURANCA'), field('othersInformed', 'Quem mais foi informado')
  ]},
  {id: 'F10', group: 'D', title: 'Não Conformidade de Processo', classification: [
    select('sourceSector', 'Setor de Origem', 'SETORES_55'), select('destinationSector', 'Setor de Destino', 'SETORES_55'),
    attendance('patientOrAttendance', 160),
    immediateAction()
  ], fields: [eventClassification], noGeneralInformation: true}
].map(form => {
  const classification = Object.freeze(form.classification || []);
  const fields = Object.freeze(form.noGeneralInformation ? form.fields : [...common, ...form.fields]);
  const defaultFollowup = fields.some(item => item.id === 'eventPeriod') ? periodFollowup
    : classification.some(item => item.id === 'immediateAction') ? clinicalFollowup : null;
  return Object.freeze({...form, classification, fields, actionFollowup: form.actionFollowup ?? defaultFollowup});
});

export const OCCURRENCE_FORMS = Object.freeze(forms);
export const OCCURRENCE_GROUPS = Object.freeze([
  Object.freeze({id: 'A', title: 'Notificação de Incidente Assistencial'}),
  Object.freeze({id: 'B', title: 'Notificação de Infração ou Dilema Ético'}),
  Object.freeze({id: 'C', title: 'Notificação de Lei Geral de Proteção de Dados (LGPD)'}),
  Object.freeze({id: 'D', title: 'Não Conformidade'})
]);
export const OCCURRENCE_PENDING_FORM = Object.freeze({group: 'A', label: 'Notificação de Farmacovigilância Oncológica - Reação Adversa ao Medicamento', status: 'Em preparação'});

export function getOccurrenceForm(formId) {
  return OCCURRENCE_FORMS.find(form => form.id === formId) || null;
}

export function occurrenceAppProtocol(sequence) {
  return Number.isSafeInteger(sequence) && sequence > 0 ? `GRA ${String(sequence).padStart(3,'0')}` : '';
}

export const OCCURRENCE_REGISTRATION_POINTS = 3;
export const OCCURRENCE_SCORE_ID = /^(?:[A-Fa-f0-9-]{36}|(?:analysis|ack)-(?:[A-Fa-f0-9-]{36}|gr-[1-9]\d{0,11})_[A-Za-z0-9_-]{1,128})$/;

export const OCCURRENCE_ANALYSIS_FIELDS = Object.freeze({
  problem: 'IDENTIFICAÇÃO DO PROBLEMA',
  cause: 'IDENTIFICAÇÃO DA CAUSA',
  review: 'ANÁLISE DO PROBLEMA',
  correction: 'AÇÃO DE CORREÇÃO',
  plan: 'PLANO E AÇÃO'
});
export const OCCURRENCE_ANALYSIS_LIMIT = 3000;
export const OCCURRENCE_ETHICAL_REVIEW_LIMIT = 20000;
export const OCCURRENCE_PRIVATE_FIELDS = Object.freeze([
  'attendance','patientOrAttendance','prescriptionNumber','othersInformed','eventDiscovery','actionFollowup', ...patientFields.map(item => item.id)
]);

export function occurrenceHospitalNumber(value) {
  const digits = /^(?:GR\s*)?(\d{1,12})$/i.exec(String(value ?? '').trim())?.[1];
  return digits?.replace(/^0+/,'') || '';
}

export function occurrenceProtocol(entry) {
  return entry.origin === 'hospital' ? `GR ${entry.hospitalNumber.padStart(3,'0')}` : occurrenceAppProtocol(entry.sequence);
}

export function readOccurrenceAnalysis(values) {
  const analysis = Object.fromEntries(Object.keys(OCCURRENCE_ANALYSIS_FIELDS).map(key => [key,String(values?.[key] ?? '').trim()]));
  const fields = Object.values(analysis);
  if (fields.every(text => !text)) return null;
  if (fields.some(text => !text || text.length > OCCURRENCE_ANALYSIS_LIMIT)) throw new Error('OCCURRENCE_ANALYSIS_INCOMPLETE');
  return analysis;
}

export function validateOccurrenceValues(formId, values, catalogs = {}) {
  const form = getOccurrenceForm(formId);
  if (!form || !values || typeof values !== 'object' || Array.isArray(values)) return {valid: false, errors: ['FORM_INVALID']};
  const errors = [];
  const followup = form.actionFollowup;
  const fields = withOccurrencePatientFields([...form.classification, ...form.fields]).flatMap(item => {
    if (item.id !== followup?.after) return [item];
    if (item.id === 'eventPeriod') return [...followup.fields, ...followup.factors, item, ...followup.closingFields];
    return [item, ...occurrenceActionFollowupFields(form)];
  });
  for (const item of fields) {
    const value = item.fixedValue ?? values[item.id];
    const empty = value === undefined || value === null || String(value).trim() === '';
    if (item.required && empty) { errors.push(`REQUIRED:${item.id}`); continue; }
    if (empty) continue;
    if (typeof value !== 'string') { errors.push(`TYPE:${item.id}`); continue; }
    const normalized = value.trim();
    if (normalized.length > (item.maxLength || (item.type === 'textarea' ? 5000 : 180))) { errors.push(`LENGTH:${item.id}`); continue; }
    if (item.type === 'date' && !validDate(normalized)) errors.push(`DATE:${item.id}`);
    if (item.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) errors.push(`TIME:${item.id}`);
    if (item.type === 'select') {
      const options = item.options ?? catalogs[item.catalog];
      if (!item.options && (!Array.isArray(options) || options.length !== OCCURRENCE_CATALOG_SPECS[item.catalog]?.count)) errors.push(`CATALOG_UNAVAILABLE:${item.catalog}`);
      else if (!options.includes(normalized)) errors.push(`OPTION:${item.id}`);
    }
  }
  if (!form.noGeneralInformation) {
    for (const id of ['eventDate', 'occurrence', 'description']) if (!fields.some(item => item.id === id)) errors.push(`SCHEMA:${id}`);
  }
  return Object.freeze({valid: errors.length === 0, errors: Object.freeze(errors)});
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
