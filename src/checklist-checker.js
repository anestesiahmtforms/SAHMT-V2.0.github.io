export const CHECKLIST_NONCONFORMING_COMMITMENT = 'Me comprometo a comunicar imediatamente à equipe e ao setor responsável pela manutenção.';

export function shortChecklistCheckerName(value = '') {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 2 ? `${parts[0]} ${parts.at(-1)}` : parts.join(' ');
}

export function checklistCheckerDateTime(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '';
  let date;
  try {
    if (typeof value?.toDate === 'function') date = value.toDate();
    else if (value instanceof Date) date = value;
    else if (typeof value === 'object') {
      const seconds = value.seconds ?? value._seconds;
      const nanoseconds = value.nanoseconds ?? value._nanoseconds ?? 0;
      if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9) return '';
      date = new Date(seconds * 1000 + nanoseconds / 1e6);
    } else if (typeof value === 'string' || typeof value === 'number') date = new Date(value);
    else return '';
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'}).format(date);
  } catch { return ''; }
}

export function checklistCheckerSummary(record, {uid = '', profileName = '', authName = ''} = {}) {
  if (!record) return null;
  const pending = Boolean(record.pendingSync || record.pendingFirestore || record.syncFailed);
  const creatorUid = typeof record.createdByUid === 'string' ? record.createdByUid : '';
  const ownName = creatorUid && creatorUid === uid ? profileName || authName : '';
  const snapshotName = !pending && typeof record.createdByName === 'string' ? record.createdByName : '';
  return {
    name: shortChecklistCheckerName(snapshotName || ownName),
    creatorUid,
    dateTime: checklistCheckerDateTime(record.createdAt),
    pending,
    failed: record.syncFailed === true
  };
}