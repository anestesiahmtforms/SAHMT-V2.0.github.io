export const FE_PERFORMANCE_PROJECT='outros-48120';
export const fePerformanceEnabled=import.meta.env?.VITE_FE_PERFORMANCE_ENABLED==='true';
const validUid=value=>typeof value==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(value);

export function createFePerformanceRepository({uid,request,isCurrent=()=>true}={}){
 if(!validUid(uid)||typeof request!=='function')throw Error('FE_PERFORMANCE_CONFIG_INVALID');
 return Object.freeze({async loadSummary(){
  if(!isCurrent())throw Error('FE_PERFORMANCE_SESSION_INVALID');
  const result=await request();
  if(!isCurrent())throw Error('FE_PERFORMANCE_SESSION_INVALID');
  if(result?.uid!==uid||result.summary?.uid!==uid||!['READY','PREPARING'].includes(result.status)||
    !Array.isArray(result.awards)||result.awards.some(row=>row.uid!==uid||row.category!=='PERFORMANCE'||row.points!==1||!['climate','stress','epidemiological'].includes(row.survey)))
   throw Error('FE_PERFORMANCE_SCOPE_INVALID');
  return result;
 }});
}

export function fePerformancePresentation(snapshot){
 if(!snapshot||!validUid(snapshot.uid)||snapshot.summary?.uid!==snapshot.uid)return{state:'blocked',total:null,percentage:null};
 if(snapshot.status==='PREPARING')return{state:'preparing',total:null,percentage:null};
 if(snapshot.status!=='READY')return{state:'blocked',total:null,percentage:null};
 const total=snapshot.summary.total,maximum=snapshot.reference?.maxTotal;
 if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(maximum)||maximum<0||total>maximum)return{state:'pending',total:null,percentage:null};
 return{state:'ready',total,percentage:maximum===0?0:Math.round(total/maximum*10000)/100};
}
