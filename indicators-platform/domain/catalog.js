import {MANAGEMENT_AREA_SEED} from '../../src/management-seed.js';
import {QMENTUM_INDICATORS} from '../../src/qmentum-catalog.js';
export const PLATFORMS=Object.freeze([
 {id:'management',title:'Grupos de gestão',description:'Execução, prazos, manutenção, formação e cadastro institucional.'},
 {id:'records',title:'Registros e qualidade assistencial',description:'Indicadores assistenciais validados e evolução das notificações.'},
 {id:'surveys',title:'Pesquisas e bem-estar',description:'Resultados agregados por ciclo, com proteção de grupos pequenos.'},
 {id:'operations',title:'Operação assistencial',description:'Atividade operacional agregada, sem identificação de profissionais ou pacientes.'}
]);
const metric=(id,platform,title,description,unit,direction,formula,source,cadence='MONTHLY',extra={})=>({id,platform,title,description,unit,direction,target:null,targetStatus:'PENDING_APPROVAL',formula,source,cadence,...extra});
export const METRICS=Object.freeze([
 metric('management-activity-on-time','management','Atividades concluídas no prazo','Coorte de atividades com vencimento no mês.','%','higher','Atividades concluídas até a data de vencimento / atividades não canceladas com vencimento no mês × 100.','FB.activities'),
 metric('management-plan-on-time','management','Planos concluídos no prazo','Coorte de planos com vencimento no mês.','%','higher','Planos concluídos até o vencimento / planos com vencimento no mês × 100.','FB.actionPlans'),
 metric('management-action-on-time','management','Ações concluídas no prazo','Acompanhamento das ações vinculadas aos planos de gestão.','%','higher','Itens concluídos até o vencimento / itens com vencimento no mês × 100.','FB.actionPlanItems'),
 metric('management-maintenance-on-time','management','Manutenções realizadas no prazo','Cumprimento das datas previstas de manutenção.','%','higher','Manutenções concluídas até o vencimento / manutenções com vencimento no mês × 100.','FB.maintenanceRecords'),
 metric('management-measurement-target','management','Medições de gestão na meta','Considera uma medição vigente por indicador e competência mensal.','%','higher','Medições com meta atingida / medições mensais válidas × 100. Não é média dos valores de indicadores diferentes.','FB.indicatorMeasurements'),
 metric('management-training-completion','management','Conclusão de treinamentos iniciados','Conclusão até o fim do mês dos progressos iniciados no mesmo mês; não equivale à cobertura da equipe.','%','higher','Progressos iniciados no mês e concluídos até seu encerramento / progressos iniciados no mês × 100.','FB.trainingProgress'),
 metric('management-registration','management','Cadastros profissionais recebidos','Volume de primeiros cadastros identificados, publicado somente de forma agregada. Atualizações não contam como novo cadastro.','registros','context','Contagem de cadastros pela data de criação, sem exposição de identidade.','FB.professionalRegistrations'),
 metric('management-vaccination','management','Vacinação declarada atualizada','Retrato anual das quatro situações vacinais autodeclaradas; não comprova imunização nem reconstrói meses passados.','%','higher','Declarações de vacina atualizada / situações vacinais válidas informadas nos registros do ano × 100.','FB.occupationalVaccinations','CYCLE'),
 ...MANAGEMENT_AREA_SEED.flatMap(area=>[
  metric('management-area-'+area.order+'-activities','management',area.name+' · atividades no prazo','Coorte exclusiva das atividades com vencimento no mês nesta área de gestão.','%','higher','Atividades da área concluídas até o vencimento / atividades não canceladas da área com vencimento no mês × 100.','FB.activities','MONTHLY',{managementAreaId:area.id,managementAreaTitle:area.name}),
  metric('management-area-'+area.order+'-plans','management',area.name+' · planos no prazo','Coorte exclusiva dos planos com vencimento no mês nesta área de gestão.','%','higher','Planos da área concluídos até o vencimento / planos da área com vencimento no mês × 100.','FB.actionPlans','MONTHLY',{managementAreaId:area.id,managementAreaTitle:area.name})
 ]),
 metric('records-notifications','records','Registros de ocorrências recebidos','Volume por mês de recebimento; aumento pode refletir maior cultura de notificação e não prova piora da assistência.','registros','context','Contagem de notificações recebidas no mês. Não se calcula incidência sem população exposta.','FC.occurrenceReports'),
 ...QMENTUM_INDICATORS.map(d=>metric('records-'+d.id.toLowerCase(),'records',d.name,'Reproduz somente contagens e definições aprovadas do processo de origem. Taxas apenas informadas e definições provisórias não entram na série validada.','%',d.direction,`${d.rule==='complement'?'1 − ':''}${d.numeratorLabel} / população elegível definida na origem × 100.`,'FC.qmentumMonths','MONTHLY',{originIndicator:d.id})),
 ...['team','resident'].flatMap((group)=>[
  metric('surveys-climate-'+group,'surveys','Clima organizacional · '+(group==='team'?'Equipe':'Residentes'),'Favorabilidade das perguntas comuns no snapshot aprovado do ciclo.','%','higher','Respostas favoráveis / respostas numéricas válidas às perguntas comuns × 100.','FE.climateReports','CYCLE',{group}),
  metric('surveys-stress-'+group,'surveys','Estresse e fadiga · '+(group==='team'?'Equipe':'Residentes'),'Média do instrumento institucional; não é diagnóstico clínico.','pontos','lower','Soma dos escores válidos / participantes do grupo. Faixa do instrumento: 0–150.','FE.stressReports','CYCLE',{group}),
  metric('surveys-wellbeing-'+group,'surveys','Interesse em programa de bem-estar · '+(group==='team'?'Equipe':'Residentes'),'Somente a distribuição de interesse no programa, quando liberada no agregado epidemiológico.','%','context','Respostas de interesse / respostas válidas à pergunta sobre programa × 100.','FE.epidemiologicalReports','CYCLE',{group})
 ]),
 metric('operations-checklist-conformity','operations','Conformidade das verificações registradas','Considera a última resposta válida de cada estação por dia. Não representa cobertura de todas as estações previstas.','%','higher','Respostas conformes / respostas válidas do checklist no mês × 100.','FA.checklists'),
 metric('operations-checklist-volume','operations','Verificações registradas','Última resposta válida de cada estação por dia; sem nomes de estações ou profissionais no painel.','registros','context','Contagem de respostas válidas únicas por estação e dia.','FA.checklists'),
 metric('operations-label-volume','operations','Etiquetas registradas','Volume de registros ativos recebidos por competência; sem medicamentos, pacientes ou profissionais.','registros','context','Contagem de etiquetas ativas no mês de referência.','FA.labels'),
 metric('operations-event-volume','operations','Atividades operacionais registradas','Volume de eventos ativos, sem nomes, escalas individuais, siglas ou detalhes livres.','registros','context','Contagem de eventos ativos no mês de referência.','FA.events')
].map(Object.freeze));
export const PLATFORM_METHODS=Object.freeze([
 'Mês sem observação ou com fonte indisponível fica sem valor; não se transforma ausência em zero.',
 'Meses em curso são parciais. Propostas trimestrais exigem os três meses completos, consecutivos e válidos do trimestre civil.',
 'Percentuais trimestrais usam a soma dos numeradores e denominadores compatíveis; não se usa média simples dos percentuais mensais.',
 'Metas são pendentes de aprovação institucional, salvo a validação explícita da definição de origem. A análise automática não afirma causas.',
 'As propostas são sugestões de gestão e dependem de revisão e aprovação humana antes da execução.',
 'Resultados de pesquisas são por ciclo. A fonte não registra data nas respostas anônimas; não é possível reconstruir distribuição mensal dessas respostas.',
 'Não se mostram nomes, siglas profissionais, identificadores de contas, pacientes ou comentários livres. Amostras pequenas e complementos pequenos são suprimidos.',
 'Os indicadores representam registros disponíveis e sua qualidade documental. Não equivalem, isoladamente, a resultados clínicos nem certificação.'
]);
