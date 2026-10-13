import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {packRecoveryCore,unpackRecoveryCore,encodeManagementCaptureRecoveryCore,
  decodeManagementCaptureRecoveryCore,getRecoveryCorePackAttestation} from '../scripts/lib/management-capture-recovery-core-codec.js';

const H=v=>createHash('sha256').update(v).digest('hex'),clone=v=>structuredClone(v);
const READ='2026-10-09T16:00:00.000Z';
function fixture(status='IN_PROGRESS'){
  const document={path:'managementAreas/public-fixture',createTime:READ,updateTime:READ,fields:{
    counter:{integerValue:'1'},nested:{mapValue:{fields:{title:{stringValue:'Ação e recuperação'},
      flags:{arrayValue:{values:[{booleanValue:false},{nullValue:null},{doubleValue:'NaN'}]}}}}}}};
  return {schemaVersion:1,mode:'READ_ONLY_FIRESTORE_CAPTURE',projectId:'sahmt-17a16',databaseId:'(default)',
    readTime:READ,rootCollections:['managementAreas'],scopeSha256:H('synthetic scope'),startedAt:READ,status,
    queue:[{operation:'listCollectionIds',parentPath:document.path,depth:1}],active:{operation:'listDocuments',
      parentPath:'',collectionId:'managementAreas',depth:1,pageToken:'synthetic-private-cursor',consumedTokenHashes:[]},
    documents:[document],missingDocumentPaths:[],completedCollections:[],completedDiscoveryParents:[],
    pages:[{attempt:1,operation:'listDocuments',parentPath:'',collectionId:'managementAreas',readTime:READ,
      requestSha256:H('request'),pageTokenSha256:null,maximumReads:25,status:'RESERVED'}],
    totalReservedReads:25,totalResponseBytes:0};
}
function packetForText(text,template=packRecoveryCore(fixture())){
  const compressed=deflateRawSync(Buffer.from(text,'utf8'),{level:1});
  return {...template,payloadBase64:compressed.toString('base64'),compressedBytes:compressed.length,
    uncompressedBytes:Buffer.byteLength(text,'utf8'),compressedSha256:H(compressed)};
}
function withCompressed(packet,compressed){
  return {...packet,payloadBase64:compressed.toString('base64'),compressedBytes:compressed.length,compressedSha256:H(compressed)};
}

test('codec roundtrip preserves typed private JSON/hash and publishes only safe counts in its summary',()=>{
  const core=fixture(),before=snapshotDigest(core),packet=packRecoveryCore(core),decoded=unpackRecoveryCore(packet);
  assert.deepEqual(decoded,core);assert.equal(packet.rawCoreSha256,before);assert.equal(snapshotDigest(core),before);
  assert.equal(packet.uncompressedBytes,Buffer.byteLength(JSON.stringify(core),'utf8'));
  assert.equal(packet.compressedBytes,Buffer.from(packet.payloadBase64,'base64').length);
  assert.equal(packet.summary.lastAttempt,1);assert.equal(packet.summary.lastStatus,'RESERVED');
  assert.equal(packet.summary.lastRequestSha256,H('request'));assert.equal(packet.summary.lastMaximumReads,25);
  assert.equal(packet.summary.lastOperation,'listDocuments');assert.equal(packet.summary.documents,1);
  const summary=JSON.stringify(packet.summary);
  for(const privateValue of ['public-fixture','synthetic-private-cursor','Ação e recuperação','nested','flags'])
    assert.equal(summary.includes(privateValue),false);
  for(const authority of ['productionAuthorized','migrationReady','fresh','durable','persisted'])
    assert.equal(Object.hasOwn(packet.summary,authority),false);
  decoded.documents[0].fields.counter.integerValue='2';assert.equal(core.documents[0].fields.counter.integerValue,'1');
});

test('empty initial checkpoint has null last metadata and no invented timestamp',()=>{
  const core=fixture();core.pages=[];core.documents=[];core.totalReservedReads=0;core.active=null;
  const packet=packRecoveryCore(core);assert.deepEqual(unpackRecoveryCore(packet),core);
  for(const key of ['lastAttempt','lastRequestSha256','lastStatus','lastOperation','lastMaximumReads','finishedAt','lastObservedAt','snapshotSha256','errorCode'])
    assert.equal(packet.summary[key],null);
});

