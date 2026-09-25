import {stationIsInDateRange} from './checklist-qr.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function checklistDayMode(day, today) {
  if (!ISO_DAY.test(day || '') || !ISO_DAY.test(today || '')) return 'invalid';
  if (day > today) return 'future';
  return day === today ? 'today' : 'history';
}

export function resolveChecklistDayRecord(station, currentRecord, priorRecord, day, today) {
  if (currentRecord) return currentRecord;
  if (checklistDayMode(day, today) === 'future' || checklistDayMode(day, today) === 'invalid') return null;
  if (station?.active !== true || priorRecord?.condition !== 'NAO') return null;
  return priorRecord ? {...priorRecord, inherited: true} : null;
}

export function summarizeChecklistDay(day, today, stations, records) {
  const mode = checklistDayMode(day, today);
  if (mode === 'invalid' || mode === 'future') {
    return {mode, text: mode === 'future' ? 'Data futura' : 'Data inválida', total: 0, recorded: 0, pendingSync: false};
  }
  const applicableIds = new Set(stations.filter((station) => stationIsInDateRange(station, day)).map((station) => station.id));
  const latestByStation = new Map();
  for (const record of records) if (record.date === day && applicableIds.has(record.stationId) && !latestByStation.has(record.stationId)) latestByStation.set(record.stationId, record);
  const values = [...latestByStation.values()];
  const total = applicableIds.size;
  const recorded = values.length;
  const conforming = values.filter((record) => record.condition === 'SIM').length;
  const nonconforming = values.filter((record) => record.condition === 'NAO').length;
  const inherited = values.filter((record) => record.inherited === true).length;
  const text = !total
    ? 'Sem estações aplicáveis'
    : `${recorded}/${total} estação(ões) · ${conforming} conforme(s) · ${nonconforming} não conforme(s)${inherited ? ` · ${inherited} falha(s) herdada(s)` : ''}${recorded === total ? ' · assinatura não habilitada' : ''}`;
  return {mode, text, total, recorded, conforming, nonconforming, inherited, pendingSync: values.some((record) => record.pendingSync || record.syncFailed)};
}

function recordTime(record) {
  const value = record?.createdAt;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function summarizeChecklistMonth(month, today, stations, records, priorRecords = []) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('Informe um mês válido para o checklist.');
  const [year, monthNumber] = month.split('-').map(Number);
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const lastByStation = new Map();
  for (const record of priorRecords) {
    const current = lastByStation.get(record.stationId);
    if (!current || record.date > current.date || (record.date === current.date && recordTime(record) > recordTime(current))) {
      lastByStation.set(record.stationId, record);
    }
  }
  const currentByDay = new Map();
  for (const record of records) {
    const day = String(record.date || '');
    if (day < `${month}-01` || day > `${month}-${String(dayCount).padStart(2, '0')}` || day > today) continue;
    if (!currentByDay.has(day)) currentByDay.set(day, new Map());
    const byStation = currentByDay.get(day);
    const current = byStation.get(record.stationId);
    if (!current || recordTime(record) > recordTime(current)) byStation.set(record.stationId, record);
  }
  const days = [];
  for (let index = 1; index <= dayCount; index++) {
    const day = `${month}-${String(index).padStart(2, '0')}`;
    const current = currentByDay.get(day) || new Map();
    for (const record of current.values()) lastByStation.set(record.stationId, record);
    const dayRecords = [...current.values()];
    let inherited = 0;
    if (day <= today) {
      for (const station of stations) {
        if (current.has(station.id) || station.active !== true || !stationIsInDateRange(station, day)) continue;
        const previous = lastByStation.get(station.id);
        if (previous?.condition === 'NAO') {
          dayRecords.push({...previous, date: day, inherited: true});
          inherited++;
        }
      }
    }
    const summary = summarizeChecklistDay(day, today, stations, dayRecords);
    days.push({...summary, day, inherited});
  }
  return days;
}
