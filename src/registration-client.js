const origin='https://sahmt-html-training.anestesiahmtforms.workers.dev';
export async function callRegistrationApi({uid,isCurrent,kind,action,input={},signal}={}){
 const {auth}=await import('./firebase-auth.js');await auth?.authStateReady();const valid=()=>isCurrent()&&auth?.currentUser?.uid===uid&&auth.app?.options?.projectId==='sahmt-17a16';if(!valid())throw Error('Sua sessão mudou. Entre novamente.');const token=await auth.currentUser.getIdToken();if(!valid())throw Error('Sua sessão mudou. Entre novamente.');
 const path=kind==='drive'?'/v1/registration-drive':kind==='epidemiological'?'/v1/institutional-surveys':'/v1/professional-registration';
 const payload=kind==='epidemiological'?{survey:'epidemiological',cycle:'2026',...(action==='SUBMIT'?{response:input}:{})}:input;
 const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...(kind==='drive'&&action==='CONNECT'?{'X-Requested-With':'SAHMT'}:{})},body:JSON.stringify({action,input:payload}),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:signal||AbortSignal.timeout(60000)});if(!valid())throw Error('Sua sessão mudou. Entre novamente.');const data=await response.json();if(!response.ok)throw Object.assign(Error(data.code||'UNAVAILABLE'),{code:data.code,status:response.status});return data;
}
