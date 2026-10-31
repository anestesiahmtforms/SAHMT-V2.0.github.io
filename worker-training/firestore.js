import {TRAINING_PROJECT} from './google-auth.js';
const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_.@+:%-]{1,512}$/.test(value)&&!['.','..'].includes(value);
function encode(value){
 if(value===null)return {nullValue:null};
 if(typeof value==='string')return {stringValue:value};
 if(typeof value==='boolean')return {booleanValue:value};
 if(typeof value==='number'&&Number.isFinite(value))return Number.isSafeInteger(value)?{integerValue:String(value)}:{doubleValue:value};
 if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return {mapValue:{fields:encodeFields(value)}};
 throw fail('TRAINING_STORE_VALUE_INVALID',400);
}
function decode(value){
 if('nullValue'in value)return null;
 if('stringValue'in value)return value.stringValue;
 if('booleanValue'in value)return value.booleanValue;
 if('integerValue'in value)return Number(value.integerValue);
 if('doubleValue'in value)return value.doubleValue;
 if('timestampValue'in value)return Date.parse(value.timestampValue);
 if('arrayValue'in value)return (value.arrayValue.values||[]).map(decode);
 if('mapValue'in value)return decodeFields(value.mapValue.fields||{});
 throw fail('TRAINING_STORE_VALUE_INVALID');
}
export const encodeFields=object=>Object.fromEntries(Object.entries(object).map(([key,value])=>[key,encode(value)]));
export const decodeFields=fields=>Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,decode(value)]));

export function createFirestoreStore({projectId=TRAINING_PROJECT,getAccessToken,fetchImpl=fetch}={}) {
 if(![TRAINING_PROJECT,'outros-48120'].includes(projectId)||typeof getAccessToken!=='function')throw fail('TRAINING_STORE_CONFIG_INVALID');
 const root=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
 const name=(collection,id)=>{if(!safe(collection)||!safe(id))throw fail('TRAINING_STORE_PATH_INVALID',400);return `projects/${projectId}/databases/(default)/documents/${collection}/${id}`;};
 async function request(path,body,method=body===undefined?'GET':'POST'){
  const token=await getAccessToken();let response;
  try{response=await fetchImpl(root+path,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw fail('TRAINING_STORE_UNAVAILABLE');}
  if(response.status===404&&method==='GET')return null;
  let data;try{data=await response.json();}catch{throw fail('TRAINING_STORE_UNAVAILABLE');}
  if(!response.ok){const error=fail(data.error?.status==='ABORTED'?'TRAINING_STORE_ABORTED':'TRAINING_STORE_UNAVAILABLE',data.error?.status==='ABORTED'?409:503);throw error;}
  return data;
 }
 async function get(collection,id,transaction){name(collection,id);const data=await request('/'+encodeURIComponent(collection)+'/'+encodeURIComponent(id)+(transaction?'?transaction='+encodeURIComponent(transaction):''));return data?decodeFields(data.fields||{}):null;}
 async function getMany(collection,ids,transaction){
  if(!Array.isArray(ids)||ids.length>1000)throw fail('TRAINING_STORE_QUERY_INVALID',400);
  if(!ids.length)return [];
  const names=ids.map(id=>name(collection,id));
  const data=await request(':batchGet',{documents:names,...(transaction?{transaction}:{})});
  if(!Array.isArray(data))throw fail('TRAINING_STORE_UNAVAILABLE');
  const records=new Map();
  for(const row of data){
   const key=row.found?.name||row.missing;
   if(!names.includes(key)||records.has(key))throw fail('TRAINING_STORE_UNAVAILABLE');
   records.set(key,row.found?decodeFields(row.found.fields||{}):null);
  }
  if(records.size!==names.length)throw fail('TRAINING_STORE_UNAVAILABLE');
  return names.map(key=>records.get(key));
 }
 async function list(collection,filters=[],limit=500){
  if(!safe(collection)||!Array.isArray(filters)||!Number.isInteger(limit)||limit<1||limit>1000)throw fail('TRAINING_STORE_QUERY_INVALID',400);
  const clauses=filters.map(f=>{if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.field)||!['EQUAL','ARRAY_CONTAINS'].includes(f.op))throw fail('TRAINING_STORE_QUERY_INVALID',400);return {fieldFilter:{field:{fieldPath:f.field},op:f.op,value:encode(f.value)}};});
  const data=await request(':runQuery',{structuredQuery:{from:[{collectionId:collection}],...(clauses.length?{where:clauses.length===1?clauses[0]:{compositeFilter:{op:'AND',filters:clauses}}}:{}),limit}});
  const documents=(data||[]).filter(x=>x.document).map(x=>({id:x.document.name.split('/').at(-1),...decodeFields(x.document.fields||{})}));
  if(documents.length===limit)throw fail('TRAINING_STORE_QUERY_TRUNCATED');
  return documents;
 }
 async function transaction(callback){
  for(let attempt=0;attempt<4;attempt++){
   const opened=await request(':beginTransaction',{options:{readWrite:{}}});if(!opened?.transaction)throw fail('TRAINING_STORE_UNAVAILABLE');
   const id=opened.transaction,writes=[];
   const set=(collection,key,value,create=false)=>{writes.push({update:{name:name(collection,key),fields:encodeFields(value)},...(create?{currentDocument:{exists:false}}:{})});};
   try{
    const result=await callback({get:(collection,key)=>get(collection,key,id),getMany:(collection,keys)=>getMany(collection,keys,id),set:(c,k,v)=>set(c,k,v),create:(c,k,v)=>set(c,k,v,true),delete:(c,k)=>writes.push({delete:name(c,k)})});
    if(writes.length){if(writes.length>450||Buffer.byteLength(JSON.stringify(writes))>9*1024*1024)throw fail('TRAINING_STORE_COMMIT_LIMIT',413);await request(':commit',{transaction:id,writes});}
    else await request(':rollback',{transaction:id});
    return result;
   }catch(error){
    await request(':rollback',{transaction:id}).catch(()=>{});
    if(error.code==='TRAINING_STORE_ABORTED'&&attempt<3)continue;
    throw error;
   }
  }
  throw fail('TRAINING_STORE_CONFLICT',409);
 }
 async function getYearEndRecord(kind,uid){
  if(projectId!=='outros-48120'||!['participation','registrations'].includes(kind)||!safe(uid))throw fail('TRAINING_STORE_PATH_INVALID',400);
  const data=await request('/yearEndSchedules/2026-2027/'+kind+'/'+encodeURIComponent(uid));
  return data?decodeFields(data.fields||{}):null;
 }
 return {get,getMany,list,transaction,getYearEndRecord};
}
