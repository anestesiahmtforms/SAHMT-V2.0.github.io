import {resolveScheduleSiglas, weekdayForDate} from './schedule-view.js';
import {isValidDateKey} from './schedule-date.js';

function normalizePerson(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function dateSiglas(value, weekday) {
  return resolveScheduleSiglas(String(value || '').split('(')[0], weekday);
}

function eventMemberSiglas(value, contacts, weekday) {
  const member = normalizePerson(value);
  const named = contacts.filter((contact) => normalizePerson(contact.name) === member);
  if (named.length === 1 && named[0].sigla) return [String(named[0].sigla).toUpperCase()];
  if (named.length > 1) return null;
  const compact = String(value || '').trim().toUpperCase();
  if (/^(?:DC|L2|[A-Z]{2})(?:[/-](?:DC|L2|[A-Z]{2}))*$/.test(compact)) return dateSiglas(compact, weekday);
  return null;
}

/** Reproduces the V1 order/vacation/replacement calculation without granting access. */
export function resolveChecklistResponsibility({schedule = {}, day, vacations = [], events = [], contacts = [], profiles = []} = {}) {
  const weekday = weekdayForDate(day, schedule.weekdayLabel);
  if (!isValidDateKey(day) || !weekday) return {sigla: null, position: null, responsibleUid: null, name: null, email: null, reason: 'Data inválida.'};
  const positions = Array.isArray(schedule.assignments) ? schedule.assignments : Array.isArray(schedule.siglas) ? schedule.siglas : Array.isArray(schedule.positions) ? schedule.positions : [];
  if (!positions.length) return {sigla: null, position: null, responsibleUid: null, name: null, email: null, reason: 'Escala não disponível para esta data.'};

  const vacationSiglas = new Set(dateSiglas(schedule.vacationLabel, weekday));
  for (const vacation of vacations) {
    if (vacation.active === false || (vacation.start && vacation.start > day) || (vacation.end && vacation.end < day)) continue;
    const sources = Array.isArray(vacation.siglas) && vacation.siglas.length ? vacation.siglas : [vacation.label || ''];
    for (const sigla of sources.flatMap((item) => dateSiglas(item, weekday))) vacationSiglas.add(sigla);
  }

  const replaced = new Set();
  for (const event of events) {
    if (event.date !== day || event.active === false || !String(event.substitute || '').trim()) continue;
    const type = normalizePerson(event.eventType);
    const member = normalizePerson(event.memberStatus);
    if (type === 'ATRASO' || member === 'SUPORTE') continue;
    const siglas = eventMemberSiglas(event.memberStatus, contacts, weekday);
    if (!siglas) return {sigla: null, position: null, responsibleUid: null, name: null, email: null, reason: 'Há substituição sem membro identificável; confira o evento.'};
    siglas.forEach((sigla) => replaced.add(sigla));
  }

  let selected = null;
  for (const [index, item] of positions.entries()) {
    const token = typeof item === 'string' ? item : item?.sigla || item?.name || item?.label || '';
    const available = resolveScheduleSiglas(token, weekday).filter((sigla) => !vacationSiglas.has(sigla) && !replaced.has(sigla));
    if (available.length) { selected = {sigla: available[0], sourceSigla: String(token).trim().toUpperCase(), position: index + 1}; break; }
  }
  if (!selected) return {sigla: null, position: null, responsibleUid: null, name: null, email: null, reason: 'Nenhuma sigla disponível na escala diária.'};

  const matchedContacts = contacts.filter((contact) => String(contact.sigla || '').toUpperCase() === selected.sigla && contact.active !== false);
  const matchedProfiles = profiles.filter((profile) => String(profile.sigla || '').toUpperCase() === selected.sigla && typeof profile.uid === 'string' && profile.uid.length > 0);
  const contact = matchedContacts.length === 1 ? matchedContacts[0] : null;
  const profile = matchedProfiles.length === 1 ? matchedProfiles[0] : null;
  const uid = profile?.uid || null;
  return {
    ...selected,
    name: contact?.name || profile?.displayName || null,
    email: contact?.email || profile?.email || null,
    responsibleUid: uid,
    reason: uid ? 'Primeira sigla disponível na primeira posição disponível da escala.' : 'Sigla e posição identificadas; UID V2 único não disponível.'
  };
}
