import {getOperationalModuleDatabase} from './operational-module-firebase.js';
import {collection, doc, getDoc, getDocs, query, where} from 'firebase/firestore/lite';

export function openFjPerformance(uid, isCurrent, onClose) {
  const dialog = document.createElement('dialog');
  dialog.className = 'evaluation-dialog';
  dialog.innerHTML = '<h2 id="fj-performance-title">DESEMPENHO FJ</h2><div data-fj-result style="max-height:65dvh;overflow:auto"><p role="status">Carregando pontuação…</p></div><form method="dialog"><button class="secondary-button" type="submit">VOLTAR</button></form>';
  dialog.setAttribute('aria-labelledby','fj-performance-title');
  dialog.addEventListener('close', () => {dialog.remove(); onClose();}, {once:true});
  document.body.append(dialog);
  dialog.showModal();
  void (async () => {
    const result = dialog.querySelector('[data-fj-result]');
    try {
      const db = await getOperationalModuleDatabase('FJ', uid);
      const [summary, ledger] = await Promise.all([
        getDoc(doc(db,'fjPerformanceSummaries',uid)),
        getDocs(query(collection(db,'fjPerformanceLedger'),where('uid','==',uid)))
      ]);
      if (!dialog.open || !isCurrent()) return;
      const total = summary.exists() ? summary.data().total : 0;
      const rows = ledger.docs.map(entry=>entry.data()).filter(entry=>entry.points<0).sort((a,b)=>b.date.localeCompare(a.date));
      if (!Number.isSafeInteger(total*2) || rows.reduce((sum,entry)=>sum+entry.points,0)!==total) throw Error('FJ_PERFORMANCE_INCONSISTENT');
      const format = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
      const balance = document.createElement('p');
      balance.textContent = 'Meus pontos · '+format.format(total);
      result.replaceChildren(balance);
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Nenhum desconto registrado.';
        result.append(empty);
        return;
      }
      const history = document.createElement('ul');
      for (const entry of rows) {
        const item = document.createElement('li');
        item.textContent = entry.date.split('-').reverse().join('/')+' · '+(entry.type==='atraso'?'Atraso':'Falta')+' · '+format.format(entry.points);
        history.append(item);
      }
      result.append(history);
    } catch {
      if (dialog.open && isCurrent()) result.textContent = 'Não foi possível confirmar a pontuação de FJ. Volte e tente novamente.';
    }
  })();
  return dialog;
}
