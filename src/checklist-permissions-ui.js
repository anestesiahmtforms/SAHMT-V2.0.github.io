const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keys=[['checklistRead','Consultar Checklist'],['checklistWrite','Registrar conferências'],['checklistSign','Dar ciência diária'],['checklistManage','Gerenciar arsenais']];
export async function loadChecklistPermissionDirectory(container,{actorUid,load,save,isCurrent}){
  const current=()=>container.isConnected&&isCurrent();
  if(!current())return;container.innerHTML='<p role="status">Consultando permissões de Checklist…</p>';
  try{
    const profiles=await load(actorUid);if(!current())return;
    container.innerHTML=profiles.map(profile=>{
      const admin=profile.role==='administrador_app'||profile.permissions?.admin===true,disabled=profile.uid===actorUid||admin;
      return `<article class="user-profile-row" data-fg-checklist-user="${esc(profile.uid)}"><strong>${esc(profile.displayName||profile.email||profile.uid)}</strong><small>${esc(profile.email)}</small><fieldset><legend>Permissões de Checklist</legend>${keys.map(([key,title])=>`<label class="permission-option"><input type="checkbox" data-fg-checklist-key="${key}" ${admin||profile.permissions?.[key]===true?'checked':''} ${disabled?'disabled':''}><span>${title}</span></label>`).join('')}</fieldset><button type="button" class="secondary-button" data-fg-checklist-save="${esc(profile.uid)}" ${disabled?'disabled':''}>Salvar permissões</button><small data-fg-checklist-status>${admin?'Administradores mantêm acesso completo ao Checklist.':disabled?'Peça a outro administrador para alterar suas permissões.':'As alterações afetam apenas o Checklist.'}</small></article>`;
    }).join('')||'<p>Nenhum perfil disponível.</p>';
    container.querySelectorAll('[data-fg-checklist-save]').forEach(button=>button.addEventListener('click',async()=>{
      if(!current())return;const row=button.closest('[data-fg-checklist-user]'),uid=button.dataset.fgChecklistSave,status=row?.querySelector('[data-fg-checklist-status]');
      if(!row||uid===actorUid)return;const permissions=Object.fromEntries([...row.querySelectorAll('[data-fg-checklist-key]')].map(input=>[input.dataset.fgChecklistKey,input.checked]));
      button.disabled=true;if(status)status.textContent='Salvando…';
      try{await save(uid,permissions,actorUid);if(current())await loadChecklistPermissionDirectory(container,{actorUid,load,save,isCurrent});}
      catch(_){if(current()){button.disabled=false;if(status)status.textContent='Não foi possível salvar. Confira seu acesso e tente novamente.';}}
    }));
  }catch(_){if(current())container.innerHTML='<p role="alert">Não foi possível consultar as permissões de Checklist. Tente novamente.</p>';}
}
