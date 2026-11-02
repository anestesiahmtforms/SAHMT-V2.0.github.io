const endpoint=import.meta.env?.VITE_FE_PERFORMANCE_ENABLED==='true'?'https://sahmt-fe-surveys.anestesiahmtforms5.workers.dev/v1/institutional-surveys':'https://sahmt-html-training.anestesiahmtforms.workers.dev/v1/institutional-surveys';
export async function callInstitutionalSurvey({uid,isCurrent,survey,action,response,authClient,fetchImpl=fetch}) {
  const auth=authClient||(await import('./firebase-auth.js')).auth;
  await auth?.authStateReady();
  const valid=()=>isCurrent()&&auth?.currentUser?.uid===uid&&auth.app?.options?.projectId==='sahmt-17a16';
  if(!valid())throw Error('SURVEY_SESSION_CHANGED');
  const token=await auth.currentUser.getIdToken();
  if(!valid())throw Error('SURVEY_SESSION_CHANGED');
  const input=action==='GET_PERFORMANCE'?{}:{survey,cycle:'2026',...(action==='SUBMIT'?{response}:{})};
  const result=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(20000),body:JSON.stringify({action,input})});
  if(!valid())throw Error('SURVEY_SESSION_CHANGED');
  if(!result.ok){await result.body?.cancel();throw Error('SURVEY_UNAVAILABLE');}
  const data=await result.json();
  if(action==='GET_PERFORMANCE'){
    if(data?.uid!==uid||data?.summary?.uid!==uid||!['READY','PREPARING'].includes(data.status)||!Array.isArray(data.awards))throw Error('SURVEY_UNAVAILABLE');
    const awards=data.awards.map(row=>{
      if(row?.uid!==uid||row.category!=='PERFORMANCE'||row.points!==1||!['climate','stress','epidemiological'].includes(row.survey)||typeof row.cycle!=='string')throw Error('SURVEY_UNAVAILABLE');
      return {uid:uid,category:'PERFORMANCE',points:1,survey:row.survey,cycle:row.cycle,createdAt:row.createdAt};
    });
    return {status:data.status,uid,summary:{uid,total:Number.isSafeInteger(data.summary.total)&&data.summary.total>=0?data.summary.total:0},reference:{maxTotal:Number.isSafeInteger(data.reference?.maxTotal)&&data.reference.maxTotal>=0?data.reference.maxTotal:0},awards};
  }
  // Reply to the FE frame with this closed shape only; never auth data.
  if(data.group==='substitute')data.group='team';
  if(action==='BOOTSTRAP'&&['team','resident'].includes(data.group)&&typeof data.alreadyResponded==='boolean')return {group:data.group,alreadyResponded:data.alreadyResponded};
  if(action==='SUBMIT'&&data.accepted===true&&typeof data.alreadyResponded==='boolean')return {accepted:true,alreadyResponded:data.alreadyResponded};
  throw Error('SURVEY_UNAVAILABLE');
}
