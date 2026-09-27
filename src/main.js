import './styles.css';
import {firebaseConfigured} from './firebase-app.js';
import {retryAuthenticatedProfile, signInGoogle, signOutGlobal, watchSession} from './auth.js';
import {currentRoute, navigate} from './router.js';
import {discardCachedTrainingProgress, listPendingTrainingProgress, listUnsettledOperations, nextQueuedAttemptAt, operationCounts, pendingTrainingProgressCount, readCachedSchedule, removeQueuedOperation, retryFailedOperation, retryFailedOperations} from './outbox.js';
import {eventFieldRules, validateEventForm} from './event-form.js';
import {localDateKey, shiftDateKey} from './schedule-date.js';
import {buildScheduleView} from './schedule-view.js';
import {decodeQrImageData, findStationForQr, stationIsInDateRange, stationIsValidOn} from './checklist-qr.js';
import {hasFinanceOnlyManagementAccess, parseManagementUids} from './management-access.js';
import {checklistDayMode, resolveChecklistDayRecord, summarizeChecklistDay, summarizeChecklistMonth} from './checklist-date.js';
import {cacheOfflineScheduleImages, offlineScheduleGalleryMarkup} from './offline-schedule.js';
import {DEFAULT_APP_FEATURES, featureEnabledForRoute, normalizeAppFeatures} from './feature-flags.js';
import {contactActionLinks} from './contact-actions.js';

const app = document.querySelector('#app');
const labels = {
  events: ['Operacional', 'Eventos, escala e férias'],
  labels: ['Etiquetas', 'Modelos e registros de etiquetas'],
  management: ['Gestão', 'Áreas, atividades e indicadores'],
  checklist: ['Checklist', 'Registro e acompanhamento operacional'],
  training: ['Treinamentos', 'Catálogo, progresso e atividades'],
  notifications: ['Notificações', 'Comunicados do SAHMT'],
  people: ['Pessoas', 'Contatos e cadastros da equipe'],
  admin: ['Administração', 'Usuários e configurações'],
  offline: ['Sincronização', 'Ações aguardando confirmação do Firestore']
};
const userRoles = [
  ['coordenador', 'Coordenador'], ['conselho_diretor', 'Conselho Diretor'], ['gestor', 'Gestor'],
  ['anestesiologista', 'Anestesiologista'], ['residente', 'Residente'], ['temporario', 'Temporário'],
  ['administrador_app', 'Administrador do App']
];
const userPermissions = [
  ['scheduleRead', 'Consultar escala'], ['scheduleWrite', 'Liberar siglas na escala'],
  ['eventsRead', 'Consultar eventos'], ['eventsWrite', 'Registrar eventos'], ['eventsCatalogManage', 'Gerenciar catálogo de Eventos'],
  ['labelsRead', 'Consultar etiquetas'], ['labelsWrite', 'Registrar etiquetas'], ['labelsManage', 'Gerenciar etiquetas'],
  ['checklistRead', 'Consultar checklist'], ['checklistWrite', 'Registrar checklist'], ['checklistSign', 'Assinar checklist'], ['checklistManage', 'Gerenciar estações'],
  ['managementRead', 'Consultar Gestão'], ['managementActivityWrite', 'Gerenciar atividades'], ['managementIndicatorsRead', 'Consultar indicadores'], ['managementIndicatorsWrite', 'Gerenciar indicadores'], ['managementPlansManage', 'Gerenciar planos de ação'], ['managementManage', 'Administrar áreas'],
  ['trainingsRead', 'Consultar treinamentos'], ['trainingsManage', 'Gerenciar treinamentos'],
  ['documentsManage', 'Gerenciar documentos'], ['qualityManage', 'Gerenciar qualidade'], ['equipmentManage', 'Gerenciar equipamentos'], ['peopleManage', 'Gerenciar pessoas'],
  ['financeRead', 'Consultar financeiro'], ['financeWrite', 'Registrar financeiro'], ['financeManage', 'Administrar financeiro'],
  ['notificationsRead', 'Consultar notificações'], ['notificationsManage', 'Gerenciar notificações'],
  ['usersManage', 'Gerenciar acessos'], ['admin', 'Acesso administrativo total']
];
let session = {status: firebaseConfigured ? 'checking' : 'unconfigured'};
let notice = '';
let outboxRetryTimer = null;
let outboxRetryAt = 0;
let outboxRetryUid = '';
let selectedManagementAreaId = '';
let managementActivityLoad = 0;
let eventReportMode = 'daily';
let eventReportLoad = 0;
let loadedEventReportRecords = [];
let eventReportSourceRecords = [];
let eventReportStale = false;
let eventReportCursor = null;
let eventReportLoadingMore = false;
let loadedEventMembers = [];
let pendingEventPosition = null;
let labelReportMode = 'daily';
let labelReportLoad = 0;
let loadedLabelRecords = [];
let labelReportCursor = null;
let labelReportLoadingMore = false;
let loadedLabelStaffSiglas = [];
let reportPdfPromise = null;
let checklistReportMode = 'daily';
let checklistReportLoad = 0;
let stopChecklistQrScan = null;
let qrDecoderPromise = null;
let cleanupCurrentModule = null;
let cleanupLabelOcr = null;
let loadedTrainingCatalog = [];
let loadedLearningActivityCatalog = [];
let offlineViewMode = 'sync';
let appFeatures = {...DEFAULT_APP_FEATURES};
let appFeaturesUid = '';
let appFeaturesLoadSequence = 0;
const preloadedDataUsers = new Set();
const scheduledDataPreloads = new Set();

function preloadOperationalDataWhenIdle(user) {
  if (!user?.uid || !navigator.onLine || session.offline || preloadedDataUsers.has(user.uid) || scheduledDataPreloads.has(user.uid)) return;
  const uid = user.uid;
  scheduledDataPreloads.add(uid);
  const preload = async () => {
    try {
      if (session.status !== 'signed-in' || session.user?.uid !== uid || session.offline || !navigator.onLine) return;
      if (import.meta.env.PROD && 'serviceWorker' in navigator && !navigator.serviceWorker.controller) {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => window.setTimeout(resolve, 2000))
        ]).catch(() => {});
        if (session.status !== 'signed-in' || session.user?.uid !== uid || session.offline || !navigator.onLine) return;
      }
      preloadedDataUsers.add(uid);
      void Promise.all([
        import('./data.js'),
        import('./training.js'),
        import('./equipment.js'),
        import('./label-camera.js')
      ]).catch((error) => {
        preloadedDataUsers.delete(uid);
        console.warn('[SAHMT] Pré-carregamento de ações adiado:', error.code || error.message);
      });
    } finally {
      scheduledDataPreloads.delete(uid);
    }
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(preload, {timeout: 1800});
  else window.setTimeout(preload, 700);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function loadReportPdfModule() {
  if (!reportPdfPromise) reportPdfPromise = import('./report-pdf.js').catch((error) => { reportPdfPromise = null; throw error; });
  return reportPdfPromise;
}

