import test from 'node:test';
import assert from 'node:assert/strict';
import {OCCURRENCE_CATALOG_SPECS, OCCURRENCE_FORMS, OCCURRENCE_GROUPS, OCCURRENCE_PENDING_FORM,
  getOccurrenceForm, validateOccurrenceValues} from '../src/occurrence-schema.js';

const catalogMocks = Object.fromEntries(Object.entries(OCCURRENCE_CATALOG_SPECS)
  .map(([key, spec]) => [key, Array.from({length: spec.count}, (_, index) => `Opção sintética ${index + 1}`)]));
const patientValues = {sex:'Feminino',age:'8 meses',diagnosisOrTreatment:'Tratamento sintético'};
const actionValues = {chartDisclosure:'Sim',patientFactors:'Nenhum',taskFactors:'Nenhum',individualFactors:'Nenhum',
  teamFactors:'Nenhuma',workEnvironmentFactors:'Nenhuma'};
const commonValues = {eventDate:'2026-10-12',eventClassification:'Evento sem Dano',occurrence:'Registro sintético',
  description:'Descrição sintética',...patientValues};

test('define os dez formulários e quatro grupos, sem inventar formulário oncológico', () => {
  assert.equal(OCCURRENCE_FORMS.length, 10);
  assert.deepEqual(OCCURRENCE_GROUPS.map(item => item.id), ['A','B','C','D']);
  assert.equal(OCCURRENCE_PENDING_FORM.status, 'Em preparação');
  assert.equal(OCCURRENCE_FORMS.some(item => /Oncológica/.test(item.title)), false);
  assert.equal(getOccurrenceForm('F01').title, 'Notificação de Farmacovigilância - Queixa Técnica de Medicamento');
  assert.equal(getOccurrenceForm('missing'), null);
});

test('mantém os totais dos catálogos no contrato local sem embutir seus valores clínicos', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(OCCURRENCE_CATALOG_SPECS).map(([key,value]) => [key,value.count])), {
    SETORES_9:9, SETORES_55:55, SIM_NAO_NI:3, PERIODO:3, 'TIPO_INTERNAÇÃO':2, BRADEN:5,
    TIPO_LP:4, ESTAGIO_LP:6, TOPOGRAFIA_LP:13, RISCO_QUEDA:4, LOCAL_QUEDA:6, MECANISMO_QUEDA:3,
    CONSCIENCIA:4, TIPO_SEGURANCA:12, TIPOS_INCIDENTES:145, RAM_100:100
  });
  assert.equal(JSON.stringify(OCCURRENCE_CATALOG_SPECS).includes('Piperacilina'), false);
});

test('F10 não recebe campos gerais que a especificação exclui', () => {
  const form = getOccurrenceForm('F10');
  assert.equal(form.noGeneralInformation, true);
  assert.deepEqual(form.fields.map(item=>item.id), ['eventClassification']);
  assert.deepEqual(form.classification.map(item => item.id), ['sourceSector','destinationSector','patientOrAttendance','immediateAction']);
  const values = {...actionValues,eventClassification:'Near Miss (Erro)',sourceSector:catalogMocks.SETORES_55[0],
    destinationSector:catalogMocks.SETORES_55[1]};
  assert.deepEqual(validateOccurrenceValues('F10',values,catalogMocks).errors,[
    'REQUIRED:patientOrAttendance','REQUIRED:sex','REQUIRED:age','REQUIRED:diagnosisOrTreatment','REQUIRED:immediateAction'
  ]);
  assert.equal(validateOccurrenceValues('F10',{...values,...patientValues,patientOrAttendance:'012345',immediateAction:'Ação'},catalogMocks).valid,true);
  assert.ok(OCCURRENCE_FORMS.every(item=>[...item.classification,...item.fields].every(field=>field.required)));
});

