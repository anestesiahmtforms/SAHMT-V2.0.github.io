import {trainingParticipationState} from './training-participation-state.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function inspectionActivitiesForUser(activities,profile){
  if(!profile?.active || !profile.access)return [];
  const admin=profile.role==='administrador_app' || profile.permissions?.admin===true;
  return activities.filter(activity=>activity.active===true && (admin || activity.eligibleUids?.includes(profile.uid) || activity.eligibleGroups?.some(group=>profile.documentGroups?.includes(group))));
}
/** Read-only inspection, never Firebase impersonation or a substituted actor. */
export async function openAdministrativeUserInspection({actorUid,subjectUid,isCurrent,root=document,services,permissionLabels={}}) {
  const data=services || await import('./evaluation-data.js');
  const profile=await data.readAdministrativeUser(actorUid,subjectUid);
  if (!isCurrent()) return () => {};
  const activities=inspectionActivitiesForUser(await data.listEvaluationActivities(actorUid),profile);
  if (!isCurrent()) return () => {};
  const dialog=root.createElement('dialog');dialog.className='admin-inspection';
  dialog.innerHTML=`<header><h2>CONSULTA DO USUÁRIO</h2><p>${escape(profile.displayName)}</p></header><section><p class="inspection-banner">Consulta administrativa · sua sessão continua sendo a do administrador. Nenhuma ação será realizada no nome desta pessoa.</p><p>${profile.active&&profile.access?'Acesso ativo':'Acesso bloqueado'} · ${escape(profile.role)}</p><details><summary>Permissões do perfil</summary><ul>${Object.entries(profile.permissions).filter(([,v])=>v===true).map(([key])=>`<li>${escape(permissionLabels[key] || key)}</li>`).join('')}</ul></details><h3>Treinamentos</h3><div data-inspection-training>Carregando progresso…</div><p>Para consultar saldo e lançamentos, use “Consultar pessoa” em Desempenho. Conteúdos privados continuam sujeitos às permissões administrativas e de auditoria existentes.</p></section><footer><button type="button" class="secondary-button">VOLTAR</button></footer>`;
  root.body.append(dialog);let stop=()=>{},closed=false;
  const close=()=>{if(closed)return;closed=true;stop();dialog.close();dialog.remove();};
  dialog.querySelector('button').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.showModal();
  stop=data.watchTrainingParticipation({actorUid,subjectUid,activityIds:activities.map(row=>row.id),onData(snapshot){
    if(closed || !isCurrent()){close();return;}
    if(snapshot.confirmed!==true){dialog.querySelector('[data-inspection-training]').textContent='Aguardando confirmação do progresso no servidor.';return;}
    dialog.querySelector('[data-inspection-training]').innerHTML=`<ul>${snapshot.activities.map(activity=>{
      const state=trainingParticipationState(activity,snapshot.participations,{uid:subjectUid});
      return `<li><strong>${escape(activity.title || activity.id)}</strong><br>${escape(state.label)} · versão ${escape(activity.version)}</li>`;
    }).join('')}</ul>`;
  },onError(){if(!closed)dialog.querySelector('[data-inspection-training]').textContent='Não foi possível confirmar o progresso. Verifique o acesso administrativo.';}});
  return close;
}
