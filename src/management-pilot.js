import {governanceSessionReady} from './governance-access.js';
import {canUseYearEndSchedule} from './year-end-schedule.js';
export {canUseYearEndSchedule};
// Governance is available to every approved identity; each destination has its own gate.
export function canUseGovernanceHub(session) {
  return governanceSessionReady(session);
}
export function canUseManagementPilot(session) {
  const user=session?.user,profile=session?.profile;
  if(session?.status!=='signed-in'||!user?.uid||profile?.active!==true||profile?.access!==true)return false;
  if(profile.role==='administrador_app'||profile.permissions?.admin===true)return true;
  return user.emailVerified===true&&String(user.email||'').trim().toLowerCase()==='wx2901@gmail.com'
    &&profile.uid===user.uid&&String(profile.email||'').trim().toLowerCase()==='wx2901@gmail.com';
}
