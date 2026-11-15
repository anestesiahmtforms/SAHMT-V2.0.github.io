const TIME_ZONE = 'America/Sao_Paulo';
const dayFormatter = new Intl.DateTimeFormat('pt-BR', {timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric'});
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const secondsFormatter = new Intl.DateTimeFormat('pt-BR', {timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});

function displayValue(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  try {
    let raw = typeof value?.toDate === 'function' ? value.toDate() : typeof value?.toMillis === 'function' ? value.toMillis() : value;
    if (raw && typeof raw === 'object' && !(raw instanceof Date)) {
      const seconds = raw.seconds ?? raw._seconds;
      const nanoseconds = raw.nanoseconds ?? raw._nanoseconds ?? 0;
      if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9) return null;
      raw = seconds * 1000 + nanoseconds / 1e6;
    }
    const date = raw instanceof Date ? raw : new Date(raw);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch { return null; }
}

// Calendar keys represent a day, rather than midnight in the viewer's timezone.
function calendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = displayValue(value + 'T00:00:00Z');
  if (!date || date.toISOString().slice(0, 10) !== value) return '';
  const [year, month, day] = value.split('-');
  return day + '/' + month + '/' + year;
}

// Legacy Drive strings are Sao Paulo wall time. Validate and format them
// lexically so browser timezone and US date parsing cannot change their day.
function brazilianDisplay(value) {
  if (typeof value !== 'string' || !value.includes('/')) return null;
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,? (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?)?$/);
  if (!match) return {invalid: true};
  const [, day, month, year, hour, minute, second] = match;
  const date = calendarDay(year + '-' + month + '-' + day);
  if (!date || (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second || 0) > 59))) return {invalid: true};
  return {date, time: hour === undefined ? '' : hour + ':' + minute, second: second || '00'};
}

export function formatDisplayDate(value, {fallback = ''} = {}) {
  const brazilian = brazilianDisplay(value);
  if (brazilian) return brazilian.invalid ? fallback : brazilian.date;
  const day = calendarDay(value);
  if (day !== null) return day || fallback;
  const date = displayValue(value);
  return date ? dayFormatter.format(date) : fallback;
}

export function formatDisplayDateTime(value, {fallback = '', seconds = false} = {}) {
  const brazilian = brazilianDisplay(value);
  if (brazilian) {
    if (brazilian.invalid) return fallback;
    return brazilian.date + (brazilian.time ? ', ' + brazilian.time + (seconds ? ':' + brazilian.second : '') : '');
  }
  const day = calendarDay(value);
  if (day !== null) return day || fallback;
  const date = displayValue(value);
  return date ? dayFormatter.format(date) + ', ' + (seconds ? secondsFormatter : timeFormatter).format(date) : fallback;
}
