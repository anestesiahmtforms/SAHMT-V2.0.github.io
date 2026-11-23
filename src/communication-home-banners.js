import {escapeNoticeHtml as escapeHtml, linkedNoticeText} from './communication-notice-text.js';
import {inboxUnread,setInboxUnread} from './communication-inbox-state.js';

const MAX_INBOX_PAGES = 18;
const MAX_DISMISSED_IDS = 500;
function localDateKey(date = new Date(), timeZone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
const checklistNoticeId = () => `event-checklist-conference-${localDateKey()}`;
const isChecklistConference = item => item?.id === checklistNoticeId();
const isReleasePush = id => /^release-\d{4}-\d{2}-\d{2}-(?:[A-Z]{2}|L2)-\d+$/.test(id);

function dismissedStorageKey(uid) {
  return `sahmt-communication-dismissed-v1:${encodeURIComponent(uid)}`;
}

function readDismissed(uid) {
  try {
    const value = JSON.parse(localStorage.getItem(dismissedStorageKey(uid)) || '[]');
    return new Set(Array.isArray(value) ? value.filter(id => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(uid, dismissed) {
  try {
    localStorage.setItem(dismissedStorageKey(uid), JSON.stringify([...dismissed].slice(-MAX_DISMISSED_IDS)));
  } catch {}
}

export function mountCommunicationHomeBanners(root, {client, user, inboxShortcut, isCurrent = () => true} = {}) {
  let disposed = false;
  let visibleItems = [];
  let pushedItems = [];
  let loading = false;
  let lastLoadAt = 0;
  let renderedMarkup = '';
  const acknowledging = new Set();
  const acknowledgementErrors = new Map();
  const active = () => !disposed && root.isConnected && isCurrent();
  const dismissed = readDismissed(user.uid);


  let nextUnreadCheck=0,checkingUnread=false,checkAgain=false,unreadCursor='';
  function unread(value){
    if(!inboxShortcut||!active())return;
    setInboxUnread(user.uid,value);
    inboxShortcut.dataset.unread=String(value);
    if(value)inboxShortcut.setAttribute('aria-label','Mensagens recebidas — há mensagens não lidas');
    else inboxShortcut.removeAttribute('aria-label');
  }

  async function checkUnread(force){
    if(!inboxShortcut||!active()||document.visibilityState==='hidden')return;
    if(checkingUnread){if(force)checkAgain=true;return;}
    if(!force&&Date.now()<nextUnreadCheck)return;
    checkingUnread=true;
    nextUnreadCheck=Date.now()+30000;
    if(force)unreadCursor='';
    let cursor=unreadCursor;
    try{
      // Leave headroom in FF for the Home checklist and regular user actions.
      for(let page=0;page<10;page++){
        const result=await client.request('INBOX',{individual:true,unreadOnly:true,cursor});
        if(!active()||typeof result.hasUnread!=='boolean')return;
        if(result.hasUnread||!result.cursor){unreadCursor='';unread(result.hasUnread);return;}
        if(result.cursor===cursor)return;
        cursor=result.cursor;
        unreadCursor=cursor;
      }
    }catch{
      // A transient connection failure must not mark messages as seen.
    }finally{
      checkingUnread=false;
      if(checkAgain){checkAgain=false;void checkUnread(true);}
    }
  }
  function render(items) {
    if (!active()) return;
    // Only the daily checklist is restored at startup. A release appears here
    // only when its push arrives while Home is open.
    const merged = new Map(items.filter(isChecklistConference).map(item => [item.id, item]));
    for (const item of pushedItems) if (!merged.has(item.id)) merged.set(item.id, item);
    visibleItems = [...merged.values()].filter(item => !dismissed.has(item.id)).sort((a, b) => Number(b.publishAt || 0) - Number(a.publishAt || 0));
    const markup = visibleItems.map(item => {
      const checklistConference = item.id.startsWith('event-checklist-conference-');
      return `<article class="comm-home-notice${item.priority === 'URGENT' ? ' comm-home-notice--urgent' : ''}${checklistConference ? ' comm-home-notice--checklist-conference' : ''}" role="status" aria-label="${checklistConference ? 'Conferência do Checklist' : 'Novo aviso institucional'}">
        <header><strong>${checklistConference ? '📋 CONFERÊNCIA DO CHECKLIST' : `🔔 NOVO AVISO · ${escapeHtml(item.category)}`}</strong>${checklistConference ? '' : `<button type="button" class="comm-home-notice__close" data-dismiss-comm="${escapeHtml(item.id)}" aria-label="Fechar aviso">×</button>`}</header>
        <h2>${escapeHtml(item.title)}</h2><p>${linkedNoticeText(item.message)}</p>
        ${item.linkUrl&&/^https:\/\//.test(item.linkUrl)?`<a class="comm-home-notice__destination" href="${escapeHtml(item.linkUrl)}"${item.linkUrl.startsWith('https://anestesiahmtforms.github.io/')?'':' target="_blank" rel="noopener noreferrer"'}>${escapeHtml(item.linkLabel||'ABRIR DESTINO')}</a>`:''}
        ${checklistConference ? `<p class="comm-home-notice__ack-status" role="status">${escapeHtml(acknowledgementErrors.get(item.id) || '')}</p><button type="button" class="comm-home-notice__ack" data-ack-comm="${escapeHtml(item.id)}" ${acknowledging.has(item.id) ? 'disabled' : ''}>${acknowledging.has(item.id) ? 'REGISTRANDO…' : 'OK'}</button>` : `<a class="comm-home-notice__details" href="#/communications/message/${encodeURIComponent(item.id)}">ABRIR COMUNICAÇÃO</a>`}
      </article>`;
    }).join('');
    if (markup !== renderedMarkup) {
      root.innerHTML = markup;
      renderedMarkup = markup;
    }
  }

  async function appendPushedMessage(id) {
    if ((id !== checklistNoticeId() && !isReleasePush(id)) || dismissed.has(id) || !active() || visibleItems.some(item => item.id === id)) return;
    try {
      const result = await client.request('MESSAGE', {id});
      if (!active() || result.message?.id !== id || result.message.status !== 'published') return;
      pushedItems = [result.message, ...pushedItems.filter(item => item.id !== id)].slice(0, 5);
      render(visibleItems);
    } catch {
      // The server also returns the eligible message on the next Home visit.
    }
  }

  async function load() {
    if (loading || !active() || document.visibilityState === 'hidden') return;
    loading = true;
    lastLoadAt = Date.now();
    let cursor = '';
    let pages = 0;
    let loadFailed = false;
    const items = [];
    const seen = new Set();
    const todayStart = Date.parse(`${localDateKey()}T00:00:00-03:00`);
    try {
      do {
        const result = await client.request('INBOX', {recent: true, chronological: true, cursor});
        if (!active()) return;
        for (const item of result.items || []) {
          if (typeof item?.id === 'string' && !seen.has(item.id)) {
            seen.add(item.id);
            items.push(item);
          }
        }
        cursor = typeof result.cursor === 'string' ? result.cursor : '';
        pages++;
        const crossedDayBoundary = (result.items || []).some(item => Number(item.publishAt) < todayStart);
        render(items);
        if (crossedDayBoundary) cursor = '';
      } while (cursor && pages < MAX_INBOX_PAGES);
    } catch {
      // Home refresh failures are silent: preserve already loaded notices without
      // repeatedly presenting a connection warning every time the app resumes.
      loadFailed = true;
    } finally {
      loading = false;
    }
    if (active()) render(loadFailed && !items.length ? visibleItems : items);
  }

  const onClick = event => {
    const acknowledge = event.target.closest('[data-ack-comm]');
    if (acknowledge && root.contains(acknowledge)) {
      const id = acknowledge.dataset.ackComm;
      if (!id || acknowledging.has(id)) return;
      acknowledging.add(id);
      acknowledgementErrors.delete(id);
      render(visibleItems);
      void client.request('MESSAGE_READ', {id}).then(result => {
        if (!active()) return;
        if (result.recorded !== true) throw new Error('O servidor ainda não confirmou o registro de leitura. Tente novamente.');
        dismissed.add(id);
        saveDismissed(user.uid, dismissed);
        acknowledgementErrors.delete(id);
        void checkUnread(true);
      }).catch(error => {
        if (active()) acknowledgementErrors.set(id, ['COMM_SESSION_INVALID','COMM_IDENTITY_MISMATCH'].includes(error.code)
          ? 'Conecte sua conta à Central para registrar a leitura.'
          : error.message || 'Não foi possível registrar a leitura. Tente novamente.');
      }).finally(() => {
        acknowledging.delete(id);
        if (active()) render(visibleItems);
      });
      return;
    }
    const button = event.target.closest('[data-dismiss-comm]');
    if (!button || !root.contains(button)) return;
    const id = button.dataset.dismissComm;
    if (typeof id !== 'string') return;
    dismissed.add(id);
    saveDismissed(user.uid, dismissed);
    render(visibleItems);
  };

  const onServiceWorkerMessage = event => {
    const data = event.data;
    if (data?.source === 'SAHMT_FF' && data.type === 'NEW_COMMUNICATION') {
      void appendPushedMessage(data.communicationId);
      void checkUnread(true);
    }
  };

  const onResume = () => {
    if (document.visibilityState === 'hidden' || !active()) return;
    void checkUnread(false);
    if (Date.now() - lastLoadAt > 2000) void load();
    void client.refreshPushRegistration?.().catch(() => {});
  };

  root.addEventListener('click', onClick);
  navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('focus', onResume);
  const poll = inboxShortcut ? setInterval(()=>void checkUnread(false),90000) : null;
  const cached=inboxShortcut?inboxUnread(user.uid):undefined;
  if(cached!==undefined)unread(cached);
  onResume();
  return () => {
    disposed = true;
    if(poll!==null)clearInterval(poll);
    root.removeEventListener('click', onClick);
    navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    document.removeEventListener('visibilitychange', onResume);
    window.removeEventListener('focus', onResume);
    root.replaceChildren();
    client.dispose();
  };
}
