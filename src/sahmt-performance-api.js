import {isSahmtPerformanceAction} from './sahmt-performance-actions.js';
const endpoint='https://sahmt-indicators.anestesiahmtforms4.workers.dev/v1/indicators';
export async function callSahmtPerformanceApi({uid,isCurrent,action,input,signal}={}){
 if(!isSahmtPerformanceAction(action))throw Error('SAHMT_PERFORMANCE_UNSUPPORTED_ACTION');
 const {getGoogleProjectAuth,waitForGoogleProjectSession}=await import('./google-project-auth-runtime.js');
 if(!await waitForGoogleProjectSession('FD',{isCurrent}))throw Error('INDICATOR_SESSION_CHANGED');
 const auth=getGoogleProjectAuth('FD');await auth.authStateReady();const user=auth.currentUser;
 const valid=()=>isCurrent()&&auth.currentUser===user&&user?.uid===uid&&auth.app?.options?.projectId==='rotinas-8a617';
 if(!valid())throw Error('INDICATOR_SESSION_CHANGED');
 const token=await user.getIdToken();if(!valid())throw Error('INDICATOR_SESSION_CHANGED');
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,input}),signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
 const d=await r.json();if(!valid())throw Error('INDICATOR_SESSION_CHANGED');
 if(!r.ok)throw Object.assign(Error(d.code||'INDICATOR_UNAVAILABLE'),{code:d.code,status:r.status});return d;
}
