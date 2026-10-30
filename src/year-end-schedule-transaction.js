import {yearEndError} from './year-end-schedule.js';
import {YEAR_END_TOTAL_KEYS,readYearEndTotals,changeYearEndTotals} from './year-end-schedule-totals.js';

// A bounded retry handles a counter advanced between the transaction snapshot
// and rules evaluation. Real permission failures are never retried blindly.
export async function writeYearEndChoices({api,db,ownRef,totalsRef,uid,sigla,choices,ensure}) {
  for(let attempt=0;attempt<8;attempt++) {
    let attemptedTotals=null;
    try {
      const result=await api.runTransaction(db,async tx=>{
        const prior=await tx.get(ownRef);ensure();
        const summary=await tx.get(totalsRef);ensure();
        if(!summary.exists())throw yearEndError('YEAR_END_SUMMARY_UNAVAILABLE');
        const totals=readYearEndTotals(summary.data());
        attemptedTotals=totals;
        const next=changeYearEndTotals(totals,prior.exists()?prior.data():null,choices),stamp=api.serverTimestamp();
        if(prior.exists()) {
          const record=prior.data();
          if(!Number.isSafeInteger(record.position)||record.position<1)throw yearEndError('YEAR_END_CORRUPT_ORDER');
          tx.set(totalsRef,{...next,updatedAt:stamp});
          tx.update(ownRef,{...choices,sigla,updatedAt:stamp});
          return {...record,...choices,sigla,updated:true};
        }
        const position=next.totalRegistrations;
        tx.set(totalsRef,{...next,updatedAt:stamp});
        tx.set(ownRef,{uid,sigla,...choices,position,createdAt:stamp,updatedAt:stamp});
        return {uid,sigla,...choices,position,updated:false};
      },{maxAttempts:10});
      ensure();return result;
    } catch(error) {
      ensure();
      if(error.code!=='permission-denied'||attemptedTotals===null||attempt===7)throw error;
      const current=await api.getDocFromServer(totalsRef);ensure();
      if(!current.exists())throw error;
      const confirmed=readYearEndTotals(current.data());
      if(YEAR_END_TOTAL_KEYS.every(key=>confirmed[key]===attemptedTotals[key]))throw error;
    }
  }
}
