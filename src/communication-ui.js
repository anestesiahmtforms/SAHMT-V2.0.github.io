import {BUILTIN_GROUPS, adminIdentity} from '../communication/domain.js';
import {communicationEntryFromSession} from './communication-entry.js';
import {communicationSenderRole, operationalNoticeIdentity} from './communication-operational-notices.js';
import {escapeNoticeHtml as esc, linkedNoticeText} from './communication-notice-text.js';
import {communicationLimitMessage} from './communication-usage.js';
import {openActivityComposer} from './communication-activity-ui.js';
import {restoreActivitySelection} from './communication-activity-selection.js';
import {openCommunicationHistory, communicationDate} from './communication-history-ui.js';
import {communicationRecipientOptions} from './communication-recipient-directory.js';
import './communication.css';

const errors = {
  COMM_SESSION_INVALID: 'Recupere o acesso na entrada do SAHMT e reabra a Central.',
  COMM_FORBIDDEN: 'Sua conta não tem autorização para esta ação.',
  COMM_INVALID_AUDIENCE: 'O destinatário não está disponível. Selecione novamente.',
  COMM_INVALID_INPUT: 'Confira o título, a descrição e o público.',
  COMM_IDENTITY_MISMATCH: 'Recupere o acesso usando a mesma conta Google aberta no SAHMT.',
  COMM_SOURCE_UNAVAILABLE: 'A origem da atividade está indisponível. Recarregue e tente novamente.',
  COMM_SOURCE_FORBIDDEN: 'Sua conta não tem acesso à origem da atividade. Recupere o acesso com a conta autorizada.',
  COMM_HISTORY_CONFIG_REQUIRED: 'O catálogo não está disponível porque o histórico do FF ainda não está configurado. Confira a planilha e o identificador do histórico nas configurações do Worker.',
  COMM_ACTIVITY_UNAVAILABLE: 'A atividade não está disponível. Recarregue e escolha outra atividade publicada.',
  COMM_INVALID_ACTIVITY: 'Confira a atividade publicada e a nota mínima informada.',
  COMM_INVALID_DEADLINE: 'Informe um prazo válido em dias ou horas.',
  COMM_HISTORY_UNAVAILABLE: 'O histórico está indisponível. Tente novamente.',
  COMM_HISTORY_FORBIDDEN: 'O serviço não conseguiu acessar o histórico. Solicite a revisão do acesso administrativo.',
};
const needsGoogle = error => ['COMM_SESSION_INVALID', 'COMM_IDENTITY_MISMATCH'].includes(error.code);
const audienceOptions = [{id: 'ALL', name: 'TODOS'}, ...BUILTIN_GROUPS, {id: 'USER', name: 'INDIVIDUAL'}];

