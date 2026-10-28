import {requestSurveySession} from '../src/survey-session-bridge.js';
export const identifyInstitutionalGroup=()=>requestSurveySession({action:'BOOTSTRAP'});
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
   host.querySelector('[role=status]').textContent=error.message==='OPEN_FROM_APP'?'Abra esta pesquisa pelo app SAHMT, em Enquetes e Consultas → Pesquisas institucionais.':'Não foi possível confirmar seu grupo no cadastro. Volte ao app e tente novamente ou solicite a revisão do cadastro ao administrador.';
  }
 })();
}
