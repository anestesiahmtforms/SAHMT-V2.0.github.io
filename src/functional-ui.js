import {doc, getDocFromServer} from 'firebase/firestore';
import {getFunctionalFirestore} from './functional-firebase.js';
import {getFunctionalAuth} from './functional-firebase.js';
import {waitForGoogleProjectSession} from './google-project-auth-runtime.js';
import {refreshFunctionalOverview} from './functional-client.js';
import {bindSurveySession} from './survey-session-bridge.js';
import {callFunctionalSurvey} from './functional-survey-client.js';
import {operationalContentAllowed,operationalFolderNotice} from './operational-folder-runtime.js';
import './functional-ui.css';

let activeFunctionalMountCleanup = null;
const waitWithTimeout = (promise, milliseconds, code) => {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), milliseconds);
  })]).finally(() => clearTimeout(timer));
};

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
const sourceFolders = Object.freeze({
  performance:'funcional/desempenho',
  professionalRegistration:'funcional/cadastro-profissional',
  epidemiological:'funcional/cadastro-epidemiologico',
  fe:'funcional/pesquisas-institucionais',
  climateSurvey:'funcional/pesquisas-institucionais/clima',
  stressFatigue:'funcional/pesquisas-institucionais/estresse-fadiga',
  biosafetyManual:'funcional/biosseguranca/manual',
  vaccination:'funcional/biosseguranca/vacinacao',
  dosimetry:'funcional/biosseguranca/dosimetria'
});
const surveyFolders = Object.freeze({
  climate:'funcional/pesquisas-institucionais/clima',
  stress:'funcional/pesquisas-institucionais/estresse-fadiga',
  epidemiological:'funcional/cadastro-epidemiologico'
});
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function sourceCards(sources) {
  const keys = Object.keys(sources || {}).filter(key=>sourceFolders[key]&&operationalContentAllowed(sourceFolders[key]))
    .sort((a,b) => (sourceLabels[a] || a).localeCompare(sourceLabels[b] || b, 'pt-BR'));
  if (!keys.length) return '<p class="empty-state">Não há dados sincronizados nas pastas funcionais ativas para este usuário.</p>';
  const stateText = value => {
    if (value?.state === 'READY') return 'Dados sincronizados';
    if (value?.state === 'PREPARING') return 'Integração em preparação';
    if (value?.state === 'SESSION_REQUIRED') return 'Autenticação necessária';
    if (value?.state === 'UNAVAILABLE') return 'Fonte temporariamente indisponível';
    return 'Status não informado';
  };
  return '<div class="functional-source-grid">' + keys.map(key => '<article class="functional-source-card"><h3>'
    + escapeHtml(sourceLabels[key] || key) + '</h3><p>' + escapeHtml(stateText(sources[key])) + '</p>'
    + '<small>' + escapeHtml(sourceDetail(key,sources[key])) + '</small>' + operationalFolderNotice(sourceFolders[key]) + '</article>').join('') + '</div>';
}

function sourceDetail(key,value) {
  if(value?.state==='PREPARING')return 'A origem ainda não foi migrada para FK.';
  if(value?.state!=='READY')return 'Nenhum dado individual foi confirmado nesta atualização.';
  if(key==='professionalRegistration')return value.data?.record?'Cadastro profissional localizado.':'Nenhum cadastro profissional individual localizado.';
  if(['climateSurvey','stressFatigue','epidemiological'].includes(key))return value.data?.participated?'Participação registrada; respostas não são exibidas.':'Sem participação registrada para o ciclo consultado.';
  if(key==='fe')return 'Resumo de participação institucional atualizado.';
  return 'Resumo individual atualizado.';
}

