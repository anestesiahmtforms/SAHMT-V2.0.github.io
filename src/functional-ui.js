import {formatCalendarDuration,formatDisplayDateTime} from './date-format.js';
import {mountFunctionalDosimetryImport} from './functional-dosimetry-import.js';
import {mountFunctionalDosimetry} from './functional-dosimetry.js';
import {requestFunctionalDosimetry} from './functional-client.js';
import {onAuthStateChanged} from 'firebase/auth';
import {doc, getDocFromServer} from 'firebase/firestore';
import {getFunctionalFirestore} from './functional-firebase.js';
import {getFunctionalAuth} from './functional-firebase.js';
import {googleProjectAuth,waitForGoogleProjectSession} from './google-project-auth-runtime.js';
import {refreshFunctionalOverview,readFunctionalTeamOverview} from './functional-client.js';
import {listFunctionalTeam} from './functional-access.js';
import {renderOperationalFolderDirectory} from './operational-folder-directory.js';
import {operationalContentAllowed,operationalFolderNotice} from './operational-folder-runtime.js';
import {loadFunctionalResult,renderFunctionalResult,resultYears} from './functional-results.js';

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
  dosimetry: 'Dosimetria',
  vaccination: 'Histórico Vacinal',
  climate: 'Pesquisa de Clima Organizacional',
  stress: 'Avaliação de Estresse e Fadiga',
  epidemiological: 'Cadastro Epidemiológico',
  notifications: 'Notificações'
});
const sourceFolders = Object.freeze({
  performance:'funcional/desempenho',
  professionalRegistration:'funcional/cadastro-profissional',
  vaccination:'funcional/biosseguranca/vacinacao',
  dosimetry:'funcional/biosseguranca/dosimetria',
  climate:'funcional/pesquisas-institucionais/clima',
  stress:'funcional/pesquisas-institucionais/estresse-fadiga',
  epidemiological:'funcional/cadastro-epidemiologico',
  notifications:'funcional'
});
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const sourceIcons = {
  performance: 'M4 20h16M7 16v-4m5 4V8m5 8V4',
  professionalRegistration: 'M5 4h14v16H5zM8 9h8m-8 4h8m-8 4h5',
  vaccination: 'M12 5v14M5 12h14',
  dosimetry: 'M4 13h4l2-6 4 10 2-4h4',
};
const sourceIcon = key => '<svg class="functional-tile-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+(sourceIcons[key]||sourceIcons.professionalRegistration)+'"/></svg>';

function sourceCards(sources) {
  const keys = Object.keys(sourceLabels);
  const states = {READY:'Dados sincronizados', PREPARING:'Em preparação', SESSION_REQUIRED:'Autenticação necessária', UNAVAILABLE:'Temporariamente indisponível'};
  return '<div class="functional-source-grid">' + keys.map(key => {
    const value = sources[key]??{state:'PREPARING'};
    const available=operationalContentAllowed(sourceFolders[key]);
    return '<div class="functional-source"><button class="functional-tile'+(available?'':' functional-tile--inactive')+'" type="button" data-fk-source="'+key+'" aria-haspopup="dialog" aria-controls="fk-detail"'+(!available?' aria-description="Pasta inativa. A navegação continua disponível; atividades bloqueadas."':'')+'>'
      + sourceIcon(key) + '<span><strong>'+escapeHtml(sourceLabels[key])+'</strong>'+(!available?'<small>Pasta inativa ou indisponível</small>':key==='performance'?'<small>'+escapeHtml(states[value.state]||'Status não informado')+'</small>':'')+'</span>'
      + '<span class="functional-chevron" aria-hidden="true">›</span></button>'
      + operationalFolderNotice(sourceFolders[key])+'</div>';
  }).join('') + '</div>';
}

const pointsFormat = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});

function performanceSource(score,uid) {
  if(score?.uid!==uid||!Number.isFinite(score.total)||!Number.isInteger(score.percentage)||
     score.percentage<0||score.percentage>100||!Number.isSafeInteger(score.updatedAt)||!Number.isFinite(new Date(score.updatedAt).getTime()))return {state:'PREPARING'};
  return {state:'READY',data:score};
}

