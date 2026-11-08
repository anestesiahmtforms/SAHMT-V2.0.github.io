import {isSahmtPerformanceAction} from './sahmt-performance-actions.js';

const fdEndpoint='https://sahmt-indicators.anestesiahmtforms4.workers.dev/v1/indicators';
const indicatorEndpoint=import.meta.env?.VITE_FD_PERFORMANCE_ENABLED==='true'?fdEndpoint:'https://sahmt-indicators.anestesiahmtforms.workers.dev/v1/indicators';
async function authForIndicators(action,isCurrent){
 if(!isSahmtPerformanceAction(action))return (await import('./firebase-auth.js')).auth;
 const {getGoogleProjectAuth,waitForGoogleProjectSession}=await import('./google-project-auth-runtime.js');
 if(!await waitForGoogleProjectSession('FD',{isCurrent}))throw Error('INDICATOR_SESSION_CHANGED');
 return getGoogleProjectAuth('FD');
}
export async function callIndicatorsApi({uid,isCurrent,action,input,signal}={}){
 const sahmt=isSahmtPerformanceAction(action),projectId=sahmt?'rotinas-8a617':'sahmt-17a16';
 const auth=await authForIndicators(action,isCurrent);await auth.authStateReady();
 const user=auth.currentUser;
 const valid=()=>isCurrent()&&auth.currentUser===user&&user?.uid===uid&&auth.app?.options?.projectId===projectId;
 if(!valid())throw Error('INDICATOR_SESSION_CHANGED');
 const token=await user.getIdToken();if(!valid())throw Error('INDICATOR_SESSION_CHANGED');
 const r=await fetch(sahmt?fdEndpoint:indicatorEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,input}),signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
 const d=await r.json();if(!valid())throw Error('INDICATOR_SESSION_CHANGED');
 if(!r.ok)throw Object.assign(Error(d.code||'INDICATOR_UNAVAILABLE'),{code:d.code,status:r.status});return d;
}