test('COMPLETE mirrors real terminal metadata without creating authority',()=>{
  const core=fixture('COMPLETE');core.finishedAt='2026-10-09T16:00:01.000Z';core.snapshotSha256=H('snapshot');
  core.pages[0].status='COMPLETE';core.pages[0].responseSha256=H('response');core.pages[0].returnedCount=1;
  core.queue=[];core.active=null;core.completedCollections=['managementAreas'];core.completedDiscoveryParents=['managementAreas/public-fixture'];
  const packet=packRecoveryCore(core);assert.equal(packet.summary.status,'COMPLETE');
  assert.equal(packet.summary.finishedAt,core.finishedAt);assert.deepEqual(unpackRecoveryCore(packet),core);
});

test('INCOMPLETE clock failure and uncertain reservation remain intact',()=>{
  const core=fixture('INCOMPLETE');core.finishedAt=null;core.errorCode='CLOCK_MOVED_BACKWARDS';core.pages[0].status='UNCERTAIN';
  const packet=packRecoveryCore(core);assert.equal(packet.summary.errorCode,core.errorCode);assert.equal(packet.summary.finishedAt,null);
  assert.equal(packet.summary.lastStatus,'UNCERTAIN');assert.equal(packet.summary.totalReservedReads,25);
  assert.deepEqual(unpackRecoveryCore(packet),core);
});

test('aliases preserve single wire format and enforce expected original core SHA',()=>{
  const core=fixture(),packet=encodeManagementCaptureRecoveryCore({coreState:core});
  assert.deepEqual(decodeManagementCaptureRecoveryCore({packet,expectedCoreSha256:snapshotDigest(core)}),core);
  assert.throws(()=>decodeManagementCaptureRecoveryCore({packet,expectedCoreSha256:H('different')}),/RECOVERY_CODEC_EXPECTED_HASH_MISMATCH/);
});

test('pure codec does not obtain clock, credential, filesystem or network adapters',()=>{
  const oldNow=Date.now,oldFetch=globalThis.fetch;Date.now=()=>{throw Error('implicit clock');};globalThis.fetch=()=>{throw Error('network');};
  try{assert.deepEqual(unpackRecoveryCore(packRecoveryCore(fixture())),fixture());}
  finally{Date.now=oldNow;globalThis.fetch=oldFetch;}
});

test('large realistic 365-row snapshot retains nested fields through compression',()=>{
  const core=fixture();core.documents=Array.from({length:365},(_,i)=>{
    const values=Array.from({length:20},(_,j)=>({mapValue:{fields:{
      publicDescription:{stringValue:'PUBLIC FIXTURE '.repeat(12)},sequence:{integerValue:String(j)}}}}));
    const fields={ordinal:{integerValue:String(i)},title:{stringValue:'SYNTHETIC '.repeat(200)},items:{arrayValue:{values}}};
    return {path:'managementAreas/item'+i,createTime:READ,updateTime:READ,fields:{structured:{mapValue:{fields}}}};
  });
  core.completedDiscoveryParents=core.documents.map(d=>d.path);core.queue=[];core.active=null;
  const packet=packRecoveryCore(core);
  assert.ok(packet.compressedBytes<packet.uncompressedBytes/4);
  assert.deepEqual(unpackRecoveryCore(packet),core);assert.equal(packet.summary.documents,365);assert.equal(packet.summary.completedDiscoveryParents,365);
});