test('F02 e F03 não contêm os campos de paciente explicitamente excluídos', () => {
  const prohibited = new Set(['patient','patientName','motherName','insurance','admissionDate','diagnosis','treatment','careSector']);
  for (const id of ['F02','F03']) assert.equal(getOccurrenceForm(id).fields.some(item => prohibited.has(item.id)), false);
});

test('exige disposição e os cinco fatores clínicos na RAM e exige TI somente na Segurança da Informação', () => {
  const adverse = {...commonValues,...actionValues,attendance:'1023',eventSector:catalogMocks.SETORES_9[0],
    reactionEvent:catalogMocks.RAM_100[0],medicationRegimen:'Sintético',suspectedReactionDate:'2026-10-12',prescriptionNumber:'12'};
  assert.deepEqual(validateOccurrenceValues('F02',adverse,catalogMocks).errors,['REQUIRED:immediateAction']);
  assert.equal(validateOccurrenceValues('F02',{...adverse,immediateAction:'Ação'},catalogMocks).valid,true);
  const security = {...commonValues,attendance:'1023',incidentTime:'12:45',incidentLocation:'Setor',
    incidentEffect:'Efeito',eventDiscovery:'Descoberta',securityIncidentType:catalogMocks.TIPO_SEGURANCA[0],othersInformed:'Coordenação'};
  assert.deepEqual(validateOccurrenceValues('F09',security,catalogMocks).errors,['REQUIRED:informationTechnologyFactors']);
  assert.equal(validateOccurrenceValues('F09',{...security,informationTechnologyFactors:'Proteção de dados'},catalogMocks).valid,true);
});

test('valida obrigatoriedade, datas reais, horário e opção pertencente ao catálogo', () => {
  const required = { ...commonValues, ...actionValues, attendance:'Sintético',causingSector:'Opção sintética 1',medicationName:'Sintético',
    lotNumber:'L-1',symptomAfterEvent:'Opção sintética 2',immediateAction:'Ação sintética',eventPeriod:'Opção sintética 3'};
  assert.equal(validateOccurrenceValues('F01', required, catalogMocks).valid, true);
  assert.deepEqual(validateOccurrenceValues('F01', {...required,eventClassification:''}, catalogMocks).errors,
    ['REQUIRED:eventClassification']);
  assert.deepEqual(validateOccurrenceValues('F01', {...required,eventClassification:'Outro'}, catalogMocks).errors,
    ['OPTION:eventClassification']);
  assert.deepEqual(validateOccurrenceValues('F01', {...required,sex:'Não informado'}, catalogMocks).errors,['OPTION:sex']);
  assert.deepEqual(validateOccurrenceValues('F01', {...required,chartDisclosure:'',taskFactors:'Opção inválida'}, catalogMocks).errors,
    ['OPTION:taskFactors','REQUIRED:chartDisclosure']);
  assert.equal(validateOccurrenceValues('F01', {...required,eventDate:'2026-02-30'}, catalogMocks).valid, false);
  assert.equal(validateOccurrenceValues('F05', {...commonValues,fallTime:'25:77'}, catalogMocks).valid, false);
  assert.equal(validateOccurrenceValues('F01', {...required,causingSector:'Valor fora do catálogo'}, catalogMocks).valid, false);
  assert.equal(validateOccurrenceValues('F01', {...required,medicationName:'   '}, catalogMocks).valid, false);
});

test('recusa listas incompletas e campos de tipo incorreto', () => {
  const values = {...commonValues,...actionValues,attendance:'Sintético',causingSector:'A',medicationName:'Sintético',lotNumber:'L-1',
    symptomAfterEvent:'S',immediateAction:'Ação',eventPeriod:'P'};
  const shortCatalogs = {...catalogMocks,SETORES_9:['A']};
  assert.equal(validateOccurrenceValues('F01', values, shortCatalogs).valid, false);
  assert.equal(validateOccurrenceValues('F01', {...values,attendance:12}, catalogMocks).valid, false);
});
