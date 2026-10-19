import {saveOperationalDraft, readOperationalDraft, removeOperationalDraft} from './outbox.js';

export function installOperationalDrafts({root = document, getSession, onError = () => {}}) {
  const touched = new WeakSet(), restoring = new WeakSet(), pending = new Map(), revisions = new Map();
  const scope = form => {
    const session = getSession(), module = form?.dataset?.moduleForm;
    const permission = module === 'events' ? 'eventsWrite' : module === 'labels' ? 'labelsWrite' : '';
    return session.status === 'signed-in' && session.profile?.active === true && session.profile?.access === true &&
      permission && session.profile?.permissions?.[permission] === true ? {uid: session.user.uid, module, id: 'entry'} : null;
  };
  const serial = (key, action) => {
    const task = (pending.get(key) || Promise.resolve()).catch(() => {}).then(action);
    pending.set(key, task); task.catch(onError).finally(() => {if (pending.get(key) === task) pending.delete(key);});
    return task;
  };
  const capture = event => {
    const form = event.target?.closest?.('form[data-module-form]'), own = scope(form);
    if (!own || restoring.has(form) || event.target.type === 'file') return;
    touched.add(form); const fields = {}, key = `${own.uid}:${own.module}`;
    revisions.set(key, (revisions.get(key) || 0) + 1);
    for (const input of form.elements) {
      if (!input.name || ['file', 'password', 'submit', 'button'].includes(input.type) || input.disabled) continue;
      if (input.type === 'radio' && !input.checked) continue;
      fields[input.name] = input.type === 'checkbox' ? input.checked : input.value;
    }
    void serial(`${own.uid}:${own.module}`, () => saveOperationalDraft(own.uid, own.module, own.id, fields));
  };
  root.addEventListener('input', capture, true); root.addEventListener('change', capture, true);
  const restore = async (form, {force = false} = {}) => {
    const own = scope(form); if (!own || touched.has(form) && !force) return false;
    touched.delete(form);
    const draft = await readOperationalDraft(own.uid, own.module, own.id).catch(() => null);
    if (!draft || !form.isConnected || touched.has(form) || scope(form)?.uid !== own.uid) return false;
    restoring.add(form);
    for (const [name, value] of Object.entries(draft.fields)) {
      const input = form.elements.namedItem(name); if (!input || input.type === 'file' || input.type === 'password') continue;
      if (input.type === 'checkbox') input.checked = value === true; else input.value = value;
    }
    for (const input of form.querySelectorAll('select')) input.dispatchEvent(new Event('change', {bubbles: false}));
    restoring.delete(form);
    let status = form.querySelector('[data-local-draft-status]');
    if (!status) {status = document.createElement('p'); status.dataset.localDraftStatus = ''; status.className = 'record-meta'; status.setAttribute('role', 'status'); form.append(status);}
    status.textContent = 'Rascunho recuperado deste aparelho. Confira os campos antes de salvar.';
    return true;
  };
  const clear = (module, uid = getSession().user?.uid) => uid && ['events', 'labels'].includes(module)
    ? serial(`${uid}:${module}`, () => removeOperationalDraft(uid, module, 'entry')) : Promise.resolve();
  const checkpoint = form => {const own = scope(form); return own ? {...own, revision: revisions.get(`${own.uid}:${own.module}`) || 0} : null;};
  const clearSubmitted = own => {
    if (!own) return Promise.resolve();
    const key = `${own.uid}:${own.module}`;
    return serial(key, () => (revisions.get(key) || 0) === own.revision ? removeOperationalDraft(own.uid, own.module, own.id) : undefined);
  };
  return {restore, clear, checkpoint, clearSubmitted, flush: () => Promise.allSettled([...pending.values()]), destroy() {root.removeEventListener('input', capture, true); root.removeEventListener('change', capture, true);}};
}
