const PERMISSION_BY_TYPE = Object.freeze({
  events: 'eventsWrite', eventEdits: 'eventsWrite', labels: 'labelsWrite', labelEdits: 'labelsManage',
  checklists: 'checklistWrite', activities: 'managementActivityWrite', scheduleReleases: 'scheduleWrite', occurrences: 'occurrencesWrite'
});

export function offlineOperationPermission(type) {
  return PERMISSION_BY_TYPE[type] || '';
}

export function isOfflineOperationAuthorized(operation, profile, {online = true} = {}) {
  const permission = offlineOperationPermission(operation?.type);
  if (operation?.type === 'labelEdits') return online && profile?.active === true && profile?.access === true &&
    (profile?.permissions?.labelsWrite === true || profile?.permissions?.labelsManage === true);
  return online && Boolean(permission) && profile?.active === true && profile?.access === true && profile?.permissions?.[permission] === true;
}
