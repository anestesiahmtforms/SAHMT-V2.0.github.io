import {readFile,readdir,writeFile} from 'node:fs/promises';import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {openPrivateJson,createPrivateJsonProtector} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createConsolidationControls} from './lib/fa-consolidation-controls.js';
import {consolidationControlWrites,mergeConsolidationScript,assertConsolidationDeployments} from './lib/fa-consolidation-deployment.js';
import {createConsolidationScriptClient} from './lib/fa-consolidation-script-client.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');
const demand=(value,code)=>{if(!value)throw Error(code);};
let changed=false;
try{
 const [stamp,flag]=process.argv.slice(2);demand(/^\d{17}$/.test(stamp||'')&&[undefined,'--apply'].includes(flag)&&process.argv.length<=4,'CONSOLIDATION_STAGE_ARGUMENT_INVALID');
 const open=async name=>openPrivateJson(JSON.parse(await readFile(resolve(dir,name),'utf8')));
 const capture=await open(stamp+'-FB.dpapi.json'),plan=await open(stamp+'-plan.dpapi.json');
 const restored=JSON.parse(await readFile(resolve(dir,stamp+'-restore-report.json'),'utf8'));
 const inventory=JSON.parse(await readFile(resolve(dir,stamp+'-report.json'),'utf8'));
 demand(plan.ready&&inventory.inventoryComplete&&restored.verified===capture.snapshot.documents.length
  &&restored.sourceSnapshotSha256===snapshotDigest(capture.snapshot),'CONSOLIDATION_STAGE_BACKUP_NOT_VERIFIED');
 const ready=JSON.parse(await readFile(resolve(root,'artifacts','fa-consolidation','preparation.json'),'utf8'));
 demand(ready.localReady===true&&ready.checks.every(item=>item.passed),'CONSOLIDATION_STAGE_LOCAL_CHECKS_REQUIRED');
 const client=await createConsolidationScriptClient(),remote=await client.readContent(),deployments=await client.readDeployments();
 const names=['EvaluationLedger.gs','EvaluationLegacyScoreDelivery.gs','TrainingValidation.gs','ManagementScoreValidation.gs',
  'EvaluationChecklistDelivery.gs','ChecklistScienceRelease.gs','EvaluationOccurrenceDelivery.gs','SparkReportSync.gs'];
 const localFiles={},baseFiles={},git=resolve(process.env.LOCALAPPDATA,'SAHMT','tools','mingit-2.56.0.2','cmd','git.exe');
 for(const name of names){
  localFiles[name]=await readFile(resolve(root,'apps-script-v2',name),'utf8');
  const base=spawnSync(git,['show','828ad33:apps-script-v2/'+name],{cwd:root,encoding:'utf8'});
  demand(base.status===0,'CONSOLIDATION_STAGE_BASE_UNAVAILABLE');baseFiles[name]=base.stdout;
 }
 const merged=mergeConsolidationScript({remote,localFiles,baseFiles});
 demand(Array.isArray(deployments.deployments)&&deployments.deployments.length>0,'CONSOLIDATION_STAGE_DEPLOYMENTS_MISSING');
 const report={code:'FA_CONSOLIDATION_BACKEND_STAGE_PREVIEW',reviewedFiles:names.length,preservedFiles:remote.files.length-names.length,
  deployments:deployments.deployments.length,documents:plan.operations.length,sourcePreserved:true,remoteChanges:0};
 if(flag!=='--apply'){console.log(JSON.stringify(report));process.exit(0);}
 const tokens=new Map([['sahmt-17a16',await firebaseCliAccountToken('anestesiahmtforms@gmail.com')],['sahmt-gestao-5ae66',await firebaseCliAccountToken('anestesiahmtforms2@gmail.com')]]);
 const controls=createConsolidationControls({getToken:async project=>tokens.get(project)}),protector=await createPrivateJsonProtector();
 const writes=consolidationControlWrites({phase:'BLOCK',planSha256:plan.planSha256,verifiedDocuments:0});
 const previous=[];for(const write of writes)previous.push(await controls.read(write.projectId,write.path));
 const state={schemaVersion:1,status:'BACKED_UP',snapshotStamp:stamp,startedAt:new Date().toISOString(),remote,deployments,
  mergedSha256:snapshotDigest(merged.files.map(({name,type,source})=>({name,type,source:source.replaceAll('\r\n','\n')})).sort((a,b)=>a.name.localeCompare(b.name))),controls:writes.map((write,index)=>({write,previous:previous[index]})),completedDeployments:[]};
 const journal=resolve(dir,'cutover-stage-'+Date.now()+'.dpapi.json');
 const save=()=>writeFile(journal,JSON.stringify(protector.seal(state)),{mode:0o600});await save();
 for(let i=0;i<writes.length;i++){changed=true;await controls.patch(writes[i],previous[i]);}
 state.status='BLOCKED';await save();
 await client.updateContent(merged);const reread=await client.readContent();
 demand(names.every(name=>reread.files.find(file=>file.type==='SERVER_JS'&&file.name===name.slice(0,-3))?.source?.replaceAll('\r\n','\n')===localFiles[name].replaceAll('\r\n','\n')),'CONSOLIDATION_STAGE_SOURCE_POSTCHECK_FAILED');
 state.status='SOURCE_UPDATED';await save();
 const version=await client.createVersion();state.newVersion=version.versionNumber;await save();
 for(const deployment of deployments.deployments){
  // HEAD deployments follow the current saved source and cannot be versioned.
  if(!Number.isSafeInteger(deployment.deploymentConfig?.versionNumber))continue;
  await client.updateDeployment(deployment,version.versionNumber);state.completedDeployments.push(deployment.deploymentId);await save();
 }
 assertConsolidationDeployments({before:deployments,current:await client.readDeployments(),versionNumber:version.versionNumber});
 state.status='BACKEND_STAGED_DISABLED';state.quiescenceAfter=new Date(Date.now()+7*60*1000).toISOString();await save();
 console.log(JSON.stringify({...report,code:'FA_CONSOLIDATION_BACKEND_STAGED_DISABLED',remoteChanges:1,version:version.versionNumber,
  operationsEnabled:false,sourceClientsBlocked:true,quiescenceAfter:state.quiescenceAfter}));
}catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_STAGE_FAILED',remoteChangesPossible:changed,automaticRetry:false}));process.exitCode=1;}
