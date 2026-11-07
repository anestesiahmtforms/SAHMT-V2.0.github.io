import {BUILTIN_GROUPS, ROUTES} from '../communication/domain.js';
import {communicationEntryFromSession} from './communication-entry.js';
import {escapeNoticeHtml as esc, linkedNoticeText} from './communication-notice-text.js';
import {communicationLimitMessage} from './communication-usage.js';
import './communication.css';

const errors = {
  COMM_SESSION_INVALID: 'Confirme sua conta Google e reabra a Central.',
  COMM_FORBIDDEN: 'Sua conta não tem autorização para esta ação.',
  COMM_INVALID_AUDIENCE: 'O destinatário não está disponível. Selecione novamente.',
  COMM_INVALID_INPUT: 'Confira o título, a descrição e o público.',
  COMM_PUSH_UNSUPPORTED: 'Push indisponível neste aparelho. No iPhone, abra o app instalado na tela inicial.',
  COMM_PUSH_PERMISSION: 'Autorize as notificações nas configurações do aparelho ou navegador.',
  COMM_DEVICE_LIMIT: 'Limite de cinco dispositivos ativos por usuário.',
};
const needsGoogle = error => ['COMM_SESSION_INVALID', 'COMM_IDENTITY_MISMATCH'].includes(error.code);
const audienceOptions = [{id: 'ALL', name: 'TODOS'}, ...BUILTIN_GROUPS, {id: 'USER', name: 'INDIVIDUAL'}];

