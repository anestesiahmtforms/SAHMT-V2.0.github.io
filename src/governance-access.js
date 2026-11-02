export function governanceSessionReady(session){
 const u=session?.user,p=session?.profile;
 return Boolean(session?.status==='signed-in'&&u?.uid&&u.emailVerified===true&&p?.uid===u.uid&&p.active===true&&p.access===true&&typeof u.email==='string'&&u.email.trim()&&p.email?.trim().toLowerCase()===u.email.trim().toLowerCase());
}
