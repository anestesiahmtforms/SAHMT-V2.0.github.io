import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {migrateYearEndTotals} from './lib/year-end-totals-migration.js';

const apply=process.argv.includes('--apply'),projectId='outros-48120';
const token=await firebaseCliAccountToken('anestesiahmtforms5@gmail.com');
const root=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
async function requestUrl(url,body){
  const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  if(response.status===404&&body===undefined)return null;
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error('FIRESTORE_REQUEST_FAILED_'+response.status),{code:data.error?.status});
  return data;
}
if(apply){
  const normalize=s=>s.replace(/\r/g,'').replace(/\n\s*\n/g,'\n').trim();
  const release=await requestUrl(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`);
  const ruleset=await requestUrl('https://firebaserules.googleapis.com/v1/'+release?.rulesetName);
  const live=ruleset?.source?.files?.map(f=>f.content).join('\n');
  if(!live||normalize(live)!==normalize(await readFile('firestore.climate.rules','utf8'))||!live.includes('yearEndPairedTotals'))throw Error('PUBLISH_PRIVACY_RULES_FIRST');
}
await mkdir('.local-preview',{recursive:true});
const report=await migrateYearEndTotals({projectId,apply,request:(path,body)=>requestUrl(root+path,body),
  onPlan:plan=>writeFile('.local-preview/year-end-totals-migration.json',JSON.stringify(plan,null,2))});
console.log(JSON.stringify(report));
