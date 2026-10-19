// Derived local display only; never persist this over the confirmed schedule.
export function projectPendingSchedule(schedule, operations, {uid, day}) {
  if (!schedule || !uid || schedule.id && schedule.id !== day || schedule.date && schedule.date !== day) return schedule;
  const original = schedule.highlights?.events || [], markers = [...original];
  for (const operation of operations || []) {
    const data = operation?.payload?.data, id = operation?.requestId;
    if (operation?.uid !== uid || operation.type !== 'events' || !['queued', 'awaiting-confirmation', 'sending'].includes(operation.status) ||
        operation.payload?.collectionName !== 'events' || data?.date !== day || data.active === false ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(id || '') || !/^(?:[A-Z]{2}|L2|SUPORTE)$/.test(data.scheduleSigla || '') ||
        !/^(?:[A-Z]{2}|L2|-)$/.test(data.memberSigla || '-')) continue;
    if (!markers.some(value => String(value).endsWith(':' + id))) markers.push(`EVENTO:${data.scheduleSigla}:${data.memberSigla || '-'}:${id}`);
  }
  return markers.length === original.length ? schedule : {...schedule, highlights: {...schedule.highlights, events: markers}, localPendingSchedule: true, stale: true};
}
