const ROOT_FOLDERS = {
  '1ZVHg-9fcnBv1q8PJgFoUGQ50b5EwAggR': 'Diretrizes',
  '1jwZn5MeuvsSoyHROk_dNS-mXL1teVfBc': 'Documentos administrativos',
  '1gg78vHm0O07B_McXFaMMi_ByGwbbWt-7': 'Protocolos',
  '1N0lTv1vewXW_bqhBhN2QG8cq75ZzXdR8': 'ROPs — Segundo semestre de 2026'
};
const CATEGORY_FOLDERS = new Map([
  ['DIRETRIZES', 'Diretrizes'],
  ['DOCUMENTOS ADMINISTRATIVOS', 'Documentos administrativos'],
  ['PROTOCOLOS', 'Protocolos'],
  ['TREINAMENTO DAS ROPS 2026 - SEGUNDO SEMESTRE', 'ROPs — Segundo semestre de 2026']
]);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const normalizedCategory = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').normalize('NFC') : '';

// Group only the records already returned by the authorized catalog query.
export function catalogFolderName(item, fallback = 'Outros materiais') {
  if (Object.hasOwn(ROOT_FOLDERS, item?.rootId)) return ROOT_FOLDERS[item.rootId];
  const category = normalizedCategory(item?.category);
  return CATEGORY_FOLDERS.get(category.toLocaleUpperCase('pt-BR')) || category || fallback;
}

export function groupCatalogFolders(items, {fallback} = {}) {
  const folders = new Map();
  for (const item of items) {
    const name = catalogFolderName(item, fallback);
    const key = name.toLocaleLowerCase('pt-BR');
    if (!folders.has(key)) folders.set(key, {name, items: []});
    folders.get(key).items.push(item);
  }
  return [...folders.values()].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

export function renderCatalogFolders(items, renderItem, {scope, listClass, ordered = false, fallback} = {}) {
  const listTag = ordered ? 'ol' : 'ul';
  return `<div class="catalog-folders">${groupCatalogFolders(items, {fallback}).map(folder => {
    const id = `catalog-folder-${scope}-${encodeURIComponent(folder.name.toLocaleLowerCase('pt-BR'))}`;
    const count = `${folder.items.length} ${folder.items.length === 1 ? 'item' : 'itens'}`;
    return `<details class="catalog-folder" id="${escapeHtml(id)}"><summary><svg class="catalog-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg><span class="catalog-folder-name">${escapeHtml(folder.name)}</span><span class="catalog-folder-count">${escapeHtml(count)}</span><span class="catalog-folder-chevron" aria-hidden="true">⌄</span></summary><div class="catalog-folder-content"><${listTag} class="${escapeHtml(listClass)}">${folder.items.map(renderItem).join('')}</${listTag}></div></details>`;
  }).join('')}</div>`;
}
