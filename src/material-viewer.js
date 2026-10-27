const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

// Display-only conversion: scoring continues to use the original material URLs.
export function materialPresentationUrls(activity) {
  const original = Array.isArray(activity?.materialUrls) ? activity.materialUrls : [];
  const display = activity?.materialDisplayUrls;
  const boundSource = activity?.materialDisplaySourceUrls;
  return Array.isArray(display) && display.length === original.length && display.length > 0 &&
    Array.isArray(boundSource) && boundSource.length === original.length && boundSource.every((url, index) => url === original[index]) &&
    display.every(value => Boolean(googleMaterialPreview(value))) ? display : original;
}

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
  dialog.setAttribute('aria-label', 'Material de apoio para leitura');
  dialog.innerHTML = '<iframe title="Material de apoio para leitura" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" scrolling="auto"></iframe><footer class="material-viewer-dialog__footer"><button type="button" class="secondary-button" data-material-viewer-close>FECHAR</button></footer>';
  document.body.append(dialog);
  const frame = dialog.querySelector('iframe'), back = dialog.querySelector('[data-material-viewer-close]');
  let returnTrigger = null;
  const close = () => { if (dialog.open) dialog.close(); };
  const onClick = event => {
    if (event.target?.closest?.('[data-material-viewer-close]')) { close(); return; }
    if (event.target === dialog) { close(); return; }
    const trigger = event.target?.closest?.('[data-open-material-viewer]');
    if (!trigger || (root !== document && !root.contains(trigger))) return;
    const target = googleMaterialPreview(trigger.dataset.materialUrl);
    if (!target || !dialog.showModal) return;
    returnTrigger = trigger.dataset.materialReturn === 'management' ? trigger : null;
    back.textContent = returnTrigger ? 'VOLTAR' : 'FECHAR';
    frame.title = trigger.dataset.materialTitle || 'Material de apoio para leitura';
    frame.src = target.previewUrl + (target.previewUrl.includes('#') ? '' : '#toolbar=0&navpanes=0');
    if (!dialog.open) {
      try { dialog.showModal(); } catch { frame.src = 'about:blank'; }
    }
  };
  const onClose = () => {
    frame.src = 'about:blank';
    const previous = returnTrigger; returnTrigger = null;
    if(previous?.isConnected)previous.focus?.({preventScroll: true});
  };
  root.addEventListener('click', onClick);
  dialog.addEventListener('close', onClose);
  return () => { root.removeEventListener('click', onClick); dialog.removeEventListener('close', onClose); dialog.remove(); };
}
