export const MANAGEMENT_AREA_SEED = Object.freeze([
  'Gestão de Documentos',
  'Coordenação Administrativa',
  'Gestão Operacional',
  'Coordenação Clínica',
  'Gestão da Qualidade',
  'Gestão das Áreas Assistenciais Extra Bloco',
  'Gestão de Conduta Ética',
  'Gestão de Equipamentos',
  'Gestão de Pessoas',
  'Gestão de Prontuário',
  'Gestão do Ambulatório Pré-Anestésico',
  'Gestão Financeira'
].map((name, index) => Object.freeze({
  id: `area-${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  name,
  order: index + 1
})));
