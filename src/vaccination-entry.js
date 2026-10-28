/** Preserve the area's activities until the professional explicitly opens their history. */
export function mountVaccinationEntry(root,{user,profile,valid=()=>true,onOpen=()=>{},onBack=()=>{},loadModule=()=>import('./vaccination.js')}={}){
 let disposed=false,active=null,loading=false;
 const section=document.createElement('section');section.className='management-vaccination-launch';
 section.innerHTML='<div><p class="eyebrow">SAÚDE OCUPACIONAL</p><h4>Meu Histórico Vacinal</h4><p>Cadastre sua situação e envie os comprovantes do período.</p></div><button type="button" class="primary-button" data-vaccination-open><svg class="document-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Z"/><path d="M12 8v8M8 12h8"/></svg><span>MEU HISTÓRICO VACINAL</span></button><p class="record-meta" role="status" data-vaccination-entry-status></p>';
 root.prepend(section);const button=section.querySelector('button'),status=section.querySelector('[data-vaccination-entry-status]');
 async function open(){
  if(disposed||loading||!root.isConnected||!valid())return;loading=true;button.disabled=true;status.textContent='Abrindo seu histórico…';
  try{const module=await loadModule();if(disposed||!root.isConnected||!valid())return;onOpen();active=module.mountVaccination(root,{user,profile,onBack});}
  catch{if(!disposed&&root.isConnected&&valid()){button.disabled=false;status.textContent='Não foi possível abrir o histórico. Tente novamente.';}}
  finally{loading=false;}
 }
 button.addEventListener('click',open);
 const cleanup=()=>{disposed=true;button.removeEventListener('click',open);active?.();active=null;section.remove();};
 cleanup.goBack=()=>active?.goBack?.()??false;return cleanup;
}
