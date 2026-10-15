import {readFile,readdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {openPrivateJson,createPrivateJsonProtector} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {FA_CONSOLIDATION_COLLECTIONS,prepareFaConsolidationPlan,faConsolidationReport} from './lib/fa-consolidation-plan.js';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createConsolidationControls} from './lib/fa-consolidation-controls.js';
import {consolidationControlWrites,assertConsolidationDeployments} from './lib/fa-consolidation-deployment.js';
import {createConsolidationScriptClient} from './lib/fa-consolidation-script-client.js';
import {captureFaConsolidationSnapshot} from './lib/fa-consolidation-capture.js';
import {restoreTypedSnapshotInEmulator} from './lib/fa-consolidation-restore.js';
import {executeFaConsolidation} from './lib/fa-consolidation-executor.js';
import {createFaConsolidationRestAdapter} from './lib/fa-consolidation-rest.js';
import {firestoreQuotaDayStart} from './lib/management-read-budget.js';
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');
const demand=(value,code)=>{if(!value)throw Error(code);};
let writesPossible=false;
try{
 demand(process.argv.length===3&&process.argv[2]==='--apply','CONSOLIDATION_APPLY_EXPLICIT_MODE_REQUIRED');
 const names=(await readdir(dir)).filter(name=>/^cutover-stage-\d+\.dpapi.json$/.test(name)).sort();
 demand(names.length>0,'CONSOLIDATION_APPLY_STAGE_MISSING');
 const stage=await openPrivateJson(JSON.parse(await readFile(resolve(dir,names.at(-1)),'utf8')));
 demand(stage.status==='BACKEND_STAGED_DISABLED'&&Date.now()>=Date.parse(stage.quiescenceAfter),'CONSOLIDATION_APPLY_QUIESCENCE_REQUIRED');
 const client=await createConsolidationScriptClient(),source=await client.readContent();
 const scriptHash=snapshotDigest(source.files.map(({name,type,source})=>({name,type,source:source.replaceAll('\r\n','\n')})).sort((a,b)=>a.name.localeCompare(b.name)));
 demand(scriptHash===stage.mergedSha256,'CONSOLIDATION_APPLY_BACKEND_DRIFT');
 const verifyDeployments=async()=>assertConsolidationDeployments({before:stage.deployments,current:await client.readDeployments(),versionNumber:stage.newVersion});
 await verifyDeployments();
 const tokens=new Map([[FA,await firebaseCliAccountToken('anestesiahmtforms@gmail.com')],[FB,await firebaseCliAccountToken('anestesiahmtforms2@gmail.com')]]);
 const controls=createConsolidationControls({getToken:async project=>tokens.get(project)});
 let expectedHash=stage.controls[0].write.fields.planSha256.stringValue;
 const assertBarrier=async()=>{
  const [marker,fa,fb]=await Promise.all([controls.read(FA,'managementRuntime/faConsolidation'),controls.read(FA,'managementRuntime/domainCutover'),controls.read(FB,'managementRuntime/domainCutover')]);
  return marker?.fields?.status?.stringValue==='PREPARING'&&marker.fields.planSha256?.stringValue===expectedHash
   &&fa?.fields?.retired?.booleanValue===true&&fa.fields.sourceWritesBlocked?.booleanValue===true
   &&fb?.fields?.evaluationEnabled?.booleanValue===false&&fb.fields.managementEnabled?.booleanValue===false;
 };
 demand(await assertBarrier(),'CONSOLIDATION_APPLY_BARRIER_MISSING');
 const readTime=new Date(Date.now()-30000).toISOString(),scope=FA_CONSOLIDATION_COLLECTIONS.filter(x=>!['auditLogs','notifications','notificationGroups'].includes(x));
 const captures={};for(const projectId of [FB,FA])captures[projectId]=await captureFaConsolidationSnapshot({projectId,scope,readTime,accessToken:tokens.get(projectId),fetchImpl:fetch,includeRootInventory:true});
 const unknown=captures[FB].rootInventory.collections.filter(name=>!scope.includes(name)&&!['managementAuthorizationFences','managementAuthorizationLeases','managementRuntime'].includes(name));
 demand(unknown.length===0,'CONSOLIDATION_APPLY_UNKNOWN_SOURCE_ROOTS');
 const input={source:captures[FB].snapshot,destination:captures[FA].snapshot,scope},plan=prepareFaConsolidationPlan(input);
 demand(plan.ready&&plan.operations.length>0&&plan.operations.length<=1000&&plan.operations.every(row=>['CREATE','SKIP'].includes(row.action)),'CONSOLIDATION_APPLY_PLAN_BLOCKED');
 const protector=await createPrivateJsonProtector(),stamp=Date.now(),save=async(name,value)=>{
  const file=resolve(dir,'cutover-'+stamp+'-'+name+'.dpapi.json'),sealed=protector.seal(value);await writeFile(file,JSON.stringify(sealed),{mode:0o600});
  demand(snapshotDigest(protector.open(JSON.parse(await readFile(file,'utf8'))))===snapshotDigest(value),'CONSOLIDATION_APPLY_BACKUP_VERIFY_FAILED');
 };
 await save('final-snapshots',captures);await save('final-plan',{input,plan});
 const restored=await restoreTypedSnapshotInEmulator({snapshot:input.source});
 demand(restored.verified===input.source.documents.length,'CONSOLIDATION_APPLY_RESTORE_FAILED');
 await save('restoration',restored);
 await verifyDeployments();
 // Recheck billing status only. This code has no enable-api, IAM or billing setter.
 for(const projectId of [FA,FB]){
  const response=await fetch('https://cloudbilling.googleapis.com/v1/projects/'+projectId+'/billingInfo',{headers:{Authorization:'Bearer '+tokens.get(projectId)},redirect:'error',signal:AbortSignal.timeout(20000)});
  demand(response.ok,'CONSOLIDATION_APPLY_BILLING_STATE_UNAVAILABLE');const billing=await response.json();demand(billing.billingEnabled===false&&!billing.billingAccountName,'CONSOLIDATION_APPLY_BILLING_NOT_FREE');
 }
 const reports=(await readdir(dir)).filter(name=>/^usage-index-report-\d+\.json$/.test(name)).sort();
 demand(reports.length>0,'CONSOLIDATION_APPLY_QUOTA_EVIDENCE_REQUIRED');
 const usage=JSON.parse(await readFile(resolve(dir,reports.at(-1)),'utf8'));
 demand(Date.now()-Date.parse(usage.observedAt)<30*60*1000&&usage.quotaDayStart===firestoreQuotaDayStart(Date.now()),'CONSOLIDATION_APPLY_QUOTA_EVIDENCE_STALE');
 for(const alias of ['FA','FB']){
  const metrics=usage.projects[alias];
  demand(metrics?.read?.complete===true&&metrics?.write?.complete===true
   &&Number.isFinite(metrics.read.value)&&Number.isFinite(metrics.write.value)
   &&metrics.read.value<35000&&metrics.write.value+plan.counts.writes<15000,'CONSOLIDATION_APPLY_QUOTA_MARGIN_INSUFFICIENT');
 }
 const pending=consolidationControlWrites({phase:'BLOCK',planSha256:plan.planSha256,verifiedDocuments:0})[0];
 writesPossible=true;await controls.patch(pending,await controls.read(FA,pending.path));expectedHash=plan.planSha256;
 const adapter=createFaConsolidationRestAdapter({plan,getSourceAccessToken:async()=>tokens.get(FB),getDestinationAccessToken:async()=>tokens.get(FA),fetchImpl:fetch,assertBarrier});
 const approval={destinationProjectId:FA,planSha256:plan.planSha256,expiresAt:Date.now()+15*60*1000,gates:{backupVerified:true,restorationVerified:true,sourceWritersStopped:true,destinationWritersStopped:true,quotaBudgetVerified:true,sharedDataReviewed:true,backendPrepared:true,oldClientsBlocked:true}};
 const verification=await executeFaConsolidation({input,plan,mode:'APPLY',approval,adapter,maxWrites:500,maxReads:5000,onCheckpoint:checkpoint=>save('checkpoint',checkpoint)});
 demand(verification.code==='FA_CONSOLIDATION_VERIFIED'&&verification.verified===plan.operations.length,'CONSOLIDATION_APPLY_INCOMPLETE');
 await save('verification',verification);
 await verifyDeployments();
 const activation=consolidationControlWrites({phase:'ACTIVATE',planSha256:plan.planSha256,verifiedDocuments:verification.verified,plan,verification});
 for(const write of activation)await controls.patch(write,await controls.read(write.projectId,write.path));
 await save('activation',{activatedAt:new Date().toISOString(),verification,sourcePreserved:true});
 console.log(JSON.stringify({...faConsolidationReport(plan),code:'FA_CONSOLIDATION_DATA_ACTIVE',verification,sourcePreserved:true,identityChanges:0,productionPwaPublished:false}));
}catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_APPLY_FAILED',writesPossible,automaticRetry:false,sourcePreserved:true}));process.exitCode=1;}
