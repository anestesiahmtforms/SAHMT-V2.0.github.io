import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,readdir,unlink,rmdir,lstat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runManagementCaptureRecovery} from '../scripts/management-firestore-capture-recovery.mjs';
import {createManagementCaptureRecoveryStore,MANAGEMENT_CAPTURE_RECOVERY_FILES as files}
  from '../scripts/lib/management-capture-recovery-store.js';
import {prepareManagementCaptureQuarterPlan} from '../scripts/lib/management-capture-quarter-plan.js';
import {bindManagementCaptureRecoveryReadTime,prepareManagementCaptureRecoveryPlan,MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION as authorizationEvidence}
  from '../scripts/lib/management-capture-recovery-plan.js';
import {prepareManagementCaptureRecoveryBudget,bindManagementCaptureRecoveryBudget,assessRecoveryReadBudget,finishManagementCaptureRecoveryBudget} from '../scripts/lib/management-capture-recovery-budget.js';
import {unpackRecoveryCore} from '../scripts/lib/management-capture-recovery-core-codec.js';
import {captureFirestoreSnapshot} from '../scripts/lib/firestore-snapshot-capture.js';
import {createPrivateJsonProtector,openPrivateJson} from '../scripts/lib/windows-protected-json.js';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {firestoreQuotaDayStart,sourceUsageHumanReportTextSha256,sourceUsageHumanReportObservationSha256,
  sourceUsageHumanReportUpperReads} from '../scripts/lib/management-read-budget.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),FA='sahmt-17a16';
