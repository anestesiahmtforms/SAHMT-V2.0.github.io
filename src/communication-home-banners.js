const MAX_INBOX_PAGES = 18;
const MAX_DISMISSED_IDS = 500;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

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
  const active = () => !disposed && root.isConnected && isCurrent();
  const dismissed = readDismissed(uid);

  function render(items, hasMore = false) {
    if (!active()) return;
    const merged = new Map(items.map(item => [item.id, item]));
    for (const item of pushedItems) if (!merged.has(item.id)) merged.set(item.id, item);
    visibleItems = [...merged.values()].filter(item => !dismissed.has(item.id)).sort((a, b) => Number(b.publishAt || 0) - Number(a.publishAt || 0));
    root.innerHTML = visibleItems.map(item => `<article class="comm-home-notice${item.priority === 'URGENT' ? ' comm-home-notice--urgent' : ''}" role="status" aria-label="Novo aviso institucional">
      <header><strong>🔔 NOVO AVISO · ${escapeHtml(item.category)}</strong><button type="button" class="comm-home-notice__close" data-dismiss-comm="${escapeHtml(item.id)}" aria-label="Fechar aviso">×</button></header>
      <h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.message)}</p>
      <a href="#/communications/message/${encodeURIComponent(item.id)}">ABRIR COMUNICAÇÃO</a>
    </article>`).join('') + (hasMore ? '<a class="comm-home-notice__more" href="#/communications">Ver mais mensagens recebidas</a>' : '');
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
    let cursor = '';
    let pages = 0;
    let hasMore = false;
    const items = [];
    const seen = new Set();
    try {
      do {
        const result = await client.request('INBOX', cursor ? {cursor} : {});
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
      } while (cursor && pages < MAX_INBOX_PAGES);
    } catch {
      // Home remains usable when the FF inbox is temporarily unavailable.
    }
    if (active()) render(items, hasMore);
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

  root.addEventListener('click', onClick);
  navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
  void load();
  return () => {
    disposed = true;
    root.removeEventListener('click', onClick);
    navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    root.replaceChildren();
    client.dispose();
  };
}
