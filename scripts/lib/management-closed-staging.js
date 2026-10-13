import {snapshotDigest,documentDigest,validateSplitSnapshot,prepareSplitPlan} from './management-split-plan.js';

const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',DATABASE='(default)';
const BASE='projects/'+FB+'/databases/'+DATABASE+'/documents/';
const SHA=/^[a-f0-9]{64}$/;
const COPY_ROOTS=new Set(['documents','scopedDocuments','managementAreas','evaluationActivities','evaluationFormConfigs','evaluationAssignments','evaluationAssignmentHistory']);
const MAX_PAIRS=134,MAX_BYTES=4*1024*1024,FRESH_COMMIT_NS=300000000000n;
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>snapshotDigest(a)===snapshotDigest(b);
const equalSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.length===b.length&&a.every(v=>b.includes(v));
function timestampNs(value){
 demand(typeof value==='string','STAGING_TIMESTAMP_INVALID');
 const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
 demand(match&&Number(value.slice(0,4))>=1,'STAGING_TIMESTAMP_INVALID');
 const ms=Date.parse(match[1]+'Z');demand(Number.isSafeInteger(ms)&&ms>=0&&new Date(ms).toISOString().slice(0,19)===match[1],'STAGING_TIMESTAMP_INVALID');
 return BigInt(ms)*1000000n+BigInt((match[2]||'').padEnd(9,'0'));
}
function nowNs(nowMs){demand(Number.isSafeInteger(nowMs)&&nowMs>=0,'STAGING_CLOCK_INVALID');return BigInt(nowMs)*1000000n;}
function documentPath(name){
 demand(typeof name==='string'&&name.startsWith(BASE),'STAGING_DOCUMENT_SCOPE');
 const path=name.slice(BASE.length),parts=path.split('/');
 demand(parts.length===2&&parts.every(p=>p&&!['.','..','*'].includes(p)&&!/^__.*__$/.test(p)&&!/[\\\x00-\x1f\x7f]/.test(p)&&Buffer.byteLength(p)<=1500),'STAGING_DOCUMENT_PATH');
 demand(COPY_ROOTS.has(parts[0])||parts[0]==='migrationOrigins'&&SHA.test(parts[1]),'STAGING_COPY_ROOT_FORBIDDEN');
 return path;
}
function validateBatch(batch){
 demand(plain(batch)&&batch.schemaVersion===1&&batch.kind==='MANAGEMENT_CLOSED_STAGING_BATCH'
  &&batch.sourceProjectId===FA&&batch.destinationProjectId===FB&&batch.databaseId===DATABASE
  &&batch.productionAuthorized===false&&batch.migrationReady===false&&batch.historicalCapture===true
  &&batch.requiresReconciliationBeforeActivation===true,'STAGING_BATCH_INVALID');
 const {batchSha256,...body}=batch;
 demand(SHA.test(batchSha256||'')&&snapshotDigest(body)===batchSha256,'STAGING_BATCH_HASH_MISMATCH');
 demand(['planSha256','manifestSha256','sourceSnapshotSha256','auditedSourceSnapshotSha256','sourceCaptureSha256'].every(k=>SHA.test(batch[k]||'')),'STAGING_BATCH_PINS');
 demand(timestampNs(batch.sourceReadTime)>=timestampNs(batch.baselineReadTime),'STAGING_SOURCE_CAPTURE_ORDER');
 demand(Array.isArray(batch.writes)&&batch.writes.length>0&&batch.writes.length%2===0&&batch.writes.length<=MAX_PAIRS*2
  &&Array.isArray(batch.documentNames)&&batch.documentNames.length===batch.writes.length&&new Set(batch.documentNames).size===batch.documentNames.length
  &&Array.isArray(batch.expectedDocuments)&&batch.expectedDocuments.length===batch.writes.length,'STAGING_BATCH_COVERAGE');
 const roots=new Set(),synthetic=[];
 for(const [i,w]of batch.writes.entries()){
  demand(exact(w,['update','currentDocument'])&&exact(w.update,['name','fields'])&&exact(w.currentDocument,['exists'])&&w.currentDocument.exists===false,'STAGING_CREATE_PRECONDITION');
  const path=documentPath(w.update.name),expected=batch.expectedDocuments[i];roots.add(path.split('/')[0]);
  demand(i%2===0?COPY_ROOTS.has(path.split('/')[0]):path.startsWith('migrationOrigins/'),'STAGING_PAIR_ORDER');
  demand(batch.documentNames[i]===w.update.name&&exact(expected,['name','path','fieldsSha256'])&&expected.name===w.update.name
   &&expected.path===path&&SHA.test(expected.fieldsSha256||'')&&expected.fieldsSha256===snapshotDigest(w.update.fields),'STAGING_BATCH_DOCUMENT_PIN');
  synthetic.push({path,fields:w.update.fields,createTime:batch.baselineReadTime,updateTime:batch.baselineReadTime});
  if(i%2===1){
   const original=batch.expectedDocuments[i-1],f=w.update.fields;
   demand(f?.sourceProjectId?.stringValue===FA&&f.destinationProjectId?.stringValue===FB
    &&f.sourceDatabaseId?.stringValue===DATABASE&&f.sourcePath?.stringValue===original.path
    &&f.destinationPath?.stringValue===original.path&&f.destinationFieldsSha256?.stringValue===original.fieldsSha256,'STAGING_PROVENANCE_BINDING');
  }
 }
 validateSplitSnapshot({schemaVersion:1,projectId:FB,databaseId:DATABASE,readTime:batch.baselineReadTime,
  coverage:{complete:true,consistent:true,rootCollections:[...roots]},documents:synthetic});
 const bytes=Buffer.byteLength(JSON.stringify({writes:batch.writes}));
 demand(bytes<=MAX_BYTES&&batch.requestBytes===bytes,'STAGING_REQUEST_TOO_LARGE');
 demand(plain(batch.counts)&&batch.counts.copiedDocuments===batch.writes.length/2&&batch.counts.provenanceDocuments===batch.writes.length/2
  &&batch.counts.totalWrites===batch.writes.length&&Number.isSafeInteger(batch.counts.sourceDocuments)&&batch.counts.sourceDocuments>=batch.counts.copiedDocuments
  &&Number.isSafeInteger(batch.counts.keptInFa)&&batch.counts.keptInFa>=0,'STAGING_BATCH_COUNTS');
 return batch;
}

