import {isValidDateKey} from '../src/schedule-date.js';
import {fail} from './identity.js';

const keys = ['eventId', 'version', 'date', 'active', 'scheduleSigla', 'memberSigla', 'actorUid'];
export function normalizeProjectionEvent(value) {
  if (!value || !/^[A-Za-z0-9_-]{1,128}$/.test(value.eventId || '') || !Number.isSafeInteger(value.version) || value.version < 1 ||
      !isValidDateKey(value.date) || typeof value.active !== 'boolean' || typeof value.scheduleSigla !== 'string' ||
      value.scheduleSigla.length > 30 || !/^(?:|SUPORTE|(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*)$/.test(value.scheduleSigla) ||
      !/^(?:[A-Z]{2}|L2|)$/.test(value.memberSigla) || typeof value.actorUid !== 'string' ||
      !/^[^/\s\x00-\x1f]{1,128}$/.test(value.actorUid)) throw fail('DOMAIN_PROJECTION_INVALID', 400);
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

/** Only event markers and the schedule version change. Release state and
 * positions remain in their owning FJ document and are never copied from FI. */
export function planEventProjection({event: input, previous, schedules}) {
  const event = normalizeProjectionEvent(input);
  if (previous) {
    const prior = normalizeProjectionEvent(previous);
    if (prior.eventId !== event.eventId || !['APPLIED', 'WAITING_SCHEDULE'].includes(previous.status)) throw fail('DOMAIN_PROJECTION_INVALID', 400);
    if (prior.version > event.version) return {status: 'ALREADY_APPLIED', receipt: previous, scheduleUpdates: []};
    if (prior.version === event.version) {
      if (JSON.stringify(prior) !== JSON.stringify(event)) throw fail('DOMAIN_PROJECTION_CONFLICT', 409);
      if (previous.status === 'APPLIED') return {status: 'ALREADY_APPLIED', receipt: previous, scheduleUpdates: []};
    }
  }
  const marker = event.active && event.scheduleSigla ? `EVENTO:${event.scheduleSigla}:${event.memberSigla || '-'}:${event.eventId}` : '';
  const dates = [...new Set([previous?.date, event.date].filter(Boolean))], scheduleUpdates = [];
  for (const date of dates) {
    const schedule = schedules?.[date]; if (!schedule) continue;
    const old = schedule.highlights?.events ?? [];
    const version = schedule.version ?? 0;
    if (!Array.isArray(old) || old.some(value => typeof value !== 'string') || !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER)
      throw fail('DOMAIN_PROJECTION_SCHEDULE_INVALID', 409);
    const events = old.filter(value => !(value.startsWith('EVENTO:') && value.endsWith(':' + event.eventId)));
    if (date === event.date && marker) events.push(marker);
    if (JSON.stringify(old) !== JSON.stringify(events)) scheduleUpdates.push({date, events, version: version + 1, actorUid: event.actorUid});
  }
  const status = marker && !schedules?.[event.date] ? 'WAITING_SCHEDULE' : 'APPLIED';
  return {status, receipt: {...event, status}, scheduleUpdates};
}