function loadQrDecoder() {
  if (window.ZXing) return Promise.resolve();
  if (qrDecoderPromise) return qrDecoderPromise;
  qrDecoderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}vendor/zxing.min.js`;
    script.onload = resolve;
    script.onerror = () => {
      qrDecoderPromise = null;
      script.remove();
      reject(new Error('Não foi possível carregar o leitor QR neste aparelho.'));
    };
    document.head.append(script);
  });
  return qrDecoderPromise;
}

async function decodeQrPhoto(file) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Escolha uma foto válida do QR Code.');
  if (typeof createImageBitmap !== 'function') throw new Error('Este aparelho não consegue abrir a foto do QR. Use a câmera ou digite o código.');
  await loadQrDecoder();
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('Não foi possível preparar a foto do QR Code.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return decodeQrImageData(context.getImageData(0, 0, canvas.width, canvas.height), window.ZXing);
  } finally {
    bitmap.close();
  }
}

function loginView() {
  const configMessage = session.status === 'unconfigured'
    ? '<p class="notice">Configure as variáveis públicas do Firebase do projeto SAHMT para habilitar o login.</p>'
    : '';
  const statusMessage = {
    'profile-missing': 'Esta conta Google ainda não tem um perfil SAHMT. Solicite o acesso por aqui.',
    'access-pending': 'Sua solicitação de acesso foi enviada. O administrador precisa revisar e configurar seu perfil.',
    blocked: 'Sua conta está autenticada, mas o perfil está inativo ou sem acesso ao SAHMT.',
    'profile-error': 'Não foi possível carregar o perfil e as permissões. Tente novamente quando houver conexão.',
    'auth-error': 'Não foi possível verificar sua sessão do Firebase.'
  }[session.status];
  const resultMessage = notice || statusMessage ? `<p class="notice" role="alert">${escapeHtml(notice || statusMessage)}</p>` : '';
  const accessRequest = session.status === 'profile-missing' && session.user ? '<button class="primary-button" id="request-access" type="button">Solicitar acesso ao SAHMT</button>' : '';
  const profileRetry = ['profile-error', 'access-pending'].includes(session.status) && session.user ? `<button class="primary-button" id="profile-retry" type="button">${session.status === 'access-pending' ? 'Verificar aprovação' : 'Tentar carregar perfil novamente'}</button>` : '';
  return `<main class="login-gate">
    <section class="login-card" aria-labelledby="login-title">
      <img class="brand-logo" src="${import.meta.env.BASE_URL}assets/icon-192.png" alt="SAHMT">
      <h1 id="login-title">SAHMT</h1>
      <p class="login-message">Entre com sua conta Google autorizada.</p>
      ${configMessage}${resultMessage}${accessRequest}
      ${profileRetry}
      <button class="primary-button google-button" id="google-login" type="button" ${!firebaseConfigured ? 'disabled' : ''}>Entrar com Google</button>
      ${session.user ? '<button class="text-button" id="blocked-signout" type="button">Sair ou trocar conta</button>' : ''}
      <small>Uma única conta para acessar as áreas do SAHMT, conforme suas permissões.</small>
    </section>
  </main>`;
}

function moduleCards() {
  const permissionFor = {events: ['eventsRead', 'eventsWrite', 'eventsCatalogManage'], labels: ['labelsRead', 'labelsWrite', 'labelsManage'], management: ['managementManage', 'managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage', 'equipmentManage', 'qualityManage', 'financeRead', 'financeWrite', 'financeManage'], checklist: ['checklistRead', 'checklistWrite', 'checklistSign', 'checklistManage'], training: ['trainingsRead', 'trainingsManage'], notifications: ['notificationsRead', 'notificationsManage'], people: ['peopleManage'], admin: ['usersManage']};
  const moduleIcons = {events: 'assets/modules/operacional.jpg', labels: 'assets/sahmt-logo.png', management: 'assets/selo-qga-accredited-qmentum-diamond.png', checklist: 'assets/modules/checklist.svg'};
  return Object.entries(labels).filter(([route]) => permissionFor[route]?.some(can) && featureEnabledForRoute(route, appFeatures)).map(([route, [title, subtitle]]) => `<button class="module-card" data-route="${route}">
    ${moduleIcons[route] ? `<img class="module-icon" src="${import.meta.env.BASE_URL}${moduleIcons[route]}" alt="" width="40" height="40" loading="lazy" decoding="async">` : `<span class="module-mark" aria-hidden="true">${{training:'TR',notifications:'NO',people:'PS',admin:'AD'}[route]}</span>`}
    <span><strong>${title}</strong><small>${subtitle}</small></span><span class="arrow" aria-hidden="true">›</span>
  </button>`).join('');
}

function can(permission) {
  if (session.profile?.role === 'administrador_app' || session.profile?.permissions?.admin === true || session.profile?.permissions?.[permission] === true) return true;
  const qualityAreaPermissions = ['managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage'];
  return currentRoute() === 'management' && (!selectedManagementAreaId || selectedManagementAreaId === 'area-gestao-da-qualidade') &&
    session.profile?.permissions?.qualityManage === true && qualityAreaPermissions.includes(permission);
}

function vacationRankMarkup(sigla, classes, position) {
  return `<span class="sigla-token__vacation-rank"><span class="${classes.join(' ')}">${escapeHtml(sigla)}</span><small class="sigla-token__vacation-number" aria-label="Posição ${position} na escala de férias">${position}</small></span>`;
}

function renderScheduleSigla(sigla, vacationParts = [], checkedSiglas = [], vacationPositions = {}, showVacationRank = true) {
  const vacationSet = new Set(vacationParts.map((item) => String(item || '').toUpperCase()));
  const checkedSet = new Set(checkedSiglas.map((item) => String(item || '').toUpperCase()));
  return String(sigla || '—').toUpperCase().split(/([/-])/).map((part) => {
    if (part === '/' || part === '-') return escapeHtml(part);
    const onVacation = vacationSet.has(part);
    if (onVacation && !showVacationRank) return escapeHtml(part);
    const classes = [];
    if (onVacation) classes.push('sigla-token__vacation-part');
    if (checkedSet.has(part)) classes.push('sigla-token__released-part--checked');
    return onVacation
      ? vacationRankMarkup(part, classes, vacationPositions[part] || '')
      : `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}>${escapeHtml(part)}</span>`;
  }).join('');
}

function renderScheduleAliases(siglas, vacationParts = [], checkedSiglas = [], vacationPositions = {}, showVacationRank = true) {
  const vacationSet = new Set(vacationParts.map((item) => String(item || '').toUpperCase()));
  const checkedSet = new Set(checkedSiglas.map((item) => String(item || '').toUpperCase()));
  return siglas.map((sigla) => {
    const onVacation = vacationSet.has(sigla);
    if (onVacation && !showVacationRank) return escapeHtml(sigla);
    const classes = [];
    if (onVacation) classes.push('sigla-token__vacation-part');
    if (checkedSet.has(sigla)) classes.push('sigla-token__released-part--checked');
    return onVacation
      ? vacationRankMarkup(sigla, classes, vacationPositions[sigla] || '')
      : `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}>${escapeHtml(sigla)}</span>`;
  }).join(' · ');
}

function actionForm(route) {
  if (route === 'events') {
    const catalogForm = can('eventsCatalogManage') ? `<details class="quick-form"><summary>Configurar opções de Eventos</summary><form id="event-catalog-form">
      <p class="record-meta">Configure pagadores e credores usados no lançamento. As opções ficam no Firestore e valem para esta área em todo o PWA.</p>
      <div class="form-grid"><label>Pagadores · um por linha<textarea name="payers" rows="4" maxlength="12000" placeholder="Uma opção por linha"></textarea></label><label>Credores · um por linha<textarea name="creditors" rows="4" maxlength="12000" placeholder="Uma opção por linha"></textarea></label></div>
      <button class="secondary-button" type="submit">Salvar opções</button><p id="event-catalog-status" class="record-meta" role="status" aria-live="polite"></p></form></details>` : '';
    if (!can('eventsWrite')) return catalogForm;
    return `${catalogForm}<details class="quick-form" open><summary>Lançamento do evento</summary><form data-module-form="events">
    <div class="form-grid"><label>Data do Evento<input name="eventDate" type="date" required value="${todayInputValue()}"></label>
    <div data-event-field="memberStatus"><label>Sigla do membro<select name="memberSigla"><option value="">Carregando siglas…</option></select></label>
    <label>Membro (ausente/atrasado)<input name="memberStatus" maxlength="160" placeholder="Selecione a sigla para preencher o nome"></label></div>
    <input name="scheduleSigla" type="hidden">
    <label>Tipo de Evento<select name="eventType" required><option value="">Selecione</option>${['Pessoal','Férias','ATRASO','Suporte','Gestão','Congresso','Saúde','Ausência','Outros'].map((value) => `<option>${value}</option>`).join('')}</select></label>
    <label data-event-field="delayMultiple">Múltiplo do atraso<select name="delayMultiple"><option value="">Selecione</option>${Array.from({length: 7}, (_, index) => `<option value="${index}">${index}</option>`).join('')}</select></label>
    <label data-event-field="substitute">Substituto<input name="substitute" maxlength="120"></label><label data-event-field="shift">Turno<select name="shift"><option value="">Selecione</option><option>Manhã</option><option>Tarde</option><option>Integral</option></select></label>
    <label>Pagador<select name="payer" required><option value="">Selecione</option></select></label><label>Credor<select name="creditor" required><option value="">Selecione</option></select></label>
    <label>Valor a pagar<input name="amountToPay" type="number" required min="0" step="0.01" inputmode="decimal" placeholder="R$ 0,00"></label></div>
    <label data-event-field="description">Descrição do evento<textarea name="description" rows="3" maxlength="1000"></textarea></label>
    <p id="event-members-missing" class="empty-state" hidden>O catálogo de siglas está vazio. Cadastre siglas em Etiquetas ou sincronize contatos ativos em Pessoas.</p>
    <p id="event-catalog-missing" class="empty-state" hidden>O catálogo de pagadores e credores ainda precisa ser configurado pela Administração de Eventos.</p>
    <p id="event-catalog-stale" class="record-meta" hidden>Opções carregadas do cache deste usuário. O Firestore validará cada lançamento ao sincronizar.</p>
    <input name="editEventId" type="hidden"><input name="editEventVersion" type="hidden"><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar evento</button><button class="secondary-button" id="event-edit-cancel" type="button" hidden>Cancelar edição</button></div><p id="event-form-status" class="record-meta" role="status" aria-live="polite"></p><button class="secondary-button" id="event-conflict-refresh" type="button" hidden>Atualizar relatório para comparar</button></form></details>`;
  }
  if (route === 'training' && can('trainingsManage')) return `<details class="quick-form"><summary>Gerenciar catálogo de treinamentos</summary><form id="training-catalog-form">
    <div class="form-grid"><label>Título<input name="title" required maxlength="120"></label><label>Link do YouTube<input name="videoUrl" type="url" required maxlength="600" placeholder="https://youtu.be/…"></label>
    <label>Descrição<input name="description" maxlength="500"></label><label>Pontos de acesso<input name="accessPoints" type="number" min="0" max="1000" step="0.01" value="0" required></label>
    <label>Pontos de conclusão<input name="completionPoints" type="number" min="0" max="1000" step="0.01" value="0" required></label><label>Ordem<input name="order" type="number" min="0" max="9999" step="1" value="0" required></label>
    <label class="contact-active-field"><input name="active" type="checkbox" checked> Treinamento ativo</label></div><input name="trainingId" type="hidden">
    <div class="admin-user-actions"><button class="primary-button" type="submit">Salvar treinamento</button><button class="secondary-button" id="training-edit-cancel" type="button">Novo treinamento</button></div><p id="training-catalog-status" class="record-meta" role="status" aria-live="polite"></p></form>
    <div id="training-admin-list" class="module-content"><p class="loading">Carregando catálogo…</p></div></details><details class="quick-form"><summary>Gerenciar atividades de aprendizagem</summary><form id="learning-activity-form">
    <div class="form-grid"><label>Título<input name="title" required maxlength="120"></label><label>Categoria<input name="category" maxlength="60" placeholder="Comunicado, orientação…"></label>
    <label class="form-span">Descrição<textarea name="description" rows="3" maxlength="500"></textarea></label><label>Tipo de atividade<select name="sourceKind"><option value="EXTERNAL_LINK">Link externo</option><option value="GOOGLE_FORM">Formulário Google · sem validar envio</option><option value="SHEET">Planilha · somente abrir</option><option value="DOCUMENT">Documento do Drive · somente abrir</option><option value="PDF">PDF · somente abrir</option><option value="QUIZ">Quiz externo · sem validar resultado</option><option value="SURVEY">Pesquisa externa · sem validar resposta</option><option value="ACKNOWLEDGEMENT">Ciência SAHMT · sem link</option></select></label><label>Link HTTPS<input name="resourceUrl" type="url" maxlength="600" placeholder="https://…"></label>
    <label>Conclusão<select name="completionKind"><option value="NONE">Sem conclusão rastreada</option><option value="ACKNOWLEDGEMENT">Confirmar ciência</option></select></label><small class="record-meta form-span">Formulários, documentos, quizzes e pesquisas abrem no serviço de origem; respostas e resultados não são verificados neste fluxo.</small>
    <label>Público<select name="audienceType"><option value="ALL">Todos</option><option value="ROLE">Função</option><option value="USER">UID específico</option></select></label>
    <label class="learning-audience-value" hidden>Função ou UID<input name="audienceValue" maxlength="128"></label><label>Começa<input name="startAt" type="date" required value="${todayInputValue()}"></label><label>Termina<input name="endAt" type="date" required value="${todayInputValue()}"></label>
    <label>Recorrência<select name="recurrenceMode"><option value="ONCE">Uma vez</option><option value="ONCE_PER_VERSION">Uma vez por versão</option></select></label><label>Ordem<input name="order" type="number" min="0" max="9999" step="1" value="0" required></label>
    <label class="contact-active-field"><input name="showInTraining" type="checkbox" checked> Mostrar em Treinamentos</label><label class="contact-active-field"><input name="active" type="checkbox" checked> Publicada</label></div><input name="activityId" type="hidden">
    <div class="admin-user-actions"><button class="primary-button" type="submit">Salvar atividade</button><button class="secondary-button" id="learning-activity-reset" type="button">Nova atividade</button></div><p id="learning-activity-status" class="record-meta" role="status" aria-live="polite"></p></form>
    <div id="learning-activity-admin-list" class="module-content"><p class="loading">Carregando atividades…</p></div></details>`;
  if (route === 'labels' && (can('labelsWrite') || can('labelsManage'))) return `${can('labelsManage') ? `<details class="quick-form"><summary>Catálogo de plantonistas</summary><form id="label-staff-catalog-form"><label>Siglas autorizadas · separadas por vírgula ou linha<textarea name="siglas" rows="3" maxlength="500" placeholder="AB, CD, L2"></textarea></label><button class="secondary-button" type="submit">Salvar catálogo</button><p id="label-staff-catalog-status" class="record-meta" role="status" aria-live="polite"></p></form></details>` : ''}<details class="quick-form" open><summary>Registrar etiqueta</summary><form data-module-form="labels">
    <section class="label-capture-panel" aria-label="Leitura assistida da etiqueta"><label>Foto ou arquivo da etiqueta<input id="label-ocr-file" name="ocrImage" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label><button class="secondary-button" id="label-camera-open" type="button">Abrir câmera</button><div class="label-crop-frame" id="label-crop-frame" hidden><canvas id="label-ocr-preview" class="label-ocr-preview" aria-label="Prévia da etiqueta. Arraste para marcar a área de leitura." tabindex="0"></canvas><div class="label-crop-selection" id="label-crop-selection" hidden></div></div><div class="admin-user-actions"><button class="secondary-button" id="label-crop-toggle" type="button" hidden>Marcar área para recortar</button><button class="secondary-button" id="label-crop-reset" type="button" hidden>Usar foto inteira</button><button class="secondary-button" id="label-ocr-run" type="button" disabled>Ler dados da foto neste aparelho</button></div><p class="record-meta">A leitura local serve como rascunho. Confira os campos antes de salvar; a imagem não é enviada nem gravada. Para recortar, toque em “Marcar área” e arraste sobre a foto.</p><p id="label-ocr-status" class="record-meta" role="status" aria-live="polite"></p><dialog class="label-camera-dialog" id="label-camera-dialog" aria-labelledby="label-camera-title"><header><div><p class="eyebrow">ETIQUETAS</p><h3 id="label-camera-title">Capturar etiqueta</h3></div><button class="secondary-button" id="label-camera-close" type="button">Fechar</button></header><p id="label-camera-status" role="status" aria-live="polite">A imagem permanece neste aparelho até você revisar o formulário.</p><div class="label-camera-stage"><video id="label-camera-video" playsinline muted></video><div class="label-camera-target" aria-hidden="true"><span>Centralize a etiqueta</span></div></div><button class="primary-button" id="label-camera-capture" type="button" disabled>Capturar foto</button></dialog></section>
    <div class="form-grid"><label>Data<input name="date" type="date" value="${todayInputValue()}" required></label><label>Nome do Paciente<input name="patientName" autocomplete="off" required maxlength="160"></label>
    <label data-label-field="procedure">Cirurgia<input name="procedureCode" inputmode="numeric" maxlength="80"></label><label>Atendimento<input name="encounterCode" inputmode="numeric" required maxlength="80"></label>
    <label>Tipo<select name="type" required><option value="">Selecione</option><option>Particular</option><option>Complementação</option><option>Convênio</option><option>Consulta Pré-anestésica</option><option>SADT</option></select></label>
    <label data-label-field="amount" hidden>Valor em Real<input name="amount" inputmode="decimal" placeholder="R$ 0,00" maxlength="32"></label><label data-label-field="insurance">Convênio<input name="insurance" maxlength="120"></label>
    <label>Credor<select name="creditor" required><option value="">Selecione</option><option>Caixa</option><option>Plantão</option><option>Plantão/Caixa</option></select></label><label data-label-field="staff">Plantonista(s), separados por vírgula<input name="staffSiglas" list="label-staff-suggestions" autocomplete="off" maxlength="240" placeholder="Informe as siglas"><datalist id="label-staff-suggestions"></datalist><small id="label-staff-catalog-note" class="record-meta">Selecione siglas do catálogo autorizado.</small></label></div>
    <input name="editLabelId" type="hidden"><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar registro</button><button class="secondary-button" id="label-edit-cancel" type="button" hidden>Cancelar edição</button></div><p id="label-form-status" class="record-meta" role="status" aria-live="polite"></p><button class="secondary-button" id="label-conflict-refresh" type="button" hidden>Atualizar relatório para comparar</button></form></details>`;
  if (route === 'checklist' && (can('checklistRead') || can('checklistWrite') || can('checklistManage'))) return `${can('checklistManage') ? `<details class="quick-form"><summary>Configurar estações do Checklist</summary><form id="checklist-station-form"><div class="form-grid"><label>Nome da estação<input name="name" required maxlength="120"></label><label>Código QR<input name="qrCode" required maxlength="300" autocomplete="off"></label><label>Início da vigência<input name="start" type="date"></label><label>Fim da vigência<input name="end" type="date"></label><label>Ordem<input name="order" type="number" min="0" max="9999" step="1" value="0"></label><label class="contact-active-field"><input name="active" type="checkbox" checked> Estação ativa</label></div><input name="stationId" type="hidden"><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar estação</button><button class="secondary-button" id="station-edit-cancel" type="button">Nova estação</button></div><p id="checklist-station-status" class="record-meta" role="status" aria-live="polite"></p></form><div id="checklist-station-list" class="module-content"><p class="loading">Carregando catálogo…</p></div></details>` : ''}<section class="checklist-controls panel" aria-label="Relatórios do checklist"><div class="report-mode"><button type="button" data-checklist-report-mode="daily" aria-pressed="${checklistReportMode === 'daily'}">CHECKLIST DIÁRIO</button><button type="button" data-checklist-report-mode="monthly" aria-pressed="${checklistReportMode === 'monthly'}">RELATÓRIO MENSAL</button></div><div class="report-period"><label id="checklist-day-control" ${checklistReportMode !== 'daily' ? 'hidden' : ''}>Data do checklist<input id="checklist-day" type="date" value="${todayInputValue()}" max="${todayInputValue()}"></label><label id="checklist-month-control" ${checklistReportMode !== 'monthly' ? 'hidden' : ''}>Mês de referência<input id="checklist-month" type="month" value="${todayInputValue().slice(0, 7)}" max="${todayInputValue().slice(0, 7)}"></label>${can('checklistWrite') ? `<button class="secondary-button" id="checklist-scan-qr" type="button" ${checklistReportMode !== 'daily' ? 'hidden' : ''}>Ler QR da estação</button><button class="secondary-button" id="checklist-qr-photo" type="button" ${checklistReportMode !== 'daily' ? 'hidden' : ''}>Ler QR de uma foto</button><input id="checklist-qr-photo-file" class="sr-only" type="file" accept="image/*" capture="environment" tabindex="-1" aria-label="Escolher foto do QR da estação"><span id="checklist-qr-photo-status" class="record-meta" role="status" aria-live="polite"></span>` : ''}<button class="secondary-button" id="checklist-refresh" type="button">Atualizar</button></div></section>`;
  if (route === 'management' && (can('managementActivityWrite') || can('qualityManage'))) return `<details class="quick-form" open><summary>Nova atividade</summary><form data-module-form="activity">
    <div class="form-grid"><label>Área de Gestão<select name="managementAreaId" id="activity-area" required><option value="">Carregando áreas…</option></select></label><label>Título<input name="title" required maxlength="160"></label>
    <label>Prazo<input name="dueAt" type="date"></label><label>Prioridade<select name="priority"><option>Normal</option><option>Alta</option><option>Urgente</option></select></label>${can('managementManage') ? '<label>UID(s) de responsáveis da equipe · um por linha<textarea name="responsibleUids" rows="3" maxlength="2600" placeholder="UID Firebase cadastrado como membro da área" required></textarea></label><label>Participantes da equipe · um UID por linha<textarea name="participantUids" rows="2" maxlength="13000" placeholder="Opcional · podem comentar, não iniciar ou concluir"></textarea></label><label class="contact-active-field"><input name="pointsEnabled" type="checkbox"> Pontuar quando o responsável concluir (exige um único responsável)</label>' : ''}</div>
    <label>Descrição<textarea name="description" rows="3" maxlength="1200"></textarea></label><button class="primary-button" type="submit">Criar atividade</button></form></details>`;
  if (route === 'notifications' && can('notificationsManage')) return `<details class="quick-form" open><summary>Novo comunicado</summary><form data-module-form="notifications">
    <div class="form-grid"><label>Título<input name="title" required maxlength="120"></label><label>Tipo<select name="type"><option value="INFO">Informação</option><option value="WARNING">Atenção</option><option value="ACTION">Ação</option></select></label><label>Público<select name="audienceType" id="notification-audience"><option value="ALL">Todos</option><option value="ROLE">Função</option><option value="USER">UID</option><option value="SIGLA">Sigla</option><option value="MANAGEMENT_AREA">Área de Gestão</option><option value="GROUP">Grupo</option></select></label><label id="notification-audience-value-wrap" hidden>Identificador do público<input name="audienceValue" maxlength="128"></label><label>Início<input name="startAt" type="date" required value="${todayInputValue()}"></label><label>Fim<input name="endAt" type="date" required value="${todayInputValue()}"></label><label>Prioridade<select name="priority"><option value="0">Normal</option><option value="1">Baixa</option><option value="2">Média</option><option value="3">Alta</option><option value="4">Urgente</option><option value="5">Crítica</option></select></label><label>Ação ao abrir<select name="actionRoute"><option value="">Nenhuma</option><option value="events">Eventos</option><option value="labels">Etiquetas</option><option value="management">Gestão</option><option value="checklist">Checklist</option><option value="training">Treinamentos</option></select></label></div>
    <label>Mensagem<textarea name="message" rows="3" required maxlength="1200"></textarea></label><button class="primary-button" type="submit">Publicar comunicado</button></form></details>`;
  if (route === 'people' && can('peopleManage')) return `<details class="quick-form" open><summary>Cadastro de contato</summary><form data-module-form="people">
    <div class="form-grid"><label>Sigla<input name="sigla" required pattern="(?:[A-Z]{2}|L2)" maxlength="2" autocomplete="off"></label><label>Nome<input name="name" required maxlength="120"></label>
    <label>Função<input name="role" maxlength="80"></label><label>Telefone<input name="phone" type="tel" maxlength="40"></label><label>E-mail<input name="email" type="email" maxlength="200"></label><label>Link WhatsApp<input name="whatsAppLink" type="url" maxlength="250" placeholder="https://wa.me/5511999999999"></label><label>CRM<input name="crm" maxlength="40"></label><label>Data de entrada<input name="entryDate" maxlength="32" placeholder="DD/MM/AAAA"></label></div>
    <label class="contact-active-field"><input name="active" type="checkbox" checked> Contato ativo</label><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar contato</button><button class="secondary-button" id="contact-reset" type="button">Novo contato</button></div></form></details>`;
  return '';
}

function shellView() {
  const route = currentRoute();
  const profile = session.profile;
  const title = route === 'home' ? 'SAHMT' : labels[route]?.[0] || 'SAHMT';
  const checklistVisual = route === 'checklist' ? `<figure class="checklist-visual"><figcaption>Arsenal Anestésico</figcaption><img src="${import.meta.env.BASE_URL}assets/carrinho-anestesia-checklist.jpg" alt="Arsenal anestésico com indicadores dos itens de verificação" loading="lazy" decoding="async"></figure>` : '';
  const managementBrand = route === 'management' ? `<section class="management-brand-banner" aria-label="Segmento de Gestão SAHMT"><div><p>Segmento de Gestão</p><h2>SAHMT</h2></div><img src="${import.meta.env.BASE_URL}assets/selo-qga-accredited-qmentum-diamond.png" alt="Selo QGA Accredited Qmentum Diamond" width="80" height="80" loading="lazy" decoding="async"></section>` : '';
  const eventReport = route === 'events' && (can('eventsRead') || can('eventsWrite')) ? `<section class="event-report" aria-label="Relatórios de eventos"><div class="report-mode"><button type="button" data-event-report-mode="daily" aria-pressed="${eventReportMode === 'daily'}">RELATÓRIO DIÁRIO</button><button type="button" data-event-report-mode="monthly" aria-pressed="${eventReportMode === 'monthly'}">RELATÓRIO MENSAL</button></div><div class="report-period"><label id="event-day-control" ${eventReportMode !== 'daily' ? 'hidden' : ''}>Data dos registros<input type="date" id="event-report-day" value="${todayInputValue()}"></label><label id="event-month-control" ${eventReportMode !== 'monthly' ? 'hidden' : ''}>Mês de referência<input type="month" id="event-report-month" value="${todayInputValue().slice(0, 7)}"></label><label>Filtrar por pessoa<input type="search" id="event-report-person" placeholder="Nome ou sigla" autocomplete="off"></label><button class="secondary-button" type="button" id="export-events" disabled>Gerar CSV</button><button class="secondary-button" type="button" id="share-events-pdf" disabled>PDF / WhatsApp</button></div><small class="record-meta">A busca inclui todos os registros carregados do período; use “Carregar mais” para consultar períodos extensos.</small><div id="event-report-results" class="module-content" aria-live="polite"><p class="loading">Carregando relatório…</p></div></section>` : '';
  const eventSchedule = route === 'events' && (can('eventsRead') || can('eventsWrite')) ? `<section class="event-schedule panel" aria-labelledby="event-schedule-title"><header class="event-schedule-heading"><div><p class="eyebrow">ESCALA DIÁRIA</p><h2 id="event-schedule-title">Anestesiologistas</h2><p id="event-schedule-weekday" class="record-meta"></p></div><label class="date-picker">Data<input type="date" id="event-schedule-date" value="${todayInputValue()}"></label></header><nav class="schedule-day-nav" aria-label="Navegar pela escala de Eventos"><button class="secondary-button" id="event-schedule-previous" type="button">Anterior</button><button class="primary-button" id="event-schedule-today" type="button">Hoje</button><button class="secondary-button" id="event-schedule-next" type="button">Próximo</button></nav><div id="event-schedule-content" class="schedule-content" aria-live="polite"><p class="loading">Carregando escala…</p></div></section>` : '';
  const labelReport = route === 'labels' ? `<section class="event-report" aria-label="Relatórios de etiquetas"><div class="report-mode"><button type="button" data-label-report-mode="daily" aria-pressed="${labelReportMode === 'daily'}">RELATÓRIO DIÁRIO - ETIQUETAS</button><button type="button" data-label-report-mode="monthly" aria-pressed="${labelReportMode === 'monthly'}">RELATÓRIO MENSAL - ETIQUETAS</button></div><div class="report-period"><label id="label-day-control" ${labelReportMode !== 'daily' ? 'hidden' : ''}>Data dos registros<input type="date" id="label-report-day" value="${todayInputValue()}"></label><label id="label-month-control" ${labelReportMode !== 'monthly' ? 'hidden' : ''}>Mês de referência<input type="month" id="label-report-month" value="${todayInputValue().slice(0, 7)}"></label><button class="secondary-button" type="button" id="export-labels" disabled>Gerar CSV</button><button class="secondary-button" type="button" id="share-labels-pdf" disabled>PDF / WhatsApp</button></div><div id="label-report-results" class="module-content" aria-live="polite"><p class="loading">Carregando relatório…</p></div></section>` : '';
  const view = route === 'home' ? `<section class="content-grid">
      <article class="schedule-card panel"><header class="panel-heading"><div><p class="eyebrow">ESCALA</p><h2>Calendário</h2></div><label class="date-picker"><span class="sr-only">Data da escala</span><input type="date" id="schedule-date"></label></header>
        <nav class="schedule-day-nav" aria-label="Navegar pela escala"><button class="secondary-button" id="schedule-previous" type="button" aria-label="Dia anterior">Anterior</button><button class="primary-button" id="schedule-today" type="button">Hoje</button><button class="secondary-button" id="schedule-next" type="button" aria-label="Próximo dia">Próximo</button></nav>
        ${can('scheduleWrite') ? '<a class="secondary-button schedule-edit-launch" href="https://docs.google.com/spreadsheets/d/1japh5sUW3QU5F3dknhS40VLFBj6SfZKDlrVan5ivzNM/edit#gid=0" target="_blank" rel="noopener noreferrer">Editar planilha oficial</a>' : ''}
        <div id="schedule-content" class="schedule-content"><p class="loading">Carregando escala…</p></div>
      </article>
      <section class="modules-section"><div class="module-grid">${moduleCards()}</div></section>
    </section>` : `<section class="module-view panel"><p class="eyebrow">SAHMT</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(labels[route]?.[1] || 'Área administrativa do SAHMT.')}</p>${checklistVisual}${managementBrand}${eventSchedule}${actionForm(route)}${eventReport}${labelReport}<div id="module-content" class="module-content"><p class="loading">Carregando informações…</p></div><button class="secondary-button" data-route="home">Voltar para Home</button></section>`;
  return `<div class="app-shell${route === 'home' ? ' app-shell--home' : ''}">
    <header class="topbar"><button class="brand" data-route="home" aria-label="Voltar ao início"><img src="${import.meta.env.BASE_URL}assets/sahmt-logo.png" alt=""><span>SAHMT</span></button><div class="sync-pill" id="outbox-status" role="status"></div><div class="account"><div class="account-copy"><strong>${escapeHtml(profile.displayName || session.user.displayName || 'Usuário')}</strong>${route === 'home' ? '' : `<small>${escapeHtml(profile.sigla || profile.email || session.user.email || '')}</small>`}</div><button class="logout-button" id="logout">Sair</button></div></header>
    <main class="main-content">${route === 'home' ? '' : `<div class="page-title"><p class="eyebrow">GESTÃO RESPONSÁVEL</p><h1>${escapeHtml(title)}</h1></div>`}${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ''}${view}</main>
    <dialog class="checklist-qr-dialog" id="checklist-qr-dialog" aria-labelledby="checklist-qr-title"><header><div><p class="eyebrow">CHECKLIST</p><h3 id="checklist-qr-title">Ler QR da estação</h3></div><button class="secondary-button" id="checklist-qr-close" type="button">Fechar</button></header><p id="checklist-qr-status" role="status">A leitura é feita neste aparelho; o código não é enviado para fora.</p><video id="checklist-qr-video" playsinline muted hidden></video><form id="checklist-qr-manual"><label>Código da estação<input name="qr" autocomplete="off" inputmode="text" required maxlength="500" placeholder="Digite o código do QR"></label><button class="primary-button" type="submit">Localizar estação</button></form></dialog>
    <dialog class="schedule-contact-dialog" id="schedule-contact-dialog" aria-labelledby="schedule-contact-heading"><div id="schedule-contact-details"><h3 id="schedule-contact-heading">Contato</h3></div><form method="dialog"><button class="secondary-button" type="submit">Fechar</button></form></dialog>
    <dialog class="schedule-contact-dialog" id="event-schedule-choice-dialog" aria-labelledby="event-schedule-choice-title"><h3 id="event-schedule-choice-title">Escolha o anestesiologista</h3><p class="record-meta">Esta posição da escala reúne mais de uma sigla.</p><div id="event-schedule-choice-options" class="event-schedule-choice-options"></div><form method="dialog"><button class="secondary-button" type="submit" value="cancel">Cancelar</button></form></dialog>
    <footer class="app-footer">SAHMT · Hospital e equipe</footer>
  </div>`;
}

async function loadHome() {
  const dateInput = document.querySelector('#schedule-date');
  const content = document.querySelector('#schedule-content');
  if (!dateInput || !content) return;
  dateInput.value = localDateKey();
  let requestSequence = 0;
  let contacts = [];
  let contactsCacheAt = 0;
  let contactsRequest = null;
  const vacationsCache = new Map();
  const renderSchedule = (schedule, selectedDate, selectedVacations, selectedContacts, syncState = '') => {
    if (!schedule) {
      content.innerHTML = '<p class="empty-state">Nenhuma escala publicada para esta data.</p>';
      return;
    }
    const scheduleView = buildScheduleView(schedule, selectedDate, selectedVacations, selectedContacts);
    const highlightedSiglas = new Set(Array.isArray(schedule.highlights?.siglas) ? schedule.highlights.siglas : []);
    const eventSiglas = new Set((Array.isArray(schedule.highlights?.events) ? schedule.highlights.events : []).map((value) => String(value || '').trim().toUpperCase().replace(/^EVENTO:/, '').split(':', 1)[0]).filter(Boolean));
    const cards = scheduleView.positions.map((position, index) => {
      const hasContact = position.contacts.length > 0;
      const canLaunchEvent = can('eventsWrite') && featureEnabledForRoute('events', appFeatures);
      const showVacationRank = position.siglas.length > 1;
      const singleSiglaOnVacation = !showVacationRank && position.vacationParts.length === 1;
      const aliases = position.sigla === 'DC' && position.siglas.length ? `<small class="sigla-token__aliases">${renderScheduleAliases(position.siglas, position.vacationParts, [...highlightedSiglas], scheduleView.vacationPositions, showVacationRank)}</small>` : '';
      const tokenLabel = position.sigla === 'DC' ? '<strong>DC</strong>' : `<strong>${renderScheduleSigla(position.sigla, position.vacationParts, position.siglas.filter((sigla) => highlightedSiglas.has(sigla)), scheduleView.vacationPositions, showVacationRank)}</strong>`;
      const marked = highlightedSiglas.has(position.sigla);
      const eventMarked = eventSiglas.has(position.sigla) || position.siglas.some((sigla) => eventSiglas.has(sigla));
      const vacationDescription = position.vacationParts.length ? `; em férias: ${position.vacationParts.map((sigla) => `${sigla}, posição ${position.vacationPositions[sigla]} na escala de férias`).join('; ')}` : '';
      return `<div class="sigla-item"><button class="sigla-token sigla-button${singleSiglaOnVacation ? ' sigla-token--vacation' : ''}${marked ? ' sigla-token--checked' : ''}${eventMarked ? ' sigla-token--event' : ''}" type="button" data-contact-index="${index}" ${hasContact || canLaunchEvent ? '' : 'disabled'} aria-label="${hasContact ? `Abrir contato da sigla ${escapeHtml(position.sigla)}` : canLaunchEvent ? `Lançar evento pela sigla ${escapeHtml(position.sigla)}` : `Contato não cadastrado para ${escapeHtml(position.sigla)}`}${escapeHtml(vacationDescription)}" title="${hasContact ? 'Abrir contato' : canLaunchEvent ? 'Lançar evento' : 'Contato não cadastrado'}">${tokenLabel}${aliases}</button><div class="sigla-index">${escapeHtml(position.function || position.position || String(index + 1))}</div></div>`;
    }).join('');
    content.innerHTML = `${syncState}${schedule.stale ? '<p class="sync-state">Mostrando a última escala salva neste aparelho.</p>' : ''}${cards ? `<div class="siglas-grid">${cards}</div>` : '<p class="empty-state">A escala está publicada sem itens.</p>'}`;
    content.querySelectorAll('[data-contact-index]').forEach((button) => button.addEventListener('click', () => {
      const position = scheduleView.positions[Number(button.dataset.contactIndex)];
      if (position?.contacts.length) showScheduleContacts(position.contacts, {
        sigla: position.sigla,
        date: selectedDate,
        groupSiglas: position.contacts.map((contact) => String(contact.sigla || '').toUpperCase()),
        highlightedSiglas: Array.isArray(schedule.highlights?.siglas) ? schedule.highlights.siglas : [],
        canRelease: can('scheduleWrite'),
        onRelease: () => void render()
      });
      else if (position && can('eventsWrite') && featureEnabledForRoute('events', appFeatures)) {
        pendingEventPosition = {day: selectedDate, position};
        navigate('events');
      }
    }));
  };
  const render = async () => {
    const requestId = ++requestSequence;
    const selectedDate = dateInput.value;
    if (!selectedDate) return;
    content.innerHTML = '<p class="loading">Carregando escala…</p>';
    let schedule = null;
    let selectedContacts = contacts;
    let selectedVacations = [];
    let schedulePending = true;
    let scheduleError = false;
    let contactsError = false;
    let vacationsError = false;
    const draw = () => {
      if (requestId !== requestSequence || !content.isConnected) return;
      const messages = [];
      if (schedulePending && schedule) messages.push('<p class="sync-state">Atualizando a escala…</p>');
      if (scheduleError && schedule) messages.push('<p class="sync-state">Não foi possível atualizar; exibindo a última escala salva.</p>');
      if (contactsError) messages.push('<p class="sync-state">Contatos indisponíveis; a escala continua acessível.</p>');
      else if (selectedContacts.stale || selectedContacts.some((contact) => contact.stale)) messages.push('<p class="sync-state">Contatos carregados do cache deste aparelho.</p>');
      if (vacationsError) messages.push('<p class="sync-state">Férias indisponíveis para esta data.</p>');
      else if (selectedVacations.stale || selectedVacations.some((vacation) => vacation.stale)) messages.push('<p class="sync-state">Férias carregadas do cache deste aparelho.</p>');
      if (!schedule && schedulePending) {
        content.innerHTML = `${messages.join('')}<p class="loading">Carregando escala…</p>`;
        return;
      }
      if (!schedule && scheduleError) {
        content.innerHTML = `${messages.join('')}<p class="empty-state">Não foi possível carregar a escala.</p>`;
        return;
      }
      renderSchedule(schedule, selectedDate, selectedVacations, selectedContacts, messages.join(''));
    };
    try {
      try {
        const cachedSchedule = await readCachedSchedule(session.user.uid, selectedDate);
        if (cachedSchedule && requestId === requestSequence && content.isConnected) {
          schedule = cachedSchedule;
          draw();
        }
      } catch {}
      const {readSchedule, listActiveContacts, listVacationsForDate} = await import('./data-lite.js');
      const readContacts = () => {
        if (contactsCacheAt && Date.now() - contactsCacheAt < 30_000) return Promise.resolve(contacts);
        if (!contactsRequest) contactsRequest = listActiveContacts({uid: session.user.uid, pageSize: 200})
          .then((items) => { contacts = items; contactsCacheAt = Date.now(); return items; })
          .finally(() => { contactsRequest = null; });
        return contactsRequest;
      };
      const readVacations = () => {
        const cached = vacationsCache.get(selectedDate);
        if (cached && Date.now() - cached.at < 30_000) return Promise.resolve(cached.items);
        return listVacationsForDate(selectedDate, {uid: session.user.uid}).then((items) => {
          vacationsCache.set(selectedDate, {items, at: Date.now()});
          if (vacationsCache.size > 40) vacationsCache.delete(vacationsCache.keys().next().value);
          return items;
        });
      };
      void readSchedule(selectedDate, session.user.uid).then((value) => {
        if (requestId !== requestSequence || !content.isConnected) return;
        schedule = value;
        schedulePending = false;
        draw();
      }).catch(() => {
        if (requestId !== requestSequence || !content.isConnected) return;
        schedulePending = false;
        scheduleError = true;
        draw();
      });
      void readContacts().then((items) => {
        if (requestId !== requestSequence || !content.isConnected) return;
        contacts = items;
        selectedContacts = items;
        draw();
      }).catch(() => {
        if (requestId !== requestSequence || !content.isConnected) return;
        contactsError = true;
        draw();
      });
      void readVacations().then((items) => {
        if (requestId !== requestSequence || !content.isConnected) return;
        selectedVacations = items;
        draw();
      }).catch(() => {
        if (requestId !== requestSequence || !content.isConnected) return;
        vacationsError = true;
        draw();
      });
    } catch (error) {
      if (requestId !== requestSequence || !content.isConnected) return;
      schedulePending = false;
      scheduleError = true;
      draw();
    }
  };
  document.querySelector('#schedule-previous')?.addEventListener('click', () => {
    dateInput.value = shiftDateKey(dateInput.value, -1);
    void render();
  });
  document.querySelector('#schedule-today')?.addEventListener('click', () => {
    dateInput.value = localDateKey();
    void render();
  });
  document.querySelector('#schedule-next')?.addEventListener('click', () => {
    dateInput.value = shiftDateKey(dateInput.value, 1);
    void render();
  });
  dateInput.addEventListener('change', render);
  await render();
}

function showScheduleContacts(contacts, context = {}) {
  const dialog = document.querySelector('#schedule-contact-dialog');
  const content = document.querySelector('#schedule-contact-details');
  if (!dialog || !content) return;
  const siglaLabel = context.sigla || '';
  const records = contacts.filter((contact, index, all) => all.findIndex((item) => item.sigla === contact.sigla) === index);
  const cards = records.map((contact) => {
    const links = contactActionLinks(contact);
    const actions = `${links.phone ? `<a class="contact-action" href="tel:${links.phone}">Ligar</a>` : ''}${links.email ? `<a class="contact-action" href="mailto:${encodeURIComponent(links.email)}">Enviar e-mail</a>` : ''}${links.whatsApp ? `<a class="contact-action" href="${escapeHtml(links.whatsApp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}`;
    const released = (context.highlightedSiglas || []).includes(String(contact.sigla || '').toUpperCase());
    const release = context.canRelease ? `<button class="contact-action schedule-release${released ? ' is-released' : ''}" type="button" data-release-sigla="${escapeHtml(contact.sigla)}" aria-pressed="${released}" aria-label="Liberar ${escapeHtml(contact.name)}">LIBERAR</button>` : '';
    return `<article class="schedule-contact-record">${records.length > 1 ? `<h4>${escapeHtml(contact.name)}</h4>` : ''}<div class="contact-detail-actions">${release}${actions}</div></article>`;
  }).join('');
  content.innerHTML = `<p class="eyebrow">SIGLA ${escapeHtml(siglaLabel)}</p><h3 id="schedule-contact-heading">${records.length > 1 ? `Contatos vinculados a ${escapeHtml(siglaLabel)}` : escapeHtml(records[0]?.name || 'Contato')}</h3><p class="schedule-release-status" data-release-status role="status" aria-live="polite"></p>${cards || '<p class="empty-state">Nenhum contato encontrado para esta sigla.</p>'}`;
  content.querySelectorAll('[data-release-sigla]').forEach((button) => button.addEventListener('click', async () => {
    const status = content.querySelector('[data-release-status]');
    const marked = button.getAttribute('aria-pressed') !== 'true';
    button.disabled = true;
    if (status) status.textContent = 'Salvando…';
    try {
      const {setScheduleSiglaRelease} = await import('./data.js');
      const updated = await setScheduleSiglaRelease(context.date, button.dataset.releaseSigla, marked, {
        groupSiglas: context.groupSiglas,
        tokenSigla: context.sigla,
        uid: session.user.uid,
        currentSiglas: context.highlightedSiglas
      });
      context.highlightedSiglas = updated.highlights?.siglas || [];
      content.querySelectorAll('[data-release-sigla]').forEach((item) => {
        const itemMarked = context.highlightedSiglas.includes(String(item.dataset.releaseSigla || '').toUpperCase());
        item.setAttribute('aria-pressed', String(itemMarked));
        item.textContent = 'LIBERAR';
        item.classList.toggle('is-released', itemMarked);
        item.disabled = false;
      });
      if (status) status.textContent = updated.pendingFirestore
        ? 'Liberação salva neste aparelho; aguardando confirmação do Firestore.'
        : marked ? 'Sigla liberada para esta data.' : 'Liberação removida para esta data.';
      context.onRelease?.();
    } catch {
      button.disabled = false;
      if (status) status.textContent = 'Não foi possível salvar a liberação. Confira a conexão e sua permissão para editar a escala.';
    }
  }));
  dialog.showModal();
}

