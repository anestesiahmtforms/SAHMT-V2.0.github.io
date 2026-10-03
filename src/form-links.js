/** Pure URL/discovery helpers. Detection never grants a point or changes an audience. */
export function normalizeGoogleFormLink(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.hostname === 'forms.gle') {
    if (!/^\/[A-Za-z0-9_-]{4,200}\/?$/.test(url.pathname)) return null;
    const slug = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    return {kind: 'SHORT_URL', formId: null, aliasKey: `short:${slug}`, normalizedUrl: `https://forms.gle/${slug}`};
  }
  if (url.hostname !== 'docs.google.com') return null;
  const match = url.pathname.match(/^\/forms\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]{10,200})(?:\/(?:edit|viewform|prefill|copy|closedform))?\/?$/);
  if (!match) return null;
  const publicId = Boolean(match[1]);
  const id = match[2];
  return {kind: publicId ? 'RESPONDER_ID' : 'EDIT_ID', formId: publicId ? null : id,
    aliasKey: `${publicId ? 'responder' : 'form'}:${id}`,
    normalizedUrl: `https://docs.google.com/forms/d/${publicId ? 'e/' : ''}${id}/${publicId ? 'viewform' : 'edit'}`};
}

export function extractGoogleFormLinks(value) {
  const found = new Map();
  const visited = new WeakSet();
  function visit(node) {
    if (typeof node === 'string') {
      for (const candidate of node.match(/https:\/\/[^\s<>"'\]\[{}]+/g) || []) {
        const link = normalizeGoogleFormLink(candidate.replace(/[),.;!?]+$/, ''));
        if (link) found.set(link.aliasKey, link);
      }
    } else if (node && typeof node === 'object' && !visited.has(node)) {
      visited.add(node);
      Object.values(node).forEach(visit);
    }
  }
  visit(value);
  return [...found.values()];
}

export function reconcileFormLinkReferences(existing, discovered, {complete = true} = {}) {
  const key = (item) => JSON.stringify([item.sourceCollection, item.sourceId, item.aliasKey]);
  const current = new Map(discovered.map((item) => [key(item), {...item}]));
  const previous = new Map(existing.map((item) => [key(item), item]));
  const changes = [...current].map(([id, item]) => ({...previous.get(id), ...item,
    active: item.active !== false,
    status: item.active === false ? 'INACTIVE' : item.status || 'CONFIGURATION_PENDING',
    reason: item.reason || (item.active === false ? 'Origem inativa.' : 'Aguardando configuração e resolução confiável do formulário.')}));
  for (const [id, item] of previous) {
    if (!current.has(id)) changes.push(complete ? {...item, active: false, status: 'INACTIVE', reason: 'Vínculo removido da origem; histórico preservado.'} : {...item});
  }
  return changes;
}
