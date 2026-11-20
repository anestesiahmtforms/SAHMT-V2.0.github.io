import {functionalFolders,functionalFolderAllowed,initialFunctionalFolderPolicy} from './operational-folders.js';
import {subscribeFunctionalFolderPolicy} from './functional-folder-policy.js';

const groups=new Map();
for(const [id,title] of Object.entries(functionalFolders)){
 const root=id.split('/')[0];if(!groups.has(root))groups.set(root,[]);
 groups.get(root).push({id,title,parents:id.split('/').slice(1,-1).map((_,index,parts)=>functionalFolders['funcional/'+parts.slice(0,index+1).join('/')]).filter(Boolean).join(' / ')});
}
export function mountFunctionalFolderAdmin(root,{request,isCurrent,folderId}={}){
 let policy=null,busy=false,message='';
 root.innerHTML=`<div class="fi-folder-tools">
  <div class="fi-folder-actions"><button type="button" data-fk-folder-inspect>Conferir política FK</button><button type="button" data-fk-folder-init hidden>Inicializar controle do Funcional FK</button></div>
  <p class="fi-folder-notice" data-fk-folder-status role="status"></p><div class="fi-folder-list" data-fk-folder-list></div>
 </div>`;
 const status=root.querySelector('[data-fk-folder-status]'),list=root.querySelector('[data-fk-folder-list]'),init=root.querySelector('[data-fk-folder-init]'),inspect=root.querySelector('[data-fk-folder-inspect]');
 function render(){
  if(!isCurrent())return;
  init.hidden=!policy||policy.revision!==0;init.disabled=busy||!policy;inspect.disabled=busy;
  status.textContent=message||(!policy?'Aguardando confirmação do Firestore FK.':'');
  if(!policy){list.innerHTML='';return;}
  list.innerHTML=[...groups].map(([id,folders])=>{
   return `<details class="fi-folder-group" open><summary${functionalFolderAllowed(policy,id)?'':' data-folder-inactive'}><strong>${functionalFolders[id]}</strong></summary><ul>${folders.map(folder=>{
    const effective=functionalFolderAllowed(policy,folder.id);
    return `<li class="fi-folder-row"${effective?'':' data-folder-inactive'}><div class="fi-folder-name"><strong>${folder.title}</strong>${folder.parents?`<small>${folder.parents}</small>`:''}</div><button type="button" data-fk-folder="${folder.id}" ${busy||policy.revision===0?'disabled':''}>${effective?'Desativar':'Ativar'}</button></li>`;
   }).join('')}</ul></details>`;
  }).join('');
 }
 async function click(event){
  const button=event.target.closest?.('[data-fk-folder-init],[data-fk-folder-inspect],[data-fk-folder]');
  if(!button||!root.contains(button)||button.disabled||busy||!isCurrent())return;
  const id=button.dataset.fkFolder,initialize=button.hasAttribute('data-fk-folder-init'),checking=button.hasAttribute('data-fk-folder-inspect');
  busy=true;message=initialize?'Inicializando controle do Funcional FK…':checking?'Conferindo Firestore FK…':'Salvando alteração no Funcional FK…';render();
  try{
   const result=await request(checking?'functionalFolders.inspect':'functionalFolders.publish',initialize?{initialize:true,revision:0}:checking?{}:{id,enabled:!functionalFolderAllowed(policy,id),revision:policy.revision});
   const current=checking?result:await request('functionalFolders.inspect',{});
   if(current.initialized)policy={schemaVersion:1,revision:current.revision,disabled:current.disabled};
   else policy=initialFunctionalFolderPolicy;
   message=checking?result.initialized?'Política do Funcional FK confirmada.':'A política ainda não foi inicializada.':initialize?'Controle inicializado.':'Alteração confirmada somente no Firestore FK.';
  }catch(error){message=error.code==='FOLDER_POLICY_CONFLICT'?'A política mudou em outra sessão. Aguarde a atualização e tente novamente.':'Não foi possível atualizar a política exclusiva do Funcional FK.';}
  finally{busy=false;render();}
 }
 root.addEventListener('click',click);
 const stop=subscribeFunctionalFolderPolicy(value=>{policy=value;render();});
 return ()=>{stop();root.removeEventListener('click',click);};
}
