// Um comunicado só sai da fila depois da confirmação persistida do usuário.
export function createInformationQueue({list, acknowledge, show}) {
  let scope = null;
  let generation = 0;
  let items = [];
  let loading = false;
  let saving = false;
  const confirmed = new Set();
  const paint = (error = '') => show(items[0] || null, {saving, error});
  return {
    setSession(profile) {
      if (scope?.uid === profile?.uid) { scope = profile; return; }
      generation++; scope = profile; items = []; loading = false; saving = false; confirmed.clear(); paint();
    },
    async refresh() {
      if (!scope || loading || saving) return;
      const current = generation; const profile = scope; loading = true;
      try {
        const loaded = await list(profile);
        if (current !== generation) return;
        items = loaded.filter(item => !item.read && !confirmed.has(item.id)); paint();
      } catch { /* Uma consulta sem rede não deve dispensar o comunicado já aberto. */ }
      finally { if (current === generation) loading = false; }
    },
    async confirm() {
      if (!scope || !items[0] || saving) return;
      const current = generation; const uid = scope.uid; const id = items[0].id;
      saving = true; paint();
      try {
        await acknowledge(id, uid);
        if (current !== generation) return;
        confirmed.add(id); items = items.filter(item => item.id !== id); saving = false; paint();
      } catch { if (current === generation) { saving = false; paint('Não foi possível registrar sua ciência. Verifique a conexão e tente novamente.'); } }
    }
  };
}

let queue;
let dialog;
let displayedId = '';
let readToEnd = false;
let timer;
let bannerSaving = false;
function present(item, {saving, error}) {
  bannerSaving = saving;
  if (!item) {
    dialog?.remove(); dialog = null; displayedId = ''; return;
  }
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'information-banner';
    dialog.setAttribute('aria-labelledby', 'information-banner-title');
    dialog.innerHTML = '<header><span>INFORMAÇÕES · SAHMT</span><h2 id="information-banner-title"></h2></header><div class="information-banner__text" tabindex="0"></div><footer><p class="information-banner__status" role="status"></p><button class="primary-button" type="button">Li e estou ciente</button></footer>';
    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.querySelector('button').addEventListener('click', () => { if (readToEnd) void queue.confirm(); });
    dialog.querySelector('.information-banner__text').addEventListener('scroll', () => {
      if (!dialog) return;
      const text = dialog.querySelector('.information-banner__text');
      if (text.scrollTop + text.clientHeight >= text.scrollHeight - 4) {
        readToEnd = true; dialog.querySelector('button').disabled = bannerSaving;
        dialog.querySelector('.information-banner__status').textContent = '';
      }
    });
    document.body.append(dialog);
  }
  const changed = displayedId !== item.id;
  if (changed) {
    displayedId = item.id; readToEnd = false;
    dialog.querySelector('h2').textContent = item.title;
    const text = dialog.querySelector('.information-banner__text');
    text.textContent = item.message; text.scrollTop = 0;
  }
  if (!dialog.open) dialog.showModal();
  const text = dialog.querySelector('.information-banner__text');
  if (text.clientHeight >= text.scrollHeight - 4) readToEnd = true;
  dialog.querySelector('button').disabled = saving || !readToEnd;
  dialog.querySelector('button').textContent = saving ? 'Registrando ciência…' : 'Li e estou ciente';
  dialog.querySelector('.information-banner__status').textContent = error || (!readToEnd ? 'Leia até o fim para confirmar sua ciência.' : '');
  if (changed) text.focus();
}

export function updateInformationBanner(profile) {
  if (!queue) {
    queue = createInformationQueue({
      list: async profile => (await import('./data.js')).listNotifications(profile),
      acknowledge: async (id, uid) => (await import('./data.js')).markNotificationRead(id, uid),
      show: present
    });
    window.addEventListener('online', () => void queue.refresh());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void queue.refresh(); });
  }
  queue.setSession(profile);
  // Recoloca o banner acima de outros modais abertos pela página atual.
  if (profile && dialog?.open) { dialog.close(); dialog.showModal(); }
  if (timer) clearInterval(timer);
  if (!profile) { timer = null; return; }
  void queue.refresh();
  timer = setInterval(() => { if (!document.hidden) void queue.refresh(); }, 30000);
}
