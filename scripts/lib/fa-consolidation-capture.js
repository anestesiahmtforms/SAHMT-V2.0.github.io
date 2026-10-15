import {FA_CONSOLIDATION_COLLECTIONS,FA_PROJECT,FB_PROJECT,FC_PROJECT,FC_CONSOLIDATION_COLLECTIONS} from './fa-consolidation-plan.js';
import {validateSplitSnapshot} from './management-split-plan.js';
const demand=(condition,code)=>{if(!condition)throw Error(code);};
const identifier=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=1500&&!/[\/\\\x00-\x1f]/.test(value)&&!['.','..'].includes(value);

/** Bounded administrative read only. Both HTTP forms below are list methods;
 * there is no generic request method and no create/update/delete/commit path.
 * A single readTime is carried through every page and subcollection. */
export function captureFaConsolidationSnapshot(options){return captureScoped(options,[FA_PROJECT,FB_PROJECT],FA_CONSOLIDATION_COLLECTIONS);}
export function captureFcConsolidationSnapshot(options){return captureScoped(options,[FA_PROJECT,FC_PROJECT],FC_CONSOLIDATION_COLLECTIONS);}
async function captureScoped({projectId,scope,readTime,accessToken,fetchImpl,
 maxDocuments=3000,maxRequests=6000,maxBytes=64*1024*1024,includeRootInventory=false}={},projects,collectionsAllowed){
 demand(projects.includes(projectId)&&Array.isArray(scope)&&scope.length>0
  &&new Set(scope).size===scope.length&&scope.every(x=>collectionsAllowed.includes(x)),'CONSOLIDATION_CAPTURE_SCOPE_INVALID');
 demand(typeof accessToken==='string'&&accessToken.length>0&&typeof fetchImpl==='function'
  &&Number.isFinite(Date.parse(readTime))&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(readTime),'CONSOLIDATION_CAPTURE_CONFIG_INVALID');
 demand([maxDocuments,maxRequests,maxBytes].every(x=>Number.isSafeInteger(x)&&x>0)
  &&maxDocuments<=10000&&maxRequests<=25000&&maxBytes<=128*1024*1024,'CONSOLIDATION_CAPTURE_LIMIT_INVALID');
 const base='projects/'+projectId+'/databases/(default)/documents',documents=[],seen=new Set();
 let requests=0,bytes=0,missingParents=0;
 const request=async(path,body)=>{
  demand(++requests<=maxRequests,'CONSOLIDATION_CAPTURE_REQUEST_LIMIT');
  let response;
  try{response=await fetchImpl('https://firestore.googleapis.com/v1/'+path,{method:body?'POST':'GET',
   headers:{Authorization:'Bearer '+accessToken,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw Error('CONSOLIDATION_READ_NETWORK');}
  if(!response.ok)throw Error('CONSOLIDATION_READ_HTTP_'+(Number.isInteger(response.status)?response.status:0));
  let text,data;try{text=await response.text();demand(Buffer.byteLength(text)<=8*1024*1024,'CONSOLIDATION_CAPTURE_RESPONSE_LIMIT');data=JSON.parse(text);}
  catch(error){if(error?.message==='CONSOLIDATION_CAPTURE_RESPONSE_LIMIT')throw error;throw Error('CONSOLIDATION_READ_RESPONSE_INVALID');}
  demand(data&&typeof data==='object'&&!Array.isArray(data),'CONSOLIDATION_READ_RESPONSE_INVALID');
  return data;
 };
 const encodePath=path=>path.split('/').map(encodeURIComponent).join('/');
 const collections=async parent=>{
  const ids=[],tokens=new Set();let pageToken;
  do{
   const data=await request(encodePath(base+(parent?'/'+parent:''))+':listCollectionIds',{pageSize:100,readTime,...(pageToken?{pageToken}:{})});
   demand(data.collectionIds===undefined||Array.isArray(data.collectionIds),'CONSOLIDATION_READ_RESPONSE_INVALID');
   for(const id of data.collectionIds||[]){demand(identifier(id)&&!ids.includes(id),'CONSOLIDATION_CAPTURE_COLLECTION_INVALID');ids.push(id);}
   demand(data.nextPageToken===undefined||typeof data.nextPageToken==='string','CONSOLIDATION_CAPTURE_PAGINATION_INVALID');
   pageToken=data.nextPageToken||'';demand(!pageToken||!tokens.has(pageToken),'CONSOLIDATION_CAPTURE_PAGINATION_REPEATED');if(pageToken)tokens.add(pageToken);
  }while(pageToken);
  return ids.sort();
 };
 const visit=async(collectionPath,depth)=>{
  demand(depth<=100,'CONSOLIDATION_CAPTURE_DEPTH_LIMIT');
  let pageToken;const tokens=new Set();
  do{
   const query=new URLSearchParams({pageSize:'100',showMissing:'true',readTime,...(pageToken?{pageToken}:{})});
   const data=await request(encodePath(base+'/'+collectionPath)+'?'+query);
   demand(data.documents===undefined||Array.isArray(data.documents),'CONSOLIDATION_READ_RESPONSE_INVALID');
   for(const row of data.documents||[]){
    const expected=base+'/'+collectionPath+'/';
    demand(row&&typeof row.name==='string'&&row.name.startsWith(expected)&&identifier(row.name.slice(expected.length))
     &&!seen.has(row.name),'CONSOLIDATION_CAPTURE_DOCUMENT_INVALID');seen.add(row.name);
    const path=row.name.slice(base.length+1);
    if(row.createTime===undefined&&row.updateTime===undefined&&row.fields===undefined)missingParents++;
    else{
     const document={path,fields:row.fields||{},createTime:row.createTime,updateTime:row.updateTime};
     bytes+=Buffer.byteLength(JSON.stringify(document));documents.push(document);
     demand(documents.length<=maxDocuments&&bytes<=maxBytes,'CONSOLIDATION_CAPTURE_DOCUMENT_LIMIT');
    }
    for(const collectionId of await collections(path))await visit(path+'/'+collectionId,depth+1);
   }
   demand(data.nextPageToken===undefined||typeof data.nextPageToken==='string','CONSOLIDATION_CAPTURE_PAGINATION_INVALID');
   pageToken=data.nextPageToken||'';demand(!pageToken||!tokens.has(pageToken),'CONSOLIDATION_CAPTURE_PAGINATION_REPEATED');if(pageToken)tokens.add(pageToken);
  }while(pageToken);
 };
 const rootInventory=includeRootInventory?{complete:true,collections:await collections('')}:null;
 for(const collectionId of [...scope].sort())await visit(collectionId,1);
 documents.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const snapshot={schemaVersion:1,projectId,databaseId:'(default)',readTime,coverage:{complete:true,consistent:true,
  rootCollections:[...scope].sort(),subcollectionsTraversed:true,readTimePinned:true},documents};
 validateSplitSnapshot(snapshot);
 return {snapshot,requests,missingParents,typedBytes:bytes,rootInventory};
}
