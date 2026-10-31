const endpoint='https://sahmt-html-training.anestesiahmtforms.workers.dev/v1/year-end-status';
export async function readYearEndBannerStatus({uid,isCurrent,auth:providedAuth,fetchImpl=fetch}) {
  const auth=providedAuth||(await import('./firebase-auth.js')).auth;
  await auth?.authStateReady();
  const valid=()=>isCurrent()&&auth?.currentUser?.uid===uid&&auth.app?.options?.projectId==='sahmt-17a16';
  if(!valid())throw Object.assign(Error('YEAR_END_SESSION_CHANGED'),{code:'YEAR_END_SESSION_CHANGED'});
  const token=await auth.currentUser.getIdToken();if(!valid())throw Object.assign(Error('YEAR_END_SESSION_CHANGED'),{code:'YEAR_END_SESSION_CHANGED'});
  const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(20000),body:JSON.stringify({action:'STATUS',input:{}})});
  if(!valid())throw Object.assign(Error('YEAR_END_SESSION_CHANGED'),{code:'YEAR_END_SESSION_CHANGED'});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.code||'YEAR_END_UNAVAILABLE'),{code:data.code||'YEAR_END_UNAVAILABLE'});
  if(typeof data.eligible!=='boolean'||typeof data.completed!=='boolean'||data.completed&&!data.eligible)throw Error('YEAR_END_STATUS_INVALID');
  return {participation:{canParticipate:data.eligible},completed:data.completed};
}
