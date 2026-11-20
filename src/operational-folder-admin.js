import {operationalFolders,operationalFolderAllowed,governanceFolderRoots} from './operational-folders.js';
import {operationalFolderState,subscribeOperationalFolderPolicy} from './operational-folder-runtime.js';
import {governanceIcon,governancePanels,governancePanelFolders,governanceGeneralPerformance} from './governance-navigation.js';
import {deployment} from './deployment-context.js';
import {managementAreaIcon} from './management-area-icons.js';
import './management-hub.css';

const fold=value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();

const entries=new Map([['home',{key:'home',title:'Governança'}]]);
const registered=new Set();
const documentLibrary='gestao/area-gestao-de-documentos';
const links={
 funcional:'#/fi-control/funcional',
 [documentLibrary]:(deployment.externalManagementEnabled?deployment.fbBase:'')+'#/management/area-gestao-de-documentos'
};
function add(entry){
 entries.set(entry.key,entry);
 if(entry.policyId)registered.add(entry.policyId);
}
function governanceLevel(panel,parent){
 const items=panel==='general'
  ? [governanceGeneralPerformance]
  : governancePanels[panel]?.items||[];
 for(const item of items){
  const route=item.panel||item.route;
  const id=governancePanelFolders[route];
  // Acesso Restrito is a navigation level within Consultas and shares its tint.
  const key=route==='institutional'?route:id;
  add({key,parent,title:item.label,icon:item.icon,className:item.className,
   policyId:route==='institutional'?null:id,stateId:id});
  governanceLevel(route,key);
 }
}
governanceLevel('home','home');
for(const [id,title] of Object.entries(operationalFolders)){
 if(registered.has(id)||id.startsWith('funcional/'))continue;
 const separator=id.lastIndexOf('/');
 const parent=separator===-1?'other':id.slice(0,separator);
 add({key:id,parent:id==='consultas/biosseguranca'?'other':parent,title,icon:'groups',policyId:id,stateId:id});
}
add({key:'other',parent:'home',title:'Outras pastas',icon:'groups'});
const children=key=>[...entries.values()].filter(entry=>entry.parent===key);
function folderPath(key){
 const path=[];
 for(let entry=entries.get(key);entry;entry=entries.get(entry.parent))path.unshift(entry.title);
 return path.join(' › ');
}
const permanent=new Set(['comunicacao','fi-control']);
const controllable=entry=>entry.policyId&&!permanent.has(entry.policyId)&&entry.policyId!=='funcional';
const stationLabels={current:'Confirmado',prepared:'Preparado, aguardando liberação',missing:'Sem política',invalid:'Política inválida',behind:'Revisão anterior',different:'Política diferente',unavailable:'Indisponível'};

