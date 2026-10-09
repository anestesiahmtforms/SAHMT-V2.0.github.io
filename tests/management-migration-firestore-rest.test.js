import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {createManagementMigrationFirestoreRest} from '../scripts/lib/management-migration-firestore-rest.js';

const FA='sahmt-17a16', FB='sahmt-gestao-5ae66', PURPOSE='MANAGEMENT_MIGRATION_CREATE_ONLY';
const TIME='2026-10-09T12:00:00.000Z', READ='2026-10-09T11:59:59.000Z', EARLIER='2026-10-09T11:59:00.000Z';
const COMMIT='2026-10-09T11:59:59.500Z';
const BASE=`projects/${FB}/databases/(default)/documents/`;
const PLAN='a'.repeat(64), PATH='managementAreas/demo', ORIGIN='migrationOrigins/'+'b'.repeat(64);
const fields={name:{stringValue:'Área sintética'}, precision:{integerValue:'9223372036854775807'}, when:{timestampValue:'2026-10-09T11:58:59.123456789Z'}};
const provenance={sourceProjectId:{stringValue:FA}, sourcePath:{stringValue:PATH}};
const allowedPair={path:PATH,provenancePath:ORIGIN,documentFieldsSha256:snapshotDigest(fields),provenanceFieldsSha256:snapshotDigest(provenance)};
const operationId=createHash('sha256').update(PLAN+'\u0000'+PATH).digest('hex');
const clone=value=>structuredClone(value);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const basePayload=()=>({runId:'c'.repeat(64),approvalRequestId:'synthetic-request',sourceProjectId:FA,destinationProjectId:FB,databaseId:'(default)',projectId:FB,pins:{planSha256:PLAN},reservationId:'synthetic-read'});
const readPayload=()=>({...basePayload(),path:PATH,provenancePath:ORIGIN,maximumReads:2});
const commitPayload=()=>({...basePayload(),reservationId:'synthetic-commit',operationId,writes:[
  {update:{name:BASE+PATH,fields:clone(fields)},currentDocument:{exists:false}},
  {update:{name:BASE+ORIGIN,fields:clone(provenance)},currentDocument:{exists:false}}
]});
const found=(path,value)=>({found:{name:BASE+path,fields:clone(value),createTime:EARLIER,updateTime:EARLIER},readTime:READ});
const missing=path=>({missing:BASE+path,readTime:READ});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const commitResponse=()=>response({commitTime:COMMIT,writeResults:[{updateTime:COMMIT},{updateTime:COMMIT}]});
function harness({reply=()=>response([missing(PATH),missing(ORIGIN)]),...options}={}) {
  const calls=[],tokens=[];
  const adapter=createManagementMigrationFirestoreRest({enabled:true,authorizedPurpose:PURPOSE,planSha256:PLAN,
    allowedPairs:[clone(allowedPair)],getAccessToken:async(...args)=>{tokens.push(args);return 'SYNTHETIC_SERVER_OAUTH';},
    fetchImpl:async(url,init)=>{calls.push({url,init});return reply(url,init);},now:()=>Date.parse(TIME),...options});
  return {adapter,calls,tokens};
}

test('disabled by default before provider or fetch',async()=>{
  let count=0; const a=createManagementMigrationFirestoreRest({getAccessToken:()=>count++,fetchImpl:()=>count++});
  await assert.rejects(a.readDestinationPair(readPayload()),/MIGRATION_REST_DISABLED/);
  await assert.rejects(a.commitCreatePair(commitPayload()),/MIGRATION_REST_DISABLED/);assert.equal(count,0);
});

test('rejects wrong purpose, unpinned plan and source-only allowlist before credentials',()=>{
  for(const option of [{authorizedPurpose:'OTHER'},{planSha256:'x'},
    {allowedPairs:[{...allowedPair,path:'users/demo'}]},
    {allowedPairs:[{...allowedPair,provenancePath:'migrationOrigins/not-a-hash'}]}]) {
    assert.throws(()=>harness(option),/^Error: MIGRATION_REST_/);
  }
});

