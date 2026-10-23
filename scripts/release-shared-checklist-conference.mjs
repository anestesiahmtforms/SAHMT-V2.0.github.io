import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFaRuleReleaseClient} from './lib/fa-rule-release-client.js';
import {createConsolidationScriptClient} from './lib/fa-consolidation-script-client.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';

const project='sahmt-17a16',root=`projects/${project}/databases/(default)/documents`;
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const normalize=s=>s.replaceAll('\r\n','\n');
const baseline=path=>normalize(execFileSync('git',['show','0bccfdb93a631003dc3a001bdec2b472da4b720b:'+path],{encoding:'utf8',windowsHide:true}));
const windows=[['      function stationTitleEditor() {','      function validStation('],['    match /checklistSignatureRequests/{requestId} {','    match /trainings/']];
function section(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);demand(a>=0&&b>a,'SHARED_RULE_SECTION_MISSING');return s.slice(a,b);}
function patchRules(remote,base,local){
 let result=normalize(remote);
 for(const [start,end] of windows){const old=section(result,start,end),before=section(base,start,end),after=section(local,start,end);
  demand(old===before||old===after,'SHARED_RULE_SECTION_DRIFT');result=result.replace(old,after);}
 return result;
}
const value=f=>Object.fromEntries(Object.entries(f||{}).map(([k,v])=>[k,v.stringValue??v.booleanValue??v.timestampValue??(v.integerValue!==undefined?Number(v.integerValue):null)]));
let stage='START',writes=0;
async function main(){
 const mode=process.argv[2]||'preview';demand(['preview','apply'].includes(mode),'SHARED_RELEASE_MODE_INVALID');
 const token=await firebaseCliAccountToken('anestesiahmtforms@gmail.com');
 const api=async(path,method='GET',body,missing=false)=>{
  const r=await fetch('https://firestore.googleapis.com/v1/'+root+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(missing&&r.status===404)return null;demand(r.ok,'SHARED_FIRESTORE_HTTP_'+r.status);return r.json();
 };
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const date=day();
 async function captureDay(){
  const existing=await api('/checklistSignatureRequests/'+date,'GET',null,true);
  const rows=await api(':runQuery','POST',{structuredQuery:{from:[{collectionId:'checklistSignatureRequests'}],where:{fieldFilter:{field:{fieldPath:'day'},op:'EQUAL',value:{stringValue:date}}},limit:101}});
  const docs=rows.filter(x=>x.document).map(x=>x.document);demand(docs.length<=100,'SHARED_DAILY_REQUEST_LIMIT');
  const eligible=docs.map(doc=>({doc,data:value(doc.fields)})).filter(x=>x.data.recordKind==='ACKNOWLEDGEMENT'&&x.data.declaration===true&&x.data.signerUid&&x.data.signerName&&/^[a-f0-9]{64}$/.test(x.data.revision||'')&&['PENDING_VALIDATION','VALIDATED','NEEDS_REVIEW','DUPLICATE'].includes(x.data.status)&&Number.isFinite(Date.parse(x.data.acknowledgedAt)))
   .sort((a,b)=>Date.parse(a.data.acknowledgedAt)-Date.parse(b.data.acknowledgedAt)||a.doc.name.localeCompare(b.doc.name));
  return {existing,documents:docs,first:eligible[0]||null};
 }
 stage='CAPTURE';const rulesClient=createFaRuleReleaseClient({projectId:project,accessToken:token}),script=await createConsolidationScriptClient();
 const rules=await rulesClient.read(),content=await script.readContent(),deployments=await script.readDeployments(),daily=await captureDay();
 const localRules=normalize(await readFile('firestore.rules','utf8'));
 const patchedRules=patchRules(rules.rules.source.files[0].content,baseline('firestore.rules'),localRules);
 const localScript=normalize(await readFile('apps-script-v2/ChecklistValidation.gs','utf8'));
 const remote=content.files.filter(f=>f.name==='ChecklistValidation'&&f.type==='SERVER_JS');demand(remote.length===1,'SHARED_SCRIPT_FILE_INVALID');
 demand([baseline('apps-script-v2/ChecklistValidation.gs'),localScript].includes(normalize(remote[0].source)),'SHARED_SCRIPT_SOURCE_DRIFT');
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','shared-checklist-release');await mkdir(directory,{recursive:true});
 const protector=await createPrivateJsonProtector(),backup=resolve(directory,'release-'+new Date().toISOString().replace(/\D/g,'')+'.dpapi.json');
 await writeFile(backup,JSON.stringify(protector.seal({project,date,rules,content,deployments,daily})),{flag:'wx'});
 demand((await openPrivateJson(JSON.parse(await readFile(backup,'utf8')))).project===project,'SHARED_BACKUP_INVALID');
 await mkdir('.local-preview',{recursive:true});await writeFile('.local-preview/shared-checklist.live.rules',patchedRules);
 if(mode==='preview'){console.log(JSON.stringify({code:'SHARED_CHECKLIST_RELEASE_PREVIEW',day:date,existingDaily:Boolean(daily.existing),legacyRequests:daily.documents.length,backfillRequired:!daily.existing&&Boolean(daily.first),scriptChange:normalize(remote[0].source)!==localScript,rulesChange:normalize(rules.rules.source.files[0].content)!==patchedRules,backup}));return;}
 stage='SCRIPT';
 if(normalize(remote[0].source)!==localScript){
  const fresh=await script.readContent();demand(JSON.stringify(fresh.files.map(({name,type,source})=>({name,type,source})))===JSON.stringify(content.files.map(({name,type,source})=>({name,type,source}))),'SHARED_SCRIPT_REMOTE_DRIFT');
  const next=structuredClone(content);next.files.find(f=>f.name==='ChecklistValidation').source=localScript;
  await script.updateContent(next);writes++;
  const saved=await script.readContent();demand(saved.files.length===next.files.length&&saved.files.every(f=>normalize(f.source)===normalize(next.files.find(n=>n.name===f.name&&n.type===f.type)?.source||'')),'SHARED_SCRIPT_VERIFY_FAILED');
  const version=await script.createVersion('Shared daily Checklist acknowledgement; preserves scoring and all other modules');
  for(const d of deployments.deployments||[])if(Number.isSafeInteger(d.deploymentConfig?.versionNumber))await script.updateDeployment(d,version.versionNumber,'Shared daily Checklist acknowledgement');
  const after=await script.readDeployments();demand((deployments.deployments||[]).every(d=>after.deployments.some(a=>a.deploymentId===d.deploymentId&&(!Number.isSafeInteger(d.deploymentConfig?.versionNumber)||a.deploymentConfig.versionNumber===version.versionNumber))),'SHARED_SCRIPT_DEPLOYMENT_VERIFY_FAILED');
 }
 stage='RULES';if(normalize(rules.rules.source.files[0].content)!==patchedRules){await rulesClient.publish(patchedRules,rules);writes++;}
 demand(normalize((await rulesClient.read()).rules.source.files[0].content)===patchedRules,'SHARED_RULES_VERIFY_FAILED');
 stage='DAILY_BACKFILL';demand(day()===date,'SHARED_RELEASE_DATE_CHANGED');const freshDay=await captureDay();
 let backfilled=false;
 if(!freshDay.existing&&freshDay.first){
  const selected=freshDay.first,profile=await api('/users/'+encodeURIComponent(selected.data.signerUid),'GET',null,true);
  const fields={...selected.doc.fields,id:{stringValue:date},signerSigla:{stringValue:value(profile?.fields).sigla||''},migratedFromRequestId:{stringValue:selected.doc.name.split('/').at(-1)}};
  // The old record remains intact for delivery receipts and historical scores.
  await api(':commit','POST',{writes:[{update:{name:root+'/checklistSignatureRequests/'+date,fields},currentDocument:{exists:false}}]});writes++;backfilled=true;
  const saved=await api('/checklistSignatureRequests/'+date);demand(value(saved.fields).signerUid===selected.data.signerUid,'SHARED_BACKFILL_VERIFY_FAILED');
 }
 console.log(JSON.stringify({code:'SHARED_CHECKLIST_RELEASE_INSTALLED',day:date,backfilled,existingDaily:Boolean(freshDay.existing),writes,backup}));
}
main().catch(e=>{console.error(JSON.stringify({code:'SHARED_CHECKLIST_RELEASE_STOPPED',stage,writes,reason:e.message}));process.exitCode=1;});
