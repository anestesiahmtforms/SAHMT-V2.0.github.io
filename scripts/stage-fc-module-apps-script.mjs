import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createConsolidationScriptClient} from './lib/fa-consolidation-script-client.js';
import {createPrivateJsonProtector} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {assertFcModuleDeployment} from './lib/fc-module-deployment.js';

const FILES=['EvaluationLedger.gs','EvaluationOccurrenceDelivery.gs','QmentumCore.gs','QmentumQuarterly.gs','QmentumWrite.gs'];
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const normalize=text=>String(text).replaceAll('\r\n','\n');
async function main(){
 demand(process.env.LOCALAPPDATA,'FC_SCRIPT_PRIVATE_BACKUP_PATH_REQUIRED');
 const client=await createConsolidationScriptClient();
 const [remote,deployments]=await Promise.all([client.readContent(),client.readDeployments()]);
 demand(Array.isArray(remote.files)&&remote.files.length===73&&Array.isArray(deployments.deployments)&&deployments.deployments.length===4,'FC_SCRIPT_REMOTE_SHAPE_CHANGED');
 const targetDeploymentId=process.env.SAHMT_FC_APPS_SCRIPT_DEPLOYMENT_ID;
 demand(typeof targetDeploymentId==='string'&&targetDeploymentId.length>0,'FC_SCRIPT_TARGET_DEPLOYMENT_REQUIRED');
 const targetDeployments=deployments.deployments.filter(item=>item.deploymentId===targetDeploymentId);
 demand(targetDeployments.length===1,'FC_SCRIPT_TARGET_DEPLOYMENT_INVALID');
 const targetDescription=String(targetDeployments[0].deploymentConfig?.description||'');
 demand(/(?:^|\b)(?:FC|INDICADORES|QMENTUM|OCORR[EÊ]NCIAS)(?:\b|$)/i.test(targetDescription),'FC_SCRIPT_TARGET_DEPLOYMENT_NOT_LABELED');
 demand(Number.isSafeInteger(targetDeployments[0].deploymentConfig?.versionNumber)&&targetDeployments[0].deploymentConfig.versionNumber>0,'FC_SCRIPT_TARGET_DEPLOYMENT_NOT_VERSIONED');
 const next=structuredClone(remote),originalByName=new Map(remote.files.map(file=>[file.type+'\n'+file.name,file]));
 demand(originalByName.size===remote.files.length,'FC_SCRIPT_DUPLICATE_REMOTE_FILE');
 const local=new Map();
 for(const file of FILES){
  const source=await readFile(new URL('../apps-script-v2/'+file,import.meta.url),'utf8');
  const remoteFile=next.files.find(item=>item.type==='SERVER_JS'&&item.name===file.slice(0,-3));
  demand(remoteFile&&typeof remoteFile.source==='string','FC_SCRIPT_TARGET_FILE_MISSING');
  local.set(file,source);remoteFile.source=source;
 }
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','qmentum-fc-migration');
 await mkdir(directory,{recursive:true});const protector=await createPrivateJsonProtector();
 const backup=resolve(directory,'AppsScript-'+Date.now()+'-'+randomUUID()+'.dpapi.json');
 const snapshot={schemaVersion:1,content:remote,deployments,createdAt:new Date().toISOString()};
 await writeFile(backup,JSON.stringify(protector.seal(snapshot)),{flag:'wx',mode:0o600});
 const saved=protector.open(JSON.parse(await readFile(backup,'utf8')));
 demand(snapshotDigest(saved)===snapshotDigest(snapshot),'FC_SCRIPT_BACKUP_VERIFY_FAILED');
 const changed=FILES.filter(file=>normalize(originalByName.get('SERVER_JS\n'+file.slice(0,-3)).source)!==normalize(local.get(file)));
 if(changed.length){
  await client.updateContent(next);
  const check=await client.readContent();
  demand(check.files.length===remote.files.length,'FC_SCRIPT_FILE_COUNT_CHANGED');
  for(const file of remote.files){
   const key=file.type+'\n'+file.name,after=check.files.find(item=>item.type+'\n'+item.name===key);
   demand(after&&((changed.includes(file.name+'.gs'))?normalize(after.source)===normalize(local.get(file.name+'.gs')):after.source===file.source),'FC_SCRIPT_CONTENT_POSTCHECK_FAILED');
  }
 }
 const version=await client.createVersion('FC independent modules: QMENTUM and occurrences');
 const deployment=targetDeployments[0],updated=[];
 await client.updateDeployment(deployment,version.versionNumber,'FC independent modules: QMENTUM and occurrences');
 updated.push(deployment.deploymentId);
 const current=await client.readDeployments();
 assertFcModuleDeployment({before:deployments,current,targetDeploymentId:deployment.deploymentId,versionNumber:version.versionNumber});
 console.log(JSON.stringify({code:'FC_MODULE_APPS_SCRIPT_STAGED',updatedFiles:changed.length,remoteFilesPreserved:remote.files.length-FILES.length,version:version.versionNumber,targetDeploymentId:deployment.deploymentId,versionedDeploymentsUpdated:updated.length,otherDeploymentsPreserved:deployments.deployments.length-updated.length,backup}));
}
main().catch(error=>{const code=/^FC_SCRIPT_[A-Z0-9_]+$/.test(error.message||'')?error.message:'FC_MODULE_APPS_SCRIPT_STAGE_FAILED';console.error(JSON.stringify({code,automaticRollback:false}));process.exitCode=1;});
