import {getFunctionalAuth} from './functional-firebase.js';

const env=import.meta.env||{};
const refreshEndpoint=env.VITE_FK_REFRESH_ENDPOINT;

export async function refreshFunctionalOverview({faAuth,uid,isCurrent=()=>true,fetchImpl=fetch}={}){
  const source=faAuth?.currentUser;
  if(!refreshEndpoint||!source||source.uid!==uid||!isCurrent())throw new Error('FK_SESSION_REQUIRED');
  const faIdToken=await source.getIdToken(true);
  if(!isCurrent()||faAuth.currentUser!==source)throw new Error('FK_SESSION_CHANGED');
  const response=await fetchImpl(refreshEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({faIdToken}),credentials:'omit',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(45000)});
  if(!isCurrent()||faAuth.currentUser!==source)throw new Error('FK_SESSION_CHANGED');
  const result=await response.json().catch(()=>null);
  if(!response.ok||result?.uid!==uid||result.snapshot?.uid!==uid)throw new Error(result?.code||'FK_REFRESH_UNAVAILABLE');
  return result.snapshot;
}

/** Calls the independent FK performance API using only the current FK session. */
export async function callFunctionalAction({uid,isCurrent=()=>true,action,input,signal}={}){
  const endpoint=env.VITE_FK_PERFORMANCE_ENDPOINT;
  const auth=getFunctionalAuth(),user=auth?.currentUser;
  if(!endpoint||!user||user.uid!==uid||!isCurrent())throw new Error('FK_SESSION_REQUIRED');
  const token=await user.getIdToken();
  if(!isCurrent()||auth.currentUser!==user)throw new Error('FK_SESSION_CHANGED');
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action,input}),credentials:'omit',cache:'no-store',redirect:'manual',signal});
  if(!isCurrent()||auth.currentUser!==user)throw new Error('FK_SESSION_CHANGED');
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result||typeof result!=='object')throw new Error(result?.code||'FK_PERFORMANCE_UNAVAILABLE');
  return result;
}
