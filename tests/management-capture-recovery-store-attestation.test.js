import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {packRecoveryCore,unpackRecoveryCore,getRecoveryCorePackAttestation}
  from '../scripts/lib/management-capture-recovery-core-codec.js';
import {createManagementCaptureRecoveryStore,MANAGEMENT_CAPTURE_RECOVERY_FILES as files}
  from '../scripts/lib/management-capture-recovery-store.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const READ='2026-10-09T16:00:00.000Z',SHA='a'.repeat(64),clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
const protector={seal(value){const synthetic=clone(value);return {schemaVersion:2,
  protection:'AES256_GCM_WITH_WINDOWS_DPAPI_CURRENT_USER',synthetic,digest:snapshotDigest(synthetic)};}};
async function openProtected(envelope){assert.equal(envelope.digest,snapshotDigest(envelope.synthetic));return clone(envelope.synthetic);}
function core(){return {schemaVersion:1,mode:'READ_ONLY_FIRESTORE_CAPTURE',projectId:'sahmt-17a16',databaseId:'(default)',
  readTime:READ,rootCollections:['managementAreas'],scopeSha256:SHA,startedAt:READ,status:'IN_PROGRESS',documents:[],
  missingDocumentPaths:[],completedCollections:[],completedDiscoveryParents:[],queue:[],
  active:{operation:'listDocuments',parentPath:'',collectionId:'managementAreas',depth:1,pageToken:'',consumedTokenHashes:[]},
  pages:[{attempt:1,operation:'listDocuments',readTime:READ,requestSha256:SHA,maximumReads:25,status:'RESERVED'}],
  totalReservedReads:25,totalResponseBytes:0};}
function budget(reservations=[]){const body={schemaVersion:1,kind:'MANAGEMENT_FA_CAPTURE_RECOVERY_BUDGET',namespace:'FA-rec1',
  projectId:'sahmt-17a16',planSha256:SHA,maximumRecoveryOperationReserve:3000,maximumCumulativeCaptureReserve:6000,
  predecessorReservedReads:1342,predecessorPausedRequiresReview:true,renewalClearsPause:false,status:reservations.length?'IN_PROGRESS':'AUTHORIZED',
  pausedRequiresReview:false,reservations,recoveryReservedReads:reservations.length?25:0,cumulativeReservedReads:1342+(reservations.length?25:0),
  readTime:reservations.length?READ:null,startedAt:reservations.length?READ:null,deadlineAt:reservations.length?'2026-10-09T16:04:00.000Z':null,
  predecessorPolicySha256:SHA,sourceAuthorizationSha256:SHA,reportAuthorization:{syntheticOnly:true},dailyReadLimit:45000,
  quotaDayStart:'2026-10-09T07:00:00.000Z',appTrafficReserve:5000,metricLagReserve:2000,preparedAt:READ};
  return {...body,budgetSha256:snapshotDigest(body)};}
async function using(run){const parent=resolve(root,'.local-preview');await mkdir(parent,{recursive:true});
  const temporary=await mkdtemp(join(parent,'recovery-attestation-test-')),directory=resolve(temporary,'.local-preview/management-split');
  await mkdir(directory,{recursive:true});await writeFile(resolve(temporary,'.gitignore'),'.local-preview/\n');
  const store=await createManagementCaptureRecoveryStore({directory,protector,openProtected});await store.acquire();
  const base={schemaVersion:1,namespace:'FA-rec1',planSha256:SHA,status:'PREPARED',revision:1,previousJournalSha256:null,
    predecessor:{syntheticOnly:true},binding:null,budget:budget(),reservations:[],dispatchAttempts:0,coreCheckpoint:null,
    checkpointSha256:null,pausedRequiresReview:false,automaticResume:false};
  try{const first=await store.persistJournal(base,{expectedSha256:null});
    const reservation={ordinal:1,attempt:1,operation:'listDocuments',readTime:READ,requestSha256:SHA,maximumReads:25,
      reservedAt:READ,recoveryReservedReads:25,cumulativeReservedReads:1367};
    const checkpoint=packRecoveryCore(core()),next={...base,status:'IN_PROGRESS',revision:2,previousJournalSha256:first.valueSha256,
      binding:{readTime:READ,startedAt:READ,deadlineAt:'2026-10-09T16:04:00.000Z'},budget:budget([reservation]),
      reservations:[{projectId:'sahmt-17a16',databaseId:'(default)',...reservation}],coreCheckpoint:checkpoint,checkpointSha256:checkpoint.rawCoreSha256};
    await run({store,directory,first,next,checkpoint});
  }finally{await store.close({release:true});assert.ok(temporary.startsWith(parent+join('/')));await rm(temporary,{recursive:true,force:true});}}

