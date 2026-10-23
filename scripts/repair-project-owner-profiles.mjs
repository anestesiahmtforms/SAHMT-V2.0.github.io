import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';

const emails=Array.from({length:5},(_,i)=>`anestesiahmtforms${i?i+1:''}@gmail.com`);
const projects=['sahmt-17a16','sahmt-gestao-5ae66','indicadores---sahmt','rotinas-8a617','outros-48120'];
const aliases=['FA','FB','FC','FD','FE'];
const permissionKeys=['checklistRead','checklistWrite','checklistSign','checklistManage','labelsRead','labelsWrite','labelsManage','eventsRead','eventsWrite','eventsCatalogManage','scheduleRead','scheduleWrite','trainingsRead','trainingsManage','managementModuleEnabled','performanceModuleEnabled','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead','managementIndicatorsWrite','managementPlansManage','documentsManage','qualityManage','equipmentManage','peopleManage','financeRead','financeWrite','financeManage','notificationsRead','notificationsManage','occurrencesRead','occurrencesWrite','occurrencesAuditRead','usersManage','admin'];
const root=id=>`projects/${id}/databases/(default)/documents`;
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const decode=v=>v?.mapValue?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):v?.arrayValue?(v.arrayValue.values||[]).map(decode):v?.stringValue??v?.booleanValue??(v?.integerValue!==undefined?Number(v.integerValue):v?.timestampValue??null);
const fields=f=>decode({mapValue:{fields:f||{}}});
const encode=v=>Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:v===null?{nullValue:null}:typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:v};
async function api(token,url,method='GET',body,missing=false){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),redirect:'error'});
 if(missing&&r.status===404)return null;
 if(!r.ok){await r.body?.cancel();throw Error('OWNER_PROFILE_HTTP_'+r.status);}
 return r.json();
}
async function capture(tokens){
 const rows=[];
 for(let i=0;i<projects.length;i++){
  const project=projects[i],token=tokens[i];
  const response=await api(token,`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,'POST',{email:emails});
  const accounts=(response.users||[]).map(a=>({uid:a.localId,email:a.email,displayName:a.displayName||'',disabled:a.disabled===true,emailVerified:a.emailVerified===true,googleUid:a.providerUserInfo?.find(p=>p.providerId==='google.com')?.rawId||null}));
  const documents=[];
  for(const a of accounts){
   for(const path of [`users/${a.uid}`,`documentAccessEmails/${a.email}`,...(i===2?[`qmentumAccess/${a.uid}`]:[])]){
    documents.push({path,document:await api(token,`https://firestore.googleapis.com/v1/${root(project)}/${path}`,'GET',null,true)});
   }
  }
  const units=i===2?(await api(token,`https://firestore.googleapis.com/v1/${root(project)}/qmentumUnits?pageSize=20`)).documents||[]:[];
  rows.push({project,alias:aliases[i],accounts,documents,units});
 }
 return rows;
}
function plan(rows){
 const operations=[],problems=[];
 for(const row of rows)for(const email of emails){
  const source=rows[0].accounts.find(a=>a.email===email),a=row.accounts.find(a=>a.email===email);
  if(!source||!a||source.uid!==a.uid||!a.googleUid||a.googleUid!==source.googleUid||a.disabled||!a.emailVerified){problems.push({project:row.alias,email,code:!a?'AUTH_MISSING':!source?'FA_AUTH_MISSING':source.uid!==a.uid?'UID_MISMATCH':a.disabled?'AUTH_DISABLED':!a.emailVerified?'EMAIL_UNVERIFIED':'GOOGLE_IDENTITY_MISMATCH'});continue;}
  const get=path=>row.documents.find(d=>d.path===path)?.document;
  const profile=get(`users/${a.uid}`),old=fields(profile?.fields);
  demand(!old.uid||old.uid===a.uid,'OWNER_PROFILE_UID_MISMATCH');
  demand(!old.email||old.email.toLowerCase()===email,'OWNER_PROFILE_EMAIL_MISMATCH');
  const changes={uid:a.uid,email,displayName:old.displayName||source.displayName||email.split('@')[0],sigla:old.sigla||'',phone:old.phone||'',active:true,access:true,role:'administrador_app',permissions:{...old.permissions,...Object.fromEntries(permissionKeys.map(k=>[k,true]))}};
  const add=(path,previous,data,timestamps=[])=>{
   const previousData=fields(previous?.fields);if(Object.keys(data).every(k=>JSON.stringify(data[k])===JSON.stringify(previousData[k])))return;
   operations.push({project:row.project,path,fields:encode(data).mapValue.fields,mask:Object.keys(data),precondition:previous?{updateTime:previous.updateTime}:{exists:false},timestamps});
  };
  add(`users/${a.uid}`,profile,changes,profile?['updatedAt']:['createdAt','updatedAt']);
  const access=get(`documentAccessEmails/${email}`),accessData=fields(access?.fields);
  if(accessData.id!==email||accessData.email!==email||accessData.active!==true||JSON.stringify(accessData.groups)!==JSON.stringify(['GENERAL','RESTRICTED'])||!accessData.createdByUid||!accessData.createdAt){
   const actor=row.accounts.find(x=>x.email===emails[aliases.indexOf(row.alias)]).uid;
   add(`documentAccessEmails/${email}`,access,{id:email,email,active:true,groups:['GENERAL','RESTRICTED'],version:(Number(accessData.version)||0)+1,createdByUid:accessData.createdByUid||actor,updatedByUid:actor},accessData.createdAt?['updatedAt']:['createdAt','updatedAt']);
  }
  if(row.alias==='FC'){
   const units=row.units.filter(d=>fields(d.fields).active===true).map(d=>d.name.split('/').at(-1)).sort();
   demand(units.length>0&&units.length<=20,'OWNER_QMENTUM_UNITS_INVALID');
   add(`qmentumAccess/${a.uid}`,get(`qmentumAccess/${a.uid}`),{uid:a.uid,active:true,role:'manager',units});
  }
 }
 return {operations,problems};
}
const mode=process.argv[2]||'preview',directory=resolve(process.env.LOCALAPPDATA||'', 'SAHMT','owner-profile-repair');
try{
 demand(['preview','apply','verify'].includes(mode),'OWNER_PROFILE_MODE_INVALID');
 const tokens=[];for(const email of emails)tokens.push(await firebaseCliAccountToken(email));
 const rows=await capture(tokens),result=plan(rows);
 if(mode==='apply'){
  demand(!result.problems.length,'OWNER_PROFILE_AUTH_REPAIR_REQUIRED');
  await mkdir(directory,{recursive:true});const protector=await createPrivateJsonProtector();
  const backup=resolve(directory,`owners-${new Date().toISOString().replace(/\D/g,'')}.dpapi.json`);
  await writeFile(backup,JSON.stringify(protector.seal({rows,plan:result,createdAt:new Date().toISOString()})),{flag:'wx'});
  demand((await openPrivateJson(JSON.parse(await readFile(backup,'utf8')))).rows.length===5,'OWNER_PROFILE_BACKUP_INVALID');
  for(let i=0;i<projects.length;i++){
   const writes=result.operations.filter(o=>o.project===projects[i]).map(o=>({update:{name:root(o.project)+'/'+o.path,fields:o.fields},updateMask:{fieldPaths:o.mask},currentDocument:o.precondition,...(o.timestamps.length?{updateTransforms:o.timestamps.map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))}:{})}));
   if(writes.length)await api(tokens[i],`https://firestore.googleapis.com/v1/${root(projects[i])}:commit`,'POST',{writes});
  }
  const after=plan(await capture(tokens));demand(!after.problems.length&&!after.operations.length,'OWNER_PROFILE_VERIFY_FAILED');
  console.log(JSON.stringify({code:'OWNER_PROFILES_REPAIRED',accounts:25,uidChanges:0,documentsWritten:result.operations.length,backup}));
 }else console.log(JSON.stringify({code:result.problems.length?'OWNER_PROFILE_AUTH_REPAIR_REQUIRED':result.operations.length?'OWNER_PROFILES_NEED_REPAIR':'OWNER_PROFILES_VERIFIED',accounts:rows.map(r=>({project:r.alias,accounts:r.accounts.length,profiles:r.documents.filter(d=>d.path.startsWith('users/')&&d.document).length,fullAdmin:r.documents.filter(d=>d.path.startsWith('users/')&&fields(d.document?.fields).active===true&&fields(d.document?.fields).permissions?.admin===true).length})),problems:result.problems,plannedDocuments:result.operations.length}));
}catch(e){console.error(JSON.stringify({code:'OWNER_PROFILE_REPAIR_STOPPED',reason:e.message}));process.exitCode=1;}
