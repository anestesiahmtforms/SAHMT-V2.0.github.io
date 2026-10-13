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

const common = Object.freeze([
  {id: 'eventDate', label: 'Data da ocorrência', type: 'date', required: true},
  {id: 'occurrence', label: 'Ocorrência', type: 'text', required: true, maxLength: 180},
  {id: 'description', label: 'Descrição', type: 'textarea', required: true, maxLength: 5000}
]);
const field = (id, label, type = 'text', required = true, extra = {}) => Object.freeze({id, label, type, required, ...extra});
const select = (id, label, catalog, required = true) => field(id, label, 'select', required, {catalog});
const date = (id, label, required = true) => field(id, label, 'date', required);
const time = (id, label, required = true) => field(id, label, 'time', required);
const long = (id, label, required = true) => field(id, label, 'textarea', required, {maxLength: 3000});

const forms = [
  {id: 'F01', group: 'A', title: 'Notificação de Farmacovigilância - Queixa Técnica de Medicamento', fields: [
    field('attendance', 'Atendimento'), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    field('medicationName', 'Nome do Medicamento'), field('lotNumber', 'Número do Lote'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'),
    long('immediateAction', 'Disposição (ação imediata)'), select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F02', group: 'A', title: 'Notificação de Farmacovigilância - Reação Adversa ao Medicamento', fields: [
    field('attendance', 'Atendimento'), select('eventSector', 'Local de ocorrência da RAM', 'SETORES_9'),
    select('reactionEvent', 'Qual incidente/evento aconteceu?', 'RAM_100'), field('medicationRegimen', 'Nome do Medicamento/Esquema QT'),
    date('suspectedReactionDate', 'Data suspeita RAM'), field('prescriptionNumber', 'Número Prescrição')
  ]},
  {id: 'F03', group: 'A', title: 'Notificação de Incidentes Assistenciais', fields: [
    field('attendance', 'Atendimento'), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    select('admissionType', 'Tipo de internação', 'TIPO_INTERNAÇÃO'), select('incidentType', 'Tipo', 'TIPOS_INCIDENTES'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), long('immediateAction', 'Disposição (ação imediata)'),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F04', group: 'A', title: 'Notificação de Lesão por Pressão (LP)', fields: [
    field('attendance', 'Atendimento'), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    select('originSector', 'Setor de Origem da LP', 'SETORES_55'), select('bradenRisk', 'Risco para LP (Escala de Braden)', 'BRADEN'),
    date('lesionOpeningDate', 'Data da Abertura da Lesão'), select('lesionType', 'Tipo de LP', 'TIPO_LP'),
    select('lesionStage', 'Estágio da Lesão', 'ESTAGIO_LP'), select('topography', 'Topografia', 'TOPOGRAFIA_LP'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), long('immediateAction', 'Disposição (ação imediata)'),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F05', group: 'A', title: 'Notificação de Queda', fields: [
    field('attendance', 'Atendimento'), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    date('fallDate', 'Data da Queda'), time('fallTime', 'Horário da Queda'), select('fallRisk', 'Classificação do Risco de Queda', 'RISCO_QUEDA'),
    select('fallRiskGuidance', 'Orientado quanto ao risco de queda?', 'SIM_NAO_NI'), date('lastAssessmentDate', 'Data da Última Avaliação'),
    select('redWristband', 'Portador de Pulseira Vermelha?', 'SIM_NAO_NI'), select('fallLocation', 'Local da Queda', 'LOCAL_QUEDA'),
    select('fallMechanism', 'Mecanismo de queda', 'MECANISMO_QUEDA'), select('adequateFootwear', 'Em uso de calçado adequado?', 'SIM_NAO_NI'),
    select('consciousness', 'Estado de Consciência no Momento', 'CONSCIENCIA'), select('injury', 'Apresentou lesão?', 'SIM_NAO_NI'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), long('immediateAction', 'Disposição (ação imediata)'),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F06', group: 'A', title: 'Notificação de Tecnovigilância - Equipamentos', fields: [
    field('attendance', 'Atendimento'), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    field('equipmentName', 'Nome do Equipamento'), field('tagNumber', 'Número TAG'), field('serialNumber', 'Número de Série'),
    field('serviceCallNumber', 'Número do chamado'), date('failureDate', 'Data falha do equipamento'), time('failureTime', 'Horário da falha do equipamento'),
    select('clinicalEngineeringCalled', 'Engenharia Clínica foi acionada?', 'SIM_NAO_NI'),
    select('previousOccurrence', 'O Fato Ocorreu Anteriormente?', 'SIM_NAO_NI'), select('causedDamage', 'Causou Danos?', 'SIM_NAO_NI'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), long('immediateAction', 'Disposição (ação imediata)'),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F07', group: 'A', title: 'Notificação de Tecnovigilância - Materiais', fields: [
    field('attendance', 'Atendimento'), select('causingSector', 'Setor que motivou/causou o incidente', 'SETORES_9'),
    field('materialName', 'Nome do Material'), field('manufacturerName', 'Nome do Fabricante'), field('lotNumber', 'Lote'),
    select('previousOccurrence', 'O Fato Ocorreu Anteriormente?', 'SIM_NAO_NI'), select('causedDamage', 'Causou Danos?', 'SIM_NAO_NI'),
    select('symptomAfterEvent', 'Apresentou sinal/sintoma após incidente?', 'SIM_NAO_NI'), long('immediateAction', 'Disposição (ação imediata)'),
    select('eventPeriod', 'Em que período ocorreu o evento?', 'PERIODO')
  ]},
  {id: 'F08', group: 'B', title: 'Dilema Ético', classification: [select('occurrenceSector', 'Setor da Ocorrência', 'SETORES_55')], fields: []},
  {id: 'F09', group: 'C', title: 'Notificação de Incidente de Segurança da Informação', fields: [
    time('incidentTime', 'Hora'), field('incidentLocation', 'Localização (Onde está o incidente)'),
    long('incidentEffect', 'Efeito do incidente'), field('eventDiscovery', 'Como o evento foi descoberto'),
    select('securityIncidentType', 'Tipo de incidente', 'TIPO_SEGURANCA'), field('othersInformed', 'Quem mais foi informado')
  ]},
  {id: 'F10', group: 'D', title: 'Não Conformidade de Processo 2024', classification: [
    select('sourceSector', 'Setor de Origem', 'SETORES_55'), select('destinationSector', 'Setor de Destino', 'SETORES_55'),
    field('patientOrAttendance', 'Atendimento ou nome paciente, se houver', 'text', false, {maxLength: 160}),
    long('immediateAction', 'Disposição/ação imediata', false)
  ], fields: [], noGeneralInformation: true}
].map(form => Object.freeze({...form, classification: Object.freeze(form.classification || []),
  fields: Object.freeze(form.noGeneralInformation ? form.fields : [...common, ...form.fields])}));

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

export function validateOccurrenceValues(formId, values, catalogs = {}) {
  const form = getOccurrenceForm(formId);
  if (!form || !values || typeof values !== 'object' || Array.isArray(values)) return {valid: false, errors: ['FORM_INVALID']};
  const errors = [];
  const fields = [...form.classification, ...form.fields];
  for (const item of fields) {
    const value = values[item.id];
    const empty = value === undefined || value === null || String(value).trim() === '';
    if (item.required && empty) { errors.push(`REQUIRED:${item.id}`); continue; }
    if (empty) continue;
    if (typeof value !== 'string') { errors.push(`TYPE:${item.id}`); continue; }
    const normalized = value.trim();
    if (normalized.length > (item.maxLength || (item.type === 'textarea' ? 5000 : 180))) { errors.push(`LENGTH:${item.id}`); continue; }
    if (item.type === 'date' && !validDate(normalized)) errors.push(`DATE:${item.id}`);
    if (item.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) errors.push(`TIME:${item.id}`);
    if (item.type === 'select') {
      const options = catalogs[item.catalog];
      if (!Array.isArray(options) || options.length !== OCCURRENCE_CATALOG_SPECS[item.catalog]?.count) errors.push(`CATALOG_UNAVAILABLE:${item.catalog}`);
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
