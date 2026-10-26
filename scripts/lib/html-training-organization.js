import {createHash,randomUUID} from 'node:crypto';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function planTrainingOrganization(records,mapping){
 const folders=new Map();
 for(const row of mapping){
  if(!row.folderId||folders.has(row.folderId)||!['Protocolos','Documentos administrativos'].includes(row.category)||
   !(row.category==='Protocolos'?['Protocolos do SAHMT','Protocolos da Instituição']:['Acesso restrito','Acesso geral']).includes(row.subcategory))throw Error('ORGANIZATION_MAPPING_INVALID');
  folders.set(row.folderId,row);
 }
 const used=new Set(),plan=[];
 for(const record of records){
  if(!['Protocolos','Documentos administrativos'].includes(record.category))continue;
  const folder=folders.get(record.source?.folderId);
  if(!folder||folder.category!==record.category)throw Error('ORGANIZATION_SOURCE_UNMAPPED');
  used.add(folder.folderId);
  if(record.subcategory===folder.subcategory)continue;
  plan.push({trainingId:record.id,subcategory:folder.subcategory,expected:fingerprint(record)});
 }
 if(used.size!==folders.size)throw Error('ORGANIZATION_MAPPING_INCOMPLETE');
 return plan;
}
export async function applyTrainingOrganization(store,plan,{uid,now=Date.now()}={}){
 if(!uid)throw Error('ORGANIZATION_ACTOR_REQUIRED');
 const results=[];
 for(const item of plan){
  const historyId=randomUUID();
  await store.transaction(async tx=>{
   const profile=await tx.get('users',uid);
   if(profile?.active!==true||profile.access!==true||!(profile.role==='administrador_app'||profile.permissions?.admin===true))throw Error('ORGANIZATION_ADMIN_REQUIRED');
   const training=await tx.get('htmlTrainings',item.trainingId);
   if(!training||fingerprint(training)!==item.expected)throw Error('ORGANIZATION_VERSION_CONFLICT');
   tx.create('htmlTrainingOrganizationHistory',historyId,{id:historyId,trainingId:item.trainingId,previousSubcategory:training.subcategory||'',subcategory:item.subcategory,
    audienceGroup:training.audienceGroup,trainingVersion:training.version,updatedAt:now,updatedByUid:uid,source:'OFFICIAL_DRIVE_FOLDER_STRUCTURE'});
   tx.set('htmlTrainings',item.trainingId,{...training,subcategory:item.subcategory,organizationUpdatedAt:now,organizationUpdatedByUid:uid});
  });
  results.push(item.trainingId);
 }
 return {organized:results.length,trainingIds:results,contentWrites:0,scoreWrites:0,attemptWrites:0,permissionChanges:0};
}
