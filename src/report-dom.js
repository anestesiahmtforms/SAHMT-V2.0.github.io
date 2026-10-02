const RECORD_KEYS = ['data-event-record', 'data-label-record', 'data-checklist-station', 'data-checklist-open-day'];
const RECORD_SELECTOR = RECORD_KEYS.map(key => '[' + key + ']').join(',');
// Weak keys release label markup when its live card leaves the report.
const LAST_RECORD_MARKUP = new WeakMap();
const RUNTIME_ATTRIBUTE = /^data-(?:.+-bound|history-loading|history-loaded)$/;

function nodeKey(node) {
  if (node.nodeType !== 1) return null;
  if (node.id) return `id:${node.id}`;
  for (const name of RECORD_KEYS) {
    const value = node.getAttribute(name);
    if (value !== null) return `${name}:${value}`;
  }
  return null;
}
function recordMarkup(node) {
  if (node.nodeType !== 1 || !RECORD_KEYS.some(key => node.hasAttribute(key))) return null;
  const markup = node.outerHTML;
  return typeof markup === 'string' ? markup : null;
}
function rememberClonedRecords(node, incoming) {
  const markup = recordMarkup(incoming);
  if (markup !== null) LAST_RECORD_MARKUP.set(node, markup);
  if (node.nodeType !== 1) return;
  const copies = node.querySelectorAll(RECORD_SELECTOR);
  const originals = incoming.querySelectorAll(RECORD_SELECTOR);
  for (let index = 0; index < copies.length; index++) {
    const childMarkup = recordMarkup(originals[index]);
    if (childMarkup !== null) LAST_RECORD_MARKUP.set(copies[index], childMarkup);
  }
}
function sameKind(left, right) {
  return left.nodeType === right.nodeType && (left.nodeType !== 1 || (left.tagName === right.tagName && left.namespaceURI === right.namespaceURI));
}
function activeField(node, active) {
  if (!node || node !== active || !['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) return null;
  return {value: node.value, checked: node.checked, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection};
}
function restoreField(node, saved) {
  if (!saved) return;
  if (node.type !== 'file') node.value = saved.value;
  if ('checked' in node) node.checked = saved.checked;
  if (saved.start !== null && saved.start !== undefined && typeof node.setSelectionRange === 'function') {
    try { node.setSelectionRange(saved.start, saved.end, saved.direction); } catch { /* Native date/select inputs do not expose text selection. */ }
  }
}

// Parse into a detached template, then retain live keyed nodes and their handlers.
export function reconcileReportMarkup(target, html, {preserveSelectors = []} = {}) {
  if (!target?.ownerDocument?.createElement) throw new TypeError('Informe o container do relatório.');
  const document = target.ownerDocument;
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  const active = document.activeElement;
  const activeSaved = activeField(active, active);
  const scrollNodes = [];
  for (let node = target; node; node = node.parentElement) scrollNodes.push({node, top: node.scrollTop, left: node.scrollLeft});
  const documentScroller = document.scrollingElement;
  if (documentScroller && !scrollNodes.some(({node}) => node === documentScroller)) scrollNodes.push({node: documentScroller, top: documentScroller.scrollTop, left: documentScroller.scrollLeft});
  const scroller = scrollNodes.find(({node}) => node.scrollHeight > node.clientHeight + 1)?.node || documentScroller;
  const viewport = scroller === documentScroller ? {top: 0, bottom: document.defaultView?.innerHeight || scroller?.clientHeight || 0} : scroller?.getBoundingClientRect?.() || target.getBoundingClientRect?.();
  const anchor = viewport && [...target.querySelectorAll(RECORD_KEYS.map((key) => `[${key}]`).join(','))].find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  const anchorTop = anchor?.getBoundingClientRect().top;
  const stats = {inserted: 0, removed: 0, moved: 0, updated: 0};
  const preserved = (node) => node.nodeType === 1 && preserveSelectors.some((selector) => node.matches(selector));
  const patch = (node, incoming) => {
    if (node.nodeType !== 1) {
      if (node.nodeValue !== incoming.nodeValue) { node.nodeValue = incoming.nodeValue; stats.updated++; }
      return;
    }
    if (preserved(node)) return;
    const markup = recordMarkup(incoming);
    if (markup !== null && LAST_RECORD_MARKUP.get(node) === markup) return;
    const saved = activeField(node, active);
    for (const attribute of [...node.attributes]) {
      if (!incoming.hasAttribute(attribute.name) && !RUNTIME_ATTRIBUTE.test(attribute.name)) { node.removeAttribute(attribute.name); stats.updated++; }
    }
    for (const attribute of [...incoming.attributes]) {
      if (!RUNTIME_ATTRIBUTE.test(attribute.name) && node.getAttribute(attribute.name) !== attribute.value) { node.setAttribute(attribute.name, attribute.value); stats.updated++; }
    }
    children(node, incoming);
    if (!saved && ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
      if (node.type !== 'file' && node.value !== incoming.value) { node.value = incoming.value; stats.updated++; }
      if ('checked' in node && node.checked !== incoming.checked) { node.checked = incoming.checked; stats.updated++; }
    }
    restoreField(node, saved);
    if (markup !== null) LAST_RECORD_MARKUP.set(node, markup);
  };
  const children = (parent, incomingParent) => {
    const original = [...parent.childNodes];
    const keyed = new Map();
    for (const node of original) {
      const key = nodeKey(node);
      if (key && !keyed.has(key)) keyed.set(key, node);
    }
    const used = new Set();
    let cursor = parent.firstChild;
    for (const incoming of [...incomingParent.childNodes]) {
      const key = nodeKey(incoming);
      let node = key ? keyed.get(key) : original.find((candidate) => !used.has(candidate) && !nodeKey(candidate) && sameKind(candidate, incoming));
      if (node && (used.has(node) || !sameKind(node, incoming))) node = null;
      if (!node) { node = incoming.cloneNode(true); rememberClonedRecords(node, incoming); parent.insertBefore(node, cursor); stats.inserted++; }
      else {
        used.add(node);
        if (node !== cursor) { parent.insertBefore(node, cursor); stats.moved++; }
        patch(node, incoming);
      }
      cursor = node.nextSibling;
    }
    for (const node of original) {
      if (!used.has(node) && node.parentNode === parent) { parent.removeChild(node); stats.removed++; }
    }
  };
  children(target, template.content);
  if (active?.isConnected && document.activeElement !== active && typeof active.focus === 'function') active.focus({preventScroll: true});
  if (active?.isConnected) restoreField(active, activeSaved);
  for (const saved of scrollNodes) { saved.node.scrollTop = saved.top; saved.node.scrollLeft = saved.left; }
  if (anchor?.isConnected && scroller && Number.isFinite(anchorTop)) {
    const delta = anchor.getBoundingClientRect().top - anchorTop;
    if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
  }
  return stats;
}
