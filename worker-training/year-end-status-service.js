import {assignedInstitutionalGroup,institutionalAssignmentKey} from '../src/institutional-group.js';
import {yearEndOwnParticipation,confirmedYearEndRegistration} from '../src/year-end-schedule.js';
const fail=(code,status)=>{throw Object.assign(Error(code),{code,status});};

// Read-only own status. FA authenticates the caller; FE remains the authority
// for membership and completed choices. No secondary browser session is needed.
export function createYearEndStatusService({store}) {
  return {async execute(action,input,identity) {
    if(action!=='STATUS'||!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)fail('YEAR_END_INPUT_INVALID',400);
    if(!identity?.uid||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(identity.uid)||identity.emailVerified!==true||identity.provider!=='google.com'||typeof identity.email!=='string')fail('YEAR_END_UNAUTHENTICATED',401);
    const uid=identity.uid,email=identity.email.trim().toLowerCase();
    const [profile,category]=await Promise.all([store.get('users',uid),store.get('userCategories',await institutionalAssignmentKey(email))]);
    if(!profile||profile.uid!==uid||profile.email?.trim().toLowerCase()!==email||profile.active!==true||profile.access!==true)fail('YEAR_END_FORBIDDEN',403);
    if(category?.schemaVersion!==1||category.identityStatus!=='LINKED'||category.uid!==uid||category.email!==email)fail('YEAR_END_FORBIDDEN',403);
    if(assignedInstitutionalGroup(category,{uid,email})!=='team')return {eligible:false,completed:false};
    const [projection,registration]=await Promise.all([store.getYearEndRecord('participation',uid),store.getYearEndRecord('registrations',uid)]);
    let participation;try{participation=yearEndOwnParticipation(projection);}catch{fail('YEAR_END_POLICY_UNAVAILABLE',503);}
    return {eligible:true,completed:confirmedYearEndRegistration(registration,{...participation,uid})};
  }};
}
