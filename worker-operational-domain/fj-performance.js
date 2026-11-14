import {normalizeEventType} from '../src/event-form.js';
import {isValidDateKey} from '../src/schedule-date.js';
import {fail} from './identity.js';

export function fjEventPoints(event) {
  if (event?.active !== true || ['CANCELED','CANCELLED'].includes(String(event.status).toUpperCase())) return 0;
  const type = normalizeEventType(event.eventType);
  if (type === 'ausencia' || type === 'falta') return -5;
  if (type !== 'atraso') return 0;
  const multiple = String(event.delayMultiple);
  if (!/^[0-6]$/.test(multiple)) throw fail('DOMAIN_FJ_DELAY_INVALID');
  return multiple === '0' ? 0 : -Number(multiple) / 2;
}

export async function reconcileFjPerformance(store, eventId) {
  return store.transaction(async tx => {
    const event = (await tx.get('events', eventId))?.data;
    const previous = (await tx.get('fjPerformanceLedger', eventId))?.data;
    const points = fjEventPoints(event);
    if (!points && !previous) return;
    let next;
    if (points) {
      const sigla = String(event.memberSigla || '').trim().toUpperCase();
      if (!/^(?:[A-Z]{2}|L2)$/.test(sigla) || !isValidDateKey(event.date)) throw fail('DOMAIN_FJ_EVENT_INVALID');
      const contact = (await tx.get('contacts', sigla))?.data;
      const email = String(contact?.email || '').trim().toLowerCase();
      if (!email || contact.sigla !== sigla) throw fail('DOMAIN_FJ_CONTACT_REQUIRED');
      const users = await tx.findFjUsers(email);
      if (users.length !== 1 || users[0].data.uid !== users[0].id) throw fail('DOMAIN_FJ_USER_REQUIRED');
      next = {uid: users[0].id, eventId, date: event.date, type: normalizeEventType(event.eventType) === 'atraso' ? 'atraso' : 'falta', points};
    }
    if (previous && next && ['uid','date','type','points'].every(key => previous[key] === next[key])) return;
    const changes = new Map();
    if (previous?.points) changes.set(previous.uid, -previous.points);
    if (next) changes.set(next.uid, (changes.get(next.uid) || 0) + next.points);
    for (const [uid, delta] of changes) {
      if (!delta) continue;
      const total = (await tx.get('fjPerformanceSummaries', uid))?.data?.total ?? 0;
      if (!Number.isSafeInteger(total * 2) || total > 0 || total + delta > 0) throw fail('DOMAIN_FJ_SUMMARY_INVALID');
      tx.setFjPerformance('fjPerformanceSummaries', uid, {uid, total: total + delta});
    }
    tx.setFjPerformance('fjPerformanceLedger', eventId, next || {...previous, points: 0});
  });
}
