import {recipientCategory} from './communication-recipient-directory.js';
import {escapeNoticeHtml as esc} from './communication-notice-text.js';

export async function loadActivityRanking(send, current) {
  async function request(action, input) {
    while (current()) {
      try {
        return await send(action, input);
      } catch (error) {
        const wait = error.resetsAt - Date.now();
        if (error.code !== 'COMM_RATE_LIMIT' || !Number.isFinite(wait) || wait > 60000) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.max(1000, wait + 250)));
      }
    }
    throw Error('COMM_SESSION_INVALID');
  }
  const directory = await request('DIRECTORY');
  const people = new Map();
  for (const person of directory.items) {
    const group = recipientCategory(person);
    if (!['RESIDENTE', 'SUBSTITUTO'].includes(group?.id)) continue;
    people.set(person.uid, {name: person.displayName || person.email, group: group.label, activities: new Map()});
  }
  const messages = new Set(), cursors = new Set();
  let cursor = '';
  do {
    if (!current()) return [];
    if (cursors.has(cursor)) throw Error('COMM_CURSOR_REPEATED');
    cursors.add(cursor);
    const page = await request('SENT_MESSAGES', {cursor});
    for (const item of page.items) {
      if (!current()) return [];
      if (!item.activity || messages.has(item.id)) continue;
      messages.add(item.id);
      const detail = await request('SENT_DETAIL', {id: item.id, ...(item.historyRow ? {historyRow: item.historyRow} : {})});
      const activity = detail.message.activity;
      if (!activity) continue;
      const edition = activity.kind === 'TRAINING' ? activity.version : activity.cycle;
      const key = JSON.stringify([activity.kind, activity.id, edition]);
      for (const receipt of detail.recipients) {
        const person = people.get(receipt.uid);
        if (person && receipt.status === 'COMPLETED' && receipt.completedAt > 0) {
          person.activities.set(key, {title: activity.title, edition: activity.kind === 'TRAINING' ? 'Versão ' + edition : edition});
        }
      }
    }
    cursor = page.cursor;
  } while (cursor);
  return [...people.values()].sort((a, b) => b.activities.size - a.activities.size || a.name.localeCompare(b.name, 'pt-BR'));
}

export function renderActivityRanking(people) {
  if (!people.length) return '<p>Nenhum residente ou substituto cadastrado.</p>';
  let previous, rank;
  return '<p>Cada atividade obrigatória concluída vale 1 ponto. Selecione um nome para ver as atividades.</p>' + people.map((person, index) => {
    const points = person.activities.size;
    if (previous !== points) rank = index + 1;
    previous = points;
    const items = [...person.activities.values()].map(a => '<li>' + esc(a.title) + ' · ' + esc(String(a.edition)) + ' · 1 ponto</li>').join('');
    return '<details><summary><strong>' + rank + 'º · ' + esc(person.name) + '</strong> · ' + esc(person.group) + ' · ' + points + (points === 1 ? ' ponto' : ' pontos') + '</summary>' + (items ? '<ul>' + items + '</ul>' : '<p>Nenhuma atividade pontuada.</p>') + '</details>';
  }).join('');
}
