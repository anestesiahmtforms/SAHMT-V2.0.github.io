// Temporary release for common users. Administrative maintenance keeps its
// existing authorization; this gate grants no backend role or permission.
export function canUseGovernanceHub(session) {
  return session?.status === 'signed-in' && !!session.user?.uid && session.profile?.active === true && session.profile?.access === true;
}
export function canUseManagementPilot(session) {
  const user=session?.user,profile=session?.profile;
  if(session?.status!=='signed-in'||!user?.uid||profile?.active!==true||profile?.access!==true)return false;
  if(profile.role==='administrador_app'||profile.permissions?.admin===true)return true;
  return user.emailVerified===true&&String(user.email||'').trim().toLowerCase()==='wx2901@gmail.com'
    &&profile.uid===user.uid&&String(profile.email||'').trim().toLowerCase()==='wx2901@gmail.com';
}
