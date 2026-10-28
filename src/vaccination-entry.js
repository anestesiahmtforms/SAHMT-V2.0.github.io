/** Keep existing activities until the professional opens Biossegurança. */
export function mountVaccinationEntry(root,{user,profile,valid=()=>true,onOpen=()=>{},onBack=()=>{},loadModule=()=>import('./vaccination.js'),loadDosimetryModule=()=>import('./dosimetry.js')}={}){
 let disposed=false,active=null,loading=false,stage='entry',generation=0;
 const shield='<svg class="document-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Z"/><path d="M12 8v8M8 12h8"/></svg>';
 const radiation='<svg class="document-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="m10 8-4-5a10 10 0 0 0-4 9h7m6 0h7a10 10 0 0 0-4-9l-4 5m-5 8-3 6h12l-3-6"/></svg>';
 const section=document.createElement('section');section.className='management-vaccination-launch';
 section.innerHTML='<div><p class="eyebrow">SAÚDE OCUPACIONAL</p><h4>Biossegurança</h4><p>Acesse seus históricos individuais de vacinação e dosimetria.</p></div><button type="button" class="primary-button" data-biosafety-open>'+shield+'<span>BIOSSEGURANÇA</span></button>';
 root.prepend(section);
 const live=()=>!disposed&&root.isConnected&&valid();
 function menu(){
  if(!live())return;generation++;active?.();active=null;stage='menu';loading=false;
  root.innerHTML='<section class="biosafety-panel"><header class="biosafety-header">'+shield+'<div><p class="eyebrow">GESTÃO DE PESSOAS</p><h3>BIOSSEGURANÇA</h3><p>Seus históricos individuais, vinculados ao seu cadastro.</p></div></header><div class="biosafety-grid"><button type="button" class="primary-button biosafety-choice" data-vaccination-open>'+shield+'<span>MEU HISTÓRICO VACINAL</span><span aria-hidden="true">›</span></button><button type="button" class="primary-button biosafety-choice" data-dosimetry-open>'+radiation+'<span>MEU HISTÓRICO DOSIMETRIA</span><span aria-hidden="true">›</span></button></div><p role="status" data-biosafety-status></p><button type="button" class="secondary-button" data-biosafety-back>VOLTAR PARA GESTÃO DE PESSOAS</button></section>';
 }
 async function child(kind){
  if(!live()||loading||stage!=='menu')return;loading=true;const ticket=++generation;
  const status=root.querySelector('[data-biosafety-status]');status.textContent='Abrindo seu histórico…';root.querySelectorAll('.biosafety-choice').forEach(b=>b.disabled=true);
  try{const module=await(kind==='vaccination'?loadModule():loadDosimetryModule());if(!live()||ticket!==generation)return;stage=kind;loading=false;active=(kind==='vaccination'?module.mountVaccination:module.mountDosimetry)(root,{user,profile,onBack:menu});}
  catch{if(live()&&ticket===generation){loading=false;menu();root.querySelector('[data-biosafety-status]').textContent='Não foi possível abrir seu histórico. Tente novamente.';}}
 }
 const click=event=>{
  if(event.target.closest('[data-biosafety-open]')&&stage==='entry'&&live()){onOpen();menu();return;}
  if(event.target.closest('[data-biosafety-back]')){onBack();return;}
  if(event.target.closest('[data-vaccination-open]'))void child('vaccination');
  if(event.target.closest('[data-dosimetry-open]'))void child('dosimetry');
 };
 root.addEventListener('click',click);
 const cleanup=()=>{disposed=true;generation++;root.removeEventListener('click',click);active?.();active=null;section.remove();};
 cleanup.goBack=()=>{if(stage==='entry')return false;if(active?.goBack)return active.goBack();if(stage!=='menu'){menu();return true;}onBack();return true;};return cleanup;
}
