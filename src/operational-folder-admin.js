import {operationalFolders,operationalFolderAllowed} from './operational-folders.js';
import {subscribeOperationalFolderPolicy} from './operational-folder-runtime.js';

export function mountOperationalFolderAdmin(root,{request,isCurrent}) {
 let policy=null,busy=false,message='',inspection=null;
 function render() {
  if(!isCurrent())return;
  const pending=!!policy?.pending;
  const description=pending?'Atualização pendente. A pasta só será liberada depois que os serviços confirmarem a ativação.':
   policy?'Pastas desativadas continuam visíveis com controles inativos.':'Aguardando a confirmação do servidor.';
  const controls=policy?Object.entries(operationalFolders).map(([id,title])=>{
   const ownActive=!policy.disabled?.includes(id);
   const effective=operationalFolderAllowed(policy,id);
   return `<li style="margin-inline-start:${(id.split('/').length-1)*1.2}rem"><strong>${title}</strong>
    <span class="record-meta">${effective?'Ativa':ownActive?'Desativada pela pasta principal':'Desativada'}</span>
    <button type="button" class="secondary-button" data-operational-folder="${id}" aria-label="${ownActive?'Desativar':'Ativar'} ${title}"
     ${busy||pending?'disabled':''}>${ownActive?'Desativar':'Ativar'}</button></li>`;
  }).join(''):'';
  const stationLabels={current:'Confirmado',prepared:'Preparado, aguardando liberação',missing:'Sem política',invalid:'Política inválida',behind:'Revisão anterior',different:'Política diferente',unavailable:'Indisponível'};
  const stationRows=inspection?.stations?.filter(item=>/^(FB|FC|FD|FE|FF|FG|FH|FI|FJ)$/.test(item.station)&&Object.hasOwn(stationLabels,item.state))||[];
  const status=inspection&&(!policy||inspection.revision===policy.revision&&inspection.pending===pending)
   ? '<ul>'+stationRows.map(item=>'<li>'+item.station+' · '+stationLabels[item.state]+'</li>').join('')+'</ul>' : '';
  const initialize=policy?.revision===0 ? '<button type="button" class="secondary-button" data-operational-folder-initialize'+(busy?' disabled':'')+'>Inicializar controle</button>' : '';
  root.innerHTML=`<h3>Controle de pastas</h3><p>${description}</p>
    <button type="button" class="secondary-button" data-operational-folder-inspect ${busy?'disabled':''}>Conferir serviços</button>${initialize}${status}<ul>${controls}</ul>${pending?`<button type="button" class="secondary-button" data-operational-folder-resume ${busy?'disabled':''}>Retomar atualização</button>`:''}
    <p class="record-meta" data-operational-folder-status role="status"></p>`;
  root.querySelector('[data-operational-folder-status]').textContent=message;
 }
 async function click(event) {
  const button=event.target.closest?.('[data-operational-folder],[data-operational-folder-resume],[data-operational-folder-inspect],[data-operational-folder-initialize]');
  if(!button||!root.contains(button)||button.disabled||busy||!isCurrent())return;
  const id=button.dataset.operationalFolder;
  const inspect=button.hasAttribute('data-operational-folder-inspect');
  if(!inspect&&!policy)return;
  const initialize=button.hasAttribute('data-operational-folder-initialize');
  const data=inspect?{inspect:true}:initialize?{initialize:true,revision:0}:id?{id,enabled:policy.disabled.includes(id),revision:policy.revision}:{resume:true,revision:policy.revision};
  busy=true;message='Enviando atualização…';render();
  try {
   const result=await request(inspect?'folders.inspect':'folders.publish',inspect?{}:data);
   if(inspect){
    inspection=result;
    message=result.pending?'A atualização está pendente. Retome para concluir.':result.initialized
     ?'Revise o estado de cada serviço.':'A política ainda não foi inicializada.';
    return;
   }
   inspection=null;
   message=result.pending?'Alguns serviços ainda não confirmaram. Use Retomar atualização.':'Atualização confirmada pelos serviços.';
  }catch(error){message=error.code==='FOLDER_POLICY_CONFLICT'?'O controle mudou em outra sessão. Atualize a consulta e tente novamente.':'Não foi possível concluir a operação na Central FI.';}
  finally{busy=false;render();}
 }
 root.addEventListener('click',click);
 const stop=subscribeOperationalFolderPolicy(value=>{policy=value;render();});
 return ()=>{stop();root.removeEventListener('click',click);};
}
