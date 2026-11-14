import {onAuthStateChanged} from 'firebase/auth';
import {doc, getDocFromServer} from 'firebase/firestore';
import {getFunctionalFirestore} from './functional-firebase.js';
import {getFunctionalAuth} from './functional-firebase.js';
import {waitForGoogleProjectSession} from './google-project-auth-runtime.js';
import {refreshFunctionalOverview} from './functional-client.js';
import {operationalContentAllowed,operationalFolderNotice} from './operational-folder-runtime.js';

let activeFunctionalMountCleanup = null;
const waitWithTimeout = (promise, milliseconds, code) => {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), milliseconds);
  })]).finally(() => clearTimeout(timer));
};

const sourceLabels = Object.freeze({
  performance: 'Desempenho',
  professionalRegistration: 'Cadastro Profissional',
  biosafetyManual: 'Biossegurança',
  vaccination: 'Vacinação',
  dosimetry: 'Dosimetria'
});
const sourceFolders = Object.freeze({
  performance:'funcional/desempenho',
  professionalRegistration:'funcional/cadastro-profissional',
  biosafetyManual:'funcional/biosseguranca/manual',
  vaccination:'funcional/biosseguranca/vacinacao',
  dosimetry:'funcional/biosseguranca/dosimetria'
});
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const sourceIcons = {
  performance: 'M4 20h16M7 16v-4m5 4V8m5 8V4',
  professionalRegistration: 'M5 4h14v16H5zM8 9h8m-8 4h8m-8 4h5',
  biosafetyManual: 'M12 3l7 3v5c0 4-3 7-7 10-4-3-7-6-7-10V6zM9 12l2 2 4-4',
  vaccination: 'M12 5v14M5 12h14',
  dosimetry: 'M4 13h4l2-6 4 10 2-4h4',
};
const sourceIcon = key => '<svg class="functional-tile-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+(sourceIcons[key]||sourceIcons.professionalRegistration)+'"/></svg>';

function sourceCards(sources, expanded) {
  const entries = {performance:{state:'PREPARING'}, ...sources};
  const keys = Object.keys(entries).filter(key=>sourceFolders[key]&&operationalContentAllowed(sourceFolders[key]))
    .sort((a,b) => Number(b==='performance') - Number(a==='performance') || sourceLabels[a].localeCompare(sourceLabels[b], 'pt-BR'));
  const states = {READY:'Dados sincronizados', PREPARING:'Em preparação', SESSION_REQUIRED:'Autenticação necessária', UNAVAILABLE:'Temporariamente indisponível'};
  if (!keys.length) return '<p class="empty-state">Nenhuma pasta funcional está disponível.</p>';
  return '<div class="functional-source-grid">' + keys.map(key => {
    const value = entries[key], open = expanded.has(key);
    return '<div class="functional-source"><button class="functional-tile" type="button" data-fk-source="'+key+'" aria-controls="fk-source-'+key+'" aria-expanded="'+open+'">'
      + sourceIcon(key) + '<span><strong>'+escapeHtml(sourceLabels[key])+'</strong><small>'+escapeHtml(states[value?.state]||'Status não informado')+'</small></span>'
      + '<span class="functional-chevron" aria-hidden="true">›</span></button><div class="functional-source-detail" id="fk-source-'+key+'"'+(open?'':' hidden')+'>'
      + '<p>'+escapeHtml(sourceDetail(key,value))+'</p></div>'+operationalFolderNotice(sourceFolders[key])+'</div>';
  }).join('') + '</div>';
}

function sourceDetail(key,value) {
  if(value?.state==='PREPARING')return key==='performance'?'A consulta será disponibilizada quando a integração de desempenho for definida.':'A integração desta pasta está em preparação.';
  if(value?.state!=='READY')return 'Nenhum dado individual foi confirmado nesta atualização.';
  if(key==='professionalRegistration')return value.data?.record?'Cadastro profissional localizado.':'Nenhum cadastro profissional individual localizado.';
  return 'Resumo individual atualizado.';
}

