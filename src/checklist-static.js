import {findStationForQr, stationIsInDateRange, stationIsValidOn} from './checklist-qr.js';

export function buildChecklistQrLookup(qrValue, sdk, db) {
  const value = String(qrValue ?? '').trim();
  if (!value || value.length > 300 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('QR do Checklist inválido.');
  // A QR may contain a registered URL. Collection document IDs cannot contain '/'.
  const stations = sdk.collection(db, 'stations');
  const qrFilter = sdk.where('qrCode', '==', value);
  const filter = value.includes('/') ? qrFilter
    : sdk.or(qrFilter, sdk.where(sdk.documentId(), '==', value));
  return sdk.query(stations, filter, sdk.limit(2));
}

export function buildChecklistStationDayLookup(stationId, day, sdk, db) {
  if (typeof stationId !== 'string' || !/^[^/]{1,128}$/.test(stationId) || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) {
    throw new Error('Arsenal ou data do Checklist inválidos.');
  }
  return sdk.query(sdk.collection(db, 'checklists'), sdk.where('stationId', '==', stationId),
    sdk.where('date', '<=', day), sdk.orderBy('date', 'desc'), sdk.orderBy('createdAt', 'desc'), sdk.limit(1));
}

export async function resolveChecklistQrStation({stations = [], qrValue, day, includeInactive = false, readByQr} = {}) {
  const value = String(qrValue ?? '').trim();
  if (!value || value.length > 300 || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
  const cached = findStationForQr(stations, value, day, {includeInactive});
  if (cached) return cached;
  if (typeof readByQr !== 'function') return null;
  const matches = await readByQr(value);
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const station = matches[0];
  if (!station || (includeInactive ? !stationIsInDateRange(station, day) : !stationIsValidOn(station, day))) return null;
  return station;
}