test('allowlist is immutable after factory creation',async()=>{
  const list=[clone(allowedPair)]; const h=harness({allowedPairs:list});list[0].path='users/demo';list.length=0;
  await h.adapter.readDestinationPair(readPayload());assert.equal(h.calls.length,1);
});

test('pair batchGet uses fixed readTime and only two pinned names',async()=>{
  const h=harness();const result=await h.adapter.readDestinationPair(readPayload());
  assert.deepEqual(result,{readTime:READ,consistent:true,document:null,provenance:null});
  assert.match(h.calls[0].url,/:batchGet$/);assert.equal(h.calls[0].init.method,'POST');
  assert.deepEqual(JSON.parse(h.calls[0].init.body),{documents:[BASE+PATH,BASE+ORIGIN],readTime:READ});
  assert.equal(h.calls[0].init.redirect,'error');assert.equal(h.calls[0].init.credentials,'omit');
  assert.equal(h.calls[0].init.headers.Authorization,'Bearer SYNTHETIC_SERVER_OAUTH');
  assert.deepEqual(h.tokens[0][0],{projectId:FB,databaseId:'(default)',authorizedPurpose:PURPOSE,operation:'batchGet'});
});

test('normalizes out-of-order pair and preserves Firestore precision',async()=>{
  const h=harness({reply:()=>response([found(ORIGIN,provenance),found(PATH,fields)])});
  const result=await h.adapter.readDestinationPair(readPayload());
  assert.equal(result.document.path,PATH);assert.equal(result.provenance.path,ORIGIN);
  assert.equal(result.document.fields.precision.integerValue,'9223372036854775807');
  assert.equal(result.document.fields.when.timestampValue,'2026-10-09T11:58:59.123456789Z');
});

test('normalizes one missing document without inventing data',async()=>{
  const h=harness({reply:()=>response([missing(ORIGIN),found(PATH,fields)])});
  const result=await h.adapter.readDestinationPair(readPayload());assert.equal(result.provenance,null);assert.equal(result.document.path,PATH);
});

for(const [label,change] of [
  ['FA destination',p=>p.projectId=FA],['other database',p=>p.databaseId='named'],
  ['unknown pair',p=>p.path='managementAreas/other'],['wrong provenance',p=>p.provenancePath='migrationOrigins/'+'d'.repeat(64)],
  ['different plan',p=>p.pins.planSha256='d'.repeat(64)],['missing reservation',p=>delete p.reservationId],
  ['under-reserved pair',p=>p.maximumReads=1]
]) test('read denies '+label+' before token',async()=>{
  const h=harness(),p=readPayload();change(p);await assert.rejects(h.adapter.readDestinationPair(p),/^Error: MIGRATION_REST_/);
  assert.equal(h.calls.length,0);assert.equal(h.tokens.length,0);
});

for(const [label,rows] of [
  ['duplicate names',[missing(PATH),missing(PATH)]],
  ['third document',[missing(PATH),missing(ORIGIN),missing('managementAreas/other')]],
  ['wrong project',[{missing:BASE.replace(FB,FA)+PATH,readTime:READ},missing(ORIGIN)]],
  ['different readTime',[{...missing(PATH),readTime:TIME},missing(ORIGIN)]],
  ['missing readTime',[{missing:BASE+PATH},missing(ORIGIN)]],
  ['both result alternatives',[{...missing(PATH),found:found(PATH,fields).found},missing(ORIGIN)]],
  ['invalid typed field',[found(PATH,{count:{integerValue:2}}),missing(ORIGIN)]],
  ['null fields',[{found:{...found(PATH,fields).found,fields:null},readTime:READ},missing(ORIGIN)]],
  ['document from future',[{found:{...found(PATH,fields).found,updateTime:TIME},readTime:READ},missing(ORIGIN)]]
]) test('read rejects '+label,async()=>{
  const h=harness({reply:()=>response(rows)});await assert.rejects(h.adapter.readDestinationPair(readPayload()),/^Error: MIGRATION_REST_/);assert.equal(h.calls.length,1);
});

test('equivalent timestamp formatting retains consistent snapshot',async()=>{
  const h=harness({reply:()=>response([{...missing(PATH),readTime:'2026-10-09T11:59:59Z'},missing(ORIGIN)])});
  assert.equal((await h.adapter.readDestinationPair(readPayload())).consistent,true);
});

