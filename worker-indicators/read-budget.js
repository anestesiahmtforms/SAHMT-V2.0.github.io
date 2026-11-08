export const SOURCE_READ_LIMITS=Object.freeze({FA:6000,FB:6000,FC:6000,FD:6000,FE:6000,FG:6000,FH:6000,FJ:6000});
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
export function billingDay(now){const p=formatter.formatToParts(now);return ['year','month','day'].map(k=>p.find(v=>v.type===k).value).join('-');}
export function createSourceReadBudget({store,now=Date.now,limits=SOURCE_READ_LIMITS}){
 const effective={...SOURCE_READ_LIMITS,...limits};
 async function reserve(project,requested){
  if(!Object.hasOwn(effective,project)||!Number.isSafeInteger(requested)||requested<1||requested>6000)throw Error('INDICATOR_READ_RESERVATION_INVALID');
  const day=billingDay(now()),id=project+'_'+day,limit=effective[project];
  return store.transaction(async tx=>{const old=await tx.get('indicatorReadBudgets',id),used=old?.chargedReads||0;
   if(!Number.isSafeInteger(used)||used<0)throw Error('INDICATOR_READ_BUDGET_INVALID');
   const count=Math.min(requested,limit-used);if(count<1)throw Error('INDICATOR_SOURCE_BUDGET_EXHAUSTED');
   tx.set('indicatorReadBudgets',id,{project,day,limit,chargedReads:used+count,confirmedReads:old?.confirmedReads||0,requestsReserved:(old?.requestsReserved||0)+1,updatedAt:now()});return {project,id,count,settled:false};
  });
 }
 async function settle(ticket,actual){
  if(ticket.settled)return;if(!Number.isSafeInteger(actual)||actual<1||actual>ticket.count)throw Error('INDICATOR_READ_SETTLEMENT_INVALID');ticket.settled=true;
  if(store.finishReadReservation)return store.finishReadReservation(ticket.id,ticket.count,actual);
  await store.transaction(async tx=>{const old=await tx.get('indicatorReadBudgets',ticket.id);if(!old||old.chargedReads<ticket.count)throw Error('INDICATOR_READ_BUDGET_INVALID');tx.set('indicatorReadBudgets',ticket.id,{...old,chargedReads:old.chargedReads-ticket.count+actual,confirmedReads:old.confirmedReads+actual,updatedAt:now()});});
 }
 async function describe(){const day=billingDay(now());return Promise.all(Object.keys(effective).map(async project=>{const d=await store.get('indicatorReadBudgets',project+'_'+day);return {project,day,limit:effective[project],estimatedReads:d?.chargedReads||0,confirmedReads:d?.confirmedReads||0};}));}
 return {reserve,settle,describe};
}
