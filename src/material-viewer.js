const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/** Returns safe Google Drive/Docs URLs for an embedded, read-only preview. */
export function googleMaterialPreview(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['drive.google.com', 'docs.google.com'].includes(url.hostname)) return null;

  let id = '';
  let previewUrl = '';
  let openUrl = '';
  if (url.hostname === 'drive.google.com') {
    id = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/)?.[1] ||
      (url.pathname === '/open' ? url.searchParams.get('id') : '');
    if (!FILE_ID.test(id || '')) return null;
    previewUrl = `https://drive.google.com/file/d/${id}/preview`;
    openUrl = `https://drive.google.com/file/d/${id}/view`;
  } else {
    const match = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
    if (!match || !FILE_ID.test(match[2])) return null;
    const [, kind, fileId] = match;
    previewUrl = kind === 'presentation'
      ? `https://docs.google.com/presentation/d/${fileId}/export/pdf`
      : `https://docs.google.com/${kind}/d/${fileId}/export?format=pdf`;
    openUrl = `https://docs.google.com/${kind}/d/${fileId}/edit`;
  }
  return {previewUrl, openUrl};
}

export function renderMaterialViewerTrigger(value, {label = 'Material de apoio', title = label, className = 'material-viewer-trigger'} = {}) {
  const target = googleMaterialPreview(value);
  if (!target) return '';
  return `<button class="${escapeHtml(className)}" type="button" data-open-material-viewer data-material-url="${escapeHtml(target.previewUrl)}" data-material-open-url="${escapeHtml(target.openUrl)}" data-material-title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
}

export function installMaterialViewer(root = document) {
  if (!root?.addEventListener || !globalThis.document?.body || document.getElementById('sahmt-material-viewer')) return () => {};
  const dialog = document.createElement('dialog');
  dialog.id = 'sahmt-material-viewer';
  dialog.className = 'material-viewer-dialog';
  dialog.setAttribute('aria-labelledby', 'sahmt-material-viewer-title');
  dialog.innerHTML = '<header class="material-viewer-dialog__header"><h2 id="sahmt-material-viewer-title">Material de apoio</h2><button type="button" class="secondary-button" data-material-viewer-close>VOLTAR</button></header><p class="material-viewer-dialog__status" role="status">Se o material não carregar aqui, use “Abrir no Drive”.</p><div class="material-viewer-dialog__body"><iframe title="Material de apoio" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" allow="fullscreen"></iframe></div><footer class="material-viewer-dialog__footer"><a class="secondary-button" data-material-viewer-open-target target="_blank" rel="noopener noreferrer">Abrir no Google Drive</a></footer>';
  document.body.append(dialog);
  const frame = dialog.querySelector('iframe');
  const title = dialog.querySelector('#sahmt-material-viewer-title');
  const openTarget = dialog.querySelector('[data-material-viewer-open-target]');
  const close = () => { if (dialog.open) dialog.close(); };
  const onClick = event => {
    const closeButton = event.target?.closest?.('[data-material-viewer-close]');
    if (closeButton && dialog.contains(closeButton)) { close(); return; }
    const trigger = event.target?.closest?.('[data-open-material-viewer]');
    if (!trigger || (root !== document && !root.contains(trigger))) return;
    const target = googleMaterialPreview(trigger.dataset.materialUrl);
    if (!target || !dialog.showModal) return;
    title.textContent = trigger.dataset.materialTitle || 'Material de apoio';
    frame.title = title.textContent;
    frame.src = target.previewUrl;
    openTarget.href = googleMaterialPreview(trigger.dataset.materialOpenUrl)?.openUrl || target.openUrl;
    if (!dialog.open) {
      try { dialog.showModal(); } catch { frame.src = 'about:blank'; }
    }
  };
  const onClose = () => { frame.src = 'about:blank'; };
  root.addEventListener('click', onClick);
  dialog.addEventListener('close', onClose);
  return () => { root.removeEventListener('click', onClick); dialog.removeEventListener('close', onClose); dialog.remove(); };
}
