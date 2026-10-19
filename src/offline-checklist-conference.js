import {stationIsInDateRange} from './checklist-qr.js';

// This authorizes a local intent only. Official acknowledgement and scoring still require online review.
export function localChecklistConferenceReady({day, today, stations, records, profile, rotation, incomplete = false}) {
  if (day !== today || incomplete || profile?.active !== true || profile?.access !== true || profile?.permissions?.checklistSign !== true ||
      rotation?.complete !== true || !rotation.name || !/^(?:[A-Z]{2}|L2)$/.test(rotation.sigla || '') || !Number.isInteger(rotation.position) || rotation.position < 1 || rotation.position > 30) return false;
  const active = stations.filter(item => item.active === true && stationIsInDateRange(item, day));
  if (!active.length) return false;
  const latest = new Map();
  for (const record of records) if (record.date === day && !latest.has(record.stationId)) latest.set(record.stationId, record);
  return active.every(item => {
    const record = latest.get(item.id);
    return record && ['SIM', 'NAO'].includes(record.condition) && record.active !== false && !record.inherited && !record.sheetDeleted && !record.syncFailed && !record.syncConflict &&
      (record.condition !== 'NAO' || typeof record.occurrence === 'string' && record.occurrence.trim());
  });
}
