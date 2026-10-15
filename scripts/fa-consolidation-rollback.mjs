import {readFile,readdir} from 'node:fs/promises';import {resolve} from 'node:path';
import {openPrivateJson} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createConsolidationControls} from './lib/fa-consolidation-controls.js';
import {createConsolidationScriptClient} from './lib/fa-consolidation-script-client.js';
import {assertConsolidationDeployments} from './lib/fa-consolidation-deployment.js';
import {captureFaConsolidationSnapshot} from './lib/fa-consolidation-capture.js';
const dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation'),FA='sahmt-17a16',FB='sahmt-gestao-5ae66';
const demand=(value,code)=>{if(!value)throw Error(code);};let changed=false;
try{
 const apply=process.argv.length===3&&process.argv[2]==='--restore-before-copy';
 demand(process.argv.length===2||apply,'CONSOLIDATION_ROLLBACK_MODE_INVALID');
 const files=(await readdir(dir)).filter(name=>/^cutover-stage-\d+\.dpapi.json$/.test(name)).sort();demand(files.length,'CONSOLIDATION_ROLLBACK_STAGE_MISSING');
 const stage=await openPrivateJson(JSON.parse(await readFile(resolve(dir,files.at(-1)),'utf8')));
 const plan=await openPrivateJson(JSON.parse(await readFile(resolve(dir,stage.snapshotStamp+'-plan.dpapi.json'),'utf8')));
 const tokens=new Map([[FA,await firebaseCliAccountToken('anestesiahmtforms@gmail.com')],[FB,await firebaseCliAccountToken('anestesiahmtforms2@gmail.com')]]);
 const controls=createConsolidationControls({getToken:async project=>tokens.get(project)});
 const marker=await controls.read(FA,'managementRuntime/faConsolidation');
 demand(marker?.fields?.status?.stringValue==='PREPARING'&&marker.fields.verifiedDocuments?.integerValue==='0','CONSOLIDATION_ROLLBACK_DELTA_RECONCILIATION_REQUIRED');
 const capture=await captureFaConsolidationSnapshot({projectId:FA,scope:plan.scope,readTime:new Date(Date.now()-30000).toISOString(),accessToken:tokens.get(FA),fetchImpl:fetch});
 demand(capture.snapshot.documents.length===0,'CONSOLIDATION_ROLLBACK_DELTA_RECONCILIATION_REQUIRED');
 const client=await createConsolidationScriptClient(),current=await client.readContent();
 const hash=files=>snapshotDigest(files.map(({name,type,source})=>({name,type,source:source.replaceAll('\r\n','\n')})).sort((a,b)=>a.name.localeCompare(b.name)));
 demand(hash(current.files)===stage.mergedSha256,'CONSOLIDATION_ROLLBACK_SOURCE_DRIFT');
 assertConsolidationDeployments({before:stage.deployments,current:await client.readDeployments(),versionNumber:stage.newVersion});
 if(!apply){console.log(JSON.stringify({code:'FA_CONSOLIDATION_ROLLBACK_BEFORE_COPY_AVAILABLE',destinationDocuments:0,remoteChanges:0}));process.exit(0);}
 changed=true;await client.updateContent(stage.remote);
 demand(hash((await client.readContent()).files)===hash(stage.remote.files),'CONSOLIDATION_ROLLBACK_SOURCE_POSTCHECK_FAILED');
 for(const deployment of stage.deployments.deployments)if(Number.isSafeInteger(deployment.deploymentConfig?.versionNumber))await client.updateDeployment(deployment,deployment.deploymentConfig.versionNumber);
 for(const item of stage.controls){
  const fields=item.previous?.fields||{status:{stringValue:'ROLLED_BACK'}};
  await controls.patch({...item.write,fields},await controls.read(item.write.projectId,item.write.path));
 }
 console.log(JSON.stringify({code:'FA_CONSOLIDATION_ROLLBACK_BEFORE_COPY_COMPLETED',dataDeleted:0,sourcePreserved:true,remoteChanges:1}));
}catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_ROLLBACK_FAILED',remoteChangesPossible:changed,automaticRetry:false}));process.exitCode=1;}