for(const [name,mutate]of [
  ['core accessor',c=>{Object.defineProperty(c,'status',{enumerable:true,get(){throw Error('getter invoked');}});}],
  ['nested accessor',c=>{Object.defineProperty(c.documents[0].fields,'secret',{enumerable:true,get(){throw Error('getter invoked');}});}],
  ['cycle',c=>{c.loop=c;}],['nonfinite',c=>{c.number=Infinity;}],['NaN',c=>{c.number=NaN;}],
  ['negative zero',c=>{c.number=-0;}],['undefined',c=>{c.extra=undefined;}],['function',c=>{c.extra=()=>true;}],
  ['Date prototype',c=>{c.extra=new Date(READ);}],['custom prototype',c=>{c.extra=Object.create({value:1});}],
  ['symbol key',c=>{c[Symbol('hidden')]=1;}],['sparse array',c=>{delete c.documents[0];}],
  ['array extension',c=>{c.documents.other=1;}],['wrong project',c=>{c.projectId='sahmt-gestao-5ae66';}],
  ['wrong database',c=>{c.databaseId='different';}],['fake status',c=>{c.status='READY';}],
  ['last proof counter',c=>{c.pages[0].attempt=2;}],['last request unpinned',c=>{c.pages[0].requestSha256='x';}],
  ['last proof status',c=>{c.pages[0].status='APPROVED';}],['negative reserved',c=>{c.totalReservedReads=-1;}],
  ['fake finished timestamp',c=>{c.finishedAt='2026-10-09T25:00:00Z';}]
])test('packing rejects '+name+' without adapters',()=>{
  const core=fixture();mutate(core);assert.throws(()=>packRecoveryCore(core),/RECOVERY_CODEC_/);
});

test('getters are rejected before evaluation',()=>{
  const core=fixture();let touched=false;Object.defineProperty(core,'secret',{enumerable:true,get(){touched=true;return 'private';}});
  assert.throws(()=>packRecoveryCore(core),/RECOVERY_CODEC_JSON_INVALID/);assert.equal(touched,false);
  const packet=clone(packRecoveryCore(fixture()));Object.defineProperty(packet.summary,'status',{enumerable:true,get(){touched=true;return 'COMPLETE';}});
  assert.throws(()=>unpackRecoveryCore(packet),/RECOVERY_CODEC_JSON_INVALID/);assert.equal(touched,false);
});

for(const [name,mutate]of [
  ['extra packet key',p=>{p.authorized=true;}],['unknown codec',p=>{p.codec='GZIP';}],
  ['unknown version',p=>{p.schemaVersion=2;}],['raw hash',p=>{p.rawCoreSha256=H('different');}],
  ['compressed hash',p=>{p.compressedSha256=H('different');}],['compressed size',p=>{p.compressedBytes++;}],
  ['raw size',p=>{p.uncompressedBytes++;}],['oversize raw claim',p=>{p.uncompressedBytes=12*1024*1024+1;}],
  ['oversize compressed claim',p=>{p.compressedBytes=12*1024*1024+65537;}],
  ['base64 whitespace',p=>{p.payloadBase64+=' ';}],['base64 URL alphabet',p=>{p.payloadBase64='-'.repeat(4);}],
  ['base64 padding',p=>{p.payloadBase64+='====';}],['base64 new line',p=>{p.payloadBase64+='\\n';}],
  ['summary amount',p=>{p.summary.totalReservedReads=0;}],['summary status',p=>{p.summary.status='COMPLETE';}],
  ['summary request',p=>{p.summary.lastRequestSha256=H('different');}],['summary extra authority',p=>{p.summary.authorized=true;}],
  ['summary removed key',p=>{delete p.summary.lastStatus;}]
])test('unpacking rejects '+name,()=>{
  const packet=clone(packRecoveryCore(fixture()));mutate(packet);assert.throws(()=>unpackRecoveryCore(packet),/RECOVERY_CODEC_/);
});

test('trailing compressed data is rejected even when its byte count and SHA are recomputed',()=>{
  const p=packRecoveryCore(fixture()),compressed=Buffer.from(p.payloadBase64,'base64');
  assert.throws(()=>unpackRecoveryCore(withCompressed(p,Buffer.concat([compressed,Buffer.from('trailing')]))),
    /RECOVERY_CODEC_TRAILING_DATA_OR_BYTE_MISMATCH/);
  assert.throws(()=>unpackRecoveryCore(withCompressed(p,Buffer.concat([compressed,compressed]))),
    /RECOVERY_CODEC_TRAILING_DATA_OR_BYTE_MISMATCH/);
});

test('truncated/invalid deflate fails closed without returning partial JSON',()=>{
  const p=packRecoveryCore(fixture()),compressed=Buffer.from(p.payloadBase64,'base64');
  for(const bytes of [compressed.subarray(0,compressed.length-1),Buffer.from([255,255,255,255])])
    assert.throws(()=>unpackRecoveryCore(withCompressed(p,bytes)),/RECOVERY_CODEC_INFLATE_FAILED_OR_LIMIT/);
});

