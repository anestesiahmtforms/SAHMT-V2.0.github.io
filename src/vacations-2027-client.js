export async function callVacationsApi({uid,isCurrent,action,input={},signal,authClient,fetchImpl=fetch}){
 const auth=authClient||(await import('./firebase-auth.js')).auth;await auth.authStateReady();
 const valid=()=>isCurrent()&&auth.currentUser?.uid===uid&&auth.app?.options?.projectId==='sahmt-17a16';
 if(!valid())throw Error('VACATIONS_SESSION_CHANGED');const token=await auth.currentUser.getIdToken();if(!valid())throw Error('VACATIONS_SESSION_CHANGED');
 const response=await fetchImpl('https://sahmt-fe-vacations.anestesiahmtforms5.workers.dev/v1/vacations-2027',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,input}),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:signal||AbortSignal.timeout(60000)});
 if(!valid()){await response.body?.cancel();throw Error('VACATIONS_SESSION_CHANGED');}const data=await response.json();if(!response.ok)throw Object.assign(Error(data.code||'VACATIONS_UNAVAILABLE'),{code:data.code,status:response.status});return data;
}
