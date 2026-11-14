import {onAuthStateChanged} from 'firebase/auth';
import {doc, getDocFromServer} from 'firebase/firestore';
import {getFunctionalFirestore} from './functional-firebase.js';
import {getFunctionalAuth} from './functional-firebase.js';
import {waitForGoogleProjectSession} from './google-project-auth-runtime.js';
import {refreshFunctionalOverview,readFunctionalTeamOverview} from './functional-client.js';
import {listFunctionalTeam} from './functional-access.js';
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

export async function mountFunctionalModule(root, {uid, faAuth, administrator = false, isCurrent = () => true, onSessionRequired = () => {}} = {}) {
  let disposed = false;
  let stopAuth = () => {};
  const expanded = new Set();
  let subjectRevision = 0, selection = '', roster = [], loadingRoster = false, ownSources = {}, ownStatus = '';
  const current = () => !disposed && isCurrent() && faAuth?.currentUser?.uid === uid;
  const ownSession = () => current() && getFunctionalAuth()?.currentUser?.uid === uid;
  const paint = markup => { if (current() && root?.isConnected) root.innerHTML = markup; };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    stopAuth();
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
    root?.removeEventListener('click', onFunctionalClick);
    root?.removeEventListener('change', onSubjectChange);
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
    ownSources={...(profile?.sources||{})};
    ownStatus='Atualizando seus dados…';
    const selector=administrator?'<div class="functional-team"><button class="secondary-button" type="button" data-fk-team aria-expanded="false" aria-controls="fk-team-picker">Selecionar integrante da Equipe</button>'
      + '<div id="fk-team-picker" data-fk-picker hidden><label for="fk-team-subject">Integrante da Equipe</label>'
      + '<select id="fk-team-subject" data-fk-subject disabled><option value="">Meu perfil</option></select><p data-fk-team-status role="status"></p></div>'
      + '<h2 data-fk-owner>Meu perfil</h2></div>':'';
    paint('<section class="functional-page">'+selector+'<div data-fk-sources>'+sourceCards(ownSources,expanded)+'</div>'
      + '<p class="functional-status" data-fk-refresh-status role="status">'+ownStatus+'</p>'
      + '</section>');
    root.addEventListener('click', onFunctionalClick);
    if(administrator)root.addEventListener('change', onSubjectChange);
    void updateOverview(db);
  } catch {
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
    paint('<section class="functional-page"><p class="empty-state" role="status">Não foi possível confirmar sua autorização em FA e abrir seu perfil individual em FK. Tente novamente mais tarde.</p></section>');
  }
  return cleanup;

  async function updateOverview(db) {
    let refreshFailed=false;
    try {
      await refreshFunctionalOverview({faAuth,uid,isCurrent:ownSession});
      if(!ownSession())return;
      const updated=await getDocFromServer(doc(db,'functionalProfiles',uid));
      if(ownSession()&&updated.exists()){
        const profile=updated.data();
        if(profile.uid!==uid)throw new Error('FK_PROFILE_UID_MISMATCH');
        ownSources={...(profile.sources||{})};
      }
    } catch {refreshFailed=true;}
    if(!ownSession())return;
    ownStatus=refreshFailed?'As fontes não puderam ser atualizadas agora. Os últimos dados disponíveis permanecem exibidos.':'';
    if(!selection)renderOverview(ownSources,ownStatus);
  }

  function renderOverview(sources,statusText) {
    const host=root.querySelector('[data-fk-sources]');
    if(host){
      const focused = host.ownerDocument?.activeElement?.dataset.fkSource;
      host.innerHTML=sources?sourceCards(sources,expanded):'';
      if(focused)host.querySelector('[data-fk-source="'+focused+'"]')?.focus({preventScroll:true});
    }
    const status=root.querySelector('[data-fk-refresh-status]');
    if(status)status.textContent=statusText;
  }

  async function openTeamPicker(button) {
    const picker=root.querySelector('[data-fk-picker]');
    if(!picker)return;
    picker.hidden=!picker.hidden;
    button.setAttribute('aria-expanded',String(!picker.hidden));
    if(picker.hidden)return;
    const select=picker.querySelector('[data-fk-subject]');
    const status=picker.querySelector('[data-fk-team-status]');
    if(!select.disabled){select.focus();return;}
    if(loadingRoster)return;
    loadingRoster=true;
    status.textContent='Carregando integrantes…';
    try {
      const members=await listFunctionalTeam();
      if(!ownSession())return;
      roster=members;
      select.innerHTML='<option value="">Meu perfil</option>'+roster.map(member=>
        '<option value="'+escapeHtml(member.uid)+'">'+escapeHtml(member.name)+'</option>').join('');
      select.disabled=false;
      status.textContent=roster.length?'':'Nenhum integrante ativo da Equipe foi encontrado.';
      if(!picker.hidden)select.focus();
    } catch {
      if(ownSession())status.textContent='Não foi possível carregar a Equipe. Feche e abra a seleção para tentar novamente.';
    } finally {loadingRoster=false;}
  }

  async function onSubjectChange(event) {
    if(!event.target.matches('[data-fk-subject]')||!administrator||!ownSession())return;
    const value=event.target.value;
    const member=roster.find(row=>row.uid===value);
    if(value&&!member)return;
    const revision=++subjectRevision;
    selection=value;
    expanded.clear();
    root.querySelector('[data-fk-owner]').textContent=member?.name||'Meu perfil';
    if(!member){renderOverview(ownSources,ownStatus);return;}
    renderOverview(null,'Carregando perfil funcional…');
    const isSelected=()=>ownSession()&&revision===subjectRevision;
    try {
      const profile=await readFunctionalTeamOverview({faAuth,uid,subjectUid:member.uid,isCurrent:isSelected});
      if(!isSelected())return;
      renderOverview(profile?.sources||null,profile?'':'Este integrante ainda não tem um perfil funcional salvo.');
    } catch (error) {
      if(!isSelected())return;
      renderOverview(null,error?.message==='FK_TEAM_ACCESS_DENIED'
        ?'O acesso a este perfil não foi autorizado.'
        :'Não foi possível carregar este perfil agora. Troque a seleção e volte a este integrante para tentar novamente.');
    }
  }

  function onFunctionalClick(event) {
    const teamButton=event.target.closest('[data-fk-team]');
    if(teamButton&&administrator&&ownSession()){void openTeamPicker(teamButton);return;}
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
