import {buildChecklistStationDayLookup} from './checklist-static.js';
import {assertChecklistReadCurrent, readChecklistPages} from './checklist-read.js';

const recordFromDocument = document => ({...document.data(), id: document.id});
const compareText = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const timestampMillis = value => value?.toMillis?.() ?? new Date(value || 0).getTime();

/** Keep the one-record read; recover through complete pages when an index is unavailable. */
export async function readChecklistStationDay(stationId, day, sdk, db, {isCurrent = () => true} = {}) {
  const lookup = buildChecklistStationDayLookup(stationId, day, sdk, db);
  assertChecklistReadCurrent(isCurrent);
  try {
    const result = await sdk.getDocs(lookup);
    assertChecklistReadCurrent(isCurrent);
    return result.docs.length ? recordFromDocument(result.docs[0]) : null;
  } catch (error) {
    if (error.code !== 'failed-precondition') throw error;
    const compareRecords = (left, right) => compareText(right.date, left.date) ||
      timestampMillis(right.createdAt) - timestampMillis(left.createdAt) ||
      (right.createdAt?.nanoseconds || 0) - (left.createdAt?.nanoseconds || 0) || compareText(right.id, left.id);
    let latest = null;
    const visit = record => {
      if (record.stationId !== stationId || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '') ||
        record.date > day || record.createdAt == null) return;
      if (!latest || compareRecords(record, latest) < 0) latest = record;
    };
    try {
      await readChecklistPages('checklists', [sdk.where('stationId', '==', stationId)], visit, sdk, db, isCurrent);
    } catch (failure) {
      if (failure.code !== 'failed-precondition') throw failure;
      // Field indexes can also be disabled. The final path requires only the
      // built-in document-name index, and still filters to this arsenal and day.
      latest = null;
      await readChecklistPages('checklists', [], visit, sdk, db, isCurrent);
    }
    return latest;
  }
}
