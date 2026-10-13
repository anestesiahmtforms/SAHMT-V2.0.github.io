import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,unlink,readdir} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {firestoreQuotaDayStart} from '../scripts/lib/management-read-budget.js';
const execute=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),FA='sahmt-17a16';
const libs=['firestore-snapshot-capture.js','management-capture-quarter-plan.js','management-capture-quarter-head.js',
  'management-capture-quarter-head-store.js','management-split-plan.js','management-read-budget.js','management-fb-bootstrap-budget.js'];
async function fixture(t,failure=null,nowOverride=null) {
  const directory=await mkdtemp(resolve(tmpdir(),'sahmt-quarter-cli-'));
  t.after(async()=>{const target=resolve(directory),allowed=resolve(tmpdir())+sep;
    assert.ok(target.startsWith(allowed)&&target.slice(allowed.length).startsWith('sahmt-quarter-cli-'));
    await rm(target,{recursive:true,force:true});});
  const privateDir=resolve(directory,'.local-preview/management-split');
  await mkdir(resolve(directory,'scripts/lib'),{recursive:true});await mkdir(privateDir,{recursive:true});
  for(const name of libs)await copyFile(resolve(root,'scripts/lib',name),resolve(directory,'scripts/lib',name));
  for(const name of ['management-firestore-capture.mjs','management-quarter-head.mjs'])
    await copyFile(resolve(root,'scripts',name),resolve(directory,'scripts',name));
  const cliPath=resolve(directory,'scripts/management-firestore-capture.mjs');
  let cli=await readFile(cliPath,'utf8');
  cli=cli.replace(/const legacyPath = [^\n]+;/,'const legacyPath = '+JSON.stringify(resolve(privateDir,'legacy-test-policy.json'))+';');
  cli=cli.replace("principal: process.env.SAHMT_FA_CAPTURE_PRINCIPAL || 'fa-owner@example.invalid'","principal: 'synthetic-owner@example.invalid'");
  await writeFile(cliPath,cli);
  await writeFile(resolve(directory,'scripts/lib/windows-protected-json.js'),
    "export async function createPrivateJsonProtector(){return {seal:value=>({testProtected:value})};} export async function openPrivateJson(value){if(!value?.testProtected)throw Error('SYNTHETIC_PROTECTION_INVALID');return value.testProtected;}");
  if(failure) {
    const storePath=resolve(directory,'scripts/lib/management-capture-quarter-head-store.js');
    let source=await readFile(storePath,'utf8');
    const needle='  const {headPath,lockPath}=await paths(directory);';assert.equal(source.split(needle).length,2);
    source=source.replace(needle,needle+"\n  "+(failure==='before-credentials'
      ?"throw Error('SYNTHETIC_HEAD_CAS_FAILED');"
      :"if(head.counters.attempts>0)throw Error('SYNTHETIC_HEAD_CHECKPOINT_FAILED');"));
    await writeFile(storePath,source);
  }
  await writeFile(resolve(directory,'package.json'),'{"type":"module"}');
  await writeFile(resolve(directory,'.gitignore'),'.local-preview/\n');
  const credentialDir=resolve(directory,'node_modules/firebase-tools/lib');await mkdir(credentialDir,{recursive:true});
  await writeFile(resolve(credentialDir,'auth.js'),
    "const{appendFileSync}=require('node:fs'),{resolve}=require('node:path');exports.getAllAccounts=()=>{appendFileSync(resolve(process.cwd(),'effects.log'),'AUTH\\n');return[{user:{email:'synthetic-owner@example.invalid'},tokens:{refresh_token:'SYNTHETIC_REFRESH'}}]};exports.getAccessToken=async refresh=>({access_token:'SYNTHETIC_ACCESS',refresh_token:refresh});");
  const now=nowOverride??Date.now(),time=new Date(now-5000).toISOString(),scope={schemaVersion:1,projectId:FA,databaseId:'(default)',rootCollections:['managementAreas']};
  const snapshot={schemaVersion:1,projectId:FA,databaseId:'(default)',readTime:time,
    coverage:{complete:true,consistent:true,rootCollections:scope.rootCollections},
    documents:Array.from({length:365},(_,index)=>({path:'managementAreas/item'+index,
      fields:{value:{integerValue:String(index)}},createTime:time,updateTime:time}))};
  await writeFile(resolve(privateDir,'backup-scope-FA.json'),JSON.stringify(scope));
  await writeFile(resolve(privateDir,'capture-FA-20261009010412736-reviewed.dpapi.json'),JSON.stringify({testProtected:{snapshot}}));
  await writeFile(resolve(privateDir,'management-split-receipt-v2.json'),JSON.stringify({sourceSnapshotSha256:snapshotDigest(snapshot)}));
  await writeFile(resolve(privateDir,'legacy-test-policy.json'),JSON.stringify({schemaVersion:1,project:FA,dailyReadLimit:35000,
    reservationQuotaDayStart:firestoreQuotaDayStart(now),reservedCheckReads:0}));
  const policy={schemaVersion:1,projectId:FA,dailyReadLimit:45000,limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',
    quotaTimeZone:'America/Los_Angeles',renewalClearsPause:false,pausedRequiresReview:false,
    authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',humanDecisionAt:new Date(now-1000).toISOString(),
    authorizationEvidence:'SYNTHETIC_FIRST_REVIEW',appTrafficReserve:5000,metricLagReserve:2000,
    maximumCaptureReserve:6000,reservationQuotaDayStart:firestoreQuotaDayStart(now),reservedReads:0};
  await writeFile(resolve(privateDir,'backup-read-policy-FA.json'),JSON.stringify(policy));
  await writeFile(resolve(privateDir,'daily-read-observation.json'),JSON.stringify({project:FA,metric:'firestore.googleapis.com/document/read_ops_count',
    reads:3000,quotaDayStart:firestoreQuotaDayStart(now),latestPoint:new Date(now-1000).toISOString(),
    verifiedAt:new Date(now-500).toISOString(),complete:true,fresh:true}));
  const preload=resolve(directory,'synthetic-network.mjs');
  await writeFile(preload,
    "import{readFileSync,appendFileSync}from'node:fs';import{resolve}from'node:path';"+
    "import{snapshotDigest}from'./scripts/lib/management-split-plan.js';"+
    "if(process.env.SYNTHETIC_NOW)Date.now=()=>Number(process.env.SYNTHETIC_NOW);"+
    "globalThis.fetch=async url=>{const directory=resolve(process.cwd(),'.local-preview/management-split');"+
    "const head=JSON.parse(readFileSync(resolve(directory,'quarter-head-FA.json'),'utf8'));"+
    "const packet=JSON.parse(readFileSync(resolve(directory,head.activeCheckpointFile),'utf8')).testProtected;"+
    "if(head.status!=='IN_PROGRESS'||head.checkpointSha256!==snapshotDigest(packet.coreState))throw Error('SYNTHETIC_HEAD_NOT_DURABLE');"+
    "appendFileSync(resolve(process.cwd(),'effects.log'),'FETCH_DURABLE\\n');const parsed=new URL(url);"+
    "if(url.includes(':listCollectionIds'))return{ok:true,json:async()=>({})};"+
    "const baseline=JSON.parse(readFileSync(resolve(directory,'capture-FA-20261009010412736-reviewed.dpapi.json'),'utf8')).testProtected.snapshot;"+
    "const offset=Number(parsed.searchParams.get('pageToken')||0),size=Number(parsed.searchParams.get('pageSize'));"+
    "const rows=baseline.documents.slice(offset,offset+size);const documents=rows.map(({path,...row})=>({...row,name:'projects/sahmt-17a16/databases/(default)/documents/'+path}));"+
    "return{ok:true,json:async()=>({documents,...(offset+rows.length<365?{nextPageToken:String(offset+rows.length)}:{})})};};");
  return {directory,privateDir,preload,virtualNow:nowOverride};
}
async function run(f,args,adoption=false) {
  const script=resolve(f.directory,'scripts',adoption?'management-quarter-head.mjs':'management-firestore-capture.mjs');
  try{const r=await execute(process.execPath,['--import',pathToFileURL(f.preload).href,script,...args],{cwd:f.directory,timeout:180000,env:{...process.env,...(f.virtualNow===null?{}:{SYNTHETIC_NOW:String(f.virtualNow)})},
    windowsHide:true,maxBuffer:65536});return {code:0,output:JSON.parse(r.stdout.trim())};}
  catch(error){assert.equal(typeof error.code,'number');const raw=error.stderr.trim()||error.stdout.trim();assert.ok(raw.startsWith('{'),raw);return{code:error.code,output:JSON.parse(raw)};}
}
const parse=async path=>JSON.parse(await readFile(path,'utf8'));
const readHead=f=>parse(resolve(f.privateDir,'quarter-head-FA.json'));
const readPolicy=f=>parse(resolve(f.privateDir,'backup-read-policy-FA.json'));
async function approveNext(f) {
  const policy=await readPolicy(f);policy.pausedRequiresReview=false;
  policy.humanDecisionAt=new Date(Date.now()).toISOString();policy.authorizationEvidence='SYNTHETIC_NEXT_REVIEW';
  await writeFile(resolve(f.privateDir,'backup-read-policy-FA.json'),JSON.stringify(policy));
  const observed=await parse(resolve(f.privateDir,'daily-read-observation.json'));
  observed.latestPoint=new Date(Date.now()-500).toISOString();observed.verifiedAt=new Date(Date.now()).toISOString();
  await writeFile(resolve(f.privateDir,'daily-read-observation.json'),JSON.stringify(observed));
}
const effects=async f=>{try{return await readFile(resolve(f.directory,'effects.log'),'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}};
const clearEffects=f=>writeFile(resolve(f.directory,'effects.log'),'');
test('CLI positiva fixa head antes de todo transporte e retoma só o próximo quarto',async t=>{
  const f=await fixture(t),first=await run(f,['FA','--capture-quarter']);
  assert.equal(first.code,2);assert.equal(first.output.status,'PARTIAL_REVIEW');
  assert.equal(first.output.capturedThisBatch,92);assert.equal(first.output.batchReservedReads,92);
  const head1=await readHead(f),packet1=(await parse(resolve(f.privateDir,first.output.checkpointFile))).testProtected;
  assert.equal(head1.checkpointSha256,snapshotDigest(packet1.coreState));assert.equal(head1.batchNumber,1);
  assert.equal((await readPolicy(f)).pausedRequiresReview,true);
  assert.equal((await effects(f)).split('FETCH_DURABLE').length-1,4);
  await approveNext(f);await clearEffects(f);
  const second=await run(f,['FA','--resume-quarter',first.output.checkpointFile]);
  assert.equal(second.code,2);assert.equal(second.output.status,'PARTIAL_REVIEW');
  assert.equal(second.output.capturedCumulative,184);assert.equal(second.output.capturedThisBatch,92);
  const head2=await readHead(f),packet2=(await parse(resolve(f.privateDir,second.output.checkpointFile))).testProtected;
  assert.equal(head2.batchNumber,2);assert.equal(head2.readTime,head1.readTime);
  assert.equal(head2.sequenceId,head1.sequenceId);assert.equal(head2.checkpointSha256,snapshotDigest(packet2.coreState));
  assert.equal(head2.runHistory[1].reviewId,packet2.coreState.batch.reviewId);
  assert.equal((await readPolicy(f)).reservedReads,184);assert.equal((await readPolicy(f)).pausedRequiresReview,true);
  await approveNext(f);await clearEffects(f);
  const obsolete=await run(f,['FA','--resume-quarter',first.output.checkpointFile]);
  assert.equal(obsolete.output.errorCode,'QUARTER_HEAD_CHECKPOINT_NOT_CURRENT');
  assert.equal(await effects(f),'');assert.deepEqual(await readHead(f),head2);
});
test('CLI rejeita nova primeira sequência e checkpoint órfão antes de credenciais',async t=>{
  const f=await fixture(t),first=await run(f,['FA','--capture-quarter']);assert.equal(first.output.status,'PARTIAL_REVIEW');
  await approveNext(f);await clearEffects(f);
  const duplicate=await run(f,['FA','--capture-quarter']);
  assert.equal(duplicate.output.errorCode,'QUARTER_SEQUENCE_ALREADY_EXISTS_REQUIRES_REVIEW');
  assert.equal(await effects(f),'');
  await unlink(resolve(f.privateDir,'quarter-head-FA.json'));await approveNext(f);
  const orphan=await run(f,['FA','--capture-quarter']);
  assert.equal(orphan.output.errorCode,'QUARTER_HEAD_MISSING_REQUIRES_ADOPTION');assert.equal(await effects(f),'');
});
test('adoção CLI local fixa primeiro checkpoint sem mudar pausa/reserva nem credenciais',async t=>{
  const f=await fixture(t),first=await run(f,['FA','--capture-quarter']);assert.equal(first.output.status,'PARTIAL_REVIEW');
  await unlink(resolve(f.privateDir,'quarter-head-FA.json'));await clearEffects(f);
  const original=await readPolicy(f),adopted=await run(f,['FA','--adopt-initial',first.output.checkpointFile],true);
  assert.equal(adopted.code,0);assert.equal(adopted.output.mode,'LOCAL_INITIAL_QUARTER_HEAD_ADOPTION');
  assert.equal(adopted.output.firestoreDocumentReadsIssued,0);assert.equal(adopted.output.credentialLookupIssued,0);
  assert.equal(adopted.output.checkpointSha256,snapshotDigest((await parse(resolve(f.privateDir,first.output.checkpointFile))).testProtected.coreState));
  assert.equal((await readHead(f)).batchNumber,1);assert.deepEqual(await readPolicy(f),original);
  assert.equal(await effects(f),'');
  const repeated=await run(f,['FA','--adopt-initial',first.output.checkpointFile],true);
  assert.equal(repeated.output.errorCode,'QUARTER_SEQUENCE_ALREADY_EXISTS_REQUIRES_REVIEW');
});
test('CAS falha antes de credenciais, mantém lock e pausa',async t=>{
  const f=await fixture(t,'before-credentials'),result=await run(f,['FA','--capture-quarter']);
  assert.equal(result.output.errorCode,'SYNTHETIC_HEAD_CAS_FAILED');assert.equal(result.output.lockRetainedRequiresReview,true);
  assert.equal(await effects(f),'');assert.equal((await readPolicy(f)).reservedReads,0);
  assert.equal((await readPolicy(f)).pausedRequiresReview,true);
  assert.ok((await readdir(f.privateDir)).includes('backup-read-FA.lock'));
});
test('falha em head após reservar/checkpoint impede despacho e não reembolsa',async t=>{
  const f=await fixture(t,'after-reservation'),result=await run(f,['FA','--capture-quarter']);
  assert.equal(result.output.errorCode,'SYNTHETIC_HEAD_CHECKPOINT_FAILED');assert.equal(result.output.lockRetainedRequiresReview,true);
  assert.equal((await effects(f)).includes('FETCH'),false);
  assert.equal((await readPolicy(f)).reservedReads,25);assert.equal((await readPolicy(f)).pausedRequiresReview,true);
  const head=await readHead(f);assert.equal(head.status,'IN_PROGRESS');assert.equal(head.counters.attempts,0);
  const packet=(await parse(resolve(f.privateDir,head.activeCheckpointFile))).testProtected;
  assert.equal(packet.coreState.status,'INCOMPLETE');assert.notEqual(head.checkpointSha256,snapshotDigest(packet.coreState));
});

const remainingText='VEJO QUE ESTÁ BEM TRANQUILO , VAMOS FINALIZAR TODAS A S LEITURAS PARA PASSARMOS PARA PROXIMA ETAPA. VAMOS!';
const remainingApproved='2026-10-09T15:12:31.000Z';
function remainingGrant(head) {
  return{schemaVersion:1,kind:'HUMAN_AUTHORIZED_REMAINING_QUARTERS',projectId:FA,
    authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',dailyReadLimit:45000,sourceHumanDecisionAt:remainingApproved,
    sourceMessage:{evidenceId:'USER_COMPLETE_REMAINING_CAPTURE_QUARTERS_2026_10_09T15_12_31Z',
      authority:'CURRENT_HUMAN_MESSAGE',text:remainingText,textSha256:createHash('sha256').update(remainingText,'utf8').digest('hex')},
    anchor:{headSha256:head.headSha256,checkpointSha256:head.checkpointSha256,
      checkpointFinishedAt:head.checkpointFinishedAt,batchNumber:2,sequenceId:head.sequenceId,
      runHistorySha256:snapshotDigest(head.runHistory),planSha256:head.planSha256,readTime:head.readTime},
    firstBatch:3,lastBatch:4,maxBatchDocuments:92,maxReservedReadsPerBatch:1500,cumulativeReadReservationLimit:6000,
    deadlineAt:new Date(Date.parse(head.readTime)+3600000).toISOString(),automaticNextBatch:false};
}
async function virtualReview(f,at,humanDecisionAt,evidence) {
  f.virtualNow=Date.parse(at);const policy=await readPolicy(f);
  policy.pausedRequiresReview=false;policy.humanDecisionAt=humanDecisionAt;policy.authorizationEvidence=evidence;
  await writeFile(resolve(f.privateDir,'backup-read-policy-FA.json'),JSON.stringify(policy));
  const observation=await parse(resolve(f.privateDir,'daily-read-observation.json'));
  observation.latestPoint=new Date(f.virtualNow-1000).toISOString();observation.verifiedAt=new Date(f.virtualNow).toISOString();
  await writeFile(resolve(f.privateDir,'daily-read-observation.json'),JSON.stringify(observation));
}
async function firstTwoVirtual(t) {
  const f=await fixture(t,null,Date.parse('2026-10-09T14:45:00Z'));
  const one=await run(f,['FA','--capture-quarter']);assert.equal(one.output.status,'PARTIAL_REVIEW');
  await virtualReview(f,'2026-10-09T15:07:51.637Z','2026-10-09T15:05:00.000Z','SYNTHETIC_REVIEW_SECOND');
  const two=await run(f,['FA','--resume-quarter',one.output.checkpointFile]);assert.equal(two.output.status,'PARTIAL_REVIEW');
  return{f,one,two,head:await readHead(f)};
}
test('CLI remaining grant executes batches 3 and 4 with original approval and fixed readTime',async t=>{
  const {f,two,head}=await firstTwoVirtual(t),grant=remainingGrant(head);
  await virtualReview(f,'2026-10-09T15:15:00Z',remainingApproved,grant);
  const three=await run(f,['FA','--resume-quarter',two.output.checkpointFile]);
  assert.equal(three.output.status,'PARTIAL_REVIEW');assert.equal(three.output.capturedCumulative,276);
  const head3=await readHead(f);assert.equal(head3.runHistory[2].remainingAuthorizationSha256,snapshotDigest(grant));
  assert.ok(Date.parse(head3.checkpointFinishedAt)>Date.parse(remainingApproved));
  assert.equal((await readPolicy(f)).humanDecisionAt,remainingApproved);assert.equal((await readPolicy(f)).pausedRequiresReview,true);
  const altered=structuredClone(grant);altered.deadlineAt=new Date(Date.parse(grant.deadlineAt)-1000).toISOString();
  await virtualReview(f,'2026-10-09T15:19:30Z',remainingApproved,altered);await clearEffects(f);
  const changed=await run(f,['FA','--resume-quarter',three.output.checkpointFile]);
  assert.equal(changed.output.errorCode,'QUARTER_REMAINING_GRANT_NOT_PINNED');assert.equal(await effects(f),'');
  assert.deepEqual(await readHead(f),head3);
  await virtualReview(f,'2026-10-09T15:20:00Z',remainingApproved,grant);
  const four=await run(f,['FA','--resume-quarter',three.output.checkpointFile]);
  assert.equal(four.code,0);assert.equal(four.output.status,'COMPLETE');assert.equal(four.output.capturedCumulative,365);
  const head4=await readHead(f);assert.equal(head4.batchNumber,4);assert.equal(head4.readTime,head.readTime);
  assert.equal(head4.runHistory[3].remainingAuthorizationSha256,snapshotDigest(grant));
  assert.equal((await readPolicy(f)).humanDecisionAt,remainingApproved);assert.equal((await readPolicy(f)).pausedRequiresReview,true);
  await virtualReview(f,'2026-10-09T15:21:00Z',remainingApproved,grant);await clearEffects(f);
  const fifth=await run(f,['FA','--resume-quarter',four.output.checkpointFile]);
  assert.equal(fifth.output.errorCode,'QUARTER_REMAINING_BATCH_NOT_AUTHORIZED');assert.equal(await effects(f),'');
  assert.deepEqual(await readHead(f),head4);
});
test('CLI recusa grant restante adulterado, prazo expirado e start1 mesmo sem head/checkpoint',async t=>{
  const {f,two,head}=await firstTwoVirtual(t),grant=remainingGrant(head);
  for(const mutate of [g=>{g.kind='OTHER';},g=>{delete g.kind;},g=>{delete g.sourceMessage;},
    g=>{g.deadlineAt='2026-10-09T15:14:00.000Z';},g=>{g.anchor.headSha256='0'.repeat(64);},
    g=>{g.maxReservedReadsPerBatch=1501;}]) {
    const bad=structuredClone(grant);mutate(bad);await virtualReview(f,'2026-10-09T15:15:00Z',remainingApproved,bad);await clearEffects(f);
    const denied=await run(f,['FA','--resume-quarter',two.output.checkpointFile]);
    assert.equal(denied.code,1);assert.ok(denied.output.errorCode.startsWith('QUARTER_REMAINING_'));
    assert.equal(await effects(f),'');assert.deepEqual(await readHead(f),head);
  }
  await unlink(resolve(f.privateDir,'quarter-head-FA.json'));
  for(const name of await readdir(f.privateDir))if(/^capture-FA-[0-9]+-latest\.dpapi\.json$/.test(name))await unlink(resolve(f.privateDir,name));
  await virtualReview(f,'2026-10-09T15:15:00Z',remainingApproved,grant);await clearEffects(f);
  const reset=await run(f,['FA','--capture-quarter']);
  assert.equal(reset.output.errorCode,'QUARTER_REMAINING_REQUIRES_EXISTING_SEQUENCE_RESUME');assert.equal(await effects(f),'');
});
