import{readFile,readdir,writeFile}from'node:fs/promises';import{resolve}from'node:path';import{execFileSync}from'node:child_process';
import{openPrivateJson,createPrivateJsonProtector}from'./lib/windows-protected-json.js';
import{firebaseCliAccountToken}from'./lib/firebase-cli-account-token.js';import{snapshotDigest}from'./lib/management-split-plan.js';
import{prepareFcConsolidationPlan}from'./lib/fa-consolidation-plan.js';import{createConsolidationControls}from'./lib/fa-consolidation-controls.js';
import{createConsolidationScriptClient}from'./lib/fa-consolidation-script-client.js';
import{mergeConsolidationScript,assertConsolidationDeployments}from'./lib/fa-consolidation-deployment.js';
import{prepareOccurrenceFaRules,prepareOccurrenceSourceRules}from'./lib/occurrence-fa-rules.js';
import{createFaRuleReleaseClient}from'./lib/fa-rule-release-client.js';import{createFaCloudflareClient}from'./lib/fa-cloudflare-client.js';
const FA='sahmt-17a16',FC='indicadores---sahmt',dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');
const demand=(value,code)=>{if(!value)throw Error(code);};let changed=false;
try{
 const apply=process.argv.length===3&&process.argv[2]==='--apply';demand(process.argv.length===2||apply,'CONSOLIDATION_FC_STAGE_ARGUMENT_INVALID');
 const files=await readdir(dir),inputName=files.filter(name=>/^FC-\d{17}\.dpapi.json$/.test(name)).sort().at(-1);
 const captured=await openPrivateJson(JSON.parse(await readFile(resolve(dir,inputName),'utf8'))),plan=prepareFcConsolidationPlan(captured.input);
 demand(plan.ready&&plan.operations.length>0&&plan.counts.conflicts===0,'CONSOLIDATION_FC_PLAN_NOT_READY');
 const tokens=new Map([[FA,await firebaseCliAccountToken('anestesiahmtforms@gmail.com')],[FC,await firebaseCliAccountToken('anestesiahmtforms3@gmail.com')]]);
 const ruleClients={},rules={},preparedRules={};
 for(const id of [FA,FC]){ruleClients[id]=createFaRuleReleaseClient({projectId:id,accessToken:tokens.get(id)});rules[id]=await ruleClients[id].read();}
 const faSource=rules[FA].rules.source.files[0].content,fcSource=rules[FC].rules.source.files[0].content;
 preparedRules[FA]=prepareOccurrenceFaRules(faSource,fcSource);preparedRules[FC]=prepareOccurrenceSourceRules(fcSource);
 demand(faSource.includes('function faDomainOpen_'),'CONSOLIDATION_FC_FA_EXISTING_GATE_MISSING');
 const script=await createConsolidationScriptClient(),remote=await script.readContent(),deployments=await script.readDeployments();
 const localFiles={},baseFiles={},git=resolve(process.env.LOCALAPPDATA,'SAHMT','tools','mingit-2.56.0.2','cmd','git.exe');
 for(const name of ['EvaluationLedger.gs','EvaluationOccurrenceDelivery.gs']){
  localFiles[name]=await readFile(resolve('apps-script-v2',name),'utf8');
  baseFiles[name]=execFileSync(git,['show','b51288c:apps-script-v2/'+name],{encoding:'utf8',windowsHide:true});
 }
 const merged=mergeConsolidationScript({remote,baseFiles,localFiles});
 const cf=await createFaCloudflareClient(),workerSettings=await cf.request('/workers/scripts/sahmt-auth-broker/settings');
 const workerSource=await cf.request('/workers/scripts/sahmt-auth-broker',{raw:true}),workerDeployments=await cf.request('/workers/scripts/sahmt-auth-broker/deployments');
 const bundle=await readFile(resolve(dir,'worker-fa-occurrences','worker.js'),'utf8');
 demand(bundle.includes('sahmt-17a16')&&bundle.includes('OCCURRENCE_SCORE_AUTHOR_DENIED'),'CONSOLIDATION_FC_WORKER_BUNDLE_INVALID');
 const report={code:'FC_CONSOLIDATION_STAGE_PREVIEW',documents:plan.operations.length,rulesProjects:2,scriptFiles:2,
  scriptPreservedFiles:remote.files.length-2,workerBindings:workerSettings.bindings.length,workerSecretsPreserved:workerSettings.bindings.filter(b=>b.type==='secret_text').length,remoteChanges:0};
 if(!apply){console.log(JSON.stringify(report));process.exit(0);}
 const controls=createConsolidationControls({getToken:async id=>tokens.get(id)}),marker=await controls.read(FA,'managementRuntime/faConsolidation');
 demand(marker?.fields?.status?.stringValue==='ACTIVE','CONSOLIDATION_FC_MANAGEMENT_NOT_ACTIVE');
 const protector=await createPrivateJsonProtector(),journal=resolve(dir,'FC-stage-'+Date.now()+'.dpapi.json');
 const state={schemaVersion:1,status:'BACKED_UP',capturedInput:inputName,planSha256:plan.planSha256,rules,preparedRules,remote,deployments,
  workerSettings,workerSource,workerDeployments,bundleSha256:snapshotDigest(bundle),
  mergedSha256:snapshotDigest(merged.files.map(({name,type,source})=>({name,type,source:source.replaceAll('\r\n','\n')})).sort((a,b)=>a.name.localeCompare(b.name))),controls:[],completedDeployments:[]};
 const save=async()=>{const value=protector.seal(state);await writeFile(journal,JSON.stringify(value),{mode:0o600});demand(snapshotDigest(protector.open(value))===snapshotDigest(state),'CONSOLIDATION_FC_BACKUP_VERIFY_FAILED');};
 for(const id of [FA,FC])state.controls.push({projectId:id,path:'occurrenceRuntime/faConsolidation',previous:await controls.read(id,'occurrenceRuntime/faConsolidation')});
 await save();
 const fields={schemaVersion:{integerValue:'1'},release:{stringValue:'occurrence-fa-consolidation-v1'},status:{stringValue:'PREPARING'},
  sourceProjectId:{stringValue:FC},destinationProjectId:{stringValue:FA},planSha256:{stringValue:plan.planSha256},verifiedDocuments:{integerValue:'0'},plannedDocuments:{integerValue:String(plan.operations.length)}};
 for(const item of state.controls){changed=true;await controls.patch({...item,fields:item.projectId===FA?fields:{retired:{booleanValue:true},release:{stringValue:'occurrence-fa-consolidation-v1'}}},item.previous);}
 state.status='MARKERS_PREPARED';await save();state.publishedRules={};
 for(const id of [FA,FC]){state.publishedRules[id]=await ruleClients[id].publish(preparedRules[id],rules[id]);await save();}
 await script.updateContent(merged);
 const current=await script.readContent();demand(Object.entries(localFiles).every(([name,source])=>current.files.find(f=>f.name===name.slice(0,-3))?.source?.replaceAll('\r\n','\n')===source.replaceAll('\r\n','\n')),'CONSOLIDATION_FC_SCRIPT_POSTCHECK_FAILED');
 const version=await script.createVersion();state.newVersion=version.versionNumber;await save();
 for(const deployment of deployments.deployments){if(!Number.isSafeInteger(deployment.deploymentConfig?.versionNumber))continue;
  await script.updateDeployment(deployment,version.versionNumber);state.completedDeployments.push(deployment.deploymentId);await save();}
 assertConsolidationDeployments({before:deployments,current:await script.readDeployments(),versionNumber:version.versionNumber});
 state.status='STAGED_DISABLED';state.quiescenceAfter=new Date(Date.now()+7*60*1000).toISOString();await save();
 console.log(JSON.stringify({...report,code:'FC_CONSOLIDATION_STAGED_DISABLED',remoteChanges:1,version:version.versionNumber,quiescenceAfter:state.quiescenceAfter,sourcePreserved:true}));
}catch(error){console.error(JSON.stringify({code:/^(CONSOLIDATION|OCCURRENCE)_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_FC_STAGE_FAILED',remoteChangesPossible:changed,automaticRetry:false}));process.exitCode=1;}
