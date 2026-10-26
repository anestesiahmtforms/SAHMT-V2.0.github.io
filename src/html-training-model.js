export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const isTrainingAdmin = profile => profile?.role === 'administrador_app' || profile?.role === 'admin' || profile?.permissions?.admin === true;
export const canManageTraining = (training, user, profile) => Boolean(user?.uid && (isTrainingAdmin(profile) || training.managerUid === user.uid || training.canManage === true));

/** Content only: never serialize OPEN, questions, bank, state, or credentials. */
export {createContentCache} from './html-training-cache.js';

/** Untrusted body HTML lives only inside a no-script, no-network iframe. */
export function readerDocument(body, uid, date, editing = false) {
  const h = escapeHtml;
  // A parsed body prevents supplied head/meta/base tags from preceding our CSP.
  let content = String(body || '');
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(content, 'text/html');
    doc.querySelectorAll('script,meta,base,link,iframe,object,embed,form,svg,math').forEach(n=>n.remove());
    for (const el of doc.body.querySelectorAll('*')) for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || ['srcdoc','href','action','formaction','contenteditable'].includes(a.name.toLowerCase()) || (['src','poster','background'].includes(a.name.toLowerCase()) && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(a.value))) el.removeAttribute(a.name);
    }
    content = doc.body.innerHTML;
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'"><style>html{color:#183e48;background:white;font:16px/1.7 system-ui}body{margin:0;padding:24px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{border:1px solid #cbd6d9;padding:8px}h1,h2,h3{line-height:1.25}.flow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.branch{padding:16px;border:1px solid #bad2d8;border-radius:8px;background:#f6fafb}.action{font-weight:650;color:#116174}.scroll{max-width:100%;overflow:auto}.notice{padding:12px;border-left:4px solid #c28f14;background:#fff5d9}.source{font-size:.85rem;color:#58707c}@media(max-width:600px){.flow{grid-template-columns:1fr}}body${editing?'':',body *'}{${editing?'':'user-select:none;-webkit-user-select:none;'}}.watermark{font-size:12px;color:#6a7b80;border-top:1px solid #ddd;margin-top:32px;padding-top:12px;pointer-events:none}.protected-print{display:none}@media print{${editing?'':'.material,.watermark{display:none!important}.protected-print{display:block!important}'}}</style></head><body><main class="material"${editing?' contenteditable="true" role="textbox" aria-multiline="true" aria-label="Conteúdo da seção"':''}>${content}</main>${editing?'':`<footer class="watermark">Uso institucional · ${h(uid)} · ${h(date)}</footer><p class="protected-print">Material de treinamento protegido. Impressão indisponível.</p>`}</body></html>`;
}