function performanceDetail({total,percentage,updatedAt}) {
  const tone=percentage<=60?'low':percentage<=80?'medium':'high';
  const feedback={
    low:'Você ainda não atingiu a pontuação mínima de desempenho, precisa se esforçar para não perder concessões funcionais.',
    medium:'Você atingiu valores médios de desempenho, seu esforço e maior engajamento contribuirá para melhoria contínua dos nossos processos de qualidade e segurança.',
    high:'Você demonstra empenho e engajamento nos processos da equipe. O SAHMT agradece pelo seu apoio!'
  };
  const updated=formatDisplayDateTime(updatedAt);
  return '<div class="functional-performance"><p class="functional-performance-total"><span>PONTOS TOTAIS ADQUIRIDOS</span><strong>'+pointsFormat.format(total)+'</strong></p>'
    + '<p class="functional-performance-relative"><strong class="functional-performance-percent" data-tone="'+tone+'">'+percentage+'%</strong><span>Da maior pontuação da Equipe</span></p>'
    + '<div><p><strong>Margens de avaliação</strong></p><ul class="functional-performance-bands">'
    + ['0 a 20','21 a 40','41 a 60','61 a 80','81 a 100'].map(range=>'<li>'+range+'%</li>').join('')+'</ul></div>'
    + '<p>'+feedback[tone]+'</p><small>Atualizado em '+escapeHtml(updated)+'</small></div>';
}

