import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,lstat,open,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openPrivateJson} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {validateManagementCaptureQuarterPlan} from './lib/management-capture-quarter-plan.js';
import {adoptInitialManagementCaptureQuarterHead} from './lib/management-capture-quarter-head.js';
import {readManagementCaptureQuarterHead,persistManagementCaptureQuarterHead,
  listManagementCaptureQuarterCheckpoints} from './lib/management-capture-quarter-head-store.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(root,'.local-preview/management-split');
const parse=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
let descriptor=null,lockPath=null,retainLock=false,headWriteEntered=false;
try {
  const [reference,mode,checkpointFile,...extra]=process.argv.slice(2);
  if(reference!=='FA'||mode!=='--adopt-initial'||extra.length||typeof checkpointFile!=='string'
    ||!/^capture-FA-[0-9]{1,32}-latest\.dpapi\.json$/.test(checkpointFile))
    throw Error('USE_FA_ADOPT_INITIAL_CHECKPOINT');
  for(const path of [resolve(root,'.local-preview'),directory]) {
    const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('PRIVATE_OUTPUT_LINK_FORBIDDEN');
  }
  if(!(await readFile(resolve(root,'.gitignore'),'utf8')).split(/\r?\n/).includes('.local-preview/'))
    throw Error('PRIVATE_OUTPUT_NOT_IGNORED');
  lockPath=resolve(directory,'backup-read-FA.lock');
  try{descriptor=await open(lockPath,'wx');}
  catch(error){if(error.code==='EEXIST')throw Error('MANAGEMENT_CAPTURE_LOCK_PRESENT_REQUIRES_REVIEW');throw error;}
  const existing=await readManagementCaptureQuarterHead({directory});
  if(existing!==null)throw Error('QUARTER_SEQUENCE_ALREADY_EXISTS_REQUIRES_REVIEW');
  const inventory=await listManagementCaptureQuarterCheckpoints({directory,openPrivateJson});
  if(inventory.length!==1||inventory[0].checkpointFile!==checkpointFile)
    throw Error('QUARTER_HEAD_ADOPTION_INVENTORY_AMBIGUOUS');
  const targetPath=resolve(directory,checkpointFile);
  if(basename(targetPath)!==checkpointFile||(await lstat(targetPath)).isSymbolicLink())
    throw Error('QUARTER_CHECKPOINT_LINK_FORBIDDEN');
  const saved=await openPrivateJson(await parse(targetPath));
  if(saved.schemaVersion!==1||saved.kind!=='FIRESTORE_QUARTER_CHECKPOINT'||saved.projectId!=='sahmt-17a16'
    ||Object.keys(saved).length!==5||!saved.coreState)throw Error('QUARTER_CHECKPOINT_INVALID');
  const baselinePath=resolve(directory,'capture-FA-20261009010412736-reviewed.dpapi.json');
  if((await lstat(baselinePath)).isSymbolicLink())throw Error('QUARTER_BASELINE_LINK_FORBIDDEN');
  const baseline=await openPrivateJson(await parse(baselinePath));
  const scope=await parse(resolve(directory,'backup-scope-FA.json'));
  const receipt=await parse(resolve(directory,'management-split-receipt-v2.json'));
  const plan=validateManagementCaptureQuarterPlan({plan:saved.quarterPlan,sourceSnapshot:baseline.snapshot,scope});
  if(plan.baselineSnapshotSha256!==receipt.sourceSnapshotSha256)throw Error('QUARTER_BASELINE_REVIEW_PIN_MISMATCH');
  const runId='adopted-'+createHash('sha256').update(checkpointFile).digest('hex');
  const head=adoptInitialManagementCaptureQuarterHead({head:existing,plan,runId,checkpointFile,
    coreState:saved.coreState,checkpointInventory:inventory,nowMs:Date.now()});
  if(head.checkpointSha256!==snapshotDigest(saved.coreState))throw Error('QUARTER_HEAD_CHECKPOINT_NOT_CURRENT');
  headWriteEntered=true;
  await persistManagementCaptureQuarterHead({directory,lockDescriptor:descriptor,head,expectedHeadSha256:null,plan});
  const confirmed=await readManagementCaptureQuarterHead({directory});
  if(confirmed?.headSha256!==head.headSha256)throw Error('QUARTER_HEAD_READBACK_FAILED');
  console.log(JSON.stringify({schemaVersion:1,mode:'LOCAL_INITIAL_QUARTER_HEAD_ADOPTION',
    projectId:head.projectId,headFile:'quarter-head-FA.json',headSha256:head.headSha256,
    checkpointFile:head.activeCheckpointFile,checkpointSha256:head.checkpointSha256,
    readTime:head.readTime,batchNumber:head.batchNumber,status:head.status,counts:head.counters,
    sourcePauseChanged:false,budgetReservationChanged:false,credentialLookupIssued:0,
    firestoreDocumentReadsIssued:0,firestoreWritesIssued:0,automaticNextBatch:false}));
}catch(error) {
  if(headWriteEntered)retainLock=true;
  const errorCode=/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'QUARTER_HEAD_LOCAL_ADOPTION_FAILED';
  console.error(JSON.stringify({errorCode,sourcePauseChanged:false,budgetReservationChanged:false,
    credentialLookupIssued:0,firestoreDocumentReadsIssued:0,firestoreWritesIssued:0,lockRetainedRequiresReview:retainLock}));
  process.exitCode=1;
}finally{
  if(descriptor){await descriptor.close();if(!retainLock)await unlink(lockPath);}
}