export function mountCommunication(root, {client, adminMode = false, appSession = null, isCurrent = () => true, onBack = () => {}} = {}) {
  let disposed = false;
  let generation = 0;
  let cleanupGoogle = () => {};
  let composeState;
  let directory;
  const active = () => !disposed && isCurrent();
  const dialog = root.closest('.management-hub-dialog');

  async function pendingEventKey(payload) {
    const uid = appSession?.user?.uid;
    if (!uid) return '';
    const fingerprint = JSON.stringify([payload.title, payload.description, payload.audience, payload.recipient]);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    return `sahmt-ff-pending-event:${uid}:${hash}`;
  }

  function render(title, content, {compose = false, menu = false} = {}) {
    generation++;
    root.classList.add('communication');
    root.classList.toggle('communication--compose', compose);
    root.classList.toggle('communication--menu', menu);
    const hubHeading = dialog?.querySelector('#management-hub-title');
    if (hubHeading) hubHeading.textContent = compose ? 'CRIAR E ENVIAR EVENTO' : 'CENTRAL DE COMUNICAÇÃO';
    const heading = (menu || compose) && hubHeading ? '' : `<header class="comm-heading"><h2 tabindex="-1">${esc(title)}</h2></header>`;
    const navigation = compose ? '<button type="button" data-home>CENTRAL DE COMUNICAÇÃO</button><button type="button" data-back>VOLTAR</button>' :
      !adminMode ? '<button type="button" data-home>MENSAGENS RECEBIDAS</button><button type="button" data-back>VOLTAR</button>' : '';
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
    render('Conectar à Central de Comunicação', '<p>Confirme a mesma conta Google já aberta no SAHMT.</p><div data-comm-google></div>');
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
    render('Central de Comunicação', '<div class="comm-menu"><button type="button" data-create-event>CRIAR E ENVIAR EVENTO</button></div>', {menu: true});
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
      const label = user => user.displayName?.trim() || user.email;
      const groups = BUILTIN_GROUPS.map(group => {
        const members = users.filter(user => `institutional-${user.institutionalGroup}` === group.id)
          .sort((a, b) => label(a).localeCompare(label(b), 'pt-BR', {sensitivity: 'base'}));
        if (!members.length) return '';
        return `<optgroup label="${group.name}">${members.map(user => `<option value="${esc(user.uid)}">${esc(label(user))}</option>`).join('')}</optgroup>`;
      }).join('');
      audienceValue.innerHTML = `<option value="">${groups ? 'Selecione um destinatário' : 'Nenhum destinatário disponível'}</option>${groups}`;
      audienceValue.value = [...audienceValue.options].some(option => option.value === selected) ? selected : '';
      if (groups) form.dataset.recipientsReady = 'true';
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
      const result = await client.request('CREATE_EVENT', payload);
      if (!result.pushPending) clearPendingId();
      if (!active() || !form.isConnected) return;
      if (result.pushPending) {
        state.checkingPrevious = true;
        form.elements.send.textContent = 'CONFIRMAR ENVIO';
        return status('Evento publicado. Confirme o Push.');
      }
      state.sent = true;
      state.pending = undefined;
      form.elements.send.textContent = 'ENVIADO';
      form.elements.send.dataset.sent = 'true';
      status(result.pushQueued ? 'Evento enviado. Push na fila.' : 'Evento publicado na Home. Push sem confirmação.');
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

  async function inbox(cursor = '') {
    render('Mensagens recebidas', '<p>Carregando mensagens…</p>');
    const ticket = generation;
    try {
      const data = await client.request('INBOX', {recent: true, cursor});
      if (!active() || generation !== ticket) return;
      const cards = data.items.map(item => `<article class="comm-card"><h3>${esc(item.title)}</h3><p>${esc(item.category)} · ${new Date(item.publishAt).toLocaleString('pt-BR')}</p><p>${esc(item.message.slice(0, 200))}${item.message.length > 200 ? '…' : ''}</p><button type="button" data-message="${esc(item.id)}">LER AVISO</button></article>`).join('');
      render('Mensagens recebidas', `<div class="comm-actions"><button type="button" data-enable>HABILITAR NOTIFICAÇÕES NESTE APARELHO</button><button type="button" data-disable>DESATIVAR NESTE APARELHO</button></div>${cards || '<p>Nenhuma mensagem nesta página.</p>'}${data.cursor ? `<button type="button" data-next="${esc(data.cursor)}">PRÓXIMA PÁGINA</button>` : ''}`);
    } catch (error) {
      if (!active() || generation !== ticket) return;
      if (needsGoogle(error)) return recoverGoogle();
      root.querySelector('.comm-content').replaceChildren();
      report(error);
    }
  }

  async function detail(key) {
    render('Aviso', '<p>Carregando aviso…</p>');
    const ticket = generation;
    try {
      const {message} = await client.request('MESSAGE', {id: decodeURIComponent(key)});
      if (!active() || generation !== ticket) return;
      const legacyLink = message.linkUrl && /^https:\/\//.test(message.linkUrl) ?
        `<a class="comm-home-notice__destination" href="${esc(message.linkUrl)}"${message.linkUrl.startsWith('https://anestesiahmtforms.github.io/') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${esc(message.linkLabel || 'ABRIR DESTINO')}</a>` : '';
      const legacyRoute = !message.id.startsWith('event-') && ROUTES.includes(message.route) ? `<a href="#/${esc(message.route)}">ABRIR PÁGINA NO APP</a>` : '';
      render(message.title, `<article class="comm-card"><p class="comm-message">${linkedNoticeText(message.message)}</p>${legacyLink}${legacyRoute}</article>`);
    } catch (error) {
      if (!active() || generation !== ticket) return;
      if (needsGoogle(error)) return recoverGoogle();
      root.querySelector('.comm-content').replaceChildren();
      report(error);
    }
  }

  async function initialView() {
    if (adminMode) return composeState ? eventForm() : adminMenu();
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

  async function toggleDevice(button, permission) {
    const ticket = generation;
    button.disabled = true;
    try {
      if (permission) await client.enable(permission);
      else await client.disable();
      if (active() && generation === ticket) status(permission ? 'Notificações habilitadas neste aparelho.' : 'Notificações desativadas neste aparelho.');
    } catch (error) {
      if (!active() || generation !== ticket) return;
      if (needsGoogle(error)) return recoverGoogle();
      report(error);
    } finally {
      if (active() && generation === ticket) button.disabled = false;
    }
  }

  function click(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled || button.type === 'submit') return;
    if (button.hasAttribute('data-back')) return onBack();
    if (button.hasAttribute('data-home')) return adminMode ? adminMenu() : void inbox();
    if (button.hasAttribute('data-create-event')) return eventForm();
    if (button.dataset.next) return void inbox(button.dataset.next);
    if (button.dataset.message) return void detail(button.dataset.message);
    if (button.hasAttribute('data-enable')) {
      const permission = 'Notification' in window ? Notification.requestPermission() : Promise.resolve('denied');
      return void toggleDevice(button, permission);
    }
    if (button.hasAttribute('data-disable')) void toggleDevice(button);
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
    if (!composeState?.sending) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  root.addEventListener('click', click);
  root.addEventListener('submit', submit);
  root.addEventListener('change', change);
  dialog?.addEventListener('cancel', cancelWhileSending, true);
  if (communicationEntryFromSession(appSession, {adminMode})) void initialView();
  else void bootstrap();
  return () => {
    disposed = true;
    cleanupGoogle();
    client.dispose();
    root.removeEventListener('click', click);
    root.removeEventListener('submit', submit);
    root.removeEventListener('change', change);
    dialog?.removeEventListener('cancel', cancelWhileSending, true);
    root.replaceChildren();
  };
}
