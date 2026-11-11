import {doc, getDocFromServer} from 'firebase/firestore';
import {getFunctionalFirestore} from './functional-firebase.js';
import {signOutFunctionalProject} from './functional-firebase.js';
import {createFunctionalAuthBridge} from './functional-auth-bridge.js';
import {refreshFunctionalOverview} from './functional-client.js';
import {bindSurveySession} from './survey-session-bridge.js';
import {callFunctionalSurvey} from './functional-survey-client.js';
import './functional-ui.css';

const sourceLabels = Object.freeze({
  performance: 'Desempenho - SAHMT',
  professionalRegistration: 'Cadastro Profissional - SAHMT',
  epidemiological: 'Cadastro Epidemiológico - SAHMT',
  fe: 'Enquetes e Consultas institucionais',
  climateSurvey: 'Pesquisa de Clima Organizacional',
  stressFatigue: 'Avaliação de Estresse e Fadiga',
  biosafetyManual: 'Biossegurança',
  vaccination: 'Vacinação',
  dosimetry: 'Dosimetria'
});
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function sourceCards(sources) {
  const keys = Object.keys(sources || {}).sort((a,b) => (sourceLabels[a] || a).localeCompare(sourceLabels[b] || b, 'pt-BR'));
  if (!keys.length) return '<p class="empty-state">Os dados funcionais ainda não foram sincronizados para este usuário.</p>';
  const stateText = value => {
    if (value?.state === 'READY') return 'Dados sincronizados';
    if (value?.state === 'PREPARING') return 'Integração em preparação';
    if (value?.state === 'SESSION_REQUIRED') return 'Autenticação necessária';
    if (value?.state === 'UNAVAILABLE') return 'Fonte temporariamente indisponível';
    return 'Status não informado';
  };
  return '<div class="functional-source-grid">' + keys.map(key => '<article class="functional-source-card"><h3>'
    + escapeHtml(sourceLabels[key] || key) + '</h3><p>' + escapeHtml(stateText(sources[key])) + '</p>'
    + '<small>' + escapeHtml(sourceDetail(key,sources[key])) + '</small></article>').join('') + '</div>';
}

function sourceDetail(key,value) {
  if(value?.state==='PREPARING')return 'A origem ainda não foi migrada para FK.';
  if(value?.state!=='READY')return 'Nenhum dado individual foi confirmado nesta atualização.';
  if(key==='professionalRegistration')return value.data?.record?'Cadastro profissional localizado.':'Nenhum cadastro profissional individual localizado.';
  if(['climateSurvey','stressFatigue','epidemiological'].includes(key))return value.data?.participated?'Participação registrada; respostas não são exibidas.':'Sem participação registrada para o ciclo consultado.';
  if(key==='fe')return 'Resumo de participação institucional atualizado.';
  return 'Resumo individual atualizado.';
}

