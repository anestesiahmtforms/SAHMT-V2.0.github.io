import{readFile,readdir,writeFile}from'node:fs/promises';import{resolve}from'node:path';
import{openPrivateJson,createPrivateJsonProtector}from'./lib/windows-protected-json.js';import{snapshotDigest}from'./lib/management-split-plan.js';
import{FA_PROJECT as FA,FC_PROJECT as FC,FC_CONSOLIDATION_COLLECTIONS,prepareFcConsolidationPlan}from'./lib/fa-consolidation-plan.js';
import{firebaseCliAccountToken}from'./lib/firebase-cli-account-token.js';import{createConsolidationControls}from'./lib/fa-consolidation-controls.js';
import{createConsolidationScriptClient}from'./lib/fa-consolidation-script-client.js';import{assertConsolidationDeployments}from'./lib/fa-consolidation-deployment.js';
import{createFaRuleReleaseClient}from'./lib/fa-rule-release-client.js';import{createFaCloudflareClient}from'./lib/fa-cloudflare-client.js';
import{captureFcConsolidationSnapshot}from'./lib/fa-consolidation-capture.js';import{restoreTypedSnapshotInEmulator}from'./lib/fa-consolidation-restore.js';
import{executeFaConsolidation}from'./lib/fa-consolidation-executor.js';import{createFaConsolidationRestAdapter}from'./lib/fa-consolidation-rest.js';
import{firestoreQuotaDayStart}from'./lib/management-read-budget.js';
const dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation'),demand=(value,code)=>{if(!value)throw Error(code);};let changed=false;
try{
 demand(process.argv.length===3&&process.argv[2]==='--apply','CONSOLIDATION_FC_APPLY_EXPLICIT_MODE_REQUIRED');
 const names=(await readdir(dir)).filter(name=>/^FC-stage-\d+\.dpapi.json$/.test(name)).sort();demand(names.length,'CONSOLIDATION_FC_STAGE_MISSING');
 const state=await openPrivateJson(JSON.parse(await readFile(resolve(dir,names.at(-1)),'utf8')));
 demand(state.status==='STAGED_DISABLED'&&Date.now()>=Date.parse(state.quiescenceAfter),'CONSOLIDATION_FC_QUIESCENCE_REQUIRED');
 const tokens=new Map([[FA,await firebaseCliAccountToken('anestesiahmtforms@gmail.com')],[FC,await firebaseCliAccountToken('anestesiahmtforms3@gmail.com')]]);
 const controls=createConsolidationControls({getToken:async id=>tokens.get(id)}),script=await createConsolidationScriptClient();
 const verifyBackend=async()=>{
  const content=await script.readContent();demand(snapshotDigest(content.files.map(({name,type,source})=>({name,type,source:source.replaceAll('\r\n','\n')})).sort((a,b)=>a.name.localeCompare(b.name)))===state.mergedSha256,'CONSOLIDATION_FC_BACKEND_DRIFT');
  assertConsolidationDeployments({before:state.deployments,current:await script.readDeployments(),versionNumber:state.newVersion});
  for(const projectId of [FA,FC]){const current=await createFaRuleReleaseClient({projectId,accessToken:tokens.get(projectId)}).read();demand(current.release.rulesetName===state.publishedRules[projectId].rulesetName,'CONSOLIDATION_FC_RULES_DRIFT');}
 };
 await verifyBackend();const currentMarker=await controls.read(FA,'occurrenceRuntime/faConsolidation');
 let expectedHash=currentMarker?.fields?.planSha256?.stringValue;
 demand(/^[a-f0-9]{64}$/.test(expectedHash||''),'CONSOLIDATION_FC_MARKER_HASH_INVALID');
 const assertBarrier=async()=>{
  const [fa,fc,management]=await Promise.all([controls.read(FA,'occurrenceRuntime/faConsolidation'),controls.read(FC,'occurrenceRuntime/faConsolidation'),controls.read(FA,'managementRuntime/faConsolidation')]);
  return fa?.fields?.status?.stringValue==='PREPARING'&&fa.fields.planSha256?.stringValue===expectedHash&&fc?.fields?.retired?.booleanValue===true&&management?.fields?.status?.stringValue==='ACTIVE';
 };
 demand(await assertBarrier(),'CONSOLIDATION_FC_BARRIER_MISSING');
 const readTime=new Date(Date.now()-30000).toISOString(),captures={};
 for(const projectId of [FC,FA])captures[projectId]=await captureFcConsolidationSnapshot({projectId,scope:FC_CONSOLIDATION_COLLECTIONS,readTime,accessToken:tokens.get(projectId),fetchImpl:fetch,includeRootInventory:true});
 demand(captures[FC].rootInventory.collections.every(name=>FC_CONSOLIDATION_COLLECTIONS.includes(name)||name==='occurrenceRuntime'),'CONSOLIDATION_FC_UNKNOWN_ROOTS');
 const input={source:captures[FC].snapshot,destination:captures[FA].snapshot,scope:FC_CONSOLIDATION_COLLECTIONS},plan=prepareFcConsolidationPlan(input);
 demand(plan.ready&&plan.operations.length>0&&plan.operations.length<=1000&&plan.operations.every(row=>['CREATE','SKIP'].includes(row.action)),'CONSOLIDATION_FC_PLAN_BLOCKED');
 const protector=await createPrivateJsonProtector(),stamp=Date.now(),save=async(name,value)=>{
  const path=resolve(dir,'FC-cutover-'+stamp+'-'+name+'.dpapi.json');await writeFile(path,JSON.stringify(protector.seal(value)),{mode:0o600});
  demand(snapshotDigest(protector.open(JSON.parse(await readFile(path,'utf8'))))===snapshotDigest(value),'CONSOLIDATION_FC_BACKUP_VERIFY_FAILED');
 };
 await save('snapshots',{input,plan});const restored=await restoreTypedSnapshotInEmulator({snapshot:input.source});
 demand(restored.verified===input.source.documents.length,'CONSOLIDATION_FC_RESTORE_INCOMPLETE');await save('restoration',restored);
 for(const id of [FA,FC]){
  const r=await fetch('https://cloudbilling.googleapis.com/v1/projects/'+id+'/billingInfo',{headers:{Authorization:'Bearer '+tokens.get(id)},redirect:'error',signal:AbortSignal.timeout(20000)});
  demand(r.ok,'CONSOLIDATION_FC_BILLING_UNVERIFIED');const info=await r.json();demand(info.billingEnabled===false&&!info.billingAccountName,'CONSOLIDATION_FC_BILLING_NOT_FREE');
 }
 const reports=(await readdir(dir)).filter(name=>/^usage-index-report-\d+\.json$/.test(name)).sort();
 const usage=JSON.parse(await readFile(resolve(dir,reports.at(-1)),'utf8'));
 demand(Date.now()-Date.parse(usage.observedAt)<30*60*1000&&usage.quotaDayStart===firestoreQuotaDayStart(Date.now()),'CONSOLIDATION_FC_QUOTA_STALE');
 demand(usage.projects.FA.read.complete===true&&Number.isFinite(usage.projects.FA.read.value)&&usage.projects.FA.read.value<35000
  &&usage.projects.FA.write.complete===true&&Number.isFinite(usage.projects.FA.write.value)&&usage.projects.FA.write.value+plan.counts.writes<15000,'CONSOLIDATION_FC_QUOTA_MARGIN');
 changed=true;await controls.patch({projectId:FA,path:'occurrenceRuntime/faConsolidation',fields:{planSha256:{stringValue:plan.planSha256},plannedDocuments:{integerValue:String(plan.operations.length)}}},await controls.read(FA,'occurrenceRuntime/faConsolidation'));expectedHash=plan.planSha256;
 const adapter=createFaConsolidationRestAdapter({plan,getSourceAccessToken:async()=>tokens.get(FC),getDestinationAccessToken:async()=>tokens.get(FA),fetchImpl:fetch,assertBarrier});
 const verification=await executeFaConsolidation({input,plan,mode:'APPLY',adapter,maxWrites:500,maxReads:5000,
  approval:{destinationProjectId:FA,planSha256:plan.planSha256,expiresAt:Date.now()+900000,gates:{backupVerified:true,restorationVerified:true,sourceWritersStopped:true,destinationWritersStopped:true,quotaBudgetVerified:true,sharedDataReviewed:true,backendPrepared:true,oldClientsBlocked:true}},
  onCheckpoint:value=>save('checkpoint',value)});
 demand(verification.code==='FA_CONSOLIDATION_VERIFIED'&&verification.verified===plan.operations.length&&verification.plannedDocuments===plan.operations.length&&verification.planSha256===plan.planSha256,'CONSOLIDATION_FC_COPY_INCOMPLETE');
 await save('verification',verification);await verifyBackend();
 const cf=await createFaCloudflareClient(),currentSettings=await cf.request('/workers/scripts/sahmt-auth-broker/settings');
 const signature=settings=>snapshotDigest(settings.bindings.toSorted((a,b)=>a.name.localeCompare(b.name)));
 const expectedSettings={...state.workerSettings,bindings:[...state.workerSettings.bindings.filter(b=>b.name!=='MANAGEMENT_SECONDARY_AUTH_RETIRED'),
  {name:'MANAGEMENT_SECONDARY_AUTH_RETIRED',type:'plain_text',text:'true'}]};
 demand([signature(state.workerSettings),signature(expectedSettings)].includes(signature(currentSettings)),'CONSOLIDATION_FC_WORKER_BINDINGS_DRIFT');
 const bundle=await readFile(resolve(dir,'worker-fa-occurrences','worker.js'),'utf8');demand(snapshotDigest(bundle)===state.bundleSha256,'CONSOLIDATION_FC_WORKER_BUNDLE_DRIFT');
 const metadata={main_module:'worker.js',bindings:expectedSettings.bindings.filter(binding=>!['secret_text','secret_key'].includes(binding.type)),keep_bindings:['secret_text','secret_key']};
 for(const key of ['compatibility_date','compatibility_flags','usage_model','logpush','observability','placement','tail_consumers','limits','tags'])if(currentSettings[key]!==undefined)metadata[key]=currentSettings[key];
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.js',new Blob([bundle],{type:'application/javascript+module'}),'worker.js');
 const beforeSource=await cf.request('/workers/scripts/sahmt-auth-broker',{raw:true});
 const worker=signature(currentSettings)===signature(expectedSettings)&&beforeSource.content.includes(bundle)?{alreadyEquivalent:true}:await cf.request('/workers/scripts/sahmt-auth-broker',{method:'PUT',body:form});
 const storedSettings=await cf.request('/workers/scripts/sahmt-auth-broker/settings');demand(signature(storedSettings)===signature(expectedSettings),'CONSOLIDATION_FC_WORKER_BINDINGS_POSTCHECK_FAILED');
 const workerSource=await cf.request('/workers/scripts/sahmt-auth-broker',{raw:true});demand(workerSource.content.includes(bundle),'CONSOLIDATION_FC_WORKER_SOURCE_POSTCHECK_FAILED');await save('worker',{result:worker,settings:storedSettings});
 demand(await assertBarrier(),'CONSOLIDATION_FC_BARRIER_LOST');
 await controls.patch({projectId:FA,path:'occurrenceRuntime/faConsolidation',fields:{status:{stringValue:'ACTIVE'},verifiedDocuments:{integerValue:String(verification.verified)},plannedDocuments:{integerValue:String(verification.plannedDocuments)},migrationCode:{stringValue:verification.code}}},await controls.read(FA,'occurrenceRuntime/faConsolidation'));
 await save('activation',{activatedAt:new Date().toISOString(),verification,sourcePreserved:true});
 console.log(JSON.stringify({code:'FC_CONSOLIDATION_DATA_ACTIVE',verified:verification.verified,writes:verification.writes,sourcePreserved:true,identityChanges:0,workerBindingsPreserved:storedSettings.bindings.length,
  workerSecretsPreserved:storedSettings.bindings.filter(b=>b.type==='secret_text').length,pwaPublished:false}));
}catch(error){console.error(JSON.stringify({code:/^(CONSOLIDATION|OCCURRENCE|CLI_ACCOUNT)_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_FC_APPLY_FAILED',remoteChangesPossible:changed,automaticRetry:false,sourcePreserved:true}));process.exitCode=1;}
