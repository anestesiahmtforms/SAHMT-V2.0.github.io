import {canUseYearEndSchedule} from './year-end-schedule.js';
export {canUseYearEndSchedule};
// Team members can enter the hub for the year-end schedule. Each other panel
// keeps its own existing authorization; this gate grants no backend permission.
export function canUseGovernanceHub(session) {
  return canUseManagementPilot(session) || canUseYearEndSchedule(session);
}
export function canUseManagementPilot(session) {
  const user=session?.user,profile=session?.profile;
  if(session?.status!=='signed-in'||!user?.uid||profile?.active!==true||profile?.access!==true)return false;
  if(profile.role==='administrador_app'||profile.permissions?.admin===true)return true;
  return user.emailVerified===true&&String(user.email||'').trim().toLowerCase()==='wx2901@gmail.com'
    &&profile.uid===user.uid&&String(profile.email||'').trim().toLowerCase()==='wx2901@gmail.com';
}
