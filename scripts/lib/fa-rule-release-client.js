const demand=(value,code)=>{if(!value)throw Error(code);};
export function createFaRuleReleaseClient({projectId,accessToken,fetchImpl=fetch}={}){
 demand(['sahmt-17a16','indicadores---sahmt'].includes(projectId)&&typeof accessToken==='string','CONSOLIDATION_RULES_PROJECT_INVALID');
 const request=async(path,method='GET',body)=>{
  const r=await fetchImpl('https://firebaserules.googleapis.com/v1/projects/'+projectId+path,{method,headers:{Authorization:'Bearer '+accessToken,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  demand(r.ok,'CONSOLIDATION_RULES_HTTP_'+r.status);return r.json();
 };
 return {async read(){const release=await request('/releases/cloud.firestore');
   demand(release.rulesetName?.startsWith('projects/'+projectId+'/rulesets/'),'CONSOLIDATION_RULES_RESOURCE_MISMATCH');
   const rules=await request(release.rulesetName.slice(('projects/'+projectId).length));
   demand(rules.source?.files?.length===1,'CONSOLIDATION_RULES_MULTIPLE_FILES_UNREVIEWED');return{release,rules};},
  async publish(content,previous){
   demand(typeof content==='string'&&content.length<250000&&previous?.release?.name==='projects/'+projectId+'/releases/cloud.firestore','CONSOLIDATION_RULES_WRITE_INVALID');
   const current=await request('/releases/cloud.firestore');
   demand(current.rulesetName===previous.release.rulesetName&&current.updateTime===previous.release.updateTime,'CONSOLIDATION_RULES_RELEASE_DRIFT');
   const rules=await request('/rulesets','POST',{source:{files:[{name:previous.rules.source.files[0].name,content}]}});
   demand(rules.name?.startsWith('projects/'+projectId+'/rulesets/'),'CONSOLIDATION_RULES_CREATED_RESOURCE_INVALID');
   const check=await request('/releases/cloud.firestore');demand(check.rulesetName===current.rulesetName&&check.updateTime===current.updateTime,'CONSOLIDATION_RULES_RELEASE_DRIFT');
   await request('/releases/cloud.firestore','PATCH',{release:{name:current.name,rulesetName:rules.name},updateMask:'rulesetName'});
   const result=await request('/releases/cloud.firestore');demand(result.rulesetName===rules.name,'CONSOLIDATION_RULES_POSTCHECK_FAILED');return result;
  }
 };
}