async function loadModule(route) {
  const content = document.querySelector('#module-content');
  if (!content) return;
  if (!featureEnabledForRoute(route, appFeatures)) {
    navigate('home');
    return;
  }
  if (route === 'offline') {
    await loadOfflineView(content);
    return;
  }
  if (route === 'management' && hasFinanceOnlyManagementAccess(session.profile)) {
    content.innerHTML = '<section class="management-area-detail"><header class="management-detail-heading"><div><p class="eyebrow">ACESSO RESTRITO</p><h3>Gestão Financeira</h3></div></header><p>Seu perfil tem acesso à área financeira. Os campos, relatórios e operações ainda não foram configurados; nenhum dado financeiro está disponível nesta versão.</p></section>';
    return;
  }
  if (route === 'events') {
    content.remove();
    if (can('eventsRead') || can('eventsWrite')) void loadReportPdfModule().catch(() => {});
    document.querySelectorAll('[data-event-report-mode]').forEach((button) => button.addEventListener('click', async () => {
      eventReportMode = button.dataset.eventReportMode;
      document.querySelectorAll('[data-event-report-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      document.querySelector('#event-day-control').hidden = eventReportMode !== 'daily';
      document.querySelector('#event-month-control').hidden = eventReportMode !== 'monthly';
      await loadEventReport();
    }));
    document.querySelector('#event-report-day')?.addEventListener('change', loadEventReport);
    document.querySelector('#event-report-month')?.addEventListener('change', loadEventReport);
    document.querySelector('#event-report-person')?.addEventListener('input', renderEventReportRecords);
    document.querySelector('#export-events')?.addEventListener('click', exportEventReport);
    document.querySelector('#share-events-pdf')?.addEventListener('click', () => shareReportPdf('events'));
    document.querySelector('#event-edit-cancel')?.addEventListener('click', resetEventEditor);
    await loadEventEntryCatalog();
    bindEventSchedule();
    await loadEventReport();
    if (pendingEventPosition) {
      const {day, position} = pendingEventPosition;
      pendingEventPosition = null;
      const scheduleDate = document.querySelector('#event-schedule-date');
      if (scheduleDate && scheduleDate.value !== day) {
        scheduleDate.value = day;
        scheduleDate.dispatchEvent(new Event('change'));
      }
      void launchEventFromSchedule(day, position);
    }
    return;
  }
  if (route === 'labels') {
    content.remove();
    void loadReportPdfModule().catch(() => {});
    document.querySelectorAll('[data-label-report-mode]').forEach((button) => button.addEventListener('click', async () => {
      labelReportMode = button.dataset.labelReportMode;
      document.querySelectorAll('[data-label-report-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      document.querySelector('#label-day-control').hidden = labelReportMode !== 'daily';
      document.querySelector('#label-month-control').hidden = labelReportMode !== 'monthly';
      await loadLabelReport();
    }));
    document.querySelector('#label-report-day')?.addEventListener('change', loadLabelReport);
    document.querySelector('#label-report-month')?.addEventListener('change', loadLabelReport);
    document.querySelector('#export-labels')?.addEventListener('click', exportLabelReport);
    document.querySelector('#share-labels-pdf')?.addEventListener('click', () => shareReportPdf('labels'));
    document.querySelector('#label-edit-cancel')?.addEventListener('click', resetLabelEditor);
    await loadLabelStaffCatalog();
    const catalogForm = document.querySelector('#label-staff-catalog-form');
    catalogForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = catalogForm.querySelector('[type="submit"]');
      const status = catalogForm.querySelector('#label-staff-catalog-status');
      submit.disabled = true;
      if (status) status.textContent = 'Salvando catálogo…';
      try {
        const {saveLabelStaffSiglas} = await import('./data.js');
        await saveLabelStaffSiglas(catalogForm.elements.siglas.value, session.user.uid);
        notice = 'Catálogo de plantonistas salvo no Firestore.';
        await render();
      } catch (error) {
        if (status) status.textContent = `Não foi possível salvar. ${error.message || ''}`;
        submit.disabled = false;
      }
    });
    await loadLabelReport();
    return;
  }
  if (route === 'admin') {
    await loadAdminModule(content);
    return;
  }
  if (route === 'people') {
    try {
      const {listContactCatalog} = await import('./data.js');
      const contacts = await listContactCatalog();
      content.innerHTML = `${contacts.length ? `<ul class="record-list">${contacts.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.sigla)} · ${escapeHtml(item.name)}</strong><button class="secondary-button" type="button" data-contact-edit="${escapeHtml(item.sigla)}">Editar</button></div><small>${escapeHtml(item.role || '')}${item.phone ? ` · ${escapeHtml(item.phone)}` : ''}</small><small class="record-meta">${item.active ? 'Ativo' : 'Inativo'}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhum contato cadastrado. Use o formulário acima para criar o catálogo inicial.</p>'}<button class="secondary-button" type="button" id="sync-event-members">Atualizar siglas de Eventos</button><p id="event-members-sync-status" class="record-meta" role="status" aria-live="polite"></p>`;
      content.querySelector('#sync-event-members')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const status = content.querySelector('#event-members-sync-status');
        button.disabled = true;
        if (status) status.textContent = 'Sincronizando somente sigla, nome e estado ativo…';
        try {
          const {syncEventMemberDirectory} = await import('./data.js');
          const count = await syncEventMemberDirectory(session.user.uid);
          if (status) status.textContent = `${count} contato(s) processado(s). O seletor de Eventos já pode usar as siglas ativas.`;
        } catch (error) {
          if (status) status.textContent = `Não foi possível atualizar o catálogo. ${error.message || ''}`;
          button.disabled = false;
        }
      });
      content.querySelectorAll('[data-contact-edit]').forEach((button) => button.addEventListener('click', () => {
        const contact = contacts.find((item) => item.sigla === button.dataset.contactEdit);
        const form = document.querySelector('[data-module-form="people"]');
        if (!contact || !form) return;
        for (const field of ['sigla', 'name', 'role', 'phone', 'email', 'whatsAppLink', 'crm', 'entryDate']) form.elements[field].value = contact[field] || '';
        form.elements.active.checked = contact.active === true;
        form.elements.sigla.readOnly = true;
        form.scrollIntoView({behavior: 'smooth', block: 'center'});
        form.elements.name.focus({preventScroll: true});
      }));
    } catch (error) {
      content.innerHTML = `<p class="empty-state">Não foi possível carregar os contatos. ${escapeHtml(error.message || '')}</p>`;
    }
    return;
  }
  if (route === 'notifications') {
    try {
      const {listNotifications} = await import('./data.js');
      const items = await listNotifications(session.profile, {canManage: can('notificationsManage')});
      const canAcknowledge = can('notificationsRead') && !can('notificationsManage');
      const unreadCount = items.filter((item) => !item.read).length;
      content.innerHTML = items.length ? `${canAcknowledge ? `<p class="sync-state" id="notification-read-summary">${unreadCount} comunicado(s) não lido(s).</p>` : ''}<ul class="record-list notification-list">${items.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.title)}</strong><small class="record-meta">${escapeHtml(item.type || 'INFO')} · prioridade ${escapeHtml(item.priority)}</small></div><p>${escapeHtml(item.message)}</p><small>${escapeHtml(interactionDateTime(item.createdAt))}${can('notificationsManage') ? ` · Público: ${escapeHtml(item.audienceType)}${item.audienceValue ? ` (${escapeHtml(item.audienceValue)})` : ''}` : ''}</small>${item.actionRoute ? `<button class="secondary-button" type="button" data-notification-route="${escapeHtml(item.actionRoute)}">Abrir área</button>` : ''}${canAcknowledge ? `<button class="secondary-button" type="button" data-notification-read="${escapeHtml(item.id)}" ${item.read ? 'disabled' : ''}>${item.read ? 'Lido' : 'Marcar como lido'}</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty-state">Não há comunicados ativos para sua sessão.</p>';
      content.querySelectorAll('[data-notification-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.notificationRoute)));
      content.querySelectorAll('[data-notification-read]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const {markNotificationRead} = await import('./data.js');
          await markNotificationRead(button.dataset.notificationRead, session.user.uid);
          button.textContent = 'Lido';
          const remaining = content.querySelectorAll('[data-notification-read]:not(:disabled)').length;
          const summary = content.querySelector('#notification-read-summary');
          if (summary) summary.textContent = `${remaining} comunicado(s) não lido(s).`;
        } catch (error) {
          button.disabled = false;
          const message = document.createElement('small');
          message.className = 'form-error';
          message.textContent = error.message || 'Não foi possível confirmar a leitura.';
          button.after(message);
        }
      }));
    } catch (error) {
      content.innerHTML = `<p class="empty-state">Não foi possível carregar os comunicados. ${escapeHtml(error.message || '')}</p>`;
    }
    return;
  }
  try {
    const data = await import('./data.js');
    let items;
    if (route === 'training' && can('trainingsManage')) {
      loadedTrainingCatalog = await data.listTrainingCatalogForAdmin();
      renderTrainingAdminList(loadedTrainingCatalog);
      items = loadedTrainingCatalog.filter((item) => item.active === true);
    } else if (route === 'management' && session.profile?.permissions?.qualityManage === true &&
      !['managementManage', 'managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage', 'equipmentManage'].some((permission) => session.profile?.permissions?.[permission] === true)) {
      const qualityArea = await data.getManagementArea('area-gestao-da-qualidade');
      items = qualityArea ? [qualityArea] : [];
    } else {
      loadedTrainingCatalog = [];
      items = await data.listModuleRecords(route, session.user.uid, {pageSize: route === 'checklist' ? 200 : 50});
    }
    if (route === 'training') {
      let learningActivities = [];
      let learningReceipts = [];
      let learningError = '';
      try {
        learningActivities = await data.listLearningActivities(session.profile, session.user.uid);
        learningReceipts = await data.listLearningActivityReceipts(session.user.uid, learningActivities);
      } catch (error) {
        learningError = error.message || 'Verifique a conexão e as permissões Firestore.';
      }
      if (can('trainingsManage')) {
        try {
          loadedLearningActivityCatalog = await data.listLearningActivitiesForAdmin();
          renderLearningActivityAdminList(loadedLearningActivityCatalog);
        } catch (error) {
          loadedLearningActivityCatalog = [];
          const target = document.querySelector('#learning-activity-admin-list');
          if (target) target.innerHTML = `<p class="empty-state">Não foi possível carregar o catálogo. ${escapeHtml(error.message || '')}</p>`;
        }
      } else {
        loadedLearningActivityCatalog = [];
      }
      const {mountTrainingModule} = await import('./training.js');
      cleanupCurrentModule = await mountTrainingModule(content, {uid: session.user.uid, trainings: items, learningActivities, learningReceipts, learningError});
      return;
    }
    if (route === 'checklist') {
      document.querySelectorAll('[data-checklist-report-mode]').forEach((button) => button.addEventListener('click', async () => {
        checklistReportMode = button.dataset.checklistReportMode;
        document.querySelectorAll('[data-checklist-report-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
        document.querySelector('#checklist-day-control').hidden = checklistReportMode !== 'daily';
        document.querySelector('#checklist-month-control').hidden = checklistReportMode !== 'monthly';
        const scanButton = document.querySelector('#checklist-scan-qr');
        if (scanButton) scanButton.hidden = checklistReportMode !== 'daily';
        const photoButton = document.querySelector('#checklist-qr-photo');
        if (photoButton) photoButton.hidden = checklistReportMode !== 'daily';
        await loadChecklistView(items);
      }));
      document.querySelector('#checklist-day')?.addEventListener('change', () => loadChecklistView(items));
      document.querySelector('#checklist-month')?.addEventListener('change', () => loadChecklistView(items));
      document.querySelector('#checklist-refresh')?.addEventListener('click', () => loadChecklistView(items));
      await loadChecklistView(items);
      await loadChecklistStationAdmin();
      return;
    }
    if (route === 'management') {
      if (!items.some((item) => item.id === selectedManagementAreaId)) selectedManagementAreaId = items[0]?.id || '';
      const areas = items.map((item) => `<button class="area-card${item.id === selectedManagementAreaId ? ' is-selected' : ''}" type="button" data-management-area="${escapeHtml(item.id)}" aria-pressed="${item.id === selectedManagementAreaId}"><span class="module-mark">${escapeHtml(item.shortName || item.icon || 'GE')}</span><span><strong>${escapeHtml(item.name || item.title || item.id)}</strong><small>${escapeHtml(item.description || '')}</small></span><span class="arrow" aria-hidden="true">›</span></button>`).join('');
      const seedPanel = can('managementManage') ? `<section class="management-seed-panel"><p>Catálogo-base V1: 12 nomes confirmados. Criar apenas áreas ausentes; gestores e membros ficam sem atribuição até configuração autorizada.</p><button class="secondary-button" id="seed-management-areas" type="button">Completar catálogo de Gestão</button></section>` : '';
      content.innerHTML = `${seedPanel}${areas ? `<div class="area-grid">${areas}</div><p class="area-footer">ESG e Inovação permanecem desativadas até existir conteúdo aprovado.</p><section class="management-area-detail" id="management-area-detail" aria-live="polite"><p class="loading">Carregando atividades…</p></section>` : '<p class="empty-state">As áreas de Gestão serão carregadas da configuração do Firestore.</p>'}`;
      content.querySelector('#seed-management-areas')?.addEventListener('click', async (event) => {
        if (!window.confirm('Criar no Firestore as áreas V1 ausentes? A ação não importará gestores, membros ou conteúdos.')) return;
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const {ensureManagementAreaCatalog} = await import('./data.js');
          const result = await ensureManagementAreaCatalog(session.user.uid);
          notice = result.created
            ? `${result.created} área(s) criada(s); ${result.existing} já existiam. Gestores e membros não foram atribuídos.`
            : `As 12 áreas já existem; nenhum dado foi alterado. Verifique se estão ativas.`;
          await render();
        } catch (error) {
          notice = `Não foi possível completar o catálogo. ${error.message || ''}`;
          await render();
        }
      });
      if (items.length) {
        await populateSelect('#activity-area', items, 'Selecione uma área');
        const areaSelect = document.querySelector('#activity-area');
        if (areaSelect) areaSelect.value = selectedManagementAreaId;
        content.querySelectorAll('[data-management-area]').forEach((button) => button.addEventListener('click', async () => {
          selectedManagementAreaId = button.dataset.managementArea;
          content.querySelectorAll('[data-management-area]').forEach((card) => {
            const selected = card.dataset.managementArea === selectedManagementAreaId;
            card.classList.toggle('is-selected', selected);
            card.setAttribute('aria-pressed', String(selected));
          });
          const select = document.querySelector('#activity-area');
          if (select) select.value = selectedManagementAreaId;
          await loadManagementAreaActivities(items.find((area) => area.id === selectedManagementAreaId));
        }));
        await loadManagementAreaActivities(items.find((area) => area.id === selectedManagementAreaId));
      }
    } else {
      const heading = (item) => route === 'events'
        ? `${item.memberName || 'Evento'}${item.date ? ` · ${item.date}` : ''}`
        : route === 'labels'
          ? `${item.patientName || 'Etiqueta'}${item.date ? ` · ${formatRecordDate(item.date)}` : ''}`
          : route === 'checklist'
            ? `${item.stationName || item.stationId || 'Checklist'}${item.date ? ` · ${item.date}` : ''}`
            : item.title || item.name || item.label || item.sigla || item.id;
    content.innerHTML = items.length ? `<ul class="record-list">${items.map((item) => `<li><strong>${escapeHtml(heading(item))}</strong>${route === 'labels' ? `<small>${escapeHtml(item.type || '')}${item.encounterCode ? ` · Atendimento ${escapeHtml(item.encounterCode)}` : ''}</small><small>${escapeHtml(item.creditor || '')}${item.staffSiglas?.length ? ` · ${escapeHtml(item.staffSiglas.join(', '))}` : ''}</small>` : item.description || item.occurrence ? `<small>${escapeHtml(item.description || item.occurrence)}</small>` : ''}${item.status ? `<small class="record-meta">${escapeHtml(item.status)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="empty-state">Nenhum registro disponível.</p>';
    }
    if (route === 'management') await populateSelect('#activity-area', items, 'Selecione uma área');
  } catch (error) {
    content.innerHTML = `<p class="empty-state">Não foi possível carregar esta área. ${escapeHtml(error.message || '')}</p>`;
  }
}

async function loadChecklistView(stations) {
  if (checklistReportMode === 'monthly') return loadMonthlyChecklist(stations);
  return loadDailyChecklist(stations);
}

async function loadOfflineView(target) {
  const uid = session.user.uid;
  try {
    const [counts, unsettled, pendingProgress] = await Promise.all([
      operationCounts(uid),
      listUnsettledOperations(uid),
      listPendingTrainingProgress(uid)
    ]);
    const labelsByType = {events: 'Evento', eventEdits: 'Edição de evento', labels: 'Etiqueta', checklists: 'Checklist', activities: 'Atividade', scheduleReleases: 'Liberação da escala'};
    const today = todayInputValue();
    const retryableFailed = counts.failed;
    const rows = unsettled.map((item) => {
      const dateDiffers = isChecklistDateDifferentFromLocalDay(item, today);
      const versionConflict = item.status === 'conflict' && item.type === 'eventEdits';
      const retryAt = Number(item.nextAttemptAt);
      const retryScheduled = item.status === 'queued' && Number.isFinite(retryAt) && retryAt > Date.now();
      const operationStatus = item.status === 'conflict'
        ? 'Conflito para comparar'
        : item.status === 'failed'
          ? 'Revisar'
          : !navigator.onLine
            ? 'Aguardando conexão'
            : retryScheduled
              ? 'Nova tentativa agendada'
              : 'Aguardando envio';
      const retryInfo = retryScheduled
        ? `<small class="record-meta">${item.lastError ? `Falha temporária: ${escapeHtml(item.lastError)} · ` : ''}Nova tentativa automática prevista às ${escapeHtml(new Date(retryAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}))}.</small>`
        : '';
      const resolution = item.status !== 'queued'
        ? `${dateDiffers
          ? `<small class="sync-error">A data do Checklist (${escapeHtml(formatRecordDate(item.payload.data.date))}) difere do dia atual exibido neste aparelho. O Firestore autoriza gravação apenas no dia do servidor. Se a verificação pertence a um dia anterior, faça uma nova verificação para hoje${can('checklistWrite') ? '' : ' e peça revisão ao administrador'}.</small>${can('checklistWrite') ? '<button class="secondary-button" type="button" data-open-current-checklist>Abrir Checklist de hoje</button>' : ''}`
          : versionConflict
            ? `<small class="sync-error">O evento mudou no Firestore desde a versão ${Number(item.payload.expectedVersion)}. O rascunho local foi preservado para comparação; abra Eventos, atualize o relatório e aplique manualmente suas alterações ao registro atual.</small>`
            : item.lastError ? `<small class="sync-error">${escapeHtml(item.lastError)}</small>` : ''}${!dateDiffers && !versionConflict ? `<button class="secondary-button" type="button" data-retry-operation="${escapeHtml(item.requestId)}" ${navigator.onLine ? '' : 'disabled'}>Tentar esta ação novamente</button>` : ''}<button class="text-button" type="button" data-discard-operation="${escapeHtml(item.requestId)}">Descartar cópia local</button>`
        : '';
      const description = item.type === 'scheduleReleases'
        ? `${item.payload.sigla} · ${formatRecordDate(item.payload.day)}`
        : item.type === 'eventEdits'
          ? `Evento ${item.resourceId} · versão base ${Number(item.payload.expectedVersion)}`
        : `ID ${item.resourceId}`;
      return `<li><strong>${escapeHtml(labelsByType[item.type] || item.type)} · ${operationStatus}</strong><small>${escapeHtml(formatRecordDate(item.createdAt))} · ${escapeHtml(description)}</small>${retryInfo}${resolution}</li>`;
    }).join('');
    const trainingRows = pendingProgress.map((item) => {
      const percent = item.duration ? Math.min(100, Math.round((item.lastPosition / item.duration) * 100)) : 0;
      const remote = item.syncConflictRemote;
      const remoteWatched = (remote?.watchedRanges || []).reduce((total, range) => {
        const start = Number(range?.start);
        const end = Number(range?.end);
        return total + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0);
      }, 0);
      const remotePercent = remote?.duration ? Math.min(100, Math.round((remoteWatched / remote.duration) * 100)) : 0;
      const comparison = remote ? `<small class="sync-error">Firestore: ${remotePercent}% (${Math.floor(remote.lastPosition || 0)} s de ${Math.floor(remote.duration || 0)} s). Cópia local: ${percent}% (${Math.floor(item.lastPosition || 0)} s de ${Math.floor(item.duration || 0)} s). As durações diferem; o progresso não foi mesclado.</small>` : '';
      const retry = item.syncConflict ? '' : `<button class="secondary-button" type="button" data-retry-training="${escapeHtml(item.trainingId)}" ${navigator.onLine ? '' : 'disabled'}>Tentar este progresso novamente</button>`;
      const error = item.syncError ? `<small class="sync-error">Falha: ${escapeHtml(item.syncError)}${item.syncAttempts ? ` · ${item.syncAttempts} tentativa(s)` : ''}</small>${retry}` : '<small>Aguardando sincronização</small>';
      return `<li><strong>Treinamento · ${escapeHtml(item.trainingId)}</strong><small>${percent}% concluído · posição ${Math.floor(item.lastPosition || 0)} s</small>${comparison}${error}<button class="text-button" type="button" data-discard-training="${escapeHtml(item.trainingId)}">Descartar cópia local</button></li>`;
    }).join('');
    const failedTrainingCount = pendingProgress.filter((item) => item.syncError).length;
    target.innerHTML = `<nav class="offline-view-tabs" aria-label="Opções offline"><button type="button" id="offline-tab-sync" aria-pressed="${offlineViewMode === 'sync'}">Sincronização</button><button type="button" id="offline-tab-gallery" aria-pressed="${offlineViewMode === 'gallery'}">Escala/Férias 2026</button></nav><section id="offline-sync-panel"><section class="offline-panel" aria-live="polite"><header class="management-detail-heading"><div><p class="eyebrow">ESTADO DO DISPOSITIVO</p><h3>${navigator.onLine ? 'Conexão disponível' : 'Sem conexão'}</h3></div><button type="button" class="secondary-button" id="offline-refresh">Atualizar</button></header>
      <p>${counts.queued ? `${counts.queued} ação(ões) aguardando envio ao Firestore.` : 'Nenhuma ação operacional aguardando envio.'}${counts.failed ? ` ${counts.failed} ação(ões) foram recusadas e precisam de revisão.` : ''}${counts.conflict ? ` ${counts.conflict} edição(ões) têm conflito de versão e aguardam comparação manual.` : ''}${pendingProgress.length ? ` Progresso de ${pendingProgress.length} treinamento(s) ainda não confirmado pelo Firestore${failedTrainingCount ? `; ${failedTrainingCount} com falha` : ''}.` : ''}</p>
      ${retryableFailed ? `<button class="primary-button" type="button" id="offline-retry" ${navigator.onLine ? '' : 'disabled'}>Tentar sincronizar novamente</button>` : ''}
      ${unsettled.length ? `<ul class="record-list">${rows}</ul>` : ''}${trainingRows ? `<h4>Progresso de treinamento</h4><ul class="record-list">${trainingRows}</ul>` : ''}${!unsettled.length && !trainingRows ? '<p class="empty-state">As gravações online são confirmadas diretamente pelo Firestore.</p>' : ''}
      <p class="offline-footnote">Ações pendentes só ficam confirmadas depois que o Firestore aceitar a sincronização. O perfil em cache permite abrir o shell temporariamente; as Rules do Firestore continuam sendo a autorização efetiva.</p></section></section>${offlineScheduleGalleryMarkup(import.meta.env.BASE_URL)}`;
    target.querySelector('#offline-sync-panel').hidden = offlineViewMode !== 'sync';
    target.querySelector('.offline-schedule-gallery').hidden = offlineViewMode !== 'gallery';
    target.querySelector('#offline-tab-sync')?.addEventListener('click', () => setOfflineViewMode(target, 'sync'));
    target.querySelector('#offline-tab-gallery')?.addEventListener('click', () => setOfflineViewMode(target, 'gallery'));
    target.querySelectorAll('.offline-schedule-nav a').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      target.querySelector(link.getAttribute('href'))?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }));
    target.querySelectorAll('.offline-schedule-image-card img').forEach((image) => image.addEventListener('error', () => {
      const status = target.querySelector('#offline-schedule-cache-status');
      if (status) status.textContent = navigator.onLine
        ? 'Uma imagem não foi carregada. Use “Preparar imagens offline” e tente novamente.'
        : 'Esta imagem ainda não foi armazenada neste aparelho. Conecte-se e prepare o conjunto offline.';
    }, {once: true}));
    target.querySelector('#offline-schedule-prepare')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = target.querySelector('#offline-schedule-cache-status');
      if (!navigator.onLine) {
        if (status) status.textContent = 'Sem conexão. Só estarão disponíveis as imagens abertas ou preparadas anteriormente neste aparelho.';
        return;
      }
      button.disabled = true;
      if (status) status.textContent = 'Preparando cópia offline…';
      try {
        const imageCache = await caches.open('sahmt-v2-offline-schedule-v1');
        await cacheOfflineScheduleImages({
          baseUrl: import.meta.env.BASE_URL,
          fetchImage: async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await imageCache.put(url, response.clone());
            if (!(await imageCache.match(url))) throw new Error('A imagem não ficou disponível no cache local.');
          },
          onStatus: (message) => { if (status?.isConnected) status.textContent = message; }
        });
      } catch (error) {
        if (status?.isConnected) status.textContent = `Não foi possível preparar o cache offline. ${error.message || ''}`;
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
    target.querySelector('#offline-refresh')?.addEventListener('click', () => loadOfflineView(target));
    target.querySelector('#offline-retry')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      await retryFailedOperations(uid);
      await syncOutbox();
      if (document.querySelector('#module-content') === target) await loadOfflineView(target);
    });
    target.querySelectorAll('[data-open-current-checklist]').forEach((button) => button.addEventListener('click', () => navigate('checklist')));
    target.querySelectorAll('[data-retry-operation]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (await retryFailedOperation(uid, button.dataset.retryOperation)) {
          const {flushOutbox} = await import('./data.js');
          await flushOutbox(uid, {requestId: button.dataset.retryOperation});
        }
      } finally {
        await scheduleNextOutboxRetry(uid);
        if (document.querySelector('#module-content') === target) await loadOfflineView(target);
        await updateOutboxStatus();
      }
    }));
    target.querySelectorAll('[data-discard-operation]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Esta ação não foi confirmada pelo Firestore. Descartar permanentemente a cópia que existe somente neste aparelho?')) return;
      await removeQueuedOperation(uid, button.dataset.discardOperation);
      await loadOfflineView(target);
      await updateOutboxStatus();
    }));
    target.querySelectorAll('[data-retry-training]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      const {retryTrainingProgress} = await import('./data.js');
      await retryTrainingProgress(uid, button.dataset.retryTraining);
      if (document.querySelector('#module-content') === target) await loadOfflineView(target);
      await updateOutboxStatus();
    }));
    target.querySelectorAll('[data-discard-training]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Este progresso ainda não foi confirmado pelo Firestore. Descartar permanentemente a cópia que existe somente neste aparelho?')) return;
      await discardCachedTrainingProgress(uid, button.dataset.discardTraining);
      await loadOfflineView(target);
      await updateOutboxStatus();
    }));
  } catch (error) {
    target.innerHTML = `<p class="empty-state">Não foi possível ler as ações locais. ${escapeHtml(error.message || '')}</p>`;
  }
}

function setOfflineViewMode(target, mode) {
  offlineViewMode = mode === 'gallery' ? 'gallery' : 'sync';
  const syncButton = target.querySelector('#offline-tab-sync');
  const galleryButton = target.querySelector('#offline-tab-gallery');
  const syncPanel = target.querySelector('#offline-sync-panel');
  const gallery = target.querySelector('.offline-schedule-gallery');
  if (syncPanel) syncPanel.hidden = offlineViewMode !== 'sync';
  if (gallery) gallery.hidden = offlineViewMode !== 'gallery';
  syncButton?.setAttribute('aria-pressed', String(offlineViewMode === 'sync'));
  galleryButton?.setAttribute('aria-pressed', String(offlineViewMode === 'gallery'));
  if (offlineViewMode === 'gallery' && navigator.onLine) {
    const status = target.querySelector('#offline-schedule-cache-status');
    if (status && !status.textContent) status.textContent = 'Toque em “Preparar imagens offline” para guardar as sete imagens neste aparelho.';
  }
}

async function loadAdminModule(content) {
  if (!can('usersManage')) {
    content.innerHTML = '<p class="empty-state">Seu perfil não tem permissão para gerenciar acessos.</p>';
    return;
  }
  content.innerHTML = '<p class="loading">Carregando perfis da V2…</p>';
  try {
    const {listUserProfiles, listAccessRequests} = await import('./data.js');
    const [profiles, accessRequests] = await Promise.all([listUserProfiles(), listAccessRequests()]);
    let configuredFeatures = appFeatures;
    if (can('admin')) {
      try { configuredFeatures = normalizeAppFeatures(await (await import('./data-lite.js')).readAppFeatures(session.user.uid)); }
      catch { configuredFeatures = appFeatures; }
    }
    const permissions = userPermissions.map(([id, title]) => `<label class="permission-option"><input type="checkbox" name="permission" value="${id}" ${['admin', 'usersManage'].includes(id) && !can('admin') ? 'disabled' : ''}><span>${escapeHtml(title)}</span></label>`).join('');
    const featureSettings = can('admin') ? `<section class="admin-user-form panel"><h3>Disponibilidade dos módulos</h3><p>Ative ou oculte áreas na Home sem editar o código. As regras de acesso do Firestore continuam valendo mesmo para uma área oculta.</p><form id="app-feature-form"><fieldset><legend>Módulos do SAHMT</legend><div class="permission-grid">${[
      ['checklist', 'Checklist'], ['labels', 'Etiquetas'], ['trainings', 'Treinamentos'], ['management', 'Gestão'], ['notifications', 'Notificações'],
      ['esg', 'ESG · preparado'], ['innovation', 'Inovação · preparada']
    ].map(([id, title]) => `<label class="permission-option"><input type="checkbox" name="feature" value="${id}" ${configuredFeatures[id] ? 'checked' : ''} ${['esg', 'innovation'].includes(id) ? 'disabled' : ''}><span>${escapeHtml(title)}</span></label>`).join('')}</div></fieldset><p class="record-meta">ESG e Inovação ficam desativadas enquanto não houver uma área publicada. Eventos, Pessoas, Administração, Home e Sincronização permanecem disponíveis conforme as permissões.</p><div class="admin-user-actions"><button class="secondary-button" type="submit">Salvar disponibilidade</button></div><p id="app-feature-status" class="record-meta" role="status" aria-live="polite"></p></form></section>` : '';
    const entries = profiles.map((profile) => {
      const active = profile.active === true && profile.access === true;
      const self = profile.uid === session.user.uid;
      const permissionSummary = Object.keys(profile.permissions || {}).filter((key) => profile.permissions[key] === true).length;
      const privileged = profile.role === 'administrador_app' || profile.permissions?.admin === true || profile.permissions?.usersManage === true;
      const editControl = self ? '<span class="record-meta">Perfil atual</span>' : privileged && !can('admin') ? '<span class="record-meta">Edição restrita a administrador</span>' : `<button type="button" class="secondary-button" data-edit-user="${escapeHtml(profile.uid)}">Editar</button>`;
      return `<article class="user-profile-row" data-admin-user-row data-search="${escapeHtml(`${profile.displayName || ''} ${profile.email || ''} ${profile.sigla || ''} ${profile.uid || ''}`.toLowerCase())}"><div><strong>${escapeHtml(profile.displayName || profile.email || profile.uid)}</strong><small>${escapeHtml([profile.sigla, profile.role, profile.email].filter(Boolean).join(' · '))}</small><small>${active ? 'Acesso ativo' : 'Acesso bloqueado'} · ${permissionSummary} permissões${self ? ' · sua conta' : ''}</small><code>${escapeHtml(profile.uid || '')}</code></div>${editControl}</article>`;
    }).join('');
    const requestEntries = accessRequests.map((request) => `<article class="user-profile-row"><div><strong>${escapeHtml(request.displayName || request.email)}</strong><small>${escapeHtml(request.email)} · Solicitação pendente</small></div><button type="button" class="secondary-button" data-review-access="${escapeHtml(request.uid)}">Configurar acesso</button></article>`).join('');
    content.innerHTML = `<p class="admin-auth-note">Este painel gerencia perfis e configurações SAHMT no Firestore. No fluxo normal, a pessoa entra com Google e toca em “Solicitar acesso ao SAHMT”; o pedido aparece abaixo com UID, e-mail e nome preenchidos. Não é necessário pedir nem copiar o UID por mensagem. Isso não cria contas Google nem senhas; nenhuma busca em planilha ou chamada ao Apps Script participa do acesso.</p>
      <section class="admin-user-list"><div class="admin-list-heading"><h3>Solicitações de acesso</h3></div><p class="record-meta">Pedidos feitos no login aparecem aqui. Eles não concedem acesso automaticamente; escolha função e permissões antes de provisionar.</p>${requestEntries || '<p class="empty-state">Nenhuma solicitação pendente.</p>'}</section>
      ${featureSettings}
      <details id="admin-user-editor" class="quick-form admin-user-form"><summary id="user-form-summary">Configurar um pedido ou editar perfil</summary><section class="panel"><h3 id="user-form-title">Provisionar perfil SAHMT</h3><p>Ao abrir um pedido, UID, e-mail e nome são preenchidos automaticamente. O cadastro manual sem pedido fica reservado a casos administrativos excepcionais.</p>
        <form id="admin-user-form"><div class="form-grid"><label>UID Firebase<input name="uid" required maxlength="128" autocomplete="off" placeholder="Preenchido pelo pedido ou manualmente"></label><label>E-mail do Google<input name="email" type="email" required maxlength="200" autocomplete="off"></label><label>Nome exibido<input name="displayName" required maxlength="120"></label><label>Sigla<input name="sigla" maxlength="20"></label><label>Telefone<input name="phone" type="tel" maxlength="40"></label><label>Função<select name="role" required>${userRoles.map(([id, title]) => `<option value="${id}" ${id === 'temporario' ? 'selected' : ''} ${id === 'administrador_app' && !can('admin') ? 'disabled' : ''}>${escapeHtml(title)}</option>`).join('')}</select></label></div>
          <fieldset><legend>Permissões SAHMT</legend><div class="permission-grid">${permissions}</div></fieldset>
          <div class="admin-user-flags"><label><input type="checkbox" name="active" checked> Perfil ativo</label><label><input type="checkbox" name="access" checked> Acesso ao SAHMT</label></div>
          <div class="admin-user-actions"><button class="primary-button" type="submit">Salvar perfil</button><button class="secondary-button" id="cancel-user-edit" type="button" hidden>Cancelar edição</button></div><p id="admin-user-status" class="record-meta" role="status" aria-live="polite"></p>
        </form>
      </section></details>
      <section class="admin-user-list"><div class="admin-list-heading"><h3>Perfis V2</h3><label>Filtrar perfis<input id="admin-user-search" type="search" placeholder="Nome, sigla, e-mail ou UID"></label></div><p class="record-meta">Exibindo até 200 perfis, ordenados por nome. Para remover acesso, desative o perfil; o registro não é apagado.</p>${entries || '<p class="empty-state">Nenhum perfil provisionado foi encontrado.</p>'}</section>`;
    const featureForm = content.querySelector('#app-feature-form');
    featureForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = featureForm.querySelector('[type="submit"]');
      const status = featureForm.querySelector('#app-feature-status');
      submit.disabled = true;
      if (status) status.textContent = 'Salvando configurações…';
      const nextFeatures = {...configuredFeatures};
      featureForm.querySelectorAll('input[name="feature"]:not(:disabled)').forEach((input) => { nextFeatures[input.value] = input.checked; });
      try {
        const {saveAppFeatures} = await import('./data.js');
        appFeatures = await saveAppFeatures(nextFeatures, session.user.uid);
        notice = 'Disponibilidade dos módulos atualizada.';
        await render();
      } catch (error) {
        if (status) status.textContent = error.code === 'permission-denied'
          ? 'O Firestore recusou a alteração. Somente uma conta administradora pode mudar a disponibilidade.'
          : `Não foi possível salvar as configurações: ${error.message || error}`;
        submit.disabled = false;
      }
    });
    const form = content.querySelector('#admin-user-form');
    const status = content.querySelector('#admin-user-status');
    const resetForm = () => {
      form.reset();
      form.elements.uid.readOnly = false;
      form.elements.active.checked = true;
      form.elements.access.checked = true;
      form.dataset.editingUid = '';
      content.querySelector('#user-form-title').textContent = 'Provisionar perfil SAHMT';
      content.querySelector('#user-form-summary').textContent = 'Configurar um pedido ou editar perfil';
      form.querySelector('[type="submit"]').textContent = 'Salvar perfil';
      content.querySelector('#cancel-user-edit').hidden = true;
      status.textContent = '';
    };
    content.querySelector('#cancel-user-edit').addEventListener('click', resetForm);
    content.querySelectorAll('[data-edit-user]').forEach((button) => button.addEventListener('click', () => {
      const profile = profiles.find((item) => item.uid === button.dataset.editUser);
      if (!profile) return;
      form.elements.uid.value = profile.uid || '';
      form.elements.uid.readOnly = true;
      form.elements.email.value = profile.email || '';
      form.elements.displayName.value = profile.displayName || '';
      form.elements.sigla.value = profile.sigla || '';
      form.elements.phone.value = profile.phone || '';
      form.elements.role.value = userRoles.some(([id]) => id === profile.role) ? profile.role : 'temporario';
      form.elements.active.checked = profile.active === true;
      form.elements.access.checked = profile.access === true;
      form.dataset.editingUid = profile.uid;
      form.querySelectorAll('input[name="permission"]').forEach((input) => { input.checked = profile.permissions?.[input.value] === true; });
      content.querySelector('#user-form-title').textContent = `Editar perfil · ${profile.displayName || profile.uid}`;
      content.querySelector('#user-form-summary').textContent = 'Editando perfil existente';
      form.querySelector('[type="submit"]').textContent = 'Atualizar perfil';
      content.querySelector('#cancel-user-edit').hidden = false;
      content.querySelector('#admin-user-editor').open = true;
      form.scrollIntoView({behavior: 'smooth', block: 'start'});
    }));
    content.querySelectorAll('[data-review-access]').forEach((button) => button.addEventListener('click', () => {
      const request = accessRequests.find((item) => item.uid === button.dataset.reviewAccess);
      if (!request) return;
      resetForm();
      form.elements.uid.value = request.uid;
      form.elements.uid.readOnly = true;
      form.elements.email.value = request.email;
      form.elements.displayName.value = request.displayName || '';
      form.elements.role.value = 'temporario';
      content.querySelector('#user-form-summary').textContent = `Configurando pedido · ${request.displayName || request.email}`;
      status.textContent = 'Escolha a função e marque somente as permissões necessárias antes de salvar.';
      content.querySelector('#admin-user-editor').open = true;
      form.scrollIntoView({behavior: 'smooth', block: 'start'});
    }));
    content.querySelector('#admin-user-search').addEventListener('input', (event) => {
      const term = event.target.value.trim().toLowerCase();
      content.querySelectorAll('[data-admin-user-row]').forEach((row) => { row.hidden = !row.dataset.search.includes(term); });
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = 'Salvando perfil no Firestore…';
      const permissions = Object.fromEntries([...form.querySelectorAll('input[name="permission"]')].map((input) => [input.value, input.checked]));
      try {
        const {saveUserProfile} = await import('./data.js');
        await saveUserProfile({
          uid: form.elements.uid.value,
          email: form.elements.email.value,
          displayName: form.elements.displayName.value,
          sigla: form.elements.sigla.value,
          phone: form.elements.phone.value,
          role: form.elements.role.value,
          active: form.elements.active.checked,
          access: form.elements.access.checked,
          permissions
        }, session.user.uid);
        await loadAdminModule(content);
        const updatedStatus = document.querySelector('#admin-user-status');
        if (updatedStatus) updatedStatus.textContent = 'Perfil salvo no Firestore.';
      } catch (error) {
        status.textContent = error.code === 'permission-denied'
          ? 'O Firestore recusou a alteração. Seu perfil não pode conceder este nível de acesso.'
          : `Não foi possível salvar: ${error.message || error}`;
      }
    });
  } catch (error) {
    content.innerHTML = `<p class="empty-state">Não foi possível consultar os perfis V2. ${escapeHtml(error.message || '')}</p>`;
  }
}

async function loadDailyChecklist(stations, suppliedDay) {
  const content = document.querySelector('#module-content');
  if (!content) return;
  const day = suppliedDay || document.querySelector('#checklist-day')?.value || todayInputValue();
  const dayMode = checklistDayMode(day, todayInputValue());
  if (dayMode === 'invalid') return;
  if (dayMode === 'future') {
    content.innerHTML = '<p class="empty-state">Não é possível consultar um Checklist futuro.</p>';
    return;
  }
  const applicableStations = stations.filter((station) => stationIsInDateRange(station, day));
  const writableStations = applicableStations.filter((station) => stationIsValidOn(station, day));
  content.innerHTML = '<p class="loading">Carregando registros do dia…</p>';
  try {
    const {listChecklistRecords} = await import('./data.js');
    const result = await listChecklistRecords(day, session.user.uid, {pageSize: 1000, stationIds: applicableStations.map((station) => station.id)});
    const records = result.records;
    const latestByStation = new Map();
    for (const record of records) if (!latestByStation.has(record.stationId)) latestByStation.set(record.stationId, record);
    const priorByStation = new Map();
    for (const record of result.priorRecords || []) if (!priorByStation.has(record.stationId)) priorByStation.set(record.stationId, record);
    const summary = summarizeChecklistDay(day, todayInputValue(), applicableStations, records);
    const cards = applicableStations.map((station) => {
      const record = resolveChecklistDayRecord(station, latestByStation.get(station.id), priorByStation.get(station.id), day, todayInputValue());
      const status = record?.condition === 'SIM' ? 'Conforme' : record?.condition === 'NAO' ? 'Não conforme' : 'Pendente';
      const stationStateClass = station.active !== true ? 'inactive' : record?.condition === 'SIM' ? 'complete' : record?.condition === 'NAO' ? 'nonconforming' : 'pending';
      const note = record?.inherited ? `<small>Não conformidade herdada de ${escapeHtml(formatRecordDate(record.date))}: ${escapeHtml(record.occurrence || '')}</small>` : record?.occurrence ? `<small>${escapeHtml(record.occurrence)}</small>` : '';
      const recordedAt = record?.createdAt ? `<small>Último registro: ${escapeHtml(interactionDateTime(record.createdAt))}</small>` : '';
      const action = can('checklistWrite') && dayMode === 'today' && station.active === true ? `<div class="checklist-actions"><button class="secondary-button" type="button" data-checklist-condition="SIM" data-station-id="${escapeHtml(station.id)}">Conforme</button><button class="secondary-button" type="button" data-checklist-condition="NAO" data-station-id="${escapeHtml(station.id)}">Não conforme</button></div><label class="checklist-occurrence" hidden>Descreva a ocorrência<textarea rows="2" maxlength="500" data-occurrence-for="${escapeHtml(station.id)}"></textarea></label>` : '';
      const pending = record?.pendingSync ? '<small class="record-meta">Aguardando sincronização</small>' : record?.syncFailed ? `<small class="sync-error">Falha ao sincronizar: ${escapeHtml(record.syncError || 'revise as permissões e tente novamente')}</small>` : '';
      return `<article class="checklist-station checklist-station-${stationStateClass}" data-checklist-station="${escapeHtml(station.id)}" tabindex="-1"><div><button class="checklist-station-select" type="button" data-checklist-select="${escapeHtml(station.id)}" aria-label="Selecionar ${escapeHtml(station.name || station.id)} · ${status}" aria-pressed="false" ${action ? '' : 'disabled'}>${escapeHtml(station.name || station.id)}</button><small>${status}${station.active !== true ? ' · Estação inativa' : ''}${record?.responsibleName ? ` · Responsável da escala: ${escapeHtml(record.responsibleName)}` : ''}</small>${recordedAt}${note}${pending}</div>${action}</article>`;
    }).join('');
    const summaryCards = applicableStations.length ? `<section class="checklist-summary-grid" aria-label="Resumo do checklist diário"><article><strong>${summary.recorded || 0}/${summary.total || 0}</strong><small>Estações concluídas</small></article><article><strong>${Math.max(0, (summary.total || 0) - (summary.recorded || 0))}</strong><small>Pendentes</small></article><article><strong>${summary.nonconforming || 0}</strong><small>Ocorrências</small></article></section>` : '';
    const stationGrid = cards ? `<section class="checklist-station-grid" aria-label="Estações do Checklist">${cards}</section>` : '<p class="empty-state">Nenhuma estação vigente está cadastrada para esta data.</p>';
    const pendingChecklistWrites = records.some((record) => record.pendingSync || record.syncFailed);
    const signatureUnavailableReason = pendingChecklistWrites
      ? 'Resolva as respostas locais pendentes antes da assinatura.'
      : result.stale
        ? 'Assinaturas exigem conferência online do relatório.'
        : !applicableStations.length
          ? 'Cadastre ao menos uma estação vigente antes de revisar o relatório.'
          : '';
    const signatureMarkup = dayMode === 'today' && can('checklistSign') ? `<section class="checklist-signature panel" aria-label="Assinatura interna do Checklist"><p>Assinatura do relatório diário</p><button class="secondary-button" id="checklist-signature-prepare" type="button" ${!navigator.onLine || result.stale || pendingChecklistWrites || !applicableStations.length ? 'disabled' : ''}>Revisar e assinar</button><p id="checklist-signature-status" class="record-meta" role="status" aria-live="polite">${signatureUnavailableReason}</p><div id="checklist-signature-preview"></div></section>` : '';
    content.innerHTML = `${result.stale ? '<p class="sync-state">Sem conexão: exibindo os registros salvos neste aparelho.</p>' : ''}${result.historyIncomplete ? '<p class="sync-state">Sem conexão: o catálogo mudou desde a última consulta; algumas heranças podem estar ausentes.</p>' : ''}${dayMode === 'history' ? '<p class="sync-state">Data histórica: consulta somente; registros são feitos no Checklist de hoje.</p>' : ''}${signatureMarkup}${summaryCards}${stationGrid}`;
    content.querySelectorAll('[data-checklist-select]').forEach((button) => button.addEventListener('click', () => {
      content.querySelectorAll('[data-checklist-select]').forEach((other) => {
        const selected = other === button;
        other.setAttribute('aria-pressed', String(selected));
        other.closest('[data-checklist-station]')?.classList.toggle('is-selected', selected);
      });
      const station = content.querySelector(`[data-checklist-station="${CSS.escape(button.dataset.checklistSelect)}"]`);
      station?.scrollIntoView({behavior: 'smooth', block: 'center'});
    }));
    const prepareSignature = content.querySelector('#checklist-signature-prepare');
    prepareSignature?.addEventListener('click', async () => {
      const status = content.querySelector('#checklist-signature-status');
      const previewTarget = content.querySelector('#checklist-signature-preview');
      prepareSignature.disabled = true;
      status.textContent = 'Preparando o pedido de validação do relatório…';
      try {
        const {getChecklistSignaturePreview} = await import('./checklist-signature.js');
        const preview = await getChecklistSignaturePreview({day, stations: applicableStations, records, uid: session.user.uid});
        if (preview.requestStatus === 'PENDING_VALIDATION') {
          previewTarget.innerHTML = '<p class="sync-state">Este pedido já está registrado e aguarda validação. O responsável, a assinatura e os pontos ainda não foram confirmados.</p>';
          status.textContent = 'Pedido de validação pendente.';
          prepareSignature.disabled = true;
          return;
        }
        if (['VALIDATED', 'DUPLICATE'].includes(preview.requestStatus)) {
          previewTarget.innerHTML = '<p class="sync-state">Esta revisão já foi validada e assinada.</p>';
          status.textContent = 'Assinatura validada.';
          prepareSignature.disabled = true;
          return;
        }
        if (['REJECTED', 'STALE', 'NEEDS_REVIEW'].includes(preview.requestStatus)) {
          previewTarget.innerHTML = `<p class="sync-state">O pedido anterior não foi validado. ${escapeHtml(preview.validationMessage || 'Confira o relatório e os dados atuais.')} Atualize antes de criar outro pedido.</p>`;
          status.textContent = 'Pedido anterior requer revisão.';
          prepareSignature.disabled = true;
          return;
        }
        previewTarget.innerHTML = `<div class="checklist-signature-review"><p>Relatório: ${preview.total - preview.missing}/${preview.total} estações respondidas.${preview.missing ? ` ${preview.missing} pendente(s).` : ''}</p><p>O responsável da primeira posição, as substituições e a revisão final serão conferidos pelo validador. Este envio ainda não é uma assinatura validada e não concede pontos.</p><label>Justificativa ou contexto para auditoria<textarea id="checklist-signature-justification" rows="3" maxlength="500" required></textarea></label><label class="checklist-declaration"><input type="checkbox" id="checklist-signature-declaration"> ${escapeHtml(preview.declaration)}</label><button class="primary-button" type="button" id="checklist-signature-confirm" disabled>Enviar para validação</button></div>`;
        status.textContent = 'Confira o relatório e registre o pedido. A validação será assíncrona.';
        const declaration = previewTarget.querySelector('#checklist-signature-declaration');
        const justification = previewTarget.querySelector('#checklist-signature-justification');
        const confirm = previewTarget.querySelector('#checklist-signature-confirm');
        const updateEnabled = () => { confirm.disabled = !declaration.checked || justification.value.trim().length < 8 || !navigator.onLine; };
        declaration.addEventListener('change', updateEnabled);
        justification?.addEventListener('input', updateEnabled);
        confirm.addEventListener('click', async () => {
          confirm.disabled = true;
          status.textContent = 'Registrando o pedido de validação no Firestore…';
          try {
            const {signChecklistReport} = await import('./checklist-signature.js');
            await signChecklistReport({day, revision: preview.revision, declaration: declaration.checked, justification: justification.value, uid: session.user.uid});
            status.textContent = 'Pedido registrado. Assinatura e pontuação aguardam validação.';
            await loadDailyChecklist(stations, day);
          } catch (error) {
            status.textContent = error.message || 'Não foi possível assinar. Atualize o relatório e tente novamente.';
            previewTarget.replaceChildren();
            prepareSignature.disabled = !navigator.onLine || pendingChecklistWrites;
          }
        });
      } catch (error) {
        status.textContent = error.message || 'Não foi possível conferir a revisão do relatório.';
      } finally {
        if (prepareSignature.isConnected) prepareSignature.disabled = !navigator.onLine || pendingChecklistWrites;
      }
    });
    const scanButton = document.querySelector('#checklist-scan-qr');
    if (scanButton) {
      scanButton.hidden = checklistReportMode !== 'daily' || day !== todayInputValue();
      scanButton.onclick = () => openChecklistQrScanner(writableStations, day);
    }
    const photoButton = document.querySelector('#checklist-qr-photo');
    const photoInput = document.querySelector('#checklist-qr-photo-file');
    const photoStatus = document.querySelector('#checklist-qr-photo-status');
    if (photoButton && photoInput) {
      photoButton.hidden = checklistReportMode !== 'daily' || day !== todayInputValue();
      photoButton.onclick = () => photoInput.click();
      photoInput.onchange = async () => {
        const file = photoInput.files?.[0];
        photoInput.value = '';
        if (!file) return;
        photoButton.disabled = true;
        if (photoStatus) photoStatus.textContent = 'Lendo a foto neste aparelho…';
        try {
          const qrValue = await decodeQrPhoto(file);
          const station = qrValue && findStationForQr(writableStations, qrValue, day);
          if (!station) throw new Error('QR não identificado ou sem correspondência com uma estação ativa. Revise a foto ou digite o código no leitor.');
          if (photoStatus) photoStatus.textContent = `QR localizado: ${station.name || station.id}. Foto processada neste aparelho e não enviada.`;
          revealChecklistStation(station);
        } catch (error) {
          if (photoStatus) photoStatus.textContent = error.message || 'Não foi possível ler o QR desta foto.';
        } finally {
          photoButton.disabled = false;
        }
      };
    }
    content.querySelectorAll('[data-checklist-condition="NAO"]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.confirm === '1') { void saveChecklistAnswer(button.dataset.stationId, 'NAO', day); return; }
      const box = content.querySelector(`[data-occurrence-for="${CSS.escape(button.dataset.stationId)}"]`)?.closest('.checklist-occurrence');
      if (box) { box.hidden = false; box.querySelector('textarea')?.focus(); }
      button.textContent = 'Confirmar não conforme';
      button.dataset.confirm = '1';
    }));
    content.querySelectorAll('[data-checklist-condition="SIM"]').forEach((button) => button.addEventListener('click', () => saveChecklistAnswer(button.dataset.stationId, 'SIM', day)));
  } catch (error) {
    content.innerHTML = `<p class="empty-state">Não foi possível carregar o checklist. ${escapeHtml(error.message || '')}</p>`;
  }
}

function revealChecklistStation(station) {
  const card = document.querySelector(`[data-checklist-station="${CSS.escape(station.id)}"]`);
  if (!card) {
    notice = 'Estação localizada no catálogo; atualize a lista para registrar sua resposta.';
    void render();
    return;
  }
  card.scrollIntoView({behavior: 'smooth', block: 'center'});
  card.classList.add('qr-match');
  card.focus({preventScroll: true});
  window.setTimeout(() => card.classList.remove('qr-match'), 4000);
}

async function openChecklistQrScanner(stations, day) {
  const dialog = document.querySelector('#checklist-qr-dialog');
  const video = document.querySelector('#checklist-qr-video');
  const status = document.querySelector('#checklist-qr-status');
  const form = document.querySelector('#checklist-qr-manual');
  if (!dialog || !video || !status || !form) return;
  stopChecklistQrScanner();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  let stream = null;
  let frame = 0;
  let timer = 0;
  let running = true;
  let detector = null;
  const cleanup = () => {
    running = false;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    form.hidden = false;
  };
  stopChecklistQrScan = cleanup;
  dialog.addEventListener('close', () => stopChecklistQrScanner(false), {once: true});
  document.querySelector('#checklist-qr-close').onclick = () => dialog.close();
  form.onsubmit = (event) => {
    event.preventDefault();
    resolveChecklistQr(form.elements.qr.value);
  };
  const resolveChecklistQr = (raw) => {
    cleanup();
    stopChecklistQrScan = null;
    if (dialog.open) dialog.close();
    const station = findStationForQr(stations, raw, day);
    if (!station) {
      status.textContent = 'Esse código não corresponde a uma estação ativa do catálogo V2.';
      form.reset();
      dialog.showModal();
      return;
    }
    form.reset();
    revealChecklistStation(station);
  };
  const decodeWithFallback = () => {
    if (!window.ZXing || !context || !video.videoWidth || !video.videoHeight) return null;
    const side = Math.max(120, Math.floor(Math.min(video.videoWidth, video.videoHeight) * 0.72));
    const size = Math.min(side, video.videoWidth, video.videoHeight);
    const sx = Math.floor((video.videoWidth - size) / 2);
    const sy = Math.floor((video.videoHeight - size) / 2);
    const scale = Math.min(1, 800 / size);
    canvas.width = Math.max(1, Math.floor(size * scale));
    canvas.height = canvas.width;
    context.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    return decodeQrImageData(context.getImageData(0, 0, canvas.width, canvas.height), window.ZXing);
  };
  dialog.showModal();
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'A câmera exige HTTPS e permissão do navegador. Digite o código do QR para localizar a estação.';
    form.elements.qr.focus();
    return;
  }
  status.textContent = 'Solicitando acesso à câmera…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}}, audio: false});
    if (!running) { stream.getTracks().forEach((track) => track.stop()); return; }
    video.srcObject = stream;
    video.hidden = false;
    form.hidden = false;
    await video.play();
    if (typeof window.BarcodeDetector === 'function') {
      try { detector = new window.BarcodeDetector({formats: ['qr_code']}); } catch { detector = null; }
    }
    if (!detector) await loadQrDecoder();
    status.textContent = 'Aponte a câmera para o QR da estação.';
    let detecting = false;
    let emptyNativeFrames = 0;
    const scan = async () => {
      if (!running || detecting) return;
      detecting = true;
      let raw = null;
      try {
        if (detector) {
          try {
            const results = await detector.detect(video);
            raw = results.find((item) => item.rawValue)?.rawValue || null;
            if (!raw && ++emptyNativeFrames >= 12 && !window.ZXing) void loadQrDecoder().catch(() => {});
          } catch {
            detector = null;
            await loadQrDecoder();
          }
        }
        if (!raw && !detector && !window.ZXing) await loadQrDecoder();
        if (!raw && window.ZXing) raw = decodeWithFallback();
      } catch (error) {
        status.textContent = error.message || 'Não foi possível ler a imagem da câmera.';
      } finally {
        detecting = false;
      }
      if (!running) return;
      if (raw) { resolveChecklistQr(raw); return; }
      timer = window.setTimeout(() => { frame = requestAnimationFrame(scan); }, 150);
    };
    frame = requestAnimationFrame(scan);
  } catch (error) {
    cleanup();
    stopChecklistQrScan = null;
    status.textContent = error.name === 'NotAllowedError'
      ? 'A permissão da câmera foi negada. Digite o código do QR para localizar a estação.'
      : `Não foi possível abrir a câmera. ${error.message || ''}`;
    form.elements.qr.focus();
  }
}

function stopChecklistQrScanner(closeDialog = true) {
  stopChecklistQrScan?.();
  stopChecklistQrScan = null;
  const dialog = document.querySelector('#checklist-qr-dialog');
  if (closeDialog && dialog?.open) dialog.close();
}

async function loadMonthlyChecklist(stations) {
  const content = document.querySelector('#module-content');
  if (!content) return;
  const month = document.querySelector('#checklist-month')?.value || todayInputValue().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    content.innerHTML = '<p class="empty-state">Selecione um mês válido.</p>';
    return;
  }
  const loadId = ++checklistReportLoad;
  content.innerHTML = '<p class="loading">Carregando registros do mês…</p>';
  try {
    const {listMonthlyChecklistRecords} = await import('./data.js');
    const result = await listMonthlyChecklistRecords(month, session.user.uid, {stationIds: stations.map((station) => station.id)});
    if (loadId !== checklistReportLoad || currentRoute() !== 'checklist' || checklistReportMode !== 'monthly') return;
    const today = todayInputValue();
    const days = summarizeChecklistMonth(month, today, stations, result.records, result.priorRecords);
    const rows = days.map((summary) => {
      const day = summary.day;
      const sync = summary.pendingSync ? '<small class="record-meta">Há ação(ões) aguardando sincronização</small>' : '';
      return `<button class="checklist-month-row" type="button" data-checklist-open-day="${day}" ${summary.mode === 'future' ? 'disabled' : ''}><strong>${escapeHtml(formatRecordDate(day))}</strong><span>${summary.text}</span>${sync}<span class="arrow" aria-hidden="true">›</span></button>`;
    }).join('');
      content.innerHTML = `${result.stale ? '<p class="sync-state">Sem conexão: exibindo o resumo salvo neste aparelho.</p>' : ''}${result.truncated ? '<p class="sync-state">O volume do mês excede o limite desta consulta; este resumo pode estar incompleto.</p>' : ''}${result.historyIncomplete ? '<p class="sync-state">O histórico anterior não está completo neste cache; respostas herdadas podem faltar.</p>' : ''}<p class="checklist-report-note">Resumo dos registros encontrados no Firestore. Um NÃO anterior permanece indicado até nova resposta, conforme a regra do Checklist. A assinatura é feita no relatório diário do dia atual.</p><div class="checklist-month-list">${rows}</div>`;
    content.querySelectorAll('[data-checklist-open-day]').forEach((button) => button.addEventListener('click', async () => {
      checklistReportMode = 'daily';
      const day = button.dataset.checklistOpenDay;
      const dayInput = document.querySelector('#checklist-day');
      if (dayInput) dayInput.value = day;
      document.querySelectorAll('[data-checklist-report-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.checklistReportMode === 'daily')));
      document.querySelector('#checklist-day-control').hidden = false;
      document.querySelector('#checklist-month-control').hidden = true;
      await loadDailyChecklist(stations, day);
    }));
  } catch (error) {
    if (loadId !== checklistReportLoad) return;
    content.innerHTML = `<p class="empty-state">Não foi possível carregar o relatório mensal. ${escapeHtml(error.message || '')}</p>`;
  }
}

async function saveChecklistAnswer(stationId, condition, day) {
  if (checklistDayMode(day, todayInputValue()) !== 'today') {
    notice = 'O Checklist só pode ser registrado na data de hoje.';
    await render();
    return;
  }
  const occurrence = condition === 'NAO' ? document.querySelector(`[data-occurrence-for="${CSS.escape(stationId)}"]`)?.value.trim() : '';
  if (condition === 'NAO' && !occurrence) { notice = 'Descreva a ocorrência antes de registrar a não conformidade.'; await render(); return; }
  try {
    const {createOperationalRecord} = await import('./data.js');
    // Client-side schedule resolution is not authoritative. Keep duty attribution
    // unknown until a server-validated UID projection exists; createdByUid remains
    // the authenticated actor and checklistWrite stays independent of scheduleRead.
    const result = await createOperationalRecord('checklists', {stationId, date: day, condition, status: condition === 'SIM' ? 'COMPLETED' : 'MAINTENANCE', occurrence, responsibleUid: null, responsibleName: null, responsibleEmail: null}, {uid: session.user.uid});
    notice = result.pendingFirestore ? 'Ação salva neste aparelho; sincronizará quando a conexão voltar.' : 'Checklist registrado.';
    await render();
  } catch (error) {
    notice = error.code === 'permission-denied' ? 'Seu perfil não tem permissão para registrar checklist.' : `Não foi possível salvar. ${error.message || ''}`;
    await render();
  }
}

async function loadEventReport() {
  const target = document.querySelector('#event-report-results');
  if (!target) return false;
  const loadId = ++eventReportLoad;
  const day = document.querySelector('#event-report-day')?.value || todayInputValue();
  const month = document.querySelector('#event-report-month')?.value || todayInputValue().slice(0, 7);
  if (eventReportMode === 'daily' && !/^\d{4}-\d{2}-\d{2}$/.test(day) || eventReportMode === 'monthly' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    target.innerHTML = '<p class="empty-state">Selecione uma data ou mês válido.</p>';
    return false;
  }
  let from = day;
  let to = day;
  if (eventReportMode === 'monthly') {
    const [year, monthNumber] = month.split('-').map(Number);
    from = `${month}-01`;
    to = `${year}-${String(monthNumber).padStart(2, '0')}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`;
  }
  if (append && (!eventReportCursor || eventReportLoadingMore)) return false;
  if (append) eventReportLoadingMore = true;
  else {
    target.innerHTML = '<p class="loading">Carregando registros…</p>';
    loadedEventReportRecords = [];
    eventReportSourceRecords = [];
    eventReportCursor = null;
    eventReportStale = false;
  }
  const exportButton = document.querySelector('#export-events');
  if (exportButton) exportButton.disabled = true;
  const pdfButton = document.querySelector('#share-events-pdf');
  if (pdfButton) pdfButton.disabled = true;
  try {
    const {listEventRecords} = await import('./data.js');
    const report = await listEventRecords({from, to, uid: session.user.uid, cursor: append ? eventReportCursor : null, includePending: !append});
    if (loadId !== eventReportLoad || !document.querySelector('#event-report-results')) return false;
    if (append) {
      const existingIds = new Set(eventReportSourceRecords.map((item) => item.id));
      eventReportSourceRecords.push(...report.records.filter((item) => !existingIds.has(item.id)));
    } else eventReportSourceRecords = report.records;
    eventReportSourceRecords.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')) || eventCreatedAtValue(right.createdAt) - eventCreatedAtValue(left.createdAt));
    eventReportStale = eventReportStale || report.stale;
    eventReportCursor = report.nextCursor;
    renderEventReportRecords();
    return true;
  } catch (error) {
    if (loadId === eventReportLoad) {
      if (append) {
        target.insertAdjacentHTML('afterbegin', `<p class="empty-state">Não foi possível carregar mais registros. ${escapeHtml(error.message || '')}</p>`);
        const moreButton = target.querySelector('#event-report-more');
        if (moreButton) {
          moreButton.disabled = !navigator.onLine;
          moreButton.textContent = navigator.onLine ? 'Tentar carregar mais' : 'Conecte-se para carregar mais';
        }
      }
      else target.innerHTML = `<p class="empty-state">Não foi possível carregar o relatório. ${escapeHtml(error.message || '')}</p>`;
    }
    return false;
  } finally {
    if (append) eventReportLoadingMore = false;
  }
}

function eventCreatedAtValue(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const date = value ? new Date(value).getTime() : 0;
  return Number.isFinite(date) ? date : 0;
}

function renderEventReportRecords() {
  const target = document.querySelector('#event-report-results');
  if (!target) return;
  const term = (document.querySelector('#event-report-person')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const records = term ? eventReportSourceRecords.filter((item) => `${item.memberSigla || ''} ${item.scheduleSigla || ''} ${item.memberStatus || ''} ${item.substitute || ''}`.toLocaleLowerCase('pt-BR').includes(term)) : eventReportSourceRecords;
  const hasPending = eventReportSourceRecords.some((item) => item.pendingFirestore || item.syncFailed);
  loadedEventReportRecords = records.filter((item) => !item.pendingFirestore && !item.syncFailed);
  const exportButton = document.querySelector('#export-events');
  const pdfButton = document.querySelector('#share-events-pdf');
  if (exportButton) exportButton.disabled = loadedEventReportRecords.length === 0;
  if (pdfButton) pdfButton.disabled = loadedEventReportRecords.length === 0;
  const syncNotice = eventReportStale && eventReportSourceRecords.some((item) => !item.pendingFirestore && !item.syncFailed)
    ? '<p class="sync-state">A conexão caiu durante a consulta. Os registros confirmados já exibidos permanecem somente nesta tela; próximos blocos dependem da conexão e o histórico não é salvo localmente.</p>'
    : eventReportStale
      ? '<p class="sync-state">Sem conexão: esta lista mostra somente eventos locais que ainda aguardam confirmação. Registros confirmados anteriormente não ficam em cache.</p>'
    : hasPending
      ? '<p class="sync-state">Há eventos locais pendentes ou recusados. Eles ficam fora dos arquivos até o Firestore confirmar a gravação.</p>'
      : '';
  const empty = eventReportStale ? 'Não há eventos locais pendentes neste período.' : term ? 'Nenhum evento corresponde à busca.' : 'Nenhum evento neste período.';
  target.innerHTML = `${syncNotice}${records.length ? `<ul class="record-list">${records.map((item) => {
    const confirmed = !item.pendingEdit && !item.pendingFirestore && !item.syncFailed;
    const showHistory = confirmed && Number(item.version) > 1;
    const canEdit = can('eventsWrite') && confirmed && (item.createdByUid === session.user.uid || can('admin'));
    return `<li><div class="contact-list-heading"><strong>${item.pendingEdit && item.syncFailed ? 'Rascunho local · ' : ''}${escapeHtml(item.memberStatus || 'Evento')} · ${escapeHtml(item.eventType || 'Outros')}</strong><span class="event-record-actions">${showHistory ? `<button class="secondary-button" type="button" data-event-history="${escapeHtml(item.id)}" aria-expanded="false">Histórico</button>` : ''}${canEdit ? `<button class="secondary-button" type="button" data-event-edit="${escapeHtml(item.id)}">Editar</button>` : ''}</span></div><small>${escapeHtml(formatRecordDate(item.date))}${item.shift ? ` · ${escapeHtml(item.shift)}` : ''}${item.substitute ? ` · Substituto: ${escapeHtml(item.substitute)}` : ''}</small>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}${item.amountToPay ? `<small class="record-meta">Valor: R$ ${Number(item.amountToPay).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</small>` : ''}${showHistory ? `<section class="event-history" data-event-history-panel="${escapeHtml(item.id)}" aria-label="Histórico de alterações" hidden></section>` : ''}${item.pendingEdit ? item.syncFailed ? `<small class="sync-error">Rascunho de edição não confirmado. ${escapeHtml(item.syncError || 'Consulte Sincronização para comparar com a versão atual.')}</small>` : '<small class="sync-state">Edição local aguardando confirmação do Firestore.</small>' : item.syncFailed ? `<small class="sync-error">Firestore recusou este evento${item.syncError ? `: ${escapeHtml(item.syncError)}` : ''}. Revise em Offline.</small>` : item.pendingFirestore ? '<small class="sync-state">Aguardando confirmação do Firestore.</small>' : ''}</li>`;
  }).join('')}</ul>` : `<p class="empty-state">${empty}</p>`}${eventReportCursor ? `<button class="secondary-button" type="button" id="event-report-more" ${navigator.onLine ? '' : 'disabled'}>${navigator.onLine ? 'Carregar mais registros' : 'Conecte-se para carregar mais'}</button>` : ''}`;
  target.querySelectorAll('[data-event-edit]').forEach((button) => button.addEventListener('click', () => beginEventEdit(records.find((item) => item.id === button.dataset.eventEdit))));
  target.querySelectorAll('[data-event-history]').forEach((button) => button.addEventListener('click', async () => {
    const panel = button.closest('li')?.querySelector('[data-event-history-panel]');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden || panel.dataset.loaded === 'true') return;
    button.disabled = true;
    panel.innerHTML = '<p class="loading">Carregando histórico…</p>';
    try {
      const {listEventHistory} = await import('./data.js');
      const history = await listEventHistory(button.dataset.eventHistory);
      const labels = {date: 'Data', memberSigla: 'Sigla do membro', scheduleSigla: 'Sigla da escala', memberStatus: 'Membro / situação', eventType: 'Tipo de evento', description: 'Descrição', delayMultiple: 'Múltiplo do atraso', substitute: 'Substituto', shift: 'Turno', payer: 'Pagador', creditor: 'Credor', amountToPay: 'Valor', status: 'Status'};
      const value = (item) => item == null || item === '' ? '—' : typeof item === 'object' ? JSON.stringify(item) : String(item);
      panel.innerHTML = history.length ? `<ol>${history.map((entry) => `<li><strong>Versão ${escapeHtml(entry.version)}</strong><small>${entry.createdAt?.toDate ? escapeHtml(entry.createdAt.toDate().toLocaleString('pt-BR')) : 'Data indisponível'}</small><ul>${entry.changedFields.map((field) => `<li><strong>${escapeHtml(labels[field] || field)}</strong><small>Antes: ${escapeHtml(value(entry.before[field]))}</small><small>Depois: ${escapeHtml(value(entry.after[field]))}</small></li>`).join('')}</ul></li>`).join('')}</ol>` : '<p class="empty-state">Nenhuma alteração histórica encontrada.</p>';
      panel.dataset.loaded = 'true';
    } catch (error) {
      panel.innerHTML = `<p class="empty-state">Não foi possível carregar o histórico. ${escapeHtml(error.message || '')}</p>`;
    } finally {
      button.disabled = false;
    }
  }));
  target.querySelector('#event-report-more')?.addEventListener('click', (event) => {
    event.currentTarget.disabled = true;
    loadEventReport({append: true});
  });
}

function beginEventEdit(item) {
  const form = document.querySelector('[data-module-form="events"]');
  if (!form || !item) return;
  const status = document.querySelector('#event-form-status');
  const conflictRefresh = document.querySelector('#event-conflict-refresh');
  if (status) status.textContent = '';
  if (conflictRefresh) conflictRefresh.hidden = true;
  for (const name of ['payer', 'creditor']) {
    const select = form.elements[name];
    const value = String(item[name] || '');
    if (value && ![...select.options].some((option) => option.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value} · opção histórica`;
      select.append(option);
    }
  }
  const existingMemberSigla = String(item.memberSigla || '').trim().toUpperCase();
  if (existingMemberSigla && ![...form.elements.memberSigla.options].some((option) => option.value === existingMemberSigla)) {
    form.elements.memberSigla.add(new Option(`${existingMemberSigla} · sigla histórica`, existingMemberSigla));
  }
  form.elements.editEventId.value = item.id;
  form.elements.editEventVersion.value = Number(item.version) || 1;
  for (const [name, value] of Object.entries({eventDate: item.date, memberSigla: item.memberSigla || '', scheduleSigla: item.scheduleSigla || '', memberStatus: item.memberStatus, eventType: item.eventType, delayMultiple: item.delayMultiple ?? '', substitute: item.substitute, shift: item.shift, payer: item.payer, creditor: item.creditor, amountToPay: item.amountToPay, description: item.description})) {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  }
  form.elements.eventType.dispatchEvent(new Event('change', {bubbles: true}));
  form.querySelector('[type="submit"]').textContent = 'Atualizar evento';
  form.querySelector('#event-edit-cancel').hidden = false;
  form.closest('details').open = true;
  form.scrollIntoView({behavior: 'smooth', block: 'center'});
  form.elements.memberStatus.focus({preventScroll: true});
}

