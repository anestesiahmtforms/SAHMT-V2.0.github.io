import seed from '../../src/app-version-seed.json' with {type:'json'};
export const APP_REPOSITORY='anestesiahmtforms/SAHMT-V2.0.github.io';
export const APP_RELEASE_URL='https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/tools/app-release.json';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const fail=code=>{throw Error('APP_PUBLICATION_'+code);};

export function validateAppPublication(value){
 if(value?.schema!==1||!/^V\d{1,3}\.\d{1,6}$/.test(value.appVersion||'')||!sha(value.sourceRevision)||!Number.isSafeInteger(value.release)||value.release<=0)fail('PLAN_INVALID');
 return value;
}
export function planAppPublication({metadata,deployedRevision,sourceRevision,comparison,now=Date.now()}){
 if(!sha(deployedRevision)||!sha(sourceRevision)||metadata?.schema!==1)fail('STATE_INVALID');
 const release=metadata.targets?.FA;
 if(!Number.isSafeInteger(release)||release<=0||metadata.targets?.FB!==release)fail('STATE_INVALID');
 const legacy=metadata.sourceRevision===undefined&&metadata.appVersion===seed.appVersion&&release===seed.release&&deployedRevision===seed.sourceRevision;
 if(!legacy&&metadata.sourceRevision!==deployedRevision)fail('STATE_MISMATCH');
 const match=/^V(\d{1,3})\.(\d{1,6})$/.exec(metadata.appVersion||'');if(!match)fail('STATE_INVALID');
 if(sourceRevision===deployedRevision)return validateAppPublication({schema:1,appVersion:metadata.appVersion,sourceRevision,release});
 if(comparison!=='ahead')fail('REVISION_NOT_NEWER');
 const minor=Number(match[2])+1;if(minor>999999||!Number.isSafeInteger(now)||now<=0)fail('VERSION_INVALID');
 return validateAppPublication({schema:1,appVersion:'V'+Number(match[1])+'.'+minor,sourceRevision,release:Math.max(now,release+1)});
}

export async function prepareAppPublication({sourceRevision,repository,token,fetchImpl=fetch,now=Date.now()}){
 if(repository!==APP_REPOSITORY||!sha(sourceRevision))fail('REPOSITORY_INVALID');
 const api='https://api.github.com/repos/'+APP_REPOSITORY;
 const read=async(url,github=true)=>{
  let response;try{response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json','Cache-Control':'no-cache',...(github&&token?{Authorization:'Bearer '+token}:{})},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});}catch{fail('SOURCE_UNAVAILABLE');}
  if(!response.ok)fail('SOURCE_HTTP_'+response.status);
  try{return await response.json();}catch{fail('SOURCE_INVALID');}
 };
 let deployedRevision;
 for(let page=1;page<=5&&!deployedRevision;page++){
  const rows=await read(api+'/deployments?environment=github-pages&per_page=100&page='+page);if(!Array.isArray(rows))fail('SOURCE_INVALID');
  for(const row of rows){
   if(!Number.isSafeInteger(row.id)||row.environment!=='github-pages'||!sha(row.sha))fail('SOURCE_INVALID');
   const statuses=await read(api+'/deployments/'+row.id+'/statuses');if(!Array.isArray(statuses))fail('SOURCE_INVALID');
   if(statuses.some(status=>status.state==='success')){deployedRevision=row.sha;break;}
  }
  if(rows.length<100)break;
 }
 if(!deployedRevision)fail('SUCCESSFUL_DEPLOYMENT_MISSING');
 const metadata=await read(APP_RELEASE_URL+'?publication='+sourceRevision+'-'+now,false);
 const comparison=sourceRevision===deployedRevision?'identical':(await read(api+'/compare/'+deployedRevision+'...'+sourceRevision)).status;
 return planAppPublication({metadata,deployedRevision,sourceRevision,comparison,now});
}

// A deploy-only retry may reuse an artifact built before another publication.
// Recheck immediately before mutation, including version and numeric release.
export async function assertAppPublicationCurrent({plan,...options}){
 validateAppPublication(plan);
 const current=await prepareAppPublication({...options,sourceRevision:plan.sourceRevision,now:plan.release});
 if(current.appVersion!==plan.appVersion||current.release!==plan.release)fail('ARTIFACT_STALE');
 return current;
}
