// Fixed upper reservation: 48 KB request + framing allowance and 4096 output
// tokens at gpt-6-luna Standard USD 0.10/M input and 0.50/M output.
// Unknown usage retains the full reservation, including network/parse failures.
export const RESERVATION_MICROS=8000;
export function createAiBudget({store,now,config={}}) {
 const limit=Number.isSafeInteger(config.monthlyBudgetMicros)&&config.monthlyBudgetMicros>0?config.monthlyBudgetMicros:0;
 const quota=Number.isSafeInteger(config.dailyUserLimit)&&config.dailyUserLimit>0?Math.min(config.dailyUserLimit,100):30;
 return {
  async reserve(uid){
   if(!limit)return null;
   const timestamp=now(), day=new Date(timestamp).toISOString().slice(0,10),month=day.slice(0,7),id=crypto.randomUUID(),quotaId=`${day}_${encodeURIComponent(uid)}`;
   return store.transaction(async tx=>{
    const budget=await tx.get('fiAiBudget',month),daily=await tx.get('fiAiQuota',quotaId);
    const committed=budget?.committedMicros??0,count=daily?.count??0;
    if(!Number.isSafeInteger(committed)||committed<0||!Number.isSafeInteger(count)||count<0||committed+RESERVATION_MICROS>limit||count>=quota)return null;
    await tx.set('fiAiBudget',month,{committedMicros:committed+RESERVATION_MICROS,updatedAt:timestamp});
    await tx.set('fiAiQuota',quotaId,{count:count+1,updatedAt:timestamp});
    await tx.create('fiAiReservations',id,{month,reservedMicros:RESERVATION_MICROS,status:'reserved',createdAt:timestamp});
    return {id,month};
   });
  },
  async settle(reservation,usage){
   if(!reservation||!Number.isSafeInteger(usage?.inputTokens)||!Number.isSafeInteger(usage?.outputTokens)||usage.inputTokens<0||usage.outputTokens<0)return;
   const cost=Math.ceil(usage.inputTokens*0.1+usage.outputTokens*0.5);
   await store.transaction(async tx=>{
    const entry=await tx.get('fiAiReservations',reservation.id),budget=await tx.get('fiAiBudget',reservation.month);
    if(entry?.status!=='reserved'||!budget)return;
    await tx.set('fiAiBudget',reservation.month,{...budget,committedMicros:Math.max(0,budget.committedMicros-entry.reservedMicros+cost),updatedAt:now()});
    await tx.set('fiAiReservations',reservation.id,{...entry,status:'settled',actualMicros:cost,updatedAt:now()});
   });
  }
 };
}
