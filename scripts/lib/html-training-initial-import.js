import {createHash} from 'node:crypto';
import {publication, documentSize} from '../../worker-training/domain-validation.js';
import {contentParts} from '../../worker-training/service.js';

export const IMPORT_PROJECT='sahmt-gestao-5ae66';
export const IMPORT_ACCOUNT='anestesiahmtforms2@gmail.com';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const collections=['htmlTrainings','htmlTrainingVersions','htmlTrainingContent'];

/** Creates only new private drafts; the baseline never awards points or queues a Drive write. */
export function initialImportPlan(manifest,{manifestSha256,now=Date.now()}={}){
 if(manifest?.projectId!==IMPORT_PROJECT||manifest.schemaVersion!==1||!Array.isArray(manifest.trainings)||!manifest.trainings.length||
  !/^[a-f0-9]{64}$/.test(manifestSha256)||!Number.isSafeInteger(now))throw Error('IMPORT_PACKAGE_INVALID');
 const ids=new Set();
 return manifest.trainings.map(item=>{
  if(ids.has(item.trainingId)||item.training?.status!=='DRAFT'||item.training?.managerUid!=='')throw Error('IMPORT_DRAFTS_ONLY');
  ids.add(item.trainingId);
  const parsed=publication({...item,expectedVersion:0});
  const id=item.trainingId,versionId=id+'_v1',parts=contentParts(parsed.sections);
  const provenance={initialImportSha256:manifestSha256,importedByEmail:IMPORT_ACCOUNT,importedAt:now};
  const metadata={...parsed.training,version:1,sectionCount:parsed.sections.length,
   selectedQuestionIds:parsed.privateVersion.selectedQuestionIds,
   maxScore:parsed.privateVersion.bank.filter(q=>parsed.privateVersion.selectedQuestionIds.includes(q.id)).reduce((n,q)=>n+q.points,0),
   hasAudit:!!parsed.privateVersion.auditSchema,createdAt:now,createdByUid:'',updatedAt:now,updatedByUid:'',
   syncStatus:'BASELINE_PENDING_RECHECK',importPending:structuredClone(item.pending||[]),...provenance};
  const snapshot={id:versionId,trainingId:id,version:1,...parsed.privateVersion,training:metadata,
   sectionCount:parsed.sections.length,chunkCount:parts.length,contentEncoding:'JSON_UTF8_CHUNKS_V1',
   createdAt:now,createdByUid:'',previousVersion:0,...provenance};
  const records=[{collection:collections[0],id,data:metadata},{collection:collections[1],id:versionId,data:snapshot},
   ...parts.map((part,index)=>({collection:collections[2],id:`${versionId}_p${index}`,data:{id:`${versionId}_p${index}`,trainingId:id,version:1,index,part}}))];
  for(const record of records)documentSize(record.data);
  return {id,manifestSha256,records};
 });
}

export async function importInitialDrafts(store,plan,{apply=false,onProgress=()=>{}}={}){
 if(!Array.isArray(plan)||!plan.length)throw Error('IMPORT_PLAN_REQUIRED');
 // Validate the complete plan before the first remote mutation.
 for(const item of plan){
  if(item.records[0]?.collection!=='htmlTrainings'||item.records[0]?.id!==item.id||
    item.records[0]?.data.status!=='DRAFT'||item.records[0]?.data.managerUid!==''||
    item.records.some(r=>!collections.includes(r.collection)))throw Error('IMPORT_WRITE_SCOPE');
 }
 const current=await store.getMany('htmlTrainings',plan.map(item=>item.id));
 current.forEach((record,index)=>{if(record&&record.initialImportSha256!==plan[index].manifestSha256)throw Error('IMPORT_EXISTING_TRAINING_CONFLICT');});
 let created=0,skipped=0,documentsWritten=0;const createdIds=new Set();
 for(const item of plan){
  const result=await store.transaction(async tx=>{
   const prior=await tx.get('htmlTrainings',item.id);
   if(prior){if(prior.initialImportSha256!==item.manifestSha256)throw Error('IMPORT_EXISTING_TRAINING_CONFLICT');return 'SKIPPED';}
   for(const collection of collections.slice(1)){
    const rows=item.records.filter(r=>r.collection===collection);
    if((await tx.getMany(collection,rows.map(r=>r.id))).some(Boolean))throw Error('IMPORT_ORPHAN_VERSION_CONFLICT');
   }
   if(apply)for(const record of item.records)tx.create(record.collection,record.id,record.data);
   return 'CREATED';
  });
  if(result==='SKIPPED')skipped++;else {created++;createdIds.add(item.id);if(apply)documentsWritten+=item.records.length;}
  await onProgress({completed:created+skipped,total:plan.length,created,skipped,documentsWritten});
 }
 // Verify committed bytes through a fresh read, not just commit acknowledgement.
 if(apply)for(const item of plan){
  const metadata=await store.get('htmlTrainings',item.id);
  if(metadata?.initialImportSha256!==item.manifestSha256)throw Error('IMPORT_READBACK_FAILED');
  // A resumed import preserves any later legitimate edit.
  if(!createdIds.has(item.id))continue;
  if(hash(metadata)!==hash(item.records[0].data))throw Error('IMPORT_READBACK_FAILED');
  for(const collection of collections.slice(1)){
   const expected=item.records.filter(r=>r.collection===collection);
   const actual=await store.getMany(collection,expected.map(r=>r.id));
   if(actual.some((record,index)=>hash(record)!==hash(expected[index].data)))throw Error('IMPORT_READBACK_FAILED');
  }
 }
 return {projectId:IMPORT_PROJECT,mode:apply?'APPLY':'DRY_RUN',trainings:plan.length,created,skipped,documentsWritten,
  participantVisibleDrafts:0,legacyWrites:0,driveWrites:0};
}

export async function verifyImportRules(token,localRules,{fetchImpl=fetch}={}){
 const headers={Authorization:'Bearer '+token};
 async function read(name){
  const response=await fetchImpl('https://firebaserules.googleapis.com/v1/'+name,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('IMPORT_RULES_HTTP_'+response.status);
  return response.json();
 }
 const release=await read(`projects/${IMPORT_PROJECT}/releases/cloud.firestore`);
 if(!release.rulesetName?.startsWith(`projects/${IMPORT_PROJECT}/rulesets/`))throw Error('IMPORT_RULES_PROJECT_INVALID');
 const ruleset=await read(release.rulesetName),files=ruleset.source?.files;
 const normalize=value=>value.replace(/\r\n/g,'\n').trim();
 if(files?.length!==1||typeof files[0].content!=='string'||normalize(files[0].content)!==normalize(localRules))throw Error('IMPORT_RULES_CHANGED_REVIEW_REQUIRED');
 return {rulesetName:release.rulesetName,rulesSha256:createHash('sha256').update(normalize(localRules)).digest('hex')};
}