test('invalid UTF8 is rejected after bounded inflation',()=>{
  const p=packRecoveryCore(fixture()),bytes=Buffer.from([123,34,120,34,58,34,255,34,125]),compressed=deflateRawSync(bytes);
  assert.throws(()=>unpackRecoveryCore({...withCompressed(p,compressed),uncompressedBytes:bytes.length}),/RECOVERY_CODEC_UTF8_INVALID/);
});

test('invalid JSON, duplicate keys and whitespace cannot acquire the hash of a normalized core',()=>{
  const p=packRecoveryCore(fixture()),text=JSON.stringify(fixture());
  for(const changed of ['{',text.replace('{"schemaVersion":1','{"schemaVersion":0,"schemaVersion":1'),text+' '])
    assert.throws(()=>unpackRecoveryCore(packetForText(changed,p)),/RECOVERY_CODEC_JSON_(INVALID|REPRESENTATION_INVALID)/);
});

test('inflate bomb is capped at 12 MiB before JSON parsing even with a forged smaller claim',()=>{
  const p=packRecoveryCore(fixture()),raw=Buffer.alloc(12*1024*1024+1,32),compressed=deflateRawSync(raw,{level:1});
  const bomb={...withCompressed(p,compressed),uncompressedBytes:1};
  assert.throws(()=>unpackRecoveryCore(bomb),/RECOVERY_CODEC_INFLATE_FAILED_OR_LIMIT/);
});

test('raw byte cap handles multibyte text and decoder depth cap is enforced',()=>{
  const core=fixture();core.extra='á'.repeat(6*1024*1024);
  assert.throws(()=>packRecoveryCore(core),/RECOVERY_CODEC_RAW_LIMIT/);
  const deep=fixture();let cursor=deep;
  for(let i=0;i<101;i++){cursor.extra={};cursor=cursor.extra;}
  assert.throws(()=>packRecoveryCore(deep),/RECOVERY_CODEC_JSON_LIMIT/);
  const p=packRecoveryCore(fixture()),text=JSON.stringify(deep),forged=packetForText(text,p);
  assert.throws(()=>unpackRecoveryCore(forged),/RECOVERY_CODEC_JSON_LIMIT/);
});

test('returned packet and safe attestation are deeply immutable without retaining the raw core',()=>{
  const core=fixture(),packet=packRecoveryCore(core),before=snapshotDigest(core),receipt=getRecoveryCorePackAttestation(packet);
  assert.ok(Object.isFrozen(packet));assert.ok(Object.isFrozen(packet.summary));assert.ok(Object.isFrozen(receipt));
  assert.equal(receipt.summary,packet.summary);assert.equal(receipt.packetSha256,snapshotDigest(packet));
  assert.equal(receipt.rawCoreSha256,before);assert.deepEqual(Object.keys(receipt).sort(),['packetSha256','rawCoreSha256','summary']);
  assert.throws(()=>{packet.summary.lastAttempt=2;},TypeError);
  assert.throws(()=>{packet.payloadBase64='forged';},TypeError);
  assert.throws(()=>{receipt.packetSha256=H('forged');},TypeError);
  assert.deepEqual(unpackRecoveryCore(packet),core);assert.equal(snapshotDigest(core),before);
  core.documents[0].fields.counter.integerValue='changed after pack';
  assert.equal(unpackRecoveryCore(packet).documents[0].fields.counter.integerValue,'1');
});

test('attestation is unavailable to equal copies, deserialized packets, forged receipts or accessor wrappers',()=>{
  const packet=packRecoveryCore(fixture());assert.ok(getRecoveryCorePackAttestation(packet));
  for(const copy of [clone(packet),{...packet},Object.freeze(clone(packet)),getRecoveryCorePackAttestation(packet),null,undefined,'packet',false])
    assert.equal(getRecoveryCorePackAttestation(copy),null);
  let touched=false;const wrapper={};Object.defineProperty(wrapper,'packet',{get(){touched=true;return packet;}});
  assert.equal(getRecoveryCorePackAttestation(wrapper),null);assert.equal(touched,false);
  const changed=clone(packet);changed.summary.lastAttempt=2;
  assert.throws(()=>unpackRecoveryCore(changed),/RECOVERY_CODEC_SUMMARY_MISMATCH/);
});
