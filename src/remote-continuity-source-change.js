// A complete server-returned document can update an existing complete catalog.
// Missing list baselines are never invented from one changed item.
export function continuitySourceChanges(resources,{path,data,deleted=false,verifiedAt}){
 const [collection,id,...rest]=String(path||'').split('/');if(rest.length||!id)return [];
 const result=[];
 const emit=(prior,kind,key,value)=>result.push({schemaVersion:1,kind,id:key,data:value,verifiedAt,revision:'change:'+verifiedAt,complete:true});
 if(collection==='scheduleDays'&&!deleted){const old=resources.find(row=>row.kind==='scheduleDays'&&row.id===id)?.data;if(old&&(Number(old.version||0)>Number(data.version||0)||Date.parse(old.updatedAt)>Date.parse(data.updatedAt)))return [];emit(null,'scheduleDays',id,{...data,id});return result;}
 for(const prior of resources){
  let value;
  if(collection==='stations'&&prior.kind==='stations'||collection==='contacts'&&prior.kind==='contacts'||collection==='eventMembers'&&prior.kind==='eventMembers'){
   const old=prior.data?.find(row=>row.id===id);
   if(!deleted&&old&&(Number(old.version||0)>Number(data.version||0)||Date.parse(old.updatedAt)>Date.parse(data.updatedAt)))continue;
   value=(prior.data||[]).filter(row=>row.id!==id);
   if(!deleted&&(collection!=='contacts'||data.active===true))value.push({...data,id});
  }else if(collection==='vacations'&&prior.kind==='vacations'){
   value=(prior.data||[]).filter(row=>row.id!==id);
   if(!deleted&&data.active===true&&data.start<=prior.id&&data.end>=prior.id)value.push({...data,id});
  }else if(collection==='appConfig'&&id==='app'&&prior.kind==='appConfig'&&!deleted)value={features:data.features};
  else if(collection==='appConfig'&&id==='labelStaff'&&prior.kind==='labelStaff'&&!deleted)value=data.active===true?data.siglas||[]:[];
  else if(collection==='eventCatalogs'&&id==='operational'&&prior.kind==='eventCatalogs'&&!deleted)value=data;
  else if(['events','labels','checklists'].includes(collection)&&prior.kind===collection){
   const old=prior.data.records?.find(row=>row.id===id),day=data?.date||old?.date;
   if(!deleted&&old&&(Number(old.version||0)>Number(data.version||0)||Date.parse(old.updatedAt)>Date.parse(data.updatedAt)))continue;
   if(!day||(prior.id.length===7?day.slice(0,7)!==prior.id:day!==prior.id))continue;
   value={...prior.data,records:(prior.data.records||[]).filter(row=>row.id!==id)};if(!deleted)value.records.push({...data,id});
  }else continue;
  emit(prior,prior.kind,prior.id,value);
 }
 return result;
}