test('rejects reservation reuse even after HTTP refusal',async()=>{
  const h=harness({reply:()=>response({private:'REDACTED_SYNTHETIC'},403)});
  await assert.rejects(h.adapter.readDestinationPair(readPayload()),/MIGRATION_REST_HTTP_403/);
  await assert.rejects(h.adapter.readDestinationPair(readPayload()),/MIGRATION_REST_RESERVATION_REUSED_OR_EXHAUSTED/);assert.equal(h.calls.length,1);
});

test('create pair commits atomically, with exists:false and index-derived paths',async()=>{
  const h=harness({reply:commitResponse});const p=commitPayload();const result=await h.adapter.commitCreatePair(p);
  assert.deepEqual(result,{atomic:true,committed:true,commitTime:COMMIT,writeResults:[{path:PATH,updateTime:COMMIT},{path:ORIGIN,updateTime:COMMIT}]});
  assert.match(h.calls[0].url,/:commit$/);assert.doesNotMatch(h.calls[0].url,/batchWrite/);
  assert.deepEqual(JSON.parse(h.calls[0].init.body),{writes:p.writes});
});

for(const [label,change] of [
  ['overwrite',p=>p.writes[0].currentDocument.exists=true],
  ['updateTime precondition',p=>p.writes[0].currentDocument={updateTime:EARLIER}],
  ['delete',p=>p.writes[0]={delete:BASE+PATH,currentDocument:{exists:false}}],
  ['update mask',p=>p.writes[0].updateMask={fieldPaths:['name']}],
  ['transform',p=>p.writes[0].updateTransforms=[{fieldPath:'when',setToServerValue:'REQUEST_TIME'}]],
  ['third write',p=>p.writes.push(clone(p.writes[0]))],
  ['reversed writes',p=>p.writes.reverse()],
  ['FA write',p=>p.writes[0].update.name=p.writes[0].update.name.replace(FB,FA)],
  ['changed fields',p=>p.writes[0].update.fields.name.stringValue='Changed'],
  ['changed provenance',p=>p.writes[1].update.fields.sourceProjectId.stringValue=FB],
  ['wrong operation id',p=>p.operationId='d'.repeat(64)]
]) test('commit denies '+label+' before token',async()=>{
  const h=harness({reply:commitResponse}),p=commitPayload();change(p);
  await assert.rejects(h.adapter.commitCreatePair(p),/^Error: MIGRATION_REST_/);assert.equal(h.calls.length,0);assert.equal(h.tokens.length,0);
});

test('snapshots payload before awaiting token',async()=>{
  const p=commitPayload(); const h=harness({reply:commitResponse,getAccessToken:async()=>{p.writes[0].update.fields.name.stringValue='Changed';return 'SYNTHETIC_SERVER_OAUTH';}});
  await h.adapter.commitCreatePair(p);assert.equal(JSON.parse(h.calls[0].init.body).writes[0].update.fields.name.stringValue,'Área sintética');
});

for(const [label,body] of [
  ['one result',{commitTime:COMMIT,writeResults:[{updateTime:COMMIT}]}],
  ['extra path in REST response',{commitTime:COMMIT,writeResults:[{updateTime:COMMIT,path:PATH},{updateTime:COMMIT}]}],
  ['transform result',{commitTime:COMMIT,writeResults:[{updateTime:COMMIT,transformResults:[{integerValue:'2'}]},{updateTime:COMMIT}]}],
  ['future commit',{commitTime:'2026-10-09T12:00:00.000000001Z',writeResults:[{updateTime:COMMIT},{updateTime:COMMIT}]}],
  ['future update',{commitTime:COMMIT,writeResults:[{updateTime:TIME},{updateTime:COMMIT}]}]
]) test('commit ambiguous '+label+' returns unknown without replay',async()=>{
  const h=harness({reply:()=>response(body)});await assert.rejects(h.adapter.commitCreatePair(commitPayload()),/MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN/);
  const p=commitPayload();p.reservationId='another-reservation';await assert.rejects(h.adapter.commitCreatePair(p),/MIGRATION_REST_COMMIT_REUSED_OR_INVALID/);assert.equal(h.calls.length,1);
});

