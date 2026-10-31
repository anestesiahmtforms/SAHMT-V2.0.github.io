import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {resetYearEndForCarnival,activateYearEndCarnival} from './lib/year-end-carnival-reset.js';
import {prepareYearEndCarnivalRules} from './lib/year-end-carnival-rules.js';

const projectId='outros-48120',args=process.argv.slice(2),mode=args[0]||'--dry-run';
if(args.length>1||!['--dry-run','--reset','--publish-rules','--activate'].includes(mode))throw Error('YEAR_END_CARNIVAL_MODE_REQUIRED');
const token=await firebaseCliAccountToken('anestesiahmtforms5@gmail.com');
const root=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const rulesRoot=`https://firebaserules.googleapis.com/v1/projects/${projectId}`;
const demand=(ok,code)=>{if(!ok)throw Error(code);};
async function http(url,method='GET',body){
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(response.status===404&&method==='GET')return null;
 const data=await response.json();if(!response.ok)throw Object.assign(Error('YEAR_END_HTTP_'+response.status),{code:data.error?.status});return data;
}
const request=(path,body)=>http(root+path,body?'POST':'GET',body);
async function readRules(){
 const release=await http(rulesRoot+'/releases/cloud.firestore');
 demand(release?.rulesetName?.startsWith(`projects/${projectId}/rulesets/`),'YEAR_END_RULES_PROJECT_MISMATCH');
 const rules=await http('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
 demand(rules.source?.files?.length===1,'YEAR_END_RULES_SINGLE_SOURCE_REQUIRED');return {release,rules};
}
async function verifyPublic(){
 const base='https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/';
 const read=async path=>{const r=await fetch(new URL(path,base),{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});demand(r.ok,'YEAR_END_PUBLIC_HTTP_'+r.status);return r.text();};
 const manifest=JSON.parse(await read('assets-manifest.json?carnaval='+Date.now()));
 const files=[...new Set(Object.values(manifest).map(v=>v.file).filter(file=>file?.includes('year-end-schedule')&&file.endsWith('.js')))];
 const code=(await Promise.all(files.map(read))).join('\n');
 demand(code.includes('Plantão Carnaval')&&code.includes('06, 07, 08 e 09/02/2027')&&code.includes('plantaoCarnaval'),'YEAR_END_PUBLIC_CARNIVAL_REQUIRED');
}
const candidate=await readFile('firestore.climate.rules','utf8');
let report;
if(mode==='--publish-rules'){
 const previous=await readRules(),prepared=prepareYearEndCarnivalRules(previous.rules.source.files[0].content,candidate);
 if(prepared.alreadyCurrent)report={projectId,rulesAlreadyCurrent:true};
 else{
  const state=await resetYearEndForCarnival({request,projectId});demand(state.alreadyReset&&state.summaryVersion===0&&state.registrations===0,'YEAR_END_CLOSED_RESET_REQUIRED');
  const created=await http(rulesRoot+'/rulesets','POST',{source:{files:[{name:previous.rules.source.files[0].name,content:prepared.content}]}});
  demand(created.name?.startsWith(`projects/${projectId}/rulesets/`),'YEAR_END_RULESET_RESOURCE_INVALID');
  const current=await readRules();demand(current.release.rulesetName===previous.release.rulesetName&&current.release.updateTime===previous.release.updateTime,'YEAR_END_RULES_RELEASE_DRIFT');
  await http(rulesRoot+'/releases/cloud.firestore','PATCH',{release:{name:current.release.name,rulesetName:created.name},updateMask:'rulesetName'});
  const verified=await readRules();demand(verified.rules.source.files[0].content===prepared.content,'YEAR_END_RULES_VERIFY_FAILED');
  report={projectId,rulesPublished:true,unrelatedRulesPreserved:true};
 }
}else if(mode==='--activate'){
 report=await activateYearEndCarnival({request,projectId,verifyRelease:async()=>{
  await verifyPublic();const live=await readRules();demand(prepareYearEndCarnivalRules(live.rules.source.files[0].content,candidate).alreadyCurrent,'YEAR_END_NEW_RULES_REQUIRED');
 }});
}else{
 // Aggregate report only. Per the user's instruction no test records are backed up.
 const live=await readRules();prepareYearEndCarnivalRules(live.rules.source.files[0].content,candidate);
 report=await resetYearEndForCarnival({request,projectId,apply:mode==='--reset'});
}
await mkdir('.local-preview',{recursive:true});
await writeFile(`.local-preview/year-end-carnival-${mode.slice(2)}.json`,JSON.stringify({...report,completedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify(report,null,2));