function resetEventEditor() {
  const form = document.querySelector('[data-module-form="events"]');
  if (!form) return;
  const status = document.querySelector('#event-form-status');
  const conflictRefresh = document.querySelector('#event-conflict-refresh');
  if (status) status.textContent = '';
  if (conflictRefresh) conflictRefresh.hidden = true;
  form.reset();
  form.elements.editEventId.value = '';
  form.elements.editEventVersion.value = '';
  form.querySelector('[type="submit"]').textContent = 'Salvar evento';
  form.querySelector('#event-edit-cancel').hidden = true;
  updateEventEntryFields(form);
}

async function loadLabelReport(options = {}) {
  const target = document.querySelector('#label-report-results');
  if (!target) return false;
  const append = options?.append === true;
  const loadId = ++labelReportLoad;
  const day = document.querySelector('#label-report-day')?.value || todayInputValue();
  const month = document.querySelector('#label-report-month')?.value || todayInputValue().slice(0, 7);
  if (labelReportMode === 'daily' && !/^\d{4}-\d{2}-\d{2}$/.test(day) || labelReportMode === 'monthly' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    target.innerHTML = '<p class="empty-state">Selecione uma data ou mês válido.</p>';
    return false;
  }
  let from = day; let to = day;
  if (labelReportMode === 'monthly') {
    const [year, monthNumber] = month.split('-').map(Number);
    from = `${month}-01`;
    to = `${year}-${String(monthNumber).padStart(2, '0')}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`;
  }
  if (append && (!labelReportCursor || labelReportLoadingMore)) return false;
  if (append) labelReportLoadingMore = true;
  else {
    target.innerHTML = '<p class="loading">Carregando registros…</p>';
    loadedLabelRecords = [];
    labelReportCursor = null;
  }
  const exportButton = document.querySelector('#export-labels');
  if (exportButton && !append) exportButton.disabled = true;
  const pdfButton = document.querySelector('#share-labels-pdf');
  if (pdfButton && !append) pdfButton.disabled = true;
  try {
    const {listLabelRecords} = await import('./data.js');
    const report = await listLabelRecords({from, to, uid: session.user.uid, sigla: session.profile?.sigla || '', canManage: can('labelsManage'), cursor: append ? labelReportCursor : null});
    if (loadId !== labelReportLoad || !document.querySelector('#label-report-results')) return false;
    if (append) {
      const existingIds = new Set(loadedLabelRecords.map((item) => item.id));
      loadedLabelRecords.push(...report.records.filter((item) => !existingIds.has(item.id)));
    } else loadedLabelRecords = report.records;
    loadedLabelRecords.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')) || reportTimestamp(right.createdAt) - reportTimestamp(left.createdAt));
    labelReportCursor = report.nextCursor;
    const records = loadedLabelRecords;
    if (exportButton) exportButton.disabled = records.length === 0;
    if (pdfButton) pdfButton.disabled = records.length === 0;
    target.innerHTML = `${records.length ? `<ul class="record-list">${records.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.patientName || 'Etiqueta')} · ${escapeHtml(formatRecordDate(item.date))}</strong><span>${(can('labelsWrite') || can('labelsManage')) && (item.createdByUid === session.user.uid || can('labelsManage')) ? `<button class="secondary-button" type="button" data-label-edit="${escapeHtml(item.id)}">Editar</button>` : ''}<button class="secondary-button" type="button" data-label-history="${escapeHtml(item.id)}" aria-expanded="false" aria-controls="label-history-${escapeHtml(item.id)}">Histórico</button></span></div><small>${escapeHtml(item.type || '')}${item.encounterCode ? ` · Atendimento ${escapeHtml(item.encounterCode)}` : ''}${item.procedureCode ? ` · Cirurgia ${escapeHtml(item.procedureCode)}` : ''}</small><small>${escapeHtml(item.creditor || '')}${item.staffSiglas?.length ? ` · ${escapeHtml(item.staffSiglas.join(', '))}` : ''}${item.insurance ? ` · ${escapeHtml(item.insurance)}` : ''}</small>${item.amount != null ? `<small class="record-meta">Valor: R$ ${Number(item.amount).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</small>` : ''}<div id="label-history-${escapeHtml(item.id)}" class="label-history" data-label-history-content="${escapeHtml(item.id)}" hidden></div></li>`).join('')}</ul>` : '<p class="empty-state">Nenhuma etiqueta neste período.</p>'}${labelReportCursor ? `<button class="secondary-button" type="button" id="label-report-more" ${navigator.onLine ? '' : 'disabled'}>${navigator.onLine ? 'Carregar mais registros' : 'Conecte-se para carregar mais'}</button>` : ''}`;
    target.querySelectorAll('[data-label-edit]').forEach((button) => button.addEventListener('click', () => beginLabelEdit(records.find((item) => item.id === button.dataset.labelEdit))));
    target.querySelectorAll('[data-label-history]').forEach((button) => button.addEventListener('click', async () => {
      const historyTarget = target.querySelector(`[data-label-history-content="${CSS.escape(button.dataset.labelHistory)}"]`);
      if (!historyTarget) return;
      if (!historyTarget.hidden) {
        historyTarget.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        button.textContent = 'Histórico';
        return;
      }
      historyTarget.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      button.textContent = 'Fechar histórico';
      if (historyTarget.dataset.loaded === 'true' || historyTarget.dataset.loading === 'true') return;
      historyTarget.dataset.loading = 'true';
      historyTarget.innerHTML = '<small class="loading">Carregando histórico…</small>';
      try {
        const {listLabelHistory} = await import('./data.js');
        const history = await listLabelHistory(button.dataset.labelHistory);
        historyTarget.innerHTML = history.length ? `<ol>${history.map((entry) => {
          const date = entry.createdAt?.toDate?.() || (entry.createdAt ? new Date(entry.createdAt) : null);
          const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('pt-BR') : 'Horário indisponível';
          const fields = entry.changedFields.map((field) => `${escapeHtml(field)}: ${escapeHtml(JSON.stringify(entry.before[field]))} → ${escapeHtml(JSON.stringify(entry.after[field]))}`).join('<br>');
          return `<li><strong>Versão ${entry.version} · ${escapeHtml(when)}</strong><small>${fields}</small></li>`;
        }).join('')}</ol>` : '<small>Nenhuma alteração registrada.</small>';
        historyTarget.dataset.loaded = 'true';
        historyTarget.dataset.loading = 'false';
      } catch (error) {
        historyTarget.dataset.loading = 'false';
        historyTarget.innerHTML = `<small>Não foi possível carregar o histórico. ${escapeHtml(error.message || '')}</small>`;
      }
    }));
    target.querySelector('#label-report-more')?.addEventListener('click', (event) => {
      event.currentTarget.disabled = true;
      loadLabelReport({append: true});
    });
    return true;
  } catch (error) {
    if (loadId === labelReportLoad) {
      if (append) {
        target.insertAdjacentHTML('afterbegin', `<p class="empty-state">Não foi possível carregar mais etiquetas. ${escapeHtml(error.message || '')}</p>`);
        const moreButton = target.querySelector('#label-report-more');
        if (moreButton) {
          moreButton.disabled = !navigator.onLine;
          moreButton.textContent = navigator.onLine ? 'Tentar carregar mais' : 'Conecte-se para carregar mais';
        }
      } else target.innerHTML = `<p class="empty-state">Não foi possível carregar o relatório. ${escapeHtml(error.message || '')}</p>`;
    }
    return false;
  } finally {
    if (append) labelReportLoadingMore = false;
  }
}

function beginLabelEdit(item) {
  const form = document.querySelector('[data-module-form="labels"]');
  if (!form || !item) return;
  form.elements.editLabelId.value = item.id;
  form.elements.type.value = item.type || '';
  form.elements.creditor.value = item.creditor || '';
  updateLabelEntryFields(form);
  for (const [name, value] of Object.entries({date: item.date, patientName: item.patientName, procedureCode: item.procedureCode, encounterCode: item.encounterCode, amount: item.amount ?? '', insurance: item.insurance, staffSiglas: item.staffSiglas?.join(', ')})) {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  }
  form.querySelector('[type="submit"]').textContent = 'Atualizar etiqueta';
  form.querySelector('#label-edit-cancel').hidden = false;
  form.querySelector('#label-form-status').textContent = '';
  form.querySelector('#label-conflict-refresh').hidden = true;
  form.closest('details').open = true;
  form.scrollIntoView({behavior: 'smooth', block: 'center'});
  form.elements.patientName.focus({preventScroll: true});
}

function resetLabelEditor() {
  const form = document.querySelector('[data-module-form="labels"]');
  if (!form) return;
  form.reset();
  form.elements.editLabelId.value = '';
  form.querySelector('[type="submit"]').textContent = 'Salvar registro';
  form.querySelector('#label-edit-cancel').hidden = true;
  form.querySelector('#label-form-status').textContent = '';
  form.querySelector('#label-conflict-refresh').hidden = true;
  updateLabelEntryFields(form);
}

function exportEventReport() {
  const columns = ['Data', 'Sigla da escala', 'Sigla do membro', 'Membro/Situação', 'Tipo', 'Descrição', 'Múltiplo do atraso', 'Substituto', 'Turno', 'Pagador', 'Credor', 'Valor a pagar'];
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [columns, ...loadedEventReportRecords.map((item) => [item.date, item.scheduleSigla || '', item.memberSigla || '', item.memberStatus, item.eventType, item.description, item.delayMultiple ?? '', item.substitute, item.shift, item.payer, item.creditor, Number(item.amountToPay || 0).toFixed(2)])];
  const blob = new Blob(['\ufeff', rows.map((row) => row.map(cell).join(';')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SAHMT-Eventos-${eventReportMode === 'daily' ? document.querySelector('#event-report-day')?.value : document.querySelector('#event-report-month')?.value}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportLabelReport() {
  const columns = ['Data', 'Nome do Paciente', 'Cirurgia', 'Atendimento', 'Tipo', 'Valor', 'Convênio', 'Credor', 'Plantonistas'];
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [columns, ...loadedLabelRecords.map((item) => [item.date, item.patientName, item.procedureCode, item.encounterCode, item.type, item.amount ?? '', item.insurance, item.creditor, item.staffSiglas?.join(', ') || ''])];
  const blob = new Blob(['\ufeff', rows.map((row) => row.map(cell).join(';')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SAHMT-Etiquetas-${labelReportMode === 'daily' ? document.querySelector('#label-report-day')?.value : document.querySelector('#label-report-month')?.value}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportTimestamp(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatReportMonth(value) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value || ''));
  return match ? `${match[2]}-${match[1]}` : value;
}

async function shareReportPdf(kind) {
  const isLabel = kind === 'labels';
  const button = document.querySelector(isLabel ? '#share-labels-pdf' : '#share-events-pdf');
  const target = document.querySelector(isLabel ? '#label-report-results' : '#event-report-results');
  const records = isLabel ? loadedLabelRecords : loadedEventReportRecords;
  if (!button || !target || !records.length) return;
  const period = isLabel
    ? (labelReportMode === 'daily' ? document.querySelector('#label-report-day')?.value : document.querySelector('#label-report-month')?.value)
    : (eventReportMode === 'daily' ? document.querySelector('#event-report-day')?.value : document.querySelector('#event-report-month')?.value);
  const mode = isLabel ? labelReportMode : eventReportMode;
  const pdfRecords = isLabel && mode === 'monthly'
    ? [...records].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')) || reportTimestamp(left.createdAt) - reportTimestamp(right.createdAt))
    : records;
  const labelDateGroups = [];
  if (isLabel && mode === 'monthly') {
    let previousDate = null;
    let groupIndex = -1;
    let rowInGroup = 0;
    for (const item of pdfRecords) {
      if (item.date !== previousDate) {
        previousDate = item.date;
        groupIndex += 1;
        rowInGroup = 0;
      }
      labelDateGroups.push({groupIndex, rowInGroup});
      rowInGroup += 1;
    }
  }
  const optionalLabelColumns = [
    ['Convênio', (item) => item.insurance], ['Cirurgia', (item) => item.procedureCode],
    ['Atendimento', (item) => item.encounterCode], ['Tipo', (item) => item.type],
    ['Valor', (item) => item.amount == null ? '' : `R$ ${Number(item.amount).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`],
    ['Credor', (item) => item.creditor], ['Plantonista(s)', (item) => item.staffSiglas?.join(', ')]
  ].filter(([, getValue]) => pdfRecords.some((item) => String(getValue(item) ?? '').trim()));
  const columns = isLabel
    ? ['#', 'Data', 'Nome do Paciente', ...optionalLabelColumns.map(([label]) => label)]
    : ['#', 'Data', 'Sigla da escala', 'Sigla do membro', 'Membro/Situação', 'Tipo', 'Descrição', 'Múltiplo', 'Substituto', 'Turno', 'Pagador', 'Credor', 'Valor (R$)'];
  const rows = isLabel
    ? pdfRecords.map((item, index) => [index + 1, item.date, item.patientName, ...optionalLabelColumns.map(([, getValue]) => getValue(item) || '')])
    : pdfRecords.map((item, index) => [index + 1, item.date, item.scheduleSigla || '', item.memberSigla || '', item.memberStatus, item.eventType, item.description, item.delayMultiple ?? '', item.substitute, item.shift, item.payer, item.creditor, Number(item.amountToPay || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})]);
  const alertRowIndexes = isLabel ? pdfRecords.flatMap((item, index) => ['Particular', 'Complementação'].includes(item.type) ? [index] : []) : [];
  const alertCount = alertRowIndexes.length;
  button.disabled = true;
  let status = target.querySelector('.report-export-status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'report-export-status';
    status.setAttribute('role', 'status');
    target.prepend(status);
  }
  status.textContent = 'Preparando PDF…';
  try {
    const {createAndSharePdf} = await loadReportPdfModule();
    const title = isLabel ? 'ETIQUETAS SAHMT' : 'SAHMT · EVENTOS';
    const periodLabel = isLabel && mode === 'monthly' ? formatReportMonth(period) : period;
    const reportPeriod = `${mode === 'daily' ? 'Relatório diário' : 'Relatório mensal'} de ${periodLabel} · ${pdfRecords.length} entrada(s)${isLabel ? ` · ${alertCount} alerta(s)` : ''}`;
    const result = await createAndSharePdf({title, period: reportPeriod, fileName: `SAHMT-${isLabel ? 'Etiquetas' : 'Eventos'}-${period}`, columns, rows, orientation: isLabel ? 'landscape' : undefined, alertRowIndexes, labelDateGroups});
    status.textContent = result === 'shared' ? 'PDF aberto no compartilhamento do aparelho.' : 'PDF gerado e baixado neste aparelho.';
  } catch (error) {
    status.textContent = error?.name === 'AbortError' ? 'Compartilhamento cancelado.' : `Não foi possível gerar o PDF. ${error?.message || ''}`;
  } finally {
    if (button.isConnected) button.disabled = !records.length;
  }
}

async function loadManagementAreaActivities(area) {
  const detail = document.querySelector('#management-area-detail');
  const loadId = ++managementActivityLoad;
  if (!detail) return;
  if (!area) { detail.innerHTML = '<p class="empty-state">Selecione uma área.</p>'; return; }
  detail.innerHTML = `<header class="management-detail-heading"><div><p class="eyebrow">ATIVIDADES</p><h3>${escapeHtml(area.name || area.title || area.id)}</h3></div>${can('managementActivityWrite') ? '<button class="secondary-button" type="button" id="new-area-activity">Nova atividade</button>' : ''}</header><p class="loading">Carregando atividades…</p>`;
  detail.querySelector('#new-area-activity')?.addEventListener('click', () => {
    const form = document.querySelector('#activity-area');
    if (form) form.value = area.id;
    document.querySelector('[data-module-form]')?.scrollIntoView({behavior: 'smooth', block: 'center'});
    document.querySelector('[data-module-form] input[name="title"]')?.focus({preventScroll: true});
  });
  try {
    const {listManagementActivities, listManagementIndicators, listIndicatorMeasurements, listManagementActionPlans, listManagementActionPlanItems, listManagementDocuments, getManagementTaskScoringRule, listManagementActivityScoreReviews} = await import('./data.js');
    const canReviewActivityPoints = can('managementManage') || (can('qualityManage') && area.id === 'area-gestao-da-qualidade') ||
      (can('managementRead') && Array.isArray(area.managerUids) && area.managerUids.includes(session.user.uid));
    const [activities, indicators, plans, documents, scoringRule, scoreReviews] = await Promise.all([
      ['managementRead', 'managementActivityWrite'].some(can) ? listManagementActivities(area.id) : Promise.resolve([]),
      ['managementRead', 'managementIndicatorsRead', 'managementIndicatorsWrite'].some(can) ? listManagementIndicators(area.id, {pageSize: 12}) : Promise.resolve([]),
      ['managementRead', 'managementPlansManage'].some(can) ? listManagementActionPlans(area.id, {pageSize: 20}) : Promise.resolve([]),
      ['managementRead', 'documentsManage'].some(can) ? listManagementDocuments(area.id, {includeInactive: can('documentsManage'), pageSize: 100}) : Promise.resolve([]),
      can('managementManage') ? getManagementTaskScoringRule() : Promise.resolve(null),
      canReviewActivityPoints ? listManagementActivityScoreReviews(area.id, {pageSize: 50}) : Promise.resolve([])
    ]);
    const scoreReviewByActivity = new Map(scoreReviews.map((review) => [review.activityId, review]));
    const measurements = await Promise.all(indicators.map((indicator) => listIndicatorMeasurements(indicator.id, {pageSize: 6})));
    const planItems = plans.length ? await listManagementActionPlanItems(plans.map((plan) => plan.id)) : [];
    const itemsByPlan = new Map();
    for (const item of planItems) {
      if (!itemsByPlan.has(item.planId)) itemsByPlan.set(item.planId, []);
      itemsByPlan.get(item.planId).push(item);
    }
    if (loadId !== managementActivityLoad || !document.querySelector('#management-area-detail')) return;
    const indicatorsView = indicators.length ? `<section class="management-indicators"><h4>Indicadores · ${indicators.length}</h4><div class="indicator-grid">${indicators.map((indicator, index) => {
      const recent = measurements[index] || [];
      const latest = recent[0];
      const trend = indicator.direction === 'MAX' ? 'Meta máxima' : indicator.direction === 'TARGET' ? 'Meta exata' : 'Meta mínima';
      const period = indicatorPeriodValue(indicator.frequency);
      return `<article class="indicator-card"><h5>${escapeHtml(indicator.name)}</h5><p>${escapeHtml(indicator.description || '')}</p><strong>Meta: ${escapeHtml(indicator.target)} ${escapeHtml(indicator.unit || '')}</strong><small class="record-meta">${trend} · ${escapeHtml(indicator.frequency || '')}</small>${latest ? `<small>Última medição (${escapeHtml(latest.period)}): ${escapeHtml(latest.value)} ${escapeHtml(indicator.unit || '')} · ${latest.status === 'MET' ? 'Meta atingida' : 'Meta pendente'}</small>${latest.notes ? `<small>${escapeHtml(latest.notes)}</small>` : ''}` : '<small>Sem medições registradas.</small>'}${can('managementIndicatorsWrite') ? `<form class="indicator-measure-form" data-indicator-id="${escapeHtml(indicator.id)}"><label>Período<input name="period" required maxlength="8" placeholder="2026-09" value="${period}"></label><label>Valor<input name="value" type="number" step="any" required></label><label>Observação<input name="notes" maxlength="800"></label><button class="secondary-button" type="submit">Registrar medição</button></form>` : ''}</article>`;
    }).join('')}</div></section>` : `<section class="management-indicators"><h4>Indicadores</h4><p class="empty-state">${can('managementIndicatorsWrite') ? 'Nenhum indicador cadastrado nesta área.' : 'Nenhum indicador disponível nesta área.'}</p></section>`;
    const indicatorForm = can('managementIndicatorsWrite') ? `<details class="quick-form indicator-create"><summary>Novo indicador</summary><form id="indicator-create-form"><input type="hidden" name="managementAreaId" value="${escapeHtml(area.id)}"><div class="form-grid"><label>Nome<input name="name" required maxlength="120"></label><label>Unidade<input name="unit" maxlength="40" placeholder="%, dias, unidades"></label><label>Meta<input name="target" type="number" step="any" required></label><label>Direção da meta<select name="direction"><option value="MIN">Atingir ou superar</option><option value="MAX">Manter até o limite</option><option value="TARGET">Atingir valor exato</option></select></label><label>Frequência<select name="frequency"><option value="MONTHLY">Mensal</option><option value="WEEKLY">Semanal</option><option value="QUARTERLY">Trimestral</option><option value="YEARLY">Anual</option></select></label></div><label>Descrição<textarea name="description" rows="2" maxlength="500"></textarea></label><button class="primary-button" type="submit">Criar indicador</button></form></details>` : '';
    const planForm = can('managementPlansManage') ? `<details class="quick-form"><summary>Novo plano de ação</summary><form id="action-plan-create-form"><input type="hidden" name="managementAreaId" value="${escapeHtml(area.id)}"><div class="form-grid"><label>Título<input name="title" required maxlength="160"></label><label>Prazo<input name="dueAt" type="date"></label><label>Prioridade<select name="priority"><option>Normal</option><option>Alta</option><option>Urgente</option></select></label></div><label>Descrição<textarea name="description" rows="2" maxlength="1200"></textarea></label><button class="primary-button" type="submit">Criar plano</button></form></details>` : '';
    const assignmentEditor = can('managementManage') ? `<details class="quick-form management-assignment-editor"><summary>Gestores e equipe</summary><p>Vincule contas pelos UIDs Firebase copiados na Administração. Use um UID por linha; nomes e e-mails não são armazenados aqui.</p><form id="management-assignment-form"><input type="hidden" name="version" value="${Number.isInteger(area.version) && area.version >= 0 ? area.version : 0}"><div class="form-grid"><label>UIDs de gestores<textarea name="managerUids" rows="3" maxlength="12999" placeholder="UID Firebase, um por linha">${escapeHtml((Array.isArray(area.managerUids) ? area.managerUids : []).join('\n'))}</textarea></label><label>UIDs da equipe<textarea name="memberUids" rows="3" maxlength="12999" placeholder="UID Firebase, um por linha">${escapeHtml((Array.isArray(area.memberUids) ? area.memberUids : []).join('\n'))}</textarea></label></div><button class="secondary-button" type="submit">Salvar vínculos</button><p class="record-meta" id="management-assignment-status" role="status" aria-live="polite"></p></form></details>` : '';
    const scoringRuleForm = can('managementManage') ? `<details class="quick-form" id="management-task-scoring"><summary>Pontuação por conclusão</summary><p>Concluir a tarefa não credita pontos automaticamente. Um gestor autorizado revisa cada solicitação; a alteração da regra afeta somente tarefas novas.</p><form id="management-task-scoring-form"><input type="hidden" name="version" value="${Number.isInteger(scoringRule?.version) ? scoringRule.version : 0}"><div class="form-grid"><label>Nome da regra<input name="name" required maxlength="120" value="${escapeHtml(scoringRule?.name || 'Conclusão de tarefa')}"></label><label>Pontos inteiros<input name="points" type="number" min="1" max="1000" step="1" required value="${escapeHtml(scoringRule?.points ?? 10)}"></label><label class="contact-active-field"><input name="active" type="checkbox" ${scoringRule?.active !== false ? 'checked' : ''}> Regra ativa</label></div><label>Descrição<textarea name="description" rows="2" maxlength="500">${escapeHtml(scoringRule?.description || 'Pontos concedidos após revisão independente da conclusão.')}</textarea></label><button class="secondary-button" type="submit">Salvar regra</button><p class="record-meta" id="management-task-scoring-status" role="status" aria-live="polite"></p></form></details>` : '';
    const plansView = `<section class="management-plans"><h4>Planos de ação · ${plans.length}</h4>${planItems.length >= 200 ? '<p class="sync-state">Exibindo até 200 ações detalhadas. Os planos continuam disponíveis.</p>' : ''}${plans.length ? `<ul class="record-list">${plans.map((plan) => {
      const items = itemsByPlan.get(plan.id) || [];
      const action = plan.responsibleUid === session.user.uid && plan.status === 'OPEN' ? `<button class="secondary-button" type="button" data-plan-id="${escapeHtml(plan.id)}" data-next-status="IN_PROGRESS">Iniciar plano</button>` : plan.responsibleUid === session.user.uid && plan.status === 'IN_PROGRESS' ? `<button class="secondary-button" type="button" data-plan-id="${escapeHtml(plan.id)}" data-next-status="COMPLETED">Concluir plano</button>` : '';
      const itemRows = items.length ? `<ul class="action-plan-item-list">${items.map((item) => {
        const responsibleUids = Array.isArray(item.responsibleUids) ? item.responsibleUids : [];
        const responsible = responsibleUids.includes(session.user.uid);
        return `<li><span>${escapeHtml(item.description)}${item.dueAt ? ` · Prazo ${escapeHtml(formatRecordDate(item.dueAt))}` : ''}</span><small>${item.status === 'COMPLETED' ? 'Concluída' : `${responsibleUids.length} responsável(is)`}</small>${item.status === 'OPEN' && responsible ? `<button class="secondary-button" type="button" data-plan-item-complete="${escapeHtml(item.id)}">Concluir ação</button>` : ''}</li>`;
      }).join('')}</ul>` : '<small class="record-meta">Nenhuma ação detalhada adicionada.</small>';
      const itemForm = can('managementPlansManage') && plan.responsibleUid === session.user.uid && plan.status !== 'COMPLETED' ? `<form class="action-plan-item-form" data-plan-item-form="${escapeHtml(plan.id)}"><label>Próxima ação<input name="description" required maxlength="500" placeholder="Descreva uma ação objetiva"></label><label>Prazo<input name="dueAt" type="date"></label><label>UIDs dos responsáveis · até 20 membros desta área<textarea name="responsibleUids" rows="2" maxlength="2600">${escapeHtml(session.user.uid)}</textarea></label><button class="secondary-button" type="submit">Adicionar ação</button></form>` : '';
      return `<li><strong>${escapeHtml(plan.title)}</strong>${plan.description ? `<small>${escapeHtml(plan.description)}</small>` : ''}<small class="record-meta">${escapeHtml(plan.status)} · ${escapeHtml(plan.priority)}${plan.dueAt ? ` · Prazo ${escapeHtml(formatRecordDate(plan.dueAt))}` : ''} · ${items.length} ação(ões)</small>${itemRows}${itemForm}${action}</li>`;
    }).join('')}</ul>` : '<p class="empty-state">Nenhum plano de ação nesta área.</p>'}</section>`;
    const documentForm = can('documentsManage') ? `<details class="quick-form" id="management-document-editor"><summary>Adicionar ou editar documento</summary><form id="management-document-form"><input type="hidden" name="managementAreaId" value="${escapeHtml(area.id)}"><input type="hidden" name="documentId"><input type="hidden" name="version" value="0"><div class="form-grid"><label>Título<input name="title" required maxlength="160"></label><label>Categoria<input name="category" required maxlength="80" placeholder="Protocolo, política, formulário…"></label><label>Link do Google Drive ou Docs<input name="driveUrl" type="url" required maxlength="800" placeholder="https://drive.google.com/file/d/…/view"></label><label class="contact-active-field"><input name="requiredReading" type="checkbox"> Leitura requerida</label><label class="contact-active-field"><input name="active" type="checkbox" checked> Documento ativo</label></div><label>Descrição<textarea name="description" rows="2" maxlength="1200"></textarea></label><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar documento</button><button class="secondary-button" type="button" id="management-document-reset">Novo documento</button></div><p id="management-document-status" class="record-meta" role="status" aria-live="polite"></p></form></details>` : '';
    const documentsView = `<section class="management-documents"><h4>Documentos · ${documents.length}</h4>${documents.length ? `<ul class="record-list">${documents.map((item) => `<li><div class="contact-list-heading"><a class="management-document-link" href="${escapeHtml(item.driveUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>${can('documentsManage') ? `<button class="secondary-button" type="button" data-document-edit="${escapeHtml(item.id)}">Editar</button>` : ''}</div>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}<small class="record-meta">${escapeHtml(item.category)} · v${escapeHtml(item.version)} · ${item.active ? 'Ativo' : 'Inativo'}${item.requiredReading ? ' · Leitura requerida' : ''}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhum documento publicado nesta área.</p>'}</section>`;
    const equipmentView = area.id === 'area-gestao-de-equipamentos'
      ? can('equipmentManage') ? '<div id="equipment-management-root"></div>' : '<section class="equipment-manager"><h4>Equipamentos</h4><p class="empty-state">Esta área exige a permissão Gerenciar equipamentos.</p></section>'
      : '';
    detail.innerHTML = `<header class="management-detail-heading"><div><p class="eyebrow">${activities.length} ATIVIDADE(S)</p><h3>${escapeHtml(area.name || area.title || area.id)}</h3></div>${can('managementActivityWrite') ? '<button class="secondary-button" type="button" id="new-area-activity">Nova atividade</button>' : ''}</header>${assignmentEditor}${scoringRuleForm}${indicatorForm}${planForm}${documentsView}${documentForm}${equipmentView}${indicatorsView}${plansView}${activities.length ? `<ul class="record-list">${activities.map((item) => {
      const responsible = item.responsibleUids?.includes(session.user.uid);
      const scoreReview = scoreReviewByActivity.get(item.id);
      const action = responsible && item.status === 'OPEN' ? `<button class="secondary-button" type="button" data-activity-id="${escapeHtml(item.id)}" data-next-status="IN_PROGRESS">Iniciar</button>` :
        responsible && item.status === 'IN_PROGRESS' && !item.evidenceRequired ? `<button class="secondary-button" type="button" data-activity-id="${escapeHtml(item.id)}" data-next-status="COMPLETED">Concluir${item.pointsEnabled ? ` · ${escapeHtml(item.points)} pts a validar` : ''}</button>` : '';
      const scoreReviewLabel = ({PENDING_VALIDATION: 'Revisão de pontos aguardando processamento.', APPROVED: 'Pontuação aprovada e creditada.', REJECTED: 'Pontuação recusada.', NEEDS_REVIEW: 'Dados divergentes; solicite reconciliação da Administração.'})[scoreReview?.status] || '';
      const reviewAction = canReviewActivityPoints && !responsible && item.status === 'COMPLETED' && item.pointsEnabled === true && !scoreReview
        ? `<div class="activity-score-review-actions"><small>Pontos aguardam aprovação independente.</small><button class="secondary-button" type="button" data-activity-score-review="${escapeHtml(item.id)}" data-review-decision="APPROVE">Aprovar ${escapeHtml(item.points)} pts</button><button class="text-button" type="button" data-activity-score-review="${escapeHtml(item.id)}" data-review-decision="REJECT">Recusar</button></div>` : '';
      const scoreReviewNote = scoreReview?.validationMessage || scoreReview?.note ? `<small>${escapeHtml(scoreReview.validationMessage || scoreReview.note)}</small>` : '';
      const canCancel = (item.createdByUid === session.user.uid || can('managementManage')) && ['OPEN', 'IN_PROGRESS'].includes(item.status);
      const cancelAction = canCancel ? `<button class="text-button" type="button" data-cancel-activity="${escapeHtml(item.id)}">Cancelar</button>` : '';
      const overdue = item.dueAt && item.dueAt < todayInputValue() && ['OPEN', 'IN_PROGRESS'].includes(item.status);
      const evidenceNote = responsible && item.status === 'IN_PROGRESS' && item.evidenceRequired ? '<small>Conclusão aguarda a evidência obrigatória.</small>' : '';
      const participant = item.participantUids?.includes(session.user.uid);
      const canReadConversation = can('managementRead') || item.createdByUid === session.user.uid || responsible || participant;
      const interactions = canReadConversation ? `<details class="activity-interactions" data-activity-interactions="${escapeHtml(item.id)}" data-read-all="${canReadConversation}"><summary>Interações${participant && !responsible ? ' · Participante' : ''} · Ver ou comentar</summary><ul class="activity-interaction-list"><li class="loading">Carregando quando abrir…</li></ul><form class="activity-interaction-form"><label>Comentário<textarea name="content" rows="2" maxlength="1000" required></textarea></label><button class="secondary-button" type="submit">Enviar comentário</button></form></details>` : '';
      const assigneeCount = Array.isArray(item.responsibleUids) ? item.responsibleUids.length : 0;
      const participantCount = Array.isArray(item.participantUids) ? item.participantUids.length : 0;
      return `<li><strong>${escapeHtml(item.title || 'Atividade')}</strong>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}<small class="record-meta">${overdue ? 'Atrasada' : escapeHtml(item.status || 'OPEN')}${item.priority ? ` · ${escapeHtml(item.priority)}` : ''}${item.dueAt ? ` · Prazo ${escapeHtml(formatRecordDate(item.dueAt))}` : ''}${assigneeCount > 1 ? ` · Equipe responsável: ${assigneeCount}` : ''}${participantCount ? ` · Participantes: ${participantCount}` : ''}</small>${evidenceNote}${scoreReviewLabel ? `<small class="record-meta">${scoreReviewLabel}</small>${scoreReviewNote}` : ''}${action}${reviewAction}${cancelAction}${interactions}</li>`;
    }).join('')}</ul>` : '<p class="empty-state">Nenhuma atividade nesta área.</p>'}`;
    if (area.id === 'area-gestao-de-equipamentos' && can('equipmentManage')) {
      const {mountEquipmentManager} = await import('./equipment.js');
      await mountEquipmentManager(detail.querySelector('#equipment-management-root'), {managementAreaId: area.id, uid: session.user.uid});
    }
    detail.querySelector('#new-area-activity')?.addEventListener('click', () => {
      const form = document.querySelector('#activity-area');
      if (form) form.value = area.id;
      document.querySelector('[data-module-form]')?.scrollIntoView({behavior: 'smooth', block: 'center'});
      document.querySelector('[data-module-form] input[name="title"]')?.focus({preventScroll: true});
    });
    const assignmentForm = detail.querySelector('#management-assignment-form');
    assignmentForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type="submit"]');
      const status = form.querySelector('#management-assignment-status');
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        const managers = parseManagementUids(values.managerUids);
        const members = parseManagementUids(values.memberUids);
        button.disabled = true;
        status.textContent = 'Salvando gestores e equipe no Firestore…';
        const {updateManagementAreaAssignments} = await import('./data.js');
        const updated = await updateManagementAreaAssignments(area.id, {
          managerUids: managers, memberUids: members, version: Number(values.version)
        }, session.user.uid);
        area.managerUids = updated.managerUids;
        area.memberUids = updated.memberUids;
        form.elements.managerUids.value = managers.join('\n');
        form.elements.memberUids.value = members.join('\n');
        form.elements.version.value = String(updated.version);
        status.textContent = `Vínculos atualizados · ${managers.length} gestor(es) · ${members.length} pessoa(s) na equipe.`;
      } catch (error) {
        status.textContent = error.message || 'Não foi possível salvar os vínculos.';
      } finally {
        button.disabled = false;
      }
    });
    const documentEditor = detail.querySelector('#management-document-form');
    const resetDocumentEditor = () => {
      documentEditor?.reset();
      if (!documentEditor) return;
      documentEditor.elements.documentId.value = '';
      documentEditor.elements.version.value = '0';
      documentEditor.elements.managementAreaId.value = area.id;
      documentEditor.dataset.mutationId = '';
      documentEditor.elements.active.checked = true;
      const status = documentEditor.querySelector('#management-document-status');
      if (status) status.textContent = '';
      const editor = detail.querySelector('#management-document-editor');
      if (editor) editor.open = false;
    };
    detail.querySelector('#management-document-reset')?.addEventListener('click', resetDocumentEditor);
    documentEditor?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const status = form.querySelector('#management-document-status');
      submit.disabled = true;
      if (status) status.textContent = 'Salvando metadados no Firestore…';
      try {
        const {saveManagementDocument} = await import('./data.js');
        const values = Object.fromEntries(new FormData(form).entries());
        values.documentId = values.documentId || (form.dataset.mutationId ||= crypto.randomUUID());
        values.active = form.elements.active.checked;
        values.requiredReading = form.elements.requiredReading.checked;
        await saveManagementDocument(values, session.user.uid);
        resetDocumentEditor();
        notice = 'Documento vinculado à área no Firestore. O arquivo permanece no Drive.';
        await render();
      } catch (error) {
        submit.disabled = false;
        if (status) status.textContent = error.message || 'Não foi possível salvar o documento.';
      }
    });
    detail.querySelectorAll('[data-document-edit]').forEach((button) => button.addEventListener('click', () => {
      const item = documents.find((document) => document.id === button.dataset.documentEdit);
      if (!item || !documentEditor) return;
      documentEditor.elements.documentId.value = item.id;
      documentEditor.elements.version.value = String(item.version);
      documentEditor.elements.managementAreaId.value = item.managementAreaId;
      documentEditor.elements.title.value = item.title;
      documentEditor.elements.description.value = item.description || '';
      documentEditor.elements.driveUrl.value = item.driveUrl;
      documentEditor.elements.category.value = item.category;
      documentEditor.elements.active.checked = item.active === true;
      documentEditor.elements.requiredReading.checked = item.requiredReading === true;
      detail.querySelector('#management-document-editor').open = true;
      documentEditor.scrollIntoView({behavior: 'smooth', block: 'center'});
      documentEditor.elements.title.focus({preventScroll: true});
    }));
    detail.querySelector('#indicator-create-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const {createManagementIndicator} = await import('./data.js');
        await createManagementIndicator(Object.fromEntries(new FormData(form).entries()), session.user.uid);
        notice = 'Indicador criado no Firestore.';
        await loadManagementAreaActivities(area);
        const createPanel = document.querySelector('.indicator-create');
        if (createPanel) createPanel.open = true;
      } catch (error) {
        submit.disabled = false;
        notice = `Não foi possível criar o indicador. ${error.message || ''}`;
        await render();
      }
    });
    detail.querySelectorAll('.indicator-measure-form').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const indicator = indicators.find((item) => item.id === form.dataset.indicatorId);
        const {recordIndicatorMeasurement} = await import('./data.js');
        const result = await recordIndicatorMeasurement(indicator, Object.fromEntries(new FormData(form).entries()), session.user.uid);
        notice = result.status === 'MET' ? 'Medição registrada; meta atingida.' : 'Medição registrada; meta pendente.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        submit.disabled = false;
        notice = `Não foi possível registrar a medição. ${error.message || ''}`;
        await render();
      }
    }));
    detail.querySelector('#action-plan-create-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const {createManagementActionPlan} = await import('./data.js');
        await createManagementActionPlan(Object.fromEntries(new FormData(form).entries()), session.user.uid);
        notice = 'Plano de ação criado no Firestore e atribuído a você.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        submit.disabled = false;
        notice = `Não foi possível criar o plano. ${error.message || ''}`;
        await render();
      }
    });
    detail.querySelectorAll('[data-plan-id]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const {transitionManagementActionPlan} = await import('./data.js');
        await transitionManagementActionPlan(button.dataset.planId, button.dataset.nextStatus, session.user.uid);
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível atualizar o plano.';
        button.after(message);
      }
    }));
    detail.querySelectorAll('[data-plan-item-form]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const {createManagementActionPlanItem} = await import('./data.js');
        form.dataset.itemId ||= crypto.randomUUID();
        await createManagementActionPlanItem({planId: form.dataset.planItemForm, itemId: form.dataset.itemId, ...Object.fromEntries(new FormData(form).entries())}, session.user.uid);
        notice = 'Ação adicionada ao plano.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        submit.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível adicionar a ação.';
        form.append(message);
      }
    }));
    detail.querySelectorAll('[data-plan-item-complete]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const {completeManagementActionPlanItem} = await import('./data.js');
        await completeManagementActionPlanItem(button.dataset.planItemComplete, session.user.uid);
        notice = 'Ação concluída.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível concluir a ação.';
        button.after(message);
      }
    }));
    detail.querySelectorAll('[data-activity-interactions]').forEach((panel) => {
      panel.addEventListener('toggle', () => {
        if (panel.open && panel.dataset.loaded !== 'true') void loadActivityInteractions(panel, panel.dataset.activityInteractions);
      });
      panel.querySelector('form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          const {addActivityInteraction} = await import('./data.js');
          await addActivityInteraction(panel.dataset.activityInteractions, form.elements.content.value, session.user.uid);
          form.reset();
          panel.dataset.loaded = 'false';
          await loadActivityInteractions(panel, panel.dataset.activityInteractions);
          submit.disabled = false;
        } catch (error) {
          submit.disabled = false;
          const message = document.createElement('small');
          message.className = 'form-error';
          message.textContent = error.message || 'Não foi possível enviar o comentário.';
          form.after(message);
        }
      });
    });
    detail.querySelector('#management-task-scoring-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type="submit"]');
      const status = form.querySelector('#management-task-scoring-status');
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        button.disabled = true;
        status.textContent = 'Salvando regra…';
        const {saveManagementTaskScoringRule} = await import('./data.js');
        await saveManagementTaskScoringRule({...values, active: values.active === 'on'}, session.user.uid);
        status.textContent = 'Regra salva. Tarefas novas usarão esta versão.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || 'Não foi possível salvar a regra.';
      }
    });
    detail.querySelectorAll('[data-activity-id]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const data = await import('./data.js');
        if (button.dataset.nextStatus === 'COMPLETED') {
          const result = await data.completeManagementActivity(button.dataset.activityId, session.user.uid);
          notice = result.pointsPending ? 'Ação concluída. A pontuação ficou pendente de validação.' : 'Ação concluída.';
        } else {
          await data.transitionManagementActivity(button.dataset.activityId, button.dataset.nextStatus, session.user.uid);
        }
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const notice = document.createElement('small');
        notice.className = 'form-error';
        notice.textContent = error.message || 'Não foi possível atualizar a atividade.';
        button.after(notice);
      }
    }));
    detail.querySelectorAll('[data-activity-score-review]').forEach((button) => button.addEventListener('click', async () => {
      const decision = button.dataset.reviewDecision;
      const promptText = decision === 'APPROVE'
        ? 'Observação da aprovação (opcional):'
        : 'Explique por que a pontuação foi recusada:';
      const note = window.prompt(promptText, decision === 'APPROVE' ? '' : '');
      if (note === null) return;
      if (decision === 'APPROVE' && !window.confirm(`Aprovar ${button.textContent.match(/\d+/)?.[0] || 'a'} pontos? O lançamento não pode ser revertido automaticamente.`)) return;
      button.disabled = true;
      try {
        const {submitManagementActivityScoreReview} = await import('./data.js');
        await submitManagementActivityScoreReview(button.dataset.activityScoreReview, session.user.uid, decision, note);
        notice = 'Decisão registrada. O Apps Script processará o ledger de pontos periodicamente.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível registrar a revisão dos pontos.';
        button.after(message);
      }
    }));
    detail.querySelectorAll('[data-cancel-activity]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Cancelar esta atividade? O cancelamento ficará registrado no histórico.')) return;
      button.disabled = true;
      try {
        const {cancelManagementActivity} = await import('./data.js');
        await cancelManagementActivity(button.dataset.cancelActivity, session.user.uid);
        notice = 'Atividade cancelada.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível cancelar a atividade.';
        button.after(message);
      }
    }));
  } catch (error) {
    if (loadId !== managementActivityLoad) return;
    detail.innerHTML = `<p class="empty-state">Não foi possível carregar as atividades. ${escapeHtml(error.message || '')}</p>`;
  }
}

