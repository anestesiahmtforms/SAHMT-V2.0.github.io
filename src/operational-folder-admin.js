import {operationalFolders,operationalFolderAllowed} from './operational-folders.js';
import {subscribeOperationalFolderPolicy} from './operational-folder-runtime.js';

const fold=value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const groups=new Map();
for(const [id,title] of Object.entries(operationalFolders)){
 const path=id.split('/');
 const group=path[0];
 const parents=path.slice(0,-1).map((_,index)=>operationalFolders[path.slice(0,index+1).join('/')]).filter(Boolean).join(' / ');
 if(!groups.has(group))groups.set(group,[]);
 groups.get(group).push({id,title,parents,search:fold(parents+' '+title)});
}
const stationLabels={current:'Confirmado',prepared:'Preparado, aguardando liberação',missing:'Sem política',invalid:'Política inválida',behind:'Revisão anterior',different:'Política diferente',unavailable:'Indisponível'};

export function mountOperationalFolderAdmin(root,{request,isCurrent}) {
 let policy=null,busy=false,message='',inspection=null,query='';
 let openGroups=new Set();
 root.innerHTML=`<div class="fi-folder-tools">
  <p class="fi-folder-description" data-folder-description></p>
  <div class="fi-folder-actions">
   <button type="button" data-operational-folder-inspect>Conferir serviços</button>
   <button type="button" data-operational-folder-initialize hidden>Inicializar controle</button>
   <button type="button" data-operational-folder-resume hidden>Retomar atualização</button>
  </div>
  <p class="fi-folder-notice" data-operational-folder-status role="status"></p>
  <div data-folder-services></div>
 </div>
 <div class="fi-folder-list-heading">
  <label for="fi-folder-filter">Buscar pasta</label>
  <input id="fi-folder-filter" type="search" placeholder="Ex.: Escala, Etiquetas ou Pessoas" autocomplete="off">
  <p data-folder-count></p>
 </div>
 <div class="fi-folder-list" data-folder-list></div>`;
 const filter=root.querySelector('#fi-folder-filter');
 const description=root.querySelector('[data-folder-description]');
 const status=root.querySelector('[data-operational-folder-status]');
 const serviceList=root.querySelector('[data-folder-services]');
 const count=root.querySelector('[data-folder-count]');
 const list=root.querySelector('[data-folder-list]');
 const inspectButton=root.querySelector('[data-operational-folder-inspect]');
 const initializeButton=root.querySelector('[data-operational-folder-initialize]');
 const resumeButton=root.querySelector('[data-operational-folder-resume]');

 function render(focusId) {
  if(!isCurrent())return;
  const focused=root.ownerDocument.activeElement;
  const folderToFocus=focused?.dataset.operationalFolder||focusId;
  const groupToFocus=focused?.closest('summary')?.parentElement.dataset.folderGroup;
  if(!query)openGroups=new Set([...list.querySelectorAll('details[open]')].map(item=>item.dataset.folderGroup));
  query=fold(filter.value);
  const pending=!!policy?.pending;
  description.textContent=pending?'Atualização pendente. Retome a atualização para confirmar a mudança nos serviços.':
   policy?'Uma pasta desativada também bloqueia o acesso às suas subpastas.':'Aguardando a confirmação do servidor.';
  initializeButton.hidden=policy?.revision!==0;
  resumeButton.hidden=!pending;
  for(const button of [inspectButton,initializeButton,resumeButton])button.disabled=busy;
  filter.disabled=!policy;
  status.textContent=message;

  const stations=inspection?.stations?.filter(item=>/^(FB|FC|FD|FE|FF|FG|FH|FI|FJ)$/.test(item.station)&&Object.hasOwn(stationLabels,item.state))||[];
  serviceList.innerHTML=stations.length&&(!policy||inspection.revision===policy.revision&&inspection.pending===pending)
   ? `<section class="fi-folder-services" aria-label="Estado dos serviços"><h3>Estado dos serviços</h3><ul>${stations.map(item=>`<li><strong>${item.station}</strong> <span>${stationLabels[item.state]}</span></li>`).join('')}</ul></section>` : '';

  const row=({id,title,parents})=>{
   const ownActive=!policy.disabled?.includes(id);
   const effective=operationalFolderAllowed(policy,id);
   const state=effective?'Ativa':ownActive?'Desativada pela pasta principal':'Desativada';
   const action=ownActive?'Desativar':'Ativar';
   return `<li class="fi-folder-row">
    <div class="fi-folder-name"><strong>${title}</strong>${parents?`<small>${parents}</small>`:''}</div>
    <span class="fi-folder-state" data-state="${effective?'active':ownActive?'inherited':'disabled'}">${state}</span>
    <button type="button" data-operational-folder="${id}" data-enable="${!ownActive}" aria-label="${action} ${title}" ${busy||pending?'disabled':''}>${action}</button>
   </li>`;
  };
  const total=Object.keys(operationalFolders).length;
  let visible=0;
  const markup=policy?[...groups].map(([id,folders])=>{
   const matches=folders.filter(folder=>folder.search.includes(query));
   if(!matches.length)return '';
   visible+=matches.length;
   if(folders.length===1)return `<ul class="fi-folder-standalone">${row(folders[0])}</ul>`;
   const active=matches.filter(folder=>operationalFolderAllowed(policy,folder.id)).length;
   return `<details class="fi-folder-group" data-folder-group="${id}" ${query||openGroups.has(id)?'open':''}>
    <summary><strong>${operationalFolders[id]}</strong><span>${active} de ${matches.length} ativas</span></summary>
    <ul>${matches.map(row).join('')}</ul>
   </details>`;
  }).join(''):'';
  list.innerHTML=markup||(policy?'<p class="empty-state">Nenhuma pasta encontrada.</p>':'');
  count.textContent=policy?(query?`${visible} de ${total} pastas`:`${total} pastas no controle`):'';
  const focusTarget=folderToFocus
   ? list.querySelector(`[data-operational-folder="${folderToFocus}"]:enabled`)
   : groupToFocus ? list.querySelector(`[data-folder-group="${groupToFocus}"] > summary`) : null;
  focusTarget?.focus({preventScroll:true});
 }
 async function click(event) {
  const button=event.target.closest?.('[data-operational-folder],[data-operational-folder-resume],[data-operational-folder-inspect],[data-operational-folder-initialize]');
  if(!button||!root.contains(button)||button.disabled||busy||!isCurrent())return;
  const id=button.dataset.operationalFolder;
  const inspect=button.hasAttribute('data-operational-folder-inspect');
  if(!inspect&&!policy)return;
  const initialize=button.hasAttribute('data-operational-folder-initialize');
  const data=inspect?{}:initialize?{initialize:true,revision:0}:id?{id,enabled:policy.disabled.includes(id),revision:policy.revision}:{resume:true,revision:policy.revision};
  const restoreFocus=id&&root.ownerDocument.activeElement===button;
  busy=true;message=inspect?'Conferindo serviços…':'Enviando atualização…';render();
  try {
   const result=await request(inspect?'folders.inspect':'folders.publish',data);
   if(inspect){
    inspection=result;
    message=result.pending?'A atualização está pendente. Retome para concluir.':result.initialized
     ?'Revise o estado de cada serviço.':'A política ainda não foi inicializada.';
    return;
   }
   inspection=null;
   message=result.pending?'Alguns serviços ainda não confirmaram. Use Retomar atualização.':'Atualização confirmada pelos serviços.';
  }catch(error){message=error.code==='FOLDER_POLICY_CONFLICT'?'O controle mudou em outra sessão. Atualize a consulta e tente novamente.':'Não foi possível concluir a operação na Central FI.';}
  finally{
   busy=false;
   render(restoreFocus&&root.ownerDocument.activeElement===root.ownerDocument.body?id:null);
  }
 }
 const updateFilter=()=>render();
 filter.addEventListener('input',updateFilter);
 root.addEventListener('click',click);
 const stop=subscribeOperationalFolderPolicy(value=>{policy=value;render();});
 return ()=>{stop();root.removeEventListener('click',click);filter.removeEventListener('input',updateFilter);};
}
