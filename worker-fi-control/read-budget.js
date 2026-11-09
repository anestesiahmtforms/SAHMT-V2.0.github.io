import {FI_PROJECTS,fiError} from './store.js';
const day=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
export function createFiReadBudget({store,now=Date.now,limit=10000}){
 if(!Number.isSafeInteger(limit)||limit<1)throw fiError('FI_BUDGET_CONFIG_INVALID');
 return {async open(maximumByProject){
  const planned=Object.entries(maximumByProject);
  if(planned.some(([project,maximum])=>!Object.values(FI_PROJECTS).includes(project)||!Number.isInteger(maximum)||maximum<1||maximum>2001))throw fiError('FI_BUDGET_INPUT_INVALID',400);
  const key=day(now);
  const reserved=await store.transaction(async tx=>{
   const old=await tx.get('fiSourceBudgets',key),totals={...old?.totals},allowed={};
   for(const [project,maximum] of planned){
    const used=totals[project]||0;
    // Individual reads still have to fit in the lease. A source can use the remaining
    // daily allowance even when it cannot reserve its entire worst-case read plan.
    const available=Math.min(maximum,limit-used);
    if(available>0){totals[project]=used+available;allowed[project]=available;}
   }
   if(Object.keys(allowed).length)tx.set('fiSourceBudgets',key,{totals,updatedAt:now()});
   return allowed;
  });
  const remaining={...reserved},issued=new WeakSet(),settled=new WeakSet();
  let closed=false;
  return {
   reserve(project,maximum){
    if(closed||!Number.isInteger(maximum)||maximum<1||!(remaining[project]>=maximum))throw fiError('FI_SOURCE_READ_BUDGET',429);
    remaining[project]-=maximum;
    const ticket=Object.freeze({project,maximum});issued.add(ticket);return ticket;
   },
   settle(ticket,count){
    if(closed||!issued.has(ticket)||settled.has(ticket))return;
    settled.add(ticket);
    if(Number.isInteger(count)&&count>=0&&count<=ticket.maximum)remaining[ticket.project]+=ticket.maximum-Math.max(1,count);
   },
   async finish(){
    if(closed)return;
    closed=true;
    if(!Object.values(remaining).some(Boolean))return;
    await store.transaction(async tx=>{
     const old=await tx.get('fiSourceBudgets',key);
     if(!old)return;
     const totals={...old.totals};
     for(const [project,refund] of Object.entries(remaining))totals[project]=Math.max(0,totals[project]-refund);
     tx.set('fiSourceBudgets',key,{totals,updatedAt:now()});
    });
   }
  };
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
