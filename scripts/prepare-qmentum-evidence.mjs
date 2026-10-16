/** Optional public literature retrieval. No institutional values are sent.
 * HTTP availability is not clinical verification; candidates remain pending. */
import {REFERENCES,mapping} from '../src/qmentum-references.js';
import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const allowed=new Set(Object.values(REFERENCES).map(s=>new URL(s.url).hostname));
try{
 if(process.argv.length!==3||process.argv[2]!=='--read-public')throw Error('QMENTUM_PUBLIC_READ_EXPLICIT_REQUIRED');
 const results=await Promise.allSettled(Object.entries(REFERENCES).map(async([id,source])=>{
  const u=new URL(source.url);if(u.protocol!=='https:'||!allowed.has(u.hostname))throw Error('QMENTUM_EVIDENCE_URL_DENIED');
  const response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html,application/pdf'}});
  const record={...source,access:'REVIEW_REQUIRED',status:'REVIEW_REQUIRED',checkedAt:new Date().toISOString(),httpStatus:response.status,contentType:response.headers.get('content-type'),redirectNeedsReview:response.status>=300&&response.status<400};
  await response.body?.cancel();return [id,record];
 }));
 const sources=Object.fromEntries(results.filter(r=>r.status==='fulfilled').map(r=>r.value));
 const records=Object.entries(mapping).map(([id,keys])=>({id,status:'REVIEW_REQUIRED',version:'evidence-candidates-20261015',sources:keys.map(k=>sources[k]||{...REFERENCES[k],status:'UNAVAILABLE',access:'REVIEW_REQUIRED'})}));
 const dir=resolve(process.env.LOCALAPPDATA,'SAHMT','qmentum-fa-20261015');await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'evidence-candidates-private.json'),JSON.stringify(records,null,2));
 console.log(JSON.stringify({code:'QMENTUM_PUBLIC_EVIDENCE_RETRIEVED',indicators:records.length,checked:results.filter(r=>r.status==='fulfilled').length,unavailable:results.filter(r=>r.status==='rejected').length,verifiedAutomatically:0,privateMetricsSent:0,cloudWrites:0}));
}catch(error){console.error(JSON.stringify({code:/^QMENTUM_[A-Z_]+$/.test(error.message||'')?error.message:'QMENTUM_EVIDENCE_PREPARATION_FAILED'}));process.exitCode=1;}
