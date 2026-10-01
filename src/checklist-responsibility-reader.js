import {resolveChecklistResponsibility} from './checklist-responsible.js';

// Display only: the existing server validator still decides who may sign.
export async function getChecklistDayResponsible({day, uid, isAdmin = false}, sources = null) {
  if (!sources) {
    const data = await import('./data.js');
    sources = {...data, remotePreview: async () => {
      const [{getFunctions, httpsCallable}, {app}] = await Promise.all([
        import('firebase/functions'), import('./firebase-app.js')
      ]);
      if (!app) throw new Error('Sessão indisponível.');
      const preview = httpsCallable(getFunctions(app, 'southamerica-east1'), 'checklistSignature', {timeout: 6000});
      return (await preview({day, mode: 'preview'})).data;
    }};
  }
  if (!isAdmin) {
    const preview = await sources.remotePreview();
    if (!preview?.responsible?.name) throw new Error('Responsável não confirmado.');
    return preview.responsible;
  }
  const [schedule, vacations, contacts] = await Promise.all([
    sources.readSchedule(day, uid), sources.listVacationsForDate(day), sources.listContactCatalog({pageSize: 200})
  ]);
  if (!schedule || schedule.stale) throw new Error('A escala precisa ser conferida online.');
  const events = [];
  let cursor = null;
  do {
    const page = await sources.listEventRecords({from: day, to: day, uid, isAdmin: true, pageSize: 100, cursor, includePending: false});
    if (page.stale) throw new Error('Os eventos precisam ser conferidos online.');
    events.push(...page.records);
    cursor = page.nextCursor;
    if (cursor && events.length >= 1000) throw new Error('Não foi possível conferir todos os eventos do dia.');
  } while (cursor);
  const responsible = resolveChecklistResponsibility({schedule, day, vacations, events, contacts});
  if (!responsible.name) throw new Error(responsible.reason || 'Responsável não confirmado.');
  return responsible;
}
