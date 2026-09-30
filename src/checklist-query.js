import {runKeyedTask} from './keyed-task.js';

export function createChecklistReadCoordinator(tasks = new Map()) {
  return {
    run({scope, uid, period, stationIds = []}, createTask) {
      const stationKey = [...new Set(stationIds.map((id) => String(id || '').trim()).filter(Boolean))].sort();
      const key = JSON.stringify([scope, uid || '', period, stationKey]);
      return runKeyedTask(tasks, key, createTask);
    }
  };
}

export function checklistReadMetrics(querySnapshots = []) {
  return {
    serverQueries: querySnapshots.length,
    documentsRead: querySnapshots.reduce((sum, snapshot) => sum + Math.max(0, Number(snapshot?.size) || 0), 0)
  };
}
