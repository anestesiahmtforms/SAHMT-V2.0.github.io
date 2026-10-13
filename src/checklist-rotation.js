import {isValidDateKey} from './schedule-date.js';
import {resolveChecklistRotationCore} from './checklist-rotation-core.js';

function unavailable(reason) {
  return {name: null, sigla: null, position: null, complete: false, reason};
}

/** Informative rotation only. This does not decide or authorize Checklist confirmation. */
export function resolveChecklistRotation({schedule = null, day, vacations = [], directory = [], truncated = false} = {}) {
  if (!isValidDateKey(day)) return unavailable('Data inválida para conferir o rodízio da escala.');
  const selection = resolveChecklistRotationCore({schedule, day, vacations, truncated});
  if (!selection.complete) return unavailable(selection.reason);
  if (!selection.sigla) return {name: null, sigla: null, position: null, complete: true, reason: selection.reason};
  if (!Array.isArray(directory) || directory.length > 200) return unavailable('O nome da escala precisa ser conferido.');
  const matches = directory.filter(record => record?.id === selection.sigla || record?.sigla === selection.sigla);
  if (matches.length > 1) return unavailable('Há mais de um nome para a sigla da escala.');
  const record = matches[0];
  if (record && (record.id !== selection.sigla || record.sigla !== selection.sigla || typeof record.active !== 'boolean' ||
    typeof record.name !== 'string' || !record.name.trim() || record.name.length > 120)) {
    return unavailable('O nome da sigla da escala precisa ser conferido.');
  }
  // Inactive directory entries remain useful as names for a published schedule.
  // Reading the name never reactivates the entry or grants access.
  return {name: record?.name.trim() || null, sigla: selection.sigla, position: selection.position, complete: true,
    reason: record ? 'Primeira sigla disponível no rodízio da escala.' : 'Nome indisponível no diretório da escala.'};
}
