// Display-only join. Never writes a user's profile, role or permissions.
export function updateUsersWithContactSiglas(users,contacts) {
  const aliases=new Map();
  for(const contact of contacts){
    const email=String(contact.email||'').trim().toLowerCase(),sigla=String(contact.sigla||'').trim().toUpperCase();
    if(contact.active===false||!email||!sigla)continue;
    if(!aliases.has(email))aliases.set(email,new Set());aliases.get(email).add(sigla);
  }
  return users.map(user=>{
    if(String(user.sigla||'').trim())return user;
    const choices=aliases.get(String(user.email||'').trim().toLowerCase());
    return choices?.size===1?{...user,sigla:[...choices][0]}:user;
  });
}
