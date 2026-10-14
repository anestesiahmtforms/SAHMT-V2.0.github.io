export async function notifyOccurrenceScore({id, uid, auth, isCurrent = () => true, enabled = false, endpoint, allowedOrigin, fetchImpl = globalThis.fetch}) {
  if (!enabled) return {code:'OCCURRENCE_SCORING_DISABLED'};
  let url;try{url=new URL(endpoint);}catch{return {code:'OCCURRENCE_SCORE_CONFIG_INVALID'};}
  if(url.protocol!=='https:'||url.origin!==allowedOrigin||url.pathname!=='/v1/evaluation/occurrence'||url.username||url.password||url.search||url.hash)
    return {code:'OCCURRENCE_SCORE_CONFIG_INVALID'};
  const user=auth?.currentUser;
  if(!user||user.uid!==uid||!isCurrent()||!/^[A-Fa-f0-9-]{36}$/.test(id||''))return {code:'OCCURRENCE_SCORE_SESSION_INVALID'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try{
    const token=await user.getIdToken();
    if(auth.currentUser!==user||!isCurrent())return {code:'OCCURRENCE_SCORE_SESSION_CHANGED'};
    const response=await fetchImpl(url.href,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id}),
      credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
    if(auth.currentUser!==user||!isCurrent())return {code:'OCCURRENCE_SCORE_SESSION_CHANGED'};
    return {code:response.ok?'OCCURRENCE_SCORE_NOTIFICATION_SENT':'OCCURRENCE_SCORE_PENDING'};
  }catch{return {code:'OCCURRENCE_SCORE_PENDING'};}finally{clearTimeout(timer);}
}
export async function notifyConfiguredOccurrenceScore(options) {
  const env=import.meta.env||{},origin=env.VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN;
  return notifyOccurrenceScore({...options,enabled:env.VITE_OCCURRENCE_SCORING_ENABLED==='true',allowedOrigin:origin,
    endpoint:origin?origin+'/v1/evaluation/occurrence':''});
}
