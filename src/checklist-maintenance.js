export const CHECKLIST_MAINTENANCE_FIELDS = Object.freeze(['preventiveAnnual', 'electricalAnnual', 'calibrationSemiannual']);

function isIsoDay(value) {
  if (typeof value !== 'string' || value.startsWith('0000-') || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function normalizeChecklistMaintenance(value) {
  return Object.fromEntries(CHECKLIST_MAINTENANCE_FIELDS.map((key) => [key,
    value && typeof value === 'object' && typeof value[key] === 'string' ? value[key].trim() : ''
  ]));
}

export function checklistMaintenanceOverdue(value, today) {
  const dates = normalizeChecklistMaintenance(value);
  return Object.fromEntries(CHECKLIST_MAINTENANCE_FIELDS.map((key) => [key,
    isIsoDay(today) && isIsoDay(dates[key]) && dates[key] < today
  ]));
}

export function checklistMaintenanceForWrite(value) {
  // Preserve the text schema already used by earlier versions of the PWA.
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length > 1000) throw new Error('Limite a manutenção a 1000 caracteres.');
    return text;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== CHECKLIST_MAINTENANCE_FIELDS.length ||
      !CHECKLIST_MAINTENANCE_FIELDS.every((key) => Object.hasOwn(value, key) && typeof value[key] === 'string')) {
    throw new Error('Confira os três campos de data da manutenção.');
  }
  const dates = normalizeChecklistMaintenance(value);
  if (Object.values(dates).some((day) => day !== '' && !isIsoDay(day))) {
    throw new Error('Informe datas válidas para a manutenção.');
  }
  return dates;
}