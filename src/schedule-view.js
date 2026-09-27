const dcAliasesByWeekday = Object.freeze({
  segunda: ['CR', 'LH'],
  terca: ['CR', 'LH', 'AD'],
  quarta: ['CR', 'LH', 'AD'],
  quinta: ['CR', 'LH'],
  sexta: ['CR', 'LA']
});
const dcFallback = ['AD', 'CR', 'LA', 'LH'];
const siglaPattern = /(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*/g;

function normalizeWeekday(value = '') {
  const weekday = String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/-feira/g, '').trim();
  const key = weekday.split(/\s+/)[0];
  return ({segunda: 'segunda', terca: 'terca', quarta: 'quarta', quinta: 'quinta', sexta: 'sexta', sabado: 'sabado', domingo: 'domingo'})[key] || '';
}

export function weekdayForDate(dateKey, label = '') {
  const supplied = normalizeWeekday(label);
  if (supplied) return supplied;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return '';
  return normalizeWeekday(new Intl.DateTimeFormat('pt-BR', {weekday: 'long', timeZone: 'UTC'}).format(new Date(`${dateKey}T12:00:00Z`)));
}

export function extractScheduleSiglas(value = '') {
  return String(value).split('(')[0].toUpperCase().match(siglaPattern) || [];
}

function expandScheduleSiglas(value = '') {
  return extractScheduleSiglas(value).flatMap((group) => group.split(/[/-]/));
}

export function resolveScheduleSiglas(token, weekday) {
  const normalized = String(token || '').toUpperCase();
  if (normalized === 'DC') return [...(dcAliasesByWeekday[weekday] || dcFallback)];
  return [...new Set(extractScheduleSiglas(normalized).flatMap((group) => group.split(/[/-]/).flatMap((sigla) => sigla === 'DC' ? (dcAliasesByWeekday[weekday] || dcFallback) : [sigla])))];
}

function schedulePositions(schedule = {}) {
  const source = Array.isArray(schedule.assignments) ? schedule.assignments
    : Array.isArray(schedule.siglas) ? schedule.siglas
      : Array.isArray(schedule.positions) ? schedule.positions
        : [];
  return source.map((item, index) => {
    const value = typeof item === 'string' ? {sigla: item} : (item || {});
    return {...value, sigla: String(value.sigla || value.name || value.label || '').trim().toUpperCase(), index};
  });
}

export function buildScheduleView(schedule = {}, dateKey, vacations = [], contacts = []) {
  const weekday = weekdayForDate(dateKey, schedule.weekdayLabel);
  const positions = schedulePositions(schedule);
  const vacationOrderFromSchedule = expandScheduleSiglas(String(schedule.vacationLabel || '').split('(')[0]);
  const vacationOrder = [];
  const vacationSiglas = new Set();
  const vacationPositions = {};
  const vacationLabels = [];
  for (const vacation of vacations) {
    if (vacation.label) vacationLabels.push(String(vacation.label));
    const columns = Array.isArray(vacation.siglas) && vacation.siglas.length ? vacation.siglas : [vacation.label || ''];
    columns.forEach((item, columnIndex) => {
      for (const sigla of expandScheduleSiglas(item).map((value) => String(value || '').toUpperCase())) {
        if (!vacationSiglas.has(sigla)) vacationOrder.push(sigla);
        vacationSiglas.add(sigla);
        // Each ordered entry is a source vacation column (1–5), not a daily schedule position.
        if (!vacationPositions[sigla]) vacationPositions[sigla] = columnIndex + 1;
      }
    });
  }
  // Keep older schedule-level vacation labels usable when no explicit vacation row supplies a sigla.
  vacationOrderFromSchedule.forEach((sigla, index) => {
    if (!vacationSiglas.has(sigla)) {
      vacationOrder.push(sigla);
      vacationSiglas.add(sigla);
      vacationPositions[sigla] = index + 1;
    }
  });
  if (!schedule.vacationLabel && !vacationLabels.length) vacationLabels.push('');
  const scheduledVacationSiglas = new Set();
  for (const position of positions) {
    for (const sigla of resolveScheduleSiglas(position.sigla, weekday)) {
      if (vacationSiglas.has(sigla)) scheduledVacationSiglas.add(sigla);
    }
  }
  const entries = positions.map((position) => {
    const siglas = resolveScheduleSiglas(position.sigla, weekday);
    const vacationParts = siglas.filter((sigla) => vacationSiglas.has(sigla));
    const matchedContacts = siglas.map((sigla) => contacts.find((contact) => String(contact.sigla || '').toUpperCase() === sigla)).filter(Boolean);
    const vacationPosition = vacationParts.length ? Math.min(...vacationParts.map((sigla) => vacationPositions[sigla] || 0).filter(Boolean)) : 0;
    return {...position, siglas, contacts: matchedContacts, onVacation: vacationParts.length > 0, vacationParts, vacationPosition, vacationPositions};
  });
  const label = schedule.vacationLabel || [...new Set(vacationLabels.filter(Boolean))].join(' · ');
  return {weekday, positions: entries, vacationLabel: label, vacationSiglas, scheduledVacationSiglas};
}
