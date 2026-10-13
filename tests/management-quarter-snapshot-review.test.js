import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp, unlink, rmdir, readdir, lstat, symlink, link} from 'node:fs/promises';
import {resolve, dirname, join, relative, isAbsolute, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {captureFirestoreSnapshot} from '../scripts/lib/firestore-snapshot-capture.js';
import {prepareManagementCaptureQuarterPlan} from '../scripts/lib/management-capture-quarter-plan.js';
import {beginManagementCaptureQuarterHead, advanceManagementCaptureQuarterHead} from '../scripts/lib/management-capture-quarter-head.js';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {reviewManagementQuarterSnapshot, MANAGEMENT_QUARTER_REVIEW_BASELINE,
  MANAGEMENT_QUARTER_REVIEW_RECEIPT} from '../scripts/lib/management-quarter-snapshot-review.js';
import {runLocalManagementQuarterReview} from '../scripts/management-quarter-review.mjs';
import {createPrivateJsonProtector, openPrivateJson} from '../scripts/lib/windows-protected-json.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), FA = 'sahmt-17a16';
const sourceTime = '2026-10-09T14:00:00.000Z', baselineTime = '2026-10-09T13:00:00.000Z';
const captureName = 'capture-FA-20261009140005000.dpapi.json';
const checkpointName = 'capture-FA-20261009140005000-latest.dpapi.json';
const outputName = 'quarter-review-FA-synthetic.dpapi.json';
const sentinel = 'PRIVATE_SYNTHETIC_QUARTER_CONTENT';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plainClone = v => JSON.parse(JSON.stringify(v));
const repin = (v, key) => {const {[key]:removed, ...body} = v; return {...body, [key]:snapshotDigest(body)};};
async function fixture({sourceDocuments, change = true} = {}) {
  const scope = {schemaVersion:1, projectId:FA, databaseId:'(default)', rootCollections:['managementAreas']};
  const documents = Array.from({length:8}, (_, i) => ({path:'managementAreas/item' + i,
    fields:{name:{stringValue:sentinel + i}}, createTime:'2026-10-09T12:00:00.000Z',
    updateTime:'2026-10-09T12:30:00.000Z'}));
  const baseline = {schemaVersion:1, projectId:FA, databaseId:'(default)', readTime:baselineTime,
    coverage:{complete:true, consistent:true, rootCollections:scope.rootCollections}, documents};
  const plan = prepareManagementCaptureQuarterPlan({sourceSnapshot:baseline, scope});
  const current = sourceDocuments || [{...plainClone(documents[0]), ...(change ? {
    fields:{name:{stringValue:sentinel + '_changed'}}, updateTime:'2026-10-09T13:30:00.000Z'} : {})}];
  const limits = {maxPages:200, maxDepth:30, maxBytes:12*1024*1024, maxDocuments:6000,
    maxDurationMs:180000, requestTimeoutMs:20000};
  const started = Date.parse(sourceTime) + 5000;
  const configuration = {projectId:FA, databaseId:'(default)', rootCollections:scope.rootCollections,
    readTime:sourceTime, pageSize:plan.documentPageSize, collectionPageSize:100,
    maxBatchDocuments:plan.maxBatchDocuments, maxBatches:4, limits};
  const adapters = {reserveReads:()=>true, checkpoint:()=>{}, transport:request=>{
    if (request.operation === 'listCollectionIds') return {};
    const offset=Number(request.query.pageToken||0), selected=current.slice(offset,offset+request.query.pageSize);
    return {documents:selected.map(({path,...d})=>({...d,name:'projects/'+FA+'/databases/(default)/documents/'+path})),
      ...(offset+selected.length<current.length?{nextPageToken:String(offset+selected.length)}:{})};
  }};
  let activeCheckpoint=checkpointName;
  let capture=await captureFirestoreSnapshot({...configuration,...adapters,clock:()=>started});
  let head=beginManagementCaptureQuarterHead({plan,runId:'synthetic_run',checkpointFile:activeCheckpoint,
    readTime:sourceTime,nowMs:started});
  head=advanceManagementCaptureQuarterHead({head,expectedHeadSha256:head.headSha256,plan,
    checkpointFile:activeCheckpoint,coreState:capture.state,nowMs:started+1000});
  for(let number=2;capture.status==='PARTIAL_REVIEW' && number<=4;number++) {
    const priorFile=activeCheckpoint, runStart=started+number*3000;
    activeCheckpoint='capture-FA-2026100914000'+number+'000-latest.dpapi.json';
    head=beginManagementCaptureQuarterHead({head,expectedHeadSha256:head.headSha256,plan,
      runId:'synthetic_run_'+number,checkpointFile:activeCheckpoint,readTime:sourceTime,nowMs:runStart,
      resumeCheckpoint:{schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:FA,
        quarterPlan:plan,coreState:capture.state,checkpointFile:priorFile},captureConfiguration:configuration,
      review:{humanDecisionAt:new Date(runStart-1000).toISOString(),authorizationEvidence:'SYNTHETIC_REVIEW_'+number}});
    capture=await captureFirestoreSnapshot({...configuration,...adapters,clock:()=>runStart,
      resumeState:capture.state,resumeStateSha256:snapshotDigest(capture.state),
      resumeReviewId:head.runHistory.at(-1).reviewId});
    head=advanceManagementCaptureQuarterHead({head,expectedHeadSha256:head.headSha256,plan,
      checkpointFile:activeCheckpoint,coreState:capture.state,nowMs:runStart+1000});
  }
  assert.equal(capture.status,'COMPLETE');
  const packetName=activeCheckpoint.replace('-latest.dpapi.json','.dpapi.json');
  const packet = {schemaVersion:1, kind:'FIRESTORE_SELECTED_SCOPE_CAPTURE', projectId:FA, status:'COMPLETE',
    readBudgetObservation:{observationSource:'USER_CURRENT_USAGE_HUMAN_REPORT', totalUsageKnown:false},
    quarterPlan:plan, checkpointFile:activeCheckpoint, snapshot:capture.snapshot, receipt:capture.receipt};
  const checkpointPacket = {schemaVersion:1, kind:'FIRESTORE_QUARTER_CHECKPOINT', projectId:FA, quarterPlan:plan,
    coreState:capture.state};
  const publicReceipt = {schemaVersion:1, projectId:FA, status:'COMPLETE', errorCode:null, file:packetName,
    ciphertextSha256:'a'.repeat(64), scopeRootCount:1, manualQuarterCapture:true,
    maxBatchDocuments:plan.maxBatchDocuments, maxBatches:4, maxReservedReadsPerBatch:1500,
    capturedCumulative:capture.snapshot.documents.length, checkpointFile:activeCheckpoint,
    quarterPlanSha256:plan.planSha256, quarterHeadSha256:head.headSha256, quarterHeadRevision:head.revision,
    automaticNextBatch:false, requiresHumanReview:true, partialSnapshotEligibleForMigration:false,
    receiptSha256:capture.receipt.receiptSha256, snapshotSha256:capture.receipt.snapshotSha256,
    counts:capture.receipt.counts, decryptAndHashVerified:true, lockRetainedRequiresReview:false, firestoreWritesIssued:0};
  return {captureName:packetName, captureCiphertextSha256:publicReceipt.ciphertextSha256, packet, publicReceipt, head, checkpointPacket,
    baselinePacket:{snapshot:baseline}, baselineReceipt:{sourceSnapshotSha256:snapshotDigest(baseline)}, scope};
}

test('complete review reports private deltas only in protected result and makes no production/freshness claim', async()=>{
  const f = await fixture(), before = JSON.stringify(f), result = reviewManagementQuarterSnapshot(f);
  assert.equal(JSON.stringify(f), before);
  assert.deepEqual(result.summary.counts, {baselineDocuments:8, capturedDocuments:1, added:0, removed:7,
    changed:1, unchanged:0, changedCreateTimes:0, advancedUpdateTimes:1, regressedUpdateTimes:0, unchangedUpdateTimes:0});
  assert.equal(result.summary.sourceReadTime, sourceTime);
  assert.equal(result.summary.baselineReadTime, baselineTime);
  for (const key of ['productionAuthorized','migrationReady','operationalFreshnessEvaluated','manifestReanchored',
    'aclClassificationInferred','identityBindingApproved','sourcePauseChanged','readBudgetChanged','automaticNextBatch'])
    assert.equal(result.summary[key], false);
  for (const key of ['credentialLookupIssued','firestoreDocumentReadsIssued','firestoreWritesIssued','authChangesIssued','grantsIssued'])
    assert.equal(result.summary[key], 0);
  assert.equal(JSON.stringify(result.summary).includes(sentinel), false);
  assert.equal(JSON.stringify(result.summary).includes('managementAreas/item'), false);
  assert.equal(result.protectedReview.delta.changed[0].path, 'managementAreas/item0');
  assert.equal(result.protectedReview.delta.changed[0].previousUpdateTime, f.baselinePacket.snapshot.documents[0].updateTime);
  assert.equal(result.protectedReview.sourceSnapshot.readTime, sourceTime);
  assert.equal(result.protectedReview.delta.classification, 'UNREVIEWED');
});

test('review remains historical and preserves captured times without accepting a reviewedAt replacement', async()=>{
  const f = await fixture({change:false}), result = reviewManagementQuarterSnapshot(f);
  assert.equal(result.summary.counts.unchanged, 1);
  assert.equal(result.summary.counts.changed, 0);
  assert.equal(result.summary.operationalFreshnessEvaluated, false);
  assert.throws(()=>reviewManagementQuarterSnapshot({...f, nowMs:Date.parse(sourceTime)+3600000}), /INPUT_SCHEMA_INVALID/);
  const bad = plainClone(f); bad.packet.snapshot.readTime = '2026-10-09T15:30:00.000Z';
  assert.throws(()=>reviewManagementQuarterSnapshot(bad));
});

test('new, removed and timestamp changes are unreviewed deltas rather than inferred classification', async()=>{
  const newDoc = {path:'managementAreas/new', fields:{name:{stringValue:sentinel}}, createTime:'2026-10-09T13:00:00.000Z',
    updateTime:'2026-10-09T13:30:00.000Z'};
  const added = reviewManagementQuarterSnapshot(await fixture({sourceDocuments:[newDoc]}));
  assert.equal(added.summary.counts.added, 1); assert.equal(added.summary.counts.removed, 8);
  const old = (await fixture()).baselinePacket.snapshot.documents[0];
  const changed = reviewManagementQuarterSnapshot(await fixture({sourceDocuments:[{...old,
    createTime:'2026-10-09T11:00:00.000Z', updateTime:'2026-10-09T12:00:00.000Z'}]}));
  assert.equal(changed.summary.counts.changedCreateTimes, 1);
  assert.equal(changed.summary.counts.regressedUpdateTimes, 1);
  assert.equal(changed.summary.deltaNeedsClassificationReview, true);
  assert.equal(changed.summary.manifestReanchored, false);
});

const mutations = [
  ['partial packet', f=>{f.packet.status='PARTIAL_REVIEW';}],
  ['missing snapshot', f=>{f.packet.snapshot=null;}],
  ['incomplete coverage', f=>{f.packet.snapshot.coverage.complete=false;}],
  ['wrong project', f=>{f.packet.projectId='sahmt-gestao-5ae66';}],
  ['scope changed', f=>{f.scope.rootCollections.push('documents');}],
  ['baseline changed', f=>{f.baselinePacket.snapshot.documents[0].fields.name.stringValue='changed';}],
  ['baseline pin changed', f=>{f.baselineReceipt.sourceSnapshotSha256='b'.repeat(64);}],
  ['ciphertext changed', f=>{f.captureCiphertextSha256='b'.repeat(64);}],
  ['receipt hash changed', f=>{f.packet.receipt.receiptSha256='b'.repeat(64);}],
  ['public counts changed', f=>{f.publicReceipt.counts.documents=99;}],
  ['head changed', f=>{f.head.counters.documents++;}],
  ['public head pin changed', f=>{f.publicReceipt.quarterHeadSha256='b'.repeat(64);}],
  ['checkpoint file changed', f=>{f.packet.checkpointFile='capture-FA-111-latest.dpapi.json';}],
  ['checkpoint data changed', f=>{f.checkpointPacket.coreState.documents[0].fields.name.stringValue='changed';}],
  ['checkpoint partial', f=>{f.checkpointPacket.coreState.status='PARTIAL_REVIEW';}],
  ['plan changed', f=>{f.packet.quarterPlan.maxReservedReadsPerBatch++;}],
  ['unsafe checkpoint name', f=>{f.packet.checkpointFile='../secret.dpapi.json';}],
  ['extra approval field', f=>{f.packet.approval={authorized:true};}],
  ['head incomplete', f=>{f.head.status='INCOMPLETE';f.head=repin(f.head,'headSha256');f.publicReceipt.quarterHeadSha256=f.head.headSha256;}],
  ['writes claimed', f=>{f.publicReceipt.firestoreWritesIssued=1;}],
  ['automatic next claimed', f=>{f.publicReceipt.automaticNextBatch=true;}],
  ['lock retained', f=>{f.publicReceipt.lockRetainedRequiresReview=true;}],
  ['incomplete receipt repinned', f=>{f.packet.receipt.complete=false;f.packet.receipt=repin(f.packet.receipt,'receiptSha256');}],
];
for (const [name, change] of mutations) test('review rejects '+name, async()=>{
  const f = plainClone(await fixture()); change(f); assert.throws(()=>reviewManagementQuarterSnapshot(f));
});

test('repinning incomplete page chains or coverage cannot satisfy complete review', async()=>{
  for (const change of [
    c=>{c.pages[0].nextPageTokenSha256='c'.repeat(64);},
    c=>{c.pages[0].status='UNCERTAIN';},
    c=>{c.totalReservedReads--;},
    c=>{c.queue.push({operation:'listDocuments'});},
    c=>{c.knownCollections.push('managementAreas/item0/nested');},
    c=>{c.batchHistory[0].status='PARTIAL_REVIEW';},
  ]) {
    const f = plainClone(await fixture()), c=f.checkpointPacket.coreState; change(c);
    f.head.checkpointSha256=snapshotDigest(c); const {lastObservedAt,...body}=c;
    f.head.checkpointContentSha256=snapshotDigest(body);
    f.head=repin(f.head,'headSha256'); f.publicReceipt.quarterHeadSha256=f.head.headSha256;
    assert.throws(()=>reviewManagementQuarterSnapshot(f));
  }
});

test('getter, sparse array, prototype, symbol and invalid input limits fail without invoking data getters', async()=>{
  const f=await fixture(); let invoked=0;
  const getter={...f}; Object.defineProperty(getter,'packet',{enumerable:true,get(){invoked++;return f.packet;}});
  assert.throws(()=>reviewManagementQuarterSnapshot(getter)); assert.equal(invoked,0);
  const sparse=plainClone(f); sparse.packet.snapshot.documents=[,];
  assert.throws(()=>reviewManagementQuarterSnapshot(sparse));
  assert.throws(()=>reviewManagementQuarterSnapshot(Object.assign(Object.create({hidden:true}),f)));
  assert.throws(()=>reviewManagementQuarterSnapshot({...f,[Symbol('private')]:1}));
  const cyclic={...f};cyclic.loop=cyclic;assert.throws(()=>reviewManagementQuarterSnapshot(cyclic));
});

const fakeSeal = value => ({schemaVersion:2,protection:'AES256_GCM_WITH_WINDOWS_DPAPI_CURRENT_USER',
  plaintextSha256:snapshotDigest(value),ciphertext:Buffer.from(JSON.stringify(value)).toString('base64')});
const fakeOpen = async envelope => JSON.parse(Buffer.from(envelope.ciphertext,'base64').toString('utf8'));

async function files({realDpapi=false}={}) {
  const parent=resolve(root,'.local-preview'); await mkdir(parent,{recursive:true});
  const testRoot=await mkdtemp(join(parent,'quarter-review-fixture-'));
  assert.ok(relative(parent,testRoot) && !relative(parent,testRoot).startsWith('..') && !isAbsolute(relative(parent,testRoot)));
  const directory=join(testRoot,'.local-preview','management-split'); await mkdir(directory,{recursive:true});
  const protector=realDpapi ? await createPrivateJsonProtector() : {seal:fakeSeal};
  const openProtected=realDpapi ? openPrivateJson : fakeOpen;
  const f=await fixture(), write=async(name,value)=>writeFile(join(directory,name),JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(testRoot,'.gitignore'),'.local-preview/\n',{flag:'wx'});
  const encrypted=protector.seal(f.packet), bytes=Buffer.from(JSON.stringify(encrypted)+'\n');
  f.captureCiphertextSha256=hash(bytes);f.publicReceipt.ciphertextSha256=f.captureCiphertextSha256;
  await writeFile(join(directory,captureName),bytes,{flag:'wx',mode:0o600});
  await write(captureName.replace('.dpapi.json','-receipt.json'),f.publicReceipt);
  await write(checkpointName,protector.seal(f.checkpointPacket));
  await write(MANAGEMENT_QUARTER_REVIEW_BASELINE,protector.seal(f.baselinePacket));
  await write(MANAGEMENT_QUARTER_REVIEW_RECEIPT,f.baselineReceipt);
  await write('quarter-head-FA.json',f.head); await write('backup-scope-FA.json',f.scope);
  return {root:testRoot,directory,f,openProtected,createProtector:async()=>protector,
    cleanup:async()=>{
      for (const name of await readdir(directory)) {
        assert.equal(name,basename(name)); const target=join(directory,name);
        assert.equal(dirname(target),directory); await unlink(target);
      }
      await rmdir(directory);await rmdir(dirname(directory));await unlink(join(testRoot,'.gitignore'));await rmdir(testRoot);
    }};
}

test('local consumer opens specified complete packet without exposing documents or reanchoring manifest', async()=>{
  const f=await files();
  try {
    const out=await runLocalManagementQuarterReview({...f,args:['FA','--review-complete',captureName]});
    assert.equal(out.counts.capturedDocuments,1);assert.equal(out.protectedOutputWritten,false);
    assert.equal(JSON.stringify(out).includes(sentinel),false);
    assert.equal(JSON.stringify(out).includes('managementAreas/item'),false);
    assert.equal(out.credentialLookupIssued,0);assert.equal(out.productionAuthorized,false);
    assert.equal((await readdir(f.directory)).length,7);
  } finally {await f.cleanup();}
});

test('local consumer writes a protected immutable output, roundtrips and preserves originals', async()=>{
  const f=await files();
  try {
    const before=await readFile(join(f.directory,captureName));
    const out=await runLocalManagementQuarterReview({...f,args:['FA','--review-complete',captureName,'--out',outputName]});
    assert.equal(out.protectedOutputWritten,true);assert.equal(out.outputFile,outputName);
    assert.equal(out.outputCiphertextSha256,hash(await readFile(join(f.directory,outputName))));
    const output=await f.openProtected(JSON.parse(await readFile(join(f.directory,outputName),'utf8')));
    assert.equal(output.sourceSnapshot.readTime,sourceTime);assert.equal(output.delta.classification,'UNREVIEWED');
    assert.equal(output.manifestReanchored,false);assert.equal(output.operationalFreshnessEvaluated,false);
    assert.deepEqual(await readFile(join(f.directory,captureName)),before);
    await assert.rejects(()=>runLocalManagementQuarterReview({...f,args:['FA','--review-complete',captureName,'--out',outputName]}),/OUTPUT_ALREADY_EXISTS/);
  } finally {await f.cleanup();}
});

test('local consumer denies active capture lock and changing HEAD without producing output', async()=>{
  const f=await files();
  try {
    const lock=join(f.directory,'backup-read-FA.lock');await writeFile(lock,'synthetic');
    await assert.rejects(()=>runLocalManagementQuarterReview({...f,args:['FA','--review-complete',captureName,'--out',outputName]}),/CAPTURE_LOCK_PRESENT/);
    await unlink(lock);
    let opened=0;
    await assert.rejects(()=>runLocalManagementQuarterReview({...f,args:['FA','--review-complete',captureName,'--out',outputName],
      openProtected:async envelope=>{
        if (++opened===1) await writeFile(join(f.directory,'quarter-head-FA.json'),JSON.stringify(f.f.head)+'\n\n');
        return fakeOpen(envelope);
      }}),/INPUT_CHANGED_DURING_REVIEW/);
    await assert.rejects(()=>lstat(join(f.directory,outputName)),e=>e.code==='ENOENT');
  } finally {await f.cleanup();}
});

test('local consumer denies ciphertext mismatch, missing ignore and output traversal before decrypting', async()=>{
  for (const kind of ['ciphertext','ignore','traversal']) {
    const f=await files();let opened=0;
    try {
      if(kind==='ciphertext')await writeFile(join(f.directory,captureName),'{}\n');
      if(kind==='ignore')await writeFile(join(f.root,'.gitignore'),'');
      const args=['FA','--review-complete',captureName,'--out',kind==='traversal'?'../outside.dpapi.json':outputName];
      await assert.rejects(()=>runLocalManagementQuarterReview({...f,args,openProtected:async e=>{opened++;return fakeOpen(e);}}));
      assert.equal(opened,0);
    } finally {await f.cleanup();}
  }
});

test('local consumer rejects linked private inputs', {skip:process.platform==='win32'?'Symlink fixture requires Unix privileges; Windows path logic remains exercised above':false}, async()=>{
  const f=await files();
  try {
    await unlink(join(f.directory,MANAGEMENT_QUARTER_REVIEW_BASELINE));
    await symlink(join(f.directory,captureName),join(f.directory,MANAGEMENT_QUARTER_REVIEW_BASELINE));
    await assert.rejects(()=>runLocalManagementQuarterReview({...f,args:['FA','--review-complete',captureName]}),/PRIVATE_FILE_INVALID/);
  } finally {await f.cleanup();}
});

test('real Windows DPAPI consumer roundtrips synthetic complete packet in isolated private fixture',
  {skip:process.platform!=='win32'}, async()=>{
    const f=await files({realDpapi:true});
    try {
      const out=await runLocalManagementQuarterReview({...f,args:['FA','--review-complete',captureName,'--out',outputName]});
      const bytes=await readFile(join(f.directory,outputName),'utf8');
      assert.equal(bytes.includes(sentinel),false);assert.equal(bytes.includes('managementAreas/item'),false);
      assert.equal(out.protectedOutputWritten,true);assert.equal(out.productionAuthorized,false);
      assert.equal(out.sourceReadTime,sourceTime);assert.equal(out.firestoreDocumentReadsIssued,0);
    } finally {await f.cleanup();}
});

test('CLI invalid arguments emit only static safe codes and zero operational effects', ()=>{
  for (const args of [[],['FA','--review-complete'],['FB','--review-complete',captureName],
    ['FA','--review-complete','../private.dpapi.json'],['FA','--review-complete',captureName,'--out','capture-FA-1.dpapi.json']]) {
    const out=spawnSync(process.execPath,[resolve(root,'scripts/management-quarter-review.mjs'),...args],
      {cwd:root,encoding:'utf8',timeout:15000,maxBuffer:1024*1024,windowsHide:true});
    assert.equal(out.status,1);assert.equal(out.stdout,'');const error=JSON.parse(out.stderr.trim());
    assert.match(error.errorCode,/^[A-Z][A-Z0-9_]+$/);assert.equal(error.productionAuthorized,false);
    assert.equal(error.credentialLookupIssued,0);assert.equal(error.firestoreDocumentReadsIssued,0);
    assert.equal(error.firestoreWritesIssued,0);assert.equal(out.stderr.includes(sentinel),false);
  }
});

test('reserved reads exceeding one batch cap are rejected even below the four-batch ceiling', async()=>{
  const f=plainClone(await fixture()), core=f.checkpointPacket.coreState;
  core.totalReservedReads=1501;
  f.head.counters.reservedReads=1501;f.head.checkpointSha256=snapshotDigest(core);
  const {lastObservedAt,...body}=core;f.head.checkpointContentSha256=snapshotDigest(body);
  f.head=repin(f.head,'headSha256');f.publicReceipt.quarterHeadSha256=f.head.headSha256;
  assert.ok(core.totalReservedReads < 6000);
  assert.throws(()=>reviewManagementQuarterSnapshot(f),/QUARTER_REVIEW_READ_RESERVATION_LIMIT/);
});

test('roundtrip failure or changed HEAD never publishes the final output and removes only its temporary', async()=>{
  for(const kind of ['roundtrip','head']) {
    const f=await files();let opened=0;
    try {
      await assert.rejects(()=>runLocalManagementQuarterReview({...f,
        args:['FA','--review-complete',captureName,'--out',outputName],
        openProtected:async e=>{
          opened++;if(opened===4) {
            if(kind==='roundtrip')return {corrupt:true};
            await writeFile(join(f.directory,'quarter-head-FA.json'),JSON.stringify(f.f.head)+'\n\n');
          }
          return fakeOpen(e);
        }}),kind==='roundtrip'?/ROUNDTRIP_FAILED/:/INPUT_CHANGED_DURING_REVIEW/);
      await assert.rejects(()=>lstat(join(f.directory,outputName)),e=>e.code==='ENOENT');
      assert.equal((await readdir(f.directory)).some(n=>n.endsWith('.tmp.dpapi.json')),false);
    } finally {await f.cleanup();}
  }
});

test('a competing final output is retained exactly and never overwritten or deleted', async()=>{
  const f=await files();let opened=0;const competing='PREEXISTING_SYNTHETIC_REVIEW';
  try {
    await assert.rejects(()=>runLocalManagementQuarterReview({...f,
      args:['FA','--review-complete',captureName,'--out',outputName],
      openProtected:async e=>{
        if(++opened===4)await writeFile(join(f.directory,outputName),competing,{flag:'wx'});
        return fakeOpen(e);
      }}),e=>e.code==='EEXIST');
    assert.equal(await readFile(join(f.directory,outputName),'utf8'),competing);
    assert.equal((await readdir(f.directory)).some(n=>n.endsWith('.tmp.dpapi.json')),false);
  } finally {await f.cleanup();}
});

test('actual synthetic four-quarter completion is accepted with original times and per-batch reservations', async()=>{
  const base=await fixture();
  const f=await fixture({sourceDocuments:base.baselinePacket.snapshot.documents.slice(0,6)});
  const result=reviewManagementQuarterSnapshot(f);
  assert.equal(f.head.batchNumber,4);
  assert.equal(result.summary.counts.capturedDocuments,6);
  assert.equal(result.summary.counts.unchanged,6);
  assert.equal(result.summary.sourceReadTime,sourceTime);
  assert.deepEqual(result.summary.captureReservedReadsByBatch,[2,2,2,6]);
  assert.equal(result.summary.captureReservedReads,12);
  assert.equal(result.summary.migrationReady,false);
});

test('input change during final publication removes only the output owned by this execution', async()=>{
  const f=await files();
  try {
    await assert.rejects(()=>runLocalManagementQuarterReview({...f,
      args:['FA','--review-complete',captureName,'--out',outputName],
      publishExclusive:async(temporary,output)=>{
        await link(temporary,output);
        await writeFile(join(f.directory,'quarter-head-FA.json'),JSON.stringify(f.f.head)+'\n\n');
      }}),/INPUT_CHANGED_DURING_REVIEW/);
    await assert.rejects(()=>lstat(join(f.directory,outputName)),e=>e.code==='ENOENT');
    assert.equal((await readdir(f.directory)).some(n=>n.endsWith('.tmp.dpapi.json')),false);
  } finally {await f.cleanup();}
});