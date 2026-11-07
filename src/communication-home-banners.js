import {escapeNoticeHtml as escapeHtml, linkedNoticeText} from './communication-notice-text.js';

const MAX_INBOX_PAGES = 18;
const MAX_DISMISSED_IDS = 500;

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

export function mountCommunicationHomeBanners(root, {client, uid, isCurrent = () => true} = {}) {
  let disposed = false;
  let visibleItems = [];
  let pushedItems = [];
  let loading = false;
  let lastLoadAt = 0;
  let loadError = '';
  const active = () => !disposed && root.isConnected && isCurrent();
  const dismissed = readDismissed(uid);

  function render(items, hasMore = false) {
    if (!active()) return;
    const merged = new Map(items.map(item => [item.id, item]));
    for (const item of pushedItems) if (!merged.has(item.id)) merged.set(item.id, item);
    visibleItems = [...merged.values()].filter(item => !dismissed.has(item.id)).sort((a, b) => Number(b.publishAt || 0) - Number(a.publishAt || 0));
    root.innerHTML = visibleItems.map(item => `<article class="comm-home-notice${item.priority === 'URGENT' ? ' comm-home-notice--urgent' : ''}" role="status" aria-label="Novo aviso institucional">
      <header><strong>🔔 NOVO AVISO · ${escapeHtml(item.category)}</strong><button type="button" class="comm-home-notice__close" data-dismiss-comm="${escapeHtml(item.id)}" aria-label="Fechar aviso">×</button></header>
      <h2>${escapeHtml(item.title)}</h2><p>${linkedNoticeText(item.message)}</p>
      ${item.linkUrl&&/^https:\/\//.test(item.linkUrl)?`<a class="comm-home-notice__destination" href="${escapeHtml(item.linkUrl)}"${item.linkUrl.startsWith('https://anestesiahmtforms.github.io/')?'':' target="_blank" rel="noopener noreferrer"'}>${escapeHtml(item.linkLabel||'ABRIR DESTINO')}</a>`:''}
      <a class="comm-home-notice__details" href="#/communications/message/${encodeURIComponent(item.id)}">ABRIR COMUNICAÇÃO</a>
    </article>`).join('') + (hasMore ? '<a class="comm-home-notice__more" href="#/communications">Ver mais mensagens recebidas</a>' : '') + (loadError ? `<article class="comm-home-notice" role="status"><p>${escapeHtml(loadError)} <a href="#/communications">ABRIR CENTRAL DE COMUNICAÇÃO</a></p></article>` : '');
  }

  async function appendPushedMessage(id) {
    if (!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(id) || dismissed.has(id) || !active() || visibleItems.some(item => item.id === id)) return;
    try {
      const result = await client.request('MESSAGE', {id});
      if (!active() || !result.message || result.message.status !== 'published') return;
      pushedItems = [result.message, ...pushedItems.filter(item => item.id !== id)];
      render(visibleItems);
    } catch {
      // The server also returns the eligible message on the next Home visit.
    }
  }

  async function load() {
    if (loading || !active() || document.visibilityState === 'hidden') return;
    loading = true;
    lastLoadAt = Date.now();
    loadError = '';
    let cursor = '';
    let pages = 0;
    let hasMore = false;
    const items = [];
    const seen = new Set();
    try {
      do {
        const result = await client.request('INBOX', cursor ? {recent: true, cursor} : {recent: true});
        if (!active()) return;
        for (const item of result.items || []) {
          if (typeof item?.id === 'string' && !seen.has(item.id)) {
            seen.add(item.id);
            items.push(item);
          }
        }
        cursor = typeof result.cursor === 'string' ? result.cursor : '';
        pages++;
        hasMore = Boolean(cursor && pages >= MAX_INBOX_PAGES);
        render(items, hasMore);
      } while (cursor && pages < MAX_INBOX_PAGES);
    } catch (error) {
      loadError = ['COMM_SESSION_INVALID','COMM_IDENTITY_MISMATCH'].includes(error.code) ? 'Conecte sua conta à Central para receber seus avisos.' : 'Não foi possível atualizar seus avisos. Abra a Central para conferir.';
    } finally {
      loading = false;
    }
    if (active()) render(loadError && !items.length ? visibleItems : items, hasMore);
  }

  const onClick = event => {
    const button = event.target.closest('[data-dismiss-comm]');
    if (!button || !root.contains(button)) return;
    const id = button.dataset.dismissComm;
    if (typeof id !== 'string') return;
    dismissed.add(id);
    saveDismissed(uid, dismissed);
    render(visibleItems);
  };

  const onServiceWorkerMessage = event => {
    const data = event.data;
    if (data?.source === 'SAHMT_FF' && data.type === 'NEW_COMMUNICATION') void appendPushedMessage(data.communicationId);
  };

  const onResume = () => {
    if (document.visibilityState !== 'hidden' && Date.now() - lastLoadAt > 2000) void load();
  };

  root.addEventListener('click', onClick);
  navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('focus', onResume);
  void load();
  return () => {
    disposed = true;
    root.removeEventListener('click', onClick);
    navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    document.removeEventListener('visibilitychange', onResume);
    window.removeEventListener('focus', onResume);
    root.replaceChildren();
    client.dispose();
  };
}
