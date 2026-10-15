import {execFileSync} from 'node:child_process';import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createConsolidationControls} from './lib/fa-consolidation-controls.js';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const REPO='anestesiahmtforms/SAHMT-V2.0.github.io',PR=Number(value('--pr')),HEAD=value('--head'),CACHE=Number(value('--cache')),BRANCH=value('--branch');
const demand=(value,code)=>{if(!value)throw Error(code);};
let merged=false;
try{
 demand(args.length===9&&args[0]==='--apply'&&Number.isSafeInteger(PR)&&PR>0&&/^[a-f0-9]{40}$/.test(HEAD||'')&&Number.isSafeInteger(CACHE)&&CACHE>=193&&/^codex\/unificacao-fa-/.test(BRANCH||''),'CONSOLIDATION_PUBLISH_EXPLICIT_MODE_REQUIRED');
 const git=resolve(process.env.LOCALAPPDATA,'SAHMT','tools','mingit-2.56.0.2','cmd','git.exe');
 const raw=execFileSync(git,['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','ignore'],windowsHide:true,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
 const credential=Object.fromEntries(raw.trim().split('\n').map(row=>{const i=row.indexOf('=');return[row.slice(0,i),row.slice(i+1)];}));
 demand(credential.password,'CONSOLIDATION_PUBLISH_SESSION_MISSING');
 const api=async(path,method='GET',body)=>{
  const response=await fetch('https://api.github.com'+path,{method,headers:{Authorization:'Bearer '+credential.password,
   Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  demand(response.ok,'CONSOLIDATION_PUBLISH_HTTP_'+response.status);return response.json();
 };
 demand((await api('/user')).login==='anestesiahmtforms','CONSOLIDATION_PUBLISH_OWNER_MISMATCH');
 const control=createConsolidationControls({getToken:()=>firebaseCliAccountToken('anestesiahmtforms@gmail.com')});
 const marker=await control.read('sahmt-17a16','managementRuntime/faConsolidation');
 demand(marker?.fields?.status?.stringValue==='ACTIVE'&&marker.fields.migrationCode?.stringValue==='FA_CONSOLIDATION_VERIFIED'
  &&marker.fields.verifiedDocuments?.integerValue===marker.fields.plannedDocuments?.integerValue,'CONSOLIDATION_PUBLISH_COPY_NOT_ACTIVE');
 const occurrence=await control.read('sahmt-17a16','occurrenceRuntime/faConsolidation');
 demand(occurrence?.fields?.status?.stringValue==='ACTIVE'&&occurrence.fields.migrationCode?.stringValue==='FA_CONSOLIDATION_VERIFIED'&&occurrence.fields.verifiedDocuments?.integerValue===occurrence.fields.plannedDocuments?.integerValue,'CONSOLIDATION_PUBLISH_OCCURRENCES_NOT_ACTIVE');
 const pull=await api('/repos/'+REPO+'/pulls/'+PR);
 demand(pull.head.sha===HEAD&&pull.base.ref==='main'&&pull.head.ref===BRANCH,'CONSOLIDATION_PUBLISH_REVISION_CHANGED');
 const delay=()=>new Promise(done=>setTimeout(done,30000));
 const waitForRun=async(sha,event)=>{
  const deadline=Date.now()+25*60*1000;let last='';
  while(Date.now()<deadline){
   const runs=await api('/repos/'+REPO+'/actions/runs?head_sha='+sha+'&per_page=10');
   const run=runs.workflow_runs?.filter(row=>!event||row.event===event).sort((a,b)=>b.id-a.id)[0];
   const state=run?run.status+':'+run.conclusion:'pending';
   if(state!==last){console.log(JSON.stringify({code:'CONSOLIDATION_PUBLICATION_CHECK',phase:event==='push'?'production':'pull-request',status:run?.status||'pending',conclusion:run?.conclusion||null}));last=state;}
   if(run?.status==='completed'){demand(run.conclusion==='success','CONSOLIDATION_PUBLISH_CI_FAILED');return run;}
   await delay();
  }
  throw Error('CONSOLIDATION_PUBLISH_CI_TIMEOUT');
 };
 await waitForRun(HEAD,'pull_request');
 let mergeSha=pull.merge_commit_sha;
 if(!pull.merged){
  const result=await api('/repos/'+REPO+'/pulls/'+PR+'/merge','PUT',{sha:HEAD,merge_method:'merge'});
  demand(result.merged===true,'CONSOLIDATION_PUBLISH_MERGE_FAILED');mergeSha=result.sha;merged=true;
 }else merged=true;
 demand(/^[a-f0-9]{40}$/.test(mergeSha||''),'CONSOLIDATION_PUBLISH_MERGE_REVISION_INVALID');
 await waitForRun(mergeSha,'push');
 const page='https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/';
 const response=await fetch(page+'service-worker.js?consolidation='+mergeSha,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 demand(response.ok&&(await response.text()).includes('sahmt-v2-shell-v'+CACHE),'CONSOLIDATION_PUBLISH_SERVED_VERSION_MISMATCH');
 const index=await fetch(page,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 demand(index.ok,'CONSOLIDATION_PUBLISH_PAGE_UNAVAILABLE');
 const html=await index.text();
 for(const name of ['firebase-project-auth-optin','management-firebase-enabled','indicators-firebase-enabled'])
  demand(new RegExp('<meta name="'+name+'" content="false"').test(html),'CONSOLIDATION_PUBLISH_PRIMARY_CONFIG_MISMATCH');
 console.log(JSON.stringify({code:'FA_CONSOLIDATION_PWA_PUBLISHED',httpStatus:index.status,cacheVersion:CACHE,mergeRevision:mergeSha,
  managementProject:'FA',evaluationProject:'FA',occurrencesProject:'FA',authenticatedDeviceTestPending:true}));
}catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_PUBLISH_FAILED',merged,automaticRetry:false}));process.exitCode=1;}
