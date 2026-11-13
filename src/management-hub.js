import {operationalContentAllowed} from './operational-folder-runtime.js';
import {bindSurveySession} from './survey-session-bridge.js';
import './management-hub.css';

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
const icon=kind=>'<svg class="management-hub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[kind]+'"></path></svg>';
const panels={
 home:{title:'Governança',icon:'groups',items:[
  {label:'FUNCIONAL',icon:'professional',route:'functional',access:'functional'},
  {label:'Grupos de Gestão',icon:'groups',route:'management',access:'groups'},
  {label:'Registros',icon:'records',panel:'records',access:'records'},
  {label:'INDICADORES - SAHMT',icon:'results',panel:'results',access:'results'},
  {label:'Enquetes e Consultas',icon:'surveys',panel:'surveys',access:'surveys'},
  {label:'CENTRAL DE COMUNICAÇÃO',icon:'surveys',panel:'communication',access:'communication'},
  {label:'CENTRAL ADMINISTRATIVA E IA',icon:'groups',route:'fi-control',access:'fiControl'}
 ]},
 communication:{title:'CENTRAL DE COMUNICAÇÃO',icon:'surveys',parent:'home'},
 records:{title:'Registros',icon:'records',parent:'home',items:[
  {label:'Registros de Ocorrências',icon:'occurrence',route:'occurrences',access:'occurrences'},
  {label:'Registro de Indicadores',icon:'indicators',route:'qmentum',access:'qmentum'}
 ]},
 results:{title:'INDICADORES - SAHMT',icon:'results',parent:'home',message:'Os indicadores consolidados do SAHMT serão exibidos nesta área.'},
 surveys:{title:'Enquetes e Consultas',icon:'surveys',parent:'home',items:[
  {label:'PESQUISAS INSTITUCIONAIS',icon:'records',panel:'institutional',access:'surveys'},
  {label:'CADASTRO PROFISSIONAL - SAHMT',icon:'professional',panel:'professional',access:'surveys'},
  {label:'CADASTRO EPIDEMIOLÓGICO - SAHMT',icon:'epidemiological',panel:'epidemiological',access:'surveys'},
  {label:'ESCALA FINAL DE ANO',icon:'festive',panel:'yearEnd',access:'yearEndSchedule',className:'management-hub-button--festive'},
  {label:'ESCALA DE FÉRIAS 2027',icon:'calendar',panel:'vacations2027',access:'vacations2027'}
 ]},
 yearEnd:{title:'Escala Final de Ano',icon:'festive',parent:'surveys'},
 vacations2027:{title:'Escala de Férias 2027',icon:'calendar',parent:'surveys'},
 professional:{title:'Cadastro Profissional - SAHMT',icon:'professional',parent:'surveys'},
 epidemiological:{title:'Cadastro Epidemiológico - SAHMT',icon:'epidemiological',parent:'surveys'},
 institutional:{title:'Pesquisas institucionais',icon:'records',parent:'surveys'},
 climateForm:{title:'Pesquisa de clima organizacional',icon:'climate',parent:'institutional'},
 stressForm:{title:'Estresse e fadiga',icon:'wellbeing',parent:'institutional'}
};

