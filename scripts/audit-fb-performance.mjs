import {writeFile,mkdir} from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {decodeFields} from '../worker-training/firestore.js';
const project='sahmt-gestao-5ae66',email='anestesiahmtforms2@gmail.com';
const token=await firebaseCliAccountToken(email),root='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents';
async function call(url,body){const response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});const data=await response.json().catch(()=>({}));return {status:response.status,data};}
const billing=await call('https://cloudbilling.googleapis.com/v1/projects/'+project+'/billingInfo');
const current=await call(root+'/fbPerformanceRuntime/current');
const collections=[];
for(const collection of ['evaluationAwards','evaluationFormConfigs','scores','htmlTrainingScores']){
 const result=await call(root+':runQuery',{structuredQuery:{from:[{collectionId:collection}],select:{fields:['category','modality','sourceType','originProjectId','evidence.sourceProjectId'].map(fieldPath=>({fieldPath}))},limit:201}});
 const rows=Array.isArray(result.data)?result.data.filter(r=>r.document).map(r=>decodeFields(r.document.fields||{})):[];
 const counts={};for(const row of rows){const key=[row.category||'',row.modality||'',row.sourceType||'',row.originProjectId||row.evidence?.sourceProjectId||'unspecified'].join('/');counts[key]=(counts[key]||0)+1;}
 collections.push({collection,status:result.status,returned:rows.length,complete:rows.length<201,counts});
}
const result={at:new Date().toISOString(),project,email,billing:{status:billing.status,enabled:billing.data.billingEnabled},runtime:{status:current.status,exists:current.status===200},collections,cloudMutations:0,userIdentifiersRecorded:false};
await mkdir('docs/superpowers/reports',{recursive:true});await writeFile('docs/superpowers/reports/2026-11-02-fb-performance-inventory.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
