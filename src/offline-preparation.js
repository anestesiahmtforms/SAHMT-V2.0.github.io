export async function prepareOperationalData({uid, day, allows, readCache, loaders, isCurrent = () => true}) {
  const tasks = [['appConfig', 'app', 'appFeatures']];
  if (allows(['scheduleRead', 'eventsRead', 'eventsWrite', 'checklistRead', 'checklistSign'])) tasks.push(['scheduleDays', day, 'schedule'], ['contacts', 'active', 'contacts'], ['vacations', day, 'vacations']);
  if (allows(['eventsRead', 'eventsWrite'])) tasks.push(['eventCatalogs', 'operational', 'eventCatalog'], ['eventMembers', 'all', 'eventMembers']);
  if (allows(['labelsWrite', 'labelsManage'])) tasks.push(['labelStaff', 'all', 'labelStaff']);
  if (allows(['checklistRead', 'checklistWrite', 'checklistSign', 'checklistManage'])) tasks.push(['stations', 'all', 'stations']);
  const results = [];
  for (const [kind, id, loader] of tasks) {
    if (!isCurrent()) break;
    try {
      const existing = await readCache(uid, kind, id);
      if (!existing) await loaders[loader]();
      results.push({kind, ready: true});
    } catch (error) {results.push({kind, ready: false, code: String(error?.code || 'unavailable')});}
  }
  return results;
}
