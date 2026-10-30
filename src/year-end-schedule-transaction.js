import {yearEndError} from './year-end-schedule.js';

// A bounded retry handles a counter advanced between the transaction snapshot
// and rules evaluation. Real permission failures are never retried blindly.
export async function writeYearEndChoices({api,db,ownRef,counterRef,uid,sigla,choices,ensure}) {
  for(let attempt=0;attempt<8;attempt++) {
    let attemptedPosition=null;
    try {
      const result=await api.runTransaction(db,async tx=>{
        const prior=await tx.get(ownRef);ensure();
        if(prior.exists()) {
          const record=prior.data();
          if(!Number.isSafeInteger(record.position)||record.position<1)throw yearEndError('YEAR_END_CORRUPT_ORDER');
          tx.update(ownRef,{...choices,sigla,updatedAt:api.serverTimestamp()});
          return {...record,...choices,sigla,updated:true};
        }
        const counter=await tx.get(counterRef);ensure();
        const previous=counter.exists()?counter.data().lastPosition:0;
        if(!Number.isSafeInteger(previous)||previous<0||previous>=Number.MAX_SAFE_INTEGER)throw yearEndError('YEAR_END_CORRUPT_ORDER');
        const position=previous+1,stamp=api.serverTimestamp();attemptedPosition=position;
        tx.set(counterRef,{lastPosition:position,lastParticipantUid:uid,updatedAt:stamp});
        tx.set(ownRef,{uid,sigla,...choices,position,createdAt:stamp,updatedAt:stamp});
        return {uid,sigla,...choices,position,updated:false};
      },{maxAttempts:10});
      ensure();return result;
    } catch(error) {
      ensure();
      if(error.code!=='permission-denied'||attemptedPosition===null||attempt===7)throw error;
      const current=await api.getDocFromServer(counterRef);ensure();
      if(!current.exists() || !Number.isSafeInteger(current.data().lastPosition) || current.data().lastPosition<attemptedPosition)throw error;
    }
  }
}
