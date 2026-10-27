import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
import {planMemberCategoryDocuments,MEMBER_CATEGORY_PROJECTS} from './lib/member-category-plan.js';
import {addMemberCategoryRules,memberCategoryRuleTestSuite} from './lib/member-category-rules.js';
const [mode='preview',rosterPath,target='ALL']=process.argv.slice(2);
const owners={FA:'anestesiahmtforms@gmail.com',FB:'anestesiahmtforms2@gmail.com',FC:'anestesiahmtforms3@gmail.com',FD:'anestesiahmtforms4@gmail.com',FE:'anestesiahmtforms5@gmail.com'};
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const encode=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}}:typeof v==='number'?{integerValue:String(v)}:typeof v==='boolean'?{booleanValue:v}:{stringValue:v};
const root=project=>`projects/${project}/databases/(default)/documents`;
async function api(token,url,method='GET',body){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(r.status===404&&method==='GET')return null;
 if(!r.ok){await r.body?.cancel();throw Error('MEMBER_CATEGORY_HTTP_'+r.status);}return r.json();
}
async function readDocuments(token,projectId,documents){
 const response=await fetch(`https://firestore.googleapis.com/v1/${root(projectId)}:batchGet`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:documents.map(d=>root(projectId)+'/'+d.path)}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok){await response.body?.cancel();throw Error('MEMBER_CATEGORY_READ_'+response.status);}
 const text=await response.text();let rows;try{rows=JSON.parse(text);}catch{rows=text.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}
 demand(Array.isArray(rows),'MEMBER_CATEGORY_CAPTURE_INVALID');
 const byName=new Map(rows.map(x=>[x.found?.name||x.missing,x.found||null]));
 demand(byName.size===documents.length&&documents.every(d=>byName.has(root(projectId)+'/'+d.path)),'MEMBER_CATEGORY_CAPTURE_INCOMPLETE');
 return documents.map(d=>({...d,previous:byName.get(root(projectId)+'/'+d.path)||null}));
}
try{
 demand(['preview','apply','verify'].includes(mode)&&rosterPath&&(target==='ALL'||Object.hasOwn(MEMBER_CATEGORY_PROJECTS,target)),'MEMBER_CATEGORY_ARGUMENTS_INVALID');
 const input=JSON.parse(await readFile(rosterPath,'utf8'));
 const tokens={},captures={},blocked=[];
 for(const [alias,projectId] of Object.entries(MEMBER_CATEGORY_PROJECTS)){
  if(target!=='ALL'&&target!==alias)continue;
  try{
   tokens[alias]=await firebaseCliAccountToken(owners[alias]);
   const emails=Object.values(input).flat().map(x=>x.trim().toLowerCase());
   const data=await api(tokens[alias],`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,'POST',{email:[...new Set(emails)]});
   const accounts=(data.users||[]).map(a=>({uid:a.localId,email:a.email?.toLowerCase()}));
   const release=await api(tokens[alias],`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`);
   demand(release?.rulesetName?.startsWith(`projects/${projectId}/rulesets/`),'MEMBER_CATEGORY_RELEASE_INVALID');
   const ruleset=await api(tokens[alias],`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
   demand(ruleset?.source?.files?.length===1,'MEMBER_CATEGORY_RULE_FILES_INVALID');
   captures[alias]={accounts,release,ruleset};
  }catch(error){delete tokens[alias];blocked.push({alias,reason:error.message});}
 }
 const plan=planMemberCategoryDocuments(input,Object.fromEntries(Object.entries(captures).map(([alias,c])=>[alias,c.accounts])));
 const summaries=[];let protector,backupPath;
 for(const [alias,project] of Object.entries(plan.projects)){
  const capture=captures[alias],token=tokens[alias];
  const source=capture.ruleset.source.files[0],patched=addMemberCategoryRules(source.content);
  const documents=await readDocuments(token,project.projectId,project.documents);
  const changes=documents.filter(d=>!isDeepStrictEqual(d.previous?.fields||{},encode(d.data).mapValue.fields));
  const rulesChanged=patched!==source.content;
  if(mode==='apply'){
   protector??=await createPrivateJsonProtector();await mkdir('.local-preview/member-category-backups',{recursive:true});
   backupPath=resolve('.local-preview/member-category-backups',`${alias}-${Date.now()}.dpapi.json`);
   await writeFile(backupPath,JSON.stringify(protector.seal({alias,capture,documents,revision:plan.revision})),{flag:'wx'});
   demand((await openPrivateJson(JSON.parse(await readFile(backupPath,'utf8')))).revision===plan.revision,'MEMBER_CATEGORY_BACKUP_INVALID');
   const files=[{...source,content:patched}];
   const compiled=await api(token,`https://firebaserules.googleapis.com/v1/projects/${project.projectId}:test`,'POST',{source:{files},testSuite:memberCategoryRuleTestSuite()});
   demand(!(compiled.issues||[]).some(x=>x.severity==='ERROR'),'MEMBER_CATEGORY_RULE_COMPILE_FAILED');
   demand(compiled.testResults?.length===13&&compiled.testResults.every(x=>x.state==='SUCCESS'),'MEMBER_CATEGORY_RULE_TEST_FAILED');
   const currentRelease=await api(token,`https://firebaserules.googleapis.com/v1/${capture.release.name}`);
   demand(currentRelease.rulesetName===capture.release.rulesetName,'MEMBER_CATEGORY_RULE_RELEASE_CHANGED');
   if(changes.length)await api(token,`https://firestore.googleapis.com/v1/${root(project.projectId)}:commit`,'POST',{writes:changes.map(d=>({update:{name:root(project.projectId)+'/'+d.path,fields:encode(d.data).mapValue.fields},currentDocument:d.previous?{updateTime:d.previous.updateTime}:{exists:false}}))});
   if(rulesChanged){
    const created=await api(token,`https://firebaserules.googleapis.com/v1/projects/${project.projectId}/rulesets`,'POST',{source:{files}});
    demand(created.name?.startsWith(`projects/${project.projectId}/rulesets/`),'MEMBER_CATEGORY_CREATED_RULESET_INVALID');
    const releaseCheck=await api(token,`https://firebaserules.googleapis.com/v1/${capture.release.name}`);
    demand(releaseCheck.rulesetName===capture.release.rulesetName,'MEMBER_CATEGORY_RULE_RELEASE_CHANGED');
    await api(token,`https://firebaserules.googleapis.com/v1/${capture.release.name}`,'PATCH',{release:{name:capture.release.name,rulesetName:created.name},updateMask:'rulesetName'});
   }
   const after=await readDocuments(token,project.projectId,project.documents);
   demand(after.every(d=>isDeepStrictEqual(d.previous?.fields||{},encode(d.data).mapValue.fields)),'MEMBER_CATEGORY_VERIFY_FAILED');
  }
  summaries.push({alias,members:plan.totalMembers,linked:project.linked,pending:project.pending,plannedDocuments:changes.length,rulesChanged,status:mode==='apply'?'APPLIED':changes.length||rulesChanged?'NEEDS_UPDATE':'VERIFIED'});
 }
 const summary={mode,revision:plan.revision,totalMembers:plan.totalMembers,counts:plan.counts,projects:summaries,blocked,authChanges:0,permissionChanges:0};
 await writeFile('.local-preview/member-categories-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 if(blocked.length||mode==='verify'&&summaries.some(s=>s.status!=='VERIFIED'))process.exitCode=2;
}catch(error){console.error(JSON.stringify({code:'MEMBER_CATEGORY_SYNC_STOPPED',reason:error.message}));process.exitCode=1;}