test('commit HTTP refusal remains unknown for executor reconciliation',async()=>{
  const h=harness({reply:()=>response({error:{message:'SYNTHETIC_PRIVATE_RESPONSE'}},409)});
  await assert.rejects(h.adapter.commitCreatePair(commitPayload()),/^Error: MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN$/);assert.equal(h.calls.length,1);
});

test('token timeout cannot start a late fetch',async()=>{
  const h=harness({timeoutMs:5,getAccessToken:async()=>{await pause(20);return 'SYNTHETIC_SERVER_OAUTH';}});
  await assert.rejects(h.adapter.readDestinationPair(readPayload()),/MIGRATION_REST_TIMEOUT/);await pause(25);assert.equal(h.calls.length,0);
});

test('commit timeout rejects late completion and does not retry',async()=>{
  const h=harness({timeoutMs:5,reply:async()=>{await pause(20);return commitResponse();}});
  await assert.rejects(h.adapter.commitCreatePair(commitPayload()),/MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN/);await pause(25);assert.equal(h.calls.length,1);
});

test('caller abort before transport does not obtain token',async()=>{
  const controller=new AbortController();controller.abort();const h=harness();
  await assert.rejects(h.adapter.readDestinationPair(readPayload(),{signal:controller.signal}),/MIGRATION_REST_ABORTED/);
  assert.equal(h.calls.length,0);assert.equal(h.tokens.length,0);
});

test('caller abort after commit dispatch has unknown outcome',async()=>{
  const controller=new AbortController();const h=harness({reply:async()=>{controller.abort();return commitResponse();}});
  await assert.rejects(h.adapter.commitCreatePair(commitPayload(),{signal:controller.signal}),/MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN/);assert.equal(h.calls.length,1);
});

test('provider errors are sanitized, even if forged as adapter codes',async()=>{
  const h=harness({getAccessToken:async()=>{throw Error('MIGRATION_REST_SYNTHETIC_PRIVATE_SECRET');}});
  await assert.rejects(h.adapter.readDestinationPair(readPayload()),/^Error: MIGRATION_REST_TRANSPORT_FAILED$/);assert.equal(h.calls.length,0);
});

test('rejects malformed body, oversized response and redirected responses',async()=>{
  for(const reply of [()=>new Response('{',{status:200}),
    ()=>new Response('x'.repeat(1100),{status:200}),
    ()=>({status:200,redirected:true,url:'https://example.invalid/'})]) {
    const h=harness({maximumResponseBytes:1024,reply});await assert.rejects(h.adapter.readDestinationPair(readPayload()),/^Error: MIGRATION_REST_/);assert.equal(h.calls.length,1);
  }
});

test('rejects getters and hidden payload before any credential',async()=>{
  const h=harness(),p=readPayload();let getterRuns=0;
  Object.defineProperty(p,'secret',{enumerable:true,get:()=>{getterRuns++;return 'SYNTHETIC';}});
  await assert.rejects(h.adapter.readDestinationPair(p),/MIGRATION_REST_DATA_INVALID/);assert.equal(getterRuns,0);assert.equal(h.tokens.length,0);
});

test('wall clock advance during token lookup prevents transport',async()=>{
  let time=Date.parse(TIME);const h=harness({now:()=>time,getAccessToken:async()=>{time+=21000;return 'SYNTHETIC_SERVER_OAUTH';}});
  await assert.rejects(h.adapter.readDestinationPair(readPayload()),/MIGRATION_REST_TIMEOUT/);assert.equal(h.calls.length,0);
});

test('allows one read, commit and explicit postcheck per pair with unique reservations',async()=>{
  let count=0;const h=harness({reply:()=>{
    count++; if(count===2) return commitResponse();
    return response([missing(PATH),missing(ORIGIN)].map(row=>({...row,readTime:count===3?COMMIT:READ})));
  }});
  await h.adapter.readDestinationPair(readPayload());await h.adapter.commitCreatePair(commitPayload());
  const post=readPayload();post.reservationId='synthetic-postcheck';await h.adapter.readDestinationPair(post);
  const fourth=readPayload();fourth.reservationId='synthetic-fourth';
  await assert.rejects(h.adapter.readDestinationPair(fourth),/MIGRATION_REST_RESERVATION_REUSED_OR_EXHAUSTED/);assert.equal(h.calls.length,3);
});


