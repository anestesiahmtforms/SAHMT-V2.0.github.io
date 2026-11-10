import {MANAGEMENT_AREA_SEED} from './management-seed.js';
import {folderReadable} from '../server/folder-read-policy.js';

export const operationalFolders = Object.freeze({
 'comunicacao':'Central de Comunicação',
 'indicadores':'Indicadores SAHMT',
 'registros':'Registros',
 'registros/ocorrencias':'Ocorrências',
 'registros/qmentum':'Registro de Indicadores QMENTUM',
 'consultas':'Enquetes e Consultas',
 'consultas/pesquisas':'Pesquisas institucionais',
 'consultas/pesquisas/clima':'Pesquisa de clima',
 'consultas/pesquisas/estresse':'Pesquisa de estresse e fadiga',
 'consultas/epidemiologico':'Cadastro epidemiológico',
 'consultas/cadastro-profissional':'Cadastro profissional',
 'consultas/escala-final-de-ano':'Escala Final de Ano',
 'consultas/ferias-2027':'Escala de Férias 2027',
 'gestao':'Grupos de Gestão',
 ...Object.fromEntries(MANAGEMENT_AREA_SEED.map(area=>['gestao/'+area.id,area.name])),
 'gestao/area-gestao-de-pessoas/documentacao':'Documentação da equipe',
 'gestao/area-gestao-de-pessoas/documentacao/cadastral':'Documentação cadastral',
 'gestao/area-gestao-de-pessoas/documentacao/certificados':'Certificados e cursos',
 'gestao/area-gestao-de-pessoas/documentacao/profissional':'Documentação profissional',
 'gestao/area-gestao-de-pessoas/biosseguranca':'Biossegurança',
 'gestao/area-gestao-de-pessoas/biosseguranca/manual':'Manual de Biossegurança',
 'gestao/area-gestao-de-pessoas/biosseguranca/vacinacao':'Histórico vacinal',
 'gestao/area-gestao-de-pessoas/biosseguranca/dosimetria':'Histórico de dosimetria',
 'desempenho':'Desempenho',
 'desempenho/fa':'Desempenho FA',
 'desempenho/fb':'Desempenho FB',
 'desempenho/fc':'Desempenho FC',
 'desempenho/fd':'Desempenho FD',
 'desempenho/fe':'Desempenho FE',
 'desempenho/sahmt':'Desempenho SAHMT',
 'operacao':'Operação',
 'operacao/checklist':'Checklist',
 'operacao/checklist/desempenho':'Desempenho do Checklist',
 'operacao/etiquetas':'Etiquetas',
 'operacao/eventos':'Eventos',
 'operacao/pessoas':'Pessoas',
 'operacao/escala':'Escala diária',
 'operacao/escala/ferias':'Férias da escala diária'
});

export const consolidatedPerformanceFolders = Object.freeze([
 'desempenho/sahmt',
 'desempenho/fb',
 'desempenho/fc',
 'registros/ocorrencias',
 'registros/qmentum',
 'desempenho/fe',
 'operacao/checklist/desempenho',
 'operacao/eventos'
]);

const routes = Object.freeze({
 communications:'comunicacao',
 occurrences:'registros/ocorrencias',
 qmentum:'registros/qmentum',
 'year-end-schedule':'consultas/escala-final-de-ano',
 'fb-performance':'desempenho/fb',
 'fc-performance':'desempenho/fc',
 'fd-performance':'desempenho/fd',
 'fe-performance':'desempenho/fe',
 checklist:'operacao/checklist',
 'fg-performance':'operacao/checklist/desempenho',
 labels:'operacao/etiquetas',
 events:'operacao/eventos',
 people:'operacao/pessoas',
 schedule:'operacao/escala'
});

export const initialOperationalFolderPolicy=Object.freeze({schemaVersion:1,revision:0,disabled:Object.freeze([])});
export const operationalFolderAllowed=(policy,id)=>
 policy===initialOperationalFolderPolicy || folderReadable(policy,id);
export const operationalRouteFolder=route=>Object.hasOwn(routes,route)?routes[route]:null;
