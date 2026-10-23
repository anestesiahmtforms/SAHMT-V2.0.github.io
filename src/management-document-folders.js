import {catalogFolderName} from './catalog-folders.js';
import {googleMaterialPreview} from './material-viewer.js';
import {trainingActivityId} from './training-participation-state.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const ICON_PATHS = Object.freeze({
  general: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18Z"/>',
  restricted: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  protocols: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1v15M5 8h3M16 8h3M5 12h3M16 12h3"/>',
  rops: '<path d="M12 2 3 6v6c0 5 5 8 9 10 4-2 9-5 9-10V6l-9-4Z"/><path d="m8 12 3 3 5-6"/>',
  administrative: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c6 3 12 3 18 0M10 12h4"/>',
  organization: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/>',
  document: '<path d="M14 2H5v20h14V7l-5-5ZM14 2v5h5M8 12h8M8 16h6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  edit: '<path d="m4 16-1 5 5-1L21 7l-4-4L4 16ZM14 6l4 4M4 16l4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  save: '<path d="M4 3h13l4 4v14H3V3h1ZM7 3v6h9V3M7 21v-8h10v8"/>',
  add: '<path d="M12 4v16M4 12h16"/>'
});

export function managementDocumentIcon(kind = 'folder', className = 'document-action-icon') {
  const key = Object.hasOwn(ICON_PATHS, kind) ? kind : 'folder';
  return '<svg class="' + escapeHtml(className) + '" data-document-icon="' + key + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICON_PATHS[key] + '</svg>';
}

function folderIconKind(name) {
  return {'Acesso geral':'general', 'Acesso restrito':'restricted', 'Protocolos':'protocols', 'ROPs':'rops', 'Documentos administrativos':'administrative', 'Organograma':'organization'}[name] || 'folder';
}

// Presentation groups only records already returned by the authorized query.
// Existing Firestore/Drive audience restrictions remain authoritative.
export function managementDocumentFolder(item) {
  const category = normalize(catalogFolderName(item, 'Outros documentos'));
  const organogram = /ORGANOGRAMA/.test(category + ' ' + normalize(item.title));
  const administrative = /DOCUMENTOS? ADMINISTRATIV/.test(category);
  const restricted = item.audienceGroup === 'RESTRICTED' || organogram || administrative;
  const folder = organogram || administrative ? 'Documentos administrativos'
    : /PROTOCOLO/.test(category) ? 'Protocolos' : /\bROPS?\b/.test(category) ? 'ROPs'
    : /DIRETRIZ/.test(category) ? 'Diretrizes' : catalogFolderName(item, 'Outros documentos');
  return {access: restricted ? 'RESTRICTED' : 'GENERAL', folder};
}

export function renderManagementDocumentCard(item, {canEdit = false, readingGate = false, registeredReadingOnly = false} = {}) {
  const title = escapeHtml(item.title || 'Documento');
  const trainingId=trainingActivityId(item);
  const trainingAttributes=trainingId ? ' data-training-activity="'+escapeHtml(trainingId)+'" data-training-title="'+title+'" data-training-state="blue"' : '';
  const kind = /ORGANOGRAMA/.test(normalize(item.title) + ' ' + normalize(item.category))
    ? 'organization' : folderIconKind(managementDocumentFolder(item).folder);
  const content = managementDocumentIcon(kind === 'folder' ? 'document' : kind) + '<span>' + title + '</span>';
  const edit = canEdit ? '<button class="secondary-button management-document-edit" type="button" data-document-edit="' + escapeHtml((item.documentCollection || 'documents') + '/' + item.id) + '" aria-label="Editar ' + title + '">' + managementDocumentIcon('edit') + '<span>Editar</span></button>' : '';
  const registeredReading = item.readingGateRequired === true;
  if (registeredReading && !readingGate) {
    return '<li class="management-document-card"><button type="button" class="management-document-link management-document-premium" disabled aria-label="' + title + ' · Leitura em preparação">' + content + '</button>' + edit + '</li>';
  }
  if (readingGate && (!registeredReadingOnly || registeredReading) && ['Diretrizes', 'Protocolos', 'ROPs', 'Documentos administrativos'].includes(managementDocumentFolder(item).folder)) {
    return '<li class="management-document-card"><button type="button" class="management-document-link management-document-premium training-state-button"'+trainingAttributes+' data-open-diretriz-reader="' + escapeHtml(String(item.id).startsWith('pdf_evaluation_') ? String(item.id).slice(4) : item.id) + '" data-reading-title="' + title + '">' + content + '</button>' + edit + '</li>';
  }
  let href = '';
  try { const url = new URL(item.driveUrl); if (url.protocol === 'https:' && !url.username && !url.password) href = url.href; } catch {}
  const directTraining = managementDocumentFolder(item).folder === 'Diretrizes' && /^https:\/\/docs\.google\.com\/forms\//.test(href);
  const pdfTarget = !directTraining && item.materialPdfUrl && item.materialPdfSourceFileId === item.driveFileId
    ? googleMaterialPreview(item.materialPdfUrl) : null;
  const viewerTarget = pdfTarget || (href ? googleMaterialPreview(href) : null);
  const viewer = viewerTarget ? '<button class="management-document-link management-document-premium training-state-button"'+trainingAttributes+' type="button" data-open-material-viewer data-material-url="' + escapeHtml(viewerTarget.previewUrl) + '" data-material-open-url="' + escapeHtml(viewerTarget.openUrl) + '" data-material-title="' + title + '">' + content + '</button>' : '';
  const link = viewer || (href ? '<a class="management-document-link management-document-premium training-state-button"'+trainingAttributes+' href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + content + '</a>'
    : '<button class="management-document-premium" type="button" disabled>' + content + '</button>');
  const training = pdfTarget && href && /^https:\/\/docs\.google\.com\/forms\//.test(href)
    ? '<a class="secondary-button management-document-training training-state-button"'+trainingAttributes+' href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">ABRIR TREINAMENTO</a>' : '';
  return '<li class="management-document-card">' + link + training + edit + '</li>';
}