export function mountCommunication(host, {client, adminMode = false, appSession = null, isCurrent = () => true, onBack = () => {}} = {}) {
  const inboxDialog = adminMode ? null : host.ownerDocument.createElement('dialog');
  if (inboxDialog) {
    inboxDialog.className = 'comm-received-dialog';
    inboxDialog.setAttribute('aria-label', 'Mensagens recebidas');
    host.replaceChildren(inboxDialog);
    inboxDialog.showModal();
  }
  const root = inboxDialog || host;
  let inboxObserver;
  let disposed = false;
  let generation = 0;
  let cleanupGoogle = () => {};
  let composeState;
  let activityState;
  let directory;
  const active = () => !disposed && isCurrent();
  const dialog = root.closest('.management-hub-dialog');
  const canCreateEvents = adminMode && adminIdentity(appSession?.user) && Boolean(communicationSenderRole(appSession.user.email));
  const canManageCommunication = canCreateEvents && !operationalNoticeIdentity(appSession.user);
  if (canManageCommunication) activityState = restoreActivitySelection(appSession.user);

  async function pendingEventKey(payload) {
    const uid = appSession?.user?.uid;
    if (!uid) return '';
    const fingerprint = JSON.stringify([payload.title, payload.description, payload.audience, payload.recipient]);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    return `sahmt-ff-pending-event:${uid}:${hash}`;
  }

  function render(title, content, {compose = false, menu = false, inbox = false, sent = false, activity = false} = {}) {
    inboxObserver?.disconnect();
    generation++;
    root.classList.add('communication');
    root.classList.toggle('communication--compose', compose);
    root.classList.toggle('communication--activity', activity);
    root.classList.toggle('communication--menu', menu);
    root.classList.toggle('communication--inbox', inbox);
    root.classList.toggle('communication--sent', sent);
    root.classList.toggle('communication--received', inbox && !sent);
    const hubHeading = dialog?.querySelector('#management-hub-title');
    if (hubHeading) hubHeading.textContent = activity ? title : compose ? 'CRIAR E ENVIAR EVENTO' : sent ? title : 'CENTRAL DE COMUNICAÇÃO';
    const heading = inbox && hubHeading || (menu || compose || activity) && hubHeading ? '' : `<header class="comm-heading"><h2 tabindex="-1">${esc(title)}</h2></header>`;
    const navigation = compose || activity ? '<button type="button" data-back>VOLTAR</button>' :
      sent ? '<button type="button" data-home>VOLTAR</button>' : inbox ? '<button type="button" data-back>VOLTAR PARA HOME</button>' : '';
    root.innerHTML = `${heading}<section class="comm-content">${content}</section><div class="comm-status" role="status" aria-live="polite"></div>${navigation ? `<footer class="comm-actions">${navigation}</footer>` : ''}`;
    (root.querySelector('h2') || hubHeading)?.focus({preventScroll: true});
  }

  function status(message, error = false) {
    const element = root.querySelector('.comm-status');
    if (!active() || !element) return;
    element.textContent = message;
    element.dataset.error = String(error);
  }

  function report(error, fallback = 'Confira a conexão e tente novamente.') {
    status(communicationLimitMessage(error) || errors[error.code] || fallback, true);
  }

  function recoverGoogle() {
    directory = undefined;
    cleanupGoogle();
    render('Acesso à Central de Comunicação', '<p>O acesso automático é coordenado pela entrada do SAHMT.</p><div data-comm-google></div>');
    const ticket = generation;
    const current = () => active() && generation === ticket;
    void client.connectGoogle(root.querySelector('[data-comm-google]'), {
      onConnected: async () => {
        if (!current()) return;
        cleanupGoogle();
        cleanupGoogle = () => {};
        await bootstrap();
      },
      onError: () => { if (current()) status('Escolha a mesma conta Google já aberta no SAHMT e tente novamente.', true); },
    }).then(cleanup => {
      if (current()) cleanupGoogle = cleanup;
      else cleanup?.();
    }).catch(() => { if (current()) status('Não foi possível carregar o Google. Reabra a Central.', true); });
  }

  function adminMenu() {
    composeState = undefined;
    activityState = undefined;
    if (canCreateEvents) {
      if(!directory){const request=loadDirectory();directory=request;void request.catch(()=>{if(directory===request)directory=undefined;});}
      render('Central de Comunicação', '<div class="comm-menu"><button type="button" data-create-event>CRIAR E ENVIAR EVENTO</button>'+ 
        (canManageCommunication?'<button type="button" data-create-activity>TREINAMENTOS E ENQUETES</button><button type="button" data-sent-messages>MENSAGENS ENVIADAS</button>':'')+'</div>', {menu: true});
      return;
    }
    void inbox();
  }

  async function loadDirectory() {
    const users = new Map();
    const cursors = new Set();
    let cursor = '';
    do {
      const page = await client.request('DIRECTORY', {cursor});
      for (const user of page.items) users.set(user.uid, user);
      cursor = page.cursor;
      if (!cursor) return [...users.values()];
      if (!active() || cursors.has(cursor) || cursors.size >= 19) throw Error('Diretório incompleto');
      cursors.add(cursor);
    } while (cursor);
  }

  function setComposeControls(form, busy = Boolean(composeState.sending)) {
    const {title, description, audienceType, audienceValue, send} = form.elements;
    const locked = busy || Boolean(composeState.pending) || composeState.sent;
    title.readOnly = description.readOnly = locked;
    audienceType.disabled = locked;
    audienceValue.disabled = locked || audienceType.value !== 'USER' || !form.dataset.recipientsReady;
    send.disabled = busy || composeState.sent || (audienceType.value === 'USER' && !form.dataset.recipientsReady && !composeState.pending);
    for (const button of root.querySelectorAll('footer button')) button.disabled = busy;
  }

  async function prepareRecipients(form, selected = '') {
    const {audienceType, audienceValue} = form.elements;
    audienceValue.required = audienceType.value === 'USER';
    audienceValue.setAttribute('aria-busy', String(audienceValue.required));
    if (!audienceValue.required) {
      audienceValue.innerHTML = '<option value="">Selecione Individual</option>';
      delete form.dataset.recipientsReady;
      setComposeControls(form);
      return;
    }
    audienceValue.innerHTML = '<option value="">Carregando destinatários…</option>';
    delete form.dataset.recipientsReady;
    setComposeControls(form);
    const request = directory ??= loadDirectory();
    try {
      const users = await request;
      if (!active() || !form.isConnected || audienceType.value !== 'USER') return;
      audienceValue.innerHTML = communicationRecipientOptions(users,{selected});
      if (audienceValue.querySelector('optgroup')) form.dataset.recipientsReady = 'true';
      setComposeControls(form);
    } catch (error) {
      if (directory === request) directory = undefined;
      if (!active() || !form.isConnected || audienceType.value !== 'USER') return;
      if (needsGoogle(error)) return reconnectCompose(form);
      audienceValue.innerHTML = '<option value="">Lista indisponível</option>';
      report(error, 'Escolha outro público e volte a Individual para recarregar.');
    } finally {
      audienceValue.setAttribute('aria-busy', 'false');
    }
  }

  function eventForm() {
    activityState = undefined;
    composeState ??= {id: `event-${crypto.randomUUID()}`, title: '', description: '', audience: 'ALL', recipient: '', sent: false};
    const state = composeState;
    render('Criar e enviar evento', `<form data-comm-form>
      <label>Título<input name="title" maxlength="120" required value="${esc(state.title)}"></label>
      <label>Descrição do aviso<textarea name="description" maxlength="4000" required placeholder="Escreva o aviso e cole links de páginas ou vídeos.">${esc(state.description)}</textarea></label>
      <div class="comm-event-audience">
        <label>Público<select name="audienceType">${audienceOptions.map(({id, name}) => `<option value="${id}"${id === state.audience ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
        <label>Destinatário<select name="audienceValue" disabled><option value="">Selecione Individual</option></select></label>
      </div>
      <button name="send" class="comm-send-button" type="submit" aria-describedby="comm-send-instruction">ENVIAR</button>
      <p id="comm-send-instruction" class="comm-send-instruction">TOQUE EM ENVIAR APENAS UMA UNICA VEZ</p>
    </form>`, {compose: true});
    const form = root.querySelector('[data-comm-form]');
    if (state.pending) form.elements.send.textContent = 'CONFIRMAR ENVIO';
    void prepareRecipients(form, state.recipient);
  }

  function composeValues(form) {
    return {
      id: composeState.id,
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      audience: form.elements.audienceType.value,
      recipient: form.elements.audienceValue.value,
    };
  }

  function reconnectCompose(form) {
    Object.assign(composeState, composeValues(form));
    recoverGoogle();
  }

  async function sendEvent(form) {
    const state = composeState;
    if (state.sending || state.sent || form.elements.send.disabled) return;
    const payload = state.pending || composeValues(form);
    if (!payload.title || !payload.description) return status('Preencha o título e a descrição.', true);
    if (payload.audience === 'USER' && !payload.recipient) return status('Selecione um destinatário.', true);
    Object.assign(state, payload, {sending: true, pending: payload});
    setComposeControls(form, true);
    form.elements.send.textContent = 'ENVIANDO…';
    status('');
    let storageKey;
    let checkingPrevious = state.checkingPrevious;
    const clearPendingId = () => {
      if (storageKey) try { sessionStorage.removeItem(storageKey); } catch {}
    };
    try {
      storageKey = await pendingEventKey(payload);
      if (!active() || !form.isConnected) return;
      if (storageKey) try {
        const previousId = sessionStorage.getItem(storageKey);
        if (previousId && /^event-[0-9a-f-]{36}$/.test(previousId)) {
          payload.id = previousId;
          state.id = previousId;
          checkingPrevious = true;
        }
        sessionStorage.setItem(storageKey, payload.id);
      } catch {}
      await client.request('CREATE_EVENT', payload);
      clearPendingId();
      if (!active() || !form.isConnected) return;
      state.sent = true;
      state.pending = undefined;
      form.elements.send.textContent = 'ENVIADO';
      form.elements.send.dataset.sent = 'true';
      status('Evento publicado no app.');
    } catch (error) {
      if (!active() || !form.isConnected) return;
      const rejected = !needsGoogle(error) && [400, 403, 413, 429].includes(error.status);
      if (rejected && !checkingPrevious) {
        clearPendingId();
        state.pending = undefined;
      } else state.checkingPrevious = true;
      if (needsGoogle(error)) return recoverGoogle();
      form.elements.send.textContent = state.pending ? 'CONFIRMAR ENVIO' : 'ENVIAR';
      report(error, state.pending ? 'Envio sem confirmação. Confirme o mesmo evento.' : undefined);
    } finally {
      state.sending = false;
      if (active() && form.isConnected) setComposeControls(form);
    }
  }

  function loadSentMessages() {
    if (!canManageCommunication) return;
    openCommunicationHistory({root, client, render, status, report, isCurrent: active, audienceOptions, onRecover: recoverGoogle});
  }

  function activityForm() {
    if (!canManageCommunication) return;
    composeState = undefined;
    activityState ??= {};
    openActivityComposer({root, client, render, status, report, isCurrent: active, audienceOptions,
      loadDirectory, state: activityState, onRecover: recoverGoogle});
  }
  function receivedCard(message, open = false) {
    const legacyLink = message.linkUrl && /^https:\/\//.test(message.linkUrl) ?
      `<a class="comm-home-notice__destination" href="${esc(message.linkUrl)}"${message.linkUrl.startsWith('https://anestesiahmtforms.github.io/') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${esc(message.linkLabel || 'ABRIR DESTINO')}</a>` : '';
    const date = new Date(message.publishAt).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
    return `<details class="comm-card" data-message-id="${esc(message.id)}"${open?' open':''}><summary><h3>${esc(message.title)}</h3><span class="comm-received-date">${esc(date)} · ${esc(message.category)}</span></summary><div class="comm-received-body"><p class="comm-message">${linkedNoticeText(message.message)}</p>${legacyLink}<p class="comm-note" data-read-status></p></div></details>`;
  }

  async function recordRead(card) {
    if (adminMode || !active() || !card?.isConnected || !card.open || root.ownerDocument.visibilityState !== 'visible' || card.dataset.readRecorded || card.dataset.readPending) return;
    if (!card.getClientRects().length) return;
    card.dataset.readPending = 'true';
    const readStatus = card.querySelector('[data-read-status]');
    try {
      const result = await client.request('MESSAGE_READ', {id: card.dataset.messageId});
      if (!active() || !card.isConnected) return;
      if (result.recorded === true) {
        card.dataset.readRecorded = 'true';
        readStatus.textContent = `Abertura registrada: ${communicationDate(result.readAt)}`;
      } else if (result.legacy) {
        card.dataset.readRecorded = 'legacy';
        readStatus.textContent = 'Leitura: não registrado no envio original.';
      }
    } catch (error) {
      if (!active() || !card.isConnected) return;
      readStatus.textContent = errors[error.code] || 'Abertura ainda não confirmada. Feche e reabra a mensagem para tentar novamente.';
    } finally { delete card.dataset.readPending; }
  }

  function readToggle(event) {
    if (event.target.matches('[data-message-id]')) void recordRead(event.target);
  }

  function visibilityChanged() {
    if (root.ownerDocument.visibilityState === 'visible') for (const card of root.querySelectorAll('[data-message-id][open]')) void recordRead(card);
  }

  function inbox() {
    render('MENSAGENS RECEBIDAS', '<button type="button" data-retry-received hidden>TENTAR NOVAMENTE</button><div data-received-list></div><p data-received-end role="status"></p>', {inbox: true});
    const ticket = generation;
    const retry = root.querySelector('[data-retry-received]');
    const list = root.querySelector('[data-received-list]');
    const end = root.querySelector('[data-received-end]');
    const seen = new Set();
    let cursor = '', loading = false;
    const loadNext = async () => {
      if (loading || cursor === null || !active() || generation !== ticket) return;
      loading = true;
      inboxObserver?.unobserve(end);
      retry.hidden = true;
      end.textContent = 'Carregando mensagens…';
      try {
        const page = await client.request('INBOX', {recent: true, chronological: true, cursor});
        if (!active() || generation !== ticket) return;
        for (const message of page.items) {
          if (seen.has(message.id)) continue;
          seen.add(message.id);
          list.insertAdjacentHTML('beforeend', receivedCard(message));
        }
        if (page.cursor && page.cursor === cursor) throw Error('COMM_CURSOR_REPEATED');
        cursor = page.cursor || null;
        end.textContent = !seen.size && cursor === null ? 'Nenhuma mensagem recebida.' : '';
        if (cursor !== null) inboxObserver.observe(end);
      } catch (error) {
        if (!active() || generation !== ticket) return;
        if (needsGoogle(error)) return recoverGoogle();
        end.textContent = '';
        retry.hidden = false;
      } finally {
        loading = false;
      }
    };
    inboxObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadNext();
    }, {root: list.parentElement, rootMargin: '0px 0px 120px 0px'});
    retry.addEventListener('click', loadNext);
    void loadNext();
  }

  async function detail(key) {
    render('MENSAGENS RECEBIDAS', '<p>Carregando aviso…</p>', {inbox: true});
    const ticket = generation;
    try {
      const {message} = await client.request('MESSAGE', {id: decodeURIComponent(key)});
      if (!active() || generation !== ticket) return;
      render('MENSAGENS RECEBIDAS', receivedCard(message, true), {inbox: true});
      void recordRead(root.querySelector('[data-message-id]'));
    } catch (error) {
      if (!active() || generation !== ticket) return;
      if (needsGoogle(error)) return recoverGoogle();
      root.querySelector('.comm-content').replaceChildren();
      report(error);
    }
  }

  async function initialView() {
    if (canCreateEvents) return activityState ? activityForm() : composeState ? eventForm() : adminMenu();
    const [, , section, key] = location.hash.split('/');
    return section === 'message' && key ? detail(key) : inbox();
  }

  async function bootstrap() {
    render('Central de Comunicação', '<p>Confirmando acesso à Central de Comunicação…</p>');
    const ticket = generation;
    try {
      const data = await client.request('BOOTSTRAP');
      if (!active() || generation !== ticket) return;
      if (adminMode && data.isAdmin !== true) return status(errors.COMM_FORBIDDEN, true);
      await initialView();
    } catch (error) {
      if (!active() || generation !== ticket) return;
      if (needsGoogle(error)) return recoverGoogle();
      report(error);
    }
  }

  function click(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled || button.type === 'submit') return;
    if (button.hasAttribute('data-back')) return onBack();
    if (button.hasAttribute('data-home')) return canCreateEvents ? adminMenu() : void inbox();
    if (button.hasAttribute('data-sent-messages')) return void loadSentMessages();
    if (button.hasAttribute('data-create-event')) return eventForm();
    if (button.hasAttribute('data-create-activity')) return activityForm();
  }

  function submit(event) {
    if (!event.target.matches('[data-comm-form]')) return;
    event.preventDefault();
    void sendEvent(event.target);
  }

  function change(event) {
    if (event.target.name === 'audienceType') {
      status('');
      void prepareRecipients(event.target.form);
    }
  }

  function cancelWhileSending(event) {
    if (!composeState?.sending && !activityState?.sending) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  inboxDialog?.addEventListener('cancel', event => {event.preventDefault(); onBack();});
  root.addEventListener('click', click);
  root.addEventListener('submit', submit);
  root.addEventListener('change', change);
  root.addEventListener('toggle', readToggle, true);
  root.ownerDocument.addEventListener('visibilitychange', visibilityChanged);
  dialog?.addEventListener('cancel', cancelWhileSending, true);
  if (communicationEntryFromSession(appSession, {adminMode})) void initialView();
  else void bootstrap();
  return () => {
    disposed = true;
    inboxObserver?.disconnect();
    cleanupGoogle();
    client.dispose();
    root.removeEventListener('click', click);
    root.removeEventListener('submit', submit);
    root.removeEventListener('change', change);
    root.removeEventListener('toggle', readToggle, true);
    root.ownerDocument.removeEventListener('visibilitychange', visibilityChanged);
    dialog?.removeEventListener('cancel', cancelWhileSending, true);
    if (inboxDialog) {inboxDialog.close(); inboxDialog.remove();}
    else root.replaceChildren();
  };
}