for(const mode of ['exact immutable packet','deserialized external packet'])test('store preserves full protected readback for '+mode,()=>using(async f=>{
  const next=mode==='exact immutable packet'?f.next:{...f.next,coreCheckpoint:clone(f.checkpoint)};
  assert.equal(Boolean(getRecoveryCorePackAttestation(next.coreCheckpoint)),mode==='exact immutable packet');
  const stored=await f.store.persistJournal(next,{expectedSha256:f.first.valueSha256}),disk=JSON.parse(await readFile(resolve(f.directory,files.journal),'utf8'));
  assert.equal(snapshotDigest(await openProtected(disk)),stored.valueSha256);
  assert.equal((await f.store.readJournal()).ciphertextSha256,stored.ciphertextSha256);
  assert.deepEqual(unpackRecoveryCore(disk.synthetic.coreCheckpoint),core());
  assert.equal(disk.synthetic.budget.recoveryReservedReads,25);assert.equal(disk.synthetic.coreCheckpoint.summary.lastStatus,'RESERVED');
}));

for(const [name,mutate,code]of [
  ['raw hash',p=>{p.rawCoreSha256='b'.repeat(64);},'RAW_HASH_MISMATCH'],
  ['summary counter',p=>{p.summary.totalReservedReads=0;},'SUMMARY_MISMATCH'],
  ['compressed payload',p=>{p.payloadBase64=Buffer.from('bad').toString('base64');p.compressedBytes=3;p.compressedSha256=hash(Buffer.from('bad'));},'INFLATE_FAILED_OR_LIMIT'],
  ['caller approval flag',p=>{p.packedAttestation=true;},'PACKET_INVALID'],
  ['copied receipt',p=>{p.attestation=getRecoveryCorePackAttestation(packRecoveryCore(core()));},'PACKET_INVALID']
])test('external '+name+' cannot inherit a pack attestation',()=>using(async f=>{
  const packet=clone(f.checkpoint);mutate(packet);assert.equal(getRecoveryCorePackAttestation(packet),null);
  await assert.rejects(f.store.persistJournal({...f.next,coreCheckpoint:packet},{expectedSha256:f.first.valueSha256}),new RegExp('RECOVERY_CODEC_'+code));
  assert.equal((await f.store.readJournal()).valueSha256,f.first.valueSha256);
}));

test('attested packet retains scope/readTime/budget context checks',()=>using(async f=>{
  await assert.rejects(f.store.persistJournal({...f.next,binding:{...f.next.binding,readTime:'2026-10-09T16:00:01.000Z'},
    budget:{...f.next.budget}},{expectedSha256:f.first.valueSha256}),/RECOVERY_JOURNAL_BUDGET_INVALID/);
  await assert.rejects(f.store.persistJournal({...f.next,checkpointSha256:'b'.repeat(64)},
    {expectedSha256:f.first.valueSha256}),/RECOVERY_JOURNAL_CORE_CONTEXT_INVALID/);
  const wrongCore=core();wrongCore.readTime='2026-10-09T16:00:01.000Z';const wrong=packRecoveryCore(wrongCore);
  await assert.rejects(f.store.persistJournal({...f.next,coreCheckpoint:wrong,checkpointSha256:wrong.rawCoreSha256},
    {expectedSha256:f.first.valueSha256}),/RECOVERY_JOURNAL_CORE_CONTEXT_INVALID/);
}));

test('a coreCheckpoint accessor is rejected before it can run or provide an attested packet',()=>using(async f=>{
  let touched=false;const next={...f.next};Object.defineProperty(next,'coreCheckpoint',{enumerable:true,get(){touched=true;return f.checkpoint;}});
  await assert.rejects(f.store.persistJournal(next,{expectedSha256:f.first.valueSha256}),/RECOVERY_STORE_JSON_INVALID/);
  assert.equal(touched,false);assert.equal((await f.store.readJournal()).valueSha256,f.first.valueSha256);
}));

test('immutable packet optimization never bypasses ciphertext/CAS checks',()=>using(async f=>{
  const saved=await f.store.persistJournal(f.next,{expectedSha256:f.first.valueSha256});
  await assert.rejects(f.store.persistJournal({...f.next,revision:3,previousJournalSha256:saved.valueSha256},
    {expectedSha256:f.first.valueSha256}),/RECOVERY_JOURNAL_CAS_MISMATCH/);
  const disk=resolve(f.directory,files.journal);await writeFile(disk,(await readFile(disk,'utf8')).replace(/\n$/,'')+' \n');
  await assert.rejects(f.store.readJournal(),/RECOVERY_JOURNAL_EXTERNAL_CHANGE_REQUIRES_REVIEW/);
}));