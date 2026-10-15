import test from 'node:test';
import assert from 'node:assert/strict';
import {captureFaConsolidationSnapshot} from '../scripts/lib/fa-consolidation-capture.js';
const stamp='2026-10-15T10:00:00.000Z',FB='sahmt-gestao-5ae66';
const name=path=>'projects/'+FB+'/databases/(default)/documents/'+path;
const row=(path,fields={title:{stringValue:'sintético'}})=>({name:name(path),createTime:stamp,updateTime:stamp,fields});
function setup(reply){const requests=[];return {requests,fetchImpl:async(url,options)=>{requests.push({url:new URL(url),...options});const data=await reply(new URL(url),options,requests.length);return {ok:true,status:200,text:async()=>JSON.stringify(data)};}};}
const run=h=>captureFaConsolidationSnapshot({projectId:FB,readTime:stamp,scope:['trainings'],accessToken:'private-oauth',...h});
test('capture uses only listDocuments GET and listCollectionIds POST, paginates at fixed readTime and captures children of missing parents',async()=>{
 const h=setup((url,options)=>{
  if(url.pathname.endsWith(':listCollectionIds'))return {collectionIds:url.pathname.endsWith('/missing:listCollectionIds')?['versions']:[]};
  if(url.pathname.endsWith('/versions'))return {documents:[row('trainings/missing/versions/v1')]};
  return url.searchParams.has('pageToken')?{documents:[{name:name('trainings/missing')}]}:{documents:[row('trainings/fixture')],nextPageToken:'page2'};
 });
 const result=await run(h);assert.equal(result.snapshot.documents.length,2);assert.equal(result.snapshot.coverage.consistent,true);
 assert.ok(result.snapshot.documents.some(x=>x.path==='trainings/missing/versions/v1'));assert.equal(result.missingParents,1);
 for(const req of h.requests){assert.equal(req.redirect,'error');assert.equal(req.headers.Authorization,'Bearer private-oauth');
  if(req.method==='GET'){assert.equal(req.url.searchParams.get('readTime'),stamp);assert.equal(req.url.searchParams.get('showMissing'),'true');}
  else{assert.equal(req.method,'POST');assert.ok(req.url.pathname.endsWith(':listCollectionIds'));assert.equal(JSON.parse(req.body).readTime,stamp);}
 }
});
test('invalid scope never obtains data and API errors are sanitized without body or token',async()=>{
 let calls=0;for(const projectId of ['other','indicadores---sahmt'])await assert.rejects(()=>captureFaConsolidationSnapshot({projectId,scope:['users'],accessToken:'secret',readTime:stamp,fetchImpl:async()=>calls++}),/SCOPE/);
 assert.equal(calls,0);
 for(const status of [401,403,429,500]){
  const fetchImpl=async()=>({ok:false,status,text:async()=>{throw Error('raw-token-and-email');}});
  await assert.rejects(()=>run({fetchImpl}),e=>e.message==='CONSOLIDATION_READ_HTTP_'+status&&!e.message.includes('raw-'));
 }
});
test('repeated pagination, out-of-scope names and document budgets fail closed',async()=>{
 for(const h of [setup(()=>({documents:[],nextPageToken:'repeated'})),setup(()=>({documents:[{...row('trainings/fixture'),name:'projects/other/databases/(default)/documents/trainings/fixture'}]}))])await assert.rejects(()=>run(h));
 const h=setup((url)=>url.pathname.endsWith(':listCollectionIds')?{}:{documents:[row('trainings/a'),row('trainings/b')]});
 await assert.rejects(()=>run({...h,maxDocuments:1}),/LIMIT/);
});
test('partial traversal is never marked complete',async()=>{
 const h=setup((url)=>{if(url.pathname.endsWith(':listCollectionIds'))throw Error('private-network-message');return {documents:[row('trainings/fixture')]};});
 await assert.rejects(()=>run(h),e=>e.message==='CONSOLIDATION_READ_NETWORK');
});