export function mountOperationalFolderAdmin(root,{request,isCurrent,folderId}) {
 let policy=null,busy=false,message='',inspection=null,query='';
 const selected=entries.get(folderId);
 let page=selected?.parent||'home';
 root.innerHTML=`<div class="fi-folder-tools">
  <p class="fi-folder-description" data-folder-description></p>
  <div class="fi-folder-actions">
   <button type="button" data-operational-folder-inspect>Conferir serviços</button>
   <button type="button" data-operational-folder-initialize hidden>Inicializar controle</button>
   <button type="button" data-operational-folder-lock-governance hidden>Desativar Governança para usuários comuns</button>
   <button type="button" data-operational-folder-resume hidden>Retomar atualização</button>
  </div>
  <p class="fi-folder-notice" data-operational-folder-status role="status"></p>
  <div data-folder-services></div>
 </div>
 <div class="fi-folder-list-heading">
  <label for="fi-folder-filter">Buscar pasta</label>
  <input id="fi-folder-filter" type="search" placeholder="Ex.: Gestão de Pessoas ou Meu Histórico Vacinal" autocomplete="off">
  <p data-folder-count></p>
 </div>
 <div class="fi-governance-navigation" data-folder-list></div>`;
 const filter=root.querySelector('#fi-folder-filter');
 const description=root.querySelector('[data-folder-description]');
 const status=root.querySelector('[data-operational-folder-status]');
 const serviceList=root.querySelector('[data-folder-services]');
 const count=root.querySelector('[data-folder-count]');
 const list=root.querySelector('[data-folder-list]');
 const inspectButton=root.querySelector('[data-operational-folder-inspect]');
 const initializeButton=root.querySelector('[data-operational-folder-initialize]');
 const lockGovernanceButton=root.querySelector('[data-operational-folder-lock-governance]');
 const resumeButton=root.querySelector('[data-operational-folder-resume]');

 function render(focusId) {
  if(!isCurrent())return;
  const focused=root.ownerDocument.activeElement;
  const folderToFocus=focused?.dataset.operationalFolder||focusId;
  query=fold(filter.value);
  const pending=!!policy?.pending;
  description.textContent=pending?'Atualização pendente. Retome a atualização para confirmar a mudança nos serviços.':
   policy?'':'Aguardando a confirmação do servidor.';
  initializeButton.hidden=policy?.revision!==0;
  lockGovernanceButton.hidden=!policy||policy.revision===0||!governanceFolderRoots.some(id=>operationalFolderAllowed(policy,id));
  resumeButton.hidden=!pending;
  for(const button of [inspectButton,initializeButton,lockGovernanceButton])button.disabled=busy||pending;
  resumeButton.disabled=busy;
  filter.disabled=!policy;
  status.textContent=message;

  const stations=inspection?.stations?.filter(item=>/^(FB|FC|FD|FE|FF|FG|FH|FI|FJ)$/.test(item.station)&&Object.hasOwn(stationLabels,item.state))||[];
  serviceList.innerHTML=stations.length&&(!policy||inspection.revision===policy.revision&&inspection.pending===pending)
   ? `<section class="fi-folder-services" aria-label="Estado dos serviços"><h3>Estado dos serviços</h3><ul>${stations.map(item=>`<li><strong>${item.station}</strong> <span>${stationLabels[item.state]}</span></li>`).join('')}</ul></section>` : '';

  const level=entries.get(page);
  const results=policy?(query?[...entries.values()].filter(entry=>entry.parent&&(fold(folderPath(entry.key)).includes(query)||fold(operationalFolders[entry.policyId]||'').includes(query))):children(page)):[];
  count.textContent=query&&policy?(results.length===1?'1 pasta encontrada':`${results.length} pastas encontradas`):'';
  count.hidden=!query||!policy;
  list.dataset.folderPage=query?'search':page;
  list.innerHTML=policy?`
   <h3 tabindex="-1" data-folder-heading>${query?'Resultados da busca':level.title}</h3>
   ${!query&&level.parent?`<button type="button" class="fi-folder-up" data-folder-page-target="${level.parent}">‹ Voltar para ${entries.get(level.parent).title}</button>`:''}
   <ul class="fi-governance-grid">${results.map(card).join('')}</ul>
   ${!results.length?'<p class="empty-state">Nenhuma pasta encontrada.</p>':''}
  `:'';
  if(folderToFocus)list.querySelector(`[data-operational-folder="${folderToFocus}"]:enabled`)?.focus({preventScroll:true});
 }

 function card(entry){
  const {key,title,icon,className='',policyId,stateId}=entry;
  const id=stateId;
  const state=permanent.has(id)?'active':id==='funcional'?operationalFolderState(id):id?(operationalFolderAllowed(policy,id)?'active':'inactive'):null;
  const action=state==='active'?'Desativar':'Ativar';
  const parentInactive=key==='desempenho/fe'&&!operationalFolderAllowed(policy,'consultas/pesquisas');
  const tint=parentInactive?'inactive':state;
  const href=links[key];
  const branch=children(key).length>0;
  const face=`class="management-hub-button ${className}" data-folder-state="${tint||''}"`;
  const medallion=/^gestao\/[^/]+$/.test(key)
   ? managementAreaIcon({id:key.split('/')[1],name:title})
   : `<span class="management-hub-medallion">${governanceIcon(icon)}</span>`;
  const label=`${medallion}<span class="management-hub-label">${title}${query?`<small>${folderPath(entry.parent)}</small>`:''}</span>${href||branch?'<span class="management-hub-arrow" aria-hidden="true">›</span>':''}`;
  const surface=href?`<a ${face} href="${href}">${label}</a>`
   :branch?`<button type="button" ${face} data-folder-page-target="${key}">${label}</button>`
   :`<div ${face}>${label}</div>`;
  const toggle=controllable(entry)?`<button type="button" class="fi-governance-toggle" data-operational-folder="${policyId}" data-enable="${state!=='active'}" aria-label="${action} ${title}" ${busy||policy.pending||policy.revision===0?'disabled':''}>${action}</button>`:'';
  return `<li class="fi-governance-card" data-folder-card="${key}">${surface}${toggle}</li>`;
 }
 async function click(event) {
  const destination=event.target.closest?.('[data-folder-page-target]');
  if(destination&&list.contains(destination)&&isCurrent()){
   page=destination.dataset.folderPageTarget;
   filter.value='';
   render();
   root.scrollTop=0;
   list.querySelector('[data-folder-heading]')?.focus({preventScroll:true});
   return;
  }
  const button=event.target.closest?.('[data-operational-folder],[data-operational-folder-resume],[data-operational-folder-inspect],[data-operational-folder-initialize],[data-operational-folder-lock-governance]');
  if(!button||!root.contains(button)||button.disabled||busy||!isCurrent())return;
  const id=button.dataset.operationalFolder;
  const inspect=button.hasAttribute('data-operational-folder-inspect');
  const initialize=button.hasAttribute('data-operational-folder-initialize');
  const lockGovernance=button.hasAttribute('data-operational-folder-lock-governance');
  if(!inspect&&!policy)return;
  const data=inspect?{}:initialize?{initialize:true,revision:0}:lockGovernance?null:id?{id,enabled:!operationalFolderAllowed(policy,id),revision:policy.revision}:{resume:true,revision:policy.revision};
  const restoreFocus=id&&root.ownerDocument.activeElement===button;
  busy=true;message=inspect?'Conferindo serviços…':lockGovernance?'Desativando conteúdos de Governança…':initialize?'Inicializando e bloqueando conteúdos de Governança…':'Enviando atualização…';render();
  try {
   let result;
   if(initialize){
    result=await request('folders.publish',data);
   }else if(lockGovernance){
    let revision=policy.revision;
    for(const folder of governanceFolderRoots){
     if(!operationalFolderAllowed(policy,folder))continue;
     result=await request('folders.publish',{id:folder,enabled:false,revision});
     revision=result.revision;
     if(result.pending)break;
    }
    result=result||{revision,pending:false};
   }else result=await request(inspect?'folders.inspect':'folders.publish',data);
   if(inspect){
    inspection=result;
    message=result.pending?'A atualização está pendente. Retome para concluir.':result.initialized
     ?'Revise o estado de cada serviço.':'A política ainda não foi inicializada.';
    return;
   }
   inspection=null;
   message=result.pending?'Alguns serviços ainda não confirmaram. Use Retomar atualização.':'Atualização confirmada pelos serviços.';
  }catch(error){message=error.code==='FOLDER_POLICY_CONFLICT'?'O controle mudou em outra sessão. Atualize a consulta e tente novamente.'
   :error.code==='FOLDER_POLICY_INPUT'?'A Central FI ainda não reconhece esta pasta. Atualize o Worker de controle antes de alterar o estado.'
   :'Não foi possível concluir a operação na Central FI.';}
  finally{
   busy=false;
   render(restoreFocus&&root.ownerDocument.activeElement===root.ownerDocument.body?id:null);
  }
 }
 const updateFilter=()=>render();
 filter.addEventListener('input',updateFilter);
 root.addEventListener('click',click);
 let focusFolder=selected?.policyId;
 const stop=subscribeOperationalFolderPolicy(value=>{
  policy=value;
  render(value?focusFolder:undefined);
  if(value)focusFolder=undefined;
 });
 return ()=>{stop();root.removeEventListener('click',click);filter.removeEventListener('input',updateFilter);};
}
