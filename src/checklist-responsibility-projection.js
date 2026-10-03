// Prepared Spark reader. Switch the operational import only after the trusted projection is continuously published and homologated.
import {resolveChecklistResponsibility} from './checklist-responsible.js';

// Display only: the existing server validator still decides who may sign.
export async function getChecklistDayResponsible({day, uid, isAdmin = false}, sources = null) {
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day || '') || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new Error('Checklist ou sessão inválidos.');
  }
  if (!sources) {
    const data = await import('./data.js');
    sources = {...data, responsibilityProjection: async () => {
      const [{doc, getDocFromServer}, {db}] = await Promise.all([
        import('firebase/firestore'), import('./firebase.js')
      ]);
      if (!db) throw new Error('Sessão indisponível.');
      const projection = await getDocFromServer(doc(db, 'checklistResponsibilities', day));
      return projection.exists() ? projection.data() : null;
    }};
  }
  if (!isAdmin) {
    const preview = await sources.responsibilityProjection();
    if (preview?.day !== day || preview?.status !== 'CONFIRMED' || !preview?.responsible?.name || !preview.responsible.uid ||
        !/^[a-f0-9]{64}$/.test(preview.fingerprint || '') || !/^[a-f0-9]{64}$/.test(preview.revision || '')) throw new Error('Responsável aguardando confirmação do servidor.');
    return {...preview.responsible, responsibleUid: preview.responsible.uid};
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
