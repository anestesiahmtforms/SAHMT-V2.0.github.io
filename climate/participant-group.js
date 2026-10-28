import {callParticipantSurvey} from './participant-session.js';
export const identifyInstitutionalGroup=()=>callParticipantSurvey({action:'BOOTSTRAP'});
export function mountParticipantGate(host,form,onIdentified,{identify=identifyInstitutionalGroup}={}) {
 form.hidden=true;
 host.innerHTML='<p role="status" aria-live="polite">Preparando a pesquisa com seu cadastro do app…</p>';
 void (async()=>{
  try {
   const state=await identify();const group=state?.group;if(!['team','resident','substitute'].includes(group))throw Error('REGISTRY_UNAVAILABLE');
   if(!host.isConnected)return;
   const label={team:'Equipe',resident:'Residentes',substitute:'Substitutos'}[group];
   host.classList.add('participant-group-notice');
   host.innerHTML='<h2>Você acessou pelo grupo '+label+'</h2><p>Seus dados pessoais não serão exibidos neste ambiente. Os resultados são apresentados apenas de forma agregada por grupo. O controle de participação fica separado das respostas para impedir duplicidades.</p><p role="status" aria-live="polite"></p>';
   if(state.alreadyResponded===true){host.querySelector('[role=status]').textContent='Você já participou desta pesquisa neste ciclo. Não é possível enviar outra resposta.';return;}
   if(state.alreadyResponded!==false)throw Error('REGISTRY_UNAVAILABLE');onIdentified(group);form.hidden=false;
  } catch(error) {
   if(!host.isConnected)return;
   if(error.message==='NAVIGATING_TO_APP'){host.querySelector('[role=status]').textContent='Abrindo a pesquisa com sua sessão do app…';return;}
   if(error.message==='APP_SESSION_REQUIRED'){host.innerHTML='<p role="status">Abra o app SAHMT para recuperar seu login e acessar a pesquisa. Não é necessário outro login dentro do questionário.</p><a class="primary" href="https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/#/management-hub/institutional">Abrir app SAHMT</a>';return;}
   host.querySelector('[role=status]').textContent=error.message==='OPEN_FROM_APP'?'Abra esta pesquisa pelo app SAHMT, em Enquetes e Consultas → Pesquisas institucionais.':'Não foi possível confirmar seu grupo no cadastro. Volte ao app e tente novamente ou solicite a revisão do cadastro ao administrador.';
  }
 })();
}
