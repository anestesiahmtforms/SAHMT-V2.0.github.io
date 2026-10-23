import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
import {captureScoped} from './lib/fa-consolidation-capture.js';
import {snapshotDigest,validateSplitSnapshot} from './lib/management-split-plan.js';

const FA='sahmt-17a16',FC='indicadores---sahmt';
const OCCURRENCE=['occurrenceAudit','occurrenceCatalogs','occurrenceReports','occurrenceScoreClaims'];
const QMENTUM=['qmentumAccess','qmentumAnalysisJobs','qmentumAnalysisReviewRequests','qmentumConfig','qmentumDefinitions',
 'qmentumParticipationReviews','qmentumParticipations','qmentumUnits','qmentumWriteRequests'];
const SCOPE=[...OCCURRENCE,...QMENTUM].sort();
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const stamp=()=>new Date().toISOString().replace(/[^0-9]/g,'');
const base=project=>'projects/'+project+'/databases/(default)/documents';
const isQmentum=path=>QMENTUM.includes(path.split('/')[0]);
const isModule=path=>SCOPE.includes(path.split('/')[0]);
const encodePath=path=>path.split('/').map(encodeURIComponent).join('/');
function rewriteReferences(value,sourceRows){
 if(Array.isArray(value))return value.map(item=>rewriteReferences(item,sourceRows));
 if(!value||typeof value!=='object')return value;
 if(typeof value.referenceValue==='string'&&value.referenceValue.startsWith(base(FA)+'/')){
  const path=value.referenceValue.slice((base(FA)+'/').length);
  if(isModule(path))return {referenceValue:base(FC)+'/'+path};
  if(path.startsWith('users/'))return {referenceValue:base(FC)+'/'+path};
  throw Error('QMENTUM_REFERENCE_OUTSIDE_MIGRATION_SCOPE');
 }
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewriteReferences(item,sourceRows)]));
}
function plan(source,destination){
 validateSplitSnapshot(source);validateSplitSnapshot(destination);
 demand(source.projectId===FA&&destination.projectId===FC&&SCOPE.every(name=>source.coverage.rootCollections.includes(name)&&destination.coverage.rootCollections.includes(name)),'QMENTUM_SNAPSHOT_SCOPE_INVALID');
 const src=source.documents.filter(row=>isQmentum(row.path)),dst=new Map(destination.documents.filter(row=>isQmentum(row.path)).map(row=>[row.path,row]));
 const operations=[],conflicts=[];let equivalent=0;
 for(const row of src){let fields;try{fields=rewriteReferences(row.fields,source.documents);}catch{conflicts.push({path:row.path,code:'QMENTUM_REFERENCE_OUTSIDE_MIGRATION_SCOPE'});continue;}
  const old=dst.get(row.path);
  if(!old)operations.push({path:row.path,action:'CREATE',fields,precondition:{exists:false}});
  else if(snapshotDigest(old.fields)===snapshotDigest(fields))equivalent++;
  else conflicts.push({path:row.path,code:'QMENTUM_DESTINATION_CONFLICT'});
 }
 const sourceOcc=source.documents.filter(row=>OCCURRENCE.includes(row.path.split('/')[0])),destOcc=new Map(destination.documents.filter(row=>OCCURRENCE.includes(row.path.split('/')[0])).map(row=>[row.path,row]));
 let occurrenceEquivalent=0;for(const row of sourceOcc){const old=destOcc.get(row.path);if(old&&snapshotDigest(old.fields)===snapshotDigest(row.fields))occurrenceEquivalent++;else conflicts.push({path:row.path,code:old?'OCCURRENCE_DESTINATION_CONFLICT':'OCCURRENCE_DESTINATION_MISSING'});}
 const destinationOnly=destination.documents.filter(row=>isQmentum(row.path)&&!src.some(item=>item.path===row.path)).length;
 return {schemaVersion:1,sourceProjectId:FA,destinationProjectId:FC,readTimes:{FA:source.readTime,FC:destination.readTime},counts:{qmentumSource:src.length,qmentumDestination:dst.size,create:operations.length,equivalent,destinationOnly,occurrenceSource:sourceOcc.length,occurrenceEquivalent,conflicts:conflicts.length},operations,conflicts,ready:conflicts.length===0};
}
async function api(token,url,method='GET',body){
 let response;try{response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('QMENTUM_MIGRATION_NETWORK');}
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('QMENTUM_MIGRATION_HTTP_'+response.status);}
 const text=await response.text();demand(Buffer.byteLength(text)<=8*1024*1024,'QMENTUM_MIGRATION_RESPONSE_LIMIT');return text?JSON.parse(text):{};
}
async function capture(projectId,token){
 const readTime=new Date(Date.now()-30000).toISOString();
 return (await captureScoped({projectId,scope:SCOPE,readTime,accessToken:token,fetchImpl:fetch,includeRootInventory:true,maxDocuments:3000,maxRequests:6000,maxBytes:64*1024*1024},[FA,FC],SCOPE)).snapshot;
}
async function configuration(token){
 const prefix='https://firestore.googleapis.com/v1/projects/'+FC+'/databases/(default)';
  stage='READ_BILLING';const billing=await api(token,'https://cloudbilling.googleapis.com/v1/projects/'+FC+'/billingInfo');
  stage='READ_INDEXES';const indexes=await api(token,prefix+'/collectionGroups/-/indexes');
  stage='READ_RULES_RELEASE';const release=await api(token,'https://firebaserules.googleapis.com/v1/projects/'+FC+'/releases/cloud.firestore');
  stage='READ_RULESET';
  const rules=await api(token,'https://firebaserules.googleapis.com/v1/'+release.rulesetName);
 return {billing:{billingEnabled:billing.billingEnabled===true,billingAccountName:billing.billingAccountName||null},indexes,rules:{release,rules}};
}
let stage='START',diagnostics=null;
async function main(){
 const [mode,selected]=process.argv.slice(2);demand(['preview','copy','verify','delete-source'].includes(mode)&&(!selected||/^FC-\d{17}\.dpapi\.json$/.test(selected)),'QMENTUM_MIGRATION_ARGUMENT_INVALID');
 demand(process.env.LOCALAPPDATA,'QMENTUM_MIGRATION_PRIVATE_PATH_REQUIRED');
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','qmentum-fc-migration');await mkdir(directory,{recursive:true});
 stage='AUTH';const tokenFA=await firebaseCliAccountToken('anestesiahmtforms@gmail.com'),tokenFC=await firebaseCliAccountToken('anestesiahmtforms3@gmail.com');
 let input,planValue,settings,protector,backupPath;
 if(mode==='preview'||mode==='copy'){
  stage='CAPTURE_FA';const source=await capture(FA,tokenFA);stage='CAPTURE_FC';const destination=await capture(FC,tokenFC);
  stage='READ_FC_CONFIG';settings=await configuration(tokenFC);
  demand(settings.billing.billingEnabled===false,'QMENTUM_MIGRATION_BILLING_ENABLED');
  planValue=plan(source,destination);demand(planValue.ready,'QMENTUM_MIGRATION_CONFLICTS');
  input={schemaVersion:1,source,destination,settings,plan:planValue,createdAt:new Date().toISOString()};
  protector=await createPrivateJsonProtector();backupPath=resolve(directory,'FC-'+stamp()+'.dpapi.json');
  await writeFile(backupPath,JSON.stringify(protector.seal(input)),{flag:'wx',mode:0o600});
  const opened=await openPrivateJson(JSON.parse(await readFile(backupPath,'utf8')));demand(snapshotDigest(opened)===snapshotDigest(input),'QMENTUM_MIGRATION_BACKUP_VERIFY_FAILED');
 }else{
  const files=await readdir(directory),name=selected||files.filter(file=>/^FC-\d{17}\.dpapi\.json$/.test(file)).sort().at(-1);
  demand(name,'QMENTUM_MIGRATION_BACKUP_MISSING');backupPath=resolve(directory,name);input=await openPrivateJson(JSON.parse(await readFile(backupPath,'utf8')));planValue=plan(input.source,input.destination);
  demand(planValue.ready&&snapshotDigest(planValue)===snapshotDigest(input.plan),'QMENTUM_MIGRATION_BACKUP_STALE');
 }
 let writes=0,deletes=0;
 if(mode==='copy'){
  demand(planValue.operations.length<=400,'QMENTUM_MIGRATION_BATCH_LIMIT');
  if(planValue.operations.length){const body={writes:planValue.operations.map(item=>({update:{name:base(FC)+'/'+item.path,fields:item.fields},currentDocument:{exists:false}}))};
   const result=await api(tokenFC,'https://firestore.googleapis.com/v1/'+base(FC)+':commit','POST',body);
   demand(Array.isArray(result.writeResults)&&result.writeResults.length===planValue.operations.length,'QMENTUM_MIGRATION_COMMIT_INVALID');writes=result.writeResults.length;}
 }
 if(mode==='verify'||mode==='delete-source'){
  const [currentFA,currentFC]=await Promise.all([capture(FA,tokenFA),capture(FC,tokenFC)]),currentPlan=plan(currentFA,currentFC);diagnostics=currentPlan.counts;
  demand(currentPlan.ready&&currentPlan.counts.create===0&&currentPlan.counts.qmentumSource===currentPlan.counts.qmentumDestination&&currentPlan.counts.equivalent===currentPlan.counts.qmentumSource&&currentPlan.counts.occurrenceEquivalent===currentPlan.counts.occurrenceSource,'QMENTUM_MIGRATION_FINAL_VERIFY_FAILED');
  if(mode==='delete-source'){
   settings=await configuration(tokenFC);demand(settings.billing.billingEnabled===false,'QMENTUM_MIGRATION_BILLING_ENABLED');
   const protector=await createPrivateJsonProtector(),retirement={schemaVersion:1,source:currentFA,destination:currentFC,settings,plan:currentPlan,createdAt:new Date().toISOString()};
   const retirementBackup=resolve(directory,'FA-retirement-'+stamp()+'.dpapi.json');
   await writeFile(retirementBackup,JSON.stringify(protector.seal(retirement)),{flag:'wx',mode:0o600});
   demand(snapshotDigest(await openPrivateJson(JSON.parse(await readFile(retirementBackup,'utf8'))))===snapshotDigest(retirement),'QMENTUM_RETIREMENT_BACKUP_VERIFY_FAILED');
   const sourceRows=currentFA.documents.filter(row=>isModule(row.path));demand(sourceRows.length<=400,'QMENTUM_SOURCE_DELETE_BATCH_LIMIT');
   const result=await api(tokenFA,'https://firestore.googleapis.com/v1/'+base(FA)+':commit','POST',{writes:sourceRows.map(row=>({delete:base(FA)+'/'+row.path,currentDocument:{updateTime:row.updateTime}}))});
   demand(Array.isArray(result.writeResults)&&result.writeResults.length===sourceRows.length,'QMENTUM_SOURCE_DELETE_INVALID');deletes=result.writeResults.length;
  }
  planValue=currentPlan;
 }
 const report={code:mode==='preview'?'QMENTUM_FC_MIGRATION_PREVIEW':mode==='copy'?'QMENTUM_FC_COPY_APPLIED':mode==='verify'?'QMENTUM_FC_MIGRATION_VERIFIED':'QMENTUM_FA_MODULE_DATA_RETIRED',mode,...planValue.counts,sourceQmentumPreserved:mode!=='delete-source',writes,deletes,billingEnabled:settings?.billing?.billingEnabled??input.settings?.billing?.billingEnabled,privateBackup:backupPath};
 const reportPath=resolve(directory,(mode==='preview'?'preview':mode)+'-'+Date.now()+'.json');await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(JSON.stringify({code:/^QMENTUM_[A-Z0-9_]+$/.test(error.message||'')?error.message:'QMENTUM_FC_MIGRATION_FAILED',stage,...(diagnostics?{counts:diagnostics}:{}),remoteWrites:0,sourceDeletes:0}));process.exitCode=1;});
