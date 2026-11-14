import {assertFolderReadable} from '../server/folder-read-policy.js';
import {encodeFields,decodeFields} from '../worker-training/firestore.js';
import {FF,fail,id} from '../communication/domain.js';
import {boundedJson} from './google.js';
export {encodeFields,decodeFields};
export function createStore({getToken,fetchImpl=fetch,source=null,administrator=false}){
 if(source&&!['FA','FJ'].includes(source))throw fail('COMM_CONFIG_REQUIRED',503);
 const project=source==='FA'?'sahmt-17a16':source==='FJ'?'sahmt-escala-fj':FF.projectId;
 const name=`projects/${project}/databases/${source?'(default)':FF.databaseId}/documents`,root='https://firestore.googleapis.com/v1/'+name;
 const checkCollection=c=>{id(c);if(source&&!(source==='FJ'?['scheduleDays']:['users','scheduleDays']).includes(c))throw fail('COMM_SOURCE_DENIED',403);};
 async function assertAvailable(collection){
  if(administrator)return;
  if(source&&collection!=='scheduleDays')return;
  try{
   const r=await fetchImpl(root+'/runtimePolicy/folders',{method:'GET',headers:{Authorization:'Bearer '+await getToken()},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(r.status===404){await r.body?.cancel();return;}
   if(!r.ok)throw Error('POLICY_UNAVAILABLE');
   const policy=decodeFields((await boundedJson(r)).fields||{});
   for(const folder of source?['operacao/escala','operacao/eventos','operacao/escala/ferias']:['comunicacao'])assertFolderReadable(policy,folder);
  }catch(error){if(error.code==='COMM_OPERATION_WORK_LIMIT')throw error;throw fail(error.code==='FOLDER_DISABLED'?'COMM_FOLDER_DISABLED':'COMM_FOLDER_POLICY_UNAVAILABLE',error.code==='FOLDER_DISABLED'?403:503);}
 }
 async function request(path,body){
  if(!source&&(!body||[':runQuery',':batchGet',':runAggregationQuery'].includes(path)))await assertAvailable();
  else if(path.includes('/scheduleDays/'))await assertAvailable('scheduleDays');
  const r=await fetchImpl(root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(r.status===404&&!body){await r.body?.cancel();return null;}
  const d=await boundedJson(r);if(!r.ok)throw fail(r.status===429?'COMM_PROVIDER_QUOTA_EXHAUSTED':r.status===409||d.error?.status==='ABORTED'?'COMM_CONFLICT':'COMM_STORE_UNAVAILABLE',r.status===429?429:r.status===409||d.error?.status==='ABORTED'?409:503);return d;
 }
 const path=(c,k)=>{checkCollection(c);id(k);return c+'/'+k;};
 async function get(c,k,transaction,fields){const q=new URLSearchParams();if(transaction)q.set('transaction',transaction);for(const field of fields||[])q.append('mask.fieldPaths',id(field));const d=await request('/'+path(c,k)+(q.size?'?'+q:''));return d?{...decodeFields(d.fields||{}),id:k}:null;}
 async function page(c,{cursor='',limit=20,filters=[],fields,publishedBefore}={}){
  if(source)throw fail('COMM_SOURCE_DENIED',403);
  checkCollection(c);if(!Number.isInteger(limit)||limit<1||limit>21)throw fail('COMM_INVALID_INPUT');
  if(publishedBefore!==undefined){
   if(c!=='communicationMessages'||!Number.isSafeInteger(publishedBefore))throw fail('COMM_INVALID_INPUT');
   const cursorMatch=cursor&&/^(\d{1,16})\|(.+)$/.exec(cursor);
   if(cursor&&(!cursorMatch||!Number.isSafeInteger(Number(cursorMatch[1]))))throw fail('COMM_INVALID_INPUT');
   const query={
    from:[{collectionId:c}],limit,
    where:{compositeFilter:{op:'AND',filters:[
     {fieldFilter:{field:{fieldPath:'status'},op:'EQUAL',value:{stringValue:'published'}}},
     {fieldFilter:{field:{fieldPath:'publishAt'},op:'LESS_THAN_OR_EQUAL',value:{integerValue:String(publishedBefore)}}},
    ]}},
    orderBy:[{field:{fieldPath:'publishAt'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],
    ...(cursorMatch?{startAt:{values:[{integerValue:cursorMatch[1]},{referenceValue:name+'/'+c+'/'+id(cursorMatch[2])}],before:false}}:{}),
   };
   const rows=await request(':runQuery',{structuredQuery:query});
   return rows.filter(row=>row.document).map(({document})=>({...decodeFields(document.fields||{}),id:document.name.split('/').at(-1)}));
  }
  if(cursor)id(cursor);
  const clauses=filters.map(([field,value])=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:encodeFields({v:value}).v}}));
  const q={from:[{collectionId:c}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit,...(fields?{select:{fields:fields.map(fieldPath=>({fieldPath}))}}:{}),...(cursor?{startAt:{values:[{referenceValue:name+'/'+c+'/'+cursor}],before:false}}:{}),...(clauses.length?{where:clauses.length===1?clauses[0]:{compositeFilter:{op:'AND',filters:clauses}}}:{})};
  const d=await request(':runQuery',{structuredQuery:q});return d.filter(x=>x.document).map(({document:d})=>({...decodeFields(d.fields||{}),id:d.name.split('/').at(-1)}));
 }
 async function listUserAppInstallations(uid,{limit=100}={}){
  if(source||!Number.isInteger(limit)||limit<1||limit>100)throw fail('COMM_SOURCE_DENIED',403);
  id(uid);
  const d=await request('/users/'+encodeURIComponent(uid)+'/appInstallations?pageSize='+limit);
  return (d?.documents||[]).map(document=>({...decodeFields(document.fields||{}),id:document.name.split('/').at(-1)}));
 }
 async function transaction(work){
  if(source)throw fail('COMM_SOURCE_READ_ONLY',403);
  await assertAvailable();
  const {transaction:t}=await request(':beginTransaction',{options:{readWrite:{}}}),writes=[];if(!t)throw fail('COMM_STORE_UNAVAILABLE',503);
  const tx={get:(c,k)=>get(c,k,t),countPublished:(start,end)=>countPublished(start,end,t),set:(c,k,v)=>writes.push({update:{name:name+'/'+path(c,k),fields:encodeFields(v)}}),create:(c,k,v)=>writes.push({update:{name:name+'/'+path(c,k),fields:encodeFields(v)},currentDocument:{exists:false}})};
  try{const result=await work(tx);if(writes.length>40)throw fail('COMM_OPERATION_WORK_LIMIT',429);await request(writes.length?':commit':':rollback',writes.length?{transaction:t,writes}:{transaction:t});return result;}
  catch(e){await request(':rollback',{transaction:t}).catch(()=>{});throw e;}
 }
 async function countPublished(start,end,transaction){
  if(source)throw fail('COMM_SOURCE_READ_ONLY',403);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start)throw fail('COMM_INVALID_INPUT');
  const filters=[['GREATER_THAN_OR_EQUAL',start],['LESS_THAN',end]].map(([op,value])=>({fieldFilter:{field:{fieldPath:'firstPublishedAt'},op,value:encodeFields({v:value}).v}}));
  const result=await request(':runAggregationQuery',{structuredAggregationQuery:{structuredQuery:{from:[{collectionId:'communicationMessages'}],where:{compositeFilter:{op:'AND',filters}}},aggregations:[{alias:'published',count:{}}]},...(transaction?{transaction}:{})});
  const rows=Array.isArray(result)?result:[result],value=rows.find(row=>row.result?.aggregateFields?.published)?.result.aggregateFields.published;
  const count=Number(value?.integerValue);if(!Number.isSafeInteger(count)||count<0)throw fail('COMM_STORE_UNAVAILABLE',503);return count;
 }
 async function getMany(c,keys){
  if(source)throw fail('COMM_SOURCE_DENIED',403);
  if(!Array.isArray(keys)||keys.length>100)throw fail('COMM_INVALID_INPUT');
  if(!keys.length)return [];
  const names=keys.map(k=>name+'/'+path(c,k)),rows=await request(':batchGet',{documents:names}),map=new Map();
  for(const r of rows){if(r.found)map.set(r.found.name,decodeFields(r.found.fields||{}));else if(r.missing)map.set(r.missing,null);}
  if(names.some(n=>!map.has(n)))throw fail('COMM_STORE_UNAVAILABLE',503);
  return names.map((n,i)=>map.get(n)?{...map.get(n),id:keys[i]}:null);
 }
 return {get,getMany,page,listUserAppInstallations,transaction,countPublished,assertAvailable};
}