// Surveys reuse the authenticated app session; only broad affiliation goes to FE.
export function mountManagementHub(root,{access={},initialPanel='home',communicationAllowed=false,openCommunication=null,fbPerformanceReleased=false,assetBase='./',displayName='',climateEnabled=false,onYearEndConfirmed=()=>{},connectYearEndAccess=null,performVacations=async()=>{throw Error('VACATIONS_UNAVAILABLE');},createYearEndRepository=async()=>{throw Error('YEAR_END_AUTH_REQUIRED');},performRegistration=async()=>{throw Error('REGISTRY_UNAVAILABLE');},performSurvey=async()=>{throw Error('REGISTRY_UNAVAILABLE');},isSurveySessionCurrent=()=>false,syncStatusElement=null,onNavigate,onExit,onPanelChange=()=>{},folderAllowed=()=>true,folderNotice=()=>''}={}){
 const communicationVisible=communicationAllowed===true;
 communicationAllowed=communicationAllowed===true&&operationalContentAllowed('comunicacao');
 access={...access,communication:communicationAllowed};
 if(initialPanel==='indicators')initialPanel='records';
 const institutionalAllowed=()=>access.surveys===true&&access.institutionalSurveys!==false;
 const restrictedSurveyPanels=['institutional','climateForm','stressForm','professional','epidemiological'];
 const itemAllowed=item=>restrictedSurveyPanels.includes(item.panel)?institutionalAllowed():item.panel==='surveys'?(access.surveys===true||access.yearEndSchedule===true||access.vacations2027===true):(!item.access||access[item.access]===true);
 const panelFolders={functional:'funcional',records:'registros',occurrences:'registros/ocorrencias',qmentum:'registros/qmentum',surveys:'consultas',institutional:'consultas/pesquisas',climateForm:'consultas/pesquisas/clima',stressForm:'consultas/pesquisas/estresse',professional:'consultas/cadastro-profissional',epidemiological:'consultas/epidemiologico',yearEnd:'consultas/escala-final-de-ano',vacations2027:'consultas/ferias-2027'};
 const panelFolderAllowed=name=>!Object.hasOwn(panelFolders,name)||folderAllowed(panelFolders[name]);
 const panelAllowed=name=>panelFolderAllowed(name)&&profilePanelAllowed(name);
 const profilePanelAllowed=name=>restrictedSurveyPanels.includes(name)?institutionalAllowed():name==='home'||name==='surveys'&&(access.surveys===true||access.yearEndSchedule===true||access.vacations2027===true)||access[name==='yearEnd'?'yearEndSchedule':['institutional','climateForm','stressForm','professional','epidemiological'].includes(name)?'surveys':name]===true;
 let cleanupYearEnd=()=>{},cleanupSurvey=()=>{},cleanupRegistration=()=>{},cleanupIndicators=()=>{},renderId=0,disposed=false,panel=Object.hasOwn(panels,initialPanel)&&panelAllowed(initialPanel)?initialPanel:'home';
 root.innerHTML='<dialog class="management-hub-dialog" aria-labelledby="management-hub-title"><header class="management-hub-header"><div data-hub-heading-icon></div><div class="management-hub-user-row identity-card__user-row"><div class="management-hub-user" data-hub-user></div><div data-hub-sync></div></div><h2 id="management-hub-title" tabindex="-1"></h2><div data-hub-folder-notice></div></header><div class="management-hub-content-panel"><section class="management-hub-body" data-hub-body></section><footer class="management-hub-footer"><button class="secondary-button" type="button" data-hub-back></button></footer></div></dialog>';
 const dialog=root.querySelector('dialog'),body=dialog.querySelector('[data-hub-body]'),back=dialog.querySelector('[data-hub-back]');
 dialog.querySelector('[data-hub-user]').textContent=displayName;
 if(syncStatusElement)dialog.querySelector('[data-hub-sync]').append(syncStatusElement);
 const render=()=>{
  cleanupYearEnd();cleanupYearEnd=()=>{};cleanupSurvey();cleanupSurvey=()=>{};cleanupRegistration();cleanupRegistration=()=>{};cleanupIndicators();cleanupIndicators=()=>{};const ticket=++renderId;
  const spec=panels[panel];dialog.dataset.panel=panel;
  dialog.querySelector('[data-hub-user]').textContent=['climateForm','stressForm','epidemiological'].includes(panel)?'Participação por grupo':displayName;
  dialog.querySelector('#management-hub-title').textContent=spec.title;
  dialog.querySelector('[data-hub-folder-notice]').innerHTML=folderNotice(panelFolders[panel]);
  dialog.querySelector('[data-hub-heading-icon]').innerHTML=panel==='home'?'<img class="management-hub-diamond" src="'+assetBase+'assets/selo-qga-accredited-qmentum-diamond.png" alt="Diamond Qmentum" width="88" height="88" decoding="async">':icon(spec.icon);
  body.innerHTML=spec.items?'<div class="management-hub-grid">'+spec.items.map((item,index)=>{
   if(item.access==='functional'&&access.functional!==true)return '';
   if(item.access==='communication'&&!communicationVisible)return '';
   if(item.access==='fiControl'&&access.fiControl!==true)return '';
   if(panel==='surveys'&&access.institutionalSurveys===false&&restrictedSurveyPanels.includes(item.panel))return '';
   if(['performance','faPerformance','fcPerformance'].includes(item.access)&&access[item.access]!==true)return '';
   const allowed=itemAllowed(item)&&panelFolderAllowed(item.panel||item.route);
   return '<button type="button" class="management-hub-button '+(item.className||'')+'" data-hub-item="'+index+'"'+(item.access==='communication'?' data-comm-hub':'')+(allowed?'':' disabled aria-disabled="true" title="Acesso não liberado para este perfil"')+'><span class="management-hub-medallion">'+icon(item.icon)+'</span><span class="management-hub-label">'+(item.route==='training'&&fbPerformanceReleased?'Desempenho FB':item.label)+'</span><span class="management-hub-arrow" aria-hidden="true">›</span></button>';
  }).join('')+'</div>':'<div class="management-hub-empty">'+icon(spec.icon)+'<p>'+spec.message+'</p></div>';
  if(panel==='communication'&&communicationAllowed&&openCommunication){
   body.innerHTML='<div data-comm-host></div>';
   const host=body.querySelector('[data-comm-host]'),current=()=>!disposed&&ticket===renderId&&panel==='communication'&&isSurveySessionCurrent();
   void openCommunication(host,current).then(cleanup=>{if(current())cleanupIndicators=cleanup;else cleanup?.();}).catch(()=>{if(current())host.textContent='Não foi possível abrir a Central.';});
  }
  if(panel==='vacations2027'&&access.vacations2027===true){
   body.innerHTML='<p role="status">Carregando escala de férias…</p>';
   const current=()=>!disposed&&ticket===renderId&&panel==='vacations2027'&&isSurveySessionCurrent();
   void import('./vacations-2027-ui.js').then(({mountVacations2027})=>{if(current())cleanupRegistration=mountVacations2027(body,{request:performVacations,isCurrent:current});}).catch(()=>{if(current())body.innerHTML='<p role="alert">Não foi possível abrir a escala. Volte e tente novamente.</p>';});
  }
  if(panel==='yearEnd'&&access.yearEndSchedule===true){
   body.innerHTML='<p role="status">Preparando a escala…</p>';
   const current=()=>!disposed&&ticket===renderId&&panel==='yearEnd'&&isSurveySessionCurrent();
   void import('./year-end-schedule-ui.js').then(({mountYearEndSchedule})=>{if(!current())return;cleanupYearEnd=mountYearEndSchedule(body,{isCurrent:current,onConfirmed:onYearEndConfirmed,connectAccess:connectYearEndAccess,createRepository:current=>createYearEndRepository(current)});}).catch(()=>{if(current())body.innerHTML='<p role="alert">Não foi possível abrir a escala. Volte e tente novamente.</p>';});
  }
  if(panel==='institutional'&&institutionalAllowed()){
   const surveyCard=(kind,url,title,subtitle)=>'<button type="button" class="management-hub-button management-survey-card" data-survey-panel="'+(kind==='climate'?'climateForm':'stressForm')+'"'+(panelFolderAllowed(kind==='climate'?'climateForm':'stressForm')?'':' disabled aria-disabled="true"')+'><span class="management-hub-medallion">'+icon(kind)+'</span><span class="management-hub-label"><strong class="management-survey-title">'+title+'</strong><span class="management-survey-subtitle">'+subtitle+'</span></span><span class="management-hub-arrow" aria-hidden="true">›</span></button>';
   body.innerHTML='<div class="management-surveys"><div class="management-surveys-intro"><h3>Pesquisas institucionais</h3><p>Participação voluntária. Escolha uma pesquisa para continuar.</p></div>'+(climateEnabled?'<div class="management-survey-links">'+surveyCard('climate','https://outros-48120.web.app/','PESQUISA DE CLIMA ORGANIZACIONAL','Ambiente, comunicação e colaboração')+surveyCard('wellbeing','https://outros-48120.web.app/stress.html','AVALIAÇÃO DE ESTRESSE E FADIGA','Saúde, recuperação e bem-estar')+'</div>':'<p class="management-surveys-pending">Aguardando liberação das pesquisas.</p>')+'</div>';
  }
  if(['climateForm','stressForm'].includes(panel)&&climateEnabled&&institutionalAllowed()){
   body.innerHTML='<iframe class="management-survey-frame" title="'+spec.title+'" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>';
   const frame=body.querySelector('iframe');
   const survey=panel==='climateForm'?'climate':'stress';
   const formPanel=panel;
   cleanupSurvey=bindSurveySession(frame,{perform:async(action,response)=>{const result=await performSurvey(survey,action,response);if(!disposed&&panel===formPanel&&action==='BOOTSTRAP'){const label={team:'Equipe',resident:'Residentes'}[result?.group];if(label)dialog.querySelector('[data-hub-user]').textContent='Grupo: '+label;}return result;},isCurrent:()=>!disposed&&isSurveySessionCurrent()});
   frame.src=panel==='climateForm'?'https://outros-48120.web.app/':'https://outros-48120.web.app/stress.html';
  }
  if(['professional','epidemiological'].includes(panel)&&institutionalAllowed()){
   body.innerHTML='<p role="status">Preparando cadastro…</p>';const activePanel=panel;
   void import('./registration-ui.js').then(({mountInstitutionalRegistration})=>{if(disposed||ticket!==renderId||panel!==activePanel)return;cleanupRegistration=mountInstitutionalRegistration(body,{kind:activePanel,request:performRegistration,isCurrent:()=>!disposed&&ticket===renderId&&panel===activePanel&&isSurveySessionCurrent(),onGroup:group=>{dialog.querySelector('[data-hub-user]').textContent='Grupo: '+({team:'Equipe',resident:'Residentes'}[group]||'');}});}).catch(()=>{if(!disposed&&ticket===renderId)body.innerHTML='<p role="alert">Não foi possível preparar o cadastro. Volte e tente novamente.</p>';});
  }
  back.textContent=spec.parent?'VOLTAR':'HOME';body.scrollTop=0;onPanelChange(panel);
  dialog.querySelector('#management-hub-title').focus({preventScroll:true});
 };
 const goBack=()=>{const parent=panels[panel].parent;if(parent){panel=parent;render();}else onExit();};
 const click=event=>{
  const survey=event.target.closest('[data-survey-panel]');
  if(survey){if(panel==='institutional'&&climateEnabled&&access.surveys===true&&['climateForm','stressForm'].includes(survey.dataset.surveyPanel)&&panelFolderAllowed(survey.dataset.surveyPanel)){panel=survey.dataset.surveyPanel;render();}return;}
  const button=event.target.closest('[data-hub-item]');if(!button||button.disabled)return;
  const item=panels[panel].items?.[Number(button.dataset.hubItem)];
  if(!item||!itemAllowed(item)||!panelFolderAllowed(item.panel||item.route))return;
  if(item.panel){panel=item.panel;render();}else if(item.route)onNavigate(item.route);
 };
 const cancel=event=>{event.preventDefault();goBack();};
 const close=()=>{if(!disposed)onExit();};
 body.addEventListener('click',click);back.addEventListener('click',goBack);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',close);
 render();if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
 return ()=>{disposed=true;renderId++;cleanupYearEnd();cleanupRegistration();cleanupIndicators();cleanupSurvey();body.removeEventListener('click',click);back.removeEventListener('click',goBack);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',close);if(dialog.open&&typeof dialog.close==='function')dialog.close();root.replaceChildren();};
}
