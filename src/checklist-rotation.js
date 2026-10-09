import {isValidDateKey} from './schedule-date.js';
import {resolveScheduleSiglas, weekdayForDate} from './schedule-view.js';

const TOKEN = /^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,200}$/;

function unavailable(reason) {
  return {name: null, sigla: null, position: null, complete: false, reason};
}

function siglas(value, weekday, {support = false, list = false} = {}) {
  if (typeof value !== 'string' || value.length > 240) return null;
  const token = value.split('(')[0].trim().toUpperCase();
  if (support && token === 'SUPORTE') return [];
  if (!token) return [];
  const tokens = list ? token.split(/[,;\s]+/) : [token];
  if (!tokens.every(item => TOKEN.test(item))) return null;
  return [...new Set(tokens.flatMap(item => resolveScheduleSiglas(item, weekday)))];
}

function eventSiglas(marker, weekday) {
  if (typeof marker !== 'string' || !marker.trim() || marker.length > 400) return null;
  const parts = marker.trim().split(':');
  if (parts.length === 1) return siglas(parts[0], weekday, {support: true});
  if (parts[0].toUpperCase() !== 'EVENTO' || parts.length < 2 || parts.length > 4) return null;
  const scheduled = siglas(parts[1], weekday, {support: true});
  if (scheduled === null || !parts[1].trim()) return null;
  if (parts.length === 2) return scheduled;
  if (!EVENT_ID.test(parts[parts.length - 1])) return null;
  if (parts.length === 3 || parts[1].trim().toUpperCase() === 'SUPORTE') return scheduled;
  const member = parts[2].trim().toUpperCase();
  if (member === '-') return scheduled;
  if (!member) return null;
  // Current markers identify the highlighted member of a composite position.
  // Legacy markers without a member conservatively exclude the whole position.
  return siglas(member, weekday, {support: true});
}

/** Informative rotation only. This does not decide or authorize Checklist confirmation. */
export function resolveChecklistRotation({schedule = null, day, vacations = [], directory = [], truncated = false} = {}) {
  if (!isValidDateKey(day)) return unavailable('Data inválida para conferir o rodízio da escala.');
  if (truncated || !Array.isArray(vacations) || vacations.length > 100) return unavailable('Aguardando a conferência completa das férias.');
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return unavailable('Escala não disponível para esta data.');
  if ((schedule.id !== undefined && schedule.id !== day) || (schedule.date !== undefined && schedule.date !== day)) {
    return unavailable('A escala não corresponde à data consultada.');
  }
  const positions = schedule.positions;
  if (!Array.isArray(positions) || !positions.length || positions.length > 30) return unavailable('Posições da escala indisponíveis ou incompletas.');
  const weekday = weekdayForDate(day);
  const ordered = [];
  for (const [index, item] of positions.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.position !== index + 1) {
      return unavailable('A ordem das posições da escala precisa ser conferida.');
    }
    const members = siglas(item.sigla, weekday);
    if (!members?.length) return unavailable('Há uma posição da escala sem sigla identificável.');
    ordered.push({position: index + 1, siglas: members});
  }
  const away = new Set();
  for (const vacation of vacations) {
    if (!vacation || typeof vacation !== 'object' || Array.isArray(vacation) || typeof vacation.active !== 'boolean' ||
      !isValidDateKey(vacation.start) || !isValidDateKey(vacation.end) || vacation.start > vacation.end) {
      return unavailable('Há um período de férias que precisa ser conferido.');
    }
    if (!vacation.active || vacation.start > day || vacation.end < day) continue;
    if (!Array.isArray(vacation.siglas) || vacation.siglas.length > 30) return unavailable('Há férias sem uma lista de siglas válida.');
    const sources = vacation.siglas.length ? vacation.siglas : [vacation.label];
    for (const source of sources) {
      const members = siglas(source, weekday, {list: true});
      if (!members?.length) return unavailable('Há férias sem siglas identificáveis.');
      members.forEach(member => away.add(member));
    }
  }
  if (schedule.vacationLabel !== undefined && schedule.vacationLabel !== '') {
    const legacy = siglas(schedule.vacationLabel, weekday, {list: true});
    if (legacy === null) return unavailable('O destaque de férias da escala precisa ser conferido.');
    legacy.forEach(member => away.add(member));
  }
  if (schedule.highlights !== undefined && (!schedule.highlights || typeof schedule.highlights !== 'object' || Array.isArray(schedule.highlights))) {
    return unavailable('Os destaques da escala precisam ser conferidos.');
  }
  const markers = schedule.highlights?.events === undefined ? [] : schedule.highlights.events;
  if (!Array.isArray(markers) || markers.length > 100) return unavailable('Os destaques de eventos estão incompletos.');
  const excluded = new Set(away);
  for (const marker of markers) {
    const members = eventSiglas(marker, weekday);
    if (members === null) return unavailable('Há um destaque de evento que precisa ser conferido.');
    members.forEach(member => excluded.add(member));
  }
  const position = ordered.find(item => item.siglas.some(member => !excluded.has(member)));
  if (!position) return {name: null, sigla: null, position: null, complete: true, reason: 'Nenhuma sigla disponível no rodízio desta escala.'};
  const selectedSigla = position.siglas.find(member => !excluded.has(member));
  if (!Array.isArray(directory) || directory.length > 200) return unavailable('O nome da escala precisa ser conferido.');
  const matches = directory.filter(record => record?.id === selectedSigla || record?.sigla === selectedSigla);
  if (matches.length > 1) return unavailable('Há mais de um nome para a sigla da escala.');
  const record = matches[0];
  if (record && (record.id !== selectedSigla || record.sigla !== selectedSigla || typeof record.active !== 'boolean' ||
    typeof record.name !== 'string' || !record.name.trim() || record.name.length > 120)) {
    return unavailable('O nome da sigla da escala precisa ser conferido.');
  }
  // Inactive directory entries remain useful as names for a published schedule.
  // Reading the name never reactivates the entry or grants access.
  return {name: record?.name.trim() || null, sigla: selectedSigla, position: position.position, complete: true,
    reason: record ? 'Primeira sigla disponível no rodízio da escala.' : 'Nome indisponível no diretório da escala.'};
}
