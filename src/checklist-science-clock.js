const clock=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function isChecklistScienceOpen(day,now=new Date()){
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))return false;
  const parts=Object.fromEntries(clock.formatToParts(now).map(part=>[part.type,part.value]));
  return day===parts.year+'-'+parts.month+'-'+parts.day&&(Number(parts.hour)<23||Number(parts.minute)<59);
}