/** Pure preparation of a closed historical copy. No credentials, network, Auth or production activation. */
export function prepareManagementClosedStagingBatch({sourceSnapshot,manifest,destinationSnapshot,plan,auditedSourceSnapshot,sourceCaptureSha256}={}){
 demand(SHA.test(sourceCaptureSha256||''),'STAGING_CAPTURE_PIN');
 validateSplitSnapshot(sourceSnapshot);validateSplitSnapshot(destinationSnapshot);validateSplitSnapshot(auditedSourceSnapshot);
 demand(sourceSnapshot.projectId===FA&&auditedSourceSnapshot.projectId===FA&&destinationSnapshot.projectId===FB
  &&sourceSnapshot.databaseId===DATABASE&&auditedSourceSnapshot.databaseId===DATABASE&&destinationSnapshot.databaseId===DATABASE,'STAGING_PROJECT_SCOPE');
 demand(equalSet(sourceSnapshot.coverage.rootCollections,auditedSourceSnapshot.coverage.rootCollections),'STAGING_SOURCE_ROOTS_CHANGED');
 demand(timestampNs(auditedSourceSnapshot.readTime)>=timestampNs(sourceSnapshot.readTime),'STAGING_SOURCE_CAPTURE_ORDER');
 const originals=new Map(sourceSnapshot.documents.map(d=>[d.path,documentDigest(d)]));
 demand(auditedSourceSnapshot.documents.length===originals.size&&auditedSourceSnapshot.documents.every(d=>originals.get(d.path)===documentDigest(d)),'STAGING_SOURCE_CHANGED');
 const regenerated=prepareSplitPlan(sourceSnapshot,manifest,destinationSnapshot);
 demand(plain(plan)&&plan.readyForReview===true&&plan.destinationVerified===true&&Array.isArray(plan.blockers)&&plan.blockers.length===0,'STAGING_PLAN_BLOCKED');
 const {planSha256,...unsigned}=plan;
 demand(SHA.test(planSha256||'')&&snapshotDigest(unsigned)===planSha256&&same(regenerated,plan),'STAGING_PLAN_HASH_MISMATCH');
 demand(plan.operations.length>0&&plan.operations.length<=MAX_PAIRS,'STAGING_PAIR_LIMIT');
 demand(plan.counts.rebuild===0&&manifest.entries.every(e=>['COPY','KEEP_FA'].includes(e.action)),'STAGING_REBUILD_FORBIDDEN');
 const writes=[],documentNames=[],expectedDocuments=[];
 for(const op of plan.operations){
  demand(COPY_ROOTS.has(op.path.split('/')[0]),'STAGING_COPY_ROOT_FORBIDDEN');
  demand(op.operation==='CREATE_DOCUMENT_AND_PROVENANCE'&&op.result==='CREATE_ONLY'&&op.writeRequired===true,'STAGING_CREATE_ONLY_REQUIRED');
  demand(exact(op.precondition,['exists'])&&op.precondition.exists===false&&exact(op.provenancePrecondition,['exists'])&&op.provenancePrecondition.exists===false,'STAGING_CREATE_PRECONDITION');
  for(const [path,fields]of [[op.path,op.fields],[op.provenancePath,op.provenanceFields]]){
   const name=BASE+path;documentPath(name);
   writes.push({update:{name,fields:clone(fields)},currentDocument:{exists:false}});
   documentNames.push(name);expectedDocuments.push({name,path,fieldsSha256:snapshotDigest(fields)});
  }
 }
 const requestBytes=Buffer.byteLength(JSON.stringify({writes}));demand(requestBytes<=MAX_BYTES,'STAGING_REQUEST_TOO_LARGE');
 const body={schemaVersion:1,kind:'MANAGEMENT_CLOSED_STAGING_BATCH',sourceProjectId:FA,destinationProjectId:FB,databaseId:DATABASE,
  planSha256,manifestSha256:snapshotDigest(manifest),sourceSnapshotSha256:snapshotDigest(sourceSnapshot),auditedSourceSnapshotSha256:snapshotDigest(auditedSourceSnapshot),
  sourceCaptureSha256,sourceReadTime:auditedSourceSnapshot.readTime,baselineReadTime:sourceSnapshot.readTime,
  writes,documentNames,expectedDocuments,requestBytes,
  counts:{sourceDocuments:sourceSnapshot.documents.length,copiedDocuments:plan.operations.length,keptInFa:plan.counts.keepFa,provenanceDocuments:plan.operations.length,totalWrites:writes.length},
  historicalCapture:true,requiresReconciliationBeforeActivation:true,productionAuthorized:false,migrationReady:false};
 return validateBatch({...body,batchSha256:snapshotDigest(body)});
}

