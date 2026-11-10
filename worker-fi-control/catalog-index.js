export const catalogCollections=['documents','scopedDocuments','trainings','learningActivities'];
export const catalogIndexId='fb-catalogue';

export async function refreshFiCatalogue({source,target,verifyPolicy=async()=>{},now=Date.now}){
 const updatedAt=now();
 const sections=Object.fromEntries(await Promise.all(catalogCollections.map(async collection=>{
  const rows=await source.list(collection,[],301);
  return [collection,rows.filter(row=>row.deleted!==true&&row.trashed!==true).map(row=>({
   id:row.id,title:String(row.title||''),text:[row.description,row.category].filter(v=>typeof v==='string').join(' · ').slice(0,5000)
  }))];
 })));
 const entry={schemaVersion:1,sections,updatedAt};
 if(new TextEncoder().encode(JSON.stringify(entry)).length>650000)throw Error('FI_CATALOGUE_TOO_LARGE');
 await target.transaction(async tx=>{
  const prior=await tx.get('fiSearchRecords',catalogIndexId);
  await verifyPolicy();
  if((prior?.updatedAt||0)<=entry.updatedAt)tx.set('fiSearchRecords',catalogIndexId,entry);
 });
 return Object.fromEntries(catalogCollections.map(collection=>[collection,sections[collection].length]));
}
