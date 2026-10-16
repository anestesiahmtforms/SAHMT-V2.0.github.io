import {catalogFolderName} from './catalog-folders.js';

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
  const folder = organogram ? 'Organograma' : administrative ? 'Documentos administrativos'
    : /PROTOCOLO/.test(category) ? 'Protocolos' : /\bROPS?\b/.test(category) ? 'ROPs'
    : catalogFolderName(item, 'Outros documentos');
  return {access: restricted ? 'RESTRICTED' : 'GENERAL', folder};
}

export function renderManagementDocumentCard(item, {canEdit = false} = {}) {
  const title = escapeHtml(item.title || 'Documento');
  const kind = folderIconKind(managementDocumentFolder(item).folder);
  const content = managementDocumentIcon(kind === 'folder' ? 'document' : kind) + '<span>' + title + '</span>';
  let href = '';
  try { const url = new URL(item.driveUrl); if (url.protocol === 'https:' && !url.username && !url.password) href = url.href; } catch {}
  const link = href ? '<a class="management-document-link management-document-premium" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + content + '</a>'
    : '<button class="management-document-premium" type="button" disabled>' + content + '</button>';
  const edit = canEdit ? '<button class="secondary-button management-document-edit" type="button" data-document-edit="' + escapeHtml((item.documentCollection || 'documents') + '/' + item.id) + '" aria-label="Editar ' + title + '">' + managementDocumentIcon('edit') + '<span>Editar</span></button>' : '';
  return '<li class="management-document-card">' + link + edit + '</li>';
}

function folderMarkup(name, body, count, extraClass = '') {
  return '<details class="catalog-folder ' + extraClass + '"><summary>' + managementDocumentIcon(folderIconKind(name), 'catalog-folder-icon') + '<span class="catalog-folder-name">' + escapeHtml(name) + '</span><span class="catalog-folder-count">' + count + ' ' + (count === 1 ? 'item' : 'itens') + '</span><span class="catalog-folder-chevron" aria-hidden="true">⌄</span></summary><div class="catalog-folder-content">' + body + '</div></details>';
}

export function renderManagementDocumentFolders(documents, options = {}) {
  const groups = new Map([
    ['GENERAL', new Map([['Protocolos', []], ['ROPs', []]])],
    ['RESTRICTED', new Map([['Documentos administrativos', []], ['Organograma', []]])]
  ]);
  for (const item of documents) {
    const {access, folder} = managementDocumentFolder(item);
    const children = groups.get(access);
    if (!children.has(folder)) children.set(folder, []);
    children.get(folder).push(item);
  }
  return '<div class="catalog-folders management-document-access-folders">' + [...groups].map(([access, children]) => {
    const count = [...children.values()].reduce((sum, rows) => sum + rows.length, 0);
    const body = '<div class="catalog-folders">' + [...children].map(([name, rows]) => folderMarkup(name,
      rows.length ? '<ul class="record-list management-document-list">' + rows.map(item => renderManagementDocumentCard(item, options)).join('') + '</ul>' : '<p class="empty-state">Nenhum documento disponível nesta pasta.</p>', rows.length)).join('') + '</div>';
    return folderMarkup(access === 'GENERAL' ? 'Acesso geral' : 'Acesso restrito', body, count, 'management-document-access-folder');
  }).join('') + '</div>';
}