/** Verify every REST batchGet result at one readTime; return only aggregate evidence. */
export function validateManagementClosedStagingRead({batch,rows,readTime,expectation,nowMs=Date.now()}={}){
 validateBatch(batch);
 demand(['EMPTY','IDENTICAL'].includes(expectation),'STAGING_READ_EXPECTATION');
 const observed=timestampNs(readTime);demand(observed<=nowNs(nowMs),'STAGING_READ_TIME_FUTURE');
 demand(Array.isArray(rows)&&rows.length===batch.documentNames.length,'STAGING_READ_COVERAGE');
 const expected=new Map(batch.expectedDocuments.map(d=>[d.name,d])),seen=new Set(),foundDocuments=[];let missing=0,found=0;
 for(const row of rows){
  demand(plain(row)&&Object.hasOwn(row,'found')!==Object.hasOwn(row,'missing')
   &&Object.keys(row).every(k=>['found','missing','readTime'].includes(k)),'STAGING_READ_ROW_INVALID');
  demand(typeof row.readTime==='string'&&timestampNs(row.readTime)===observed,'STAGING_READ_TIME_MISMATCH');
  timestampNs(row.readTime);
  const isFound=Object.hasOwn(row,'found'),name=isFound?row.found?.name:row.missing;
  demand(typeof name==='string'&&expected.has(name),'STAGING_READ_OUTSIDE_BATCH');
  demand(!seen.has(name),'STAGING_READ_DUPLICATE');seen.add(name);
  if(!isFound){missing++;continue;}
  const document=row.found;
  demand(plain(document)&&Object.keys(document).every(k=>['name','fields','createTime','updateTime'].includes(k))
   &&Object.hasOwn(document,'createTime')&&Object.hasOwn(document,'updateTime'),'STAGING_FOUND_INVALID');
  const path=expected.get(name).path,typed={path,fields:document.fields||{},createTime:document.createTime,updateTime:document.updateTime};
  validateSplitSnapshot({schemaVersion:1,projectId:FB,databaseId:DATABASE,readTime,coverage:{complete:true,consistent:true,rootCollections:[path.split('/')[0]]},documents:[typed]});
  if(expectation==='IDENTICAL')demand(snapshotDigest(typed.fields)===expected.get(name).fieldsSha256,'STAGING_FIELDS_MISMATCH');
  foundDocuments.push(name);found++;
 }
 demand(seen.size===batch.documentNames.length,'STAGING_READ_COVERAGE');
 if(expectation==='EMPTY')demand(found===0,'STAGING_DESTINATION_NOT_EMPTY');
 else demand(missing===0&&found===batch.documentNames.length,'STAGING_PAIR_NOT_COMPLETE');
 return {schemaVersion:1,status:'VERIFIED',expectation,readTime,batchSha256:batch.batchSha256,
  counts:{documents:batch.documentNames.length,pairs:batch.counts.copiedDocuments,missing,found},historicalCapture:true,requiresReconciliationBeforeActivation:true};
}

