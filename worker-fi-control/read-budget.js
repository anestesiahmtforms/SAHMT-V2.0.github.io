import {FI_PROJECTS,fiError} from './store.js';
const day=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
export function createFiReadBudget({store,now=Date.now,limit=10000}){
 const settled=new WeakSet(),issued=new WeakSet();
 if(!Number.isSafeInteger(limit)||limit<1)throw fiError('FI_BUDGET_CONFIG_INVALID');
 return {async reserve(project,maximum){
  if(!Object.values(FI_PROJECTS).includes(project)||!Number.isInteger(maximum)||maximum<1||maximum>2001)throw fiError('FI_BUDGET_INPUT_INVALID',400);
  const key=`${day(now)}_${project}`;
  await store.transaction(async tx=>{const old=await tx.get('fiSourceBudgets',key),used=old?.used||0;if(used+maximum>limit)throw fiError('FI_SOURCE_READ_BUDGET',429);tx.set('fiSourceBudgets',key,{used:used+maximum,project,updatedAt:now()});});
  const ticket=Object.freeze({key,project,maximum});issued.add(ticket);return ticket;
 },async settle(ticket,count){
  if(!issued.has(ticket)||settled.has(ticket))return;settled.add(ticket);
  if(!Number.isInteger(count)||count<0||count>ticket.maximum)return;
  const refund=ticket.maximum-Math.max(1,count);if(!refund)return;
  await store.transaction(async tx=>{const old=await tx.get('fiSourceBudgets',ticket.key);if(old)tx.set('fiSourceBudgets',ticket.key,{...old,used:Math.max(0,old.used-refund),updatedAt:now()});});
 }};
}
export function createFiRequestQuota({store,now=Date.now,dailyLimit=200,userLimit=20}){
 if(![dailyLimit,userLimit].every(v=>Number.isSafeInteger(v)&&v>0))throw fiError('FI_BUDGET_CONFIG_INVALID');
 return {async consume(uid){
  if(typeof uid!=='string'||!uid)throw fiError('FI_ACTOR_REQUIRED',401);
  const today=day(now),globalKey=`${today}_all`,userKey=`${today}_${await hash(uid)}`;
  await store.transaction(async tx=>{const global=await tx.get('fiControlQuotas',globalKey),user=await tx.get('fiControlQuotas',userKey);if((global?.used||0)>=dailyLimit||(user?.used||0)>=userLimit)throw fiError('FI_DAILY_REQUEST_LIMIT',429);tx.set('fiControlQuotas',globalKey,{used:(global?.used||0)+1,updatedAt:now()});tx.set('fiControlQuotas',userKey,{used:(user?.used||0)+1,updatedAt:now()});});
 }};
}
