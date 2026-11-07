import {YEAR_END_SHIFTS,YEAR_END_GROUPS,yearEndMessage} from './year-end-schedule.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function openYearEndScheduleEditor(root,{person,record,renderOptions,save,onSaved=()=>{},isCurrent=()=>true}={}) {
  let disposed=false,busy=false;
  const previous=document.activeElement,dialog=document.createElement('dialog');
  dialog.className='year-end year-end-edit-dialog';dialog.setAttribute('aria-labelledby','year-end-editor-title');
  dialog.innerHTML=`<h3 id="year-end-editor-title">Editar escolhas · ${h(person.sigla||'Sem sigla')}</h3>
    <form data-year-end-editor-form><div class="year-end-fields">
      <fieldset data-editor-shift><legend>PLANTÃO:</legend>${renderOptions('plantao',YEAR_END_SHIFTS)}</fieldset>
      <fieldset data-editor-group${person.requireGroup?'':' class="year-end-fieldset--inactive" disabled'}><legend>GRUPO DE TRABALHO:${person.requireGroup?'':' DISPENSADO'}</legend>${renderOptions('grupo',YEAR_END_GROUPS,person.requireGroup)}</fieldset>
    </div><p class="year-end-feedback" data-editor-feedback role="status" aria-live="polite"></p>
    <div class="year-end-edit-actions"><button type="button" class="year-end-edit-cancel" data-editor-cancel>CANCELAR</button><button type="submit" class="year-end-submit" disabled>SALVAR ALTERAÇÕES</button></div></form>`;
  const form=dialog.querySelector('form'),feedback=dialog.querySelector('[data-editor-feedback]'),cancel=dialog.querySelector('[data-editor-cancel]');
  const active=()=>!disposed&&root.isConnected&&dialog.isConnected&&isCurrent();
  const selection=()=>({plantao:form.querySelector('[name="plantao"]:checked')?.value,grupo:person.requireGroup?form.querySelector('[name="grupo"]:checked')?.value:null});
  const paint=()=>{
    const choices=selection(),complete=Boolean(choices.plantao&&(!person.requireGroup||choices.grupo)),same=record&&choices.plantao===record.plantao&&choices.grupo===record.grupo;
    form.querySelector('[data-editor-shift]').disabled=busy;form.querySelector('[data-editor-group]').disabled=busy||!person.requireGroup;
    form.querySelector('[type="submit"]').disabled=busy||!complete||Boolean(same);cancel.disabled=busy;form.setAttribute('aria-busy',String(busy));
  };
  const cleanup=()=>{
    if(disposed)return;disposed=true;
    form.removeEventListener('change',change);form.removeEventListener('submit',submit);cancel.removeEventListener('click',close);dialog.removeEventListener('cancel',close);
    if(dialog.open)dialog.close();dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});
  };
  const close=event=>{event.preventDefault();if(!busy)cleanup();};
  const change=event=>{event.stopPropagation();feedback.textContent='';feedback.classList.remove('year-end-feedback--error');feedback.setAttribute('role','status');paint();};
  const submit=async event=>{
    event.preventDefault();event.stopPropagation();if(!active()||busy||!form.reportValidity())return;
    const input=selection();busy=true;feedback.textContent='Salvando escolhas…';paint();
    try{const result=await save(input);if(!active())return;cleanup();onSaved(result);}
    catch(error){if(active()){feedback.textContent=yearEndMessage(error);feedback.classList.add('year-end-feedback--error');feedback.setAttribute('role','alert');}}
    finally{busy=false;if(active())paint();}
  };
  for(const input of form.querySelectorAll('input'))input.checked=(input.name!=='grupo'||person.requireGroup)&&record?.[input.name]===input.value;
  form.addEventListener('change',change);form.addEventListener('submit',submit);cancel.addEventListener('click',close);dialog.addEventListener('cancel',close);
  root.append(dialog);paint();dialog.showModal();return cleanup;
}