/** REST commit applies its writes atomically; result order corresponds to request order. */
export function validateManagementClosedStagingCommit({batch,response,nowMs}={}){
 validateBatch(batch);const current=nowNs(nowMs);
 demand(plain(response)&&Object.hasOwn(response,'commitTime')&&!Object.hasOwn(response,'error'),'STAGING_COMMIT_RESPONSE_INVALID');
 const committed=timestampNs(response.commitTime);
 demand(committed<=current&&current-committed<=FRESH_COMMIT_NS,'STAGING_COMMIT_TIME_NOT_FRESH');
 demand(Array.isArray(response.writeResults)&&response.writeResults.length===batch.documentNames.length,'STAGING_COMMIT_RESULTS');
 for(const [index,result]of response.writeResults.entries()){
  demand(plain(result)&&Object.hasOwn(result,'updateTime')&&!Object.hasOwn(result,'error'),'STAGING_COMMIT_RESULT_INVALID');
  demand(!Object.hasOwn(result,'name')||result.name===batch.documentNames[index],'STAGING_COMMIT_INDEX_MISMATCH');
  demand(!Object.hasOwn(result,'path')||result.path===batch.expectedDocuments[index].path,'STAGING_COMMIT_INDEX_MISMATCH');
  demand(!Object.hasOwn(result,'index')||result.index===index,'STAGING_COMMIT_INDEX_MISMATCH');
  demand(!Object.hasOwn(result,'transformResults')||Array.isArray(result.transformResults)&&result.transformResults.length===0,'STAGING_COMMIT_TRANSFORMS_FORBIDDEN');
  demand(timestampNs(result.updateTime)<=committed,'STAGING_COMMIT_UPDATE_TIME_INVALID');
 }
 return {schemaVersion:1,status:'VERIFIED',atomic:true,commitTime:response.commitTime,writeResults:response.writeResults.length,
  pairs:batch.counts.copiedDocuments,batchSha256:batch.batchSha256,historicalCapture:true,requiresReconciliationBeforeActivation:true};
}
