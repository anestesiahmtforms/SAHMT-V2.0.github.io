import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';

// Read-only infrastructure inventory. Never collect credentials or user responses.
const targets=[
 {station:'FD',project:'rotinas-8a617',email:'anestesiahmtforms4@gmail.com',runtime:'sahmtPerformanceRuntime'},
 {station:'FE',project:'outros-48120',email:'anestesiahmtforms5@gmail.com',runtime:'fePerformanceRuntime'}
];
const report={capturedAt:new Date().toISOString(),cloudMutations:0,secretValuesRecorded:false,projects:[]};
for(const target of targets){
 const token=await firebaseCliAccountToken(target.email);
 async function get(url){
  try {
   const response=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(25000)});
   const body=await response.json();
   return {status:response.status,ok:response.ok,body};
  } catch {return {ok:false,status:0};}
 }
 const p=target.project;
 const [billing,database,release,accounts,runtime]=await Promise.all([
  get(`https://cloudbilling.googleapis.com/v1/projects/${p}/billingInfo`),
  get(`https://firestore.googleapis.com/v1/projects/${p}/databases/(default)`),
  get(`https://firebaserules.googleapis.com/v1/projects/${p}/releases/cloud.firestore`),
  get(`https://iam.googleapis.com/v1/projects/${p}/serviceAccounts?pageSize=100`),
  get(`https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents/${target.runtime}/current`)
 ]);
 let rules={status:release.status};
 if(release.ok&&release.body.rulesetName?.startsWith(`projects/${p}/rulesets/`)){
  const rs=await get('https://firebaserules.googleapis.com/v1/'+release.body.rulesetName);
  rules={status:rs.status,release:release.body.name,ruleset:release.body.rulesetName,
   files:rs.ok?(rs.body.source?.files||[]).map(f=>({name:f.name,sha256:createHash('sha256').update(f.content).digest('hex')})):[]};
 }
 const fields=runtime.body?.fields||{};
 const row={station:target.station,projectId:p,authenticatedEmail:target.email,
  billing:{status:billing.status,billingEnabled:billing.ok?billing.body.billingEnabled:null},
  database:{status:database.status,name:database.body?.name,type:database.body?.type,locationId:database.body?.locationId},
  rules,serviceAccounts:{status:accounts.status,complete:accounts.ok&&!accounts.body.nextPageToken,
   accounts:accounts.ok?(accounts.body.accounts||[]).map(a=>({email:a.email,disabled:a.disabled===true})):[]},
  performanceRuntime:{status:runtime.status,exists:runtime.ok,enabled:fields.enabled?.booleanValue??null,projectId:fields.projectId?.stringValue??null}};
 report.projects.push(row);
 console.log(JSON.stringify(row));
}
await mkdir('docs/superpowers/reports',{recursive:true});
await writeFile('docs/superpowers/reports/2026-11-01-fd-fe-access-inventory.json',JSON.stringify(report,null,2)+'\n');
