import {validateSplitSnapshot,snapshotDigest} from './management-split-plan.js';
const demand=(condition,code)=>{if(!condition)throw Error(code);};
/** Backup restoration proof in a loopback emulator only. No production endpoint,
 * credential discovery, database reset, source edit or log of document paths. */
export async function restoreTypedSnapshotInEmulator({snapshot,host=process.env.FIRESTORE_EMULATOR_HOST,
 projectId='demo-fa-restore-'+Date.now().toString(36),fetchImpl=fetch}={}){
 demand(typeof host==='string'&&/^(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(host)
  &&/^demo-[a-z0-9-]{3,24}$/.test(projectId),'CONSOLIDATION_RESTORE_EMULATOR_REQUIRED');
 validateSplitSnapshot(snapshot);demand(snapshot.documents.length<=3000,'CONSOLIDATION_RESTORE_LIMIT');
 const base='projects/'+projectId+'/databases/(default)/documents',url='http://'+host+'/v1/'+base;
 const request=async(operation,body)=>{
  let response;try{response=await fetchImpl(url+operation,{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},
   body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('CONSOLIDATION_RESTORE_EMULATOR_NETWORK');}
  demand(response.ok,'CONSOLIDATION_RESTORE_EMULATOR_HTTP_ERROR');
  try{return await response.json();}catch{throw Error('CONSOLIDATION_RESTORE_RESPONSE_INVALID');}
 };
 let verified=0;
 for(let offset=0;offset<snapshot.documents.length;offset+=20){
  const rows=snapshot.documents.slice(offset,offset+20);
  await request(':commit',{writes:rows.map(row=>({update:{name:base+'/'+row.path,fields:row.fields},currentDocument:{exists:false}}))});
  const response=await request(':batchGet',{documents:rows.map(row=>base+'/'+row.path)});
  demand(Array.isArray(response)&&response.length===rows.length,'CONSOLIDATION_RESTORE_READBACK_INCOMPLETE');
  const found=new Map(response.filter(row=>row.found).map(row=>[row.found.name,row.found.fields||{}]));
  for(const row of rows){demand(found.has(base+'/'+row.path)&&snapshotDigest(found.get(base+'/'+row.path))===snapshotDigest(row.fields),'CONSOLIDATION_RESTORE_FIELDS_MISMATCH');verified++;}
 }
 return {code:'FA_CONSOLIDATION_BACKUP_RESTORED_LOCALLY',documents:snapshot.documents.length,verified,sourceSnapshotSha256:snapshotDigest(snapshot),productionWrites:0};
}
