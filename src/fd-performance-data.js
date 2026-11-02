export const FD_PERFORMANCE_PROJECT='rotinas-8a617';
export const fdPerformanceEnabled=import.meta.env?.VITE_FD_PERFORMANCE_ENABLED==='true';
const validUid=value=>typeof value==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(value);

export function fdPerformanceIdentityCanEnter(session){
 const user=session?.user,profile=session?.profile;
 return session?.status==='signed-in'&&validUid(user?.uid)&&profile?.uid===user.uid&&profile?.active===true&&profile?.access===true&&(profile.role==='administrador_app'||profile.permissions?.admin===true);
}

function assertSession({uid,isCurrent}){if(!validUid(uid)||!isCurrent())throw Error('FD_PERFORMANCE_SESSION_INVALID');}

export function createFdPerformanceRepository({uid,request,isCurrent=()=>true,now=()=>new Date()}={}){
 if(!validUid(uid)||typeof request!=='function')throw Error('FD_PERFORMANCE_CONFIG_INVALID');
 const current=()=>isCurrent()&&validUid(uid);
 async function call(action,input){assertSession({uid,isCurrent:current});const result=await request(action,input);assertSession({uid,isCurrent:current});return result;}
 return Object.freeze({
  async loadSummary(){
   const summary=await call('GET_PERFORMANCE',{});
   if(summary?.uid!==uid||summary.summary?.uid!==uid||!['READY','PREPARING'].includes(summary.status))throw Error('FD_PERFORMANCE_SCOPE_INVALID');
   if(summary.status==='PREPARING')return summary;
   const year=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric'}).format(now()));
   const indicators=await call('BOOTSTRAP',{year});
   if(!Array.isArray(indicators?.metrics))throw Error('FD_PERFORMANCE_UNAVAILABLE');
   return {...summary,indicators:indicators.metrics.map(({id,name,description,unit,latest,months})=>({id,name,description,unit,latest,months,year}))};
  },
  acknowledge(metricId,year){return call('ACKNOWLEDGE_INDICATOR',{metricId,year});},
  submitSuggestion(metricId,year,text){return call('SUBMIT_SUGGESTION',{metricId,year,text});},
  reviewSuggestion(suggestionId,decision){return call('REVIEW_SUGGESTION',{suggestionId,decision});}
 });
}

export function fdPerformancePresentation(snapshot){
 if(!snapshot||!validUid(snapshot.uid)||snapshot.summary?.uid!==snapshot.uid)return{state:'blocked',total:null,percentage:null};
 if(snapshot.status==='PREPARING')return{state:'preparing',total:null,percentage:null};
 if(snapshot.status!=='READY')return{state:'blocked',total:null,percentage:null};
 const total=snapshot.summary.total,maximum=snapshot.reference?.maxTotal;
 if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(maximum)||maximum<0||total>maximum)return{state:'pending',total:null,percentage:null};
 return{state:'ready',total,percentage:maximum===0?0:Math.round(total/maximum*10000)/100};
}