const now=Date.parse('2026-10-09T16:00:00.000Z'),oldRead='2026-10-09T14:44:36.804Z',finished='2026-10-09T15:44:36.850Z';
const clone=v=>JSON.parse(JSON.stringify(v)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const seal=value=>({schemaVersion:2,protection:'AES256_GCM_WITH_WINDOWS_DPAPI_CURRENT_USER',
  plaintextSha256:snapshotDigest(value),synthetic:clone(value)});
const openProtected=async envelope=>{assert.equal(envelope.schemaVersion,2);
  assert.equal(snapshotDigest(envelope.synthetic),envelope.plaintextSha256);return clone(envelope.synthetic);};
const protector={seal,open:openProtected};
function evidence(){
  const quotaDay=firestoreQuotaDayStart(now),scope={schemaVersion:1,projectId:FA,databaseId:'(default)',
    scope:'SELECTED_COLLECTION_TREES_WITH_IDENTITY_DEPENDENCIES',
    rootCollections:Array.from({length:43},(_,i)=>'managementR'+String(i).padStart(2,'0'))};
  const documents=[];for(const [i,rootId]of scope.rootCollections.entries())for(let n=0;n<(i<21?9:8);n++)documents.push({
    path:rootId+'/row'+n,fields:{privateName:{stringValue:'PRIVATE_RECOVERY_SENTINEL'}},
    createTime:'2026-10-01T00:00:00.000Z',updateTime:'2026-10-09T13:00:00.000Z'});
  assert.equal(documents.length,365);
  const baseline={schemaVersion:1,projectId:FA,databaseId:'(default)',readTime:'2026-10-09T13:00:00.000Z',
    coverage:{complete:true,consistent:true,rootCollections:scope.rootCollections},documents};
  const quarterPlan=prepareManagementCaptureQuarterPlan({sourceSnapshot:baseline,scope});
  const pages=[];
  const add=p=>pages.push({attempt:pages.length+1,readTime:oldRead,requestSha256:hash('request'+pages.length),
    pageTokenSha256:null,status:'COMPLETE',responseSha256:hash('response'+pages.length),responseBytes:16,
    nextPageTokenSha256:null,...p});
  for(const [i,collectionId]of scope.rootCollections.entries())add({operation:'listDocuments',parentPath:'',collectionId,
    maximumReads:25,returnedCount:i<21?9:8,existingCount:i<21?9:8,missingCount:0,
    ...(i<12?{nextPageTokenSha256:hash('token'+i)}:{})});
  for(let i=0;i<12;i++)add({operation:'listDocuments',parentPath:'',collectionId:scope.rootCollections[i],
    pageTokenSha256:hash('token'+i),maximumReads:i===11?6:10,returnedCount:0,existingCount:0,missingCount:0});
  for(const d of documents.slice(0,151))add({operation:'listCollectionIds',parentPath:d.path,maximumReads:1,returnedCount:0});
  assert.equal(pages.length,206);assert.equal(pages.reduce((n,p)=>n+p.maximumReads,0),1342);
  const oldConfiguration={schemaVersion:1,projectId:FA,databaseId:'(default)',rootCollections:scope.rootCollections,
    readTime:oldRead,pageSize:25,collectionPageSize:100,limits:{maxPages:3000,maxDocuments:6000,maxDepth:30,
      maxBytes:12*1024*1024,maxDurationMs:180000,requestTimeoutMs:20000},maxBatchDocuments:92,maxBatches:4};
  const coreState={schemaVersion:1,mode:'READ_ONLY_FIRESTORE_CAPTURE',projectId:FA,databaseId:'(default)',readTime:oldRead,
    rootCollections:scope.rootCollections,scopeSha256:snapshotDigest({projectId:FA,databaseId:'(default)',rootCollections:scope.rootCollections}),
    startedAt:'2026-10-09T14:44:43.850Z',status:'INCOMPLETE',errorCode:'CHECKPOINT_TIMEOUT',
    queue:documents.slice(151).map(d=>({operation:'listCollectionIds',parentPath:d.path,depth:1})),active:null,
    documents,missingDocumentPaths:[],completedCollections:scope.rootCollections,
    completedDiscoveryParents:documents.slice(0,151).map(d=>d.path),pages,totalReservedReads:1342,totalResponseBytes:206*16,
    finishedAt:finished,captureConfigSha256:snapshotDigest(oldConfiguration),
    batch:{number:4,maxDocuments:92,maxBatches:4,documentEntriesAtStart:276,startedAt:'2026-10-09T15:43:50.000Z',reviewId:'r4'},
    batchHistory:[1,2,3].map(number=>({number,startedAt:new Date(Date.parse('2026-10-09T14:44:43.850Z')+(number-1)*60000).toISOString(),
      finishedAt:new Date(Date.parse('2026-10-09T14:44:45.845Z')+(number-1)*60000).toISOString(),documentEntries:92,
      reviewId:number===1?null:'r'+number,status:'PARTIAL_REVIEW'})),knownCollections:scope.rootCollections,lastObservedAt:'2026-10-09T15:44:36.804Z'};
  const body={schemaVersion:1,kind:'MANAGEMENT_QUARTER_CAPTURE_HEAD',projectId:FA,databaseId:'(default)',
    planSha256:quarterPlan.planSha256,scopeSha256:quarterPlan.scopeSha256,baselineSnapshotSha256:quarterPlan.baselineSnapshotSha256,
    sequenceId:'synthetic_original',revision:100,previousHeadSha256:'c'.repeat(64),createdAt:coreState.startedAt,
    updatedAt:'2026-10-09T15:44:37.000Z',readTime:oldRead,captureConfigSha256:coreState.captureConfigSha256,
    status:'INCOMPLETE',batchNumber:4,activeRunId:'run4',activeCheckpointFile:'capture-FA-20261009154350000-latest.dpapi.json',
    checkpointSha256:snapshotDigest(coreState),checkpointFinishedAt:finished,checkpointObservedAt:finished,
    checkpointContentSha256:snapshotDigest(Object.fromEntries(Object.entries(coreState).filter(([k])=>k!=='lastObservedAt'))),
    counters:{documents:365,missingParents:0,attempts:206,reservedReads:1342,responseBytes:206*16},
    runHistory:[1,2,3,4].map(n=>({runId:'run'+n,checkpointFile:n===4?'capture-FA-20261009154350000-latest.dpapi.json':
      'capture-FA-2026100914000'+n+'000-latest.dpapi.json',batchNumber:n,reviewId:n===1?null:'r'+n,documentEntriesAtStart:(n-1)*92}))};
  const head={...body,headSha256:snapshotDigest(body)};
  const policy={schemaVersion:1,projectId:FA,dailyReadLimit:45000,limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',
    quotaTimeZone:'America/Los_Angeles',reservationQuotaDayStart:quotaDay,renewalClearsPause:false,pausedRequiresReview:true,
    pauseReason:'CHECKPOINT_TIMEOUT',authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',humanDecisionAt:'2026-10-09T15:12:31.000Z',
    maximumCaptureReserve:6000,reservedReads:1342,appTrafficReserve:5000,metricLagReserve:2000};
  const checkpoint={schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:FA,quarterPlan,coreState};
  const predecessorPins={headSha256:head.headSha256,checkpointSha256:head.checkpointSha256,quarterPlanSha256:quarterPlan.planSha256,
    scopeSha256:snapshotDigest(scope),policySha256:snapshotDigest(policy),originalReadTime:oldRead,checkpointFinishedAt:finished,reservedReads:1342};
  const plan=prepareManagementCaptureRecoveryPlan({predecessorHead:head,predecessorCheckpoint:checkpoint,
    predecessorPolicy:policy,sourceScope:scope,predecessorPins,authorizationEvidence,quotaDay,nowMs:now-1000});
  const reportedText='4000',reportedAt=new Date(now-1000).toISOString(),reportedReads=4000,evidenceSha256=sourceUsageHumanReportTextSha256(reportedText);
  const observation={observationSource:'USER_CURRENT_USAGE_HUMAN_REPORT',project:FA,quotaDayStart:quotaDay,reportedAt,
    reviewedAt:new Date(now).toISOString(),periodStart:quotaDay,periodKind:'CURRENT_FA_QUOTA_DAY_TO_REPORT',reportedReads,
    reads:sourceUsageHumanReportUpperReads(reportedReads),reportedText,evidenceId:'synthetic_report',evidenceSha256,
    exactGlobalCutoff:false,totalUsageKnown:false,measuredTotalReads:null,
    reportProvenance:{schemaVersion:1,source:'HUMAN_USER_MESSAGE_TEXT',humanMessageId:'synthetic_message',evidenceId:'synthetic_report',
      evidenceSha256,reportedAt}};
  const reportAuthorization={schemaVersion:1,authorized:true,authorizationSource:'EXPLICIT_HUMAN_FA_QUARTER_CAPTURE_REVIEW',
    authorizationId:'synthetic_auth',humanDecisionMessageId:'synthetic_decision',projectId:FA,authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',
    dailyReadLimit:45000,quotaDayStart:quotaDay,approvedAt:'2026-10-09T15:12:31.000Z',reviewedAt:observation.reviewedAt,reportedAt,
    evidenceId:observation.evidenceId,evidenceSha256,observationSha256:sourceUsageHumanReportObservationSha256(observation),
    reportHumanMessageId:'synthetic_message',reportSource:'HUMAN_USER_MESSAGE_TEXT',maximumCaptureReserve:6000};
  return {plan,head,policy,scope,checkpoint,observation,authority:{authorizationEvidence,reportAuthorization}};
}
async function fixture(){const f=evidence();const privateRoot=resolve(root,'.local-preview');await mkdir(privateRoot,{recursive:true});
  const temporary=await mkdtemp(join(privateRoot,'recovery-cli-fixture-')),directory=resolve(temporary,'.local-preview/management-split');
  await mkdir(directory,{recursive:true});await writeFile(resolve(temporary,'.gitignore'),'.local-preview/\n');
  const inputs={'capture-recovery-plan-FA-rec1.json':f.plan,'capture-recovery-authority-FA-rec1.json':f.authority,
    'capture-recovery-observation-FA-rec1.json':f.observation,'quarter-head-FA.json':f.head,'backup-read-policy-FA.json':f.policy,
    'backup-scope-FA.json':f.scope,[f.head.activeCheckpointFile]:seal(f.checkpoint),'backup-read-FA.lock':{historicalLock:true}};
  for(const [name,value]of Object.entries(inputs))await writeFile(resolve(directory,name),JSON.stringify(value)+'\n');
  const sourceHashes=new Map(await Promise.all(Object.keys(inputs).map(async name=>[name,hash(await readFile(resolve(directory,name)))])));
  async function verifyOld(){for(const [name,pin]of sourceHashes)assert.equal(hash(await readFile(resolve(directory,name))),pin,name);}
  async function cleanup(){for(const name of await readdir(directory)){const p=resolve(directory,name);const st=await lstat(p);
    assert.ok(st.isFile()||st.isSymbolicLink());await unlink(p);}await rmdir(directory);await rmdir(dirname(directory));
    await unlink(resolve(temporary,'.gitignore'));await rmdir(temporary);}
  const options={root:temporary,args:['FA-rec1','--capture'],clock:()=>now,createProtector:async()=>protector,
    openProtected,readLegacyReserve:async()=>0};
  return {...f,temporary,directory,options,verifyOld,cleanup};
}
async function using(run){const f=await fixture();try{return await run(f);}finally{await f.cleanup();}}
const runOptions=(f,extra={})=>({...f.options,acquireCredentials:async()=>({transport:async request=>{
  if(request.operation==='listCollectionIds')return {};
  if(request.collectionId==='managementR00')return {documents:[{name:'projects/'+FA+'/databases/(default)/documents/managementR00/current',
    fields:{text:{stringValue:'PRIVATE_CURRENT_SYNTHETIC'}},createTime:'2026-10-09T15:55:00.000Z',updateTime:'2026-10-09T15:55:00.000Z'}]};
  return {};
}}),...extra});

test('local preflight verifies exact predecessor and fresh counter with no journal, credentials or IO',()=>using(async f=>{
  let calls=0;const result=await runManagementCaptureRecovery(runOptions(f,{args:['FA-rec1','--preflight'],
    createProtector:async()=>{calls++;throw Error('NO_PROTECTOR');},acquireCredentials:async()=>{calls++;throw Error('NO_CREDS');}}));
  assert.equal(calls,0);assert.equal(result.mode,'LOCAL_RECOVERY_PREFLIGHT');assert.equal(result.credentialLookupIssued,0);
  assert.equal(result.firestoreDocumentReadsIssued,0);assert.equal(result.exactGlobalCutoff,false);
  assert.equal((await readdir(f.directory)).includes(files.journal),false);await f.verifyOld();
}));

test('single full synthetic recovery reserves durably before every IO and preserves old artifacts and times',()=>using(async f=>{
  let dispatch=0,seenTime;const options=runOptions(f);const transport=(await options.acquireCredentials()).transport;
  options.acquireCredentials=async()=>{assert.ok((await readdir(f.directory)).includes(files.journal));return {transport:async(req,ctx)=>{
    const saved=await openProtected(JSON.parse(await readFile(resolve(f.directory,files.journal),'utf8')));
    assert.equal(saved.reservations.length,dispatch+1);assert.equal(saved.dispatchAttempts,dispatch);
    assert.equal(saved.coreCheckpoint.summary.lastStatus,'RESERVED');
    assert.equal(saved.checkpointSha256,snapshotDigest(unpackRecoveryCore(saved.coreCheckpoint)));
    assert.equal(saved.reservations.at(-1).requestSha256,snapshotDigest(req));
    const time=req.query?.readTime||req.body?.readTime;seenTime??=time;assert.equal(time,seenTime);dispatch++;
    return transport(req,ctx);
  }};};
  const result=await runManagementCaptureRecovery(options);
  assert.equal(result.status,'COMPLETE');assert.equal(result.counts.documents,1);assert.equal(result.counts.collectionsCompleted,43);
  assert.equal(result.counts.discoveryParentsCompleted,1);assert.equal(dispatch,44);assert.equal(result.counts.newReservedReads,1076);
  assert.equal(result.counts.cumulativeConservativeReservedReads,2418);assert.equal(result.readTime,'2026-10-09T15:59:55.000Z');
  assert.notEqual(result.readTime,oldRead);assert.equal(result.lockRetainedRequiresReview,false);
  assert.equal(result.operationalFreshnessEvaluated,false);assert.equal(result.migrationReady,false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(JSON.stringify(result).includes('managementR00/current'),false);
  const journal=await openProtected(JSON.parse(await readFile(resolve(f.directory,files.journal),'utf8')));
  assert.equal(journal.pausedRequiresReview,true);assert.equal(journal.renewalClearsPause,false);
  assert.equal(journal.binding.deadlineAt,'2026-10-09T16:04:00.000Z');assert.equal(journal.reservations.length,44);
  assert.equal((await readdir(f.directory)).includes(files.coordinator),false);await f.verifyOld();
}));

test('CLI refuses namespace reuse instead of resuming, rebinding or resetting checkpoints',()=>using(async f=>{
  await runManagementCaptureRecovery(runOptions(f));let credentials=0;
  await assert.rejects(runManagementCaptureRecovery(runOptions(f,{acquireCredentials:async()=>{credentials++;return {transport:()=>({})};}})),
    /RECOVERY_NAMESPACE_ALREADY_USED_REQUIRES_REVIEW/);
  assert.equal(credentials,0);await f.verifyOld();
}));

for(const [title,file,mutate]of [
  ['policy pause cleared','backup-read-policy-FA.json',v=>{v.pausedRequiresReview=false;}],
  ['scope changed','backup-scope-FA.json',v=>{v.rootCollections[0]='unapproved';}],
  ['old head changed','quarter-head-FA.json',v=>{v.counters.reservedReads=0;}],
  ['stale report','capture-recovery-observation-FA-rec1.json',v=>{v.reportedAt='2026-10-09T15:00:00.000Z';}],
  ['plan changed','capture-recovery-plan-FA-rec1.json',v=>{v.quota.newCaptureReservationLimit=4000;}],
  ['authority missing','capture-recovery-authority-FA-rec1.json',v=>{delete v.authorizationEvidence;}],
])test('preflight refuses '+title+' before credentials and new artifacts',()=>using(async f=>{
  const p=resolve(f.directory,file),v=JSON.parse(await readFile(p,'utf8'));mutate(v);await writeFile(p,JSON.stringify(v));let credentials=0;
  await assert.rejects(runManagementCaptureRecovery(runOptions(f,{acquireCredentials:async()=>{credentials++;throw Error('UNREACHABLE');}})));
  assert.equal(credentials,0);assert.equal((await readdir(f.directory)).includes(files.journal),false);
}));

test('changed predecessor after credentials stops before any transport and retains paused journal',()=>using(async f=>{
  let io=0;await assert.rejects(runManagementCaptureRecovery(runOptions(f,{acquireCredentials:async()=>{
    await writeFile(resolve(f.directory,'backup-read-policy-FA.json'),JSON.stringify({...f.policy,reservedReads:0}));
    return {transport:()=>{io++;return {};}};
  }})),/RECOVERY_PREDECESSOR_OR_AUTHORITY_CHANGED/);
  assert.equal(io,0);assert.ok((await readdir(f.directory)).includes(files.coordinator));
  const journal=await openProtected(JSON.parse(await readFile(resolve(f.directory,files.journal),'utf8')));
  assert.equal(journal.pausedRequiresReview,true);assert.equal(journal.status,'INCOMPLETE');
}));

test('failed transport conserves debit and incomplete checkpoint, never publishes complete packet',()=>using(async f=>{
  const result=await runManagementCaptureRecovery(runOptions(f,{acquireCredentials:async()=>({transport:()=>{throw Error('HTTP_PRIVATE_DETAIL');}})}));
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.newReservedReads,25);assert.equal(result.firestoreDocumentReadsIssued,1);
  assert.equal(result.lockRetainedRequiresReview,true);assert.equal((await readdir(f.directory)).includes(files.capture),false);
  assert.ok((await readdir(f.directory)).includes(files.checkpoint));await f.verifyOld();
}));

test('runtime never extends fixed deadline or retries after the clock expires',()=>using(async f=>{
  let current=now,io=0;const result=await runManagementCaptureRecovery(runOptions(f,{clock:()=>current,
    acquireCredentials:async()=>({transport:()=>{io++;current=now+240000;return {};}})}));
  assert.equal(result.status,'INCOMPLETE');assert.equal(io,1);assert.equal(result.newReservedReads,25);
  const journal=await openProtected(JSON.parse(await readFile(resolve(f.directory,files.journal),'utf8')));
  assert.equal(journal.binding.deadlineAt,'2026-10-09T16:04:00.000Z');await f.verifyOld();
}));

test('checkpoint encryption/readback failure prevents all source IO and retains coordinator',()=>using(async f=>{
  let io=0;const bad={seal,open:async e=>{if(e.synthetic?.coreCheckpoint)throw Error('SYNTHETIC_CHECKPOINT_FAILED');return openProtected(e);}};
  await assert.rejects(runManagementCaptureRecovery(runOptions(f,{createProtector:async()=>bad,
    acquireCredentials:async()=>({transport:()=>{io++;return {};}})})));
  assert.equal(io,0);assert.equal((await readdir(f.directory)).includes(files.capture),false);
  assert.ok((await readdir(f.directory)).includes(files.coordinator));
}));

test('coordinator excludes a second concurrent recovery attempt before credentials',()=>using(async f=>{
  const store=await createManagementCaptureRecoveryStore({directory:f.directory,protector,openProtected});await store.acquire();
  let calls=0;try{await assert.rejects(runManagementCaptureRecovery(runOptions(f,{acquireCredentials:async()=>{calls++;return {transport:()=>({})};}})),
    /RECOVERY_COORDINATOR_PRESENT_REQUIRES_REVIEW/);assert.equal(calls,0);}finally{await store.close({release:true});}
  await f.verifyOld();
}));

test('store binds readTime once and cannot refund or rearm a terminal journal',()=>using(async f=>{
  const store=await createManagementCaptureRecoveryStore({directory:f.directory,protector,openProtected});await store.acquire();
  try{const budget=prepareManagementCaptureRecoveryBudget({plan:f.plan,predecessorPolicy:f.policy,authorizationEvidence,
      reportAuthorization:f.authority.reportAuthorization,nowMs:now});
    const binding=bindManagementCaptureRecoveryReadTime({plan:f.plan,readTime:'2026-10-09T15:59:55.000Z',nowMs:now});
    const bound=bindManagementCaptureRecoveryBudget({plan:f.plan,predecessorPolicy:f.policy,authorizationEvidence,budget,
      readTime:binding.readTime,startedAt:binding.startedAt,deadlineAt:binding.deadlineAt,nowMs:now});
    const base={schemaVersion:1,namespace:'FA-rec1',planSha256:f.plan.planSha256,status:'PREPARED',revision:1,
    previousJournalSha256:null,predecessor:f.plan.predecessor,binding:null,budget,reservations:[],dispatchAttempts:0,pausedRequiresReview:false,automaticResume:false};
    const first=await store.persistJournal(base,{expectedSha256:null});
    const next={...base,status:'IN_PROGRESS',revision:2,previousJournalSha256:first.valueSha256,binding,budget:bound};
    await assert.rejects(store.persistJournal({...next,budget},{expectedSha256:first.valueSha256}),/RECOVERY_JOURNAL_BUDGET_INVALID/);
    const second=await store.persistJournal(next,{expectedSha256:first.valueSha256});
    await assert.rejects(store.persistJournal({...next,revision:3,previousJournalSha256:second.valueSha256,binding:{readTime:'changed'}},
      {expectedSha256:second.valueSha256}),/RECOVERY_JOURNAL_(TRANSITION|BUDGET)_INVALID/);
    await assert.rejects(store.persistJournal({...next,revision:3,previousJournalSha256:second.valueSha256},{expectedSha256:'b'.repeat(64)}),
      /RECOVERY_JOURNAL_CAS_MISMATCH/);
  }finally{await store.close({release:true});}
}));

test('invalid CLI arguments have safe zero effects and no credential output',()=>{
  const script=resolve(root,'scripts/management-firestore-capture-recovery.mjs');
  for(const args of [[],['FA','--capture'],['FB','--capture'],['FA-rec1','--resume'],['FA-rec1','--capture','--force']]){
    const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',cwd:root});
    assert.equal(result.status,1);assert.equal(result.stdout,'');const error=JSON.parse(result.stderr.trim());
    assert.equal(error.code,'USE_FA_REC1_PREFLIGHT_OR_CAPTURE');assert.equal(error.credentialLookupIssued,0);
    assert.equal(error.firestoreDocumentReadsIssued,0);assert.equal(error.firestoreWritesIssued,0);
    assert.equal(error.sourcePauseChanged,false);
  }
});


 test('offline 365-document recovery measures 420 durable requests without HTTP or real accounts',{skip:process.platform!=='win32'||process.env.SAHMT_RECOVERY_BENCHMARK!=='1'},t=>using(async f=>{
  let ordinal=0;
  const docs=f.scope.rootCollections.flatMap((id,index)=>Array.from({length:index===0?301:index<=22?2:1},(_,n)=>{
    const fields={};for(let group=0;group<4;group++)fields['group'+group]={arrayValue:{values:Array.from({length:6},(_,i)=>({
      mapValue:{fields:{value:{integerValue:String(i)}}}}))}};
    let deep={integerValue:'1'};for(let depth=0;depth<9;depth++)deep={mapValue:{fields:{child:deep}}};fields.deep=deep;
    for(let i=0;i<4;i++)fields['scalar'+i]={integerValue:String(i)};
    if(ordinal++%40===0)fields.extraArray={arrayValue:{values:[]}};
    fields.text={stringValue:'PRIVATE_PERFORMANCE_FIXTURE'};
    const row={name:'projects/'+FA+'/databases/(default)/documents/'+id+'/perf'+n,fields,
      createTime:'2026-10-09T15:55:00.000Z',updateTime:'2026-10-09T15:55:00.000Z'};
    fields.text.stringValue+='x'.repeat(Math.max(0,3486-Buffer.byteLength(JSON.stringify(row))));return row;
  }));
  const profile={nodes:0,objects:0,arrays:0,stringBytes:0,maxDepth:0};
  const inspect=(value,depth=0)=>{profile.nodes++;profile.maxDepth=Math.max(profile.maxDepth,depth);
    if(typeof value==='string')profile.stringBytes+=Buffer.byteLength(value);
    if(Array.isArray(value)){profile.arrays++;for(const item of value)inspect(item,depth+1);}
    else if(value&&typeof value==='object'){profile.objects++;for(const item of Object.values(value))inspect(item,depth+1);}};
  inspect(docs);assert.ok(profile.nodes>=62911);assert.ok(profile.objects>=44071);assert.ok(profile.arrays>=1471);
  assert.ok(profile.maxDepth>=28);assert.ok(profile.stringBytes>=407987);assert.ok(Buffer.byteLength(JSON.stringify(docs))>=1272313);
  let calls=0;const timings={reserveReadsMs:0,checkpointMs:0,transportGuardMs:0},start=performance.now();
  const measuredCore=options=>captureFirestoreSnapshot({...options,...Object.fromEntries([
    ['reserveReads','reserveReadsMs'],['checkpoint','checkpointMs'],['transport','transportGuardMs']
  ].map(([method,category])=>[method,async(...args)=>{const started=performance.now();
    try{return await options[method](...args);}finally{timings[category]+=performance.now()-started;}}]))});
  const result=await runManagementCaptureRecovery(runOptions(f,{captureCore:measuredCore,createProtector:createPrivateJsonProtector,
    openProtected:envelope=>Object.hasOwn(envelope,'synthetic')?openProtected(envelope):openPrivateJson(envelope),
    acquireCredentials:async()=>({transport:request=>{
    calls++;if(request.operation==='listCollectionIds')return {};
    const rows=docs.filter(d=>d.name.startsWith(request.parent+'/'+request.collectionId+'/'));
    const offset=Number(request.query.pageToken||0),selected=rows.slice(offset,offset+request.query.pageSize);
    return {documents:selected,...(offset+selected.length<rows.length?{nextPageToken:String(offset+selected.length)}:{})};
  }})}));
  const elapsed=performance.now()-start;
  assert.equal(result.status,'COMPLETE');assert.equal(result.counts.documents,365);assert.equal(calls,420);
  assert.equal(result.counts.discoveryParentsCompleted,365);assert.equal(result.counts.newReservedReads,1740);
  assert.equal(result.counts.cumulativeConservativeReservedReads,3082);await f.verifyOld();
  t.diagnostic('syntheticDocumentsProfile='+JSON.stringify({...profile,jsonBytes:Buffer.byteLength(JSON.stringify(docs))}));
  t.diagnostic('syntheticOffline365Documents420RequestsDurationMs='+elapsed.toFixed(3)+'; networkCalls=0; actualWindowsDPAPISynthetic=true');
  t.diagnostic('syntheticLocalDurationCategoriesMs='+JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k,v])=>[k,Number(v.toFixed(3))]))));
}));

 test('human report expiry during legacy read denies HTTP using the final clock',()=>using(async f=>{
  let current=now,legacyCalls=0,io=0;
  const reportedAt=new Date(now-65000).toISOString();
  f.observation.reportedAt=reportedAt;f.observation.reportProvenance.reportedAt=reportedAt;
  f.authority.reportAuthorization.reportedAt=reportedAt;
  f.authority.reportAuthorization.observationSha256=sourceUsageHumanReportObservationSha256(f.observation);
  await writeFile(resolve(f.directory,'capture-recovery-observation-FA-rec1.json'),JSON.stringify(f.observation));
  await writeFile(resolve(f.directory,'capture-recovery-authority-FA-rec1.json'),JSON.stringify(f.authority));
  const result=await runManagementCaptureRecovery(runOptions(f,{clock:()=>current,readLegacyReserve:async()=>{
    legacyCalls++;if(legacyCalls===6)current=Date.parse(f.observation.reportedAt)+300001;return 0;
  },acquireCredentials:async()=>({transport:()=>{io++;return {};}})}));
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.errorCode,'MANUAL_SOURCE_USAGE_HUMAN_REPORT_INVALID_OR_EXPIRED');assert.equal(io,0);assert.equal(result.newReservedReads,25);
  assert.ok((await readdir(f.directory)).includes(files.coordinator));assert.equal(snapshotDigest(JSON.parse(await readFile(resolve(f.directory,'backup-read-policy-FA.json'),'utf8'))),snapshotDigest(f.policy));
}));

 test('predecessor changed during the last legacy read is refused before HTTP',()=>using(async f=>{
  let calls=0,io=0;const result=await runManagementCaptureRecovery(runOptions(f,{readLegacyReserve:async()=>{
    if(++calls===6)await writeFile(resolve(f.directory,'backup-read-policy-FA.json'),JSON.stringify({...f.policy,reservedReads:0}));
    return 0;
  },acquireCredentials:async()=>({transport:()=>{io++;return {};}})}));
  assert.equal(result.status,'INCOMPLETE');assert.equal(io,0);assert.equal(result.newReservedReads,25);
  assert.ok((await readdir(f.directory)).includes(files.coordinator));
}));
 test('store independently rejects budget rollback, truncation and terminal pause clearing',()=>using(async f=>{
  const store=await createManagementCaptureRecoveryStore({directory:f.directory,protector,openProtected});await store.acquire();
  const input={plan:f.plan,predecessorPolicy:f.policy,authorizationEvidence,reportAuthorization:f.authority.reportAuthorization,
    observation:f.observation,nowMs:now};
  let budget=prepareManagementCaptureRecoveryBudget(input),journal={schemaVersion:1,namespace:'FA-rec1',planSha256:f.plan.planSha256,
    status:'PREPARED',revision:1,previousJournalSha256:null,predecessor:f.plan.predecessor,binding:null,budget,reservations:[],
    dispatchAttempts:0,pausedRequiresReview:false,automaticResume:false};
  try{
    let pin=(await store.persistJournal(journal,{expectedSha256:null})).valueSha256;
    const binding=bindManagementCaptureRecoveryReadTime({plan:f.plan,readTime:'2026-10-09T15:59:55.000Z',nowMs:now});
    const before=bindManagementCaptureRecoveryBudget({...input,budget,readTime:binding.readTime,startedAt:binding.startedAt,deadlineAt:binding.deadlineAt});
    journal={...journal,revision:2,previousJournalSha256:pin,status:'IN_PROGRESS',binding,budget:before};
    pin=(await store.persistJournal(journal,{expectedSha256:pin})).valueSha256;
    const reservation={projectId:FA,databaseId:'(default)',readTime:binding.readTime,operation:'listDocuments',attempt:1,
      requestSha256:'a'.repeat(64),maximumReads:25};
    budget=assessRecoveryReadBudget({...input,budget:before,reservation}).nextBudget;
    journal={...journal,revision:3,previousJournalSha256:pin,budget,reservations:[{...reservation,reservedAt:new Date(now).toISOString()}]};
    pin=(await store.persistJournal(journal,{expectedSha256:pin})).valueSha256;
    const revision4={...journal,revision:4,previousJournalSha256:pin};
    await assert.rejects(store.persistJournal({...revision4,budget:before},{expectedSha256:pin}),/RECOVERY_JOURNAL_BUDGET_INVALID/);
    await assert.rejects(store.persistJournal({...revision4,budget:before,reservations:[]},{expectedSha256:pin}),/RECOVERY_JOURNAL_BUDGET_ROLLBACK_FORBIDDEN/);
    const closed=finishManagementCaptureRecoveryBudget({...input,budget,status:'COMPLETE',captureFinishedAt:new Date(now).toISOString()});
    journal={...revision4,budget:closed,status:'COMPLETE',pausedRequiresReview:true};
    pin=(await store.persistJournal(journal,{expectedSha256:pin})).valueSha256;
    await assert.rejects(store.persistJournal({...journal,revision:5,previousJournalSha256:pin,status:'IN_PROGRESS',pausedRequiresReview:false,
      budget},{expectedSha256:pin}),/RECOVERY_JOURNAL_(TRANSITION_INVALID|BUDGET_ROLLBACK_FORBIDDEN)/);
    assert.equal((await store.readJournal()).value.budget.recoveryReservedReads,25);
  }finally{await store.close({release:true});}
}));

 test('failed protected journal readback invalidates the store and retains its coordinator',()=>using(async f=>{
  const badOpen=async e=>{if(e.synthetic?.namespace==='FA-rec1')throw Error('SYNTHETIC_READBACK_FAILURE');return openProtected(e);};
  const store=await createManagementCaptureRecoveryStore({directory:f.directory,protector,openProtected:badOpen});await store.acquire();
  const budget=prepareManagementCaptureRecoveryBudget({plan:f.plan,predecessorPolicy:f.policy,authorizationEvidence,
    reportAuthorization:f.authority.reportAuthorization,nowMs:now});
  const journal={schemaVersion:1,namespace:'FA-rec1',planSha256:f.plan.planSha256,status:'PREPARED',revision:1,
    previousJournalSha256:null,predecessor:f.plan.predecessor,binding:null,budget,reservations:[],dispatchAttempts:0,
    pausedRequiresReview:false,automaticResume:false};
  await assert.rejects(store.persistJournal(journal,{expectedSha256:null}),/SYNTHETIC_READBACK_FAILURE/);
  await assert.rejects(store.readJournal(),/RECOVERY_STORE_INVALIDATED_REQUIRES_REVIEW/);
  await assert.rejects(store.persistJournal(journal,{expectedSha256:null}),/RECOVERY_STORE_INVALIDATED_REQUIRES_REVIEW/);
  assert.equal((await store.close({release:true})).lockRetained,true);assert.ok((await readdir(f.directory)).includes(files.coordinator));
}));
 test('store rejects envelope v3 and preserves historical DPAPI v2 as the only write format',()=>using(async f=>{
  const wrong={seal:v=>({...seal(v),schemaVersion:3,protection:'AES256_GCM_DEFLATE_RAW_WITH_WINDOWS_DPAPI_CURRENT_USER',compression:'DEFLATE_RAW'}),open:openProtected};
  const store=await createManagementCaptureRecoveryStore({directory:f.directory,protector:wrong,openProtected});await store.acquire();
  const budget=prepareManagementCaptureRecoveryBudget({plan:f.plan,predecessorPolicy:f.policy,authorizationEvidence,
    reportAuthorization:f.authority.reportAuthorization,nowMs:now});
  try{await assert.rejects(store.persistJournal({schemaVersion:1,namespace:'FA-rec1',planSha256:f.plan.planSha256,status:'PREPARED',revision:1,
    previousJournalSha256:null,predecessor:f.plan.predecessor,binding:null,budget,reservations:[],dispatchAttempts:0,
    pausedRequiresReview:false,automaticResume:false},{expectedSha256:null}),/RECOVERY_STORE_PROTECTED_OUTPUT_REQUIRED/);
    assert.equal((await readdir(f.directory)).includes(files.journal),false);
  }finally{await store.close({release:true});}
}));

 test('predecessor mutated in the last precredential legacy check prevents credentials',()=>using(async f=>{
  let legacyCalls=0,credentials=0;
  await assert.rejects(runManagementCaptureRecovery(runOptions(f,{readLegacyReserve:async()=>{
    if(++legacyCalls===3)await writeFile(resolve(f.directory,'backup-read-policy-FA.json'),JSON.stringify({...f.policy,reservedReads:0}));
    return 0;
  },acquireCredentials:async()=>{credentials++;return {transport:()=>({})};}})),/RECOVERY_PREDECESSOR_OR_AUTHORITY_CHANGED/);
  assert.equal(credentials,0);
  assert.ok((await readdir(f.directory)).includes(files.coordinator));
  assert.equal((await readdir(f.directory)).includes(files.capture),false);
}));

