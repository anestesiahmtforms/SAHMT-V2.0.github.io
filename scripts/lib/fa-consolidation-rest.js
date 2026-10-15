import {FA_PROJECT,FB_PROJECT,FC_PROJECT,FC_CONSOLIDATION_COLLECTIONS,FA_CONSOLIDATION_COLLECTIONS} from './fa-consolidation-plan.js';
import {snapshotDigest} from './management-split-plan.js';
const demand=(condition,code)=>{if(!condition)throw Error(code);};
export function createFaConsolidationRestAdapter({plan,getSourceAccessToken,getDestinationAccessToken,fetchImpl,assertBarrier}={}){
 demand(plan?.ready===true&&[FB_PROJECT,FC_PROJECT].includes(plan.sourceProjectId)&&plan.destinationProjectId===FA_PROJECT
  &&Array.isArray(plan.operations)&&[getSourceAccessToken,getDestinationAccessToken,fetchImpl,assertBarrier].every(x=>typeof x==='function'),'CONSOLIDATION_REST_CONFIG_INVALID');
 const operations=new Map(plan.operations.map(row=>[row.path,structuredClone(row)]));
 demand(operations.size===plan.operations.length&&[...operations.keys()].every(path=>{
   const parts=path.split('/');return parts.length%2===0&&parts.length>=2&&(plan.sourceProjectId===FC_PROJECT?FC_CONSOLIDATION_COLLECTIONS:FA_CONSOLIDATION_COLLECTIONS).includes(parts[0])
   &&parts.every(x=>x&&!['.','..'].includes(x)&&!/[\\\x00-\x1f]/.test(x));
 }),'CONSOLIDATION_REST_SCOPE_INVALID');
 const name=(project,path)=>'projects/'+project+'/databases/(default)/documents'+(path?(path.startsWith(':')?'':'/')+path:'');
 const call=async(project,path,body)=>{
  let token;try{token=await(project===FA_PROJECT?getDestinationAccessToken():getSourceAccessToken());}catch{throw Error('CONSOLIDATION_REST_IDENTITY_UNAVAILABLE');}
  demand(typeof token==='string'&&token.length>0,'CONSOLIDATION_REST_IDENTITY_UNAVAILABLE');
  let response;try{response=await fetchImpl('https://firestore.googleapis.com/v1/'+name(project,path),{
   method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw Error('CONSOLIDATION_REST_NETWORK');}
  if(!response.ok){if(response.status===404&&!body)return null;throw Error('CONSOLIDATION_REST_HTTP_'+(Number.isInteger(response.status)?response.status:0));}
  try{const text=await response.text();demand(Buffer.byteLength(text)<=2*1024*1024,'CONSOLIDATION_REST_RESPONSE_LIMIT');return JSON.parse(text);}
  catch{throw Error('CONSOLIDATION_REST_RESPONSE_INVALID');}
 };
 const read=async(project,path)=>{
  demand(operations.has(path),'CONSOLIDATION_REST_PATH_FORBIDDEN');
  const document=await call(project,path.split('/').map(encodeURIComponent).join('/'));
  if(!document)return null;
  demand(document.name===name(project,path)&&typeof document.updateTime==='string','CONSOLIDATION_REST_DOCUMENT_INVALID');
  return {path,fields:document.fields||{},createTime:document.createTime,updateTime:document.updateTime};
 };
 return Object.freeze({assertBarrier,readSource:path=>read(plan.sourceProjectId,path),readDestination:path=>read(FA_PROJECT,path),async commit(write){
  const operation=operations.get(write?.path);
  demand(write?.projectId===FA_PROJECT&&write.databaseId==='(default)'&&operation&&['CREATE','UPDATE'].includes(operation.action)
   &&snapshotDigest(write.fields)===snapshotDigest(operation.fields)&&snapshotDigest(write.precondition)===snapshotDigest(operation.precondition),'CONSOLIDATION_REST_WRITE_FORBIDDEN');
  // Fixed FA endpoint; caller-supplied paths and arbitrary Firestore writes are
  // never forwarded. No transform recalculates points or timestamps here.
  const data=await call(FA_PROJECT,':commit',{writes:[{update:{name:name(FA_PROJECT,write.path),fields:operation.fields},currentDocument:operation.precondition}]});
  demand(Array.isArray(data?.writeResults)&&data.writeResults.length===1&&typeof data.writeResults[0].updateTime==='string','CONSOLIDATION_REST_COMMIT_INVALID');
 }});
}
