import {assignedInstitutionalGroup} from '../src/institutional-group.js';
import {isValidDateKey} from '../src/schedule-date.js';

// Nationwide dates in the federal calendar, excluding optional observances.
const nationalFixedHolidays = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

function goodFridayKey(year) {
  // Gregorian Easter (Meeus/Jones/Butcher), then subtract two days.
  const golden = year % 19;
  const century = Math.floor(year / 100);
  const withinCentury = year % 100;
  const leapCorrection = Math.floor(century / 4);
  const lunarCorrection = Math.floor((century - Math.floor((century + 8) / 25) + 1) / 3);
  const paschalMoon = (19 * golden + century - leapCorrection - lunarCorrection + 15) % 30;
  const weekday = (32 + 2 * (century % 4) + 2 * Math.floor(withinCentury / 4) - paschalMoon - withinCentury % 4) % 7;
  const correction = Math.floor((golden + 11 * paschalMoon + 22 * weekday) / 451);
  const monthAndDay = paschalMoon + weekday - 7 * correction + 114;
  const friday = new Date(0);
  friday.setUTCFullYear(year, Math.floor(monthAndDay / 31) - 1, monthAndDay % 31 - 1);
  return friday.toISOString().slice(0, 10);
}

export function checklistScoringDayExemption(day) {
  if (!isValidDateKey(day)) throw new Error('FG_PERFORMANCE_DAY_INVALID');
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  if (weekday === 0 || weekday === 6) return 'WEEKEND';
  if (nationalFixedHolidays.includes(day.slice(5)) || goodFridayKey(Number(day.slice(0, 4))) === day) return 'NATIONAL_HOLIDAY';
  return null;
}

function validProfile(profile) {
  return typeof profile?.uid === 'string' && /^[^\s/]{1,128}$/.test(profile.uid) &&
    typeof profile.email === 'string' && profile.email.length > 0 &&
    profile.active === true && profile.access === true;
}

/** Plan only from a server-validated acknowledgement and scheduled identity.
 * The caller commits the daily receipt and both entries in one transaction.
 */
export function planChecklistDailyPerformance({day,signatureId,signer,scheduled,assignment,previous=null}) {
  if (!isValidDateKey(day)) throw new Error('FG_PERFORMANCE_DAY_INVALID');
  if (typeof signatureId !== 'string' || !/^[^\s/]{1,200}$/.test(signatureId)) throw new Error('FG_PERFORMANCE_SIGNATURE_INVALID');
  if (!validProfile(signer)) throw new Error('FG_SIGNER_INVALID');
  if (!validProfile(scheduled)) throw new Error('FG_SCHEDULED_USER_REQUIRED');

  const identity = {day,signatureId,signerUid:signer.uid,scheduledUid:scheduled.uid};
  if (previous) {
    if (previous.schemaVersion !== 1 || Object.entries(identity).some(([key,value])=>previous[key]!==value)) {
      throw new Error('FG_DAILY_PERFORMANCE_ALREADY_SETTLED');
    }
    return {changed:false,receipt:previous,entries:[]};
  }

  const exemption = checklistScoringDayExemption(day);
  if (exemption) return {changed:true,receipt:{schemaVersion:1,...identity,outcome:'NON_SCORING_DAY',exemption,rule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2'},entries:[]};

  let outcome = 'SCHEDULED_USER_ACKNOWLEDGEMENT';
  const entries = [];
  if (signer.uid !== scheduled.uid) {
    if (assignment?.schemaVersion !== 1 || assignment.identityStatus !== 'LINKED' ||
        assignment.uid !== signer.uid || assignment.email !== signer.email.trim().toLowerCase()) {
      throw new Error('FG_TEAM_IDENTITY_UNVERIFIED');
    }
    outcome = 'AUTHOR_OUTSIDE_TEAM';
    if (assignedInstitutionalGroup(assignment, signer) === 'team') {
      outcome = 'TRANSFER';
      entries.push(
        {id:day+'_credit',uid:signer.uid,points:1,day,signatureId},
        {id:day+'_debit',uid:scheduled.uid,points:-1,day,signatureId}
      );
    }
  }

  return {
    changed:true,
    receipt:{schemaVersion:1,...identity,outcome,rule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2'},
    entries
  };
}

/** The trusted caller closes the day at 23:59:00 in São Paulo. */
export function planChecklistDailyAbsence({day,closedThroughDay,eligibleFromDay,scheduled,previous=null,acknowledgementPresent=false}) {
  if (![day,closedThroughDay,eligibleFromDay].every(isValidDateKey)) throw new Error('FG_PERFORMANCE_DAY_INVALID');
  if (day > closedThroughDay) throw new Error('FG_DAY_NOT_CLOSED');
  if (day < eligibleFromDay) throw new Error('FG_DAY_OUTSIDE_RELEASE');
  if (previous) {
    if (previous.schemaVersion!==1||previous.day!==day) throw new Error('FG_DAILY_PERFORMANCE_ALREADY_SETTLED');
    return {changed:false,receipt:previous,entries:[]};
  }
  if (acknowledgementPresent) return {changed:false,receipt:null,entries:[]};
  if (checklistScoringDayExemption(day)) return {changed:false,receipt:null,entries:[]};
  if (!validProfile(scheduled)) throw new Error('FG_SCHEDULED_USER_REQUIRED');
  return {changed:true,receipt:{schemaVersion:1,day,signatureId:null,signerUid:null,scheduledUid:scheduled.uid,
    outcome:'NO_ACKNOWLEDGEMENT',rule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2'},
    entries:[{id:day+'_debit',uid:scheduled.uid,points:-1,day,signatureId:null,reason:'NO_ACKNOWLEDGEMENT'}]};
}
