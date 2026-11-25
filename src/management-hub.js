import {bindSurveySession} from './survey-session-bridge.js';
import {renderOperationalFolderDirectory} from './operational-folder-directory.js';
import {governanceIcon as icon,governancePanels as panels,governancePanelFolders as panelFolders,governanceGeneralPerformance as generalPerformance} from './governance-navigation.js';
import './management-hub.css';
import './fe-performance.css';

// Surveys reuse the authenticated app session; only broad affiliation goes to FE.
export function mountManagementHub(root,{access={},initialPanel='home',communicationAllowed=false,openCommunication=null,surveySelection=null,fbPerformanceReleased=false,performanceUid,assetBase='./',displayName='',climateEnabled=false,onYearEndConfirmed=()=>{},connectYearEndAccess=null,performVacations=async()=>{throw Error('VACATIONS_UNAVAILABLE');},createYearEndRepository=async()=>{throw Error('YEAR_END_AUTH_REQUIRED');},openOccupationalHistory=null,performRegistration=async()=>{throw Error('REGISTRY_UNAVAILABLE');},performSurvey=async()=>{throw Error('REGISTRY_UNAVAILABLE');},isSurveySessionCurrent=()=>false,syncStatusElement=null,onNavigate,onExit,onPanelChange=()=>{},folderAllowed=()=>true,folderState=id=>id?(folderAllowed(id)?'active':'inactive'):null,activityAvailability=()=>null,setActivityAvailability=null}={}){
 access={...access,professional:access.professional??access.surveys,communication:communicationAllowed,teamSurveys:climateEnabled&&access.teamSurveys===true};
 if(['biosafety','dosimetryHistory'].includes(initialPanel))initialPanel='institutional';
 if(initialPanel==='indicators')initialPanel='records';
 const institutionalAllowed=()=>access.institutionalSurveys===true;
 const teamSurveyPanels=['climateForm','stressForm'];
 const restrictedPanels=new Set(['institutional','professional','epidemiological','climateForm','stressForm','yearEnd','vacations2027','vaccinationHistory','fePerformance']);
 const surveyForPanel=name=>surveySelection?.surveyForPanel(name);
 const restrictedAllowed=()=>Boolean(surveySelection)||panels.institutional.items.some(item=>access[item.access]===true);
 const consultationsAllowed=()=>institutionalAllowed()||restrictedAllowed();
 const itemAllowed=item=>item.panel==='surveys'?consultationsAllowed():item.panel==='institutional'?restrictedAllowed():Boolean(surveyForPanel(item.panel))||!item.access||access[item.access]===true;
 const biosafetyPanels=['vaccinationHistory'];
 const panelFolderAllowed=name=>(name!=='fePerformance'||folderAllowed('consultas/pesquisas'))&&
  (!biosafetyPanels.includes(name)||folderAllowed('consultas'))&&(!Object.hasOwn(panelFolders,name)||folderAllowed(panelFolders[name]));
 const panelFolderState=name=>{
  const state=folderState(panelFolders[name]);
  if(name!=='fePerformance')return state;
  const surveysState=folderState('consultas/pesquisas');
  if(state==='inactive'||surveysState==='inactive')return 'inactive';
  return state==='active'&&surveysState==='active'?'active':null;
 };
 const navigationOnly=['surveys','institutional','general','records','biosafety'];
 const panelAllowed=name=>profilePanelAllowed(name)||Boolean(surveyForPanel(name))||(access.inactiveFolderNavigation===true&&!restrictedPanels.has(name)&&Object.hasOwn(panelFolders,name)&&!folderAllowed(panelFolders[name]));
 const itemNavigable=item=>item.access==='groups'?access.groups===true:itemAllowed(item)||(access.inactiveFolderNavigation===true&&!restrictedPanels.has(item.panel||item.route)&&Object.hasOwn(panelFolders,item.panel||item.route)&&!panelFolderAllowed(item.panel||item.route));
 const profilePanelAllowed=name=>biosafetyPanels.includes(name)?access.biosafety===true:teamSurveyPanels.includes(name)?access.teamSurveys:name==='general'?institutionalAllowed():name==='institutional'?restrictedAllowed():name==='home'||(name==='surveys'?consultationsAllowed():access[name==='yearEnd'?'yearEndSchedule':name]===true);
 let cleanupYearEnd=()=>{},cleanupSurvey=()=>{},cleanupRegistration=()=>{},cleanupIndicators=()=>{},renderId=0,disposed=false,panel=Object.hasOwn(panels,initialPanel)&&panelAllowed(initialPanel)?initialPanel:'home';
 root.innerHTML='<dialog class="management-hub-dialog" aria-labelledby="management-hub-title"><header class="management-hub-header"><div data-hub-heading-icon></div><div class="management-hub-user-row identity-card__user-row"><div class="management-hub-user" data-hub-user></div><div data-hub-sync></div></div><h2 id="management-hub-title" tabindex="-1"></h2><div data-hub-activity-actions></div></header><div class="management-hub-content-panel"><section class="management-hub-body" data-hub-body></section><footer class="management-hub-footer"><button class="secondary-button" type="button" data-hub-back></button></footer></div></dialog>';
 const dialog=root.querySelector('dialog'),body=dialog.querySelector('[data-hub-body]'),back=dialog.querySelector('[data-hub-back]');
 const useSurvey=surveySelection?root.ownerDocument.createElement('button'):null;
 if(useSurvey){
  useSurvey.type='button';
  useSurvey.className='secondary-button';
  useSurvey.dataset.hubSelectSurvey='';
  useSurvey.textContent='USAR NESTA CONVOCAÇÃO';
  useSurvey.addEventListener('click',()=>{
   const id=surveyForPanel(panel);
   if(id&&isSurveySessionCurrent()&&panelFolderAllowed(panel))surveySelection.select(id,panels[panel].title);
  });
  back.before(useSurvey);
 }
 dialog.querySelector('[data-hub-user]').textContent=displayName;
 if(syncStatusElement)dialog.querySelector('[data-hub-sync]').append(syncStatusElement);
 const render=()=>{
  cleanupYearEnd();cleanupYearEnd=()=>{};cleanupSurvey();cleanupSurvey=()=>{};cleanupRegistration();cleanupRegistration=()=>{};cleanupIndicators();cleanupIndicators=()=>{};const ticket=++renderId;
  const spec=panels[panel];dialog.dataset.panel=panel;delete dialog.dataset.surveyView;
  if(useSurvey){
   useSurvey.hidden=!surveyForPanel(panel)||!panelFolderAllowed(panel);
   dialog.toggleAttribute('data-survey-selection',!useSurvey.hidden);
  }
  dialog.querySelector('[data-hub-user]').textContent=['climateForm','stressForm','epidemiological'].includes(panel)?'Participação por grupo':displayName;
  dialog.querySelector('#management-hub-title').textContent=spec.title;
  const folder=panelFolders[panel],activityActions=dialog.querySelector('[data-hub-activity-actions]');
  dialog.querySelector('#management-hub-title').setAttribute('data-folder-state',panelFolderState(panel)||'');
  activityActions.innerHTML='';
  if(setActivityAvailability&&[...teamSurveyPanels,'professional','epidemiological'].includes(panel)){
   let enabled=activityAvailability(folder);
   if(typeof enabled==='boolean'){
    const toggle=root.ownerDocument.createElement('button'),message=root.ownerDocument.createElement('span');
    toggle.type='button';
    toggle.className='secondary-button';
    toggle.textContent=enabled?'DESATIVAR ATIVIDADE':'ATIVAR ATIVIDADE';
    message.setAttribute('role','status');
    const current=()=>!disposed&&ticket===renderId&&isSurveySessionCurrent();
    toggle.onclick=async()=>{
     if(toggle.disabled||!current())return;
     toggle.disabled=true;message.textContent=' Atualizando…';
     try{
      const next=!enabled,result=await setActivityAvailability(folder,next,current);
      if(!current())return;
      message.textContent=result.pending?' Confirmação pendente no Controle de Pastas.':' Alteração confirmada.';
      if(!result.pending){
       enabled=next;
       toggle.textContent=enabled?'DESATIVAR ATIVIDADE':'ATIVAR ATIVIDADE';
       toggle.disabled=false;
      }
     }catch{
      if(current()){message.textContent=' Não foi possível alterar. Confira o Controle de Pastas e tente novamente.';toggle.disabled=false;}
     }
    };
    activityActions.append(toggle,message);
   }
  }
  dialog.querySelector('[data-hub-heading-icon]').innerHTML=panel==='home'?'<img class="management-hub-diamond" src="'+assetBase+'assets/selo-qga-accredited-qmentum-diamond.png" alt="Diamond Qmentum" width="88" height="88" decoding="async">':icon(spec.icon);
  body.innerHTML=spec.items?'<div class="management-hub-grid">'+spec.items.map((item,index)=>{
   if(item.access==='functional'&&access.functional!==true)return '';
   if(item.access==='groups'&&!itemNavigable(item))return '';
   if(item.access==='communication'&&!communicationAllowed)return '';
   if(item.access==='fiControl'&&access.fiControl!==true)return '';
   if(['surveys','institutional'].includes(panel)&&!itemNavigable(item))return '';
   if(['performance','faPerformance','fcPerformance'].includes(item.access)&&access[item.access]!==true)return '';
   const state=panelFolderState(item.panel||item.route);
   const allowed=itemNavigable(item);
   return '<button type="button" class="management-hub-button '+(item.className||'')+'" data-hub-item="'+index+'"'+' data-folder-state="'+(state||'')+'"'+(item.access==='communication'?' data-comm-hub':'')+(allowed?'':' disabled aria-disabled="true" title="Acesso não liberado para este perfil"')+'><span class="management-hub-medallion">'+icon(item.icon)+'</span><span class="management-hub-label">'+(item.route==='training'&&fbPerformanceReleased?'Desempenho FB':item.label)+'</span><span class="management-hub-arrow" aria-hidden="true">›</span></button>';
  }).join('')+'</div>':'<div class="management-hub-empty">'+icon(spec.icon)+'<p>'+spec.message+'</p></div>';
  if(!panelFolderAllowed(panel)&&!navigationOnly.includes(panel)&&!spec.items){
   const folder=panelFolders[panel];
   body.innerHTML=folder&&typeof renderOperationalFolderDirectory==='function'?renderOperationalFolderDirectory(folder,{folderState,heading:false}):'';
   back.textContent=spec.parent?'VOLTAR':'HOME';body.scrollTop=0;onPanelChange(panel);
   dialog.querySelector('#management-hub-title').focus({preventScroll:true});
   return;
  }
  if(panel==='communication'&&communicationAllowed&&panelFolderAllowed('communication')&&openCommunication){
   body.innerHTML='<div data-comm-host></div>';
   const host=body.querySelector('[data-comm-host]'),current=()=>!disposed&&ticket===renderId&&panel==='communication'&&isSurveySessionCurrent();
   void openCommunication(host,current).then(cleanup=>{if(current())cleanupIndicators=cleanup;else cleanup?.();}).catch(()=>{if(current())host.textContent='Não foi possível abrir a Central.';});
  }
  if(panel==='vacations2027'&&access.vacations2027===true){
   body.innerHTML='<p role="status">Carregando escala de férias…</p>';
   const current=()=>!disposed&&ticket===renderId&&panel==='vacations2027'&&isSurveySessionCurrent();
   void import('./vacations-2027-ui.js').then(({mountVacations2027})=>{if(current())cleanupRegistration=mountVacations2027(body,{request:performVacations,isCurrent:current});}).catch(()=>{if(current())body.innerHTML='<p role="alert">Não foi possível abrir a escala. Volte e tente novamente.</p>';});
  }
  if(panel==='vaccinationHistory'&&openOccupationalHistory){
   const activePanel=panel;
   const current=()=>!disposed&&ticket===renderId&&panel===activePanel&&isSurveySessionCurrent()&&panelFolderAllowed(activePanel);
   body.innerHTML='<div data-occupational-history><p role="status">Preparando seu histórico…</p></div>';
   const host=body.querySelector('[data-occupational-history]');
   void openOccupationalHistory(host,activePanel,current,goBack).then(cleanup=>{
    if(current())cleanupRegistration=cleanup;
    else cleanup?.();
   }).catch(()=>{if(current())host.innerHTML='<p role="alert">Não foi possível preparar o histórico. Volte e tente novamente.</p>';});
  }
  if(panel==='yearEnd'&&access.yearEndSchedule===true){
   body.innerHTML='<p role="status">Preparando a escala…</p>';
   const current=()=>!disposed&&ticket===renderId&&panel==='yearEnd'&&isSurveySessionCurrent();
   void import('./year-end-schedule-ui.js').then(({mountYearEndSchedule})=>{if(!current())return;cleanupYearEnd=mountYearEndSchedule(body,{isCurrent:current,onConfirmed:onYearEndConfirmed,connectAccess:connectYearEndAccess,createRepository:current=>createYearEndRepository(current)});}).catch(()=>{if(current())body.innerHTML='<p role="alert">Não foi possível abrir a escala. Volte e tente novamente.</p>';});
  }
  if(panel==='general'&&institutionalAllowed()){
  const surveyCard=(kind,panel,title,subtitle)=>'<button type="button" class="management-hub-button management-survey-card" data-survey-panel="'+panel+'"'+' data-folder-state="'+(panelFolderState(panel)||'')+'"'+'><span class="management-hub-medallion">'+icon(kind)+'</span><span class="management-hub-label"><strong class="management-survey-title">'+title+'</strong>'+(panelFolderAllowed(panel)?'<span class="management-survey-subtitle">'+subtitle+'</span>':'')+'</span><span class="management-hub-arrow" aria-hidden="true">›</span></button>';
   body.innerHTML='<div class="management-surveys">'+(climateEnabled&&access.fePerformance===true?'<div class="management-survey-links">'+surveyCard(generalPerformance.icon,generalPerformance.panel,generalPerformance.label,'Minha pontuação nas pesquisas')+'</div>':'<p class="management-surveys-pending">Nenhuma opção disponível nesta área no momento.</p>')+'</div>';
  }
  if(teamSurveyPanels.includes(panel)&&access.teamSurveys){
   body.innerHTML='<iframe class="management-survey-frame" title="'+spec.title+'" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>';
   const frame=body.querySelector('iframe');
   const survey=panel==='climateForm'?'climate':'stress';
   const formPanel=panel;
   cleanupSurvey=bindSurveySession(frame,{
    perform:(action,response)=>performSurvey(survey,action,response),
    isCurrent:()=>!disposed&&panel===formPanel&&isSurveySessionCurrent(),
    onView:view=>{
     if(view==='complete')finishSurvey('institutional');
     else dialog.dataset.surveyView=view;
    }
   });
   frame.src=panel==='climateForm'?'https://outros-48120.web.app/':'https://outros-48120.web.app/stress.html';
  }
  if(panel==='fePerformance'){
   const current=()=>!disposed&&ticket===renderId&&panel==='fePerformance'&&isSurveySessionCurrent();
   body.innerHTML='<div data-fe-performance><p role="status">Carregando desempenho…</p></div>';
   const host=body.querySelector('[data-fe-performance]');
   void Promise.all([import('./fe-performance-data.js'),import('./fe-performance-ui.js')]).then(([data,ui])=>{
    if(!current())return;
    const repository=data.createFePerformanceRepository({uid:performanceUid,isCurrent:current,request:()=>performSurvey(undefined,'GET_PERFORMANCE')});
    cleanupIndicators=ui.mountFePerformanceModule(host,{repository,isCurrent:current});
   }).catch(()=>{if(current())host.textContent='Não foi possível confirmar o Desempenho FE.';});
  }
  if(panel==='epidemiological'&&access.epidemiological===true){
   const current=()=>!disposed&&ticket===renderId&&panel==='epidemiological'&&isSurveySessionCurrent();
   dialog.dataset.surveyView='intro';
   body.innerHTML='<div data-epidemiological></div>';
   const host=body.querySelector('[data-epidemiological]');
   void import('./epidemiological-ui.js').then(({mountEpidemiologicalSurvey})=>{
    if(current())cleanupRegistration=mountEpidemiologicalSurvey(host,{
     request:(action,input,signal)=>performRegistration('epidemiological',action,input,signal),
     onComplete:()=>{if(current())finishSurvey('institutional');}
    });
   }).catch(()=>{if(current())host.textContent='Não foi possível preparar o cadastro. Volte e tente novamente.';});
  }
  if(panel==='professional'&&surveyForPanel(panel)){
   body.innerHTML='<p role="status">Toque em <strong>Usar nesta convocação</strong> para incluir o link do Cadastro Profissional.</p>';
  }else if(panel==='professional'&&profilePanelAllowed(panel)){
   body.innerHTML='<p role="status">Preparando cadastro…</p>';const activePanel=panel;
   void import('./registration-ui.js').then(({mountInstitutionalRegistration})=>{if(disposed||ticket!==renderId||panel!==activePanel)return;cleanupRegistration=mountInstitutionalRegistration(body,{request:performRegistration,isCurrent:()=>!disposed&&ticket===renderId&&panel===activePanel&&isSurveySessionCurrent()});}).catch(()=>{if(!disposed&&ticket===renderId)body.innerHTML='<p role="alert">Não foi possível preparar o cadastro. Volte e tente novamente.</p>';});
  }
  if(panel!=='professional'&&surveyForPanel(panel)&&!profilePanelAllowed(panel))body.replaceChildren();
  back.textContent=surveySelection&&panel==='surveys'?'VOLTAR À CONVOCAÇÃO':spec.parent?'VOLTAR':'HOME';body.scrollTop=0;onPanelChange(panel);
  dialog.querySelector('#management-hub-title').focus({preventScroll:true});
 };
 const finishSurvey=destination=>{
  panel=destination;render();
  const notice=document.createElement('p');
  notice.className='management-survey-confirmation';notice.setAttribute('role','status');
  notice.textContent='Sua participação foi registrada.';
  body.prepend(notice);
 };
 const goBack=()=>{if(surveySelection&&panel==='surveys'&&isSurveySessionCurrent()){surveySelection.cancel();return;}const parent=panels[panel].parent;if(parent){panel=parent;render();}else onExit();};
 const click=event=>{
  const survey=event.target.closest('[data-survey-panel]');
  if(survey){if(panel==='general'&&climateEnabled&&institutionalAllowed()&&survey.dataset.surveyPanel==='fePerformance'&&panelAllowed(survey.dataset.surveyPanel)){panel=survey.dataset.surveyPanel;render();}return;}
  const button=event.target.closest('[data-hub-item]');if(!button||button.disabled)return;
  const item=panels[panel].items?.[Number(button.dataset.hubItem)];
  if(!item||!itemNavigable(item))return;
  if(item.panel){panel=item.panel;render();}else if(item.route)onNavigate(item.route);
 };
 const backClick=()=>{if(!cleanupRegistration.goBack?.(goBack))goBack();};
 const cancel=event=>{
  // File and camera inputs also emit a bubbling cancel event.
  if(event.target!==dialog)return;
  event.preventDefault();
  backClick();
 };
 const close=()=>{if(!disposed)onExit();};
 body.addEventListener('click',click);back.addEventListener('click',backClick);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',close);
 render();if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
 return ()=>{disposed=true;renderId++;cleanupYearEnd();cleanupRegistration();cleanupIndicators();cleanupSurvey();body.removeEventListener('click',click);back.removeEventListener('click',backClick);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',close);if(dialog.open&&typeof dialog.close==='function')dialog.close();root.replaceChildren();};
}