async function useManualApproval(f,{reportAgeMs=2*60*60*1000}={}){
  const {prepareManagementManualReadApproval}=await import('../scripts/lib/management-manual-read-approval.js');
  const manualNow=Date.parse('2026-10-09T19:30:00.000Z');
  const reportedAt=new Date(manualNow-reportAgeMs).toISOString(),reviewedAt='2026-10-09T19:20:00.000Z';
  const observation={...f.observation,reportedAt,reviewedAt,
    reportProvenance:{...f.observation.reportProvenance,reportedAt}};
  const text='não quero nenhuma janela de segurança , vou autorizando a leitura manualmente. pois estã atrazando tuso\n';
  const manualControlEvidence={schemaVersion:1,source:'EXPLICIT_HUMAN_MESSAGE',humanMessageId:'synthetic-manual-policy-message',
    recordedAt:'2026-10-09T19:14:30.000Z',text,textSha256:hash(text)};
  const reportAuthorization=prepareManagementManualReadApproval({plan:f.plan,authorizationEvidence,manualControlEvidence,observation,nowMs:manualNow});
  const authority={authorizationEvidence,reportAuthorization,manualControlEvidence};
  await writeFile(resolve(f.directory,'capture-recovery-authority-FA-rec1.json'),JSON.stringify(authority));
  await writeFile(resolve(f.directory,'capture-recovery-observation-FA-rec1.json'),JSON.stringify(observation));
  return {manualNow,authority,observation,manualControlEvidence};
}

