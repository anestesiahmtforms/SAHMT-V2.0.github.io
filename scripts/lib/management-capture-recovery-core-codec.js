import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {snapshotDigest} from './management-split-plan.js';

const MAX_RAW=12*1024*1024,MAX_COMPRESSED=MAX_RAW+65536;
// Only exact immutable packets produced by this module instance are attested.
// Weak keys retain no packet/core after the caller releases its packet.
const packedAttestations=new WeakMap();
const MAX_BASE64=Math.ceil(MAX_COMPRESSED/3)*4;
const packetKeys=['schemaVersion','kind','codec','rawCoreSha256','uncompressedBytes','compressedBytes',
  'payloadBase64','compressedSha256','summary'];
const summaryKeys=['projectId','databaseId','readTime','startedAt','status','finishedAt','lastObservedAt',
  'documents','missingParents','completedCollections','completedDiscoveryParents','pendingTasks','activeOperation',
  'pages','totalReservedReads','totalResponseBytes','lastAttempt','lastRequestSha256','lastStatus','lastOperation',
  'lastMaximumReads','snapshotSha256','errorCode'];
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const integer=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const exact=(v,keys)=>plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{
  const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');
});
function json(value,maxBytes=MAX_RAW){
  let nodes=0,characters=0;const seen=new Set();
  const visit=(v,depth=0)=>{
    demand(++nodes<=1500000&&depth<=100,'RECOVERY_CODEC_JSON_LIMIT');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='string'){
      characters+=v.length;demand(characters<=maxBytes,'RECOVERY_CODEC_JSON_LIMIT');return;
    }
    if(typeof v==='number'){demand(Number.isFinite(v)&&!Object.is(v,-0),'RECOVERY_CODEC_JSON_INVALID');return;}
    demand((Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype||plain(v))&&!seen.has(v),'RECOVERY_CODEC_JSON_INVALID');
    seen.add(v);const keys=Reflect.ownKeys(v);
    if(Array.isArray(v))demand(keys.length===v.length+1&&keys.at(-1)==='length','RECOVERY_CODEC_JSON_INVALID');
    for(const k of keys){
      if(Array.isArray(v)&&k==='length')continue;
      const d=Object.getOwnPropertyDescriptor(v,k);
      demand(typeof k==='string'&&d.enumerable&&Object.hasOwn(d,'value'),'RECOVERY_CODEC_JSON_INVALID');
      characters+=k.length;demand(characters<=maxBytes,'RECOVERY_CODEC_JSON_LIMIT');visit(d.value,depth+1);
    }
    seen.delete(v);
  };
  visit(value);
  const text=JSON.stringify(value),bytes=Buffer.byteLength(text,'utf8');
  demand(bytes<=maxBytes,'RECOVERY_CODEC_RAW_LIMIT');
  return {value:JSON.parse(text),text,bytes};
}
function timestamp(v){
  if(typeof v!=='string')return false;
  const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(v);
  if(!match||Number(v.slice(0,4))<1)return false;
  const ms=Date.parse(match[1]+'Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)===match[1];
}
const pageStatuses=new Set(['RESERVATION_PENDING','RESERVATION_FAILED','RESERVATION_DENIED','RESERVED','SENT',
  'COMPLETE','UNCERTAIN','FAILED']);
function summaryOf(core){
  demand(plain(core)&&core.schemaVersion===1&&core.mode==='READ_ONLY_FIRESTORE_CAPTURE'
    &&core.projectId==='sahmt-17a16'&&core.databaseId==='(default)'
    &&timestamp(core.readTime)&&timestamp(core.startedAt)
    &&['IN_PROGRESS','COMPLETE','INCOMPLETE'].includes(core.status)
    &&Array.isArray(core.rootCollections)&&core.rootCollections.length>0
    &&core.rootCollections.length<=6000&&new Set(core.rootCollections).size===core.rootCollections.length
    &&core.rootCollections.every(v=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(v))
    &&sha(core.scopeSha256)&&Array.isArray(core.documents)&&core.documents.length<=6000
    &&Array.isArray(core.missingDocumentPaths)&&core.missingDocumentPaths.length<=6000
    &&Array.isArray(core.completedCollections)&&core.completedCollections.length<=6000
    &&Array.isArray(core.completedDiscoveryParents)&&core.completedDiscoveryParents.length<=12000
    &&Array.isArray(core.queue)&&core.queue.length<=12000
    &&(core.active===null||plain(core.active)&&['listDocuments','listCollectionIds'].includes(core.active.operation))
    &&Array.isArray(core.pages)&&core.pages.length<=3000
    &&integer(core.totalReservedReads)&&integer(core.totalResponseBytes)&&core.totalResponseBytes<=MAX_RAW,
    'RECOVERY_CODEC_CORE_HEADER_INVALID');
  demand(core.finishedAt===undefined||core.finishedAt===null&&core.status==='INCOMPLETE'||timestamp(core.finishedAt),'RECOVERY_CODEC_CORE_HEADER_INVALID');
  demand(core.lastObservedAt===undefined||timestamp(core.lastObservedAt),'RECOVERY_CODEC_CORE_HEADER_INVALID');
  demand(core.snapshotSha256===undefined||sha(core.snapshotSha256),'RECOVERY_CODEC_CORE_HEADER_INVALID');
  demand(core.errorCode===undefined||typeof core.errorCode==='string'&&/^[A-Z][A-Z0-9_]{2,100}$/.test(core.errorCode),
    'RECOVERY_CODEC_CORE_HEADER_INVALID');
  // This is an integrity summary, not a semantic COMPLETE, freshness or budget proof.
  const last=core.pages.at(-1)??null;
  if(last)demand(plain(last)&&last.attempt===core.pages.length
    &&['listDocuments','listCollectionIds'].includes(last.operation)&&sha(last.requestSha256)
    &&integer(last.maximumReads)&&last.maximumReads>0&&last.maximumReads<=25&&pageStatuses.has(last.status),
    'RECOVERY_CODEC_LAST_PAGE_INVALID');
  return {projectId:core.projectId,databaseId:core.databaseId,readTime:core.readTime,startedAt:core.startedAt,
    status:core.status,finishedAt:core.finishedAt??null,lastObservedAt:core.lastObservedAt??null,
    documents:core.documents.length,missingParents:core.missingDocumentPaths.length,
    completedCollections:core.completedCollections.length,completedDiscoveryParents:core.completedDiscoveryParents.length,
    pendingTasks:core.queue.length,activeOperation:core.active?.operation??null,pages:core.pages.length,
    totalReservedReads:core.totalReservedReads,totalResponseBytes:core.totalResponseBytes,
    lastAttempt:last?.attempt??null,lastRequestSha256:last?.requestSha256??null,lastStatus:last?.status??null,
    lastOperation:last?.operation??null,lastMaximumReads:last?.maximumReads??null,
    snapshotSha256:core.snapshotSha256??null,errorCode:core.errorCode??null};
}
/** Inner compression only: the caller still encrypts the entire packet with the
 * existing DPAPI/AES v2 protector. Never log this packet or use summary as authority. */
export function packRecoveryCore(coreState){
  const raw=json(coreState),summary=summaryOf(raw.value);
  const bytes=Buffer.from(raw.text,'utf8'),compressed=deflateRawSync(bytes,{level:1});
  demand(compressed.length>0&&compressed.length<=MAX_COMPRESSED,'RECOVERY_CODEC_COMPRESSED_LIMIT');
  const packet=Object.freeze({schemaVersion:1,kind:'MANAGEMENT_RECOVERY_CORE_CODEC',codec:'DEFLATE_RAW_JSON',
    rawCoreSha256:snapshotDigest(raw.value),uncompressedBytes:bytes.length,compressedBytes:compressed.length,
    payloadBase64:compressed.toString('base64'),compressedSha256:hash(compressed),summary:Object.freeze(summary)});
  packedAttestations.set(packet,Object.freeze({packetSha256:snapshotDigest(packet),
    rawCoreSha256:packet.rawCoreSha256,summary:packet.summary}));
  return packet;
}
/** Process-local evidence only: an equal/deserialized packet has no attestation.
 * The receipt contains only hashes and safe summary metadata, never the raw core.
 * Stores must compare the copied packet digest before using this evidence. */
export function getRecoveryCorePackAttestation(packet){
  return packet!==null&&typeof packet==='object'?packedAttestations.get(packet)??null:null;
}
/** Synchronous bounded inflate and full data/summary integrity, with no I/O. */
export function unpackRecoveryCore(input){
  // Validate descriptors before reading packet fields, including summary accessors.
  const normalized=json(input,MAX_BASE64+65536).value;
  demand(exact(normalized,packetKeys)&&normalized.schemaVersion===1&&normalized.kind==='MANAGEMENT_RECOVERY_CORE_CODEC'
    &&normalized.codec==='DEFLATE_RAW_JSON'&&sha(normalized.rawCoreSha256)&&sha(normalized.compressedSha256)
    &&integer(normalized.uncompressedBytes)&&normalized.uncompressedBytes>0&&normalized.uncompressedBytes<=MAX_RAW
    &&integer(normalized.compressedBytes)&&normalized.compressedBytes>0&&normalized.compressedBytes<=MAX_COMPRESSED
    &&typeof normalized.payloadBase64==='string'&&normalized.payloadBase64.length<=MAX_BASE64
    &&normalized.payloadBase64.length%4===0
    &&/^[A-Za-z0-9+/]*={0,2}$/.test(normalized.payloadBase64)
    &&exact(normalized.summary,summaryKeys),'RECOVERY_CODEC_PACKET_INVALID');
  const compressed=Buffer.from(normalized.payloadBase64,'base64');
  demand(compressed.length===normalized.compressedBytes&&compressed.toString('base64')===normalized.payloadBase64
    &&hash(compressed)===normalized.compressedSha256,'RECOVERY_CODEC_COMPRESSED_INTEGRITY');
  let inflated;
  try{inflated=inflateRawSync(compressed,{maxOutputLength:MAX_RAW,info:true});}
  catch{throw Error('RECOVERY_CODEC_INFLATE_FAILED_OR_LIMIT');}
  demand(inflated.engine.bytesWritten===compressed.length&&inflated.buffer.length===normalized.uncompressedBytes,
    'RECOVERY_CODEC_TRAILING_DATA_OR_BYTE_MISMATCH');
  const text=inflated.buffer.toString('utf8');
  demand(Buffer.from(text,'utf8').equals(inflated.buffer),'RECOVERY_CODEC_UTF8_INVALID');
  let parsed;
  try{parsed=JSON.parse(text);}catch{throw Error('RECOVERY_CODEC_JSON_INVALID');}
  const raw=json(parsed);
  demand(raw.text===text,'RECOVERY_CODEC_JSON_REPRESENTATION_INVALID');
  const summary=summaryOf(raw.value);
  demand(snapshotDigest(raw.value)===normalized.rawCoreSha256,'RECOVERY_CODEC_RAW_HASH_MISMATCH');
  demand(snapshotDigest(summary)===snapshotDigest(normalized.summary),'RECOVERY_CODEC_SUMMARY_MISMATCH');
  return raw.value;
}
export function encodeManagementCaptureRecoveryCore({coreState}={}){
  return packRecoveryCore(coreState);
}
export function decodeManagementCaptureRecoveryCore({packet,expectedCoreSha256}={}){
  const core=unpackRecoveryCore(packet);
  demand(expectedCoreSha256===undefined||sha(expectedCoreSha256)&&snapshotDigest(core)===expectedCoreSha256,
    'RECOVERY_CODEC_EXPECTED_HASH_MISMATCH');
  return core;
}