async function loadActivityInteractions(panel, activityId) {
  const list = panel.querySelector('.activity-interaction-list');
  if (!list) return;
  list.innerHTML = '<li class="loading">Carregando interações…</li>';
  try {
    const {listActivityInteractions, getActivityScoreReview} = await import('./data.js');
    const [items, scoreReview] = await Promise.all([
      listActivityInteractions(activityId, session.user.uid, {canReadAll: panel.dataset.readAll === 'true', pageSize: 20}),
      getActivityScoreReview(activityId)
    ]);
    if (!panel.isConnected) return;
    panel.dataset.loaded = 'true';
    const reviewState = ({PENDING_VALIDATION: 'Solicitação de pontuação aguardando processamento.', APPROVED: 'Pontuação aprovada e creditada.', REJECTED: 'Pontuação recusada.', NEEDS_REVIEW: 'Dados divergentes; solicite reconciliação da Administração.'})[scoreReview?.status];
    const reviewNote = scoreReview?.validationMessage || scoreReview?.note ? ` ${escapeHtml(scoreReview.validationMessage || scoreReview.note)}` : '';
    const reviewMarkup = reviewState ? `<li><small class="record-meta">${reviewState}${reviewNote}</small></li>` : '';
    list.innerHTML = `${reviewMarkup}${items.length ? items.map((item) => {
      const pointStatus = item.pointsStatus === 'PENDING_VALIDATION'
        ? scoreReview?.status === 'APPROVED' ? ' · Pontuação aprovada e creditada' : scoreReview?.status === 'REJECTED' ? ' · Pontuação recusada pela Gestão' : ' · Pontuação pendente de aprovação'
        : '';
      return `<li><small class="record-meta">${escapeHtml(interactionDateTime(item.createdAt))} · ${item.uid === session.user.uid ? 'Você' : 'Equipe'}${pointStatus}</small><p>${escapeHtml(item.content)}</p></li>`;
    }).join('') : '<li class="empty-state">Nenhum comentário ainda.</li>'}`;
  } catch (error) {
    if (!panel.isConnected) return;
    panel.dataset.loaded = 'false';
    list.innerHTML = `<li class="empty-state">Não foi possível carregar os comentários. ${escapeHtml(error.message || '')}</li>`;
  }
}

function formatRecordDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo'}).format(date);
}

function interactionDateTime(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'}).format(date);
}

function todayInputValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function indicatorPeriodValue(frequency) {
  const month = todayInputValue();
  if (frequency === 'YEARLY') return month.slice(0, 4);
  if (frequency === 'QUARTERLY') return `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
  if (frequency === 'WEEKLY') {
    const date = new Date(`${month}T12:00:00-03:00`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return month.slice(0, 7);
}

function isChecklistDateDifferentFromLocalDay(item, today = todayInputValue()) {
  const day = item?.payload?.data?.date;
  return item?.type === 'checklists' && typeof day === 'string' && day !== today;
}

async function populateSelect(selector, items, prompt) {
  const select = document.querySelector(selector);
  if (!select) return;
  select.innerHTML = `<option value="">${escapeHtml(prompt)}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.title || item.label || item.id)}</option>`).join('')}`;
}

async function bindModuleForm(route) {
  if (route === 'training' && can('trainingsManage')) {
    const form = document.querySelector('#training-catalog-form');
    const status = document.querySelector('#training-catalog-status');
    const submit = form?.querySelector('[type="submit"]');
    const reset = () => {
      form?.reset();
      if (form) {
        form.elements.trainingId.value = '';
        form.elements.accessPoints.value = '0';
        form.elements.completionPoints.value = '0';
        form.elements.order.value = '0';
        form.elements.active.checked = true;
      }
      if (submit) submit.textContent = 'Salvar treinamento';
      if (status) status.textContent = '';
    };
    document.querySelector('#training-edit-cancel')?.addEventListener('click', reset);
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form || !submit) return;
      submit.disabled = true;
      if (status) status.textContent = 'Salvando treinamento…';
      try {
        const {saveTrainingCatalogRecord} = await import('./data.js');
        await saveTrainingCatalogRecord({
          trainingId: form.elements.trainingId.value,
          title: form.elements.title.value,
          description: form.elements.description.value,
          videoUrl: form.elements.videoUrl.value,
          accessPoints: form.elements.accessPoints.value,
          completionPoints: form.elements.completionPoints.value,
          order: form.elements.order.value,
          active: form.elements.active.checked
        }, session.user.uid);
        notice = 'Treinamento salvo no Firestore.';
        await render();
      } catch (error) {
        if (status) status.textContent = error.code === 'permission-denied'
          ? 'Seu perfil não tem permissão para gerenciar treinamentos.'
          : `Não foi possível salvar. ${error.message || ''}`;
        submit.disabled = false;
      }
    });
    document.querySelectorAll('[data-training-edit]').forEach((button) => button.addEventListener('click', () => {
      const item = loadedTrainingCatalog.find((record) => record.id === button.dataset.trainingEdit);
      if (!item || !form) return;
      for (const name of ['trainingId', 'title', 'description', 'videoUrl', 'accessPoints', 'completionPoints', 'order']) {
        form.elements[name].value = item[name] ?? '';
      }
      form.elements.active.checked = item.active === true;
      if (submit) submit.textContent = 'Atualizar treinamento';
      form.closest('details').open = true;
      form.scrollIntoView({behavior: 'smooth', block: 'center'});
      form.elements.title.focus({preventScroll: true});
    }));
    const activityForm = document.querySelector('#learning-activity-form');
    const activityStatus = document.querySelector('#learning-activity-status');
    const activitySubmit = activityForm?.querySelector('[type="submit"]');
    const setAudienceValue = () => {
      const wrapper = activityForm?.querySelector('.learning-audience-value');
      if (wrapper && activityForm) wrapper.hidden = activityForm.elements.audienceType.value === 'ALL';
    };
    const setLearningSource = () => {
      if (!activityForm) return;
      const kind = activityForm.elements.sourceKind.value;
      const linked = kind !== 'ACKNOWLEDGEMENT';
      const completion = activityForm.elements.completionKind;
      activityForm.elements.resourceUrl.required = linked;
      activityForm.elements.resourceUrl.disabled = !linked;
      if (!linked) activityForm.elements.resourceUrl.value = '';
      completion.querySelector('option[value="ACKNOWLEDGEMENT"]').disabled = kind !== 'EXTERNAL_LINK' && linked;
      if (!linked) completion.value = 'ACKNOWLEDGEMENT';
      else if (kind !== 'EXTERNAL_LINK') completion.value = 'NONE';
    };
    const resetActivity = () => {
      activityForm?.reset();
      if (activityForm) {
        activityForm.elements.activityId.value = '';
        activityForm.elements.startAt.value = todayInputValue();
        activityForm.elements.endAt.value = todayInputValue();
        activityForm.elements.order.value = '0';
        activityForm.elements.showInTraining.checked = true;
        activityForm.elements.active.checked = true;
        activityForm.elements.audienceType.value = 'ALL';
      }
      setAudienceValue();
      setLearningSource();
      if (activitySubmit) activitySubmit.textContent = 'Salvar atividade';
      if (activityStatus) activityStatus.textContent = '';
    };
    document.querySelector('#learning-activity-reset')?.addEventListener('click', resetActivity);
    activityForm?.elements.audienceType.addEventListener('change', setAudienceValue);
    activityForm?.elements.sourceKind.addEventListener('change', setLearningSource);
    setAudienceValue();
    setLearningSource();
    activityForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!activityForm || !activitySubmit) return;
      activitySubmit.disabled = true;
      if (activityStatus) activityStatus.textContent = 'Salvando atividade…';
      try {
        const {saveLearningActivity} = await import('./data.js');
        await saveLearningActivity({
          id: activityForm.elements.activityId.value,
          title: activityForm.elements.title.value,
          description: activityForm.elements.description.value,
          category: activityForm.elements.category.value,
          sourceKind: activityForm.elements.sourceKind.value,
          resourceUrl: activityForm.elements.resourceUrl.value,
          completionKind: activityForm.elements.completionKind.value,
          audienceType: activityForm.elements.audienceType.value,
          audienceValue: activityForm.elements.audienceValue.value,
          startAt: activityForm.elements.startAt.value,
          endAt: activityForm.elements.endAt.value,
          recurrenceMode: activityForm.elements.recurrenceMode.value,
          order: activityForm.elements.order.value,
          showInTraining: activityForm.elements.showInTraining.checked,
          active: activityForm.elements.active.checked
        }, session.user.uid);
        notice = 'Atividade de aprendizagem salva no Firestore.';
        await render();
      } catch (error) {
        if (activityStatus) activityStatus.textContent = error.code === 'permission-denied'
          ? 'Seu perfil não tem permissão para gerenciar atividades de aprendizagem.'
          : `Não foi possível salvar a atividade. ${error.message || ''}`;
        activitySubmit.disabled = false;
      }
    });
    document.querySelectorAll('[data-learning-activity-edit]').forEach((button) => button.addEventListener('click', () => {
      const item = loadedLearningActivityCatalog.find((record) => record.id === button.dataset.learningActivityEdit);
      if (!item || !activityForm) return;
      activityForm.elements.activityId.value = item.id;
      activityForm.elements.title.value = item.title || '';
      activityForm.elements.description.value = item.description || '';
      activityForm.elements.category.value = item.category || '';
      activityForm.elements.sourceKind.value = item.sourceKind || 'EXTERNAL_LINK';
      activityForm.elements.resourceUrl.value = item.resourceUrl || '';
      activityForm.elements.completionKind.value = item.completionKind || 'NONE';
      activityForm.elements.audienceType.value = item.audienceType || 'ALL';
      activityForm.elements.audienceValue.value = item.audienceValue || '';
      activityForm.elements.startAt.value = timestampInputDate(item.startAt);
      activityForm.elements.endAt.value = timestampInputDate(item.endAt);
      activityForm.elements.recurrenceMode.value = item.recurrenceMode || 'ONCE';
      activityForm.elements.order.value = String(item.order ?? 0);
      activityForm.elements.showInTraining.checked = item.showInTraining === true;
      activityForm.elements.active.checked = item.status === 'ACTIVE';
      setAudienceValue();
      setLearningSource();
      if (activitySubmit) activitySubmit.textContent = 'Atualizar atividade';
      if (activityStatus) activityStatus.textContent = '';
      activityForm.closest('details').open = true;
      activityForm.scrollIntoView({behavior: 'smooth', block: 'center'});
      activityForm.elements.title.focus({preventScroll: true});
    }));
    return;
  }
  document.querySelector('[data-module-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(form).entries());
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo'}).format(new Date());
    try {
      if (route === 'people') {
        const {saveContact} = await import('./data.js');
        await saveContact({...values, active: form.elements.active.checked}, session.user.uid);
        notice = 'Contato salvo no Firestore.';
        await render();
        return;
      }
      if (route === 'notifications') {
        const {createNotification} = await import('./data.js');
        await createNotification(values, session.user.uid);
        notice = 'Comunicado publicado no Firestore.';
        await render();
        return;
      }
      let collectionName; let record;
      if (route === 'events') {
        validateEventForm(values);
        const eventRecord = {date: values.eventDate || today, memberSigla: values.memberSigla?.trim().toUpperCase() || '', scheduleSigla: values.scheduleSigla?.trim().toUpperCase() || '', memberStatus: values.memberStatus?.trim() || 'SUPORTE', eventType: values.eventType, description: values.description.trim(), delayMultiple: values.delayMultiple === '' ? null : Number(values.delayMultiple), substitute: values.substitute.trim(), shift: values.shift, payer: values.payer.trim(), creditor: values.creditor.trim(), amountToPay: Number(values.amountToPay || 0), status: 'OPEN'};
        if (values.editEventId) {
          const {updateEventRecord} = await import('./data.js');
          const result = await updateEventRecord(values.editEventId, eventRecord, session.user.uid, Number(values.editEventVersion));
          notice = result.pendingFirestore
            ? 'Edição salva neste aparelho com a versão base. Será enviada quando a conexão voltar; se o registro mudar, o rascunho ficará para comparação.'
            : 'Evento atualizado no Firestore.';
          await render();
          return;
        }
        collectionName = 'events';
        record = eventRecord;
      } else if (route === 'labels') {
        collectionName = 'labels';
        const normalizedType = values.type.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
        const rawAmount = String(values.amount || '').trim().replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
        const amount = rawAmount ? Number(rawAmount) : null;
        if (rawAmount && !Number.isFinite(amount)) throw new Error('Informe um valor válido.');
        const selectedStaffSiglas = [...new Set((values.staffSiglas || '').split(',').map((sigla) => sigla.trim().toUpperCase()).filter(Boolean))];
        const existingLabel = values.editLabelId ? loadedLabelRecords.find((item) => item.id === values.editLabelId) : null;
        const historicStaffUnchanged = existingLabel && JSON.stringify([...(existingLabel.staffSiglas || [])].sort()) === JSON.stringify(selectedStaffSiglas.sort());
        selectedStaffSiglas.sort();
        if (values.creditor !== 'Caixa' && !selectedStaffSiglas.length) throw new Error('Informe as siglas dos plantonistas.');
        const unknownStaff = values.creditor === 'Caixa' ? [] : selectedStaffSiglas.filter((sigla) => !loadedLabelStaffSiglas.includes(sigla));
        if (unknownStaff.length && !historicStaffUnchanged) throw new Error(`Sigla(s) fora do catálogo autorizado: ${unknownStaff.join(', ')}.`);
        if (normalizedType !== 'consulta pre-anestesica' && !values.insurance.trim()) throw new Error('Informe o convênio.');
        const creditor = normalizedType === 'consulta pre-anestesica' ? 'Caixa' : values.creditor;
        record = {date: values.date, patientName: values.patientName.trim(), procedureCode: (values.procedureCode || '').trim(), encounterCode: values.encounterCode.trim(), type: values.type, amount, insurance: normalizedType === 'consulta pre-anestesica' ? '' : (values.insurance || '').trim(), creditor, staffSiglas: creditor === 'Caixa' ? [] : selectedStaffSiglas, consultation: normalizedType === 'consulta pre-anestesica', status: 'CONFIRMED'};
        if (values.editLabelId) {
          const {updateLabelRecord} = await import('./data.js');
          await updateLabelRecord(values.editLabelId, record, session.user.uid);
          notice = 'Etiqueta atualizada no Firestore.';
          await render();
          return;
        }
      } else if (route === 'management') {
        collectionName = 'activities';
        const managementAreaId = String(values.managementAreaId || '').trim();
        const title = String(values.title || '').trim();
        if (!managementAreaId || !title) throw new Error('Selecione a área e informe o título da atividade.');
        const responsibleUids = can('managementManage') ? parseManagementUids(values.responsibleUids, {maxItems: 20}) : [session.user.uid];
        if (!responsibleUids.length) throw new Error('Informe pelo menos um UID responsável cadastrado na equipe da área.');
        const participantUids = can('managementManage') ? parseManagementUids(values.participantUids, {maxItems: 100}) : [];
        if (participantUids.some((uid) => responsibleUids.includes(uid))) throw new Error('Cada pessoa deve ser responsável ou participante; não use o mesmo UID nas duas listas.');
        const pointsEnabled = can('managementManage') && values.pointsEnabled === 'on';
        if (pointsEnabled && responsibleUids.length !== 1) throw new Error('A pontuação de conclusão exige um único responsável.');
        let scoringRule = null;
        if (pointsEnabled) {
          const {getManagementTaskScoringRule} = await import('./data.js');
          scoringRule = await getManagementTaskScoringRule();
          if (!scoringRule?.active) throw new Error('Configure uma regra de pontuação ativa na área Gestão antes de pontuar atividades.');
        }
        record = {
          title,
          description: String(values.description || '').trim(),
          contextType: 'MANAGEMENT_AREA',
          contextId: managementAreaId,
          managementAreaId,
          type: 'TASK',
          status: 'OPEN',
          priority: values.priority,
          responsibleUids,
          participantUids,
          dueAt: values.dueAt || null,
          completedAt: null,
          evidenceRequired: false,
          pointsEnabled,
          points: pointsEnabled ? scoringRule.points : 0,
          scoringRuleId: pointsEnabled ? scoringRule.id : '',
          scoringRuleVersion: pointsEnabled ? scoringRule.version : 0,
          visibility: 'AREA'
        };
      }
      delete record.sign;
      const {createOperationalRecord} = await import('./data.js');
      const result = await createOperationalRecord(collectionName, record, {uid: session.user.uid});
      notice = result.pendingFirestore
        ? 'Registro salvo neste aparelho; será enviado ao Firestore quando a conexão voltar.'
        : 'Registro confirmado no Firestore.';
      await render();
    } catch (error) {
      notice = error.code === 'permission-denied' ? 'Seu perfil não tem permissão para esta ação.' : `Não foi possível salvar. ${error.message || ''}`;
      if (route === 'events') {
        const status = document.querySelector('#event-form-status');
        const refresh = document.querySelector('#event-conflict-refresh');
        if (error.code === 'stale-version') {
          if (status) status.textContent = `${error.message} Seus dados continuam no formulário. Atualize o relatório e compare antes de tentar novamente.`;
          if (refresh) refresh.hidden = false;
        } else if (status) status.textContent = notice;
        notice = '';
        submit.disabled = false;
        return;
      }
      if (route === 'labels') {
        const status = document.querySelector('#label-form-status');
        const refresh = document.querySelector('#label-conflict-refresh');
        if (error.code === 'stale-version') {
          if (status) status.textContent = `${error.message} Seus dados continuam no formulário. Atualize o relatório e compare antes de tentar novamente.`;
          if (refresh) refresh.hidden = false;
        } else if (status) status.textContent = notice;
        submit.disabled = false;
        return;
      }
      submit.disabled = false;
      await render();
    }
  });
  if (route === 'events') {
    const form = document.querySelector('[data-module-form="events"]');
    const eventType = form?.elements.eventType;
    eventType?.addEventListener('change', () => updateEventEntryFields(form));
    form?.elements.memberSigla?.addEventListener('change', () => {
      const sigla = String(form.elements.memberSigla.value || '').trim().toUpperCase();
      const member = loadedEventMembers.find((item) => item.sigla === sigla);
      form.elements.memberStatus.value = member
        ? (member.name === member.sigla ? member.sigla : `${member.sigla} · ${member.name}`)
        : sigla;
      const status = document.querySelector('#event-form-status');
      if (status) status.textContent = sigla && !member
        ? `A sigla ${sigla} não tem nome no cadastro ativo. Confira o membro antes de salvar.`
        : '';
    });
    if (form) updateEventEntryFields(form);
    document.querySelector('#event-conflict-refresh')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const refreshed = await loadEventReport();
      const status = document.querySelector('#event-form-status');
      if (status) status.textContent = refreshed
        ? 'Relatório atualizado. Compare com os valores preservados no formulário antes de salvar novamente.'
        : 'Não foi possível atualizar o relatório. Seus dados continuam no formulário; verifique a conexão e tente novamente.';
      if (button.isConnected) button.disabled = false;
    });
    const catalogForm = document.querySelector('#event-catalog-form');
    catalogForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = catalogForm.querySelector('#event-catalog-status');
      const submit = catalogForm.querySelector('[type="submit"]');
      submit.disabled = true;
      status.textContent = 'Salvando opções no Firestore…';
      try {
        const {saveEventCatalog} = await import('./data.js');
        await saveEventCatalog({payers: catalogForm.elements.payers.value, creditors: catalogForm.elements.creditors.value}, session.user.uid);
        await loadEventEntryCatalog();
        const latestStatus = document.querySelector('#event-catalog-status');
        if (latestStatus) latestStatus.textContent = 'Opções confirmadas no Firestore.';
      } catch (error) {
        status.textContent = error.code === 'permission-denied'
          ? 'Seu perfil não tem permissão para gerenciar o catálogo de Eventos.'
          : error.message || 'Não foi possível salvar as opções.';
      } finally {
        if (submit.isConnected) submit.disabled = false;
      }
    });
  }
  if (route === 'labels') {
    const form = document.querySelector('[data-module-form="labels"]');
    form?.elements.type?.addEventListener('change', () => updateLabelEntryFields(form));
    form?.elements.creditor?.addEventListener('change', () => updateLabelEntryFields(form));
    if (form) updateLabelEntryFields(form);
    if (form) {
      const cleanupOcr = bindLabelOcr(form);
      const {bindLabelCamera} = await import('./label-camera.js');
      if (!form.isConnected) { cleanupOcr(); return; }
      const cleanupCamera = bindLabelCamera(form);
      cleanupLabelOcr = () => { cleanupOcr(); cleanupCamera(); };
    }
    document.querySelector('#label-conflict-refresh')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const refreshed = await loadLabelReport();
      const status = document.querySelector('#label-form-status');
      if (status) status.textContent = refreshed
        ? 'Relatório atualizado. Compare com os valores preservados no formulário antes de salvar novamente.'
        : 'Não foi possível atualizar o relatório. Seus dados continuam no formulário; verifique a conexão e tente novamente.';
      if (button.isConnected) button.disabled = false;
    });
  }
  if (route === 'notifications') {
    const form = document.querySelector('[data-module-form="notifications"]');
    const audience = form?.elements.audienceType;
    const updateAudience = () => {
      const isAll = audience?.value === 'ALL';
      const wrapper = form?.querySelector('#notification-audience-value-wrap');
      if (wrapper) wrapper.hidden = isAll;
      if (form?.elements.audienceValue) {
        form.elements.audienceValue.required = !isAll;
        form.elements.audienceValue.disabled = isAll;
        if (isAll) form.elements.audienceValue.value = '';
      }
    };
    audience?.addEventListener('change', updateAudience);
    updateAudience();
  }
  if (route === 'people') {
    const form = document.querySelector('[data-module-form="people"]');
    document.querySelector('#contact-reset')?.addEventListener('click', () => {
      form?.reset();
      if (form) { form.elements.sigla.readOnly = false; form.elements.sigla.focus(); }
    });
  }
}

