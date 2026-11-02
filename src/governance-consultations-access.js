// FE owns affiliation. Cache only this menu decision in memory; data endpoints recheck authorization.
export function createConsultationsAccessReader({request,now=Date.now,maxAgeMs=300000}){
 let cached=null;
 return async ({uid,email,isCurrent=()=>true})=>{
  const key=uid+'|'+String(email||'').trim().toLowerCase();
  if(!uid||!email||!isCurrent())throw Error('VACATIONS_SESSION_CHANGED');
  if(!cached||cached.key!==key||cached.until<=now()){
   const entry={key,until:now()+maxAgeMs};
   entry.promise=Promise.resolve().then(()=>request({uid,isCurrent,action:'ACCESS',input:{}})).then(result=>{if(typeof result?.eligibleForConsultations!=='boolean')throw Error('VACATIONS_UNAVAILABLE');return result.eligibleForConsultations;}).catch(error=>{if(cached===entry)cached=null;throw error;});cached=entry;
  }
  const result=await cached.promise;if(!isCurrent())throw Error('VACATIONS_SESSION_CHANGED');return result;
 };
}
