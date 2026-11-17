import {isValidDateKey} from '../src/schedule-date.js';

const SAO_PAULO = 'America/Sao_Paulo';
const NATIONAL_HOLIDAYS = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']);

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isNationalHoliday(day) {
  if (!isValidDateKey(day)) return false;
  const [, month, date] = day.split('-');
  if (NATIONAL_HOLIDAYS.has(`${month}-${date}`)) return true;
  const [year] = day.split('-').map(Number);
  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  return goodFriday.toISOString().slice(0, 10) === day;
}

export function checklistConferenceWindow(timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date(timestamp)).map(({type, value}) => [type, value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (parts.hour !== '08' || !isValidDateKey(day) || ['Sat', 'Sun'].includes(parts.weekday) || isNationalHoliday(day)) return null;
  return day;
}