export async function mountFunctionalModule(root, {uid, faAuth, isCurrent = () => true, onSessionRequired = () => {}} = {}) {
  let disposed = false;
  let stopAuth = () => {};
  const expanded = new Set();
  const current = () => !disposed && isCurrent() && faAuth?.currentUser?.uid === uid;
  const ownSession = () => current() && getFunctionalAuth()?.currentUser?.uid === uid;
  const paint = markup => { if (current() && root?.isConnected) root.innerHTML = markup; };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    stopAuth();
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
    root?.removeEventListener('click', onFunctionalClick);
  };
  activeFunctionalMountCleanup?.();
  activeFunctionalMountCleanup = cleanup;
  paint('<section class="functional-page"><p role="status">Confirmando o acesso individual em FK…</p></section>');
  try {
    const fkAuth=getFunctionalAuth();
    const connected=await waitWithTimeout(waitForGoogleProjectSession('FK',{isCurrent:current}),30000,'FK_AUTH_CLIENT_TIMEOUT');
    if(!connected){if(current())onSessionRequired();return cleanup;}
    if(fkAuth?.currentUser?.uid!==uid)throw new Error('FK_AUTH_UID_MISMATCH');
    if (!current()) return cleanup;
    stopAuth = onAuthStateChanged(fkAuth, user => {
      if (disposed || user?.uid === uid) return;
      paint('<section class="functional-page"><p role="status">Confirme sua sessão para consultar seu perfil funcional.</p></section>');
      cleanup();
    });
    paint('<section class="functional-page"><p role="status">Acesso confirmado. Carregando seu perfil funcional…</p></section>');
    const db = getFunctionalFirestore();
    if (!db) throw new Error('FK_FIRESTORE_UNAVAILABLE');
    // The first snapshot may not exist yet (rules reject reads of absent documents).
    const snapshot = await waitWithTimeout(getDocFromServer(doc(db, 'functionalProfiles', uid)), 20000, 'FK_PROFILE_READ_TIMEOUT').catch(()=>null);
    if (!ownSession()) return cleanup;
    const profile = snapshot?.exists() ? snapshot.data() : null;
    if (profile && profile.uid !== uid) throw new Error('FK_PROFILE_UID_MISMATCH');
    const sources={...(profile?.sources||{})};
    paint('<section class="functional-page"><div data-fk-sources>'+sourceCards(sources,expanded)+'</div>'
      + '<p class="functional-status" data-fk-refresh-status role="status">Atualizando seus dados…</p>'
      + '</section>');
    root.addEventListener('click', onFunctionalClick);
    void updateOverview(db,sources);
  } catch {
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
    paint('<section class="functional-page"><p class="empty-state" role="status">Não foi possível confirmar sua autorização em FA e abrir seu perfil individual em FK. Tente novamente mais tarde.</p></section>');
  }
  return cleanup;

  async function updateOverview(db,sources) {
    let refreshFailed=false;
    try {
      await refreshFunctionalOverview({faAuth,uid,isCurrent:ownSession});
      if(!ownSession())return;
      const updated=await getDocFromServer(doc(db,'functionalProfiles',uid));
      if(ownSession()&&updated.exists()){
        const profile=updated.data();
        if(profile.uid!==uid)throw new Error('FK_PROFILE_UID_MISMATCH');
        Object.assign(sources,profile.sources||{});
      }
    } catch {refreshFailed=true;}
    if(!ownSession())return;
    const host=root.querySelector('[data-fk-sources]');
    if(host){
      const focused = host.ownerDocument?.activeElement?.dataset.fkSource;
      host.innerHTML=sourceCards(sources,expanded);
      if(focused)host.querySelector('[data-fk-source="'+focused+'"]')?.focus({preventScroll:true});
    }
    const status=root.querySelector('[data-fk-refresh-status]');
    if(status)status.textContent=refreshFailed?'As fontes não puderam ser atualizadas agora. Os últimos dados disponíveis permanecem exibidos.':'';
  }

  function onFunctionalClick(event) {
    const sourceButton = event.target.closest('[data-fk-source]');
    if(sourceButton && ownSession()){
      const key = sourceButton.dataset.fkSource;
      const detail = root.querySelector('#fk-source-'+key);
      if(!detail)return;
      const open = !expanded.has(key);
      if(open)expanded.add(key);else expanded.delete(key);
      sourceButton.setAttribute('aria-expanded',String(open));
      detail.hidden = !open;
      return;
    }
  }
}
