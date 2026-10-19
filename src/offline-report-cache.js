export function operationalReportCacheId(kind, scope = {}) {
  if (!['events', 'labels'].includes(kind) || !scope.from || !scope.to) return '';
  const limit = kind === 'events'
    ? Math.min(100, Math.max(1, Number(scope.pageSize) || 100))
    : Math.min(100, Math.max(1, Number(scope.pageSize) || 50));
  const visibility = kind === 'events'
    ? (scope.isAdmin ? 'admin' : String(scope.sigla || '').trim().toUpperCase() || `uid:${scope.uid || ''}`)
    : (scope.canManage ? 'admin' : String(scope.sigla || '').trim().toUpperCase() || `uid:${scope.uid || ''}`);
  return `report:${scope.from}:${scope.to}:${visibility}:${limit}`;
}

export function checklistCacheId(scope = {}) {
  if (scope.mode === 'daily' && /^\d{4}-\d{2}-\d{2}$/.test(scope.day || '')) {
    const parsed = new Date(`${scope.day}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === scope.day) return scope.day;
  }
  if (scope.mode === 'monthly' && /^\d{4}-(0[1-9]|1[0-2])$/.test(scope.month || '')) return `month:${scope.month}`;
  return '';
}

export function checklistCachedCatalogMatches(cachedStationIds, requestedStationIds) {
  if (!Array.isArray(cachedStationIds) || !Array.isArray(requestedStationIds)) return false;
  const left = [...new Set(cachedStationIds)].sort();
  const right = [...new Set(requestedStationIds)].sort();
  return JSON.stringify(left) === JSON.stringify(right);
}
