const env=import.meta.env||{};
const refreshEndpoint=env.VITE_FK_REFRESH_ENDPOINT;

export async function refreshFunctionalOverview({faAuth,uid,isCurrent=()=>true,fetchImpl=fetch}={}){
  const result=await requestFunctional(refreshEndpoint,{faAuth,uid,isCurrent,fetchImpl});
  if(result?.uid!==uid||result.snapshot?.uid!==uid)throw new Error('FK_REFRESH_UNAVAILABLE');
  return result.snapshot;
}

export async function readFunctionalTeamOverview({faAuth,uid,subjectUid,isCurrent=()=>true,fetchImpl=fetch}={}) {
  const endpoint=refreshEndpoint && new URL('team-overview',refreshEndpoint);
  const result=await requestFunctional(endpoint,{faAuth,uid,isCurrent,fetchImpl,input:{subjectUid}});
  if(result?.uid!==subjectUid||(result.snapshot!==null&&result.snapshot?.uid!==subjectUid))
    throw new Error('FK_TEAM_OVERVIEW_UNAVAILABLE');
  return result;
}

async function requestFunctional(endpoint,{faAuth,uid,isCurrent,fetchImpl,input={}}) {
  const source=faAuth?.currentUser;
  if(!endpoint||!source||source.uid!==uid||!isCurrent())throw new Error('FK_SESSION_REQUIRED');
  const faIdToken=await source.getIdToken();
  if(!isCurrent()||faAuth.currentUser!==source)throw new Error('FK_SESSION_CHANGED');
  const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({faIdToken,...input}),credentials:'omit',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(45000)});
  if(!isCurrent()||faAuth.currentUser!==source)throw new Error('FK_SESSION_CHANGED');
  const result=await response.json().catch(()=>null);
  if(!isCurrent()||faAuth.currentUser!==source)throw new Error('FK_SESSION_CHANGED');
  if(!response.ok||!result)throw new Error(result?.code||'FK_REFRESH_UNAVAILABLE');
  return result;
}

export async function requestFunctionalDosimetry({faAuth,uid,input,isCurrent=()=>true,fetchImpl=fetch}={}){
 const endpoint=refreshEndpoint&&new URL('dosimetry',refreshEndpoint);
 const result=await requestFunctional(endpoint,{faAuth,uid,isCurrent,fetchImpl,input:{input}});
 if(['PREVIEW_IMPORT','IMPORT'].includes(input.operation)){if(result?.year!==input.year)throw Error('FK_DOSIMETRY_SCOPE_INVALID');return result;}
 if(result?.uid!==input.subjectUid||result.year!==input.year||result.record!==null&&(result.record?.uid!==input.subjectUid||result.record?.year!==input.year))throw Error('FK_DOSIMETRY_SCOPE_INVALID');
 return result;
}

export async function requestFunctionalFolderPolicy({faAuth,uid,operation,input={},isCurrent=()=>true,fetchImpl=fetch}={}){
 if(!['INSPECT','PUBLISH'].includes(operation))throw Error('FK_FOLDER_POLICY_INPUT');
 const endpoint=refreshEndpoint&&new URL('folders',refreshEndpoint);
 const result=await requestFunctional(endpoint,{faAuth,uid,isCurrent,fetchImpl,input:{operation,input}});
 if(!['FK_FOLDER_POLICY_READY','FK_FOLDER_POLICY_UPDATED'].includes(result?.code))throw Error('FK_FOLDER_POLICY_UNAVAILABLE');
 return result;
}
