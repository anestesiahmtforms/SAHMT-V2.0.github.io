import {doc, getDocFromServer} from 'firebase/firestore';
import {getFunctionalFirestore} from './functional-firebase.js';
import {getFunctionalAuth} from './functional-firebase.js';
import {confirmGoogleProjectAccess,currentGoogleProjectIdentity,googleProjectClientId,getGoogleProjectAuth,waitForGoogleProjectSession} from './google-project-auth-runtime.js';
import {createGoogleProjectAuthGoogleButton} from './google-project-auth-google-button.js';
import {safeGoogleAuthCode} from './google-project-auth-core.js';
import {refreshFunctionalOverview} from './functional-client.js';
import {bindSurveySession} from './survey-session-bridge.js';
import {callFunctionalSurvey} from './functional-survey-client.js';
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
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const authMessages=Object.freeze({
  AUTH_GOOGLE_IDENTITY_MISMATCH:'Escolha a mesma conta Google já autenticada no SAHMT.',
  AUTH_EXISTING_ACCOUNT_REQUIRED:'A conta Google ainda não está habilitada no FK. Solicite a conferência ao administrador.',
  AUTH_UID_MISMATCH:'A conta do FK não corresponde ao mesmo UID do SAHMT.',
  AUTH_CONFIGURATION_REQUIRED:'A autenticação Google do FK ainda não está configurada.',
  'auth/unauthorized-domain':'O domínio do SAHMT ainda não está autorizado no FK.',
  'auth/network-request-failed':'Sem conexão com a internet. Tente novamente.'
});

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
  let surveyCleanup;
  let googleButton;
  const current = () => !disposed && isCurrent() && faAuth?.currentUser?.uid === uid;
  const paint = markup => { if (current() && root?.isConnected) root.innerHTML = markup; };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
    surveyCleanup?.();
    googleButton?.dispose();googleButton=null;
    root?.removeEventListener('click', onSurveyClick);
  };
  activeFunctionalMountCleanup?.();
  activeFunctionalMountCleanup = cleanup;
  paint('<section class="functional-page"><h2>Funcional</h2><p role="status">Confirmando o acesso individual em FK…</p></section>');
  try {
    const fkAuth=getFunctionalAuth();
    let connected=await waitWithTimeout(waitForGoogleProjectSession('FK',{isCurrent:current}),30000,'FK_AUTH_CLIENT_TIMEOUT');
    if(!connected&&current())connected=await waitWithTimeout(connectFunctionalGoogle(root,fkAuth,uid,current,paint,value=>{googleButton=value;}),120000,'FK_AUTH_CONFIRM_TIMEOUT');
    if(!connected||fkAuth?.currentUser?.uid!==uid)throw new Error('FK_AUTH_UID_MISMATCH');
    if (!current()) return cleanup;
    paint('<section class="functional-page"><h2>Funcional</h2><p role="status">Acesso confirmado. Carregando seu perfil funcional…</p></section>');
    let refreshFailed = false;
    try { await waitWithTimeout(refreshFunctionalOverview({faAuth,uid,isCurrent:current}), 50000, 'FK_REFRESH_CLIENT_TIMEOUT'); }
    catch { refreshFailed = true; }
    if (!current()) return cleanup;
    const db = getFunctionalFirestore();
    if (!db) throw new Error('FK_FIRESTORE_UNAVAILABLE');
    const snapshot = await waitWithTimeout(getDocFromServer(doc(db, 'functionalProfiles', uid)), 20000, 'FK_PROFILE_READ_TIMEOUT');
    if (!current()) return cleanup;
    const profile = snapshot.exists() ? snapshot.data() : null;
    const sources={...(profile?.sources||{})};
    if(profile){
    await Promise.all(['climate','stress','epidemiological'].map(async survey=>{
        try{
          const participation=await waitWithTimeout(getDocFromServer(doc(db,'surveyParticipation',uid+'_'+survey+'_2026')),12000,'FK_PARTICIPATION_READ_TIMEOUT');
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
      + '</section>');
    root.addEventListener('click', onSurveyClick);
  } catch {
    googleButton?.dispose();googleButton=null;
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
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

function connectFunctionalGoogle(root,fkAuth,uid,isCurrent,paint,setWidget){
  return new Promise(resolve=>{
    let settled=false;
    let widget=null;
    const dispose=()=>{widget?.dispose();widget=null;setWidget(null);};
    const finish=value=>{if(settled)return;settled=true;dispose();resolve(value);};
    paint('<section class="functional-page"><h2>Funcional</h2><p>Para abrir o FK com o mesmo UID, confirme a conta Google já autenticada no SAHMT.</p><div class="functional-google-auth" role="group" aria-label="Confirmar conta Google para o FK"></div><p class="functional-google-auth-status" role="status">Aguardando sua confirmação Google…</p></section>');
    if(!isCurrent()||!fkAuth){finish(false);return;}
    const host=root.querySelector('.functional-google-auth');
    const status=root.querySelector('.functional-google-auth-status');
    if(!host||!status){finish(false);return;}
    try{
      widget=createGoogleProjectAuthGoogleButton({clientId:googleProjectClientId,
        getExpectedIdentity:currentGoogleProjectIdentity,
        onCredential:async credential=>{
          try{
            await confirmGoogleProjectAccess(credential);
            const ready=await waitForGoogleProjectSession('FK',{isCurrent});
            finish(Boolean(ready&&isCurrent()&&fkAuth.currentUser?.uid===uid));
          }catch(error){if(isCurrent()&&status.isConnected)status.textContent=authMessages[safeGoogleAuthCode(error)]||'Não foi possível conectar ao FK. Confira se selecionou a mesma conta Google.';}
        },
        onLoading:busy=>{if(isCurrent()&&status.isConnected)status.textContent=busy?'Confirmando a conta Google…':'Aguardando sua confirmação Google…';},
        onError:error=>{if(isCurrent()&&status.isConnected)status.textContent=authMessages[safeGoogleAuthCode(error)]||'Não foi possível confirmar a conta Google. Tente novamente.';}
      });
      setWidget({dispose});
      widget.render(host).catch(error=>{
        if(isCurrent()&&status.isConnected)status.textContent=authMessages[safeGoogleAuthCode(error)]||'O botão Google não pôde ser carregado.';
      });
    }catch(error){status.textContent=authMessages[safeGoogleAuthCode(error)]||'A autenticação Google do FK não pôde ser preparada.';}
    setTimeout(()=>finish(false),120000);
  });
}
