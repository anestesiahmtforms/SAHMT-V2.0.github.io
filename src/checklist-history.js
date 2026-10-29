import {buildChecklistStationDayLookup} from './checklist-static.js';

const HISTORY_LIMIT = 500;
const recordFromDocument = document => ({...document.data(), id: document.id});
const compareText = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const timestampMillis = value => value?.toMillis?.() ?? new Date(value || 0).getTime();

/** Keep the indexed one-record read; recover only when its index is unavailable. */
export async function readChecklistStationDay(stationId, day, sdk, db) {
  const lookup = buildChecklistStationDayLookup(stationId, day, sdk, db);
  try {
    const result = await sdk.getDocs(lookup);
    return result.docs.length ? recordFromDocument(result.docs[0]) : null;
  } catch (error) {
    if (error.code !== 'failed-precondition' || !/index/i.test(error.message || '')) throw error;
    // A single-field equality uses Firestore's automatic index. Never select a
    // latest record from truncated history, and never fall back to stale data here.
    const result = await sdk.getDocs(sdk.query(sdk.collection(db, 'checklists'),
      sdk.where('stationId', '==', stationId), sdk.limit(HISTORY_LIMIT + 1)));
    if (result.docs.length > HISTORY_LIMIT) {
      throw Object.assign(new Error('O histórico precisa do índice do servidor para ser consultado por completo.'),
        {code: 'checklist-history-incomplete'});
    }
    const records = result.docs.map(recordFromDocument).filter(record =>
      record.stationId === stationId && /^\d{4}-\d{2}-\d{2}$/.test(record.date || '') &&
      record.date <= day && record.createdAt != null);
    records.sort((left, right) => compareText(right.date, left.date) ||
      timestampMillis(right.createdAt) - timestampMillis(left.createdAt) ||
      (right.createdAt?.nanoseconds || 0) - (left.createdAt?.nanoseconds || 0) || compareText(right.id, left.id));
    return records[0] || null;
  }
}
