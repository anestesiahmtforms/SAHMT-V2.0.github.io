import {encodeFields,decodeFields} from '../worker-training/firestore.js';
import {boundedJson} from '../worker-operational-domain/identity.js';
export const FI_PROJECTS=Object.freeze({FA:'sahmt-17a16',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt',FD:'rotinas-8a617',FE:'outros-48120',FF:'sahmt-comunicacao-ff',FG:'sahmt-checklist-fg',FH:'sahmt-etiquetas-fh',FI:'sahmt-operacional-fi',FJ:'sahmt-escala-fj'});
export const FI_COLLECTIONS=Object.freeze(['users','contacts','eventMembers','memberCategoryAssignments','appConfig','fiAdminUsers','fiAdminIdentityLinks','fiAdminOutbox','fiAdminAudit','fiAdminUpdateRequests','fiAiBudget','fiAiQuota','fiAiReservations','fiAiRuns','fiSearchRecords','fiControlConfig','fiControlMigrations','fiTechnicalMetrics','fiSourceBudgets','fiControlQuotas']);
export const fiError=(code,status=503)=>Object.assign(Error(code),{code,status});
const segment=v=>typeof v==='string'&&v.length>0&&v.length<=180&&!/[\/\s\x00-\x1f]/.test(v)&&v!=='.'&&v!=='..';
export function createFiStore({projectId,getAccessToken,allowedCollections=FI_COLLECTIONS,readOnly=false,readBudget,fetchImpl=fetch}={}){
 if(!Object.values(FI_PROJECTS).includes(projectId)||typeof getAccessToken!=='function'||!Array.isArray(allowedCollections))throw fiError('FI_STORE_CONFIG_INVALID');
 const database=projectId===FI_PROJECTS.FF?'comunicacao':'(default)';
 const prefix=`projects/${projectId}/databases/${database}/documents`,root='https://firestore.googleapis.com/v1/'+prefix;
 const wireRecords=new Map();
 function encodeWrite(value,previous={},key=''){
  if(projectId!==FI_PROJECTS.FI&&Number.isFinite(value)&&(previous.timestampValue!==undefined||previous.integerValue===undefined&&previous.doubleValue===undefined&&['createdAt','updatedAt','requestedAt','resolvedAt'].includes(key)))return {timestampValue:new Date(value).toISOString()};
  if(Array.isArray(value))return {arrayValue:{values:value.map((v,i)=>encodeWrite(v,previous.arrayValue?.values?.[i]||{},''))}};
  if(value&&typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeWrite(v,previous.mapValue?.fields?.[k]||{},k)]))}};
  return encodeFields({v:value}).v;
 }
 const validCollection=c=>typeof c==='string'&&(allowedCollections.includes(c)||(allowedCollections.includes('users')&&/^users\/[^/\s]{1,128}\/appInstallations$/.test(c))||(projectId===FI_PROJECTS.FC&&allowedCollections.includes('qmentumUnits')&&/^qmentumUnits\/[A-Za-z0-9_-]{1,80}\/months$/.test(c)));
 const name=(c,id)=>{if(!validCollection(c)||!segment(id))throw fiError('FI_STORE_PATH_DENIED',400);return `${prefix}/${c}/${id}`;};
 async function call(suffix,body){
  let response;try{response=await fetchImpl(root+suffix,{method:'POST',headers:{Authorization:'Bearer '+await getAccessToken(),'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw fiError('FI_STORE_UNAVAILABLE');}
  const result=await boundedJson(response,3*1024*1024);
  if(!response.ok)throw fiError([409,412].includes(response.status)||result.error?.status==='ABORTED'?'FI_STORE_CONFLICT':'FI_STORE_UNAVAILABLE',[409,412].includes(response.status)||result.error?.status==='ABORTED'?409:503);
  return result;
 }
 async function getMany(keys,transaction){
  if(!Array.isArray(keys)||keys.length>450)throw fiError('FI_STORE_QUERY_INVALID',400);
  if(!keys.length)return [];
  const documents=keys.map(([c,id])=>name(c,id)),expected=new Set(documents);
  if(readBudget)readBudget.reserve(projectId,expected.size);
  const rows=await call(':batchGet',{documents:[...expected],...(transaction?{transaction}:{})});
  if(!Array.isArray(rows)||rows.length!==expected.size)throw fiError('FI_STORE_RESPONSE_INVALID');
  const records=new Map();
  for(const row of rows){
   const path=row.found?.name||row.missing;
   if(!expected.has(path)||records.has(path))throw fiError('FI_STORE_RESPONSE_INVALID');
   if(transaction&&row.found)wireRecords.set(`${transaction}:${path}`,row.found.fields||{});
   records.set(path,row.found?decodeFields(row.found.fields||{}):null);
  }
  return documents.map(path=>records.get(path));
 }
 async function get(c,id,transaction){return (await getMany([[c,id]],transaction))[0];}
 async function list(c,filters=[],limit=1000){
  if(!validCollection(c)||!Array.isArray(filters)||filters.length>10||!Number.isInteger(limit)||limit<1||limit>2001)throw fiError('FI_STORE_QUERY_INVALID',400);
  const pieces=c.split('/'),collectionId=pieces.pop(),parent=pieces.length?'/'+pieces.map(encodeURIComponent).join('/'):'';
  const clauses=filters.map(f=>{if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.field)||!['EQUAL','ARRAY_CONTAINS'].includes(f.op))throw fiError('FI_STORE_QUERY_INVALID',400);return {fieldFilter:{field:{fieldPath:f.field},op:f.op,value:encodeFields({v:f.value}).v}};});
  const ticket=readBudget?await readBudget.reserve(projectId,limit):null;
  const rows=await call(parent+':runQuery',{structuredQuery:{from:[{collectionId}],...(clauses.length?{where:clauses.length===1?clauses[0]:{compositeFilter:{op:'AND',filters:clauses}}}:{}),limit}});
  if(!Array.isArray(rows))throw fiError('FI_STORE_RESPONSE_INVALID');
  const records=rows.filter(r=>r.document).map(r=>{const id=r.document.name?.split('/').at(-1);if(r.document.name!==name(c,id))throw fiError('FI_STORE_RESPONSE_INVALID');return {...decodeFields(r.document.fields||{}),id};});
  if(ticket)await readBudget.settle(ticket,records.length);
  if(records.length>=limit)throw fiError('FI_STORE_QUERY_LIMIT',409);return records;
 }
 async function transaction(fn){
  if(readOnly)throw fiError('FI_STORE_READ_ONLY',403);
  for(let attempt=0;attempt<4;attempt++){
   const opened=await call(':beginTransaction',{options:{readWrite:{}}}),id=opened.transaction;if(typeof id!=='string'||!id)throw fiError('FI_STORE_RESPONSE_INVALID');
   const writes=[];let committed=false;
   const set=(c,key,value,create)=>{const path=name(c,key),old=wireRecords.get(`${id}:${path}`)||{};writes.push({update:{name:path,fields:encodeWrite(value,{mapValue:{fields:old}}).mapValue.fields},...(create?{currentDocument:{exists:false}}:{})});};
   try{
    const read=keys=>{if(writes.length)throw fiError('FI_STORE_READ_AFTER_WRITE',400);return getMany(keys,id);};
    const result=await fn({get:async(c,key)=>(await read([[c,key]]))[0],getMany:read,set:(c,key,v)=>set(c,key,v,false),create:(c,key,v)=>set(c,key,v,true),delete:(c,key)=>writes.push({delete:name(c,key)})});
    if(writes.length>450||new TextEncoder().encode(JSON.stringify(writes)).length>8*1024*1024)throw fiError('FI_STORE_WRITE_LIMIT',413);
    if(writes.length){await call(':commit',{transaction:id,writes});committed=true;}return result;
   }catch(error){if(error.code!=='FI_STORE_CONFLICT'||attempt===3)throw error;}
   finally{if(!committed)await call(':rollback',{transaction:id}).catch(()=>{});}
  }
  throw fiError('FI_STORE_CONFLICT',409);
 }
 return Object.freeze({get,getMany,list,transaction});
}
