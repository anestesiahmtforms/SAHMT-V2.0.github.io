const demand=(condition,code)=>{if(!condition)throw Error(code);};

/** Verify that one labeled FC deployment advanced and every other deployment stayed unchanged. */
export function assertFcModuleDeployment({before,current,targetDeploymentId,versionNumber}={}){
 demand(Array.isArray(before?.deployments)&&Array.isArray(current?.deployments)
  &&typeof targetDeploymentId==='string'&&targetDeploymentId.length>0
  &&Number.isSafeInteger(versionNumber)&&versionNumber>0,'FC_MODULE_DEPLOYMENT_EVIDENCE_INVALID');
 demand(before.deployments.length>0&&before.deployments.length===current.deployments.length
  &&new Set(before.deployments.map(item=>item.deploymentId)).size===before.deployments.length
  &&new Set(current.deployments.map(item=>item.deploymentId)).size===current.deployments.length,
  'FC_MODULE_DEPLOYMENT_SET_CHANGED');
 for(const expected of before.deployments){
  const actual=current.deployments.find(item=>item.deploymentId===expected.deploymentId);
  demand(actual,'FC_MODULE_DEPLOYMENT_SET_CHANGED');
  const expectedConfig=expected.deploymentConfig||{},actualConfig=actual.deploymentConfig||{};
  demand(actualConfig.description===expectedConfig.description
   &&actualConfig.manifestFileName===expectedConfig.manifestFileName
   &&actualConfig.scriptId===expectedConfig.scriptId
   &&JSON.stringify(actual.entryPoints||[])===JSON.stringify(expected.entryPoints||[]),
   'FC_MODULE_DEPLOYMENT_CONFIGURATION_CHANGED');
  if(expected.deploymentId===targetDeploymentId)
   demand(actualConfig.versionNumber===versionNumber,'FC_MODULE_TARGET_VERSION_MISMATCH');
  else demand(actualConfig.versionNumber===expectedConfig.versionNumber,'FC_MODULE_OTHER_DEPLOYMENT_CHANGED');
 }
 demand(before.deployments.some(item=>item.deploymentId===targetDeploymentId),'FC_MODULE_TARGET_MISSING');
 return true;
}
