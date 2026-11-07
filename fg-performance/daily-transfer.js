import {assignedInstitutionalGroup} from '../src/institutional-group.js';
import {isValidDateKey} from '../src/schedule-date.js';

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
  if (!validProfile(scheduled)) throw new Error('FG_SCHEDULED_USER_REQUIRED');
  return {changed:true,receipt:{schemaVersion:1,day,signatureId:null,signerUid:null,scheduledUid:scheduled.uid,
    outcome:'NO_ACKNOWLEDGEMENT',rule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2'},
    entries:[{id:day+'_debit',uid:scheduled.uid,points:-1,day,signatureId:null,reason:'NO_ACKNOWLEDGEMENT'}]};
}