export async function mountFunctionalModule(root, {uid, faAuth, group='EQUIPE', isCurrent = () => true, onSessionRequired = () => {}} = {}) {
  let disposed = false;
  let surveyCleanup;
  const current = () => !disposed && isCurrent() && faAuth?.currentUser?.uid === uid;
  const paint = markup => { if (current() && root?.isConnected) root.innerHTML = markup; };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
    surveyCleanup?.();
    root?.removeEventListener('click', onSurveyClick);
  };
  activeFunctionalMountCleanup?.();
  activeFunctionalMountCleanup = cleanup;
  paint('<section class="functional-page"><h2>Funcional</h2><p role="status">Confirmando o acesso individual em FK…</p></section>');
  try {
    const fkAuth=getFunctionalAuth();
    const connected=await waitWithTimeout(waitForGoogleProjectSession('FK',{isCurrent:current}),30000,'FK_AUTH_CLIENT_TIMEOUT');
    if(!connected){if(current())onSessionRequired();return cleanup;}
    if(fkAuth?.currentUser?.uid!==uid)throw new Error('FK_AUTH_UID_MISMATCH');
    if (!current()) return cleanup;
    paint('<section class="functional-page"><h2>Funcional</h2><p role="status">Acesso confirmado. Carregando seu perfil funcional…</p></section>');
    const db = getFunctionalFirestore();
    if (!db) throw new Error('FK_FIRESTORE_UNAVAILABLE');
    // The first snapshot may not exist yet (rules reject reads of absent documents).
    // Forms use the confirmed session; snapshot generation must not gate entry.
    const snapshot = await waitWithTimeout(getDocFromServer(doc(db, 'functionalProfiles', uid)), 20000, 'FK_PROFILE_READ_TIMEOUT').catch(()=>null);
    if (!current()) return cleanup;
    const profile = snapshot?.exists() ? snapshot.data() : null;
    const sources={...(profile?.sources||{})};
    const surveyButtons=[['climate','PESQUISA DE CLIMA ORGANIZACIONAL'],['stress','AVALIAÇÃO DE ESTRESSE E FADIGA'],['epidemiological','CADASTRO EPIDEMIOLÓGICO - SAHMT']]
      .filter(([survey])=>operationalContentAllowed(surveyFolders[survey]));
    const surveysEnabled=operationalContentAllowed('funcional/pesquisas-institucionais');
    paint('<section class="functional-page"><header><p class="eyebrow">ACESSO INDIVIDUAL</p><h2>Funcional</h2>'
      + '<p>Seu perfil é acessado pelo mesmo UID autenticado em FA.</p></header>'
      + '<div data-fk-sources>'+(profile ? sourceCards(sources) : '<p class="empty-state">Aguardando os primeiros dados funcionais deste usuário.</p>')+'</div><p data-fk-refresh-status role="status">Atualizando os dados em segundo plano…</p>'
      + (surveysEnabled&&['EQUIPE','ADMINISTRADOR'].includes(group)?'<section class="functional-survey"><h3>Pesquisas institucionais</h3><p>As respostas enviadas por este módulo pertencem ao projeto FK.</p>'
        + (import.meta.env.VITE_FK_INSTITUTIONAL_SURVEYS_ENABLED === 'true'
          ? '<div class="functional-survey-actions">'+surveyButtons.map(([survey,label])=>'<div><button type="button" data-fk-survey="'+survey+'">'+label+'</button>'+operationalFolderNotice(surveyFolders[survey])+'</div>').join('')+'</div><div data-fk-survey-frame></div>'
          : '<p class="empty-state" role="status">Os formulários estão sendo migrados para o armazenamento próprio do FK.</p>')
        + '</section>':'')
      + '</section>');
    root.addEventListener('click', onSurveyClick);
    void updateOverview(db,sources);
  } catch {
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
    paint('<section class="functional-page"><h2>Funcional</h2><p class="empty-state" role="status">Não foi possível confirmar sua autorização em FA e abrir seu perfil individual em FK. Tente novamente mais tarde.</p></section>');
  }
  return cleanup;

  async function updateOverview(db,sources) {
    let refreshFailed=false;
    const participationSources={};
    await Promise.all([
      (async()=>{
        try {
          await refreshFunctionalOverview({faAuth,uid,isCurrent:current});
          if(!current())return;
          const updated=await getDocFromServer(doc(db,'functionalProfiles',uid));
          if(current()&&updated.exists())Object.assign(sources,updated.data().sources||{});
        } catch {refreshFailed=true;}
      })(),
      ...['climate','stress','epidemiological'].map(async survey=>{
        try {
          const participation=await waitWithTimeout(getDocFromServer(doc(db,'surveyParticipation',uid+'_'+survey+'_2026')),12000,'FK_PARTICIPATION_READ_TIMEOUT');
          if(!current())return;
          const key=survey==='climate'?'climateSurvey':survey==='stress'?'stressFatigue':'epidemiological';
          participationSources[key]={state:'READY',data:{participated:participation.exists()}};
        } catch {}
      })
    ]);
    if(!current())return;
    Object.assign(sources,participationSources);
    const host=root.querySelector('[data-fk-sources]');
    if(host)host.innerHTML=sourceCards(sources);
    const status=root.querySelector('[data-fk-refresh-status]');
    if(status)status.textContent=refreshFailed?'As fontes não puderam ser atualizadas agora. Os últimos dados disponíveis permanecem exibidos.':'';
  }

  function onSurveyClick(event) {
    const button=event.target.closest('[data-fk-survey]');
    if(!button||!current())return;
    const survey=button.dataset.fkSurvey;
    if(!Object.hasOwn(surveyFolders,survey)||!operationalContentAllowed(surveyFolders[survey]))return;
    const host=root.querySelector('[data-fk-survey-frame]');
    if(!host)return;
    surveyCleanup?.();surveyCleanup=null;
    const folderNotice=operationalFolderNotice(surveyFolders[survey]);
    if(survey==='epidemiological'){
      const panel=document.createElement('div');
      panel.className='functional-epidemiological-form';
      host.innerHTML=folderNotice;
      host.append(panel);
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
    host.innerHTML=folderNotice;
    host.append(frame);
    surveyCleanup=bindSurveySession(frame,{feOrigin:window.location.origin,
      perform:(action,response)=>callFunctionalSurvey({uid,faAuth,survey,action,response,isCurrent:current}),isCurrent:current});
    frame.src=new URL(survey==='stress'?'enquetes/stress.html':'enquetes/',window.location.href).href;
  }
}