test('immediate postcheck rounds nanosecond commitTime upward to valid microsecond readTime',async()=>{
  const commitTime='2026-10-09T11:59:59.500123456Z', readTime='2026-10-09T11:59:59.500124Z';
  const h=harness({reply:url=>url.endsWith(':commit')
    ?response({commitTime,writeResults:[{updateTime:commitTime},{updateTime:commitTime}]})
    :response([found(ORIGIN,provenance),found(PATH,fields)].map(row=>({
      ...row,readTime,found:{...row.found,createTime:commitTime,updateTime:commitTime}
    })))});
  await h.adapter.commitCreatePair(commitPayload());
  const post=readPayload();post.reservationId='synthetic-immediate-postcheck';
  const result=await h.adapter.readDestinationPair(post);
  assert.equal(JSON.parse(h.calls[1].init.body).readTime,readTime);
  assert.equal(result.readTime,readTime);assert.equal(result.document.path,PATH);assert.equal(result.provenance.path,ORIGIN);
  assert.equal(result.document.updateTime,commitTime);assert.equal(result.provenance.updateTime,commitTime);
  assert.equal(h.calls.length,2);assert.equal(h.calls.filter(call=>call.url.endsWith(':commit')).length,1);
});

test('later postcheck advances to wall clock baseline after a confirmed commit',async()=>{
  let time=Date.parse(TIME);
  const h=harness({now:()=>time,reply:(url,init)=>url.endsWith(':commit')?commitResponse()
    :response([missing(PATH),missing(ORIGIN)].map(row=>({...row,readTime:JSON.parse(init.body).readTime})))});
  await h.adapter.commitCreatePair(commitPayload());time+=2000;
  const post=readPayload();post.reservationId='synthetic-later-postcheck';
  const result=await h.adapter.readDestinationPair(post);
  assert.equal(result.readTime,'2026-10-09T12:00:01.000Z');assert.equal(h.calls.length,2);
});
for(const [label,time,commitTime,readTime] of [
  ['second carry',TIME,'2026-10-09T11:59:59.999999999Z','2026-10-09T12:00:00.000000Z'],
  ['day carry','2026-10-10T00:00:00.000Z','2026-10-09T23:59:59.999999999Z','2026-10-10T00:00:00.000000Z']
])test('postcheck microsecond ceiling handles '+label+' without replaying commit',async()=>{
  const h=harness({now:()=>Date.parse(time),reply:url=>url.endsWith(':commit')
    ?response({commitTime,writeResults:[{updateTime:commitTime},{updateTime:commitTime}]})
    :response([found(PATH,fields),found(ORIGIN,provenance)].map(row=>({...row,readTime,
      found:{...row.found,createTime:commitTime,updateTime:commitTime}})))});
  await h.adapter.commitCreatePair(commitPayload());
  const post=readPayload();post.reservationId='synthetic-carry-postcheck';
  const result=await h.adapter.readDestinationPair(post);
  assert.equal(result.readTime,readTime);assert.equal(JSON.parse(h.calls[1].init.body).readTime,readTime);
  assert.equal(result.document.updateTime,commitTime);assert.equal(h.calls.length,2);
});

test('unknown commit does not pin an unconfirmed timestamp for reconciliation',async()=>{
  const h=harness({reply:url=>url.endsWith(':commit')
    ?response({commitTime:COMMIT,writeResults:[{updateTime:COMMIT}]})
    :response([missing(PATH),missing(ORIGIN)])});
  await assert.rejects(h.adapter.commitCreatePair(commitPayload()),/MIGRATION_REST_COMMIT_OUTCOME_UNKNOWN/);
  const post=readPayload();post.reservationId='synthetic-unknown-reconciliation';
  assert.equal((await h.adapter.readDestinationPair(post)).readTime,READ);assert.equal(h.calls.length,2);
});