export async function mountFunctionalModule(root, {uid, displayName = '', faAuth, administrator = false, isCurrent = () => true,
  onSessionRequired = () => {}, onRetry = () => {}} = {}) {
  let disposed = false;
  let stopAuth = () => {};
  let detailDialog, openSource = '', visibleSources = null, topicsOpen = false;
  let resultRequest=0,cleanupDosimetry=()=>{};
  let subjectRevision = 0, selection = '', roster = [], loadingRoster = false, ownSources = {}, ownStatus = '', ownRecognition = 'Sua dedicação e seu trabalho fazem a diferença na nossa equipe.', ownPerformance = {state:'PREPARING'};
  const header=root.closest('.functional-dialog')?.querySelector('[data-fk-header]');
  const owner=header?.querySelector('[data-fk-owner]');
  const recognition=header?.querySelector('[data-fk-recognition]');
  const tenure=header?.querySelector('[data-fk-tenure]');
  const duration=header?.querySelector('[data-fk-duration]');
  let ownJoinedOn;
  const current = () => !disposed && isCurrent() && faAuth?.currentUser?.uid === uid;
  const ownSession = () => current() && getFunctionalAuth()?.currentUser?.uid === uid;
  const paint = markup => { if (current() && root?.isConnected) root.innerHTML = markup; };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;cleanupDosimetry();
    if(detailDialog?.open)detailDialog.close();
    showOwner('');
    showRecognition('');
    ownJoinedOn=undefined;
    showTenure();
    stopAuth();
    if (activeFunctionalMountCleanup === cleanup) activeFunctionalMountCleanup = null;
    root?.removeEventListener('click', onFunctionalClick);
    root?.removeEventListener('change', onSubjectChange);
  };
  activeFunctionalMountCleanup?.();
  activeFunctionalMountCleanup = cleanup;
  if(!operationalContentAllowed('funcional')){
    paint(operationalFolderNotice('funcional')+renderOperationalFolderDirectory('funcional'));
    return cleanup;
  }
  paint('<section class="functional-page"><p role="status">Confirmando o acesso individual em FK…</p></section>');
  try {
    const fkAuth=getFunctionalAuth();
    const connected=await waitWithTimeout(waitForGoogleProjectSession('FK',{isCurrent:current}),30000,'FK_AUTH_CLIENT_TIMEOUT');
    if(!connected){
      if(!current())return cleanup;
      const state=googleProjectAuth.snapshot().targets.FK;
      const sessionMissing=state?.status==='pending'&&(
        state.code==='AUTH_GOOGLE_SESSION_REQUIRED'||state.code==='AUTH_UID_MISMATCH'||(!state.code&&!fkAuth?.currentUser));
      if(sessionMissing){onSessionRequired();return cleanup;}
      paint('<section class="functional-page"><p role="status">O acesso individual ao Funcional está temporariamente indisponível.</p>'
        +'<button class="secondary-button" type="button" data-fk-retry>Tentar novamente</button></section>');
      cleanup.resume=()=>{if(current())onRetry();};
      root.querySelector('[data-fk-retry]')?.addEventListener('click',cleanup.resume);
      return cleanup;
    }
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
    ownSources={...(profile?.sources||{}),performance:ownPerformance};
    ownStatus='Atualizando seus dados…';
    const selector=administrator?'<div class="functional-team"><button class="secondary-button" type="button" data-fk-team aria-expanded="false" aria-controls="fk-team-picker">Selecionar integrante da Equipe</button>'
      + '<div id="fk-team-picker" data-fk-picker hidden><label for="fk-team-subject">Integrante da Equipe</label>'
      + '<select id="fk-team-subject" data-fk-subject disabled><option value="">Meu perfil</option></select><p data-fk-team-status role="status"></p></div>'
      + '<button class="secondary-button" type="button" data-fk-dose-admin>Atualizar histórico de dosimetria</button></div>':'';
    visibleSources=ownSources;
    showOwner(displayName||'Meu perfil');
    showRecognition(ownRecognition);
    paint('<div class="functional-intro-actions" data-fk-intro><button class="secondary-button" type="button" data-fk-open-topics>Entrar nos tópicos funcionais</button></div>'
      + '<section class="functional-page" data-fk-topics hidden><h2 data-fk-topics-title tabindex="-1">Tópicos funcionais</h2>'+selector+'<div data-fk-sources>'+sourceCards(ownSources)+'</div>'
      + '<p class="functional-status" data-fk-refresh-status role="status">'+ownStatus+'</p>'
      + '<button class="secondary-button" type="button" data-fk-back-intro>Voltar ao Funcional</button>'
      + '</section><dialog class="functional-detail" id="fk-detail" aria-labelledby="fk-detail-title">'
      + '<header><span class="functional-detail-icon" data-fk-detail-icon></span><h2 id="fk-detail-title" tabindex="-1" autofocus></h2></header>'
      + '<div class="functional-detail-body" data-fk-detail-body></div>'
      + '<footer><form method="dialog"><button class="functional-detail-back" type="submit">Voltar</button></form></footer></dialog>');
    detailDialog=root.querySelector('#fk-detail');
    detailDialog?.addEventListener('close',()=>{
      if(detailDialog.open)return;
      resultRequest++;cleanupDosimetry();cleanupDosimetry=()=>{};
      const key=openSource;
      openSource='';
      detailDialog.querySelector('[data-fk-detail-body]').replaceChildren();
      if(key&&ownSession())root.querySelector('[data-fk-source="'+key+'"]')?.focus({preventScroll:true});
    });
    root.addEventListener('click', onFunctionalClick);
    detailDialog?.addEventListener('change',event=>{
      if(ownSession()&&event.target.matches('[data-fk-year]'))void fetchResult(Number(event.target.value));
    });
    if(administrator)root.addEventListener('change', onSubjectChange);
    void updateOverview(db);
    void waitWithTimeout(getDocFromServer(doc(db,'functionalPerformance',uid)),10000,'FK_PERFORMANCE_TIMEOUT')
      .then(snapshot=>{
        if(!ownSession())return;
        ownPerformance=performanceSource(snapshot.exists()?snapshot.data():null,uid);
        ownSources.performance=ownPerformance;
        if(!selection)renderOverview(ownSources,ownStatus);
      }).catch(()=>{});
    void waitWithTimeout(getDocFromServer(doc(db,'functionalRecognition',uid)),10000,'FK_RECOGNITION_TIMEOUT')
      .then(snapshot=>{
        if(!ownSession()||!snapshot.exists())return;
        const entry=snapshot.data();
        if(entry.uid!==uid)return;
        if(typeof entry.message==='string'&&entry.message.trim())ownRecognition=entry.message;
        ownJoinedOn=entry.teamJoinedOn;
        if(!selection)showRecognition(ownRecognition);
        showTenure();
      }).catch(()=>{});
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
        ownSources={...(profile.sources||{}),performance:ownPerformance};
      }
    } catch {refreshFailed=true;}
    if(!ownSession())return;
    ownStatus=refreshFailed?'As fontes não puderam ser atualizadas agora. Os últimos dados disponíveis permanecem exibidos.':'';
    if(!selection)renderOverview(ownSources,ownStatus);
  }

  function renderOverview(sources,statusText) {
    visibleSources=sources;
    const host=root.querySelector('[data-fk-sources]');
    if(host){
      const focused = host.ownerDocument?.activeElement?.dataset.fkSource;
      host.innerHTML=sources?sourceCards(sources):'';
      if(focused)host.querySelector('[data-fk-source="'+focused+'"]')?.focus({preventScroll:true});
    }
    const status=root.querySelector('[data-fk-refresh-status]');
    if(status)status.textContent=statusText;
    if(detailDialog?.open){
      if(!hasSource(openSource))detailDialog.close();
      else if(openSource==='performance')renderSourceDetail();
    }
  }

  function hasSource(key) {
    return visibleSources&&Object.hasOwn(sourceFolders,key);
  }

  function renderSourceDetail(){
    if(!operationalContentAllowed(sourceFolders[openSource])){
      detailDialog.querySelector('[data-fk-detail-body]').innerHTML=operationalFolderNotice(sourceFolders[openSource])+renderOperationalFolderDirectory(sourceFolders[openSource]);
      return;
    }
    const value=visibleSources[openSource]??{state:'PREPARING'};
    detailDialog.querySelector('[data-fk-detail-body]').innerHTML=value.state==='READY'
      ?performanceDetail(value.data):'<p>Aguardando a consolidação dos pontos de FB, FC, FE, FG e FJ.</p>';
  }

  async function fetchResult(year) {
    const key=openSource, ticket=++resultRequest,subjectUid=selection||uid;
    const current=()=>ownSession()&&operationalContentAllowed(sourceFolders[key])&&detailDialog.open&&openSource===key&&resultRequest===ticket&&(selection||uid)===subjectUid;
    const body=detailDialog.querySelector('[data-fk-detail-body]');
    const output=body.querySelector('[data-fk-result]');
    if(!output)return;
    output.textContent='Consultando…';
    try{
      const result=await loadFunctionalResult({key,year,uid,subjectUid,administrator,faAuth,isCurrent:current});
      if(current())output.innerHTML=renderFunctionalResult(key,result);
    }catch(error){
      if(current())output.textContent=error?.code?.endsWith('_FOLDER_DISABLED')
        ?'A consulta está desativada no Controle de Pastas da área de origem.'
        :'Não foi possível confirmar o resultado agora. Feche e reabra o painel para tentar novamente.';
    }
  }

  function showOwner(name) {
    if(!owner)return;
    owner.textContent=name;
    owner.hidden=!name;
  }

  function showRecognition(message) {
    if(!recognition)return;
    recognition.textContent=message||'';
    recognition.hidden=!message;
  }

  function showTenure() {
    if(!tenure||!duration)return;
    const elapsed=topicsOpen?'':formatCalendarDuration(ownJoinedOn);
    duration.textContent=elapsed;
    tenure.hidden=!elapsed;
  }

  function showTopics(open) {
    const intro=root.querySelector('[data-fk-intro]');
    const topics=root.querySelector('[data-fk-topics]');
    if(!intro||!topics)return;
    topicsOpen=open;
    intro.hidden=open;
    topics.hidden=!open;
    showTenure();
    if(open){root.querySelector('[data-fk-topics-title]')?.focus();return;}
    const subject=root.querySelector('[data-fk-subject]');
    if(selection&&subject){subject.value='';void selectSubject('');}
    root.querySelector('[data-fk-open-topics]')?.focus();
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

  function onSubjectChange(event) {
    if(event.target.matches('[data-fk-subject]')&&administrator&&ownSession())return selectSubject(event.target.value);
  }

  async function selectSubject(value) {
    const member=roster.find(row=>row.uid===value);
    if(value&&!member)return;
    const revision=++subjectRevision;
    selection=value;
    if(detailDialog?.open)detailDialog.close();
    showOwner(member?.name||displayName||'Meu perfil');
    showRecognition(member?'':ownRecognition);
    if(!member){renderOverview(ownSources,ownStatus);return;}
    renderOverview(null,'Carregando perfil funcional…');
    const isSelected=()=>ownSession()&&revision===subjectRevision;
    try {
      const {snapshot:profile,recognition,performance}=await readFunctionalTeamOverview({faAuth,uid,subjectUid:member.uid,isCurrent:isSelected});
      if(!isSelected())return;
      showRecognition(recognition);
      renderOverview({...profile?.sources,performance:performanceSource(performance,member.uid)},profile?'':'Este integrante ainda não tem um perfil funcional salvo.');
    } catch (error) {
      if(!isSelected())return;
      renderOverview(null,error?.message==='FK_TEAM_ACCESS_DENIED'
        ?'O acesso a este perfil não foi autorizado.'
        :'Não foi possível carregar este perfil agora. Troque a seleção e volte a este integrante para tentar novamente.');
    }
  }

  function onFunctionalClick(event) {
    if(ownSession()&&event.target.closest('[data-fk-open-topics]')){showTopics(true);return;}
    if(ownSession()&&event.target.closest('[data-fk-back-intro]')){showTopics(false);return;}
    const doseAdmin=event.target.closest('[data-fk-dose-admin]');
    if(doseAdmin&&administrator&&ownSession()&&detailDialog&&!detailDialog.open&&hasSource('dosimetry')){
      openSource='dosimetry';
      detailDialog.querySelector('#fk-detail-title').textContent='Atualizar histórico de dosimetria';
      detailDialog.querySelector('[data-fk-detail-icon]').innerHTML=sourceIcon('dosimetry');
      detailDialog.querySelector('[data-fk-detail-body]').innerHTML='<div data-fk-dose-host></div>';
      detailDialog.showModal();
      const current=()=>ownSession()&&detailDialog.open&&openSource==='dosimetry';
      cleanupDosimetry=mountFunctionalDosimetryImport(detailDialog.querySelector('[data-fk-dose-host]'),{isCurrent:current,request:input=>requestFunctionalDosimetry({faAuth,uid,input,isCurrent:current})});
      return;
    }
    const teamButton=event.target.closest('[data-fk-team]');
    if(teamButton&&administrator&&ownSession()){void openTeamPicker(teamButton);return;}
    const sourceButton = event.target.closest('[data-fk-source]');
    if(sourceButton && ownSession()){
      const key = sourceButton.dataset.fkSource;
      if(!detailDialog||detailDialog.open||!hasSource(key))return;
      openSource=key;
      detailDialog.querySelector('#fk-detail-title').textContent=sourceLabels[key];
      detailDialog.querySelector('[data-fk-detail-icon]').innerHTML=sourceIcon(key);
      if(!operationalContentAllowed(sourceFolders[key])){
        detailDialog.querySelector('[data-fk-detail-body]').innerHTML=operationalFolderNotice(sourceFolders[key])+renderOperationalFolderDirectory(sourceFolders[key]);
        detailDialog.showModal();
        return;
      }
      if(key==='dosimetry'){
        detailDialog.querySelector('[data-fk-detail-body]').innerHTML='<div data-fk-dose-host></div>';
        detailDialog.showModal();
        const subjectUid=selection||uid;
        const current=()=>ownSession()&&detailDialog.open&&openSource==='dosimetry'&&(selection||uid)===subjectUid;
        cleanupDosimetry=mountFunctionalDosimetry(detailDialog.querySelector('[data-fk-dose-host]'),{subjectUid,administrator,isCurrent:current,
          request:input=>requestFunctionalDosimetry({faAuth,uid,input,isCurrent:current})});
        return;
      }
      if(key==='performance')renderSourceDetail();
      else{
        const years=resultYears(key);
        detailDialog.querySelector('[data-fk-detail-body]').innerHTML=(years.length
          ?'<label class="functional-result-year">Ano <select data-fk-year>'+years.map(year=>'<option>'+year+'</option>').join('')+'</select></label>':'')
          +'<div data-fk-result aria-live="polite"></div>';
      }
      detailDialog.showModal();
      if(key!=='performance')void fetchResult(resultYears(key)[0]);
    }
  }
}
