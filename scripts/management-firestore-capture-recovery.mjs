import {readFile,lstat,open,realpath} from 'node:fs/promises';
import {resolve,dirname,basename,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {captureFirestoreSnapshot} from './lib/firestore-snapshot-capture.js';
import {snapshotDigest,validateSplitSnapshot} from './lib/management-split-plan.js';
import {prepareManagementCaptureRecoveryPlan,validateManagementCaptureRecoveryPlan,
  bindManagementCaptureRecoveryReadTime} from './lib/management-capture-recovery-plan.js';
import {prepareManagementCaptureRecoveryBudget,preflightManagementCaptureRecoveryReadBudget,
  bindManagementCaptureRecoveryBudget,assessRecoveryReadBudget,validateManagementCaptureRecoveryCurrentAdmission,finishManagementCaptureRecoveryBudget}
  from './lib/management-capture-recovery-budget.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
import {createManagementCaptureRecoveryStore,MANAGEMENT_CAPTURE_RECOVERY_FILES}
  from './lib/management-capture-recovery-store.js';
import {packRecoveryCore} from './lib/management-capture-recovery-core-codec.js';
import {firestoreQuotaDayStart,describeManagementReadObservation} from './lib/management-read-budget.js';

const FA='sahmt-17a16',NAMESPACE='FA-rec1',repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const legacyPath='C:/Users/SAHMTIA/.codex/worktrees/training-activities-groups/FIRESTORE/.local-preview/release-catalog/daily-read-policy.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const safe=error=>/^[A-Z][A-Z0-9_]{2,110}$/.test(error?.message||'')?error.message:'RECOVERY_PREPARATION_OR_IO_FAILED';
const flags=Object.freeze({sourcePauseChanged:false,predecessorChanged:false,readBudgetChanged:false,
  firestoreWritesIssued:0,authChangesIssued:0,grantsIssued:0,automaticResume:false,
  productionAuthorized:false,migrationReady:false,operationalFreshnessEvaluated:false,exactGlobalCutoff:false});
const safeName=v=>typeof v==='string'&&/^capture-FA-[0-9]{1,32}-latest\.dpapi\.json$/.test(v);
const subsetPins=p=>Object.fromEntries(['headSha256','checkpointSha256','quarterPlanSha256','scopeSha256',
  'policySha256','originalReadTime','checkpointFinishedAt','reservedReads'].map(k=>[k,p[k]]));
async function credentials(root){
  const auth=createRequire(resolve(root,'package.json'))('firebase-tools/lib/auth');
  const account=auth.getAllAccounts().find(value=>value.user?.email==='fa-owner@example.invalid');
  demand(account?.tokens?.refresh_token,'EXPECTED_SOURCE_ACCOUNT_LOGIN_REQUIRED');
  const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  demand(token.access_token&&token.refresh_token===account.tokens.refresh_token,'REFRESH_IDENTITY_NOT_PROVEN');
  return {async transport(request,{signal}){
    const uri='https://firestore.googleapis.com/v1/'+request.parent.split('/').map(encodeURIComponent).join('/');
    const url=request.operation==='listDocuments'?uri+'/'+encodeURIComponent(request.collectionId)+'?'+new URLSearchParams(request.query)
      :uri+':listCollectionIds';
    const response=await fetch(url,{method:request.method,headers:{Authorization:'Bearer '+token.access_token,
      ...(request.body?{'Content-Type':'application/json'}:{})},...(request.body?{body:JSON.stringify(request.body)}:{}),signal});
    if(!response.ok)throw Error('FIRESTORE_RECOVERY_HTTP_'+response.status);return response.json();
  }};
}
async function legacyReserve(nowMs){let value;
  try{value=JSON.parse((await readFile(legacyPath,'utf8')).replace(/^\uFEFF/,''));}catch{throw Error('LEGACY_RESERVATION_POLICY_UNAVAILABLE');}
  demand(value.schemaVersion===1&&value.project===FA&&value.dailyReadLimit===35000,'LEGACY_RESERVATION_POLICY_INVALID');
  const reads=value.reservationQuotaDayStart===firestoreQuotaDayStart(nowMs)?value.reservedCheckReads:0;
  demand(Number.isSafeInteger(reads)&&reads>=0,'LEGACY_RESERVATION_POLICY_INVALID');return reads;
}
function validateComplete({capture,binding,plan,budget,journal}) {
  demand(capture?.status==='COMPLETE'&&capture.state?.status==='COMPLETE'&&capture.snapshot
    &&capture.receipt?.complete===true&&capture.receipt.consistent===true,'RECOVERY_COMPLETE_CORE_REQUIRED');
  const {snapshot,receipt,state}=capture,{receiptSha256,...body}=receipt;
  validateSplitSnapshot(snapshot);
  demand(snapshot.projectId===FA&&snapshot.databaseId==='(default)'&&snapshot.readTime===binding.readTime
    &&state.readTime===binding.readTime&&receipt.readTime===binding.readTime
    &&snapshotDigest(snapshot)===receipt.snapshotSha256&&receipt.snapshotSha256===state.snapshotSha256
    &&snapshotDigest(body)===receiptSha256&&state.projectId===FA&&state.databaseId==='(default)'
    &&snapshotDigest(snapshot.documents)===snapshotDigest(state.documents)
    &&snapshotDigest([...snapshot.coverage.rootCollections].sort())===snapshotDigest([...binding.coreConfiguration.rootCollections].sort())
    &&state.queue.length===0&&state.active===null&&state.errorCode===undefined
    &&snapshotDigest(receipt.limits)===snapshotDigest(binding.coreConfiguration.limits)
    &&receipt.requestParameters.documentPageSize===25&&receipt.requestParameters.collectionPageSize===100
    &&receipt.requestParameters.showMissing===true&&receipt.requestParameters.mask===null
    &&receipt.requestParameters.orderBy===null,'RECOVERY_COMPLETE_PIN_OR_CONFIGURATION_MISMATCH');
  const paths=[...state.documents.map(d=>d.path),...state.missingDocumentPaths];
  demand(new Set(paths).size===paths.length&&new Set(state.completedDiscoveryParents).size===paths.length
    &&paths.every(p=>state.completedDiscoveryParents.includes(p))
    &&new Set(state.completedCollections).size===state.completedCollections.length
    &&binding.coreConfiguration.rootCollections.every(p=>state.completedCollections.includes(p))
    &&paths.every(p=>state.completedCollections.includes(p.split('/').slice(0,-1).join('/'))),
    'RECOVERY_COMPLETE_DISCOVERY_COVERAGE_REQUIRED');
  demand(Array.isArray(state.pages)&&state.pages.length===journal.reservations.length
    &&state.pages.every((p,i)=>p.status==='COMPLETE'&&p.attempt===i+1&&p.readTime===binding.readTime
      &&p.requestSha256===journal.reservations[i].requestSha256&&p.maximumReads===journal.reservations[i].maximumReads)
    &&state.totalReservedReads===journal.reservations.reduce((n,r)=>n+r.maximumReads,0)
    &&state.totalReservedReads===budget.recoveryReservedReads&&journal.dispatchAttempts===state.pages.length
    &&snapshotDigest(receipt.pages)===snapshotDigest(state.pages)
    &&snapshotDigest(receipt.completedCollections)===snapshotDigest(state.completedCollections)
    &&snapshotDigest(receipt.completedDiscoveryParents)===snapshotDigest(state.completedDiscoveryParents)
    &&state.totalReservedReads<=plan.quota.newCaptureReservationLimit
    &&state.totalReservedReads+plan.quota.predecessorReservedReads<=plan.quota.cumulativeReadReservationLimit
    &&receipt.counts.documents===state.documents.length&&receipt.counts.missingParents===state.missingDocumentPaths.length
    &&receipt.counts.attempts===state.pages.length&&receipt.counts.totalReservedReads===state.totalReservedReads,
    'RECOVERY_COMPLETE_RESERVATION_MISMATCH');
  demand(Date.parse(state.startedAt)>=Date.parse(binding.startedAt)&&Date.parse(state.finishedAt)<Date.parse(binding.deadlineAt)
    &&Date.parse(state.finishedAt)-Date.parse(binding.readTime)<3600000,
    'RECOVERY_COMPLETE_DEADLINE_EXCEEDED');
  return {documents:state.documents.length,missingParents:state.missingDocumentPaths.length,
    collectionsCompleted:state.completedCollections.length,discoveryParentsCompleted:state.completedDiscoveryParents.length,
    attempts:state.pages.length,newReservedReads:state.totalReservedReads,
    cumulativeConservativeReservedReads:state.totalReservedReads+plan.quota.predecessorReservedReads};
}
/** Actual CLI has fixed files/default DPAPI and authentication; dependency seams
 * allow isolated synthetic tests, never an alternate executable config file.
 * Preflight is local only and never creates coordinator, journal or credentials. */
export async function runManagementCaptureRecovery({root=repoRoot,args,clock=Date.now,
  createProtector=createPrivateJsonProtector,openProtected=openPrivateJson,acquireCredentials=credentials,
  readLegacyReserve=legacyReserve,captureCore=captureFirestoreSnapshot}={}) {
  demand(Array.isArray(args)&&args.length===2&&args[0]===NAMESPACE
    &&['--preflight','--capture'].includes(args[1]),'USE_FA_REC1_PREFLIGHT_OR_CAPTURE');
  const absoluteRoot=resolve(root),directory=resolve(absoluteRoot,'.local-preview/management-split'),tracked=[];
  let directoryPins=null;
  async function dirs(){if(directoryPins){await Promise.all(directoryPins.map(async pin=>{const st=await lstat(pin.path);
      demand(st.isDirectory()&&!st.isSymbolicLink()&&st.dev===pin.dev&&st.ino===pin.ino,'RECOVERY_DIRECTORY_LINK_FORBIDDEN');}));return;}
    for(const p of [absoluteRoot,dirname(directory),directory]){const st=await lstat(p);
    demand(st.isDirectory()&&!st.isSymbolicLink(),'RECOVERY_DIRECTORY_LINK_FORBIDDEN');}
    demand(relative(await realpath(absoluteRoot),await realpath(directory))===join('.local-preview','management-split'),
      'RECOVERY_DIRECTORY_SCOPE_INVALID');
    demand((await readFile(resolve(absoluteRoot,'.gitignore'),'utf8')).split(/\r?\n/).includes('.local-preview/'),
      'RECOVERY_PRIVATE_NOT_IGNORED');}
  await dirs();directoryPins=await Promise.all([absoluteRoot,dirname(directory),directory].map(async path=>{const st=await lstat(path);return {path,dev:st.dev,ino:st.ino};}));
  async function read(name,{maximum=72*1024*1024,track=true}={}){
    demand(name===basename(name),'RECOVERY_PRIVATE_NAME_INVALID');const path=resolve(directory,name),before=await lstat(path);
    demand(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=maximum,'RECOVERY_INPUT_FILE_INVALID');
    const handle=await open(path,'r');let bytes;
    try{const opened=await handle.stat();demand(opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size,
      'RECOVERY_INPUT_CHANGED');bytes=await handle.readFile();}finally{await handle.close();}
    const after=await lstat(path);demand(after.isFile()&&!after.isSymbolicLink()&&after.dev===before.dev&&after.ino===before.ino
      &&after.size===before.size&&bytes.length===before.size,'RECOVERY_INPUT_CHANGED');
    let value;try{value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('RECOVERY_INPUT_JSON_INVALID');}
    const item={name,maximum,sha256:hash(bytes),value};if(track)tracked.push(item);return item;
  }
  const planFile=await read('capture-recovery-plan-FA-rec1.json',{maximum:65536});
  const authorityFile=await read('capture-recovery-authority-FA-rec1.json',{maximum:65536});
  const observationFile=await read('capture-recovery-observation-FA-rec1.json',{maximum:65536});
  const headFile=await read('quarter-head-FA.json',{maximum:65536});
  const policyFile=await read('backup-read-policy-FA.json',{maximum:65536});
  const scopeFile=await read('backup-scope-FA.json',{maximum:65536});
  demand(safeName(headFile.value.activeCheckpointFile),'RECOVERY_PREDECESSOR_CHECKPOINT_NAME_INVALID');
  const checkpointFile=await read(headFile.value.activeCheckpointFile);
  const predecessorCheckpoint=await openProtected(checkpointFile.value);
  const plan=planFile.value,{authorizationEvidence,reportAuthorization,manualControlEvidence}=authorityFile.value;
  const manual=reportAuthorization?.kind==='MANAGEMENT_FA_MANUAL_CAPTURE_AUTHORIZATION';
  const authorityKeys=manual?['authorizationEvidence','reportAuthorization','manualControlEvidence']:['authorizationEvidence','reportAuthorization'];
  demand(Object.keys(authorityFile.value).length===authorityKeys.length&&authorityKeys.every(key=>Object.hasOwn(authorityFile.value,key))
    &&authorizationEvidence&&reportAuthorization&&(!manual||manualControlEvidence),'RECOVERY_AUTHORITY_FILE_INVALID');
  const planInputs={predecessorHead:headFile.value,predecessorCheckpoint,predecessorPolicy:policyFile.value,
    sourceScope:scopeFile.value,predecessorPins:subsetPins(plan.predecessor),authorizationEvidence,
    quotaDay:plan.quota.quotaDayStart,nowMs:clock()};
  validateManagementCaptureRecoveryPlan({plan,...planInputs});
  // Regeneration verifies the exact plan without copying predecessor documents.
  const regenerated=prepareManagementCaptureRecoveryPlan({...planInputs,nowMs:Date.parse(plan.createdAt)});
  demand(regenerated.planSha256===plan.planSha256,'RECOVERY_PLAN_REGENERATION_MISMATCH');
  let budget=prepareManagementCaptureRecoveryBudget({plan,predecessorPolicy:policyFile.value,
    authorizationEvidence,reportAuthorization,...(manual?{manualControlEvidence}:{}),observation:observationFile.value,nowMs:clock()});
  async function unchanged(){await dirs();await Promise.all(tracked.map(async item=>{
    const path=resolve(directory,item.name),before=await lstat(path);
    demand(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=item.maximum,'RECOVERY_INPUT_FILE_INVALID');
    const bytes=await readFile(path),after=await lstat(path);
    demand(after.isFile()&&!after.isSymbolicLink()&&after.dev===before.dev&&after.ino===before.ino
      &&after.size===before.size&&bytes.length===before.size&&hash(bytes)===item.sha256,
      'RECOVERY_PREDECESSOR_OR_AUTHORITY_CHANGED');
  }));}
  async function assessment(){const legacyReservedReads=await readLegacyReserve(clock());await unchanged();const nowMs=clock();return preflightManagementCaptureRecoveryReadBudget({plan,
    predecessorPolicy:policyFile.value,authorizationEvidence,...(manual?{manualControlEvidence}:{}),observation:observationFile.value,budget,nowMs,
    legacyReservedReads});}
  const initial=await assessment();
  if(args[1]==='--preflight')return {schemaVersion:1,namespace:NAMESPACE,mode:'LOCAL_RECOVERY_PREFLIGHT',eligibleForCapture:true,
    scopeRootCount:plan.captureConfiguration.rootCollections.length,planSha256:plan.planSha256,budget:initial,
    credentialLookupIssued:0,firestoreDocumentReadsIssued:0,...flags};
  let store,journal,journalSha=null,binding=null,issued=0,pending=null,credentialLookups=0,terminalVerified=false;
  let reservations=[],checkpointTail=Promise.resolve(),failureReason=null;
  async function save(next,{signal}={}){const stored=await store.persistJournal(next,{expectedSha256:journalSha,signal});
    journal=next;journalSha=stored.valueSha256;return stored;}
  async function update(fields,{signal}={}){return save({...journal,...fields,revision:journal.revision+1,
    previousJournalSha256:journalSha},{signal});}
  try{
    const protector=await createProtector();const probe=protector.seal({purpose:'MANAGEMENT_RECOVERY_PROTECTION_PROBE'});
    demand((await openProtected(probe)).purpose==='MANAGEMENT_RECOVERY_PROTECTION_PROBE','RECOVERY_PROTECTION_PROBE_FAILED');
    demand(typeof protector.open==='function','RECOVERY_SESSION_PROTECTION_OPENER_REQUIRED');
    await assessment();store=await createManagementCaptureRecoveryStore({directory,protector,openProtected:envelope=>protector.open(envelope)});await store.acquire();
    journal={schemaVersion:1,kind:'MANAGEMENT_CAPTURE_RECOVERY_JOURNAL',namespace:NAMESPACE,projectId:FA,
      planSha256:plan.planSha256,predecessor:plan.predecessor,revision:1,previousJournalSha256:null,status:'PREPARED',
      binding:null,budget,reservations:[],dispatchAttempts:0,coreCheckpoint:null,checkpointSha256:null,checkpointCiphertextSha256:null,
      pausedRequiresReview:false,renewalClearsPause:false,automaticResume:false,exactGlobalCutoff:false};
    await save(journal);await assessment();
    credentialLookups++;const authenticated=await acquireCredentials(absoluteRoot);
    demand(authenticated&&typeof authenticated.transport==='function','RECOVERY_AUTHENTICATED_TRANSPORT_REQUIRED');
    await assessment();const startedAtMs=clock();
    binding=bindManagementCaptureRecoveryReadTime({plan,readTime:new Date(startedAtMs-5000).toISOString(),nowMs:startedAtMs});
    budget=bindManagementCaptureRecoveryBudget({plan,predecessorPolicy:policyFile.value,authorizationEvidence,...(manual?{manualControlEvidence}:{}),observation:observationFile.value,budget,
      readTime:binding.readTime,startedAt:binding.startedAt,deadlineAt:binding.deadlineAt,nowMs:startedAtMs});
    await update({status:'IN_PROGRESS',binding,budget});
    async function guard(){await unchanged();
      const stored=await store.readJournal();demand(stored&&stored.valueSha256===journalSha
        &&snapshotDigest(stored.value.budget)===snapshotDigest(budget)&&stored.value.pausedRequiresReview===false,
        'RECOVERY_DURABLE_BUDGET_CHANGED');const nowMs=clock();
      demand(nowMs<Date.parse(binding.deadlineAt),'RECOVERY_FIXED_DEADLINE_EXCEEDED');return nowMs;}
    const capture=await captureCore({...binding.coreConfiguration,clock,
      reserveReads:async(reservation,{signal})=>{try{
        const legacyReservedReads=await readLegacyReserve(clock()),nowMs=await guard();if(signal.aborted)throw Error('RECOVERY_RESERVATION_ABORTED');
        const decision=assessRecoveryReadBudget({plan,predecessorPolicy:policyFile.value,authorizationEvidence,...(manual?{manualControlEvidence}:{}),
          observation:observationFile.value,budget,nowMs,reservation,legacyReservedReads});
        const record={...reservation,reservedAt:new Date(nowMs).toISOString()};
        demand(reservation.attempt===reservations.length+1&&!pending,'RECOVERY_RESERVATION_ORDER_INVALID');
        reservations=[...reservations,record];budget=decision.nextBudget;
        pending={requestSha256:reservation.requestSha256,attempt:reservation.attempt,proof:decision.proof};
        // This is a pure admission only. The next core checkpoint durably seals
        // the reservation, full state and budget together BEFORE transport.
        return {allowed:true};
      }catch(error){failureReason=safe(error);throw error;}},
      checkpoint:async(coreState,{signal})=>{
        const operation=checkpointTail.then(async()=>{
          if(signal.aborted)throw Error('RECOVERY_CHECKPOINT_ABORTED');
          const coreCheckpoint=packRecoveryCore(coreState);
          await update({budget,reservations,dispatchAttempts:issued,coreCheckpoint,
            checkpointSha256:coreCheckpoint.rawCoreSha256},{signal});
        });
        checkpointTail=operation.catch(()=>{});await operation;
      },
      transport:async(request,{signal})=>{try{
        const legacyReservedReads=await readLegacyReserve(clock()),nowMs=await guard();
        demand(pending&&pending.requestSha256===snapshotDigest(request)&&request.parent.startsWith('projects/'+FA+'/databases/(default)/documents'),
          'RECOVERY_DURABLE_RESERVATION_REQUIRED');
        const checkpoint=journal.coreCheckpoint,summary=checkpoint?.summary;
        demand(checkpoint&&checkpoint.rawCoreSha256===journal.checkpointSha256&&summary.projectId===FA
          &&summary.readTime===binding.readTime&&summary.lastStatus==='RESERVED'
          &&summary.lastRequestSha256===pending.requestSha256&&summary.lastAttempt===pending.attempt
          &&summary.lastOperation===pending.proof.operation&&summary.lastMaximumReads===pending.proof.maximumReads
          &&summary.totalReservedReads===budget.recoveryReservedReads,'RECOVERY_DURABLE_CHECKPOINT_REQUIRED');
        // The pinned consent and full app/lag margin are rechecked before dispatch.
        validateManagementCaptureRecoveryCurrentAdmission({plan,predecessorPolicy:policyFile.value,authorizationEvidence,...(manual?{manualControlEvidence}:{}),
          observation:observationFile.value,budget,proof:pending.proof,nowMs,legacyReservedReads});
        const expected=pending;pending=null;
        // A crash cannot resume this namespace; the retained coordinator and
        // durable RESERVED checkpoint conserve uncertainty without a retry.
        const remaining=Date.parse(binding.deadlineAt)-clock();demand(remaining>0,'RECOVERY_FIXED_DEADLINE_EXCEEDED');issued++;
        return await authenticated.transport(request,{signal:AbortSignal.any([signal,AbortSignal.timeout(remaining)])});
      }catch(error){failureReason=safe(error);throw error;}}});
    await checkpointTail;await store.drain();
    const finalCheckpoint=await store.persistCheckpoint({schemaVersion:1,kind:'FIRESTORE_RECOVERY_CHECKPOINT',projectId:FA,
      namespace:NAMESPACE,planSha256:plan.planSha256,binding,coreState:capture.state});
    await update({budget,reservations,dispatchAttempts:issued,coreCheckpoint:packRecoveryCore(capture.state),checkpointSha256:snapshotDigest(capture.state),checkpointCiphertextSha256:finalCheckpoint.ciphertextSha256});
    if(capture.status!=='COMPLETE'){
      store.retain();budget=finishManagementCaptureRecoveryBudget({plan,predecessorPolicy:policyFile.value,
        authorizationEvidence,...(manual?{manualControlEvidence}:{}),observation:observationFile.value,budget,status:'INCOMPLETE',nowMs:clock()});
      await update({status:'INCOMPLETE',budget,pausedRequiresReview:true,errorCode:failureReason||safe({message:capture.errorCode})});
      return {schemaVersion:1,namespace:NAMESPACE,status:'INCOMPLETE',errorCode:failureReason||safe({message:capture.errorCode}),
        documentsCaptured:capture.state.documents.length,discoveryParentsCompleted:capture.state.completedDiscoveryParents.length,
        newReservedReads:journal.reservations.reduce((n,r)=>n+r.maximumReads,0),
        cumulativeConservativeReservedReads:plan.quota.predecessorReservedReads+journal.reservations.reduce((n,r)=>n+r.maximumReads,0),
        lockRetainedRequiresReview:true,credentialLookupIssued:1,firestoreDocumentReadsIssued:issued,...flags};
    }
    await unchanged();const counts=validateComplete({capture,binding,plan,budget,journal});
    const packet={schemaVersion:1,kind:'FIRESTORE_RECOVERY_CAPTURE',namespace:NAMESPACE,projectId:FA,status:'COMPLETE',
      plan,binding,predecessor:plan.predecessor,snapshot:capture.snapshot,receipt:capture.receipt,
      readBudgetObservation:describeManagementReadObservation(observationFile.value),...flags};
    const published=await store.publishCapture(packet);await unchanged();
    const independent=await read(MANAGEMENT_CAPTURE_RECOVERY_FILES.capture,{track:false});
    demand(independent.sha256===published.ciphertextSha256&&snapshotDigest(await openProtected(independent.value))===snapshotDigest(packet),
      'RECOVERY_FINAL_DPAPI_ROUNDTRIP_MISMATCH');
    budget=finishManagementCaptureRecoveryBudget({plan,predecessorPolicy:policyFile.value,authorizationEvidence,...(manual?{manualControlEvidence}:{}),observation:observationFile.value,budget,
      status:'COMPLETE',captureFinishedAt:capture.state.finishedAt,nowMs:clock()});
    await update({status:'COMPLETE',budget,pausedRequiresReview:true,snapshotSha256:snapshotDigest(capture.snapshot),
      receiptSha256:capture.receipt.receiptSha256,captureCiphertextSha256:published.ciphertextSha256});
    const receipt={schemaVersion:1,namespace:NAMESPACE,projectId:FA,status:'COMPLETE',planSha256:plan.planSha256,
      predecessorHeadSha256:plan.predecessor.headSha256,predecessorCheckpointSha256:plan.predecessor.checkpointSha256,
      file:MANAGEMENT_CAPTURE_RECOVERY_FILES.capture,checkpointFile:MANAGEMENT_CAPTURE_RECOVERY_FILES.checkpoint,
      ciphertextSha256:published.ciphertextSha256,checkpointSha256:journal.checkpointSha256,
      checkpointCiphertextSha256:journal.checkpointCiphertextSha256,journalSha256:journalSha,
      snapshotSha256:journal.snapshotSha256,receiptSha256:journal.receiptSha256,
      readTime:binding.readTime,startedAt:capture.state.startedAt,finishedAt:capture.state.finishedAt,deadlineAt:binding.deadlineAt,
      counts,decryptAndHashVerified:true,requiresHumanReview:true,credentialLookupIssued:1,
      firestoreDocumentReadsIssued:issued,...flags};
    await store.publishReceipt(receipt);await unchanged();terminalVerified=true;
    return {...receipt,lockRetainedRequiresReview:false};
  }catch(error){if(store){store.retain();try{await checkpointTail;await store.drain();if(journal)await update({budget,reservations,dispatchAttempts:issued,status:'INCOMPLETE',pausedRequiresReview:true,
      errorCode:safe(error)});}catch{/* Retain coordinator if the journal cannot be confirmed. */}}
    const sanitized=Error(safe(error));sanitized.recoveryEffects={credentialLookupIssued:credentialLookups,
      firestoreDocumentReadsIssued:issued,lockRetainedRequiresReview:!!store,...flags};throw sanitized;
  }finally{if(store)await store.close({release:terminalVerified});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runManagementCaptureRecovery({args:process.argv.slice(2)})));}
  catch(error){console.error(JSON.stringify({status:'REJECTED',code:safe(error),credentialLookupIssued:0,
    firestoreDocumentReadsIssued:0,...flags,...error.recoveryEffects}));process.exitCode=1;}
}
