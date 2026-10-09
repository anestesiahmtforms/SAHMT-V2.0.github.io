import {readFile,lstat,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {openPrivateJson} from './lib/windows-protected-json.js';
import {snapshotDigest,prepareSplitPlan} from './lib/management-split-plan.js';
import {validateManagementMigrationExecution,executeManagementMigration} from './lib/management-migration-executor.js';
import {createManagementMigrationFirestoreRest} from './lib/management-migration-firestore-rest.js';
import {createManagementMigrationPrivateStore} from './lib/management-migration-private-store.js';
import {createFbMigrationDestinationBudget,assessFbMigrationDestinationBudget,acknowledgeFbMigrationDestinationReservation,pauseFbMigrationDestinationBudget,finishFbMigrationDestinationBudget,fbMigrationDestinationPolicySha256,validateFbMigrationDestinationBudgetProof} from './lib/management-migration-destination-budget.js';
const FB='sahmt-gestao-5ae66',PURPOSE='MANAGEMENT_MIGRATION_CREATE_ONLY';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(root,'.local-preview/management-split');
const fail=code=>{throw Error(code);};
const demand=(ok,code)=>{if(!ok)fail(code);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const safe=e=>/^[A-Z][A-Z0-9_]{2,100}$/.test(e?.message||'')?e.message:'MIGRATION_CLI_FAILED';
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
async function privateFile(name){
 demand(typeof name==='string'&&name===basename(name)&&/^[A-Za-z0-9._-]+\.dpapi\.json$/.test(name),'MIGRATION_PRIVATE_INPUT_NAME_INVALID');
 const file=resolve(directory,name),relation=relative(directory,file);
 demand(!isAbsolute(relation)&&!relation.startsWith('..')&&!(await lstat(file)).isSymbolicLink(),'MIGRATION_PRIVATE_INPUT_LINK_FORBIDDEN');
 return openPrivateJson(await json(file));
}
let store,reads=0,writes=0,phase='LOCAL_REVIEW';
try{
 const [mode,name]=process.argv.slice(2);
 demand(['--review','--copy'].includes(mode)&&process.argv.length===(name?4:3),'USE_REVIEW_OR_COPY_PRIVATE_CAPSULE');
 for(const path of [resolve(root,'.local-preview'),directory])demand(!(await lstat(path)).isSymbolicLink(),'MIGRATION_PRIVATE_DIRECTORY_LINK_FORBIDDEN');
 demand((await readFile(resolve(root,'.gitignore'),'utf8')).split(/\r?\n/).includes('.local-preview/'),'MIGRATION_PRIVATE_INPUT_NOT_IGNORED');
 if(mode==='--review'){
  demand(!name,'MIGRATION_REVIEW_ARGUMENT_INVALID');
  const receipt=await json(resolve(directory,'management-split-receipt-v2.json'));
  const source=(await privateFile('capture-FA-20261009010412736-reviewed.dpapi.json')).snapshot;
  const destination=(await privateFile('capture-FB-20261009010036321.dpapi.json')).snapshot;
  const manifest=await privateFile(receipt.files.manifest),plan=await privateFile(receipt.files.plan);
  demand(snapshotDigest(source)===receipt.sourceSnapshotSha256&&snapshotDigest(destination)===receipt.destinationSnapshotSha256&&snapshotDigest(manifest)===receipt.manifestSha256&&plan.planSha256===receipt.planSha256,'MIGRATION_REVIEW_INPUT_PIN_MISMATCH');
  demand(snapshotDigest(prepareSplitPlan(source,manifest,destination))===snapshotDigest(plan),'MIGRATION_REVIEW_PLAN_CHANGED');
  console.log(JSON.stringify({mode:'LOCAL_PROTECTED_REVIEW',sourceProjectId:source.projectId,destinationProjectId:destination.projectId,counts:plan.counts,planSha256:plan.planSha256,createOnly:true,sourceDeleted:false,credentialsLoaded:false,firestoreReadsIssued:0,firestoreWritesIssued:0,actualMigrationExecuted:false,requiresFreshContext:true,trainingStillStopped:true}));
 }else{
  phase='CAPSULE_VALIDATION';demand(name,'MIGRATION_EXECUTION_CAPSULE_REQUIRED');
  const capsule=await privateFile(name);
  demand(capsule.schemaVersion===1&&capsule.kind==='MANAGEMENT_MIGRATION_EXECUTION_CAPSULE','MIGRATION_EXECUTION_CAPSULE_INVALID');
  const {sourceSnapshot,manifest,destinationSnapshot,plan,approval,evidence}=capsule;
  const validated=validateManagementMigrationExecution({sourceSnapshot,manifest,destinationSnapshot,plan,approval,nowMs:Date.now()});
  const {buildManagementMigrationContext}=await import('./lib/management-migration-context.js');
  const readContext=()=>buildManagementMigrationContext({sourceSnapshot,manifest,destinationSnapshot,plan,approval,evidence,nowMs:Date.now()}).context;
  readContext(); // Evidence must be checked before even looking up credentials.
  const runId=digest(approval.requestId+'\u0000'+validated.pins.planSha256),nowMs=Date.now();
  const expiresAt=new Date(Math.min(Date.parse(approval.expiresAt),nowMs+180000)).toISOString();
  const scope={schemaVersion:1,projectId:FB,databaseId:'(default)',runId,pins:validated.pins,unitPaths:plan.operations.map(v=>v.path)};
  const authorization={schemaVersion:1,authorized:true,projectId:FB,databaseId:'(default)',purpose:PURPOSE,authorizationSource:'EXPLICIT_HUMAN_CONTINUE_FB',authorizationId:approval.requestId,approvedAt:approval.approvedAt,expiresAt,maximumDurationMs:180000,readPairMaximumReads:2,commitPairMaximumReads:2,maximumPostcheckReads:plan.operations.length*2,maximumReservedReads:plan.operations.length*6};
  const budget=createFbMigrationDestinationBudget({projectId:FB,scope,authorization,nowMs});
  phase='PRIVATE_CHECKPOINT';store=await createManagementMigrationPrivateStore({root,directory,runId,pins:validated.pins,scope,initialBudget:budget});
  const reserve=async(payload,options)=>{
   const reservation={projectId:FB,databaseId:'(default)',runId,pins:validated.pins,path:payload.path,stage:payload.stage,maximumReads:payload.maximumReads,reservationId:randomUUID()};
   const first=assessFbMigrationDestinationBudget({projectId:FB,scope,policy:store.read().budget,nowMs:Date.now(),reservation});
   await store.update(s=>({...s,budget:first.nextPolicy}),options);
   const persisted=store.read().budget;
   const acknowledged=acknowledgeFbMigrationDestinationReservation({projectId:FB,scope,policy:persisted,nowMs:Date.now(),acknowledgement:{persisted:true,reservationId:reservation.reservationId,policySha256:fbMigrationDestinationPolicySha256(persisted)}});
   await store.update(s=>({...s,budget:acknowledged.nextPolicy}),options);return acknowledged.proof;
  };
  phase='DESTINATION_CREDENTIAL';
  readContext();assessFbMigrationDestinationBudget({projectId:FB,scope,policy:store.read().budget,nowMs:Date.now()});
  const auth=createRequire(resolve(root,'package.json'))('firebase-tools/lib/auth');
  const definitions=await readFile(resolve(root,'scripts/management-project-preflight.mjs'),'utf8');
  const mapping=definitions.match(/FB: \{id: '([^']+)', principal: '([^']+)'\}/);
  demand(mapping&&mapping[1]===FB,'MIGRATION_DESTINATION_PRINCIPAL_MAPPING_INVALID');
  const account=auth.getAllAccounts().find(v=>v.user?.email===mapping[2]);
  demand(account?.tokens?.refresh_token,'MIGRATION_DESTINATION_LOGIN_REQUIRED');
  const credential=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  demand(credential.access_token&&credential.refresh_token===account.tokens.refresh_token,'MIGRATION_DESTINATION_TOKEN_IDENTITY_INVALID');
  const identityResponse=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+credential.access_token},signal:AbortSignal.timeout(15000)});
  demand(identityResponse.ok,'MIGRATION_DESTINATION_IDENTITY_UNAVAILABLE');
  const identity=await identityResponse.json();demand(identity.email===mapping[2]&&identity.email_verified===true,'MIGRATION_DESTINATION_PRINCIPAL_MISMATCH');
  const rest=createManagementMigrationFirestoreRest({enabled:true,authorizedPurpose:PURPOSE,planSha256:validated.pins.planSha256,
   allowedPairs:plan.operations.map(v=>({path:v.path,provenancePath:v.provenancePath,documentFieldsSha256:v.provenance.destinationFieldsSha256,provenanceFieldsSha256:snapshotDigest(v.provenanceFields)})),
   getAccessToken:async request=>{demand(request.projectId===FB&&request.authorizedPurpose===PURPOSE&&Date.now()<Date.parse(expiresAt),'MIGRATION_DESTINATION_CREDENTIAL_SCOPE_INVALID');return credential.access_token;},
   fetchImpl:async(url,options)=>{if(String(url).endsWith(':batchGet'))reads+=2;else if(String(url).endsWith(':commit'))writes+=2;return fetch(url,options);}
  });
  phase='EXECUTE_CREATE_ONLY';
  const result=await executeManagementMigration({sourceSnapshot,manifest,destinationSnapshot,plan,approval,limits:{maximumUnits:plan.operations.length,maximumDurationMs:180000},adapters:{
   freshContext:async()=>readContext(),reserveReadBudget:reserve,
   pauseReadBudget:async payload=>{const policy=pauseFbMigrationDestinationBudget({projectId:FB,policy:store.read().budget,nowMs:Date.now(),reason:payload.reason});await store.update(s=>({...s,budget:policy}));return {persisted:true,projectId:FB,pausedRequiresReview:true,renewalClearsPause:false};},
   readDestinationPair:rest.readDestinationPair,commitCreatePair:rest.commitCreatePair,checkpoint:store.checkpoint
  }});
  let verifiedPairs=0,finalStatus=result.status;
  if(result.status==='COMPLETE'){
   phase='POSTCHECK';
   for(const operation of plan.operations){
    readContext();const proof=await reserve({path:operation.path,stage:'POSTCHECK',maximumReads:2},{});
    readContext();validateFbMigrationDestinationBudgetProof({proof,nowMs:Date.now(),maximumReads:2,expected:{runId,pins:validated.pins,path:operation.path,stage:'POSTCHECK'}});
    const pair=await rest.readDestinationPair({runId,approvalRequestId:approval.requestId,pins:validated.pins,sourceProjectId:validated.sourceProjectId,destinationProjectId:FB,databaseId:'(default)',projectId:FB,path:operation.path,provenancePath:operation.provenancePath,reservationId:proof.reservationId,maximumReads:2});
    demand(pair.consistent===true&&pair.document&&pair.provenance&&snapshotDigest(pair.document.fields)===operation.provenance.destinationFieldsSha256&&snapshotDigest(pair.provenance.fields)===snapshotDigest(operation.provenanceFields),'MIGRATION_POSTCHECK_PAIR_MISMATCH');
    readContext();validateFbMigrationDestinationBudgetProof({proof,nowMs:Date.now(),maximumReads:2,expected:{runId,pins:validated.pins,path:operation.path,stage:'POSTCHECK'}});verifiedPairs++;
   }
   const finished=finishFbMigrationDestinationBudget({projectId:FB,policy:store.read().budget,nowMs:Date.now(),status:'COMPLETE'});
   await store.update(s=>({...s,budget:finished,verification:{status:'COMPLETE',verifiedPairs,verifiedAt:new Date().toISOString()}}));
  }else{
   finalStatus=result.status;store.retainForReview();
   const finished=finishFbMigrationDestinationBudget({projectId:FB,policy:store.read().budget,nowMs:Date.now(),status:'INCOMPLETE'});
   await store.update(s=>({...s,budget:finished}));
  }
  const receipt={schemaVersion:1,mode:'MANAGEMENT_MIGRATION_CREATE_ONLY',status:finalStatus,phase,runId,planSha256:validated.pins.planSha256,completedCount:result.completedPaths.length,verifiedPairs,readReservations:store.read().budget.reservedReads,firestoreReadAttemptsReserved:reads,firestoreWriteAttemptsIssued:writes,sourceReadsIssued:0,sourceWritesIssued:0,sourceDeleted:false,appActivated:false,authImported:false,creditsGranted:false,trainingStillStopped:true,checkpoint:store.filename,code:result.code||null,verifiedAt:new Date().toISOString()};
  await writeFile(resolve(directory,'migration-result-'+runId+'.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(receipt));if(finalStatus!=='COMPLETE')process.exitCode=2;
 }
}catch(error){
 if(store){store.retainForReview();try{
  const paused=pauseFbMigrationDestinationBudget({projectId:FB,policy:store.read().budget,nowMs:Date.now(),reason:safe(error)});
  const budget=finishFbMigrationDestinationBudget({projectId:FB,policy:paused,nowMs:Date.now(),status:'INCOMPLETE'});
  await store.update(s=>({...s,budget,verification:{status:'INCOMPLETE',phase,code:safe(error),requiresReview:true}}));
 }catch{}}
 console.error(JSON.stringify({code:safe(error),phase,firestoreReadAttemptsReserved:reads,firestoreWriteAttemptsIssued:writes,sourceWritesIssued:0,appActivated:false,trainingStillStopped:true,requiresFreshReviewBeforeResume:true}));process.exitCode=1;
}finally{if(store){try{await store.close();}catch(error){console.error(JSON.stringify({code:safe(error),phase:'PRIVATE_STORE_CLOSE',requiresFreshReviewBeforeResume:true}));process.exitCode=1;}}}
