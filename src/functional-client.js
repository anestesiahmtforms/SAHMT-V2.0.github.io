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
