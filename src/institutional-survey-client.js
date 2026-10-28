const endpoint='https://sahmt-html-training.anestesiahmtforms.workers.dev/v1/institutional-surveys';
export async function callInstitutionalSurvey({uid,isCurrent,survey,action,response}) {
  const {auth}=await import('./firebase-auth.js');
  const valid=()=>isCurrent()&&auth?.currentUser?.uid===uid&&auth.app?.options?.projectId==='sahmt-17a16';
  if(!valid())throw Error('SURVEY_SESSION_CHANGED');
  const token=await auth.currentUser.getIdToken();
  if(!valid())throw Error('SURVEY_SESSION_CHANGED');
  const result=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(20000),body:JSON.stringify({action,input:{survey,cycle:'2026',...(action==='SUBMIT'?{response}:{})}})});
  if(!valid())throw Error('SURVEY_SESSION_CHANGED');
  if(!result.ok){await result.body?.cancel();throw Error('SURVEY_UNAVAILABLE');}
  const data=await result.json();
  // Reply to the FE frame with this closed shape only; never auth data.
  if(action==='BOOTSTRAP'&&['team','resident','substitute'].includes(data.group)&&typeof data.alreadyResponded==='boolean')return {group:data.group,alreadyResponded:data.alreadyResponded};
  if(action==='SUBMIT'&&data.accepted===true&&typeof data.alreadyResponded==='boolean')return {accepted:true,alreadyResponded:data.alreadyResponded};
  throw Error('SURVEY_UNAVAILABLE');
}
