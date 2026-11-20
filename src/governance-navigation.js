const paths={
 groups:'M3 7h18v14H3zM7 7V3h10v4M7 12h10M7 16h7',
 performance:'m3 17 6-6 4 3 8-10M15 4h6v6M3 21h18',
 records:'M5 3h14v18H5zM9 7h6M9 11h6M9 15h6',
 occurrence:'M12 3 2 21h20L12 3ZM12 9v5M12 17v1',
 indicators:'M4 21V11h4v10M10 21V3h4v18M16 21V7h4v14',
 results:'M3 3v18h18M7 15l4-5 4 3 6-8',
 surveys:'M3 3h18v14H9l-6 4V3ZM7 7h10M7 11h6',
 professional:'M4 3h16v18H4zM8 7h8M8 11h8M8 15h5',
 epidemiological:'M12 3v18M3 12h18M6 6l12 12M18 6 6 18',
 climate:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',
 wellbeing:'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78M3 12h4l2-4 4 8 2-4h6',
 festive:'m7 4-4 6h2l-3 5h3l-3 4h10l-3-4h3l-3-5h2L7 4ZM7 19v3M17 2v3M17 11v3M11 8h3M20 8h3M13 4l2 2M19 10l2 2M13 12l2-2M19 6l2-2',
 calendar:'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 18h2'
};
export const governanceIcon=kind=>'<svg class="management-hub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[kind]+'"></path></svg>';
export const governancePanels={
 home:{title:'Governança',icon:'groups',items:[
  {label:'Enquetes e Consultas',icon:'surveys',panel:'surveys',access:'surveys'},
  {label:'Registros',icon:'records',panel:'records',access:'records'},
  {label:'FUNCIONAL',icon:'professional',route:'functional',access:'functional'},
  {label:'INDICADORES - SAHMT',icon:'results',panel:'results',access:'results'},
  {label:'Grupos de Gestão',icon:'groups',route:'management',access:'groups',className:'management-hub-button--wide'},
  {label:'CENTRAL DE COMUNICAÇÃO',icon:'surveys',panel:'communication',access:'communication',className:'management-hub-button--wide'},
  {label:'CENTRAL ADMINISTRATIVA E IA',icon:'groups',route:'fi-control',access:'fiControl',className:'management-hub-button--wide'}
 ]},
 communication:{title:'CENTRAL DE COMUNICAÇÃO',icon:'surveys',parent:'home'},
 records:{title:'Registros',icon:'records',parent:'home',items:[
  {label:'Registros de Ocorrências',icon:'occurrence',route:'occurrences',access:'occurrences'},
  {label:'Registro de Indicadores',icon:'indicators',route:'qmentum',access:'qmentum'}
 ]},
 results:{title:'INDICADORES - SAHMT',icon:'results',parent:'home',message:'Os indicadores consolidados do SAHMT serão exibidos nesta área.'},
 surveys:{title:'Enquetes e Consultas',icon:'surveys',parent:'home',items:[
  {label:'ACESSO RESTRITO',icon:'records',panel:'institutional'},
  {label:'ACESSO GERAL',icon:'climate',panel:'general',access:'institutionalSurveys'}
 ]},
 institutional:{title:'Acesso Restrito',icon:'records',parent:'surveys',items:[
  {label:'MEU HISTÓRICO VACINAL',icon:'professional',panel:'vaccinationHistory',access:'biosafety'},
  {label:'PESQUISA DE CLIMA ORGANIZACIONAL',icon:'climate',panel:'climateForm',access:'teamSurveys'},
  {label:'AVALIAÇÃO DE ESTRESSE E FADIGA',icon:'wellbeing',panel:'stressForm',access:'teamSurveys'},
  {label:'CADASTRO PROFISSIONAL - SAHMT',icon:'professional',panel:'professional',access:'professional'},
  {label:'CADASTRO EPIDEMIOLÓGICO - SAHMT',icon:'epidemiological',panel:'epidemiological',access:'epidemiological'},
  {label:'ESCALA FINAL DE ANO',icon:'festive',panel:'yearEnd',access:'yearEndSchedule',className:'management-hub-button--festive'},
  {label:'ESCALA DE FÉRIAS 2027',icon:'calendar',panel:'vacations2027',access:'vacations2027'}
 ]},
 vaccinationHistory:{title:'Meu histórico vacinal',icon:'professional',parent:'institutional'},
 yearEnd:{title:'Escala Final de Ano',icon:'festive',parent:'institutional'},
 vacations2027:{title:'Escala de Férias 2027',icon:'calendar',parent:'institutional'},
 professional:{title:'Cadastro Profissional - SAHMT',icon:'professional',parent:'institutional'},
 epidemiological:{title:'Cadastro Epidemiológico - SAHMT',icon:'epidemiological',parent:'institutional'},
 general:{title:'Acesso Geral',icon:'climate',parent:'surveys'},
 fePerformance:{title:'Desempenho FE',icon:'performance',parent:'general'},
 climateForm:{title:'Pesquisa de clima organizacional',icon:'climate',parent:'institutional'},
 stressForm:{title:'Estresse e fadiga',icon:'wellbeing',parent:'institutional'}
};

export const governanceGeneralPerformance={label:'DESEMPENHO FE',panel:'fePerformance',icon:'performance'};

export const governancePanelFolders={biosafety:'consultas/biosseguranca',vaccinationHistory:'consultas/biosseguranca/vacinacao',functional:'funcional',management:'gestao',communication:'comunicacao','fi-control':'fi-control',results:'indicadores',records:'registros',occurrences:'registros/ocorrencias',qmentum:'registros/qmentum',surveys:'consultas',institutional:'consultas',general:'consultas/pesquisas',fePerformance:'desempenho/fe',climateForm:'consultas/pesquisas/clima',stressForm:'consultas/pesquisas/estresse',professional:'consultas/cadastro-profissional',epidemiological:'consultas/epidemiologico',yearEnd:'consultas/escala-final-de-ano',vacations2027:'consultas/ferias-2027'};
