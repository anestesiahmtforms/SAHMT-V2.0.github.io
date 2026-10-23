export function readingGateConfig(env={}){
 let endpoint='';try{const u=new URL(env.VITE_DIRETRIZES_READING_ENDPOINT);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search&&u.pathname==='/v1/diretrizes/reading')endpoint=u.href;}catch{}
 return {enabled:env.VITE_DIRETRIZES_READING_ENABLED==='true'&&Boolean(endpoint),endpoint};
}
export function createReadingClient({endpoint,getUser,fetchImpl=fetch}){
 return {async request(body,{signal}={}){
  const user=getUser();if(!user?.uid)throw Error('READING_LOGIN_REQUIRED');
  const token=await user.getIdToken();if(getUser()?.uid!==user.uid)throw Error('READING_USER_CHANGED');
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)controller.abort();const timer=setTimeout(abort,60000);
  try{
   const response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
   const data=await response.json();if(getUser()?.uid!==user.uid)throw Error('READING_USER_CHANGED');
   if(!response.ok||!['READING_STARTED','READING_PROGRESS_SAVED','READING_RELEASED','READING_COMPLETED'].includes(data?.code))throw Error(/^READING_[A-Z_]+$/.test(data?.code||'')?data.code:'READING_UNAVAILABLE');
   return data;
  }catch(error){if(/^READING_[A-Z_]+$/.test(error?.message||''))throw error;throw Error(error?.name==='AbortError'?'READING_TIMEOUT':error?.name==='SyntaxError'?'READING_RESPONSE_INVALID':'READING_NETWORK_FAILED');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }};
}