function folderMarkup(name, body, count, extraClass = '') {
  return '<details class="catalog-folder ' + extraClass + '"><summary>' + managementDocumentIcon(folderIconKind(name), 'catalog-folder-icon') + '<span class="catalog-folder-name">' + escapeHtml(name) + '</span><span class="catalog-folder-count">' + count + ' ' + (count === 1 ? 'item' : 'itens') + '</span><span class="catalog-folder-chevron" aria-hidden="true">⌄</span></summary><div class="catalog-folder-content">' + body + '</div></details>';
}

export function renderManagementDocumentFolders(documents, options = {}) {
  const groups = new Map([
    ['GENERAL', new Map([['Protocolos', []], ['ROPs', []]])],
    ['RESTRICTED', new Map([['Documentos administrativos', []]])]
  ]);
  for (const item of documents) {
    const {access, folder} = managementDocumentFolder(item);
    const children = groups.get(access);
    if (!children.has(folder)) children.set(folder, []);
    children.get(folder).push(item);
  }
  const panels = [...groups].map(([access, children]) => {
    const name = access === 'GENERAL' ? 'Acesso geral' : 'Acesso restrito';
    const titleId = 'management-document-panel-' + access.toLowerCase();
    const body = '<div class="catalog-folders">' + [...children].map(([name, rows]) => folderMarkup(name,
      rows.length ? '<ul class="record-list management-document-list">' + rows.map(item => renderManagementDocumentCard(item, options)).join('') + '</ul>' : '<p class="empty-state">Nenhum documento disponível nesta pasta.</p>', rows.length)).join('') + '</div>';
    const button = '<button class="management-document-premium management-document-access-button" type="button" data-document-access-open="' + access + '" aria-haspopup="dialog" aria-controls="' + titleId + '">' + managementDocumentIcon(access === 'GENERAL' ? 'general' : 'restricted') + '<span>' + name + '</span></button>';
    const dialog = '<dialog class="management-document-dialog" id="' + titleId + '" data-document-access-panel="' + access + '" aria-labelledby="' + titleId + '-title"><header class="management-area-dialog__header"><h2 id="' + titleId + '-title">' + managementDocumentIcon(access === 'GENERAL' ? 'general' : 'restricted') + '<span>' + name + '</span></h2></header><div class="management-area-dialog__body">' + body + '</div><footer class="management-area-dialog__footer"><form method="dialog"><button class="secondary-button" type="submit" autofocus>' + managementDocumentIcon('close') + '<span>Fechar</span></button></form></footer></dialog>';
    return {button, dialog};
  });
  return '<div class="management-document-access-folders">' + panels.map(panel => panel.button).join('') + '</div>' + panels.map(panel => panel.dialog).join('');
}

export function bindManagementDocumentAccessPanels(root) {
  if (!root?.querySelectorAll) return;
  const triggers = [...root.querySelectorAll('[data-document-access-open]')];
  const panels = [...root.querySelectorAll('[data-document-access-panel]')];
  const panelByAccess = new Map(panels
    .filter(panel => ['GENERAL', 'RESTRICTED'].includes(panel.dataset.documentAccessPanel))
    .map(panel => [panel.dataset.documentAccessPanel, panel]));

  for (const trigger of triggers) {
    const access = trigger.dataset.documentAccessOpen;
    const panel = panelByAccess.get(access);
    if (!panel) continue;
    trigger.addEventListener('click', () => {
      if (!panel.open) panel.showModal();
    });
  }

  for (const panel of panelByAccess.values()) {
    panel.addEventListener('close', () => {
      const closeAction = panel.dataset.closeAction;
      delete panel.dataset.closeAction;
      if (closeAction === 'edit') return;

      const access = panel.dataset.documentAccessPanel;
      const trigger = triggers.find(item => item.dataset.documentAccessOpen === access);
      if (!trigger?.isConnected) return;
      trigger.focus?.({preventScroll: true});
      trigger.scrollIntoView?.({block: 'nearest'});
    });
  }
}
