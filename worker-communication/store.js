import {encodeFields,decodeFields} from '../worker-training/firestore.js';
import {FF,fail,id,SOURCE_COLLECTIONS} from '../communication/domain.js';
import {boundedJson} from './google.js';
export {encodeFields,decodeFields};
export function createStore({getToken,fetchImpl=fetch,source=null}){
 if(source&&!Object.hasOwn(SOURCE_COLLECTIONS,source))throw fail('COMM_CONFIG_REQUIRED',503);
 const project=source?{FA:'sahmt-17a16',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt',FD:'rotinas-8a617',FE:'outros-48120',FF:FF.projectId}[source]:FF.projectId;
 const name=`projects/${project}/databases/${source?'(default)':FF.databaseId}/documents`,root='https://firestore.googleapis.com/v1/'+name;
 const checkCollection=c=>{id(c);if(source&&![...(SOURCE_COLLECTIONS[source]||[]),...(source==='FA'?['users','notificationGroups']:source==='FB'?['users','userCategories','managementAreas']:[])].includes(c))throw fail('COMM_SOURCE_DENIED',403);};
 async function request(path,body){
  const r=await fetchImpl(root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(r.status===404&&!body){await r.body?.cancel();return null;}
  const d=await boundedJson(r);if(!r.ok)throw fail(r.status===429?'COMM_FREE_QUOTA_EXHAUSTED':r.status===409||d.error?.status==='ABORTED'?'COMM_CONFLICT':'COMM_STORE_UNAVAILABLE',r.status===429?429:r.status===409||d.error?.status==='ABORTED'?409:503);return d;
 }
 const path=(c,k)=>{checkCollection(c);id(k);return c+'/'+k;};
 async function get(c,k,transaction,fields){const q=new URLSearchParams();if(transaction)q.set('transaction',transaction);for(const field of fields||[])q.append('mask.fieldPaths',id(field));const d=await request('/'+path(c,k)+(q.size?'?'+q:''));return d?{...decodeFields(d.fields||{}),id:k}:null;}
 async function page(c,{cursor='',limit=20,filters=[],fields}={}){
  checkCollection(c);if(cursor)id(cursor);if(!Number.isInteger(limit)||limit<1||limit>21)throw fail('COMM_INVALID_INPUT');
  const clauses=filters.map(([field,value])=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:encodeFields({v:value}).v}}));
  const q={from:[{collectionId:c}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit,...(fields?{select:{fields:fields.map(fieldPath=>({fieldPath}))}}:{}),...(cursor?{startAt:{values:[{referenceValue:name+'/'+c+'/'+cursor}],before:false}}:{}),...(clauses.length?{where:clauses.length===1?clauses[0]:{compositeFilter:{op:'AND',filters:clauses}}}:{})};
  const d=await request(':runQuery',{structuredQuery:q});return d.filter(x=>x.document).map(({document:d})=>({...decodeFields(d.fields||{}),id:d.name.split('/').at(-1)}));
 }
 async function transaction(work){
  if(source)throw fail('COMM_SOURCE_READ_ONLY',403);
  const {transaction:t}=await request(':beginTransaction',{options:{readWrite:{}}}),writes=[];if(!t)throw fail('COMM_STORE_UNAVAILABLE',503);
  const tx={get:(c,k)=>get(c,k,t),set:(c,k,v)=>writes.push({update:{name:name+'/'+path(c,k),fields:encodeFields(v)}}),create:(c,k,v)=>writes.push({update:{name:name+'/'+path(c,k),fields:encodeFields(v)},currentDocument:{exists:false}})};
  try{const result=await work(tx);if(writes.length>40)throw fail('COMM_FREE_QUOTA_EXHAUSTED',429);await request(writes.length?':commit':':rollback',writes.length?{transaction:t,writes}:{transaction:t});return result;}
  catch(e){await request(':rollback',{transaction:t}).catch(()=>{});throw e;}
 }
 async function getMany(c,keys){
  if(!Array.isArray(keys)||keys.length>100)throw fail('COMM_INVALID_INPUT');
  if(!keys.length)return [];
  const names=keys.map(k=>name+'/'+path(c,k)),rows=await request(':batchGet',{documents:names}),map=new Map();
  for(const r of rows){if(r.found)map.set(r.found.name,decodeFields(r.found.fields||{}));else if(r.missing)map.set(r.missing,null);}
  if(names.some(n=>!map.has(n)))throw fail('COMM_STORE_UNAVAILABLE',503);
  return names.map((n,i)=>map.get(n)?{...map.get(n),id:keys[i]}:null);
 }
 return {get,getMany,page,transaction};
}