export async function mountFunctionalModule(root, {uid, faAuth, group='EQUIPE', isCurrent = () => true} = {}) {
  let disposed = false;
  let performanceCleanup, surveyCleanup;
  const current = () => !disposed && isCurrent() && faAuth?.currentUser?.uid === uid;
  const paint = markup => { if (current() && root?.isConnected) root.innerHTML = markup; };
  let bridge;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    performanceCleanup?.();
    surveyCleanup?.();
    root?.removeEventListener('click', onSurveyClick);
    bridge?.dispose();
    void signOutFunctionalProject(uid).catch(() => {});
  };
  paint('<section class="functional-page"><h2>Funcional</h2><p role="status">Confirmando o acesso individual em FK…</p></section>');
  try {
    bridge = createFunctionalAuthBridge({enabled: true,
      endpoint: import.meta.env.VITE_FK_AUTH_BRIDGE_ENDPOINT,
      allowedOrigin: import.meta.env.VITE_FK_AUTH_ORIGIN,
      fetchImpl: globalThis.fetch?.bind(globalThis)});
    await bridge.connect(faAuth);
    if (!current()) return cleanup;
    let refreshFailed = false;
    try { await refreshFunctionalOverview({faAuth,uid,isCurrent:current}); }
    catch { refreshFailed = true; }
    if (!current()) return cleanup;
    const db = getFunctionalFirestore();
    if (!db) throw new Error('FK_FIRESTORE_UNAVAILABLE');
    const snapshot = await getDocFromServer(doc(db, 'functionalProfiles', uid));
    if (!current()) return cleanup;
    const profile = snapshot.exists() ? snapshot.data() : null;
    const sources={...(profile?.sources||{})};
    if(profile){
    await Promise.all(['climate','stress','epidemiological'].map(async survey=>{
        try{
          const participation=await getDocFromServer(doc(db,'surveyParticipation',uid+'_'+survey+'_2026'));
          const key=survey==='climate'?'climateSurvey':survey==='stress'?'stressFatigue':'epidemiological';
          sources[key]={state:'READY',data:{participated:participation.exists()}};
        }catch{}
      }));
    }
    paint('<section class="functional-page"><header><p class="eyebrow">ACESSO INDIVIDUAL</p><h2>Funcional</h2>'
      + '<p>Seu perfil é acessado pelo mesmo UID autenticado em FA.</p></header>'
      + (refreshFailed ? '<p class="empty-state" role="status">Não foi possível atualizar as fontes agora. Exibindo o último snapshot salvo, se disponível.</p>' : '')
      + (profile ? sourceCards(sources) : '<p class="empty-state">Aguardando os primeiros dados funcionais deste usuário.</p>')
      + '<section class="functional-survey"><h3>Pesquisas institucionais</h3><p>As respostas enviadas por este módulo pertencem ao projeto FK.</p>'
      + (import.meta.env.VITE_FK_INSTITUTIONAL_SURVEYS_ENABLED === 'true'&&['EQUIPE','ADMINISTRADOR'].includes(group)
        ? '<div class="functional-survey-actions"><button type="button" data-fk-survey="climate">PESQUISA DE CLIMA ORGANIZACIONAL</button><button type="button" data-fk-survey="stress">AVALIAÇÃO DE ESTRESSE E FADIGA</button><button type="button" data-fk-survey="epidemiological">CADASTRO EPIDEMIOLÓGICO - SAHMT</button></div><div data-fk-survey-frame></div>'
        : ['EQUIPE','ADMINISTRADOR'].includes(group)?'<p class="empty-state" role="status">Os formulários estão sendo migrados para o armazenamento próprio do FK.</p>':'')
      + '</section>'
      + (import.meta.env.VITE_FK_PERFORMANCE_ENABLED === 'true' && import.meta.env.VITE_FK_PERFORMANCE_ENDPOINT ? '<section class="functional-performance"><h3>Desempenho - SAHMT</h3><div data-fk-performance></div></section>' : '')
      + '</section>');
    root.addEventListener('click', onSurveyClick);
    if (import.meta.env.VITE_FK_PERFORMANCE_ENABLED === 'true' && import.meta.env.VITE_FK_PERFORMANCE_ENDPOINT) {
      const [{mountSahmtPerformance},{callSahmtPerformanceApi}]=await Promise.all([import('./sahmt-performance-ui.js'),import('./sahmt-performance-api.js')]);
      if (!current()) return cleanup;
      const target=root.querySelector('[data-fk-performance]');
      if(target)performanceCleanup=mountSahmtPerformance(target,{request:(action,input)=>callSahmtPerformanceApi({uid,isCurrent:current,action,input}),isCurrent:current});
    }
  } catch {
    paint('<section class="functional-page"><h2>Funcional</h2><p class="empty-state" role="status">Não foi possível confirmar sua autorização em FA e abrir seu perfil individual em FK. Tente novamente mais tarde.</p></section>');
  }
  return cleanup;

  function onSurveyClick(event) {
    const button=event.target.closest('[data-fk-survey]');
    if(!button||!current())return;
    const survey=button.dataset.fkSurvey;
    if(!['climate','stress','epidemiological'].includes(survey))return;
    const host=root.querySelector('[data-fk-survey-frame]');
    if(!host)return;
    surveyCleanup?.();surveyCleanup=null;
    if(survey==='epidemiological'){
      const panel=document.createElement('div');
      panel.className='functional-epidemiological-form';
      host.replaceChildren(panel);
      void import('./registration-ui.js').then(({mountInstitutionalRegistration})=>{
        if(!current()||!panel.isConnected)return;
        surveyCleanup=mountInstitutionalRegistration(panel,{kind:'epidemiological',isCurrent:current,
          request:(_kind,action,input,signal)=>callFunctionalSurvey({uid,faAuth,survey,action,response:action==='SUBMIT'?input:undefined,isCurrent:current,
            fetchImpl:async(url,options)=>{
              const controller=new AbortController();
              const abort=()=>controller.abort();
              signal?.addEventListener('abort',abort,{once:true});
              if(signal?.aborted)abort();
              try{return await fetch(url,{...options,signal:AbortSignal.any([controller.signal,options.signal])});}
              finally{signal?.removeEventListener('abort',abort);}
            }})});
      }).catch(()=>{if(current()&&panel.isConnected)panel.textContent='O formulário epidemiológico não pôde ser carregado.';});
      return;
    }
    const frame=document.createElement('iframe');
    frame.className='functional-survey-frame';
    frame.title=survey==='climate'?'Pesquisa de clima organizacional':'Avaliação de estresse e fadiga';
    frame.referrerPolicy='no-referrer';
    frame.sandbox='allow-scripts allow-same-origin allow-forms';
    host.replaceChildren(frame);
    surveyCleanup=bindSurveySession(frame,{feOrigin:window.location.origin,
      perform:(action,response)=>callFunctionalSurvey({uid,faAuth,survey,action,response,isCurrent:current}),isCurrent:current});
    frame.src=new URL(survey==='stress'?'enquetes/stress.html':'enquetes/',window.location.href).href;
  }
}