async function loadEventEntryCatalog() {
  const form = document.querySelector('[data-module-form="events"]');
  if (!form && !document.querySelector('#event-catalog-form')) return;
  try {
    const {getEventCatalog} = await import('./data.js');
    const catalog = await getEventCatalog(session.user.uid);
    const {listEventMembers} = await import('./data.js');
    const members = await listEventMembers();
    loadedEventMembers = members;
    const memberSelect = form?.elements.memberSigla;
    if (memberSelect) {
      const selected = memberSelect.value;
      memberSelect.replaceChildren(new Option('Selecione uma sigla', ''));
      for (const member of members) memberSelect.add(new Option(member.name === member.sigla ? member.sigla : `${member.sigla} · ${member.name}`, member.sigla));
      if (selected && !members.some((item) => item.sigla === selected)) memberSelect.add(new Option(`${selected} · sigla histórica`, selected));
      memberSelect.value = selected;
      memberSelect.disabled = members.length === 0;
      memberSelect.title = members.length ? '' : 'Cadastre siglas em Etiquetas ou contatos ativos em Pessoas para usar siglas em Eventos.';
    }
    const membersMissing = document.querySelector('#event-members-missing');
    if (membersMissing) membersMissing.hidden = members.length > 0;
    for (const [name, values] of [['payer', catalog.payers], ['creditor', catalog.creditors]]) {
      const select = form?.elements[name];
      if (!select) continue;
      const selected = select.value;
      select.replaceChildren(new Option('Selecione', ''));
      for (const value of values) select.add(new Option(value, value));
      if (selected && !values.includes(selected)) select.add(new Option(`${selected} · opção histórica`, selected));
      select.value = selected;
      select.disabled = values.length === 0;
    }
    const configForm = document.querySelector('#event-catalog-form');
    if (configForm) {
      configForm.elements.payers.value = catalog.payers.join('\n');
      configForm.elements.creditors.value = catalog.creditors.join('\n');
    }
    const note = document.querySelector('#event-catalog-missing');
    if (note) note.hidden = Boolean(catalog.payers.length && catalog.creditors.length);
    const staleNote = document.querySelector('#event-catalog-stale');
    if (staleNote) staleNote.hidden = catalog.stale !== true;
    const submit = form?.querySelector('[type="submit"]');
    if (submit) submit.disabled = !catalog.payers.length || !catalog.creditors.length;
  } catch (error) {
    const status = document.querySelector('#event-catalog-status');
    if (status) status.textContent = `Não foi possível carregar as opções. ${error.message || ''}`;
  }
}

async function loadLabelStaffCatalog() {
  const note = document.querySelector('#label-staff-catalog-note');
  try {
    const {listLabelStaffSiglas} = await import('./data.js');
    loadedLabelStaffSiglas = await listLabelStaffSiglas();
    const datalist = document.querySelector('#label-staff-suggestions');
    if (datalist) datalist.replaceChildren(...loadedLabelStaffSiglas.map((sigla) => new Option(sigla, sigla)));
    const catalogForm = document.querySelector('#label-staff-catalog-form');
    if (catalogForm) catalogForm.elements.siglas.value = loadedLabelStaffSiglas.join(', ');
    if (note) note.textContent = loadedLabelStaffSiglas.length
      ? `${loadedLabelStaffSiglas.length} sigla(s) autorizada(s). Separe múltiplas siglas por vírgula.`
      : 'O catálogo ainda não foi configurado. Peça a alguém com permissão labelsManage para cadastrá-lo.';
  } catch (error) {
    loadedLabelStaffSiglas = [];
    if (note) note.textContent = `Não foi possível carregar o catálogo autorizado. ${error.message || ''}`;
  }
}

function updateLabelEntryFields(form) {
  const normalize = (value) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  const type = normalize(form.elements.type.value);
  const consultation = type === 'consulta pre-anestesica';
  const sadt = type === 'sadt';
  const financial = ['particular', 'complementacao'].includes(type);
  const caixa = form.elements.creditor.value === 'Caixa' || consultation;
  const fields = {procedure: !consultation && !sadt, amount: financial || sadt, insurance: !consultation, staff: !caixa};
  const required = {procedure: !consultation && !sadt, amount: false, insurance: !consultation, staff: !caixa};
  for (const [name, visible] of Object.entries(fields)) {
    const label = form.querySelector(`[data-label-field="${name}"]`);
    const control = label?.querySelector('input');
    if (label) label.hidden = !visible;
    if (control) { control.disabled = !visible; control.required = required[name]; if (!visible) control.value = ''; }
  }
  const creditor = form.elements.creditor;
  if (consultation) creditor.value = 'Caixa';
  creditor.disabled = consultation;
}

