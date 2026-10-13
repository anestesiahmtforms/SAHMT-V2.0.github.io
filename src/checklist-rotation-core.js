const DC_ALIASES_BY_WEEKDAY = Object.freeze({
  segunda: ['CR', 'LH'], terca: ['CR', 'LH', 'AD'], quarta: ['CR', 'LH', 'AD'],
  quinta: ['CR', 'LH'], sexta: ['CR', 'LA']
});
const DC_FALLBACK = Object.freeze(['AD', 'CR', 'LA', 'LH']);
const ROTATION_TOKEN = /^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/;
const ROTATION_EVENT_ID = /^[A-Za-z0-9_-]{1,200}$/;

function normalizeRotationWeekday(value = '') {
  const key = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/-feira/g, '').trim().split(/\s+/)[0];
  return ({domingo: 'domingo', segunda: 'segunda', terca: 'terca', quarta: 'quarta',
    quinta: 'quinta', sexta: 'sexta', sabado: 'sabado'})[key] || '';
}

export function checklistRotationWeekday(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return '';
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) return '';
  return normalizeRotationWeekday(new Intl.DateTimeFormat('pt-BR', {weekday: 'long', timeZone: 'UTC'}).format(date));
}

export function resolveChecklistRotationSiglas(token, weekday) {
  const normalized = String(token || '').toUpperCase();
  if (normalized === 'DC') return [...(DC_ALIASES_BY_WEEKDAY[weekday] || DC_FALLBACK)];
  const groups = normalized.split('(')[0].match(/(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*/g) || [];
  return [...new Set(groups.flatMap(group => group.split(/[/-]/).flatMap(sigla => sigla === 'DC'
    ? (DC_ALIASES_BY_WEEKDAY[weekday] || DC_FALLBACK) : [sigla])))];
}

function parseRotationSiglas(value, weekday, {support = false, list = false} = {}) {
  if (typeof value !== 'string' || value.length > 240) return null;
  const token = value.split('(')[0].trim().toUpperCase();
  if (support && token === 'SUPORTE') return [];
  if (!token) return [];
  const tokens = list ? token.split(/[,;\s]+/) : [token];
  if (!tokens.every(item => ROTATION_TOKEN.test(item))) return null;
  return [...new Set(tokens.flatMap(item => resolveChecklistRotationSiglas(item, weekday)))];
}

function parseRotationEvent(marker, weekday) {
  if (typeof marker !== 'string' || !marker.trim() || marker.length > 400) return null;
  const parts = marker.trim().split(':');
  if (parts.length === 1) return parseRotationSiglas(parts[0], weekday, {support: true});
  if (parts[0].toUpperCase() !== 'EVENTO' || parts.length < 2 || parts.length > 4) return null;
  const scheduled = parseRotationSiglas(parts[1], weekday, {support: true});
  if (scheduled === null || !parts[1].trim()) return null;
  if (parts.length === 2) return scheduled;
  if (!ROTATION_EVENT_ID.test(parts[parts.length - 1])) return null;
  if (parts.length === 3 || parts[1].trim().toUpperCase() === 'SUPORTE') return scheduled;
  const member = parts[2].trim().toUpperCase();
  if (member === '-') return scheduled;
  if (!member) return null;
  return parseRotationSiglas(member, weekday, {support: true});
}

/** Canonical rotation calculation shared with the generated Apps Script source. */
export function resolveChecklistRotationCore({schedule = null, day, vacations = [], truncated = false} = {}) {
  const unavailable = reason => ({sigla: null, position: null, complete: false, reason});
  const weekday = checklistRotationWeekday(day);
  if (!weekday) return unavailable('Data inválida para conferir o rodízio da escala.');
  if (truncated || !Array.isArray(vacations) || vacations.length > 100) return unavailable('Aguardando a conferência completa das férias.');
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return unavailable('Escala não disponível para esta data.');
  if ((schedule.id !== undefined && schedule.id !== day) || (schedule.date !== undefined && schedule.date !== day)) return unavailable('A escala não corresponde à data consultada.');
  const positions = schedule.positions;
  if (!Array.isArray(positions) || !positions.length || positions.length > 30) return unavailable('Posições da escala indisponíveis ou incompletas.');
  const ordered = [];
  for (const [index, item] of positions.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.position !== index + 1) return unavailable('A ordem das posições da escala precisa ser conferida.');
    const members = parseRotationSiglas(item.sigla, weekday);
    if (!members?.length) return unavailable('Há uma posição da escala sem sigla identificável.');
    ordered.push({position: index + 1, siglas: members});
  }
  const away = new Set();
  for (const vacation of vacations) {
    if (!vacation || typeof vacation !== 'object' || Array.isArray(vacation) || typeof vacation.active !== 'boolean' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(vacation.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(vacation.end || '') || vacation.start > vacation.end) {
      return unavailable('Há um período de férias que precisa ser conferido.');
    }
    if (!vacation.active || vacation.start > day || vacation.end < day) continue;
    if (!Array.isArray(vacation.siglas) || vacation.siglas.length > 30) return unavailable('Há férias sem uma lista de siglas válida.');
    for (const source of (vacation.siglas.length ? vacation.siglas : [vacation.label])) {
      const members = parseRotationSiglas(source, weekday, {list: true});
      if (!members?.length) return unavailable('Há férias sem siglas identificáveis.');
      members.forEach(member => away.add(member));
    }
  }
  if (schedule.vacationLabel !== undefined && schedule.vacationLabel !== '') {
    const legacy = parseRotationSiglas(schedule.vacationLabel, weekday, {list: true});
    if (legacy === null) return unavailable('O destaque de férias da escala precisa ser conferido.');
    legacy.forEach(member => away.add(member));
  }
  if (schedule.highlights !== undefined && (!schedule.highlights || typeof schedule.highlights !== 'object' || Array.isArray(schedule.highlights))) return unavailable('Os destaques da escala precisam ser conferidos.');
  const markers = schedule.highlights?.events === undefined ? [] : schedule.highlights.events;
  if (!Array.isArray(markers) || markers.length > 100) return unavailable('Os destaques de eventos estão incompletos.');
  const excluded = new Set(away);
  for (const marker of markers) {
    const members = parseRotationEvent(marker, weekday);
    if (members === null) return unavailable('Há um destaque de evento que precisa ser conferido.');
    members.forEach(member => excluded.add(member));
  }
  const position = ordered.find(item => item.siglas.some(member => !excluded.has(member)));
  if (!position) return {sigla: null, position: null, complete: true, reason: 'Nenhuma sigla disponível no rodízio desta escala.'};
  return {sigla: position.siglas.find(member => !excluded.has(member)), position: position.position, complete: true,
    reason: 'Primeira sigla disponível no rodízio da escala.'};
}
