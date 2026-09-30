import {runKeyedTask} from './keyed-task.js';

export function createChecklistReadCoordinator(tasks = new Map()) {
  return {
    run({scope, uid, period, stationIds = [], recordLimit = null}, createTask) {
      const stationKey = [...new Set(stationIds.map((id) => String(id || '').trim()).filter(Boolean))].sort();
      const key = JSON.stringify([scope, uid || '', period, stationKey, recordLimit]);
      return runKeyedTask(tasks, key, createTask);
    }
  };
}

export function checklistHistoryStationIds(stationIds, currentRecords, firstDay) {
  const answered = new Set(currentRecords.filter((record) => record.date === firstDay).map((record) => record.stationId));
  return [...new Set(stationIds)].filter((id) => !answered.has(id));
}

export async function readChecklistWithHistory({stationIds, firstDay, readCurrent, readPrevious, recordLimit = Infinity}) {
  const currentResult = await readCurrent();
  const records = currentResult.docs.slice(0, recordLimit).map((item) => item.data());
  const historyStationIds = checklistHistoryStationIds(stationIds, records, firstDay);
  const priorResults = await Promise.all(historyStationIds.map(readPrevious));
  return {currentResult, priorResults, readMetrics: checklistReadMetrics([currentResult, ...priorResults])};
}

export function checklistReadMetrics(querySnapshots = []) {
  return {
    serverQueries: querySnapshots.length,
    documentsRead: querySnapshots.reduce((sum, snapshot) => sum + Math.max(0, Number(snapshot?.size) || 0), 0)
  };
}
