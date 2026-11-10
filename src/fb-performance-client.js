import {operationalContentAllowed} from './operational-folder-runtime.js';
import {deployment} from './deployment-context.js';
export const fbPerformanceReleaseEnabled=import.meta.env?.VITE_FB_PERFORMANCE_ENABLED==='true';
export const fbPerformanceEnabled=deployment.target==='FB'&&fbPerformanceReleaseEnabled;
// Fixed endpoint and FB issuer. URL input cannot select another project.
const endpoint='https://sahmt-fb-performance.anestesiahmtforms2.workers.dev/v1/fb-performance';
export async function readFbPerformance({auth,subjectUid,isCurrent=()=>true,fetchImpl=fetch}){
 const user=auth?.currentUser;
 const current=()=>operationalContentAllowed('desempenho/fb')&&isCurrent()&&auth?.currentUser===user&&auth.app?.options?.projectId==='sahmt-gestao-5ae66';
 if(!user||!current())throw Error('FB_PERFORMANCE_SESSION_CHANGED');
 const token=await user.getIdToken();if(!current())throw Error('FB_PERFORMANCE_SESSION_CHANGED');
 const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'GET_PERFORMANCE',input:{subjectUid}}),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!current()){await response.body?.cancel();throw Error('FB_PERFORMANCE_SESSION_CHANGED');}
 const value=await response.json();
 if(!response.ok)throw Object.assign(Error(value.code||'FB_PERFORMANCE_UNAVAILABLE'),{code:response.status===403?'permission-denied':'unavailable',backendCode:value.code});
 if(value.sourceProjectId!=='sahmt-gestao-5ae66'||value.summary?.uid!==subjectUid||!Array.isArray(value.awards)||!Array.isArray(value.ledger)||value.awards.some(row=>row.uid!==subjectUid||row.sourceProjectId!=='sahmt-gestao-5ae66'||['CHECKLIST','OCCURRENCE'].includes(row.modality)))throw Error('FB_PERFORMANCE_SCOPE_INVALID');
 return value;
}
export function watchFbPerformance({auth,subjectUid,isCurrent,onData,onError}){
 let closed=false,running=false;const current=()=>!closed&&isCurrent();
 const refresh=async()=>{if(running||!current()||globalThis.navigator?.onLine===false||globalThis.document?.hidden)return;running=true;try{const value=await readFbPerformance({auth,subjectUid,isCurrent:current});if(current())onData(value);}catch(error){if(current()){
  if(['FB_PERFORMANCE_PENDING','FB_PERFORMANCE_PREPARING'].includes(error.backendCode))onData({summary:null,reference:null,awards:[],ledger:[],complete:false,fromCache:true,pendingWrites:false});
  else onError(error);
 }}finally{running=false;}};
 const timer=setInterval(refresh,30000);void refresh();
 globalThis.window?.addEventListener('online',refresh);globalThis.document?.addEventListener('visibilitychange',refresh);
 return()=>{closed=true;clearInterval(timer);globalThis.window?.removeEventListener('online',refresh);globalThis.document?.removeEventListener('visibilitychange',refresh);};
}