function bindLabelOcr(form) {
  const fileInput = form.querySelector('#label-ocr-file');
  const preview = form.querySelector('#label-ocr-preview');
  const frame = form.querySelector('#label-crop-frame');
  const selection = form.querySelector('#label-crop-selection');
  const cropToggle = form.querySelector('#label-crop-toggle');
  const cropReset = form.querySelector('#label-crop-reset');
  const runButton = form.querySelector('#label-ocr-run');
  const status = form.querySelector('#label-ocr-status');
  let preparedImage = null;
  let cropMode = false;
  let cropRect = null;
  let pointerStart = null;
  let imageLoadGeneration = 0;
  const sizePreview = () => {
    if (!preparedImage || !preview.isConnected) return;
    const availableWidth = frame.parentElement?.clientWidth || preparedImage.width;
    const scale = Math.min(1, 300 / preparedImage.height, availableWidth / preparedImage.width);
    const width = Math.max(1, Math.round(preparedImage.width * scale));
    const height = Math.max(1, Math.round(preparedImage.height * scale));
    preview.style.width = `${width}px`;
    preview.style.height = `${height}px`;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(sizePreview) : null;
  if (resizeObserver && frame.parentElement) resizeObserver.observe(frame.parentElement);
  const paintSelection = (rect) => {
    cropRect = rect;
    selection.hidden = !rect;
    cropReset.hidden = !rect;
    if (!rect) return;
    selection.style.left = `${rect.left * 100}%`;
    selection.style.top = `${rect.top * 100}%`;
    selection.style.width = `${rect.width * 100}%`;
    selection.style.height = `${rect.height * 100}%`;
  };
  const point = (event) => {
    const bounds = preview.getBoundingClientRect();
    return {x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))};
  };
  fileInput?.addEventListener('change', async () => {
    const generation = ++imageLoadGeneration;
    const file = fileInput.files?.[0];
    runButton.disabled = true;
    cropToggle.hidden = true;
    frame.hidden = true;
    paintSelection(null);
    preparedImage = null;
    if (!file) return;
    if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type) || file.size > 12 * 1024 * 1024) {
      if (status) status.textContent = file.size > 12 * 1024 * 1024 ? 'Escolha uma imagem com até 12 MB.' : 'Escolha uma imagem JPG, PNG ou WebP.';
      return;
    }
    if (status) status.textContent = 'Preparando a prévia local…';
    try {
      const {prepareLabelImage} = await import('./label-ocr.js');
      const image = await prepareLabelImage(file);
      if (generation !== imageLoadGeneration) return;
      preparedImage = image;
      preview.width = preparedImage.width;
      preview.height = preparedImage.height;
      sizePreview();
      preview.getContext('2d').drawImage(preparedImage, 0, 0);
      frame.hidden = false;
      cropToggle.hidden = false;
      runButton.disabled = false;
      if (status) status.textContent = 'Foto pronta. A leitura só começa quando você tocar no botão.';
    } catch (error) {
      if (generation !== imageLoadGeneration) return;
      if (status) status.textContent = `Não foi possível abrir esta foto. ${error.message || ''}`;
    }
  });
  cropToggle?.addEventListener('click', () => {
    cropMode = !cropMode;
    frame.classList.toggle('is-cropping', cropMode);
    cropToggle.textContent = cropMode ? 'Cancelar recorte' : 'Marcar área para recortar';
    if (status) status.textContent = cropMode ? 'Arraste sobre a foto para marcar a área. A leitura começa quando você tocar no botão.' : 'Recorte cancelado.';
  });
  cropReset?.addEventListener('click', () => { paintSelection(null); cropMode = false; frame.classList.remove('is-cropping'); cropToggle.textContent = 'Marcar área para recortar'; if (status) status.textContent = 'Foto inteira selecionada para leitura.'; });
  preview?.addEventListener('pointerdown', (event) => {
    if (!cropMode || !preparedImage) return;
    event.preventDefault();
    preview.setPointerCapture(event.pointerId);
    pointerStart = point(event);
    paintSelection({left: pointerStart.x, top: pointerStart.y, width: 0, height: 0});
  });
  preview?.addEventListener('pointermove', (event) => {
    if (!pointerStart) return;
    const end = point(event);
    paintSelection({left: Math.min(pointerStart.x, end.x), top: Math.min(pointerStart.y, end.y), width: Math.abs(end.x - pointerStart.x), height: Math.abs(end.y - pointerStart.y)});
  });
  const finishCrop = () => {
    if (!pointerStart) return;
    pointerStart = null;
    if (cropRect && (cropRect.width < .05 || cropRect.height < .05)) paintSelection(null);
    else { cropMode = false; frame.classList.remove('is-cropping'); cropToggle.textContent = 'Ajustar área recortada'; if (status) status.textContent = 'Área marcada. Confira o recorte e toque em “Ler dados”.'; }
  };
  preview?.addEventListener('pointerup', finishCrop);
  preview?.addEventListener('pointercancel', finishCrop);
  runButton?.addEventListener('click', async () => {
    const file = fileInput?.files?.[0];
    if (!file) return;
    runButton.disabled = true;
    if (status) status.textContent = 'Preparando a leitura local…';
    try {
      const {cropLabelImage, readLabelImage} = await import('./label-ocr.js');
      const image = cropRect ? cropLabelImage(preparedImage, cropRect) : preparedImage;
      const result = await readLabelImage(image, (progress) => {
        if (!status) return;
        const percent = Number.isFinite(progress.progress) ? ` ${Math.round(progress.progress * 100)}%` : '';
        status.textContent = `${progress.status || 'Lendo etiqueta'}${percent}`;
      });
      const suggestions = {
        patientName: result.patientName,
        insurance: result.insurance,
        procedureCode: result.procedureCode,
        encounterCode: result.encounterCode,
        type: result.type,
        creditor: result.creditor
      };
      for (const [name, value] of Object.entries(suggestions)) {
        if (value && form.elements[name]) form.elements[name].value = value;
      }
      form.elements.type.dispatchEvent(new Event('change', {bubbles: true}));
      form.elements.creditor.dispatchEvent(new Event('change', {bubbles: true}));
      const uncertainNames = {patientName: 'nome', insurance: 'convênio', procedureCode: 'cirurgia', encounterCode: 'atendimento'};
      const uncertain = result.uncertain.map((field) => uncertainNames[field] || field);
      if (status) status.textContent = uncertain.length
        ? `Rascunho extraído. Confira tudo; leitura incerta ou ausente: ${uncertain.join(', ')}. Nada foi gravado.`
        : 'Rascunho extraído. Confira todos os campos, especialmente os números, antes de salvar. Nada foi gravado.';
    } catch (error) {
      if (status) status.textContent = `Não foi possível ler esta foto neste aparelho. Preencha os campos manualmente. ${error.message || ''}`;
    } finally {
      if (runButton.isConnected) runButton.disabled = !fileInput.files?.[0];
    }
  });
  return () => resizeObserver?.disconnect();
}

function renderTrainingAdminList(items) {
  const target = document.querySelector('#training-admin-list');
  if (!target) return;
  target.innerHTML = items.length ? `<ul class="record-list">${items.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.title || 'Treinamento')}</strong><button class="secondary-button" type="button" data-training-edit="${escapeHtml(item.id)}">Editar</button></div><small>${item.active === true ? 'Ativo' : 'Inativo'} · ordem ${escapeHtml(item.order ?? '—')} · ${escapeHtml(item.videoId || 'vídeo sem ID reconhecido')}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhum treinamento cadastrado. Use o formulário para publicar o primeiro.</p>';
}

function renderLearningActivityAdminList(items) {
  const target = document.querySelector('#learning-activity-admin-list');
  if (!target) return;
  target.innerHTML = items.length ? `<ul class="record-list">${items.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.title || 'Atividade')}</strong><button class="secondary-button" type="button" data-learning-activity-edit="${escapeHtml(item.id)}">Editar</button></div><small>${item.status === 'ACTIVE' ? 'Publicada' : 'Inativa'} · ${escapeHtml(item.sourceKind || 'EXTERNAL_LINK')} · ${escapeHtml(item.audienceType || '')}${item.audienceValue ? ` (${escapeHtml(item.audienceValue)})` : ''} · versão ${escapeHtml(item.version ?? '—')}</small><small class="record-meta">${escapeHtml(item.category || 'Sem categoria')} · ordem ${escapeHtml(item.order ?? '—')}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhuma atividade cadastrada. Use o formulário para publicar a primeira.</p>';
}

function timestampInputDate(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({type, value: part}) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

async function loadChecklistStationAdmin() {
  const form = document.querySelector('#checklist-station-form');
  const target = document.querySelector('#checklist-station-list');
  if (!form || !target) return;
  const status = document.querySelector('#checklist-station-status');
  const cancel = document.querySelector('#station-edit-cancel');
  const reset = () => {
    form.reset();
    form.elements.stationId.value = '';
    form.elements.order.value = '0';
    form.elements.active.checked = true;
    if (status) status.textContent = '';
  };
  cancel?.addEventListener('click', reset);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    if (status) status.textContent = 'Salvando estação…';
    try {
      const {saveChecklistStation, listModuleRecords} = await import('./data.js');
      await saveChecklistStation({
        stationId: form.elements.stationId.value,
        name: form.elements.name.value,
        qrCode: form.elements.qrCode.value,
        start: form.elements.start.value,
        end: form.elements.end.value,
        order: Number(form.elements.order.value),
        active: form.elements.active.checked
      }, session.user.uid);
      reset();
      if (status) status.textContent = 'Estação salva no Firestore.';
      await refresh();
      const activeStations = await listModuleRecords('checklist', session.user.uid, {pageSize: 200});
      await loadChecklistView(activeStations);
    } catch (error) {
      if (status) status.textContent = error.code === 'permission-denied'
        ? 'Seu perfil não tem permissão para manter o catálogo do Checklist.'
        : error.message || 'Não foi possível salvar a estação.';
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  async function refresh() {
    try {
      const {listChecklistStations} = await import('./data.js');
      const stations = await listChecklistStations();
      target.innerHTML = stations.length ? `<ul class="record-list">${stations.map((station) => `<li><div class="contact-list-heading"><strong>${escapeHtml(station.name || station.id)}</strong><button class="secondary-button" type="button" data-station-edit="${escapeHtml(station.id)}">Editar</button></div><small>${escapeHtml(station.qrCode || '')} · ordem ${escapeHtml(station.order ?? 0)} · ${station.active ? 'Ativa' : 'Inativa'}</small><small class="record-meta">${station.start ? `De ${escapeHtml(formatRecordDate(station.start))}` : 'Sem início'} · ${station.end ? `até ${escapeHtml(formatRecordDate(station.end))}` : 'sem fim'}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhuma estação cadastrada. Adicione a primeira estação para iniciar o Checklist.</p>';
      target.querySelectorAll('[data-station-edit]').forEach((button) => button.addEventListener('click', () => {
        const station = stations.find((item) => item.id === button.dataset.stationEdit);
        if (!station) return;
        form.elements.stationId.value = station.id;
        form.elements.name.value = station.name || '';
        form.elements.qrCode.value = station.qrCode || '';
        form.elements.start.value = station.start || '';
        form.elements.end.value = station.end || '';
        form.elements.order.value = String(station.order ?? 0);
        form.elements.active.checked = station.active === true;
        if (status) status.textContent = `Editando ${station.name || station.id}.`;
        form.scrollIntoView({behavior: 'smooth', block: 'center'});
        form.elements.name.focus({preventScroll: true});
      }));
    } catch (error) {
      target.innerHTML = `<p class="empty-state">Não foi possível carregar o catálogo de estações. ${escapeHtml(error.message || '')}</p>`;
    }
  }
  await refresh();
}

function bindEventSchedule() {
  const dateInput = document.querySelector('#event-schedule-date');
  const content = document.querySelector('#event-schedule-content');
  if (!dateInput || !content) return;
  dateInput.value = localDateKey();
  let requestSequence = 0;
  const vacationCache = new Map();
  const render = async () => {
    const requestId = ++requestSequence;
    const day = dateInput.value;
    if (!day) return;
    const weekday = new Intl.DateTimeFormat('pt-BR', {weekday: 'long', timeZone: 'UTC'}).format(new Date(`${day}T12:00:00Z`));
    const weekdayLabel = document.querySelector('#event-schedule-weekday');
    if (weekdayLabel) weekdayLabel.textContent = `${weekday} · toque em uma sigla para lançar um evento`;
    content.innerHTML = '<p class="loading">Carregando escala…</p>';
    try {
      const {readSchedule, listVacationsForDate} = await import('./data-lite.js');
      const cachedVacations = vacationCache.get(day);
      const vacationsPromise = cachedVacations && Date.now() - cachedVacations.at < 30_000
        ? Promise.resolve({items: cachedVacations.items})
        : listVacationsForDate(day, {uid: session.user.uid}).then((items) => {
          vacationCache.set(day, {items, at: Date.now()});
          if (vacationCache.size > 40) vacationCache.delete(vacationCache.keys().next().value);
          return {items};
        }, (error) => ({error}));
      const schedule = await readSchedule(day, session.user.uid);
      if (requestId !== requestSequence || !content.isConnected) return;
      if (!schedule) {
        content.innerHTML = '<p class="empty-state">Nenhuma escala publicada para esta data.</p>';
        return;
      }
      let vacations = [];
      let vacationsError = false;
      const draw = () => {
        if (requestId !== requestSequence || !content.isConnected) return;
        const view = buildScheduleView(schedule, day, vacations, []);
        if (!view.positions.length) {
          content.innerHTML = '<p class="empty-state">A escala está publicada sem posições para esta data.</p>';
          return;
        }
        const vacationLabel = view.vacationLabel ? `<p class="event-schedule-vacation">Férias · ${escapeHtml(view.vacationLabel)}</p>` : '';
        const vacationStatus = vacationsError ? '<p class="sync-state">Não foi possível consultar as férias deste dia.</p>' : vacations.some((vacation) => vacation.stale) ? '<p class="sync-state">Férias carregadas do cache deste aparelho.</p>' : '';
        content.innerHTML = `${vacationLabel}<div class="siglas-grid event-siglas-grid">${view.positions.map((position, index) => {
          const showVacationRank = position.siglas.length > 1;
          const singleSiglaOnVacation = !showVacationRank && position.vacationParts.length === 1;
          const aliases = position.sigla === 'DC' && position.siglas.length ? `<small class="sigla-token__aliases">${renderScheduleAliases(position.siglas, position.vacationParts, [], view.vacationPositions, showVacationRank)}</small>` : '';
          const label = position.sigla === 'DC' ? '<strong>DC</strong>' : `<strong>${renderScheduleSigla(position.sigla, position.vacationParts, [], view.vacationPositions, showVacationRank)}</strong>`;
          const vacationDescription = position.vacationParts.length ? `; em férias: ${position.vacationParts.map((sigla) => `${sigla}, posição ${position.vacationPositions[sigla]} na escala de férias`).join('; ')}` : '';
          return `<div class="sigla-item"><button class="sigla-token sigla-button${singleSiglaOnVacation ? ' sigla-token--vacation' : ''}" type="button" data-event-schedule-position="${index}" ${can('eventsWrite') ? '' : 'disabled'} aria-label="${can('eventsWrite') ? `Lançar evento pela sigla ${escapeHtml(position.sigla)}` : `Sigla ${escapeHtml(position.sigla)}`}${escapeHtml(vacationDescription)}" title="${can('eventsWrite') ? 'Lançar evento' : 'Somente consulta'}">${label}${aliases}</button><div class="sigla-index">${escapeHtml(position.position || index + 1)}</div></div>`;
        }).join('')}</div>${schedule.stale ? '<p class="sync-state">Mostrando a última escala salva neste aparelho.</p>' : ''}${vacationStatus}`;
        content.querySelectorAll('[data-event-schedule-position]').forEach((button) => button.addEventListener('click', () => {
          const position = view.positions[Number(button.dataset.eventSchedulePosition)];
          if (position) void launchEventFromSchedule(day, position);
        }));
      };
      draw();
      const vacationResult = await vacationsPromise;
      if (requestId !== requestSequence || !content.isConnected) return;
      vacations = vacationResult.items || [];
      vacationsError = Boolean(vacationResult.error);
      draw();
    } catch (error) {
      if (requestId !== requestSequence || !content.isConnected) return;
      content.innerHTML = `<p class="empty-state">${error.code === 'permission-denied' ? 'Seu perfil precisa de permissão para consultar a escala.' : 'Não foi possível carregar a escala. Verifique a conexão e tente novamente.'}</p>`;
    }
  };
  document.querySelector('#event-schedule-previous')?.addEventListener('click', () => { dateInput.value = shiftDateKey(dateInput.value, -1); void render(); });
  document.querySelector('#event-schedule-today')?.addEventListener('click', () => { dateInput.value = localDateKey(); void render(); });
  document.querySelector('#event-schedule-next')?.addEventListener('click', () => { dateInput.value = shiftDateKey(dateInput.value, 1); void render(); });
  dateInput.addEventListener('change', render);
  void render();
}

async function launchEventFromSchedule(day, position) {
  if (!can('eventsWrite')) return;
  const scheduleSigla = String(position.sigla || '').trim().toUpperCase();
  const scheduledSiglas = [...new Set((position.siglas?.length ? position.siglas : [scheduleSigla])
    .map((sigla) => String(sigla || '').trim().toUpperCase()).filter((sigla) => /^(?:[A-Z]{2}|L2)$/.test(sigla)))];
  const choices = scheduledSiglas.map((sigla) => loadedEventMembers.find((member) => member.sigla === sigla) || {sigla, name: sigla});
  let selected = choices[0] || {sigla: scheduleSigla, name: scheduleSigla};
  if (choices.length > 1) {
    selected = await chooseEventScheduleMember(scheduleSigla, choices);
    if (!selected) return;
  }
  const form = document.querySelector('[data-module-form="events"]');
  if (!form) return;
  const memberSigla = String(selected.sigla || scheduleSigla).toUpperCase();
  if (![...form.elements.memberSigla.options].some((option) => option.value === memberSigla)) {
    form.elements.memberSigla.add(new Option(`${memberSigla} · sigla da escala`, memberSigla));
  }
  form.elements.eventDate.value = day;
  form.elements.memberSigla.value = memberSigla;
  form.elements.memberStatus.value = selected.name && selected.name !== memberSigla ? `${memberSigla} · ${selected.name}` : memberSigla;
  form.elements.scheduleSigla.value = scheduleSigla;
  form.elements.eventType.value = '';
  form.elements.delayMultiple.value = '';
  form.elements.substitute.value = '';
  form.elements.shift.value = '';
  form.elements.payer.value = '';
  form.elements.creditor.value = '';
  form.elements.amountToPay.value = '';
  form.elements.description.value = '';
  updateEventEntryFields(form);
  const status = document.querySelector('#event-form-status');
  status.textContent = selected.name === memberSigla
    ? `Sigla ${memberSigla} selecionada. O nome precisa ser conferido no cadastro de Pessoas.`
    : `Evento iniciado para ${selected.name} · ${memberSigla}.`;
  form.closest('details')?.setAttribute('open', '');
  form.scrollIntoView({behavior: 'smooth', block: 'start'});
  form.elements.eventType.focus({preventScroll: true});
}

function chooseEventScheduleMember(scheduleSigla, choices) {
  const dialog = document.querySelector('#event-schedule-choice-dialog');
  const options = document.querySelector('#event-schedule-choice-options');
  if (!dialog || !options) return Promise.resolve(null);
  document.querySelector('#event-schedule-choice-title').textContent = `Escolha o anestesiologista · ${scheduleSigla}`;
  options.replaceChildren();
  let selected = null;
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = choice.name && choice.name !== choice.sigla ? `${choice.name} · ${choice.sigla}` : `Sigla ${choice.sigla} · nome não cadastrado`;
    button.addEventListener('click', () => { selected = choice; dialog.close(); });
    options.append(button);
  }
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(selected), {once: true});
    dialog.showModal();
  });
}

function updateEventEntryFields(form) {
  const rules = eventFieldRules(form.elements.eventType.value);
  const fieldState = rules;
  for (const [name, visible] of Object.entries(fieldState)) {
    const field = form.querySelector(`[data-event-field="${name}"]`);
    if (field) field.hidden = !visible;
    if (form.elements[name]) {
      form.elements[name].required = visible;
      if (!visible) form.elements[name].value = '';
      form.elements[name].disabled = !visible && name === 'memberStatus';
    }
  }
  if (form.elements.memberSigla) {
    form.elements.memberSigla.required = rules.memberStatus;
    form.querySelector('[data-event-field="memberStatus"]')?.toggleAttribute('hidden', !rules.memberStatus);
    form.elements.memberSigla.disabled = !rules.memberStatus || form.elements.memberSigla.options.length <= 1;
    form.elements.memberStatus.required = rules.memberStatus;
    form.elements.memberStatus.disabled = !rules.memberStatus;
  }
}

async function render() {
  if (cleanupLabelOcr) {
    cleanupLabelOcr();
    cleanupLabelOcr = null;
  }
  stopChecklistQrScanner();
  if (cleanupCurrentModule) {
    const cleanup = cleanupCurrentModule;
    cleanupCurrentModule = null;
    await cleanup();
  }
  if (session.status === 'checking' || session.status === 'loading-profile') {
    app.innerHTML = `<main class="boot-screen" role="status" aria-live="polite"><div class="boot-card">
      <img src="${import.meta.env.BASE_URL}assets/icon-192.png" width="76" height="76" alt="SAHMT">
      <strong>SAHMT</strong><span>Iniciando o aplicativo…</span><span class="boot-slogan">Gestão Responsável!</span>
      <span class="boot-particles" aria-hidden="true">${[
        [-92, 48, '.02s', '#46d98b'], [-68, 66, '.10s', '#43a5ff'], [-43, 38, '.18s', '#ffc857'], [-21, 78, '.26s', '#ff7a59'],
        [4, 52, '.34s', '#b88cff'], [28, 72, '.42s', '#5ee7d2'], [53, 43, '.50s', '#ffd166'], [80, 64, '.58s', '#ff8fb3'],
        [-106, 88, '.66s', '#7ce38b'], [104, 82, '.74s', '#70b7ff'], [-57, 96, '.82s', '#ffb347'], [62, 98, '.90s', '#d59bff']
      ].map(([x, y, delay, color]) => `<i class="boot-particle" style="--x:${x}px;--y:${y}px;--d:${delay};--c:${color}"></i>`).join('')}</span>
      <i class="boot-spinner" aria-hidden="true"></i>
    </div></main>`;
    return;
  }
  if (session.status !== 'signed-in') {
    app.innerHTML = loginView();
    bindLogin();
    return;
  }
  const requestedRoute = currentRoute();
  if (!featureEnabledForRoute(requestedRoute, appFeatures)) {
    notice = `${labels[requestedRoute]?.[0] || 'Esta área'} está desativada pela Administração.`;
    navigate('home');
    return;
  }
  app.innerHTML = shellView();
  preloadOperationalDataWhenIdle(session.user);
  document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.route)));
  document.querySelector('#outbox-open')?.addEventListener('click', () => navigate('offline'));
  document.querySelector('#logout')?.addEventListener('click', async () => {
    if (cleanupCurrentModule) { const cleanup = cleanupCurrentModule; cleanupCurrentModule = null; await cleanup(); }
    await signOutGlobal();
  });
  if (currentRoute() === 'home') await loadHome(); else {
    await loadModule(currentRoute());
    await bindModuleForm(currentRoute());
  }
  void updateOutboxStatus();
  if (navigator.onLine) void syncOutbox();
}

async function updateOutboxStatus() {
  const target = document.querySelector('#outbox-status');
  if (!target || session.status !== 'signed-in') return;
  const [counts, pendingProgress] = await Promise.all([
    operationCounts(session.user.uid),
    pendingTrainingProgressCount(session.user.uid)
  ]);
  const count = counts.queued + counts.failed + counts.conflict;
  const details = [count ? `${count} ação(ões) ${counts.conflict ? 'para revisar' : counts.failed ? 'com falha' : 'pendente(s)'}` : '', pendingProgress ? `progresso de vídeo pendente (${pendingProgress})` : ''].filter(Boolean).join(' · ');
  const syncLabel = !navigator.onLine ? `Offline${details ? ` · ${details}` : ''}` : details || (session.offline ? 'Perfil local' : 'Sincronizado');
  const isSynced = syncLabel === 'Sincronizado';
  target.innerHTML = `<button type="button" id="outbox-open" class="sync-status-button${isSynced ? ' sync-status-button--synced' : ''}" aria-label="${escapeHtml(`${syncLabel} — abrir estado de sincronização`)}">${isSynced ? '<span class="sync-status-icon" aria-hidden="true">✓</span><span class="sr-only">Sincronizado</span>' : escapeHtml(syncLabel)}</button>${counts.failed ? '<button type="button" id="retry-outbox">Tentar novamente</button>' : ''}`;
  target.querySelector('#outbox-open')?.addEventListener('click', () => navigate('offline'));
  target.querySelector('#retry-outbox')?.addEventListener('click', async () => {
    await retryFailedOperations(session.user.uid);
    await syncOutbox();
  });
}

function scheduleOutboxRetry(uid, attemptAt) {
  if (!uid || !Number.isFinite(attemptAt)) {
    if (!uid || outboxRetryUid === uid) {
      clearTimeout(outboxRetryTimer);
      outboxRetryTimer = null;
      outboxRetryAt = 0;
      outboxRetryUid = '';
    }
    return;
  }
  if (outboxRetryTimer && outboxRetryUid === uid && outboxRetryAt <= attemptAt) return;
  clearTimeout(outboxRetryTimer);
  outboxRetryUid = uid;
  outboxRetryAt = attemptAt;
  outboxRetryTimer = window.setTimeout(() => {
    outboxRetryTimer = null;
    outboxRetryAt = 0;
    outboxRetryUid = '';
    if (session.status === 'signed-in' && session.user.uid === uid && navigator.onLine) void syncOutbox();
  }, Math.max(0, attemptAt - Date.now()));
}

async function scheduleNextOutboxRetry(uid) {
  try {
    scheduleOutboxRetry(uid, await nextQueuedAttemptAt(uid));
  } catch (error) {
    console.warn('[SAHMT sync] Não foi possível agendar a próxima tentativa:', error.code || error.message);
  }
}

async function syncOutbox() {
  if (!navigator.onLine || session.status !== 'signed-in') return;
  const uid = session.user.uid;
  try {
    const [counts, pendingProgress] = await Promise.all([
      operationCounts(uid),
      pendingTrainingProgressCount(uid)
    ]);
    if (!counts.queued && !pendingProgress) return;
    const {flushOutbox, syncPendingTrainingProgress} = await import('./data.js');
    await flushOutbox(uid);
    await syncPendingTrainingProgress(uid);
    await updateOutboxStatus();
    if (currentRoute() === 'offline') {
      const content = document.querySelector('#module-content');
      if (content) await loadOfflineView(content);
    }
  } catch (error) {
    console.warn('[SAHMT sync] Outbox indisponível:', error.code || error.message);
  } finally {
    if (session.status === 'signed-in' && session.user.uid === uid) await scheduleNextOutboxRetry(uid);
  }
}

function bindLogin() {
  document.querySelector('#request-access')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Enviando solicitação…';
    notice = '';
    try {
      const {createAccessRequest} = await import('./data.js');
      await createAccessRequest(session.user);
      session = {...session, status: 'access-pending'};
      notice = 'Solicitação enviada. O administrador verá o pedido na área Administração.';
    } catch (error) {
      notice = error.code === 'permission-denied'
        ? 'O Firestore não autorizou o pedido. Entre com a conta Google correta e tente novamente.'
        : `Não foi possível enviar a solicitação: ${error.message || error}`;
    }
    await render();
  });
  document.querySelector('#profile-retry')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    notice = '';
    await retryAuthenticatedProfile();
  });
  document.querySelector('#google-login')?.addEventListener('click', async () => {
    try { notice = ''; await signInGoogle(); }
    catch { notice = 'Não foi possível entrar com Google. Verifique a conta e tente novamente.'; await render(); }
  });
  document.querySelector('#blocked-signout')?.addEventListener('click', () => signOutGlobal());
}

function sessionChanged(next) {
  const userChanged = session.user?.uid !== next.user?.uid;
  if (next.status !== 'signed-in' || userChanged) scheduleOutboxRetry('', null);
  if (next.status !== 'signed-in') {
    appFeatures = {...DEFAULT_APP_FEATURES};
    appFeaturesUid = '';
    appFeaturesLoadSequence++;
  } else if (userChanged) {
    appFeatures = {...DEFAULT_APP_FEATURES};
    appFeaturesUid = '';
  }
  session = next;
  notice = '';
  void render();
  if (next.status === 'signed-in' && (userChanged || appFeaturesUid !== next.user.uid)) void refreshAppFeatures(next.user.uid);
}
async function refreshAppFeatures(uid, force = false) {
  if (!uid || (!force && appFeaturesUid === uid)) return;
  const sequence = ++appFeaturesLoadSequence;
  appFeaturesUid = uid;
  try {
    const {readAppFeatures} = await import('./data-lite.js');
    const features = normalizeAppFeatures(await readAppFeatures(uid));
    if (sequence !== appFeaturesLoadSequence || session.status !== 'signed-in' || session.user?.uid !== uid) return;
    appFeatures = features;
    await render();
  } catch (error) {
    if (sequence !== appFeaturesLoadSequence || session.status !== 'signed-in' || session.user?.uid !== uid) return;
    appFeatures = {...DEFAULT_APP_FEATURES};
    console.warn('[SAHMT] Configuração de módulos indisponível; usando padrões locais:', error.code || error.message);
  }
}
window.addEventListener('hashchange', () => { if (session.status === 'signed-in') void render(); });
window.addEventListener('online', () => {
  if (session.status === 'signed-in') {
    void refreshAppFeatures(session.user.uid, true);
    void syncOutbox();
  }
});
window.addEventListener('offline', () => { void updateOutboxStatus(); });
window.addEventListener('sahmt-write-synced', (event) => {
  void updateOutboxStatus();
  if (event.detail?.type === 'scheduleReleases' && currentRoute() === 'home') void render();
});
window.addEventListener('sahmt-write-queued', () => {
  void updateOutboxStatus();
  if (navigator.onLine && session.status === 'signed-in') void syncOutbox();
});
window.addEventListener('sahmt-write-rejected', (event) => {
  notice = `O Firestore recusou a gravação sincronizada; ela não foi confirmada. ${event.detail?.message || ''}`;
  void render();
});
watchSession(sessionChanged);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, {scope: import.meta.env.BASE_URL}).catch((error) => console.error('[SAHMT PWA] Service Worker', error)));
}