test('manual CLI preflight keeps the original old estimate and does not require five-minute renewal',()=>using(async f=>{
  const m=await useManualApproval(f);let credentials=0;
  const r=await runManagementCaptureRecovery(runOptions(f,{args:['FA-rec1','--preflight'],clock:()=>m.manualNow,
    acquireCredentials:async()=>{credentials++;throw Error('NO_CREDS_EXPECTED');}}));
  assert.equal(r.eligibleForCapture,true);assert.equal(r.budget.allowed,true);assert.equal(credentials,0);
  assert.equal(r.budget.estimatedWithMargin,13367);assert.equal(r.firestoreDocumentReadsIssued,0);
  assert.equal(JSON.parse(await readFile(resolve(f.directory,'capture-recovery-observation-FA-rec1.json'),'utf8')).reportedAt,'2026-10-09T17:30:00.000Z');
  assert.equal((await readdir(f.directory)).includes(files.journal),false);
}));

test('manual CLI completes one bounded synthetic capture with no expiry by elapsed report time',()=>using(async f=>{
  const m=await useManualApproval(f);const original=(await runOptions(f).acquireCredentials()).transport;let dispatched=0;
  const r=await runManagementCaptureRecovery(runOptions(f,{clock:()=>m.manualNow,acquireCredentials:async()=>({transport:async(req,ctx)=>{
    const j=await openProtected(JSON.parse(await readFile(resolve(f.directory,files.journal),'utf8')));
    assert.equal(j.reservations.length,dispatched+1);assert.equal(j.coreCheckpoint.summary.lastStatus,'RESERVED');
    dispatched++;return original(req,ctx);
  }})}));
  assert.equal(r.status,'COMPLETE');assert.equal(dispatched,44);assert.equal(r.counts.documents,1);
  assert.equal(r.counts.newReservedReads,1076);assert.equal(r.counts.cumulativeConservativeReservedReads,2418);
  assert.equal(r.firestoreWritesIssued,0);assert.equal(r.authChangesIssued,0);assert.equal(r.sourcePauseChanged,false);
  await assert.rejects(runManagementCaptureRecovery(runOptions(f,{clock:()=>m.manualNow})),/RECOVERY_NAMESPACE_ALREADY_USED_REQUIRES_REVIEW/);
}));

test('manual CLI refuses a rehashed approval altered independently of pinned human control before credentials',()=>using(async f=>{
  const m=await useManualApproval(f);m.authority.manualControlEvidence.text+=' bypass all limits';
  await writeFile(resolve(f.directory,'capture-recovery-authority-FA-rec1.json'),JSON.stringify(m.authority));
  let credentials=0;await assert.rejects(runManagementCaptureRecovery(runOptions(f,{clock:()=>m.manualNow,
    acquireCredentials:async()=>{credentials++;throw Error('NO_CREDS_EXPECTED');}})));
  assert.equal(credentials,0);assert.equal((await readdir(f.directory)).includes(files.journal),false);
}));

test('manual CLI rejects a new LA day and never treats quota renewal as new consent',()=>using(async f=>{
  await useManualApproval(f);let credentials=0;
  await assert.rejects(runManagementCaptureRecovery(runOptions(f,{clock:()=>Date.parse('2026-10-10T07:00:00.000Z'),
    acquireCredentials:async()=>{credentials++;throw Error('NO_CREDS_EXPECTED');}})));
  assert.equal(credentials,0);assert.equal((await readdir(f.directory)).includes(files.journal),false);
}));
